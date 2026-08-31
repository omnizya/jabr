/**
 * a2a-server-health.test.ts — Tests for /health, /ready, and graceful shutdown.
 *
 * Tests the health endpoints and the new graceful shutdown behavior:
 *  - /health returns 200 with agent info
 *  - /ready returns 200 when accepting traffic
 *  - /ready returns 503 when draining
 *  - shutdown() drains in-flight requests before stopping
 *  - New POSTs during shutdown receive 503
 *  - In-flight requests complete normally
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig } from "@agents/types";

function makeConfig(overrides: Partial<A2AServerConfig> = {}): A2AServerConfig {
	return {
		port: 0,
		card: {
			name: "test-agent",
			description: "Test",
			url: "http://localhost:0",
			version: "0.1.0",
			capabilities: {},
			skills: [],
		},
		onTask: async () => "ok",
		...overrides,
	};
}

const VALID_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "tasks/send",
	params: {
		message: { role: "user", parts: [{ kind: "text", text: "hello" }] },
	},
});

const VALID_STREAM_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 2,
	method: "tasks/sendSubscribe",
	params: {
		message: { role: "user", parts: [{ kind: "text", text: "hello" }] },
	},
});

describe("A2AServer — /health and /ready", () => {
	const servers: A2AServer[] = [];

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	test("/health returns 200 with agent info", async () => {
		const port = 4350;
		const server = new A2AServer(makeConfig({ port }));
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/health`);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.status).toBe("ok");
		expect(json.agent).toBe("test-agent");
		expect(json.version).toBe("0.1.0");
		expect(typeof json.uptimeMs).toBe("number");
	});

	test("/ready returns 200 when accepting traffic", async () => {
		const port = 4351;
		const server = new A2AServer(makeConfig({ port }));
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/ready`);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.status).toBe("ready");
		expect(json.inflightSync).toBe(0);
		expect(json.inflightStream).toBe(0);
	});

	test("/ready returns 503 when draining", async () => {
		const port = 4352;
		let resolveTask: () => void = () => {};

		const server = new A2AServer(
			makeConfig({
				port,
				onTask: () =>
					new Promise<string>((r) => {
						resolveTask = () => r("done");
					}),
			}),
		);
		server.start();
		servers.push(server);

		// Start a task so the server has in-flight work during shutdown
		const taskPromise = fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		// Wait for the task to start
		await new Promise((r) => setTimeout(r, 30));

		// Start shutdown (don't await so we can probe /ready mid-drain)
		const shutdownPromise = server.shutdown();

		// Probe /ready — should report not_ready while draining
		const res = await fetch(`http://localhost:${port}/ready`);
		expect(res.status).toBe(503);
		const json = await res.json();
		expect(json.status).toBe("not_ready");
		expect(json.reason).toBe("shutting_down");

		// Resolve the task to let shutdown complete
		resolveTask();
		await taskPromise;
		await shutdownPromise;
	});

	test("/health still returns 200 while draining (liveness)", async () => {
		const port = 4353;
		let resolveTask: () => void = () => {};

		// Slow server that takes 500ms to complete a task
		const slowServer = new A2AServer(
			makeConfig({
				port,
				drainTimeoutMs: 10000,
				onTask: () =>
					new Promise<string>((r) => {
						resolveTask = () => r("slow");
					}),
			}),
		);
		slowServer.start();
		servers.push(slowServer);

		// Start a slow task
		const taskPromise = fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		// Wait for the task to start
		await new Promise((r) => setTimeout(r, 50));

		// Start shutdown — drain timeout is 10s, task takes longer
		const shutdownPromise = slowServer.shutdown();

		// /health should still return 200 (liveness: process is alive)
		const res = await fetch(`http://localhost:${port}/health`);
		expect(res.status).toBe(200);
		expect((await res.json()).status).toBe("ok");

		// Resolve and cleanup
		resolveTask();
		await taskPromise;
		await shutdownPromise;
	});

	test("POST /tasks/send during shutdown receives 503", async () => {
		const port = 4355;
		let taskStarted = false;
		let taskDone = false;
		let resolveTask: () => void = () => {};

		const server = new A2AServer(
			makeConfig({
				port,
				onTask: () =>
					new Promise<string>((r) => {
						taskStarted = true;
						resolveTask = () => {
							taskDone = true;
							r("done");
						};
					}),
			}),
		);
		server.start();
		servers.push(server);

		// Start a task
		const taskPromise = fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		// Wait for the task to start
		await new Promise((r) => setTimeout(r, 50));
		expect(taskStarted).toBe(true);
		expect(server.isShuttingDown).toBe(false);

		// Start shutdown (not awaited)
		const shutdownPromise = server.shutdown();

		// Wait a tick for the shuttingDown flag to propagate
		await new Promise((r) => setTimeout(r, 10));
		expect(server.isShuttingDown).toBe(true);

		// POST during shutdown should get 503
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		const bodyText = await res.text();
		console.log(
			`[TEST] POST during shutdown status=${res.status} body=${bodyText} shuttingDown=${server.isShuttingDown} inflight=${server.inFlightCount}`,
		);
		expect(res.status).toBe(503);

		// Resolve the task and cleanup
		resolveTask();
		await taskPromise;
		await shutdownPromise;
	});
});

describe("A2AServer — graceful shutdown drain", () => {
	const servers: A2AServer[] = [];

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	test("shutdown waits for in-flight sync requests to complete", async () => {
		const port = 4360;
		let taskStarted = false;
		let taskDone = false;

		const server = new A2AServer(
			makeConfig({
				port,
				drainTimeoutMs: 5000,
				onTask: async () => {
					taskStarted = true;
					await new Promise((r) => setTimeout(r, 200));
					taskDone = true;
					return "completed";
				},
			}),
		);
		server.start();
		servers.push(server);

		// Fire a task — it will take 200ms
		const taskPromise = fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		// Wait for the task to start
		await new Promise((r) => setTimeout(r, 50));
		expect(taskStarted).toBe(true);

		// Start shutdown — should wait for the task to finish
		const shutdownPromise = server.shutdown();

		// The task should complete
		const res = await taskPromise;
		expect(res.status).toBe(200);
		expect(taskDone).toBe(true);

		await shutdownPromise;
	});

	test("shutdown waits for in-flight streaming requests to complete", async () => {
		const port = 4361;
		const events: string[] = [];

		const server = new A2AServer(
			makeConfig({
				port,
				drainTimeoutMs: 5000,
				onTaskStreaming: async (text, taskId, emit) => {
					emit({
						type: "status",
						taskId,
						state: "working",
						message: "Processing",
						timestamp: new Date().toISOString(),
					});
					await new Promise((r) => setTimeout(r, 150));
					emit({
						type: "status",
						taskId,
						state: "completed",
						message: "Done",
						timestamp: new Date().toISOString(),
					});
					return "streamed result";
				},
			}),
		);
		server.start();
		servers.push(server);

		// Start a streaming request
		const streamPromise = fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_STREAM_BODY,
		});

		// Let the stream start
		await new Promise((r) => setTimeout(r, 30));

		// Start shutdown
		const shutdownPromise = server.shutdown();

		// Consume the stream
		const res = await streamPromise;
		expect(res.status).toBe(200);
		const reader = res.body!.getReader();
		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(new TextDecoder().decode(value));
		}
		const streamText = chunks.join("");
		expect(streamText).toContain("TaskStatusUpdateEvent");
		expect(streamText).toContain("working");
		expect(streamText).toContain("completed");

		await shutdownPromise;
	});

	test("shutdown respects drainTimeoutMs", async () => {
		const port = 4362;
		let taskStarted = false;

		const server = new A2AServer(
			makeConfig({
				port,
				drainTimeoutMs: 100, // very short timeout
				onTask: async () => {
					taskStarted = true;
					// Task takes longer than drain timeout
					await new Promise((r) => setTimeout(r, 500));
					return "should not complete";
				},
			}),
		);
		server.start();
		servers.push(server);

		// Fire a slow task
		fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		}).catch(() => {}); // ignore — server will stop mid-request

		await new Promise((r) => setTimeout(r, 30));
		expect(taskStarted).toBe(true);

		const start = Date.now();
		await server.shutdown();
		const elapsed = Date.now() - start;

		// Should complete near the drain timeout (100ms), not wait for the full 500ms task
		expect(elapsed).toBeLessThan(400);
	});

	test("stop() force-stops immediately", async () => {
		const port = 4363;
		let taskDone = false;

		const server = new A2AServer(
			makeConfig({
				port,
				onTask: async () => {
					await new Promise((r) => setTimeout(r, 500));
					taskDone = true;
					return "done";
				},
			}),
		);
		server.start();
		servers.push(server);

		// Fire a slow task
		fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		}).catch(() => {});

		await new Promise((r) => setTimeout(r, 30));

		server.stop();
		// stop() is synchronous — server should be null immediately
		expect(server.inFlightCount).toBe(0);
	});

	test("inFlightCount tracks sync requests", async () => {
		const port = 4364;
		let resolveTask: () => void = () => {};

		const server = new A2AServer(
			makeConfig({
				port,
				onTask: () =>
					new Promise<string>((r) => {
						resolveTask = () => r("done");
					}),
			}),
		);
		server.start();
		servers.push(server);

		// No in-flight initially
		expect(server.inFlightCount).toBe(0);

		// Start a task
		const taskPromise = fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		// Should see 1 in-flight
		await new Promise((r) => setTimeout(r, 20));
		expect(server.inFlightCount).toBe(1);

		// Resolve the task
		resolveTask();
		await taskPromise;

		// Should be back to 0
		expect(server.inFlightCount).toBe(0);
	});

	test("isShuttingDown reflects drain state", async () => {
		const port = 4365;
		const server = new A2AServer(makeConfig({ port }));
		server.start();
		servers.push(server);

		expect(server.isShuttingDown).toBe(false);

		const shutdownPromise = server.shutdown();
		expect(server.isShuttingDown).toBe(true);

		await shutdownPromise;
	});

	test("double shutdown waits for first to complete", async () => {
		const port = 4366;
		const server = new A2AServer(makeConfig({ port }));
		server.start();
		servers.push(server);

		const p1 = server.shutdown();
		const p2 = server.shutdown();

		await Promise.all([p1, p2]);
		// Both should resolve without hanging
	});
});
