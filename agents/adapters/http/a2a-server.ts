import type { A2AServerConfig } from "@agents/types";
import {
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCNotification,
  ok,
  err,
  notification,
  buildCorsHeaders,
  buildCorsPreflightHeaders,
} from "@utils/rpc";
import { RateLimiter, rateLimitResponse } from "@adapters/rate-limit";

export class A2AServer {
  private readonly config: A2AServerConfig;
  private readonly rateLimiter: RateLimiter;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(
    config: A2AServerConfig & {
      onWorldState?: () => Promise<any>;
    },
    rateLimiter?: RateLimiter,
  ) {
    this.config = config as any;
    this.rateLimiter = rateLimiter ?? new RateLimiter();
  }

  start(): void {
    const { port, card, onTask, onWorldState, authToken, requireAuth } = (this
      .config as any);
    const rateLimiter = this.rateLimiter;

    this.server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "OPTIONS") {
          const origin = req.headers.get("Origin");
          const headers = buildCorsPreflightHeaders(origin);
          if (!headers) return new Response(null, { status: 204 });
          return new Response(null, { headers });
        }

        // Rate-limit BEFORE any auth or dispatch — keyed by X-API-Key (when
        // present) or remote IP. Health-card GETs and world-state GETs are
        // excluded so discovery/liveness checks don't count against limits.
        if (req.method !== "GET") {
          const rl = rateLimiter.check(req);
          if (!rl.allowed) {
            const snapshot = rateLimiter.getSnapshot();
            const totalHits = Object.values(snapshot).reduce((sum, e) => sum + e.used, 0);
            console.warn(`[A2AServer] rate-limited: 429 (window hits=${totalHits})`);
            const rr = rateLimitResponse(rl.retryAfterMs);
            return new Response(JSON.stringify(rr.body), {
              status: rr.status,
              headers: rr.headers,
            });
          }
        }

        if (
          req.method === "GET" &&
          (url.pathname === "/.well-known/agent-card.json" ||
            url.pathname === "/.well-known/world-state")
        ) {
          const origin = req.headers.get("Origin");
          const corsHeaders = buildCorsHeaders(origin);
          const headers = corsHeaders ?? {};

          if (url.pathname === "/.well-known/world-state") {
            console.log("[A2AServer] GET /.well-known/world-state");
            if (!onWorldState)
              return new Response("Not found", {
                status: 404,
                headers,
              });
            const state = await onWorldState();
            return Response.json(state, { headers });
          }
          console.log("[A2AServer] GET /.well-known/agent-card.json");
          return Response.json(card, { headers });
        }

        if (req.method === "POST" && url.pathname === "/") {
          // API key auth (when enabled)
          if (requireAuth && authToken) {
            const apiKey = req.headers.get("X-API-Key");
            if (!apiKey) {
              console.error("[A2AServer] POST / missing X-API-Key (401)");
              const origin = req.headers.get("Origin");
              const corsHeaders = buildCorsHeaders(origin);
              return new Response(
                JSON.stringify(err(null, -32000, "Unauthorized: missing X-API-Key")),
                {
                  status: 401,
                  headers: { ...(corsHeaders ?? {}), "Content-Type": "application/json" },
                },
              );
            }
            if (apiKey !== authToken) {
              console.error("[A2AServer] POST / invalid X-API-Key (403)");
              const origin = req.headers.get("Origin");
              const corsHeaders = buildCorsHeaders(origin);
              return new Response(
                JSON.stringify(err(null, -32001, "Forbidden: invalid API key")),
                {
                  status: 403,
                  headers: { ...(corsHeaders ?? {}), "Content-Type": "application/json" },
                },
              );
            }
          }

          let body: unknown;
          try {
            body = await req.json();
          } catch {
            console.error("[A2AServer] POST / parse error (-32700)");
            const origin = req.headers.get("Origin");
            const corsHeaders = buildCorsHeaders(origin);
            return Response.json(
              err(null, -32700, "Parse error"),
              { headers: corsHeaders ?? {} },
            );
          }

          const rpc = body as JSONRPCRequest;

          if (
            !rpc ||
            rpc.jsonrpc !== "2.0" ||
            typeof rpc.method !== "string"
          ) {
            console.error(`[A2AServer] POST / invalid request (-32600) id=${rpc?.id ?? null}`);
            const origin = req.headers.get("Origin");
            const corsHeaders = buildCorsHeaders(origin);
            return Response.json(
              err(rpc?.id ?? null, -32600, "Invalid Request"),
              { headers: corsHeaders ?? {} },
            );
          }

          const { id, method, params } = rpc;

          if (method !== "tasks/send") {
            console.error(`[A2AServer] POST / method not found (-32601) id=${id} method=${method}`);
            const origin = req.headers.get("Origin");
            const corsHeaders = buildCorsHeaders(origin);
            return Response.json(
              err(id, -32601, `Method not found: ${method}`),
              { headers: corsHeaders ?? {} },
            );
          }

          try {
            const message = params as {
              message?: { parts?: Array<{ kind: string; text?: string }> };
            };
            const parts = message?.message?.parts ?? [];
            const text =
              parts.find((p) => p.kind === "text")?.text ?? "";

            console.log(`[A2AServer] ← POST / tasks/send id=${id} textLen=${text.length}`);

            console.log(`[A2AServer] executing onTask (id=${id})`);
            const start = performance.now();
            const result = await onTask(text);
            const latency = Math.round(performance.now() - start);
            console.log(`[A2AServer] onTask done (id=${id}) latency=${latency}ms resultLen=${String(result).length}`);

            const origin = req.headers.get("Origin");
            const corsHeaders = buildCorsHeaders(origin);
            return Response.json(ok(id, { text: result }), {
              headers: corsHeaders ?? {},
            });
          } catch (e) {
            console.error("[A2AServer] internal error:", e);
            const origin = req.headers.get("Origin");
            const corsHeaders = buildCorsHeaders(origin);
            return Response.json(
              err(id, -32603, `Internal error: ${String(e)}`),
              { headers: corsHeaders ?? {} },
            );
          }
        }

        console.error(`[A2AServer] ← ${req.method} ${url.pathname} not found (404)`);
        const origin = req.headers.get("Origin");
        const corsHeaders = buildCorsHeaders(origin);
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders ?? {},
        });
      },
    });

    console.log(`\n🚀 A2A Server → http://localhost:${port}`);
    console.log(`   Card:       http://localhost:${port}/.well-known/agent-card.json`);
    console.log(`   Rate limit: ${rateLimiter.maxRequests} req/${rateLimiter.windowMs / 1000}s per caller (X-API-Key or IP)`);
    console.log(`   Agent:      ${card.name} v${card.version}\n`);
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }
}
