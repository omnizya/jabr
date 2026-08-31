/**
 * validation.ts — Shared Zod schemas for MCP tool input validation.
 *
 * Every MCP tool input schema must:
 *   1. Reject unknown keys (strict mode) — prevents silent injection of extra fields.
 *   2. Cap string lengths — prevents memory exhaustion from arbitrarily large inputs.
 *   3. Validate paths — prevents directory traversal outside the workspace.
 *
 * Import these helpers in mcp-servers/tools.ts and any future tool registrations.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// String with max length
// ---------------------------------------------------------------------------

/**
 * Zod string with an upper bound on length.
 * Caps are chosen per-field to balance usability with DoS protection.
 */
export function cappedString(
	maxLength: number,
	description?: string,
): z.ZodString {
	const schema = z.string().max(maxLength);
	return description ? schema.describe(description) : schema;
}

// ---------------------------------------------------------------------------
// Strict object — rejects unknown keys
// ---------------------------------------------------------------------------

/**
 * Zod object schema in strict mode.
 *
 * By default Zod *strips* unknown keys. Strict mode rejects them with a
 * ZodError, which the MCP SDK surfaces as an InvalidParams McpError.
 *
 * Use this for every tool's inputSchema so that a client cannot smuggle
 * extra fields past validation (e.g. {path: "x", "__proto__": {...}}).
 */
export function strictObject<T extends z.ZodRawShape>(
	shape: T,
): z.ZodObject<T> {
	return z.object(shape).strict();
}

// ---------------------------------------------------------------------------
// Safe relative path — no traversal
// ---------------------------------------------------------------------------

/**
 * Validates a relative workspace path.
 *
 * Rejects:
 *   - Absolute paths (start with "/")
 *   - Home expansion (start with "~")
 *   - Directory traversal (contains "..")
 *
 * Length is capped at 500 chars to match cappedString semantics.
 */
export const safePath = (description?: string): z.ZodString => {
	const schema = z
		.string()
		.max(500)
		.refine((p) => !p.startsWith("/"), "Path must be relative, not absolute")
		.refine((p) => !p.includes(".."), "Path must not contain '..' (traversal)")
		.refine((p) => !p.startsWith("~"), "Path must not start with '~'");
	return description ? schema.describe(description) : schema;
};

// ---------------------------------------------------------------------------
// Bounded number
// ---------------------------------------------------------------------------

/**
 * Zod number with lower and upper bounds.
 */
export function boundedNumber(
	min: number,
	max: number,
	description?: string,
): z.ZodNumber {
	const schema = z.number().min(min).max(max);
	return description ? schema.describe(description) : schema;
}
