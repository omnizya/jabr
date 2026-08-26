/**
 * ACP stdio bridge adapter — HTTP variant
 *
 * Reads JSON-RPC lines from stdin (ACP, nd-JSON) and proxies tasks to the
 * orchestrator via A2A HTTP. This is a thin protocol translator: it does not
 * manage sessions or stream results.
 *
 * Wire in Zed settings.json:
 *   { "command": "bun", "args": ["agents/adapters/http/stdio-bridge.ts"] }
 *
 * Wire in JetBrains acp.json:
 *   { "agent-lab": { "command": "bun", "args": ["agents/adapters/http/stdio-bridge.ts"] } }
 *
 * ACP flow:
 *   IDE  →  initialize  →  bridge
 *   IDE  →  message     →  bridge  →  A2A orchestrator (tasks/send)
 *   bridge  →  message result  →  IDE
 */

import type { ACPRequest, ACPResponse } from "../../types.ts";

// ── Wire-format types ──────────────────────────────────────────────────────────

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

// ── JSON-RPC helpers (not exported) ────────────────────────────────────────────

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

// ── StdioBridge ────────────────────────────────────────────────────────────────

export class StdioBridge {
  private readonly orchestratorUrl: string;
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private onData: ((chunk: Uint8Array) => void) | null = null;

  constructor(config: { orchestratorUrl?: string } = {}) {
    this.orchestratorUrl = config.orchestratorUrl ?? "http://localhost:4000";
  }

  start(): void {
    process.stdin.setEncoding("utf-8");
    this.onData = (chunk: Uint8Array) => {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.handleLine(trimmed);
      }
    };
    process.stdin.on("data", this.onData);
  }

  stop(): void {
    if (this.onData) {
      process.stdin.off("data", this.onData);
      this.onData = null;
    }
  }

  private async handleLine(line: string): Promise<void> {
    let req: JSONRPCRequest;
    try {
      req = JSON.parse(line) as JSONRPCRequest;
    } catch {
      process.stdout.write(
        JSON.stringify(err(null, -32700, "Parse error")) + "\n",
      );
      return;
    }

    const response = await this.dispatch(req);
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  private async dispatch(req: JSONRPCRequest): Promise<JSONRPCResponse> {
    // Validate JSON-RPC envelope
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return err(req.id ?? null, -32600, "Invalid Request");
    }

    switch (req.method) {
      // ── ACP handshake ──────────────────────────────────────────────────────
      case "initialize": {
        return ok(req.id, { capabilities: {} });
      }

      // ── Message — delegate to A2A orchestrator ─────────────────────────────
      case "message": {
        const params = (req.params ?? {}) as {
          content?: { text?: string };
        };
        const text = params.content?.text;
        if (typeof text !== "string") {
          return err(req.id, -32602, "Invalid params: missing content.text");
        }

        try {
          const res = await fetch(`${this.orchestratorUrl}/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: req.id ?? crypto.randomUUID(),
              method: "tasks/send",
              params: { text },
            }),
          });

          if (!res.ok) {
            return err(
              req.id,
              -32603,
              `Orchestrator returned ${res.status}`,
            );
          }

          const body = (await res.json()) as JSONRPCResponse;
          if (body.error) {
            return err(req.id, body.error.code, body.error.message);
          }
          return ok(req.id, body.result ?? {});
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Unknown fetch error";
          return err(
            req.id,
            -32603,
            `Internal error: could not reach orchestrator at ${this.orchestratorUrl} (${message})`,
          );
        }
      }

      // ── Anything else ───────────────────────────────────────────────────────
      default:
        return err(req.id, -32601, `Method not found: ${req.method}`);
    }
  }
}

// ── Entrypoint (run directly) ──────────────────────────────────────────────────

// @ts-ignore - Bun provides import.meta.main
if (import.meta.main) {
  const bridge = new StdioBridge();
  bridge.start();
  process.stderr.write(
    "ACP stdio bridge (http) ready — awaiting IDE connection on stdio\n",
  );
}
