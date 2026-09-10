/**
 * oauth-server.ts — OAuth 2.1 token endpoint middleware for A2AServer.
 *
 * Implements:
 *   - POST /oauth/token   — token exchange (API key → JWT, refresh rotation)
 *   - POST /oauth/revoke  — token revocation
 *   - GET /.well-known/oauth-authorization-server — OAuth metadata
 *   - GET /.well-known/jwks.json — JWKS public keys (for RS256/ES256 later)
 *
 * The token endpoint accepts API keys (grant_type=password-equivalent via
 * client_credentials-style assertion) and refresh tokens
 * (grant_type=refresh_token). This is OAuth 2.1's client credentials +
 * refresh token flows only — no implicit or password grants (deprecated).
 *
 * All endpoints return standard OAuth 2.0 error responses (RFC 6749 §5.2).
 */

import type { OAuthTokenRequest, OAuthTokenResponse } from "@/types/types.ts";
import { ApiKeyRegistry } from "./api-key-registry.ts";
import type { OAuthScope, VerifiedToken } from "./jwt.ts";
import {
	ACCESS_TOKEN_TTL_SECONDS,
	ADMIN_SCOPES,
	DEFAULT_SCOPES,
	mintAccessToken,
	mintRefreshToken,
	REFRESH_TOKEN_TTL_SECONDS,
	verifyToken,
} from "./jwt.ts";
import { getTokenStore } from "./token-store.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Grant handlers
// ---------------------------------------------------------------------------

/**
 * Handle client_credentials grant using an API key.
 *
 * The client presents an X-API-Key value as the client_assertion.
 * If valid, we mint a JWT token pair scoped to the key's allowlist.
 */
async function handleClientCredentialsGrant(
	body: OAuthTokenRequest,
	registry: ApiKeyRegistry,
): Promise<OAuthTokenResponse> {
	const apiKey = body.client_assertion;
	if (!apiKey) {
		throw new OAuthError("invalid_request", "client_assertion is required");
	}

	const caller = registry.authenticate(apiKey);
	if (!caller) {
		throw new OAuthError("invalid_client", "Invalid API key");
	}

	// Determine scopes from request (or use defaults).
	let scopes: OAuthScope[] = DEFAULT_SCOPES;
	if (body.scope) {
		const requested = parseScopeString(body.scope);
		// Intersect requested scopes with defaults (cannot escalate beyond default).
		scopes = DEFAULT_SCOPES.filter((s) => requested.includes(s));
		if (scopes.length === 0) scopes = DEFAULT_SCOPES;
	}

	const tokenStore = getTokenStore();
	const accessToken = await mintAccessToken({
		subject: caller.description,
		scopes,
		agents: caller.allowedAgents,
	});
	const refreshToken = await mintRefreshToken({
		subject: caller.description,
		agents: caller.allowedAgents,
	});

	// Store refresh token for rotation tracking.
	await storeRefreshToken(
		refreshToken,
		caller.description,
		caller.allowedAgents,
	);

	return {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		refresh_token: refreshToken,
		refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
		scope: scopes.join(" "),
	};
}

/**
 * Handle refresh_token grant with rotation.
 *
 * Validates the refresh token, checks the revocation list, rotates it
 * (old token invalidated, new token issued), and returns a new pair.
 */
async function handleRefreshTokenGrant(
	body: OAuthTokenRequest,
): Promise<OAuthTokenResponse> {
	const raw = body.refresh_token;
	if (!raw) {
		throw new OAuthError("invalid_request", "refresh_token is required");
	}

	const tokenStore = getTokenStore();

	// Compute thumbprint of the presented refresh token.
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(raw),
	);
	const oldThumbprint = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	// Check revocation list.
	if (tokenStore.isRevoked(oldThumbprint)) {
		// Possible replay attack — revoke all tokens for this subject.
		const existing = tokenStore.get(oldThumbprint);
		if (existing) {
			tokenStore.revokeAllForSubject(existing.subject);
		}
		throw new OAuthError(
			"invalid_grant",
			"Refresh token has been revoked (possible replay detected)",
		);
	}

	// Verify JWT signature + expiry.
	let verified: VerifiedToken;
	try {
		verified = await verifyToken(raw);
	} catch {
		throw new OAuthError("invalid_grant", "Invalid or expired refresh token");
	}

	if (verified.claims.token_type !== "refresh") {
		throw new OAuthError("invalid_grant", "Token is not a refresh token");
	}

	// Rotate: store new refresh token, mark old as revoked.
	const newRefreshToken = await mintRefreshToken({
		subject: verified.claims.sub,
		agents:
			(verified.claims as { allowed_agents?: string[] }).allowed_agents ?? [],
	});

	const newBuf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(newRefreshToken),
	);
	const newThumbprint = Array.from(new Uint8Array(newBuf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const rotated = tokenStore.rotate(oldThumbprint, newThumbprint);
	if (!rotated) {
		// Already revoked — replay attack. Revoke all for this subject.
		tokenStore.revokeAllForSubject(verified.claims.sub);
		throw new OAuthError(
			"invalid_grant",
			"Refresh token reuse detected. All tokens revoked.",
		);
	}

	// Mint a new access token from the refresh token's identity.
	const scopes = parseScopeString(verified.claims.scope as string);
	const accessToken = await mintAccessToken({
		subject: verified.claims.sub,
		scopes: scopes.length > 0 ? scopes : DEFAULT_SCOPES,
		agents: rotated.agents,
	});

	return {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		refresh_token: newRefreshToken,
		refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
		scope: (scopes.length > 0 ? scopes : DEFAULT_SCOPES).join(" "),
	};
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Revoke a token (access or refresh).
 *
 * We attempt to parse the token, extract its thumbprint, and mark it
 * revoked. Access tokens are short-lived so revocation is best-effort,
 * but refresh tokens are fully revoked.
 */
export async function revokeToken(rawToken: string): Promise<boolean> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(rawToken),
	);
	const thumbprint = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const tokenStore = getTokenStore();
	return tokenStore.revoke(thumbprint);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class OAuthError extends Error {
	constructor(
		public readonly code: string,
		public readonly description?: string,
	) {
		super(description ?? code);
	}
}

function parseScopeString(scope: string): OAuthScope[] {
	const valid = new Set<string>([
		"a2a:read",
		"a2a:write",
		"a2a:stream",
		"a2a:admin",
	]);
	return scope
		.split(/\s+/)
		.filter(Boolean)
		.filter((s): s is OAuthScope => valid.has(s));
}

async function storeRefreshToken(
	raw: string,
	subject: string,
	agents: string[],
): Promise<void> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(raw),
	);
	const thumbprint = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	getTokenStore().store(thumbprint, subject, agents);
}

// ---------------------------------------------------------------------------
// OAuth metadata (RFC 8414)
// ---------------------------------------------------------------------------

export function oauthMetadata(baseUrl: string): Record<string, unknown> {
	return {
		issuer: baseUrl,
		token_endpoint: `${baseUrl}/oauth/token`,
		revocation_endpoint: `${baseUrl}/oauth/revoke`,
		// Not implemented (PKCE flow would go here):
		// authorization_endpoint: `${baseUrl}/authorize`,
		// registration_endpoint: `${baseUrl}/register`,
		// userinfo_endpoint: `${baseUrl}/userinfo`,
		scopes_supported: ["a2a:read", "a2a:write", "a2a:stream", "a2a:admin"],
		grant_types_supported: ["client_credentials", "refresh_token"],
		token_endpoint_auth_methods_supported: ["client_secret_post"],
		revocation_endpoint_auth_methods_supported: ["client_secret_post"],
		signing_alg_values_supported: ["HS256"],
		service_documentation: baseUrl,
	};
}

// ---------------------------------------------------------------------------
// Route handler for integration into A2AServer
// ---------------------------------------------------------------------------

export interface OAuthRoutesResult {
	handled: boolean;
	response?: Response;
}

/**
 * Handle an OAuth-related request. Returns handled=false if the request
 * is not an OAuth route (so the caller can fall through to A2A JSON-RPC).
 *
 * This is designed to be called from within A2AServer's fetch handler,
 * before JSON-RPC dispatch.
 */
export async function handleOAuthRoutes(
	req: Request,
	url: URL,
	registry: ApiKeyRegistry,
): Promise<OAuthRoutesResult> {
	const origin = req.headers.get("Origin");

	// --- OAuth token endpoint ---
	if (url.pathname === "/oauth/token" && req.method === "POST") {
		let body: OAuthTokenRequest;
		try {
			const text = await req.text();
			body = Object.fromEntries(
				new URLSearchParams(text),
			) as unknown as OAuthTokenRequest;
			// Also support JSON content-type
			if (!body.grant_type && text.startsWith("{")) {
				body = JSON.parse(text);
			}
		} catch {
			return jsonResponse(
				{
					error: "invalid_request",
					error_description: "Malformed request body",
				},
				400,
				origin,
			);
		}

		if (!body.grant_type) {
			return jsonResponse(
				{
					error: "invalid_request",
					error_description: "grant_type is required",
				},
				400,
				origin,
			);
		}

		try {
			let response: OAuthTokenResponse;
			if (body.grant_type === "client_credentials") {
				response = await handleClientCredentialsGrant(body, registry);
			} else if (body.grant_type === "refresh_token") {
				response = await handleRefreshTokenGrant(body);
			} else {
				return jsonResponse(
					{
						error: "unsupported_grant_type",
						error_description: `Unsupported grant_type: ${body.grant_type}`,
					},
					400,
					origin,
				);
			}
			return jsonResponse(response, 200, origin);
		} catch (e) {
			if (e instanceof OAuthError) {
				return jsonResponse(
					{ error: e.code, error_description: e.description },
					e.code === "invalid_client" ? 401 : 400,
					origin,
				);
			}
			return jsonResponse(
				{ error: "server_error", error_description: String(e) },
				500,
				origin,
			);
		}
	}

	// --- OAuth revocation endpoint ---
	if (url.pathname === "/oauth/revoke" && req.method === "POST") {
		let body: { token?: string; token_type_hint?: string };
		try {
			const text = await req.text();
			const params = new URLSearchParams(text);
			body = {
				token: params.get("token") ?? undefined,
				token_type_hint: params.get("token_type_hint") ?? undefined,
			};
			if (!body.token && text.startsWith("{")) {
				body = JSON.parse(text);
			}
		} catch {
			return jsonResponse(
				{
					error: "invalid_request",
					error_description: "Malformed request body",
				},
				400,
				origin,
			);
		}

		if (!body.token) {
			return jsonResponse(
				{ error: "invalid_request", error_description: "token is required" },
				400,
				origin,
			);
		}

		await revokeToken(body.token);
		// RFC 7009 §2.2: return 200 even if the token was already invalid.
		return jsonResponse({}, 200, origin);
	}

	// --- OAuth authorization server metadata (RFC 8414) ---
	if (
		url.pathname === "/.well-known/oauth-authorization-server" &&
		req.method === "GET"
	) {
		const baseUrl = `${url.protocol}//${url.host}`;
		return jsonResponse(oauthMetadata(baseUrl), 200, origin);
	}

	// --- JWKS (placeholder for RS256/ES256 key rotation; currently HS256) ---
	if (url.pathname === "/.well-known/jwks.json" && req.method === "GET") {
		return jsonResponse({ keys: [] }, 200, origin);
	}

	return { handled: false };
}

function jsonResponse(
	body: unknown,
	status: number,
	origin: string | null,
): OAuthRoutesResult {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
		Pragma: "no-cache",
	};
	if (origin) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return {
		handled: true,
		response: new Response(JSON.stringify(body), { status, headers }),
	};
}
