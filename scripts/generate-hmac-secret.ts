#!/usr/bin/env -S bun run

/**
 * generate-hmac-secret.ts — Generate a cryptographically secure JABR_X402_HMAC_SECRET.
 *
 * Generates a 32-byte (256-bit) random hex string suitable for signing x402
 * payment tokens and encrypting GunJS SEA data. Optionally writes/updates
 * the value in .env.
 *
 * Usage:
 *   bun scripts/generate-hmac-secret.ts              # print to stdout
 *   bun scripts/generate-hmac-secret.ts --write      # write to .env
 *   bun scripts/generate-hmac-secret.ts --check      # verify existing secret
 *   bun scripts/generate-hmac-secret.ts --help       # show usage
 *
 * The script uses WebCrypto (crypto.getRandomValues) — no external deps.
 */

import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_LENGTH_BYTES = 32; // 256 bits
const ENV_VAR = "JABR_X402_HMAC_SECRET";
const ENV_FILE = resolve(process.cwd(), ".env");

function generateSecret(): string {
	const bytes = new Uint8Array(SECRET_LENGTH_BYTES);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readEnvVar(name: string): Promise<string | null> {
	try {
		const file = Bun.file(ENV_FILE);
		const text = await file.text();
		const match = text.match(new RegExp(`^${name}=([^\\n]*)`, "m"));
		return match?.[1]?.trim() ?? null;
	} catch {
		return null;
	}
}

async function updateEnvVar(name: string, value: string): Promise<boolean> {
	try {
		let content = existsSync(ENV_FILE) ? await Bun.file(ENV_FILE).text() : "";
		const regex = new RegExp(`^${name}=.*$`, "m");
		if (regex.test(content)) {
			content = content.replace(regex, `${name}=${value}`);
		} else {
			content += `${content.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
		}
		writeFileSync(ENV_FILE, content);
		return true;
	} catch (err) {
		console.error(`Failed to write ${ENV_FILE}:`, err);
		return false;
	}
}

function validateExisting(secret: string): { valid: boolean; issues: string[] } {
	const issues: string[] = [];

	if (!secret) {
		issues.push("Secret is empty or missing.");
		return { valid: false, issues };
	}

	if (!/^[0-9a-fA-F]+$/.test(secret)) {
		issues.push("Secret is not a valid hex string.");
	}

	if (secret.length !== SECRET_LENGTH_BYTES * 2) {
		issues.push(
			`Secret is ${secret.length} hex chars — expected ${SECRET_LENGTH_BYTES * 2} (32 bytes).`,
		);
	}

	if (secret.length < 16) {
		issues.push("Secret is shorter than 16 hex chars (8 bytes) — too weak for HMAC-SHA256.");
	}

	const weakSecrets = new Set([
		"dev-secret-change-in-prod",
		"change-me",
		"secret",
		"test-secret-do-not-use-in-prod",
		"0".repeat(secret.length),
		"f".repeat(secret.length),
	]);
	if (weakSecrets.has(secret.toLowerCase())) {
		issues.push("Secret is a known-weak or placeholder value.");
	}

	return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const shouldWrite = args.includes("--write");
const shouldCheck = args.includes("--check");
const shouldHelp = args.includes("--help") || args.includes("-h");

if (shouldHelp) {
	console.log(`
JABR_X402_HMAC_SECRET Generator
===============================

Generates a cryptographically secure 32-byte (256-bit) hex secret for x402
payment signing and GunJS SEA encryption.

Usage:
  bun scripts/generate-hmac-secret.ts              print new secret to stdout
  bun scripts/generate-hmac-secret.ts --write      generate + write to .env
  bun scripts/generate-hmac-secret.ts --check      validate existing secret in .env
  bun scripts/generate-hmac-secret.ts --help       show this message

Examples:
  # Generate and display (no disk changes)
  bun scripts/generate-hmac-secret.ts

  # Generate and write to .env
  bun scripts/generate-hmac-secret.ts --write

  # Verify current .env has a strong secret
  bun scripts/generate-hmac-secret.ts --check
`);
	process.exit(0);
}

if (shouldCheck) {
	const existing = await readEnvVar(ENV_VAR);
	if (!existing) {
		console.error(`✗ ${ENV_VAR} is not set in .env`);
		console.error("  Run with --write to generate one.");
		process.exit(1);
	}
	const { valid, issues } = validateExisting(existing);
	if (valid) {
		console.log(`✓ ${ENV_VAR} is set and valid (${existing.length} hex chars)`);
		process.exit(0);
	} else {
		console.error(`✗ ${ENV_VAR} has issues:`);
		for (const issue of issues) {
			console.error(`  - ${issue}`);
		}
		console.error("\n  Run with --write to replace it.");
		process.exit(1);
	}
}

const secret = generateSecret();

if (shouldWrite) {
	const success = await updateEnvVar(ENV_VAR, secret);
	if (success) {
		console.log(`✓ Generated and wrote ${ENV_VAR} to .env`);
		console.log(`  Secret: ${secret}`);
		console.log(`  Length: ${secret.length} hex chars (${SECRET_LENGTH_BYTES} bytes)`);
	} else {
		console.error("Failed to write to .env");
		process.exit(1);
	}
} else {
	console.log(`${ENV_VAR}=${secret}`);
}
