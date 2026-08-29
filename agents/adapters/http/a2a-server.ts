import type { A2AServerConfig } from "@agents/types";
import {
  type JSONRPCRequest,
  ok,
  err,
  corsHeaders,
  corsPreflightHeaders,
} from "@utils/rpc";

export class A2AServer {
  private readonly config: A2AServerConfig;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: A2AServerConfig & { 
    onWorldState?: () => Promise<any> 
  }) {
    this.config = config as any;
  }

  start(): void {
    const { port, card, onTask, onWorldState } = (this.config as any);


    this.server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsPreflightHeaders });
        }

        if (
          req.method === "GET" &&
          (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/world-state")
        ) {
          if (url.pathname === "/.well-known/world-state") {
            console.log(`[A2AServer] GET /.well-known/world-state`);
            if (!onWorldState) return new Response("Not found", { status: 404, headers: corsHeaders });
            const state = await onWorldState();
            return Response.json(state, { headers: corsHeaders });
          }
          console.log(`[A2AServer] GET /.well-known/agent-card.json`);
          return Response.json(card, { headers: corsHeaders });
        }


        if (req.method === "POST" && url.pathname === "/") {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            console.error(`[A2AServer] ← POST / parse error (-32700)`);
            return Response.json(
              err(null, -32700, "Parse error"),
              { headers: corsHeaders },
            );
          }

          const rpc = body as JSONRPCRequest;

          if (
            !rpc ||
            rpc.jsonrpc !== "2.0" ||
            typeof rpc.method !== "string"
          ) {
            console.error(`[A2AServer] ← POST / invalid request (-32600) id=${rpc?.id ?? null}`);
            return Response.json(
              err(rpc?.id ?? null, -32600, "Invalid Request"),
              { headers: corsHeaders },
            );
          }

          const { id, method, params } = rpc;

          if (method !== "tasks/send") {
            console.error(`[A2AServer] ← POST / method not found (-32601) id=${id} method=${method}`);
            return Response.json(
              err(id, -32601, `Method not found: ${method}`),
              { headers: corsHeaders },
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
            return Response.json(ok(id, { text: result }), {
              headers: corsHeaders,
            });
          } catch (e) {
            console.error("[A2AServer] internal error:", e);
            return Response.json(
              err(id, -32603, `Internal error: ${String(e)}`),
              { headers: corsHeaders },
            );
          }
        }

        console.error(`[A2AServer] ← ${req.method} ${url.pathname} not found (404)`);
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders,
        });
      },
    });

    console.log(
      `\n🚀 A2A Server → http://localhost:${port}`,
    );
    console.log(
      `   Card:       http://localhost:${port}/.well-known/agent-card.json`,
    );
    console.log(`   Agent:      ${card.name} v${card.version}\n`);
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }
}
