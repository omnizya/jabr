/**
 * oauth-jwt.test.ts — Tests for OAuth 2.1 JWT middleware.
 *
 * Covers:
 *   - JWT minting and verification (HS256, jose)
 *   - Scope enforcement
 *   - Token refresh flow with rotation
 *   - Revocation (single + all-for-subject)
 *   - Replay attack detection on refresh token reuse
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	ADMIN_SCOPES,
	DEFAULT_SCOPES,
	mintAccessToken,
	mintRefreshToken,
	parseScopes,
	verifyToken,
	verifyWithScopes,
} from "@security/jwt";
import { TokenStore } from "@security/token-store";
import { ApiKeyRegistry } from "../../src/security/api-key-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): TokenStore {
	return new TokenStore();
}

async function tokenThumbprint(raw: string): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(raw),
	);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OAuth 2.1 JWT", () => {
	// Set a deterministic secret for testing.
	process.env.JABR_JWT_SECRET = "test-secret-key-at-least-16-chars-long";

	describe("mintAccessToken", () => {
		test("mints a valid JWT access token", async () => {
			const token = await mintAccessToken({
				subject: "test-caller",
				scopes: DEFAULT_SCOPES,
				agents: [],
			});
			expect(token).toBeTypeOf("string");
			expect(token.split(".")).toHaveLength(3); // compact JWS: header.payload.signature
		});

		test("token carries correct claims when verified", async () => {
			const token = await mintAccessToken({
				subject: "test-caller",
				scopes: ["a2a:read", "a2a:write"],
				agents: ["oracle", "librarian"],
			});
			const verified = await verifyToken(token);
			expect(verified.claims.sub).toBe("test-caller");
			expect(verified.claims.scope).toContain("a2a:read");
			expect(verified.claims.scope).toContain("a2a:write");
			expect(verified.claims.token_type).toBe("access");
			expect(verified.claims.allowed_agents).toEqual(["oracle", "librarian"]);
		});

		test("mintRefreshToken produces a token with refresh token_type", async () => {
			const refresh = await mintRefreshToken({
				subject: "test-caller",
				agents: [],
			});
			const verified = await verifyToken(refresh);
			expect(verified.claims.token_type).toBe("refresh");
		});
	});

	describe("verifyWithScopes", () => {
		test("accepts token with required scope", async () => {
			const token = await mintAccessToken({
				subject: "test-caller",
				scopes: ["a2a:read"],
				agents: [],
			});
			const verified = await verifyWithScopes(token, ["a2a:read"]);
			expect(verified.claims.sub).toBe("test-caller");
		});

		test("rejects token missing required scope", async () => {
			const token = await mintAccessToken({
				subject: "test-caller",
				scopes: ["a2a:read"],
				agents: [],
			});
			await expect(verifyWithScopes(token, ["a2a:admin"])).rejects.toThrow(
				/Insufficient scope/,
			);
		});

		test("accepts token with at least one of the required scopes", async () => {
			const token = await mintAccessToken({
				subject: "test-caller",
				scopes: ["a2a:read", "a2a:write"],
				agents: [],
			});
			const verified = await verifyWithScopes(token, [
				"a2a:write",
				"a2a:admin",
			]);
			expect(verified.claims.sub).toBe("test-caller");
		});
	});

	describe("parseScopes", () => {
		test("parses space-separated scopes correctly", () => {
			expect(parseScopes("a2a:read a2a:write")).toEqual([
				"a2a:read",
				"a2a:write",
			]);
		});

		test("filters invalid scopes", () => {
			expect(parseScopes("a2a:read invalid a2a:admin")).toEqual([
				"a2a:read",
				"a2a:admin",
			]);
		});
	});

	describe("TokenStore", () => {
		let store: TokenStore;

		beforeEach(() => {
			store = makeStore();
		});

		test("stores and retrieves refresh token records", async () => {
			const refresh = await mintRefreshToken({ subject: "user1", agents: [] });
			const tp = await tokenThumbprint(refresh);
			store.store(tp, "user1", []);

			const record = store.get(tp);
			expect(record).toBeDefined();
			expect(record!.subject).toBe("user1");
			expect(record!.revoked).toBe(false);
		});

		test("isRevoked returns true for unknown thumbprints", () => {
			expect(store.isRevoked("unknown")).toBe(true);
		});

		test("isRevoked returns true for revoked tokens", async () => {
			const refresh = await mintRefreshToken({ subject: "user1", agents: [] });
			const tp = await tokenThumbprint(refresh);
			store.store(tp, "user1", []);
			store.revoke(tp);
			expect(store.isRevoked(tp)).toBe(true);
		});

		test("rotate: old token revoked, new token stored", async () => {
			const oldRefresh = await mintRefreshToken({
				subject: "user1",
				agents: [],
			});
			const oldTp = await tokenThumbprint(oldRefresh);
			store.store(oldTp, "user1", []);

			const newRefresh = await mintRefreshToken({
				subject: "user1",
				agents: [],
			});
			const newTp = await tokenThumbprint(newRefresh);
			const result = store.rotate(oldTp, newTp);

			expect(result).not.toBeNull();
			expect(store.isRevoked(oldTp)).toBe(true);
			expect(store.isRevoked(newTp)).toBe(false);
		});

		test("rotate: returns null for already-revoked token (replay)", async () => {
			const oldRefresh = await mintRefreshToken({
				subject: "user1",
				agents: [],
			});
			const oldTp = await tokenThumbprint(oldRefresh);
			store.store(oldTp, "user1", []);
			store.revoke(oldTp);

			const newRefresh = await mintRefreshToken({
				subject: "user1",
				agents: [],
			});
			const newTp = await tokenThumbprint(newRefresh);
			const result = store.rotate(oldTp, newTp);

			expect(result).toBeNull();
		});

		test("revokeAllForSubject revokes all tokens for a user", async () => {
			const r1 = await mintRefreshToken({ subject: "user1", agents: [] });
			const r2 = await mintRefreshToken({ subject: "user1", agents: [] });
			const r3 = await mintRefreshToken({ subject: "user2", agents: [] });
			const tp1 = await tokenThumbprint(r1);
			const tp2 = await tokenThumbprint(r2);
			const tp3 = await tokenThumbprint(r3);
			store.store(tp1, "user1", []);
			store.store(tp2, "user1", []);
			store.store(tp3, "user2", []);

			const count = store.revokeAllForSubject("user1");
			expect(count).toBe(2);
			expect(store.isRevoked(tp1)).toBe(true);
			expect(store.isRevoked(tp2)).toBe(true);
			expect(store.isRevoked(tp3)).toBe(false);
		});

		test("sweep removes expired records", async () => {
			const refresh = await mintRefreshToken({ subject: "user1", agents: [] });
			const tp = await tokenThumbprint(refresh);
			// Store with negative TTL so it's already expired.
			store.store(tp, "user1", [], -1);

			const removed = store.sweep();
			expect(removed).toBe(1);
			expect(store.get(tp)).toBeUndefined();
		});
	});

	describe("ApiKeyRegistry integration", () => {
		test("registry.authenticate rejects disabled keys", () => {
			const registry = new ApiKeyRegistry([
				{
					key: "disabled-key",
					description: "test",
					allowedAgents: [],
					enabled: false,
				},
			]);
			expect(registry.authenticate("disabled-key")).toBeNull();
		});

		test("registry.authenticate rejects unknown keys", () => {
			const registry = new ApiKeyRegistry([
				{
					key: "known-key",
					description: "test",
					allowedAgents: [],
					enabled: true,
				},
			]);
			expect(registry.authenticate("unknown-key")).toBeNull();
		});
	});
});
