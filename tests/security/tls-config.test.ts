/**
 * tls-config.test.ts — Tests for TLS configuration loading.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTlsEnabled, loadTlsConfig } from "../../src/security/tls-config";

const TEST_DIR = "/tmp/tls-test-certs";

function generateTestCerts() {
	mkdirSync(TEST_DIR, { recursive: true });
	execSync(`openssl genrsa -out ${TEST_DIR}/ca.key 2048 2>/dev/null`);
	execSync(
		`openssl req -new -x509 -key ${TEST_DIR}/ca.key -out ${TEST_DIR}/ca.crt -days 365 -subj "/CN=Test CA" 2>/dev/null`,
	);
	execSync(`openssl genrsa -out ${TEST_DIR}/agent.key 2048 2>/dev/null`);
	execSync(
		`openssl req -new -key ${TEST_DIR}/agent.key -out ${TEST_DIR}/agent.csr -subj "/CN=Test Agent" 2>/dev/null`,
	);
	execSync(
		`openssl x509 -req -in ${TEST_DIR}/agent.csr -CA ${TEST_DIR}/ca.crt -CAkey ${TEST_DIR}/ca.key -CAcreateserial -out ${TEST_DIR}/agent.crt -days 365 2>/dev/null`,
	);
}

function cleanup() {
	try {
		rmSync(TEST_DIR, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

describe("TlsConfig", () => {
	afterEach(() => {
		cleanup();
		delete process.env.JABR_TLS_CA;
		delete process.env.JABR_TLS_CERT;
		delete process.env.JABR_TLS_KEY;
	});

	test("loadTlsConfig returns null when env vars not set", async () => {
		const config = await loadTlsConfig();
		expect(config).toBeNull();
	});

	test("isTlsEnabled returns false when env vars not set", () => {
		expect(isTlsEnabled()).toBe(false);
	});

	test("loadTlsConfig loads valid PEM files", async () => {
		generateTestCerts();
		process.env.JABR_TLS_CA = join(TEST_DIR, "ca.crt");
		process.env.JABR_TLS_CERT = join(TEST_DIR, "agent.crt");
		process.env.JABR_TLS_KEY = join(TEST_DIR, "agent.key");

		const config = await loadTlsConfig();
		expect(config).not.toBeNull();
		expect(config!.ca).toContain("BEGIN CERTIFICATE");
		expect(config!.cert).toContain("BEGIN CERTIFICATE");
		expect(config!.key).toContain("PRIVATE KEY");
	});

	test("isTlsEnabled returns true when all env vars set", () => {
		process.env.JABR_TLS_CA = "/some/path";
		process.env.JABR_TLS_CERT = "/some/path";
		process.env.JABR_TLS_KEY = "/some/path";
		expect(isTlsEnabled()).toBe(true);
	});

	test("loadTlsConfig returns null for missing file", async () => {
		process.env.JABR_TLS_CA = "/nonexistent/ca.crt";
		process.env.JABR_TLS_CERT = "/nonexistent/agent.crt";
		process.env.JABR_TLS_KEY = "/nonexistent/agent.key";

		const config = await loadTlsConfig();
		expect(config).toBeNull();
	});

	test("loadTlsConfig validates PEM format", async () => {
		generateTestCerts();
		// Write garbage to key file
		writeFileSync(join(TEST_DIR, "ca.crt"), "not a valid cert");

		process.env.JABR_TLS_CA = join(TEST_DIR, "ca.crt");
		process.env.JABR_TLS_CERT = join(TEST_DIR, "agent.crt");
		process.env.JABR_TLS_KEY = join(TEST_DIR, "agent.key");

		const config = await loadTlsConfig();
		expect(config).toBeNull();
	});
});
