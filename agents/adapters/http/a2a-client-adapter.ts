/**
 * a2a-client-adapter.ts — Concrete A2A client adapter speaking JSON-RPC over HTTP.
 *
 * Implements the A2AClientPort interface. Uses Bun's native fetch to send
 * JSON-RPC 2.0 `tasks/send` requests, discover AgentCards via GET
 * /.well-known/agent-card.json, and probe health via GET /health.
 */

import type { A2AClientPort, A2ATaskResult } from "@ports/a2a-client-port";
import { ok, type JSONRPCRequest, type JSONRPCResponse } from "@utils/rpc";

export class A2AClient implements A2AClientPort {
  private nextId = 1;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  /**
   * Send a task synchronously via `tasks/send` and await the full result.
   */
  async sendTask(
    agentUrl: string,
    message: string,
    contextId?: string,
  ): Promise<A2ATaskResult> {
    const id = this.nextId++;
    const body: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method: "tasks/send",
      params: {
        message: { role: "user", parts: [{ kind: "text", text: message }] },
        ...(contextId ? { contextId } : {}),
      },
    };

    const res = await fetch(agentUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(
        `A2A sendTask failed: ${res.status} ${res.statusText}`,
      );
    }

    const json = (await res.json()) as JSONRPCResponse;
    if (json.error) {
      throw new Error(
        `A2A sendTask RPC error (code=${json.error.code}): ${json.error.message}`,
      );
    }

    return json.result as A2ATaskResult;
  }

  /**
   * Send a task asynchronously via `tasks/send` and return the assigned task ID.
   */
  async sendTaskAsync(
    agentUrl: string,
    message: string,
    contextId?: string,
  ): Promise<string> {
    const id = this.nextId++;
    const body: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method: "tasks/send",
      params: {
        message: { role: "user", parts: [{ kind: "text", text: message }] },
        ...(contextId ? { contextId } : {}),
      },
    };

    const res = await fetch(agentUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(
        `A2A sendTaskAsync failed: ${res.status} ${res.statusText}`,
      );
    }

    const json = (await res.json()) as JSONRPCResponse;
    if (json.error) {
      throw new Error(
        `A2A sendTaskAsync RPC error (code=${json.error.code}): ${json.error.message}`,
      );
    }

    // A2A returns a task object in the result; extract the id.
    const result = json.result as { id?: string; taskId?: string; text?: string };
    const taskId = result.id ?? result.taskId;
    if (!taskId) {
      // Some agents (e.g. orchestrator) return `{text}` synchronously with no task ID.
      // Generate a synthetic ID for logging purposes.
      return `sync-${id}-${Date.now()}`;
    }
    return taskId;
  }

  /**
   * Discover an agent's capabilities by fetching its AgentCard from
   * /.well-known/agent-card.json.
   */
  async discover(
    agentUrl: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${agentUrl.replace(/\/$/, "")}/.well-known/agent-card.json`);
    if (!res.ok) {
      throw new Error(
        `A2A discover failed: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * Check whether an agent is reachable and healthy via a GET /health probe.
   */
  async healthCheck(agentUrl: string): Promise<boolean> {
    const res = await fetch(`${agentUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  }
}

export function createA2AClient(): A2AClient {
  return new A2AClient();
}
