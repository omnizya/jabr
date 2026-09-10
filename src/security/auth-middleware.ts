/**
 * auth-middleware.ts — Per-endpoint scope enforcement for OAuth 2.1.
 *
 * Maps each A2A method to the minimum scope required:
 *   - tasks/send          → a2a:write
 *   - tasks/sendSubscribe → a2a:stream OR a2a:write
 *   - tasks/get           → a2a:read
 *   - tasks/cancel        → a2a:admin
 */

import { type OAuthScope, verifyWithScopes } from "./jwt.ts";

/** Minimum scope required per A2A method. */
const METHOD_SCOPES: Record<string, OAuthScope[]> = {
	"tasks/send": ["a2a:write"],
	"tasks/sendSubscribe": ["a2a:stream", "a2a:write"], // stream OR write
	"tasks/get": ["a2a:read"],
	"tasks/cancel": ["a2a:admin"],
};

/**
 * Return the minimum scopes required for an A2A method.
 */
export function scopesForMethod(method: string): OAuthScope[] {
	return METHOD_SCOPES[method] ?? ["a2a:read"];
}
