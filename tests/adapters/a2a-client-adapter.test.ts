/**
 * a2a-client-adapter.test.ts — Unit tests for A2AClient adapter.
 *
 * Strategy: a smart global fetch mock that responds to agent-card discovery,
 * health checks, and SendMessage JSON-RPC calls without touching the network.
 */

import { describe, expect, test } from "bun:test";
import {
	V1_METHOD_SEND_MESSAGE,
	WELL_KNOWN_AGENT_CARD_JSON,
	WELL_KNOWN_AGENT_JSON,
} from "../../src/constants/a2a-v1.ts";
import { JABR_PORTS } from "../../src/constants/ecosystem.ts";
import { createTestEnv, overrideFetch } from "../../src/utils/test-helpers.ts";

describe("A2AClient", () => {
	const ENDPOINT = `http://localhost:${JABR_PORTS.orchestrator}`;
	test("sendTask returns the JSON-RPC result", async () => {
		const { client, restore } = createTestEnv();
		try {
			const result = await client.sendTask(ENDPOINT, "ping");
			expect(result).toEqual({ text: "pong" });
		} finally {
			restore();
		}
	});

	test("sendTask sends a valid JSON-RPC 2.0 envelope with SendMessage", async () => {
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
				params: {
					message: {
						role: string;
						messageId: string;
						parts: Array<{ text: string }>;
					};
				};
			};
			expect(body.jsonrpc).toBe("2.0");
			expect(body.method).toBe(V1_METHOD_SEND_MESSAGE);
			expect(body.params.message.role).toBe("user");
			expect(body.params.message.parts[0]!.text).toBe("hello");
			expect(body.params.message.messageId).toBeDefined();
		} finally {
			restore();
		}
	});

	test("sendTask includes contextId when provided", async () => {
		const { client, fetchCalls, restore } = createTestEnv();
		try {
			await client.sendTask(ENDPOINT, "hi", "ctx-456");
			const post = fetchCalls.find((c) => c.method === "POST");
			const body = post!.body as {
				params: { message: { contextId?: string } };
			};
			expect(body.params.message.contextId).toBe("ctx-456");
		} finally {
			restore();
		}
	});

	test("sendTask omits contextId when not provided", async () => {
		const { client, fetchCalls, restore } = createTestEnv();
		try {
			await client.sendTask(ENDPOINT, "hi");
			const post = fetchCalls.find((c) => c.method === "POST");
			const body = post!.body as {
				params: { message: { contextId?: string } };
			};
			expect(body.params.message.contextId).toBeUndefined();
		} finally {
			restore();
		}
	});

	test("sendTask throws on non-200 response", async () => {
		const { client, restore } = createTestEnv();
		const restoreFetch = overrideFetch(
			() => new Response("Bad Request", { status: 400 }),
		);
		try {
			await expect(client.sendTask(ENDPOINT, "hi")).rejects.toThrow(
				/A2A sendTask failed: 400/,
			);
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
			await expect(client.sendTask(ENDPOINT, "hi")).rejects.toThrow(
				/RPC error \(code=-32600\): Invalid Request/,
			);
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
				result: {
					task: { taskId: "task-abc", status: { state: "completed" } },
				},
			}),
		);
		try {
			const taskId = await client.sendTaskAsync(ENDPOINT, "hi");
			expect(taskId).toBe("task-abc");
		} finally {
			restoreFetch();
			restore();
		}
	});

	test("sendTaskAsync throws on non-200 response", async () => {
		const { client, restore } = createTestEnv();
		const restoreFetch = overrideFetch(
			() => new Response("Server error", { status: 500 }),
		);
		try {
			await expect(client.sendTaskAsync(ENDPOINT, "hi")).rejects.toThrow(
				/A2A sendTaskAsync failed: 500/,
			);
		} finally {
			restoreFetch();
			restore();
		}
	});

	test("discover fetches the agent card from /.well-known/agent.json (v1.0)", async () => {
		const { client, fetchCalls, restore } = createTestEnv();
		try {
			const card = await client.discover(ENDPOINT);
			expect(card).toEqual({
				name: "test-agent",
				version: "1.0.0",
				capabilities: { taskRouting: true },
			});
			const getCall = fetchCalls.find(
				(c) => c.method === "GET" && c.url.includes(WELL_KNOWN_AGENT_JSON),
			);
			expect(getCall).toBeDefined();
		} finally {
			restore();
		}
	});

	test("discover falls back to legacy path when v1.0 path fails", async () => {
		const originalFetch = globalThis.fetch;
		const fetchCalls: Array<{ url: string; method: string }> = [];

		globalThis.fetch = (async (
			url: string | Request | URL,
			opts?: RequestInit,
		) => {
			const u = url.toString();
			fetchCalls.push({ url: u, method: opts?.method ?? "GET" });

			if (u.includes(WELL_KNOWN_AGENT_JSON)) {
				return new Response("Not found", { status: 404 });
			}
			if (u.includes(WELL_KNOWN_AGENT_CARD_JSON)) {
				return Response.json({
					name: "test-agent",
					version: "1.0.0",
					capabilities: { taskRouting: true },
				});
			}
			return new Response("Not found", { status: 404 });
		}) as typeof fetch;

		try {
			const client = new (
				await import("@adapters/http/a2a-client-adapter")
			).A2AClient();
			const card = await client.discover(ENDPOINT);
			expect(card).toEqual({
				name: "test-agent",
				version: "1.0.0",
				capabilities: { taskRouting: true },
			});
			const v1Call = fetchCalls.find((c) =>
				c.url.includes(WELL_KNOWN_AGENT_JSON),
			);
			const legacyCall = fetchCalls.find((c) =>
				c.url.includes(WELL_KNOWN_AGENT_CARD_JSON),
			);
			expect(v1Call).toBeDefined();
			expect(legacyCall).toBeDefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("discover throws on non-200", async () => {
		const { client, restore } = createTestEnv();
		const restoreFetch = overrideFetch(
			() => new Response("down", { status: 503 }),
		);
		try {
			await expect(client.discover(ENDPOINT)).rejects.toThrow(
				/A2A discover failed: 503/,
			);
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
		const restoreFetch = overrideFetch(
			() => new Response("down", { status: 503 }),
		);
		try {
			const ok = await client.healthCheck("http://localhost:4000");
			expect(ok).toBe(false);
		} finally {
			restoreFetch();
			restore();
		}
	});
});
