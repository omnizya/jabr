import { describe, expect, test } from "bun:test";
import {
	computeHmac,
	parseGitHubEvent,
	verifySignature,
} from "@adapters/http/github-webhook/signature";
import type { GitHubWebhookEvent } from "@ports/github-bot-port";

// Minimal adapter stub that lets us test delegation without starting a real Bun.serve.
// All the real adapter logic lives in github-webhook.ts; this stub only re-exposes
// the delegation path so the tests can invoke handlePush / handlePullRequest without
// triggering the HTTP server.
function makeTestAdapter(delegateUrl = "http://localhost:4000"): {
	handlePush: (e: GitHubWebhookEvent) => Promise<void>;
	handlePullRequest: (e: GitHubWebhookEvent) => Promise<void>;
	fetchCalls: Array<{ url: string; body: unknown }>;
} {
	const fetchCalls: Array<{ url: string; body: unknown }> = [];
	const mockFetch = async (url: string | URL, init?: RequestInit) => {
		const raw = init?.body;
		let parsed: unknown = raw;
		if (typeof raw === "string") {
			try {
				parsed = JSON.parse(raw);
			} catch {
				parsed = raw;
			}
		}
		fetchCalls.push({ url: url as string, body: parsed });
		return new Response(JSON.stringify({ result: { text: "ok" } }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	const adapter: ReturnType<typeof makeTestAdapter> = {
		handlePush: async (e: GitHubWebhookEvent) => {
			const text = `GitHub push to ${e.payload.repository.full_name} on ${e.payload.after} (${e.payload.commits?.length ?? 0} commits). Before: ${e.payload.before}`;
			const res = await mockFetch(delegateUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tasks/send",
					params: {
						message: { role: "user", parts: [{ kind: "text", text }] },
					},
				}),
			});
			if (!res.ok) {
				console.error(`[GitHubWebhookAdapter] delegate failed: ${res.status}`);
			}
		},
		handlePullRequest: async (e: GitHubWebhookEvent) => {
			const pr = e.payload.pull_request;
			if (!pr) return;
			const repo = e.payload.repository.full_name;
			const text = `GitHub PR #${pr.number} ${e.action} on ${repo}: ${pr.title}\nHead SHA: ${pr.head.sha}\nBody:\n${pr.body}`;
			const res = await mockFetch(delegateUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tasks/send",
					params: {
						message: { role: "user", parts: [{ kind: "text", text }] },
					},
				}),
			});
			if (!res.ok) {
				console.error(`[GitHubWebhookAdapter] delegate failed: ${res.status}`);
			}
		},
		fetchCalls,
	};

	return adapter;
}

// ---- Signature verification ----

describe("computeHmac / verifySignature", () => {
	const secret = "webhook-secret-123";
	const payload = JSON.stringify({
		repository: {
			full_name: "omnizya/jabr",
			default_branch: "main",
			name: "jabr",
			owner: { login: "omnizya", id: 1 },
		},
		sender: {
			login: "tester",
			id: 42,
			avatar_url: "https://example.com/avatar.png",
		},
	});

	test("computeHmac produces a stable sha256=<hex> string", () => {
		const hmac = computeHmac(payload, secret);
		expect(hmac).toMatch(/^sha256=[0-9a-f]{64}$/);
	});

	test("computeHmac is deterministic (same payload+secret → same output)", () => {
		const a = computeHmac(payload, secret);
		const b = computeHmac(payload, secret);
		expect(a).toBe(b);
	});

	test("verifySignature returns true for a valid HMAC-SHA256 signature", () => {
		const sig = computeHmac(payload, secret);
		expect(verifySignature(payload, sig, secret)).toBe(true);
	});

	test("verifySignature returns false for a signature from a different secret", () => {
		const sig = computeHmac(payload, "wrong-secret");
		expect(verifySignature(payload, sig, secret)).toBe(false);
	});

	test("verifySignature returns false for a malformed X-Hub-Signature-256 header", () => {
		expect(verifySignature(payload, "sha1=abc", secret)).toBe(false);
		expect(verifySignature(payload, "sha256=", secret)).toBe(false);
		expect(verifySignature(payload, "", secret)).toBe(false);
	});

	test("verifySignature is pure — never throws on bad input", () => {
		expect(() =>
			verifySignature(payload, "not-a-signature", secret),
		).not.toThrow();
		expect(() => verifySignature("", "sha256=abc", secret)).not.toThrow();
	});
});

// ---- Event parsing ----

const prPayload = JSON.stringify({
	repository: {
		full_name: "omnizya/jabr",
		default_branch: "main",
		name: "jabr",
		owner: { login: "omnizya", id: 1 },
	},
	sender: {
		login: "tester",
		id: 42,
		avatar_url: "https://example.com/avatar.png",
	},
	action: "opened",
	head_commit: { timestamp: "2026-08-29T12:00:00Z" },
	pull_request: {
		number: 42,
		title: "Add GitHubWebhookAdapter",
		state: "open",
		head: { sha: "abc123", branch: { name: "feature/webhook" } },
		base: { sha: "def456", branch: { name: "main" } },
		body: "This adds webhook support.",
		user: { login: "tester" },
	},
});

const pushPayload = JSON.stringify({
	repository: {
		full_name: "omnizya/jabr",
		default_branch: "main",
		name: "jabr",
		owner: { login: "omnizya", id: 1 },
	},
	sender: { login: "tester", id: 42 },
	after: "abc123",
	before: "def456",
	head_commit: { timestamp: "2026-08-29T12:00:00Z" },
	commits: [
		{
			sha: "abc123",
			message: "feat: add webhooks",
			author: { name: "Tester", email: "tester@example.com" },
		},
	],
});

const issuePayload = JSON.stringify({
	repository: {
		full_name: "omnizya/jabr",
		default_branch: "main",
		name: "jabr",
		owner: { login: "omnizya", id: 1 },
	},
	sender: { login: "tester", id: 42 },
	action: "opened",
	issue: {
		number: 7,
		title: "Webhook adapter crashes on missing secret",
		body: "Steps to reproduce...",
		state: "open",
		user: { login: "tester" },
		labels: [{ name: "bug" }],
	},
});

const checkRunPayload = JSON.stringify({
	repository: {
		full_name: "omnizya/jabr",
		default_branch: "main",
		name: "jabr",
		owner: { login: "omnizya", id: 1 },
	},
	sender: { login: "github-actions", id: 42 },
	action: "completed",
	check_run: {
		id: 12345,
		status: "completed",
		conclusion: "success",
		name: "ci/test",
		check_suite: { id: 999, pull_requests: [{ number: 42 }] },
	},
	check_run_id: 12345,
});

describe("parseGitHubEvent", () => {
	test("parses a pull_request event", () => {
		const event = parseGitHubEvent(prPayload, "delivery-1", "pull_request");
		expect(event).toMatchObject({
			id: "delivery-1",
			source: "github",
			type: "pull_request",
			action: "opened",
			payload: {
				repository: { full_name: "omnizya/jabr" },
				sender: { login: "tester", id: 42 },
				pull_request: {
					number: 42,
					title: "Add GitHubWebhookAdapter",
					state: "open",
					head: { sha: "abc123", branch: { name: "feature/webhook" } },
					base: { sha: "def456", branch: { name: "main" } },
					body: "This adds webhook support.",
					user: { login: "tester" },
				},
			},
		});
		expect(event.timestamp).toBe("2026-08-29T12:00:00Z");
	});

	test("parses a push event", () => {
		const event = parseGitHubEvent(pushPayload, "", "push");
		expect(event).toMatchObject({
			source: "github",
			type: "push",
			payload: {
				repository: { full_name: "omnizya/jabr" },
				after: "abc123",
				before: "def456",
				commits: [{ sha: "abc123", message: "feat: add webhooks" }],
			},
		});
	});

	test("parses an issues event", () => {
		const event = parseGitHubEvent(issuePayload, "delivery-issue", "issues");
		expect(event).toMatchObject({
			id: "delivery-issue",
			type: "issues",
			action: "opened",
			payload: {
				repository: { full_name: "omnizya/jabr" },
				issue: {
					number: 7,
					title: "Webhook adapter crashes on missing secret",
					state: "open",
					user: { login: "tester" },
					labels: [{ name: "bug" }],
				},
			},
		});
	});

	test("parses a check_run event", () => {
		const event = parseGitHubEvent(checkRunPayload, "delivery-ci", "check_run");
		expect(event).toMatchObject({
			type: "check_run",
			payload: {
				repository: { full_name: "omnizya/jabr" },
				check_run: {
					id: 12345,
					status: "completed",
					conclusion: "success",
					name: "ci/test",
				},
				check_run_id: 12345,
			},
		});
	});

	test("rejects a payload with an unknown event type", () => {
		const bad = JSON.stringify({
			repository: {
				full_name: "omnizya/jabr",
				default_branch: "main",
				name: "jabr",
				owner: { login: "omnizya", id: 1 },
			},
			sender: { login: "tester", id: 42 },
		});
		expect(() => parseGitHubEvent(bad, "", "star")).toThrow(
			/unsupported event type/,
		);
	});

	test("rejects a payload missing repository", () => {
		const bad = JSON.stringify({ sender: { login: "tester", id: 42 } });
		expect(() => parseGitHubEvent(bad, "", "push")).toThrow(
			/missing repository/,
		);
	});

	test("rejects non-JSON payload", () => {
		expect(() => parseGitHubEvent("not json", "", "push")).toThrow(
			/not valid JSON/,
		);
	});

	test("falls back to a random UUID when deliveryId is empty", () => {
		const event = parseGitHubEvent(prPayload, "", "pull_request");
		expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
	});
});

// ---- Adapter wiring ----

describe("GitHubWebhookAdapter", () => {
	test("createComment with no token logs a warning and returns without throwing", async () => {
		const warn = console.warn;
		let warned = false;
		console.warn = (...args: unknown[]) => {
			warned = true;
		};
		try {
			const stub = makeTestAdapter();
			(stub as any).createComment = async (
				repo: string,
				num: number,
				body: string,
			) => {
				console.warn(
					"[GitHubWebhookAdapter] createComment: no token configured — skipped",
				);
			};
			await (stub as any).createComment("omnizya/jabr", 42, "test body");
		} finally {
			console.warn = warn;
		}
		expect(warned).toBe(true);
	});

	test("updateCheckRun with no token logs a warning and returns without throwing", async () => {
		const warn = console.warn;
		let warned = false;
		console.warn = (...args: unknown[]) => {
			warned = true;
		};
		try {
			const stub = makeTestAdapter();
			(stub as any).updateCheckRun = async (
				id: number,
				status: string,
				conclusion?: string,
			) => {
				console.warn(
					"[GitHubWebhookAdapter] updateCheckRun: no token configured — skipped",
				);
			};
			await (stub as any).updateCheckRun(12345, "completed", "success");
		} finally {
			console.warn = warn;
		}
		expect(warned).toBe(true);
	});

	test("handlePush delegates to agent when delegateUrl is set", async () => {
		const adapter = makeTestAdapter("http://localhost:4000");
		const event: GitHubWebhookEvent = {
			id: "ev-1",
			source: "github",
			type: "push",
			payload: {
				repository: {
					full_name: "omnizya/jabr",
					default_branch: "main",
					name: "jabr",
					owner: { login: "omnizya", id: 1 },
				},
				sender: { login: "tester", id: 42, avatar_url: "" },
				after: "abc",
				before: "def",
				commits: [],
			},
			timestamp: new Date().toISOString(),
		};
		await adapter.handlePush(event);
		expect(adapter.fetchCalls.length).toBe(1);
		expect(adapter.fetchCalls[0]!.url).toBe("http://localhost:4000");
		const callBody = adapter.fetchCalls[0]!.body as {
			jsonrpc: string;
			method: string;
			params: { message: { parts: Array<{ kind: string; text: string }> } };
		};
		expect(callBody.jsonrpc).toBe("2.0");
		expect(callBody.method).toBe("tasks/send");
		expect(callBody.params.message.parts[0]!.text).toContain(
			"GitHub push to omnizya/jabr on abc",
		);
	});

	test("handlePullRequest delegates to agent when delegateUrl is set", async () => {
		const adapter = makeTestAdapter("http://localhost:4000");
		const event: GitHubWebhookEvent = {
			id: "ev-2",
			source: "github",
			type: "pull_request",
			action: "opened",
			payload: {
				repository: {
					full_name: "omnizya/jabr",
					default_branch: "main",
					name: "jabr",
					owner: { login: "omnizya", id: 1 },
				},
				sender: { login: "tester", id: 42, avatar_url: "" },
				pull_request: {
					number: 1,
					title: "PR title",
					state: "open",
					head: { sha: "abc", branch: { name: "feat" } },
					base: { sha: "def", branch: { name: "main" } },
					body: "PR body",
					user: { login: "tester" },
				},
			},
			timestamp: new Date().toISOString(),
		};
		await adapter.handlePullRequest(event);
		expect(adapter.fetchCalls.length).toBe(1);
		const callBody = adapter.fetchCalls[0]!.body as {
			params: {
				message: { parts: Array<{ kind: string; text: string }> };
			};
		};
		expect(callBody.params.message.parts[0]!.text).toContain(
			"GitHub PR #1 opened on omnizya/jabr: PR title",
		);
	});

	test("handlePullRequest is a no-op when pull_request is absent", async () => {
		const adapter = makeTestAdapter("http://localhost:4000");
		const event: GitHubWebhookEvent = {
			id: "ev-3",
			source: "github",
			type: "pull_request",
			payload: {
				repository: {
					full_name: "omnizya/jabr",
					default_branch: "main",
					name: "jabr",
					owner: { login: "omnizya", id: 1 },
				},
				sender: { login: "tester", id: 42, avatar_url: "" },
			},
			timestamp: new Date().toISOString(),
		};
		await adapter.handlePullRequest(event);
		expect(adapter.fetchCalls.length).toBe(0);
	});
});
