/**
 * jwt.ts — JWT signing and verification for OAuth 2.1 bearer tokens.
 *
 * Uses jose (HS256) for compact JWS tokens. The signing secret is derived
 * from JABR_JWT_SECRET env var (or falls back to JABR_X402_HMAC_SECRET).
 * Tokens are short-lived (default 15 min) and carry scopes, caller identity,
 * and the agent allowlist inherited from the originating API key.
 */

import { type JWTPayload, jwtVerify, SignJWT } from "jose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scoped permissions a token grants on A2A endpoints. */
export type OAuthScope =
	| "a2a:read" // tasks/get, discover, health-check
	| "a2a:write" // tasks/send, tasks/sendSubscribe
	| "a2a:stream" // SSE streaming
	| "a2a:admin"; // tasks/cancel, token management

export interface TokenClaims extends JWTPayload {
	/** Subject — caller description from ApiKeyRegistry. */
	sub: string;
	/** Scopes granted to this token. */
	scope: string;
	/** Agent allowlist inherited from the originating API key. */
	allowed_agents: string[];
	/** Token type: "access" or "refresh". */
	token_type: "access" | "refresh";
	/** JWT Key ID — which signing secret was used. */
	kid: string;
}

export interface VerifiedToken {
	/** Parsed claims from the JWT payload. */
	claims: TokenClaims;
	/** The raw token string (for revocation lookups). */
	raw: string;
	/** JWT thumbprint — unique per token (jti or derived). */
	thumbprint: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let signingSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
	if (signingSecret) return signingSecret;
	const secret =
		process.env.JABR_JWT_SECRET ?? process.env.JABR_X402_HMAC_SECRET;
	if (!secret || secret.length < 16) {
		throw new Error(
			"JABR_JWT_SECRET (or JABR_X402_HMAC_SECRET) must be set and at least 16 chars",
		);
	}
	signingSecret = new TextEncoder().encode(secret);
	return signingSecret;
}

/** Default access token lifetime: 15 minutes. */
export const ACCESS_TOKEN_TTL_SECONDS = Number(
	process.env.JABR_JWT_ACCESS_TTL ?? 900,
);

/** Default refresh token lifetime: 7 days. */
export const REFRESH_TOKEN_TTL_SECONDS = Number(
	process.env.JABR_JWT_REFRESH_TTL ?? 604_800,
);

/** Key ID derived from the first 8 chars of the SHA-256 of the secret. */
async function kid(): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		getSecret() as BufferSource,
	);
	return Array.from(new Uint8Array(buf as ArrayBuffer))
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

/**
 * Mint a new JWT access token.
 *
 * @param opts.subject    Caller description (sub claim).
 * @param opts.scopes     Granted scopes.
 * @param opts.agents     Inherited agent allowlist (empty = wildcard).
 * @param opts.ttlSeconds Token lifetime in seconds (default 15 min).
 */
export async function mintAccessToken(opts: {
	subject: string;
	scopes: OAuthScope[];
	agents: string[];
	ttlSeconds?: number;
}): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const ttl = opts.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
	const keyId = await kid();

	return new SignJWT({
		sub: opts.subject,
		scope: opts.scopes.join(" "),
		allowed_agents: opts.agents,
		token_type: "access",
	})
		.setProtectedHeader({ alg: "HS256", kid: keyId })
		.setIssuedAt(now)
		.setExpirationTime(now + ttl)
		.setJti(crypto.randomUUID())
		.sign(getSecret());
}

/**
 * Mint a new JWT refresh token.
 *
 * Refresh tokens carry the same identity but only the `a2a:read` scope
 * (enough to call the token endpoint for a new access token). They are
 * long-lived and single-use (rotation enforced by TokenStore).
 */
export async function mintRefreshToken(opts: {
	subject: string;
	agents: string[];
	ttlSeconds?: number;
}): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const ttl = opts.ttlSeconds ?? REFRESH_TOKEN_TTL_SECONDS;
	const keyId = await kid();

	return new SignJWT({
		sub: opts.subject,
		scope: "a2a:read",
		allowed_agents: opts.agents,
		token_type: "refresh",
	})
		.setProtectedHeader({ alg: "HS256", kid: keyId })
		.setIssuedAt(now)
		.setExpirationTime(now + ttl)
		.setJti(crypto.randomUUID())
		.sign(getSecret());
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verify a JWT bearer token string.
 *
 * Throws on invalid signature, expired JWT, or wrong algorithm.
 * Returns parsed claims + thumbprint on success.
 */
export async function verifyToken(token: string): Promise<VerifiedToken> {
	const { payload, protectedHeader } = await jwtVerify(token, getSecret(), {
		algorithms: ["HS256"],
		requiredClaims: ["sub", "scope", "token_type", "exp", "iat"],
	});

	if (payload.token_type !== "access" && payload.token_type !== "refresh") {
		throw new Error(`Invalid token_type: ${String(payload.token_type)}`);
	}

	// Compute a thumbprint for revocation lookups.
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	const thumbprint = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return {
		claims: payload as unknown as TokenClaims,
		raw: token,
		thumbprint,
	};
}

/**
 * Verify a token and ensure it has at least one of the required scopes.
 *
 * Use this in middleware to enforce scope-based authorization.
 */
export async function verifyWithScopes(
	token: string,
	requiredScopes: OAuthScope[],
): Promise<VerifiedToken> {
	const verified = await verifyToken(token);
	const tokenScopes = new Set(
		verified.claims.scope.split(/\s+/).filter(Boolean),
	);
	const hasScope = requiredScopes.some((s) => tokenScopes.has(s));
	if (!hasScope) {
		throw new Error(
			`Insufficient scope: required one of [${requiredScopes.join(", ")}], ` +
				`got [${[...tokenScopes].join(", ")}]`,
		);
	}
	return verified;
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/** Parse a space-separated scope string into typed scopes. */
export function parseScopes(scopeStr: string): OAuthScope[] {
	const valid = new Set<OAuthScope>([
		"a2a:read",
		"a2a:write",
		"a2a:stream",
		"a2a:admin",
	]);
	return scopeStr
		.split(/\s+/)
		.filter(Boolean)
		.filter((s): s is OAuthScope => valid.has(s as OAuthScope));
}

/** Default scopes for a wildcard API key (all permissions). */
export const DEFAULT_SCOPES: OAuthScope[] = [
	"a2a:read",
	"a2a:write",
	"a2a:stream",
];

/** All scopes including admin. */
export const ADMIN_SCOPES: OAuthScope[] = [...DEFAULT_SCOPES, "a2a:admin"];
