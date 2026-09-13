/**
 * a2a-client-tls.test.ts — Tests for A2AClient with mTLS support.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { A2AClient } from "@adapters/a2a/client";
import { V1_METHOD_SEND_MESSAGE } from "@constants/a2a-v1";

const TEST_DIR = "/tmp/tls-client-test";

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
		`openssl x509 -req -in ${TEST_DIR}/agent.csr -CA ${TEST_DIR}/ca.crt -CAkey ${TEST_DIR}/ca.key -CAcreateserial -out ${TEST_DIR}/agent.crt -days 365 -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1") 2>/dev/null`,
	);
}

function cleanup() {
	try {
		rmSync(TEST_DIR, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

describe("A2AClient — mTLS", () => {
	const servers: any[] = [];

	afterEach(() => {
		cleanup();
		for (const s of servers) {
			try {
				s.stop();
			} catch {
				/* ignore */
			}
		}
		servers.length = 0;
		delete process.env.JABR_TLS_CA;
		delete process.env.JABR_TLS_CERT;
		delete process.env.JABR_TLS_KEY;
	});

	test("delegateTask works without TLS (no env vars)", async () => {
		// Start a plain HTTP server
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			async fetch(req) {
				const body = await req.json();
				// Verify v1.0 SendMessage method
				expect(body.method).toBe(V1_METHOD_SEND_MESSAGE);
				return Response.json({
					jsonrpc: "2.0",
					id: body.id,
					result: {
						task: {
							taskId: "task-1",
							status: {
								state: "completed",
								message: {
									role: "agent",
									messageId: "msg-1",
									parts: [{ kind: "text", text: "hello from test" }],
								},
							},
						},
					},
				});
			},
		});
		servers.push(server);

		const client = new A2AClient();
		const result = await client.delegateTask(
			`http://127.0.0.1:${server.port}/`,
			"test task",
		);
		expect(result).toBe("hello from test");
	});

	test("delegateTask connects via TLS with CA verification", async () => {
		generateTestCerts();
		process.env.JABR_TLS_CA = `${TEST_DIR}/ca.crt`;
		process.env.JABR_TLS_CERT = `${TEST_DIR}/agent.crt`;
		process.env.JABR_TLS_KEY = `${TEST_DIR}/agent.key`;

		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			tls: {
				key: await Bun.file(`${TEST_DIR}/agent.key`).text(),
				cert: await Bun.file(`${TEST_DIR}/agent.crt`).text(),
			},
			async fetch(req) {
				const body = await req.json();
				// Verify v1.0 SendMessage method
				expect(body.method).toBe(V1_METHOD_SEND_MESSAGE);
				return Response.json({
					jsonrpc: "2.0",
					id: body.id,
					result: {
						task: {
							taskId: "task-1",
							status: {
								state: "completed",
								message: {
									role: "agent",
									messageId: "msg-1",
									parts: [{ kind: "text", text: "secure hello" }],
								},
							},
						},
					},
				});
			},
		});
		servers.push(server);

		const client = new A2AClient();
		const result = await client.delegateTask(
			`https://127.0.0.1:${server.port}/`,
			"test task",
		);
		expect(result).toBe("secure hello");
	});

	test("fetchCard connects via TLS with CA verification", async () => {
		generateTestCerts();
		process.env.JABR_TLS_CA = `${TEST_DIR}/ca.crt`;
		process.env.JABR_TLS_CERT = `${TEST_DIR}/agent.crt`;
		process.env.JABR_TLS_KEY = `${TEST_DIR}/agent.key`;

		const card = {
			name: "test-agent",
			description: "Test",
			url: "https://localhost:0",
			version: "0.1.0",
			capabilities: {},
			skills: [],
		};

		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			tls: {
				key: await Bun.file(`${TEST_DIR}/agent.key`).text(),
				cert: await Bun.file(`${TEST_DIR}/agent.crt`).text(),
			},
			fetch(req) {
				const url = new URL(req.url);
				// Try v1.0 path first, then legacy
				if (
					url.pathname === "/.well-known/agent.json" ||
					url.pathname === "/.well-known/agent-card.json"
				) {
					return Response.json(card);
				}
				return new Response("Not found", { status: 404 });
			},
		});
		servers.push(server);

		const client = new A2AClient();
		const result = await client.fetchCard(`https://127.0.0.1:${server.port}`);
		expect(result).not.toBeNull();
		expect(result!.name).toBe("test-agent");
	});
});
