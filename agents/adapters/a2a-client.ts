import type { AgentRegistryPort } from "@ports/agent-registry";
import type { AgentCard } from "@agents/types";
import type { JSONRPCRequest, JSONRPCResponse } from "@agents/utils/rpc";

export class A2AClient implements AgentRegistryPort {
  private cache: Map<string, AgentCard> = new Map();

  constructor() {
    // Client with optional card cache keyed by base URL.
  }

  async fetchCard(baseUrl: string): Promise<AgentCard | null> {
    const cached = this.cache.get(baseUrl);
    if (cached) {
      return cached;
    }

    try {
      const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
      if (!res.ok) {
        console.error(`[A2AClient] fetchCard failed: ${res.status} ${res.statusText}`);
        return null;
      }
      const card = (await res.json()) as AgentCard;
      this.cache.set(baseUrl, card);
      return card;
    } catch (err) {
      console.error(`[A2AClient] fetchCard error for ${baseUrl}:`, err);
      return null;
    }
  }

  async discoverAgents(urls: string[]): Promise<Record<string, AgentCard>> {
    const entries = await Promise.all(
      urls.map(async (url) => {
        try {
          const card = await this.fetchCard(url);
          if (!card) {
            console.error(`[A2AClient] discoverAgents: no card for ${url}`);
            return null;
          }
          return [card.name, card] as const;
        } catch (err) {
          console.error(`[A2AClient] discoverAgents: failed to fetch card for ${url}:`, err);
          return null;
        }
      }),
    );

    const result: Record<string, AgentCard> = {};
    for (const entry of entries) {
      if (entry) {
        result[entry[0]] = entry[1];
      }
    }
    return result;
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
