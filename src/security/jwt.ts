/**
 * jwt.ts — JWT signing and verification for OAuth 2.1 bearer tokens.
 *
 * Implements HS256 compact JWS locally via the WebCrypto `crypto.subtle`
 * API (no external JWT library). The signing secret is derived from
 * JABR_JWT_SECRET env var (or falls back to JABR_X402_HMAC_SECRET).
 * Tokens are short-lived (default 15 min) and carry scopes, caller identity,
 * and the agent allowlist inherited from the originating API key.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scoped permissions a token grants on A2A endpoints. */
export type OAuthScope =
	| "a2a:read" // GetTask, ListTasks, GetExtendedAgentCard, health-check
	| "a2a:write" // SendMessage, SendStreamingMessage
	| "a2a:stream" // SSE streaming
	| "a2a:admin"; // CancelTask, token management

export interface TokenClaims {
	/** Subject — caller description from ApiKeyRegistry. */
	sub: string;
	/** Scopes granted to this token. */
	scope: string;
	/** Agent allowlist inherited from the originating API key. */
	allowed_agents: string[];
	/** Token type: "access" or "refresh". */
	token_type: "access" | "refresh";
	/** JWT Key ID — which signing secret was used. */
	kid?: string;
	/** Issued-at timestamp (unix seconds). */
	iat?: number;
	/** Expiration timestamp (unix seconds). */
	exp?: number;
	/** Unique token ID (revocation / thumbprint association). */
	jti?: string;
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

let signingSecret: Uint8Array<ArrayBuffer> | null = null;

function getSecret(): Uint8Array<ArrayBuffer> {
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
	const buf = await crypto.subtle.digest("SHA-256", getSecret());
	return Array.from(new Uint8Array(buf))
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

let cachedSigningKey: CryptoKey | null = null;

/** Import the HMAC-SHA256 signing key once and reuse it across calls. */
async function getSigningKey(): Promise<CryptoKey> {
	if (!cachedSigningKey) {
		cachedSigningKey = await crypto.subtle.importKey(
			"raw",
			getSecret(),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		);
	}
	return cachedSigningKey;
}

/** Base64url-encode a UTF-8 string (JSON claims / header segment). */
function b64url(input: string): string {
	return Buffer.from(input, "utf-8").toString("base64url");
}

/** Base64url-encode raw bytes (signature segment). */
function b64urlBytes(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

/** Sign a compact JWS with HS256 (header.payload.signature). */
async function signCompact(
	keyId: string,
	claims: Record<string, unknown>,
): Promise<string> {
	const headerSegment = b64url(JSON.stringify({ alg: "HS256", kid: keyId }));
	const payloadSegment = b64url(JSON.stringify(claims));
	const signingInput = `${headerSegment}.${payloadSegment}`;
	const key = await getSigningKey();
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${b64urlBytes(new Uint8Array(signature))}`;
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

	return signCompact(keyId, {
		sub: opts.subject,
		scope: opts.scopes.join(" "),
		allowed_agents: opts.agents,
		token_type: "access",
		iat: now,
		exp: now + ttl,
		jti: crypto.randomUUID(),
	});
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

	return signCompact(keyId, {
		sub: opts.subject,
		scope: "a2a:read",
		allowed_agents: opts.agents,
		token_type: "refresh",
		iat: now,
		exp: now + ttl,
		jti: crypto.randomUUID(),
	});
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
	const parts = token.split(".");
	const headerPart = parts[0];
	const payloadPart = parts[1];
	const signaturePart = parts[2];
	if (
		headerPart === undefined ||
		payloadPart === undefined ||
		signaturePart === undefined
	) {
		throw new Error("Invalid JWT");
	}

	// Reject tokens not signed with HS256 before touching the signature path.
	let payload: unknown;
	try {
		const header = JSON.parse(
			Buffer.from(headerPart, "base64url").toString("utf-8"),
		) as { alg?: unknown };
		if (header.alg !== "HS256") {
			throw new Error("Invalid JWT");
		}
		payload = JSON.parse(
			Buffer.from(payloadPart, "base64url").toString("utf-8"),
		);
	} catch {
		throw new Error("Invalid JWT");
	}

	// Verify the HMAC signature over the unmodified compact segments.
	const signingInput = `${headerPart}.${payloadPart}`;
	const key = await getSigningKey();
	const signature = Buffer.from(signaturePart, "base64url");
	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signature,
		new TextEncoder().encode(signingInput),
	);
	if (!valid) {
		throw new Error("signature verification failed");
	}

	// Required claims (mirrors jose requiredClaims): sub, scope, token_type, exp, iat.
	const claims = payload as Record<string, unknown>;
	if (typeof claims.sub !== "string" || typeof claims.scope !== "string") {
		throw new Error("Invalid JWT");
	}
	if (claims.token_type !== "access" && claims.token_type !== "refresh") {
		throw new Error(`Invalid token_type: ${String(claims.token_type)}`);
	}
	if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
		throw new Error("Invalid JWT");
	}
	if (claims.exp <= Math.floor(Date.now() / 1000)) {
		throw new Error("Expiration time (exp) check failed");
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
