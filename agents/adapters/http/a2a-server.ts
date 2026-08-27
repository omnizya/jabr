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

  constructor(config: A2AServerConfig) {
    this.config = config;
  }

  start(): void {
    const { port, card, onTask } = this.config;

    this.server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsPreflightHeaders });
        }

        if (
          req.method === "GET" &&
          url.pathname === "/.well-known/agent-card.json"
        ) {
          return Response.json(card, { headers: corsHeaders });
        }

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
