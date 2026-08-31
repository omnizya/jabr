/**
 * jabr-config.ts — Centralized, validated configuration accessor for Jabr.
 *
 * Reads JABR_URL (or legacy ORCHESTRATOR_URL) from the environment and
 * validates it at module load time. An invalid or missing value causes an
 * immediate, descriptive process exit so misconfiguration surfaces at boot
 * rather than as a cryptic fetch error mid-task.
 *
 * Schema rules:
 *   - Must be a valid URL (zod .url())
 *   - Scheme must be http:// or https:// (no file://, ws://, etc.)
 *   - Host must be present (rejects malformed like "http://")
 *
 * Consumers import `jabrUrl()` to get the validated URL string, or
 * `JABR_URL_RAW` if they need the raw env value (e.g. for deriving
 * agent seed URLs by port substitution).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const jabrUrlSchema = z
	.string()
	.url("JABR_URL must be a valid URL (e.g. http://localhost:4000)")
	.refine(
		(url) => {
			try {
				const parsed = new URL(url);
				return parsed.protocol === "http:" || parsed.protocol === "https:";
			} catch {
				return false;
			}
		},
		{ message: "JABR_URL scheme must be http:// or https://" },
	)
	.refine(
		(url) => {
			try {
				const parsed = new URL(url);
				return parsed.hostname.length > 0;
			} catch {
				return false;
			}
		},
		{ message: "JABR_URL must have a valid host" },
	);

// ---------------------------------------------------------------------------
// Raw env access (with legacy fallback)
// ---------------------------------------------------------------------------

export const JABR_URL_RAW: string | undefined =
	process.env.JABR_URL ?? process.env.ORCHESTRATOR_URL;

// ---------------------------------------------------------------------------
// Validated accessor
// ---------------------------------------------------------------------------

let _cachedValidatedUrl: string | null = null;

/**
 * Returns the validated Jabr orchestrator URL.
 *
 * On first call, validates JABR_URL (or ORCHESTRATOR_URL) against the
 * schema. If validation fails, logs a fatal error and exits the process.
 * Subsequent calls return the cached value without re-validating.
 *
 * Use this at startup or lazily — the fail-fast behavior ensures
 * misconfiguration never reaches a running agent.
 */
export function jabrUrl(): string {
	if (_cachedValidatedUrl) return _cachedValidatedUrl;

	const raw = JABR_URL_RAW;

	if (!raw) {
		console.error(
			"[JABR_CONFIG] Fatal: JABR_URL environment variable is required.\n" +
				"  Set it to the orchestrator endpoint, e.g. JABR_URL=http://localhost:4000\n" +
				"  (Legacy ORCHESTRATOR_URL is also accepted but deprecated.)",
		);
		process.exit(1);
	}

	const result = jabrUrlSchema.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		console.error(
			`[JABR_CONFIG] Fatal: JABR_URL validation failed for "${raw}":\n${issues}`,
		);
		process.exit(1);
	}

	_cachedValidatedUrl = result.data;
	return _cachedValidatedUrl;
}

/**
 * Returns the validated Jabr orchestrator URL, or undefined if not set
 * and no legacy fallback exists. Does NOT exit on validation failure —
 * callers must handle the undefined case.
 *
 * Use this in contexts where a missing URL is acceptable (e.g. optional
 * features, tests).
 */
export function jabrUrlOrUndefined(): string | undefined {
	if (_cachedValidatedUrl) return _cachedValidatedUrl;

	const raw = JABR_URL_RAW;
	if (!raw) return undefined;

	const result = jabrUrlSchema.safeParse(raw);
	if (!result.success) return undefined;

	_cachedValidatedUrl = result.data;
	return _cachedValidatedUrl;
}

/**
 * Derives an agent URL from JABR_URL by replacing the port.
 *
 * Example: jabrUrlForPort(4001) on "http://localhost:4000" → "http://localhost:4001"
 *
 * Falls back to constructing from `http://localhost:${port}` if JABR_URL
 * is not set, so agent discovery still works in dev without explicit config.
 */
export function jabrUrlForPort(port: number): string {
	const base = jabrUrlOrUndefined();
	if (!base) return `http://localhost:${port}`;

	try {
		const url = new URL(base);
		url.port = String(port);
		return url.toString();
	} catch {
		return `http://localhost:${port}`;
	}
}
