1|import { createHmac as nodeCreateHmac } from "node:crypto";
import type { GitHubWebhookEvent, GitHubEventType, GitHubEventAction } from "@ports/github-bot-port";

/**
 * Compute the expected `sha256=<hex>` value for a payload + secret pair.
 * Synchronous so verifySignature can be a pure function.
 */
export function computeHmac(payload: string, secret: string): string {
  const hmac = nodeCreateHmac("sha256", secret);
  hmac.update(payload, "utf8");
  return "sha256=" + hmac.digest("hex");
}

/**
 * Verify a GitHub `X-Hub-Signature-256` header against the raw payload.
 *
 * Returns `false` (never throws) when the header is missing, malformed,
 * or does not match.
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  try {
    const expected = computeHmac(payload, secret);
    return expected === signature;
  } catch {
    return false;
  }
}

/**
 * Parse a GitHub webhook raw body into a `GitHubWebhookEvent`.
 *
 * Raises on unrecognised event type or a payload missing `repository`.
 */
export function parseGitHubEvent(
  raw: string,
  deliveryId: string,
  eventName: string,
): GitHubWebhookEvent {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`GitHubWebhookAdapter: payload is not valid JSON`);
  }
  if (!body || typeof body !== "object") {
    throw new Error("GitHubWebhookAdapter: payload must be a JSON object");
  }

  const repository = body.repository as Record<string, unknown> | undefined;
  if (!repository || typeof repository !== "object") {
    throw new Error("GitHubWebhookAdapter: payload missing repository");
  }

  const normalized = normalizeRepository(repository);

  // Map a raw GitHub event name to our GitHubEventType union.
  const type = toEventType(eventName);
  const action = toEventAction(body.action as string | undefined);

  const payload = buildPayload(body, type, normalized);

  return {
    id: deliveryId || crypto.randomUUID(),
    source: "github",
    type,
    action,
    payload,
    timestamp: body.head_commit && typeof body.head_commit === "object"
      ? String((body.head_commit as Record<string, unknown>).timestamp ?? "")
      : new Date().toISOString(),
  };
}

// ---- internal helpers ----

function normalizeRepository(raw: Record<string, unknown>): NonNullable<GitHubWebhookEvent["payload"]["repository"]> {
  const owner = raw.owner as Record<string, unknown> | undefined;
  return {
    full_name: String(raw.full_name ?? ""),
    default_branch: String(raw.default_branch ?? "main"),
    name: String(raw.name ?? ""),
    owner: {
      login: String(owner?.login ?? ""),
      id: Number(owner?.id ?? 0),
    },
  };
}

function toEventType(raw: string): GitHubEventType {
  if (raw === "pushes" || raw === "push") return "push";
  if (raw === "pull_request" || raw === "pull_request_review") return "pull_request";
  if (raw === "issues" || raw === "issue_comment") return "issues";
  if (raw === "check_run") return "check_run";
  if (raw === "release") return "release";
  throw new Error(`GitHubWebhookAdapter: unsupported event type "${raw}"`);
}

function toEventAction(raw?: string): GitHubEventAction | undefined {
  if (!raw) return undefined;
  if (
    raw === "opened" ||
    raw === "synchronize" ||
    raw === "closed" ||
    raw === "reopened" ||
    raw === "labeled" ||
    raw === "unlabeled" ||
    raw === "assigned" ||
    raw === "unassigned"
  ) {
    return raw as GitHubEventAction;
  }
  return undefined;
}

function buildPayload(
  body: Record<string, unknown>,
  type: GitHubEventType,
  repo: NonNullable<GitHubWebhookEvent["payload"]["repository"]>,
): GitHubWebhookEvent["payload"] {
  const sender = body.sender as Record<string, unknown> | undefined;
  const base: GitHubWebhookEvent["payload"] = {
    repository: repo,
    sender: sender
      ? {
          login: String(sender.login ?? ""),
          id: Number(sender.id ?? 0),
          avatar_url: String(sender.avatar_url ?? ""),
        }
      : { login: "", id: 0, avatar_url: "" },
  };

  // Pull request fields.
  const pr = body.pull_request as Record<string, unknown> | undefined;
  if (pr && (type === "pull_request" || type === "issues")) {
    const prHead = pr.head as Record<string, unknown> | undefined;
    const prBase = pr.base as Record<string, unknown> | undefined;
    base.pull_request = {
      number: Number(pr.number ?? 0),
      title: String(pr.title ?? ""),
      state: String(pr.state ?? ""),
      head: {
        sha: String(prHead?.sha ?? ""),
        branch: { name: String(prHead?.branch?.name ?? "") },
      },
      base: {
        sha: String(prBase?.sha ?? ""),
        branch: { name: String(prBase?.branch?.name ?? "") },
      },
      body: String(pr.body ?? ""),
      user: { login: String(pr.user?.login ?? "") },
    };
  }

  // Issue fields.
  const issue = body.issue as Record<string, unknown> | undefined;
  if (issue && (type === "issues" || type === "pull_request")) {
    const labels = issue.labels as Array<Record<string, unknown>> | undefined;
    base.issue = {
      number: Number(issue.number ?? 0),
      title: String(issue.title ?? ""),
      body: String(issue.body ?? ""),
      state: String(issue.state ?? ""),
      user: { login: String(issue.user?.login ?? "") },
      labels: labels?.map((l) => ({ name: String(l.name ?? "") })) ?? [],
    };
  }

  // Check run fields.
  const cr = body.check_run as Record<string, unknown> | undefined;
  if (cr) {
    const suite = cr.check_suite as Record<string, unknown> | undefined;
    const crCon = cr.conclusion as GitHubWebhookEvent["payload"]["check_run"]["conclusion"] | undefined;
    base.check_run = {
      id: Number(cr.id ?? 0),
      status: (cr.status as "queued" | "in_progress" | "completed" | undefined) ?? "queued",
      conclusion: crCon ?? null,
      name: String(cr.name ?? ""),
      check_suite: {
        id: Number(suite?.id ?? 0),
        pull_requests: [],
      },
    };
    base.check_run_id = Number(cr.id ?? 0);
  }

  // Release fields.
  const release = body.release as Record<string, unknown> | undefined;
  if (release) {
    base.release = {
      tag_name: String(release.tag_name ?? ""),
      name: String(release.name ?? ""),
      body: String(release.body ?? ""),
    };
  }

  // Push-only fields.
  if (type === "push") {
    base.after = String(body.after ?? "");
    base.before = String(body.before ?? "");
    const commits = body.commits as Array<Record<string, unknown>> | undefined;
    if (commits) {
      base.commits = commits.map((c) => ({
        sha: String(c.sha ?? ""),
        message: String(c.message ?? ""),
        author: {
          name: String(c.author?.name ?? ""),
          email: String(c.author?.email ?? ""),
        },
      }));
    }
  }

  return base;
}
