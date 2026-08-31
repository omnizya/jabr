/**
 * a2a-server-auth.test.ts — Tests for the X-API-Key auth middleware on A2AServer.
 *
 * Each test starts a real Bun.serve on a unique port and exercises the
 * auth paths directly. Tests run in parallel-safe isolation.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig } from "@agents/types";
import { ApiKeyRegistry } from "@security/api-key-registry";

const VALID_TOKEN = "test-secret-token-abc123";

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

const VALID_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "tasks/send",
	params: {
		message: { role: "user", parts: [{ kind: "text", text: "hello" }] },
	},
});

describe("A2AServer — X-API-Key auth middleware", () => {
	const servers: A2AServer[] = [];

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	// ── Disabled auth: requests pass through ─────────────────────────────────

	test("requireAuth=false: POST without X-API-Key → 200", async () => {
		const port = 4300;
		const server = new A2AServer(makeConfig({ port }));
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
	});

	// ── Enabled auth: missing key → 401 ──────────────────────────────────────

	test("requireAuth=true + valid token: missing X-API-Key → 401", async () => {
		const port = 4301;
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe(-32000);
		expect(json.error.message).toContain("Unauthorized");
	});

	// ── Enabled auth: wrong key → 403 ────────────────────────────────────────

	test("requireAuth=true + valid token: wrong X-API-Key → 403", async () => {
		const port = 4302;
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
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
				"X-API-Key": "wrong-key",
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error.code).toBe(-32001);
		expect(json.error.message).toContain("Forbidden");
	});

	// ── Enabled auth: correct key → 200 ──────────────────────────────────────

	test("requireAuth=true + valid token: correct X-API-Key → 200", async () => {
		const port = 4303;
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
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
				"X-API-Key": VALID_TOKEN,
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
	});

	// ── Fail-closed: requireAuth=true but no registry configured ─────────────

	test("requireAuth=true but no registry: POST → 500 (fail closed)", async () => {
		const port = 4304;
		const server = new A2AServer(makeConfig({ port, requireAuth: true }));
		server.start();
		servers.push(server);

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(500);
		const json = await res.json();
		expect(json.error.message).toContain("auth not configured");
	});

	// ── Constant-time comparison: different length keys → 403 (not 401) ───────

	test("requireAuth=true: short key (length mismatch) → 403, not 401", async () => {
		const port = 4305;
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
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
				"X-API-Key": "x",
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(403);
	});

	// ── CORS headers preserved on 401 ────────────────────────────────────────

	test("401 response includes CORS headers when Origin is allowed", async () => {
		const port = 4306;
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
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
				Origin: "http://localhost:5173", // in DEFAULT_ALLOWED_ORIGINS
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(401);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5173",
		);
	});

	// ── Auth does not affect GET /.well-known/agent-card.json ────────────────

	test("GET /.well-known/agent-card.json is always accessible (no auth required)", async () => {
		const port = 4307;
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);

		const res = await fetch(
			`http://localhost:${port}/.well-known/agent-card.json`,
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.name).toBe("test-agent");
	});

	// ── Rate limiting happens BEFORE auth ────────────────────────────────────

	test("rate-limited requests get 429 regardless of auth header", async () => {
		const port = 4308;
		// Configure a very tight rate limit (1 request per 60s window)
		const { RateLimiter } = await import("@adapters/rate-limit");
		const rateLimiter = new RateLimiter({
			windowMs: 60_000,
			maxRequests: 1,
		});
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ port, requireAuth: true }),
			rateLimiter,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);

		// First request — correct key, gets 200. Rate limiter records this under
		// caller key "key:<VALID_TOKEN>".
		const res1 = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": VALID_TOKEN,
			},
			body: VALID_BODY,
		});
		expect(res1.status).toBe(200);

		// Second request — same key, rate limit hit, gets 429 BEFORE auth.
		const res2 = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": VALID_TOKEN,
			},
			body: VALID_BODY,
		});
		expect(res2.status).toBe(429);
	});
});
