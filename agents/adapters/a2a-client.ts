import type { AgentRegistryPort } from "../ports/agent-registry.ts";
import type { AgentCard } from "../types.ts";

// ─── JSON-RPC wire format ──────────────────────────────────────────────────────

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

// ─── A2A HTTP client adapter ───────────────────────────────────────────────────

export class A2AClient implements AgentRegistryPort {
  constructor() {
    // Stateless client — no state needed.
  }

  async fetchCard(baseUrl: string): Promise<AgentCard | null> {
    try {
      const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
      if (!res.ok) {
        console.error(`[A2AClient] fetchCard failed: ${res.status} ${res.statusText}`);
        return null;
      }
      const card = (await res.json()) as AgentCard;
      return card;
    } catch (err) {
      console.error(`[A2AClient] fetchCard error for ${baseUrl}:`, err);
      return null;
    }
  }

  async delegateTask(agentUrl: string, text: string): Promise<string> {
    const body: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: {
        message: {
          role: "user",
          parts: [{ type: "text", text }],
        },
      },
    };

    try {
      const res = await fetch(agentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = `[A2AClient] delegateTask failed: ${res.status} ${res.statusText}`;
        console.error(msg);
        return msg;
      }

      const data = (await res.json()) as JSONRPCResponse;

      if (data.error) {
        const msg = `[A2AClient] delegateTask error: ${data.error.code} ${data.error.message}`;
        console.error(msg);
        return msg;
      }

      const result = data.result as
        | {
            artifacts?: Array<{ parts?: Array<{ text?: string }> }>;
            message?: { parts?: Array<{ text?: string }> };
          }
        | undefined;

      if (result?.artifacts?.[0]?.parts?.[0]?.text) {
        return result.artifacts[0].parts[0].text;
      }
      if (result?.message?.parts?.[0]?.text) {
        return result.message.parts[0].text;
      }

      return "[A2AClient] delegateTask: no text content in response";
    } catch (err) {
      const msg = `[A2AClient] delegateTask error: ${String(err)}`;
      console.error(msg, err);
      return msg;
    }
  }
}
