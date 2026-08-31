/**
 * a2a-server-acl.test.ts — Tests for per-key ACL enforcement on A2AServer.
 *
 * Tests that the caller context flows through to onTask and that the
 * orchestrator enforces agent allowlists.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig, ResolvedCaller } from "@agents/types";
import { ApiKeyRegistry } from "@security/api-key-registry";

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

describe("A2AServer — ACL enforcement", () => {
	const servers: A2AServer[] = [];

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	test("caller context is passed to onTask handler", async () => {
		const port = 4400;
		let receivedCaller: ResolvedCaller | undefined;
		const registry = new ApiKeyRegistry([
			{
				key: "test-key",
				description: "test-caller",
				allowedAgents: ["jarvis"],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			{
				...makeConfig({
					port,
					async onTask(text, caller) {
						receivedCaller = caller;
						return "ok";
					},
				}),
				requireAuth: true,
			},
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": "test-key",
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
		expect(receivedCaller).toBeDefined();
		expect(receivedCaller!.description).toBe("test-caller");
		expect(receivedCaller!.allowedAgents).toEqual(["jarvis"]);
	});

	test("unauthenticated request has no caller context", async () => {
		const port = 4401;
		let receivedCaller: ResolvedCaller | undefined;
		const server = new A2AServer({
			...makeConfig({
				port,
				async onTask(text, caller) {
					receivedCaller = caller;
					return "ok";
				},
			}),
		});
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
		expect(receivedCaller).toBeUndefined();
	});
});
