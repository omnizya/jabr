/**
 * oauth-server.test.ts — Integration tests for OAuth 2.1 token/revoke endpoints.
 *
 * Tests the full OAuth server integration within A2AServer: client_credentials
 * grant (API key → JWT), refresh_token grant (rotation), revocation, metadata,
 * and replay detection.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { A2AServerConfig } from "@agents/types";
import { ApiKeyRegistry } from "../../src/security/api-key-registry";

const VALID_API_KEY = "test-api-key-abc123";
const VALID_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "SendMessage",
	params: {
		message: { role: "user", parts: [{ kind: "text", text: "hello" }] },
	},
});

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

describe("A2AServer — OAuth 2.1 token endpoint", () => {
	const servers: A2AServer[] = [];

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	// ── client_credentials grant ─────────────────────────────────────────────

	test("POST /oauth/token with valid API key → returns JWT pair", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		const res = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: VALID_API_KEY,
			}).toString(),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.access_token).toBeTypeOf("string");
		expect(json.refresh_token).toBeTypeOf("string");
		expect(json.token_type).toBe("Bearer");
		expect(json.expires_in).toBeTypeOf("number");
		expect(json.scope).toContain("a2a:read");
	});

	test("POST /oauth/token with invalid API key → 401 invalid_client", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		const res = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: "wrong-key",
			}).toString(),
		});

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error).toBe("invalid_client");
	});

	test("POST /oauth/token with missing grant_type → 400 invalid_request", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		const res = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ client_assertion: VALID_API_KEY }).toString(),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("invalid_request");
	});

	// ── refresh_token grant ──────────────────────────────────────────────────

	test("POST /oauth/token with refresh_token → returns new pair (rotation)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		// First, get a token pair.
		const initialRes = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: VALID_API_KEY,
			}).toString(),
		});
		const initial = await initialRes.json();

		// Exchange refresh token for a new pair.
		const refreshRes = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: initial.refresh_token,
			}).toString(),
		});

		expect(refreshRes.status).toBe(200);
		const refreshed = await refreshRes.json();
		expect(refreshed.access_token).not.toBe(initial.access_token);
		expect(refreshed.refresh_token).not.toBe(initial.refresh_token);
		expect(refreshed.token_type).toBe("Bearer");
	});

	test("reused refresh_token → 400 invalid_grant (replay detected)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		// Get initial pair.
		const initialRes = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: VALID_API_KEY,
			}).toString(),
		});
		const initial = await initialRes.json();

		// First refresh — should succeed.
		const refresh1 = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: initial.refresh_token,
			}).toString(),
		});
		expect(refresh1.status).toBe(200);

		// Second refresh with the SAME token — should fail (replay).
		const refresh2 = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: initial.refresh_token,
			}).toString(),
		});
		expect(refresh2.status).toBe(400);
		const json = await refresh2.json();
		expect(json.error).toBe("invalid_grant");
	});

	// ── revocation ───────────────────────────────────────────────────────────

	test("POST /oauth/revoke → returns 200", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		// Get a token pair.
		const tokenRes = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: VALID_API_KEY,
			}).toString(),
		});
		const tokens = await tokenRes.json();

		// Revoke the refresh token.
		const revokeRes = await fetch(`http://localhost:${port}/oauth/revoke`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token: tokens.refresh_token }).toString(),
		});
		expect(revokeRes.status).toBe(200);

		// Attempt to use the revoked refresh token.
		const refreshRes = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: tokens.refresh_token,
			}).toString(),
		});
		expect(refreshRes.status).toBe(400);
	});

	// ── metadata ─────────────────────────────────────────────────────────────

	test("GET /.well-known/oauth-authorization-server → returns metadata", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		const res = await fetch(
			`http://localhost:${port}/.well-known/oauth-authorization-server`,
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.token_endpoint).toContain("/oauth/token");
		expect(json.revocation_endpoint).toContain("/oauth/revoke");
		expect(json.scopes_supported).toContain("a2a:read");
		expect(json.grant_types_supported).toContain("client_credentials");
		expect(json.grant_types_supported).toContain("refresh_token");
	});

	// ── JWT bearer token auth on A2A endpoints ───────────────────────────────

	test("POST / with valid Bearer JWT → 200 (authenticated)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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

		// Get a JWT access token.
		const tokenRes = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: VALID_API_KEY,
			}).toString(),
		});
		const tokens = await tokenRes.json();

		// Use the JWT to call the A2A endpoint.
		const res = await fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${tokens.access_token}`,
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(200);
	});

	test("POST / with invalid Bearer JWT → 401", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
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
				Authorization: "Bearer invalid-token",
			},
			body: VALID_BODY,
		});
		expect(res.status).toBe(401);
	});

	// ── OAuth disabled ───────────────────────────────────────────────────────

	test("enableOAuth=false: /oauth/token → 404 (not found)", async () => {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_API_KEY,
				description: "test-key",
				allowedAgents: [],
				enabled: true,
			},
		]);
		const server = new A2AServer(
			makeConfig({ requireAuth: true, enableOAuth: false }),
			undefined,
			undefined,
			registry,
		);
		server.start();
		servers.push(server);
		const port = (server as any).server.port;

		const res = await fetch(`http://localhost:${port}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_assertion: VALID_API_KEY,
			}).toString(),
		});
		expect(res.status).toBe(404);
	});
});
