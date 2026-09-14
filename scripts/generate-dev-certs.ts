/**
 * generate-dev-certs.ts — Generate self-signed CA + agent certificates for development mTLS.
 *
 * Usage: bun scripts/generate-dev-certs.ts
 *
 * Generates:
 *   - certs/ca.key, certs/ca.crt — Certificate Authority
 *   - certs/agent.key, certs/agent.crt — Agent certificate (signed by CA)
 *
 * Environment variables set after generation:
 *   - JABR_TLS_CA=certs/ca.crt
 *   - JABR_TLS_CERT=certs/agent.crt
 *   - JABR_TLS_KEY=certs/agent.key
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CERTS_DIR = "certs";
const CA_KEY = join(CERTS_DIR, "ca.key");
const CA_CRT = join(CERTS_DIR, "ca.crt");
const AGENT_KEY = join(CERTS_DIR, "agent.key");
const AGENT_CSR = join(CERTS_DIR, "agent.csr");
const AGENT_CRT = join(CERTS_DIR, "agent.crt");

function ensureDir() {
	if (!existsSync(CERTS_DIR)) {
		mkdirSync(CERTS_DIR, { recursive: true });
	}
}

function run(cmd: string): string {
	return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function main() {
	console.log("🔐 Generating development mTLS certificates...\n");
	ensureDir();

	// Generate CA key + cert
	console.log("1. Generating CA key...");
	run(`openssl genrsa -out ${CA_KEY} 4096`);

	console.log("2. Generating CA certificate...");
	run(
		`openssl req -new -x509 -key ${CA_KEY} -out ${CA_CRT} -days 3650 -subj "/CN=Jabr Dev CA/O=Jabr/C=US"`,
	);

	// Generate agent key + CSR
	console.log("3. Generating agent key...");
	run(`openssl genrsa -out ${AGENT_KEY} 2048`);

	console.log("4. Generating agent CSR...");
	run(
		`openssl req -new -key ${AGENT_KEY} -out ${AGENT_CSR} -subj "/CN=jabr-agent/O=Jabr/C=US"`,
	);

	// Sign agent cert with CA
	console.log("5. Signing agent certificate with CA...");
	run(
		`openssl x509 -req -in ${AGENT_CSR} -CA ${CA_CRT} -CAkey ${CA_KEY} -CAcreateserial -out ${AGENT_CRT} -days 365 -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")`,
	);

	// Clean up CSR
	run(`rm ${AGENT_CSR}`);

	console.log("\n✅ Certificates generated:");
	console.log(`   CA:    ${CA_CRT}`);
	console.log(`   Cert:  ${AGENT_CRT}`);
	console.log(`   Key:   ${AGENT_KEY}`);

	console.log("\n📋 To enable mTLS, set these environment variables:");
	console.log(`   export JABR_TLS_CA=${CA_CRT}`);
	console.log(`   export JABR_TLS_CERT=${AGENT_CRT}`);
	console.log(`   export JABR_TLS_KEY=${AGENT_KEY}`);

	console.log("\n🔒 File permissions:");
	run(`chmod 600 ${CA_KEY} ${AGENT_KEY}`);
	run(`chmod 644 ${CA_CRT} ${AGENT_CRT}`);
	console.log("   Private keys: 600 (owner read/write only)");
	console.log("   Certificates: 644 (world readable)");
}

if (import.meta.main) {
	main();
}
