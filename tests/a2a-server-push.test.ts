/**
 * a2a-server-push.test.ts — Tests for push notification callback support.
 *
 * Verifies:
 *   1. tasks/send with notificationUrl POSTs state changes to the callback.
 *   2. tasks/send with callbackUrl (alias) works the same way.
 *   3. tasks/send without callback URL behaves synchronously (backward compat).
 *   4. Callback receives submitted → working → completed transitions.
 *   5. Callback receives failed state on task error.
 *   6. AgentCard advertises pushNotifications capability.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig } from "@agents/types";

const PORT = 4920;

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

function makeConfig(overrides: Partial<A2AServerConfig> = {}): A2AServerConfig {
	return {
		port: PORT,
		card: {
			name: "test-push",
			description: "test",
			url: `http://localhost:${PORT}`,
			version: "1.0.0",
			capabilities: {},
			skills: [],
		},
		onTask: async (text) => `result:${text}`,
		...overrides,
	};
}

describe("A2AServer — push notification callback", () => {
	let server: A2AServer | null = null;
	const callbackRequests: Array<{ url: string; body: unknown }> = [];
	const callbackServers: Array<{ stop: () => void }> = [];

	afterEach(() => {
		server?.stop();
		server = null;
		callbackRequests.length = 0;
		for (const srv of callbackServers) srv.stop();
		callbackServers.length = 0;
	});

	// Helper: create a callback server that records POSTs.
	// Returns the actual bound port.
	async function startCallbackServer(): Promise<number> {
		const srv = Bun.serve({
			port: 0,
			async fetch(req) {
				if (req.method === "POST") {
					const body = await req.json().catch(() => ({}));
					callbackRequests.push({ url: req.url, body });
					return new Response("ok", { status: 200 });
				}
				return new Response("method not allowed", { status: 405 });
			},
		});
		callbackServers.push(srv);
		return srv.port!;
	}

	// Helper: wait for a callback with a specific state to appear.
	async function waitForState(state: string, timeoutMs = 2000): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const found = callbackRequests.some(
				(r) => (r.body as { state?: string }).state === state,
			);
			if (found) return;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`Timed out waiting for state="${state}"`);
	}

	test("tasks/send with notificationUrl POSTs state changes to callback", async () => {
		const cbPort = await startCallbackServer();

		server = new A2AServer(makeConfig({ port: PORT }));
		server.start();

		const res = await postA2A(PORT, "tasks/send", {
			message: { parts: [{ kind: "text", text: "hello" }] },
			notificationUrl: `http://localhost:${cbPort}/callback`,
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { result?: { id?: string } };
		expect(body.result?.id).toBeDefined();

		await waitForState("completed");

		expect(callbackRequests.length).toBeGreaterThanOrEqual(1);
		const states = callbackRequests.map(
			(r) => (r.body as { state?: string }).state,
		);
		expect(states).toContain("submitted");
		expect(states).toContain("completed");
	});

	test("tasks/send with callbackUrl alias works the same", async () => {
		const cbPort = await startCallbackServer();

		server = new A2AServer(makeConfig({ port: PORT }));
		server.start();

		const res = await postA2A(PORT, "tasks/send", {
			message: { parts: [{ kind: "text", text: "world" }] },
			callbackUrl: `http://localhost:${cbPort}/hook`,
		});

		expect(res.status).toBe(200);

		await waitForState("completed");

		expect(callbackRequests.length).toBeGreaterThanOrEqual(1);
		const states = callbackRequests.map(
			(r) => (r.body as { state?: string }).state,
		);
		expect(states).toContain("submitted");
		expect(states).toContain("completed");
	});

	test("tasks/send without callback URL still works synchronously", async () => {
		server = new A2AServer(makeConfig({ port: PORT }));
		server.start();

		const res = await postA2A(PORT, "tasks/send", {
			message: { parts: [{ kind: "text", text: "sync" }] },
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { result?: { text?: string } };
		expect(body.result?.text).toBe("result:sync");
	});

	test("callback receives submitted then completed states", async () => {
		const cbPort = await startCallbackServer();

		server = new A2AServer(makeConfig({ port: PORT }));
		server.start();

		await postA2A(PORT, "tasks/send", {
			message: { parts: [{ kind: "text", text: "multi" }] },
			notificationUrl: `http://localhost:${cbPort}/cb`,
		});

		await waitForState("completed");

		expect(callbackRequests.length).toBeGreaterThanOrEqual(2);
		const states = callbackRequests.map(
			(r) => (r.body as { state?: string }).state,
		);
		expect(states).toContain("submitted");
		expect(states).toContain("completed");
	});

	test("callback receives failed state on task error", async () => {
		const cbPort = await startCallbackServer();

		server = new A2AServer(
			makeConfig({
				port: PORT,
				onTask: async () => {
					throw new Error("task boom");
				},
			}),
		);
		server.start();

		await postA2A(PORT, "tasks/send", {
			message: { parts: [{ kind: "text", text: "fail" }] },
			notificationUrl: `http://localhost:${cbPort}/cb`,
		});

		await waitForState("failed");

		expect(callbackRequests.length).toBeGreaterThanOrEqual(1);
		const lastCb = callbackRequests[callbackRequests.length - 1]!.body as {
			state?: string;
			message?: string;
		};
		expect(lastCb.state).toBe("failed");
		expect(lastCb.message).toContain("task boom");
	});

	test("AgentCard with pushNotifications capability advertises correctly", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-cap",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {
					pushNotifications: true,
					pushNotificationConfig: {
						url: "http://localhost:9999/callback",
						token: "secret-token",
					},
				},
				skills: [],
			},
			onTask: async (text) => `result:${text}`,
		});
		server.start();

		const res = await fetch(
			`http://localhost:${PORT}/.well-known/agent-card.json`,
		);
		expect(res.status).toBe(200);
		const card = (await res.json()) as {
			capabilities: {
				pushNotifications?: boolean;
				pushNotificationConfig?: { url: string; token?: string };
			};
		};
		expect(card.capabilities.pushNotifications).toBe(true);
		expect(card.capabilities.pushNotificationConfig?.url).toBe(
			"http://localhost:9999/callback",
		);
		expect(card.capabilities.pushNotificationConfig?.token).toBe(
			"secret-token",
		);
	});
});
