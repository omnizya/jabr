/**
 * A2A HTTP server adapter.
 *
 * Implements a Bun.serve-based A2A (Agent-to-Agent) HTTP endpoint:
 *  - CORS preflight handling
 *  - AgentCard serving at /.well-known/agent-card.json
 *  - JSON-RPC 2.0 dispatcher for tasks/send
 *
 * No class-level HTTP state — Bun.serve handles everything per request.
 */

import type { AgentCard } from "../../types.ts";

interface A2AServerConfig {
  port: number;
  card: AgentCard;
  onTask: (message: string) => Promise<string>;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── JSON-RPC helpers ───────────────────────────────────────────────────────────

function ok(id: number | string | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(
  id: number | string | null,
  code: number,
  message: string,
): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── A2A server ─────────────────────────────────────────────────────────────────

export class A2AServer {
  private readonly config: A2AServerConfig;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: A2AServerConfig) {
    this.config = config;
  }

  start(): void {
    const { port, card, onTask } = this.config;

    this.server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        // 1. CORS preflight
        if (req.method === "OPTIONS") {
          return new Response(null, {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        }

        const corsHeaders = { "Access-Control-Allow-Origin": "*" };

        // 2. AgentCard serving
        if (
          req.method === "GET" &&
          url.pathname === "/.well-known/agent-card.json"
        ) {
          return Response.json(card, { headers: corsHeaders });
        }

        // 3. JSON-RPC endpoint
        if (req.method === "POST" && url.pathname === "/") {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return Response.json(
              err(null, -32700, "Parse error"),
              { headers: corsHeaders },
            );
          }

          const rpc = body as JSONRPCRequest;

          // Validate JSON-RPC shape
          if (
            !rpc ||
            rpc.jsonrpc !== "2.0" ||
            typeof rpc.method !== "string"
          ) {
            return Response.json(
              err(rpc?.id ?? null, -32600, "Invalid Request"),
              { headers: corsHeaders },
            );
          }

          const { id, method, params } = rpc;

          if (method !== "tasks/send") {
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

            const result = await onTask(text);
            return Response.json(ok(id, { text: result }), {
              headers: corsHeaders,
            });
          } catch (e) {
            return Response.json(
              err(id, -32603, `Internal error: ${String(e)}`),
              { headers: corsHeaders },
            );
          }
        }

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
