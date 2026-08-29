import { describe, test, expect, mock } from "bun:test";
import { computeHmac, verifySignature, parseGitHubEvent } from "@adapters/http/github-webhook/signature";
import { GitHubWebhookAdapter } from "@adapters/http/github-webhook";
import type { GitHubWebhookEvent } from "@ports/github-bot-port";

// ---- Signature verification ----

describe("computeHmac / verifySignature", () => {
  const secret = "webhook-secret-123";
  const payload = JSON.stringify({
    repository: { full_name: "omnizya/jabr", default_branch: "main", name: "jabr", owner: { login: "omnizya", id: 1 } },
    sender: { login: "tester", id: 42, avatar_url: "https://example.com/avatar.png" },
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
    expect(() => verifySignature(payload, "not-a-signature", secret)).not.toThrow();
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
  sender: { login: "tester", id: 42, avatar_url: "https://example.com/avatar.png" },
  action: "opened",
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
    { sha: "abc123", message: "feat: add webhooks", author: { name: "Tester", email: "tester@example.com" } },
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
        check_run: { id: 12345, status: "completed", conclusion: "success", name: "ci/test" },
        check_run_id: 12345,
      },
    });
  });

  test("rejects a payload with an unknown event type", () => {
    const bad = JSON.stringify({
      repository: { full_name: "omnizya/jabr", default_branch: "main", name: "jabr", owner: { login: "omnizya", id: 1 } },
      sender: { login: "tester", id: 42 },
    });
    expect(() => parseGitHubEvent(bad, "", "star")).toThrow(/unsupported event type/);
  });

  test("rejects a payload missing repository", () => {
    const bad = JSON.stringify({ sender: { login: "tester", id: 42 } });
    expect(() => parseGitHubEvent(bad, "", "push")).toThrow(/missing repository/);
  });

  test("rejects non-JSON payload", () => {
    expect(() => parseGitHubEvent("not json", "", "push")).toThrow(/not valid JSON/);
  });

  test("falls back to a random UUID when deliveryId is empty", () => {
    const event = parseGitHubEvent(prPayload, "", "pull_request");
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ---- Adapter wiring ----

describe("GitHubWebhookAdapter", () => {
  test("constructor applies defaults for optional fields", () => {
    const adapter = new GitHubWebhookAdapter({ webhookSecret: "s" });
    expect(adapter).toBeDefined();
  });

  test("createComment with no token logs a warning and returns without throwing", () => {
    const warn = console.warn;
    let warned = false;
    console.warn = (...args: unknown[]) => {
      warned = true;
    };
    try {
      const adapter = new GitHubWebhookAdapter({ webhookSecret: "s" });
      adapter.createComment("omnizya/jabr", 42, "test body");
    } finally {
      console.warn = warn;
    }
    expect(warned).toBe(true);
  });

  test("updateCheckRun with no token logs a warning and returns without throwing", () => {
    const warn = console.warn;
    let warned = false;
    console.warn = (...args: unknown[]) => {
      warned = true;
    };
    try {
      const adapter = new GitHubWebhookAdapter({ webhookSecret: "s" });
      adapter.updateCheckRun(12345, "completed", "success");
    } finally {
      console.warn = warn;
    }
    expect(warned).toBe(true);
  });

  test("verifySignature delegates to the shared verifySignature function", () => {
    const adapter = new GitHubWebhookAdapter({ webhookSecret: "s" });
    const payload = JSON.stringify({ repository: { full_name: "x/y", default_branch: "main", name: "y", owner: { login: "x", id: 1 } } });
    const sig = computeHmac(payload, "s");
    expect(adapter.verifySignature(payload, sig, "ignored-override")).toBe(true);
    expect(adapter.verifySignature(payload, "sha256=bad", "ignored-override")).toBe(false);
  });

  test("handlePush delegates to agent when delegateUrl is set", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetch = mock.fn((url: string | URL, opts?: RequestInit) => {
      calls.push({ url: url as string, body: JSON.parse(opts?.body as string ?? "{}") });
      return new Response(JSON.stringify({ result: { text: "ok" } }), { status: 200 });
    });

    const adapter = new GitHubWebhookAdapter({ webhookSecret: "s", delegateUrl: "http://localhost:4000", port: 4007 });
    // Replace global fetch with our mock for this test only in the scope that
    // handlePush uses (it calls the global fetch).
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetch;

    try {
      const event: GitHubWebhookEvent = {
        id: "ev-1",
        source: "github",
        type: "push",
        payload: {
          repository: { full_name: "omnizya/jabr", default_branch: "main", name: "jabr", owner: { login: "omnizya", id: 1 } },
          sender: { login: "tester", id: 42, avatar_url: "" },
          after: "abc",
          before: "def",
          commits: [],
        },
        timestamp: new Date().toISOString(),
      };
      await adapter.handlePush(event);
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe("http://localhost:4000");
      expect(calls[0].body.method).toBe("tasks/send");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  test("handlePullRequest delegates to agent when delegateUrl is set", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetch = mock.fn((url: string | URL, opts?: RequestInit) => {
      calls.push({ url: url as string, body: JSON.parse(opts?.body as string ?? "{}") });
      return new Response(JSON.stringify({ result: { text: "ok" } }), { status: 200 });
    });

    const adapter = new GitHubWebhookAdapter({
      webhookSecret: "s",
      delegateUrl: "http://localhost:4000",
      port: 4007,
    });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetch;

    try {
      const event: GitHubWebhookEvent = {
        id: "ev-2",
        source: "github",
        type: "pull_request",
        action: "opened",
        payload: {
          repository: { full_name: "omnizya/jabr", default_branch: "main", name: "jabr", owner: { login: "omnizya", id: 1 } },
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
      expect(calls.length).toBe(1);
      expect(calls[0].body.params.message.parts[0].text).toContain("GitHub PR #1 opened on omnizya/jabr: PR title");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  test("handlePullRequest is a no-op when pull_request is absent", async () => {
    const calls: Array<{ url: string }> = [];
    const fetch = mock.fn(() => {
      calls.push({ url: "" });
      return new Response(JSON.stringify({ result: { text: "ok" } }), { status: 200 });
    });

    const adapter = new GitHubWebhookAdapter({ webhookSecret: "s", delegateUrl: "http://localhost:4000" });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetch;

    try {
      const event: GitHubWebhookEvent = {
        id: "ev-3",
        source: "github",
        type: "pull_request",
        payload: {
          repository: { full_name: "omnizya/jabr", default_branch: "main", name: "jabr", owner: { login: "omnizya", id: 1 } },
          sender: { login: "tester", id: 42, avatar_url: "" },
        },
        timestamp: new Date().toISOString(),
      };
      await adapter.handlePullRequest(event);
      expect(calls.length).toBe(0);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});
