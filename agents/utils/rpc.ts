/**
 * Shared JSON-RPC 2.0 types and helpers used by A2A server and ACP bridge.
 */
import { DEV_ALLOWED_ORIGINS } from "@constants/ecosystem";
export type SomeId = number | string | null;
export interface JSONRPCDefaults {
	jsonrpc: "2.0";
	id: SomeId;
}

export interface JSONRPCRequest extends JSONRPCDefaults {
	method: string;
	params?: unknown;
}

export interface JSONRPCResponse extends JSONRPCDefaults {
	result?: unknown;
	error?: { code: number; message: string };
}

export interface JSONRPCNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export function notification(
	method: string,
	params?: unknown,
): JSONRPCNotification {
	return { jsonrpc: "2.0", method, params };
}

export function ok(id: SomeId, result: unknown): JSONRPCResponse {
	return { jsonrpc: "2.0", id, result };
}

/**
 * Format a Server-Sent Event payload per the WHATWG SSE spec.
 *
 * Produces a multi-line string with `data:` and `event:` fields.
 * Empty lines separate events in the stream. The caller is responsible
 * for appending a trailing blank line when the stream ends.
 */
export function formatSSEEvent(eventName: string, payload: unknown): string {
	return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function err(
	id: SomeId,
	code: number,
	message: string,
): JSONRPCResponse {
	console.error(
		`[Rpc] error response id=${id} code=${code} message=${message}`,
	);
	return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * CORS header builders driven by the ALLOWED_ORIGINS env var.
 *
 * Unlike the old `corsHeaders` / `corsPreflightHeaders` constants (which
 * returned `Access-Control-Allow-Origin: *`), these reflect the request's
 * origin ONLY when it appears in the allowlist. When the origin is not
 * allowed, they return null so the caller can omit CORS headers entirely
 * (the browser will block the response).
 *
 * Defaults to localhost-only origins for development; production MUST set
 * ALLOWED_ORIGINS to the real set of frontend/agent origins.
 *
 * See: AGENTS.md#CORS, CANONICAL.md (CORS allowlist).
 */
const ALLOWED_ORIGINS_LIST = (process.env.ALLOWED_ORIGINS ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

/** Default fallback when ALLOWED_ORIGINS is empty (dev convenience). */
const DEFAULT_ALLOWED_ORIGINS: string[] = [...DEV_ALLOWED_ORIGINS];

function isOriginAllowed(origin: string | null): boolean {
	if (!origin) return false;
	const allowed =
		ALLOWED_ORIGINS_LIST.length > 0
			? ALLOWED_ORIGINS_LIST
			: DEFAULT_ALLOWED_ORIGINS;
	return allowed.includes(origin);
}

export function buildCorsHeaders(
	origin: string | null,
): Record<string, string> | null {
	if (!isOriginAllowed(origin)) return null;
	return { "Access-Control-Allow-Origin": origin! };
}

export function buildCorsPreflightHeaders(
	origin: string | null,
): Record<string, string> | null {
	if (!isOriginAllowed(origin)) return null;
	return {
		"Access-Control-Allow-Origin": origin!,
		"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-API-Key",
		"Access-Control-Max-Age": "86400",
	};
}

/**
 * Legacy compatibility — kept for any consumer that still imports the old
 * constant names. These return the wildcard `*` value and should NOT be used
 * by new code; prefer `buildCorsHeaders` / `buildCorsPreflightHeaders`.
 *
 * TODO: remove once all consumers migrated (tracked in TODO.md).
 */
export const corsHeaders = { "Access-Control-Allow-Origin": "*" } as const;
export const corsPreflightHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, X-API-Key",
} as const;
