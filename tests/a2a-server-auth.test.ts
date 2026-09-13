/**
 * a2a-server-auth.test.ts — Tests for the X-API-Key auth middleware on A2AServer.
 *
 * Each test uses a unique auto-assigned port to avoid conflicts during parallel runs.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import { RateLimiter } from "@adapters/rate-limit";
import type { A2AServerConfig } from "@agents/types";
import { ApiKeyRegistry } from "../src/security/api-key-registry";

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
		const server = new A2AServer(makeConfig());
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
	});

	// ── Enabled auth: missing key → 401 ──────────────────────────────────────

	test("requireAuth=true + valid token: missing X-API-Key → 401", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(401);
	});

	// ── Enabled auth: wrong key → 403 ────────────────────────────────────────

	test("requireAuth=true + valid token: wrong X-API-Key → 403", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-API-Key": "wrong-key" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(403);
	});

	// ── Enabled auth: correct key → 200 ───────────────────────────────────────

	test("requireAuth=true + valid token: correct X-API-Key → 200", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-API-Key": VALID_TOKEN },
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
	});

	// ── Fail-closed: no registry → 500 ───────────────────────────────────────

	test("requireAuth=true but no registry: POST → 500 (fail closed)", async () => {
		const server = new A2AServer(makeConfig({ requireAuth: true }));
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(500);
	});

	// ── Short key (length mismatch) → 403 ────────────────────────────────────

	test("requireAuth=true: short key (length mismatch) → 403, not 401", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-API-Key": "x" },
			body: VALID_BODY,
		});
		expect(res.status).toBe(403);
	});

	// ── CORS headers in 401 ──────────────────────────────────────────────────

	test("401 response includes CORS headers when Origin is allowed", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
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
				Origin: "http://localhost:4000",
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(401);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:4000",
		);
	});

	// ── Agent card accessible without auth ───────────────────────────────────

	test("GET /.well-known/agent-card.json is always accessible (no auth required)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(
			`http://localhost:${port}/.well-known/agent-card.json`,
		);
		expect(res.status).toBe(200);
		const card = await res.json();
		expect(card.name).toBe("test-agent");
	});

	// ── Rate limiting bypasses auth ──────────────────────────────────────────

	test("rate-limited requests get 429 regardless of auth header", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		// Rate limit: 1 request per 60s. Fixed caller resolver so both requests
		// share one bucket — the second must trip 429 BEFORE auth runs (proving
		// rate-limit ordering: 429 preempts what would otherwise be a 401).
		const rateLimiter = new RateLimiter({
			maxRequests: 1,
			windowMs: 60_000,
			resolveCaller: () => "test-caller",
		});
		const server = new A2AServer(
			makeConfig({ requireAuth: true }),
			rateLimiter,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		// First request with valid key
		await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-API-Key": VALID_TOKEN },
			body: VALID_BODY,
		});

		// Second request should be rate-limited (429)
		const res2 = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});
		expect(res2.status).toBe(429);
	});
});
