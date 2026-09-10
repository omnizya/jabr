/**
 * tls-config.ts — TLS configuration for mTLS between agents.
 *
 * Reads cert/key paths from env vars:
 *   - JABR_TLS_CA       — CA certificate (PEM) for verifying peer certs
 *   - JABR_TLS_CERT     — Server/client certificate (PEM)
 *   - JABR_TLS_KEY      — Private key (PEM)
 *
 * For development, certs can be generated via scripts/generate-dev-certs.ts.
 */

import type { TlsConfig } from "@/types/types";
import { readPemFileSync } from "@/utils/converter";

/**
 * Load TLS configuration from environment variables (synchronous).
 * Returns null if TLS is not configured.
 */
export function loadTlsConfigSync(): TlsConfig | null {
	const caPath = process.env.JABR_TLS_CA;
	const certPath = process.env.JABR_TLS_CERT;
	const keyPath = process.env.JABR_TLS_KEY;

	if (!caPath || !certPath || !keyPath) {
		return null;
	}

	try {
		const ca = readPemFileSync(caPath);
		const cert = readPemFileSync(certPath);
		const key = readPemFileSync(keyPath);

		// Validate PEM format (basic check)
		if (!ca.includes("BEGIN CERTIFICATE")) {
			throw new Error(`JABR_TLS_CA (${caPath}) is not a valid PEM certificate`);
		}
		if (!cert.includes("BEGIN CERTIFICATE")) {
			throw new Error(
				`JABR_TLS_CERT (${certPath}) is not a valid PEM certificate`,
			);
		}
		if (
			!key.includes("BEGIN") ||
			(!key.includes("PRIVATE KEY") && !key.includes("EC PRIVATE KEY"))
		) {
			throw new Error(
				`JABR_TLS_KEY (${keyPath}) is not a valid PEM private key`,
			);
		}

		return { ca, cert, key };
	} catch (e) {
		console.error(`[TlsConfig] failed to load TLS config: ${e}`);
		return null;
	}
}

/**
 * Load TLS configuration from environment variables (asynchronous).
 * Returns null if TLS is not configured.
 */
export async function loadTlsConfig(): Promise<TlsConfig | null> {
	const caPath = process.env.JABR_TLS_CA;
	const certPath = process.env.JABR_TLS_CERT;
	const keyPath = process.env.JABR_TLS_KEY;

	if (!caPath || !certPath || !keyPath) {
		return null;
	}

	try {
		const [ca, cert, key] = await Promise.all([
			Bun.file(caPath).text(),
			Bun.file(certPath).text(),
			Bun.file(keyPath).text(),
		]);

		// Validate PEM format (basic check)
		if (!ca.includes("BEGIN CERTIFICATE")) {
			throw new Error(`JABR_TLS_CA (${caPath}) is not a valid PEM certificate`);
		}
		if (!cert.includes("BEGIN CERTIFICATE")) {
			throw new Error(
				`JABR_TLS_CERT (${certPath}) is not a valid PEM certificate`,
			);
		}
		if (
			!key.includes("BEGIN") ||
			(!key.includes("PRIVATE KEY") && !key.includes("EC PRIVATE KEY"))
		) {
			throw new Error(
				`JABR_TLS_KEY (${keyPath}) is not a valid PEM private key`,
			);
		}

		return { ca, cert, key };
	} catch (e) {
		console.error(`[TlsConfig] failed to load TLS config: ${e}`);
		return null;
	}
}

/**
 * Check if TLS is enabled (env vars are set).
 */
export function isTlsEnabled(): boolean {
	return Boolean(
		process.env.JABR_TLS_CA &&
			process.env.JABR_TLS_CERT &&
			process.env.JABR_TLS_KEY,
	);
}
