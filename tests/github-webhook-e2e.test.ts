import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { GitHubWebhookAdapter } from "@adapters/http/github-webhook";

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GITHUB WEBHOOK → ORACLE REVIEW → COMMENT
// ═══════════════════════════════════════════════════════════════════════════════
//
// Integration test for the GitHub webhook adapter. Spins up a test adapter
// instance on a free port, points its delegateUrl at a tiny capture server
// (so we can verify the A2A delegation payload without mocking global fetch),
// then fires a signed pull_request webhook and asserts the full parse →
// delegate pipeline.

const WEBHOOK_SECRET = "test-webhook-secret";
const GITHUB_EVENT = "pull_request";

function prPayload(): string {
	return JSON.stringify({
		repository: {
			full_name: "omnizya/jabr",
			default_branch: "main",
			name: "jabr",
			owner: { login: "omnizya", id: 1 },
		},
		sender: {
			login: "octocat",
			id: 42,
			avatar_url: "https://github.com/images/error/octocat_happy.gif",
		},
		action: "opened",
		pull_request: {
			number: 42,
			title: "Add e2e webhook test",
			state: "open",
			head: { sha: "abc123def456", branch: { name: "feat/e2e-webhook" } },
			base: { sha: "def789", branch: { name: "main" } },
			body: "Please review the new E2E webhook test adapter.",
			user: { login: "octocat" },
		},
	});
}

function sign(raw: string, secret: string): string {
	return (
		"sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex")
	);
}

describe("6 · GitHub PR → Oracle review → comment (integration)", () => {
	let delegateServer: ReturnType<typeof Bun.serve> | null = null;
	let delegatePort = 0;
	let delegateCalls: Array<{ body: unknown }> = [];
	let adapter: GitHubWebhookAdapter;
	let adapterServer: ReturnType<typeof Bun.serve> | null = null;
	let adapterPort = 0;

	beforeAll(async () => {
		// ── Delegate capture server ──────────────────────────────────────────────
		// A tiny Bun.serve that records every POST body sent by the adapter's
		// delegateToAgent. This replaces the mock-global-fetch approach so the
		// live agent servers (ports 4000-4006) are never affected.
		delegateCalls = [];
		delegateServer = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/" || req.method !== "POST") {
					return new Response("not found", { status: 404 });
				}
				let raw: string;
				try {
					raw = await req.text();
				} catch {
					return new Response("bad request", { status: 400 });
				}
				let body: unknown;
				try {
					body = JSON.parse(raw);
				} catch {
					body = raw;
				}
				delegateCalls.push({ body });
				return Response.json({ jsonrpc: "2.0", result: { text: "ok" } });
			},
		});
		delegatePort = delegateServer.port!;

		// ── GitHub webhook adapter (test instance) ───────────────────────────────
		adapter = new GitHubWebhookAdapter({
			webhookSecret: WEBHOOK_SECRET,
			token: undefined, // no token → createComment is a no-op (logged warning)
			port: 0, // let the OS pick a free port
			delegateUrl: `http://localhost:${delegatePort}`,
			defaultRepo: "omnizya/jabr",
		});
		adapter.start();
		adapterPort = (adapter as any).server?.port ?? 0;
		if (!adapterPort)
			throw new Error("GitHubWebhookAdapter did not bind a port");
	});

	afterAll(() => {
		adapter.stop();
		delegateServer?.stop();
		delegateCalls = [];
	});

	// ── 6a. Signed PR webhook is accepted ──────────────────────────────────────

	test("POST signed pull_request event → 200 OK", async () => {
		const raw = prPayload();
		const sig = sign(raw, WEBHOOK_SECRET);
		const res = await fetch(`http://localhost:${adapterPort}/webhook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": sig,
				"X-GitHub-Event": GITHUB_EVENT,
				"X-GitHub-Delivery": "e2e-pr-opened-001",
			},
			body: raw,
		});
		expect(res.status).toBe(200);
	});

	// ── 6b. PR payload is delegated to the orchestrator via A2A ────────────────

	test("adapter delegates PR to delegateUrl with correct A2A payload", async () => {
		const raw = prPayload();
		const sig = sign(raw, WEBHOOK_SECRET);
		await fetch(`http://localhost:${adapterPort}/webhook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": sig,
				"X-GitHub-Event": GITHUB_EVENT,
				"X-GitHub-Delivery": "e2e-pr-delegate-002",
			},
			body: raw,
		});

		// Wait a tick for the fire-and-forget delegation to arrive.
		await Bun.sleep(50);

		expect(delegateCalls.length).toBeGreaterThanOrEqual(1);
		const lastCall = delegateCalls[delegateCalls.length - 1]!;
		expect(lastCall.body).toBeInstanceOf(Object);
		const envelope = lastCall.body as {
			jsonrpc?: string;
			method?: string;
			params?: { message?: { parts?: Array<{ kind: string; text: string }> } };
		};
		expect(envelope.jsonrpc).toBe("2.0");
		expect(envelope.method).toBe("tasks/send");
		const text = envelope?.params?.message?.parts?.[0]?.text ?? "";
		expect(text).toContain(
			"GitHub PR #42 opened on omnizya/jabr: Add e2e webhook test",
		);
		expect(text).toContain("Head SHA: abc123def456");
	});

	// ── 6c. createComment is callable (no-op without token) ────────────────────

	test("createComment without token logs a warning and returns without throwing", async () => {
		const warn = console.warn;
		let warned = false;
		console.warn = (...args: unknown[]) => {
			if (typeof args[0] === "string" && args[0].includes("createComment"))
				warned = true;
			warn(...args);
		};
		try {
			await adapter.createComment("omnizya/jabr", 42, "mock review body");
			expect(warned).toBe(true);
		} finally {
			console.warn = warn;
		}
	});

	// ── 6d. Bad signature → 401 ─────────────────────────────────────────────────

	test("POST with wrong signature → 401 Unauthorized", async () => {
		const raw = prPayload();
		const res = await fetch(`http://localhost:${adapterPort}/webhook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": sign(raw, "wrong-secret"),
				"X-GitHub-Event": GITHUB_EVENT,
			},
			body: raw,
		});
		expect(res.status).toBe(401);
	});
});
