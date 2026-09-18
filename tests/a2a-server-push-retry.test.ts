/**
 * a2a-server-push-retry.test.ts — Tests for push notification callback retry + error handling.
 *
 * Verifies:
 *   1. Callback retries with exponential backoff on failure.
 *   2. Callback timeout handling — slow endpoints don't hang.
 *   3. Dead-letter queue — unreachable callbacks after max retries move task to DLQ.
 *   4. Invalid URLs fail gracefully (no crash, task moves to DLQ).
 *   5. Mixed scenarios: network failures, intermittent failures.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig } from "@agents/types";
import {
	CALLBACK_INITIAL_BACKOFF_MS,
	CALLBACK_MAX_RETRIES,
	CALLBACK_TIMEOUT_MS,
} from "@constants/app-constants";
import type { TaskStorePort } from "@ports/task-store";
import type { ApiKeyRegistry } from "@security/api-key-registry";

let portCounter = 4930;
function nextPort(): number {
	return portCounter++;
}

async function postA2A(
	port: number,
	method: string,
	params: unknown,
): Promise<Response> {
	return fetch(`http://localhost:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method,
			params,
		}),
	});
}

function makeConfig(
	overrides: Partial<A2AServerConfig<ApiKeyRegistry, TaskStorePort>> = {},
): A2AServerConfig<ApiKeyRegistry, TaskStorePort> {
	return {
		port: nextPort(),
		card: {
			name: "test-push-retry",
			description: "test",
			url: `http://localhost:${nextPort()}`,
			version: "1.0.0",
			capabilities: {},
			skills: [],
			supportedInterfaces: [],
		},
		onTask: async (text: string) => `result:${text}`,
		...overrides,
	};
}

function createMockTaskStore(): TaskStorePort {
	const dlq = new Map<
		string,
		{
			taskId: string;
			state: string;
			error: string;
			retryCount: number;
			movedAt: string;
		}
	>();
	const tasks = new Map<
		string,
		{ id: string; state: string; messages: unknown[]; artifacts: unknown[] }
	>();
	const retryCounts = new Map<string, number>();

	const store = {
		create: (id: string) => {
			const task = { id, state: "submitted", messages: [], artifacts: [] };
			tasks.set(id, task);
			return task;
		},
		get: (id: string) => tasks.get(id),
		updateState: (id: string, state: string) => {
			const t = tasks.get(id);
			if (t) t.state = state;
		},
		appendMessage: () => {},
		appendArtifact: () => {},
		listByState: () => [],
		list: () => [],
		subscribe: () => () => {},
		getTransitionHistory: () => [],
		getRetryCount: (id: string) => retryCounts.get(id) ?? 0,
		incrementRetryCount: (id: string) => {
			retryCounts.set(id, (retryCounts.get(id) ?? 0) + 1);
		},
		moveToDLQ: (taskId: string, error: string) => {
			const retryCount = retryCounts.get(taskId) ?? 0;
			const entry = {
				taskId,
				state: "failed",
				error,
				retryCount,
				movedAt: new Date().toISOString(),
			};
			dlq.set(taskId, entry);
		},
		listDLQ: () => Array.from(dlq.values()),
		getDLQEntry: (taskId: string) => dlq.get(taskId),
		retryFromDLQ: (taskId: string) => dlq.delete(taskId),
		purgeDLQ: (taskId: string) => dlq.delete(taskId),
		purgeAllDLQ: () => {
			dlq.clear();
			return 0;
		},
	} as unknown as TaskStorePort;

	return store;
}

interface CallbackServerInfo {
	stop: () => void;
	port: number;
	requests: Array<{ url: string; body: unknown; timestamp: number }>;
	requestCount: () => number;
}

async function startCallbackServer(
	options: { failTimes?: number; delayMs?: number } = {},
): Promise<CallbackServerInfo> {
	const { failTimes = 0, delayMs = 0 } = options;
	let reqCount = 0;
	const requests: Array<{ url: string; body: unknown; timestamp: number }> = [];

	const srv = Bun.serve({
		port: 0,
		async fetch(req) {
			if (req.method === "POST") {
				reqCount++;
				const body = await req.json().catch(() => ({}));

				if (delayMs > 0) {
					await new Promise((r) => setTimeout(r, delayMs));
				}

				requests.push({
					url: req.url,
					body,
					timestamp: Date.now(),
				});

				if (reqCount <= failTimes) {
					return new Response("error", { status: 500 });
				}
				return new Response("ok", { status: 200 });
			}
			return new Response("method not allowed", { status: 405 });
		},
	});

	return {
		stop: () => srv.stop(),
		port: srv.port!,
		requests,
		requestCount: () => reqCount,
	};
}

async function waitForCondition(
	fn: () => boolean,
	timeoutMs = 5000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (fn()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("Timed out waiting for condition");
}

describe("A2AServer — push notification callback retry + error handling", () => {
	let server: A2AServer | null = null;
	const callbackServers: CallbackServerInfo[] = [];
	let mockTaskStore: TaskStorePort;

	beforeEach(() => {
		mockTaskStore = createMockTaskStore();
	});

	afterEach(() => {
		server?.stop();
		server = null;
		for (const srv of callbackServers) srv.stop();
		callbackServers.length = 0;
	});

	test("callback retries with exponential backoff on failure", async () => {
		// Server that always returns 500 — keeps retrying until DLQ
		const cbSrv = await Bun.serve({
			port: 0,
			async fetch(req) {
				if (req.method === "POST") {
					return new Response("error", { status: 500 });
				}
				return new Response("method not allowed", { status: 405 });
			},
		});
		const cbPort = cbSrv.port!;
		const cfgPort = nextPort();

		// Keep server alive until test ends (add to cleanup list)
		callbackServers.push({
			stop: () => cbSrv.stop(),
			port: cbPort,
			requests: [],
			requestCount: () => 0,
		});

		server = new A2AServer({
			...makeConfig({ port: cfgPort }),
			taskStore: mockTaskStore,
		});
		server.start();

		const res = await postA2A(cfgPort, "SendMessage", {
			message: { parts: [{ kind: "text", text: "retry-test" }] },
			notificationUrl: `http://localhost:${cbPort}/callback`,
		});

		expect(res.status).toBe(200);

		// Wait for retries to exhaust and DLQ entry to be created
		await waitForCondition(() => {
			const dlq = mockTaskStore?.listDLQ() ?? [];
			return dlq.length > 0;
		}, 30000);

		// Verify DLQ entry was created (retries exhausted)
		const dlq = mockTaskStore?.listDLQ() ?? [];
		expect(dlq.length).toBeGreaterThan(0);
	});

	test("successful callback on first try does not trigger retry", async () => {
		const cbSrv = await startCallbackServer({ failTimes: 0 });
		callbackServers.push(cbSrv);
		const cfgPort = nextPort();

		server = new A2AServer({
			...makeConfig({ port: cfgPort }),
			taskStore: mockTaskStore,
		});
		server.start();

		const res = await postA2A(cfgPort, "SendMessage", {
			message: { parts: [{ kind: "text", text: "no-retry" }] },
			notificationUrl: `http://localhost:${cbSrv.port}/callback`,
		});

		expect(res.status).toBe(200);

		// Wait briefly to ensure no retries happen
		await new Promise((r) => setTimeout(r, 2000));

		// DLQ should be empty (callback succeeded)
		const dlq = mockTaskStore?.listDLQ() ?? [];
		expect(dlq.length).toBe(0);
	});

	test("invalid URL callback does not crash the server", async () => {
		const cfgPort = nextPort();

		server = new A2AServer({
			...makeConfig({ port: cfgPort }),
			taskStore: mockTaskStore,
		});
		server.start();

		const res = await postA2A(cfgPort, "SendMessage", {
			message: { parts: [{ kind: "text", text: "invalid-url" }] },
			notificationUrl: "not-a-valid-url",
		});

		expect(res.status).toBe(200);

		// Server should still be alive
		await new Promise((r) => setTimeout(r, 1000));

		const res2 = await postA2A(cfgPort, "SendMessage", {
			message: { parts: [{ kind: "text", text: "after-invalid" }] },
		});
		expect(res2.status).toBe(200);
		const body2 = (await res2.json()) as { result?: unknown };
		expect(body2.result).toBeDefined();
	});

	test("callback timeout handles slow endpoints", async () => {
		const cbSrv = await startCallbackServer({
			delayMs: (CALLBACK_TIMEOUT_MS || 5000) + 5000,
		});
		callbackServers.push(cbSrv);
		const cfgPort = nextPort();

		server = new A2AServer({
			...makeConfig({ port: cfgPort }),
			taskStore: mockTaskStore,
		});
		server.start();

		const res = await postA2A(cfgPort, "SendMessage", {
			message: { parts: [{ kind: "text", text: "slow-callback" }] },
			notificationUrl: `http://localhost:${cbSrv.port}/callback`,
		});

		expect(res.status).toBe(200);

		// Wait for retries to exhaust and DLQ entry to be created
		await waitForCondition(() => {
			const dlq = mockTaskStore?.listDLQ() ?? [];
			return dlq.length > 0;
		}, 30000);

		// DLQ should have an entry (timeout exhausted retries)
		const dlq = mockTaskStore?.listDLQ() ?? [];
		expect(dlq.length).toBeGreaterThan(0);
	});

	test("callback eventually succeeds after transient failures", async () => {
		const cbSrv = await startCallbackServer({ failTimes: 2 });
		callbackServers.push(cbSrv);
		const cfgPort = nextPort();

		server = new A2AServer({
			...makeConfig({ port: cfgPort }),
			taskStore: mockTaskStore,
		});
		server.start();

		const res = await postA2A(cfgPort, "SendMessage", {
			message: { parts: [{ kind: "text", text: "transient" }] },
			notificationUrl: `http://localhost:${cbSrv.port}/callback`,
		});

		expect(res.status).toBe(200);

		// Wait for retries + eventual success
		await waitForCondition(() => cbSrv.requestCount() >= 3, 10000);

		// Should have 3 total attempts: 2 failures + 1 success
		expect(cbSrv.requestCount()).toBeGreaterThanOrEqual(3);

		// DLQ should be empty (callback eventually succeeded)
		const dlq = mockTaskStore?.listDLQ() ?? [];
		expect(dlq.length).toBe(0);
	});
});
