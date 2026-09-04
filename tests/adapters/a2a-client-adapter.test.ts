/**
 * a2a-client-adapter.test.ts — Unit tests for A2AClient adapter.
 *
 * Strategy: a smart global fetch mock that responds to agent-card discovery,
 * health checks, and tasks/send JSON-RPC calls without touching the network.
 */

import { describe, expect, test } from "bun:test";
import  {createTestEnv} from "../../src/utils/test-helpers.ts"
import {JABR_PORTS} from "../../src/constants/ecosystem.ts"

describe("A2AClient", () => {
  const ENDPOINT = `http://localhost:${JABR_PORTS.orchestrator}`;
  test("sendTask returns the JSON-RPC result", async () => {
    const { client, restore } = createTestEnv();
    try {
      // GET FROM constants
      const result = await client.sendTask(ENDPOINT,"ping");
      expect(result).toEqual({ text: "pong" });
    } finally {
      restore();
    }
  });

  test("sendTask sends a valid JSON-RPC 2.0 envelope", async () => {
    const { client, fetchCalls, restore } = createTestEnv();
    try {
      await client.sendTask(ENDPOINT, "hello", "ctx-123");
      const post = fetchCalls.find((c) => c.method === "POST");
      expect(post).toBeDefined();
      expect(post!.headers["Content-Type"]).toBe("application/json");
      const body = post!.body as {
        jsonrpc: string;
        id: number;
        method: string;
        params: { message: { role: string; parts: Array<{ kind: string; text: string }> } };
      };
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("tasks/send");
      expect(body.params.message.role).toBe("user");
      expect(body.params.message.parts[0]!.kind).toBe("text");
      expect(body.params.message.parts[0]!.text).toBe("hello");
    } finally {
      restore();
    }
  });

  test("sendTask includes contextId when provided", async () => {
    const { client, fetchCalls, restore } = createTestEnv();
    try {
      await client.sendTask(ENDPOINT, "hi", "ctx-456");
      const post = fetchCalls.find((c) => c.method === "POST");
      const body = post!.body as { params: { contextId?: string } };
      expect(body.params.contextId).toBe("ctx-456");
    } finally {
      restore();
    }
  });

  test("sendTask omits contextId when not provided", async () => {
    const { client, fetchCalls, restore } = createTestEnv();
    try {
      await client.sendTask(ENDPOINT, "hi");
      const post = fetchCalls.find((c) => c.method === "POST");
      const body = post!.body as { params: { contextId?: string } };
      expect(body.params.contextId).toBeUndefined();
    } finally {
      restore();
    }
  });

  test("sendTask throws on non-200 response", async () => {
    const { client, restore } = createTestEnv();
    const restoreFetch = overrideFetch(() => new Response("Bad Request", { status: 400 }));
    try {
      await expect(
        client.sendTask(ENDPOINT, "hi"),
      ).rejects.toThrow(/A2A sendTask failed: 400/);
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("sendTask throws on JSON-RPC error response", async () => {
    const { client, restore } = createTestEnv();
    const restoreFetch = overrideFetch(() =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid Request" },
      }),
    );
    try {
      await expect(
        client.sendTask(ENDPOINT, "hi"),
      ).rejects.toThrow(/RPC error \(code=-32600\): Invalid Request/);
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("sendTaskAsync returns the task id", async () => {
    const { client, restore } = createTestEnv();
    const restoreFetch = overrideFetch(() =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { id: "task-abc" },
      }),
    );
    try {
      const taskId = await client.sendTaskAsync(
        ENDPOINT,
        "hi",
      );
      expect(taskId).toBe("task-abc");
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("sendTaskAsync throws on non-200 response", async () => {
    const { client, restore } = createTestEnv();
    const restoreFetch = overrideFetch(() => new Response("Server error", { status: 500 }));
    try {
      await expect(
        client.sendTaskAsync(ENDPOINT, "hi"),
      ).rejects.toThrow(/A2A sendTaskAsync failed: 500/);
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("discover fetches the agent card from /.well-known/agent-card.json", async () => {
    const { client, fetchCalls, restore } = createTestEnv();
    try {
      const card = await client.discover(ENDPOINT);
      expect(card).toEqual({
        name: "test-agent",
        version: "1.0.0",
        capabilities: { taskRouting: true },
      });
      const getCall = fetchCalls.find(
        (c) => c.method === "GET" && c.url.includes("/.well-known/agent-card.json"),
      );
      expect(getCall).toBeDefined();
    } finally {
      restore();
    }
  });

  test("discover throws on non-200", async () => {
    const { client, restore } = createTestEnv();
    const restoreFetch = overrideFetch(() => new Response("down", { status: 503 }));
    try {
      await expect(
        client.discover(ENDPOINT),
      ).rejects.toThrow(/A2A discover failed: 503/);
    } finally {
      restoreFetch();
      restore();
    }
  });

  test("healthCheck returns true on 200", async () => {
    const { client, restore } = createTestEnv();
    try {
      const ok = await client.healthCheck("http://localhost:4000");
      expect(ok).toBe(true);
    } finally {
      restore();
    }
  });

  test("healthCheck returns false on non-200", async () => {
    const { client, restore } = createTestEnv();
    const restoreFetch = overrideFetch(() => new Response("down", { status: 503 }));
    try {
      const ok = await client.healthCheck("http://localhost:4000");
      expect(ok).toBe(false);
    } finally {
      restoreFetch();
      restore();
    }
  });
});
