/**
 * oauth-scope-enforcement.test.ts — Tests for per-method scope enforcement.
 *
 * Verifies that:
 *   - SendMessage requires a2a:write
 *   - SendStreamingMessage requires a2a:stream or a2a:write
 *   - GetTask requires a2a:read
 *   - CancelTask requires a2a:admin
 *   - X-API-Key callers bypass per-method scope checks (allowlist only)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig } from "@agents/types";
import { mintAccessToken } from "@security/jwt";
import { ApiKeyRegistry } from "../../src/security/api-key-registry";

const VALID_API_KEY = "test-api-key-abc123";

function makeConfig(overrides: Partial<A2AServerConfig> = {}): A2AServerConfig {
	return {
		port: 0, // Bun assigns a free port when 0
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

const VALID_BODY = (method: string) =>
	JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method,
		params:
			method === "SendMessage" || method === "SendStreamingMessage"
				? {
						message: {
							role: "user",
							parts: [{ kind: "text", text: "hello" }],
						},
					}
				: method === "GetTask" || method === "CancelTask"
					? { id: "some-task-id" }
					: {},
	});

describe("A2AServer — per-method scope enforcement (JWT)", () => {
	const servers: A2AServer[] = [];

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	beforeEach(() => {
		process.env.JABR_JWT_SECRET = "test-secret-key-at-least-16-chars-long";
	});

	test("SendMessage with a2a:write scope → 200", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const token = await mintAccessToken({
			subject: "test-user",
			scopes: ["a2a:write"],
			agents: [],
		});
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: VALID_BODY("SendMessage"),
		});
		expect(res.status).toBe(200);
	});

	test("SendMessage with only a2a:read scope → 403 (insufficient)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const token = await mintAccessToken({
			subject: "test-user",
			scopes: ["a2a:read"],
			agents: [],
		});
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: VALID_BODY("SendMessage"),
		});
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error.message).toContain("insufficient scope");
	});

	test("SendStreamingMessage with a2a:stream scope → 200", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({
				requireAuth: true,
				enableOAuth: true,
				onTaskStreaming: async (_text, _taskId, emit) => {
					emit({
						type: "status",
						taskId: "t1",
						state: "working",
						message: "ok",
						timestamp: new Date().toISOString(),
					});
					return "streamed";
				},
			} as any),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const token = await mintAccessToken({
			subject: "test-user",
			scopes: ["a2a:stream"],
			agents: [],
		});
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: VALID_BODY("SendStreamingMessage"),
		});
		expect(res.status).toBe(200);
	});

	test("CancelTask with a2a:admin scope → 200", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const token = await mintAccessToken({
			subject: "test-user",
			scopes: ["a2a:admin"],
			agents: [],
		});
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: VALID_BODY("CancelTask"),
		});
		expect(res.status).toBe(200);
	});

	test("CancelTask with a2a:read scope → 403", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const token = await mintAccessToken({
			subject: "test-user",
			scopes: ["a2a:read"],
			agents: [],
		});
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: VALID_BODY("CancelTask"),
		});
		expect(res.status).toBe(403);
	});

	test("X-API-Key caller bypasses per-method scope → 200", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": VALID_API_KEY,
			},
			body: VALID_BODY("SendMessage"),
		});
		expect(res.status).toBe(200);
	});

	test("JWT token with no scopes → 403 on SendMessage (per-method enforcement)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const token = await mintAccessToken({
			subject: "test-user",
			scopes: [],
			agents: [],
		});

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: VALID_BODY("SendMessage"),
		});
		// Token with no scopes passes initial auth but fails per-method scope check
		expect(res.status).toBe(403);
	});
});
