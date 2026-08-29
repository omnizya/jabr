import type { GitHubBotPort, GitHubWebhookEvent } from "@ports/github-bot-port";
import { verifySignature, parseGitHubEvent } from "./github-webhook/signature.ts";

export interface GitHubWebhookAdapterConfig {
  webhookSecret: string;
  /** Base GitHub API URL. Default https://api.github.com */
  apiBaseUrl?: string;
  /** GitHub token for posting comments / updating check runs. Optional for read-only. */
  token?: string;
  /** Bun.serve port. Default 4007. */
  port?: number;
  /** Which agent URL to delegate PR/issue/push events to. */
  delegateUrl?: string;
  /** Owner/repo used for check_run API calls (e.g. "omnizya/jabr"). Updated from events. */
  defaultRepo?: string;
}

export class GitHubWebhookAdapter implements GitHubBotPort {
  private readonly webhookSecret: string;
  private readonly apiBaseUrl: string;
  private readonly token: string;
  private readonly port: number;
  private readonly delegateUrl: string;
  private readonly defaultRepo: string;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: GitHubWebhookAdapterConfig) {
    this.webhookSecret = config.webhookSecret;
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.token = config.token ?? "";
    this.port = config.port ?? 4007;
    this.delegateUrl = config.delegateUrl ?? "";
    this.defaultRepo = config.defaultRepo ?? "omnizya/jabr";
  }

  // ---- Server lifecycle ----

  start(): void {
    if (this.server) return;
    const self = this;
    this.server = Bun.serve({
      port: this.port,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/webhook" || req.method !== "POST") {
          return new Response("Not found", { status: 404 });
        }
        // Consume the body as text (signature verification needs the raw bytes).
        let raw: string;
        try {
          raw = await req.text();
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        // 1. Signature verification — the adapter's secret is baked into the
        // config, so verify against it directly.
        const sig = req.headers.get("X-Hub-Signature-256") ?? "";
        if (!verifySignature(raw, sig, self.webhookSecret)) {
          console.warn("[GitHubWebhookAdapter] rejected: bad signature");
          return new Response("Unauthorized", { status: 401 });
        }

        // 2. Parse
        let event: GitHubWebhookEvent;
        try {
          event = parseGitHubEvent(raw, req.headers.get("X-GitHub-Delivery") ?? "", req.headers.get("X-GitHub-Event") ?? "");
        } catch (e) {
          console.error("[GitHubWebhookAdapter] parse failed:", e);
          return new Response("Bad payload", { status: 400 });
        }

        // 3. Route to handler (fire-and-forget so the HTTP response returns fast)
        self.route(event).catch((e: unknown) =>
          console.error(`[GitHubWebhookAdapter] handler error for ${event.id}:`, e),
        );

        return new Response("OK", { status: 200 });
      },
    });
    console.log(`[GitHubWebhookAdapter] listening on http://localhost:${this.port}/webhook`);
  }

  // ---- Event dispatch (fire-and-forget) ----

  private async route(event: GitHubWebhookEvent): Promise<void> {
    switch (event.type) {
      case "push":
        await this.handlePush(event);
        break;
      case "pull_request":
        await this.handlePullRequest(event);
        break;
      case "issues":
        await this.handleIssue(event);
        break;
      case "check_run":
        await this.handleCheckRun(event);
        break;
      case "release":
        console.log(`[GitHubWebhookAdapter] release ${event.payload.release?.tag_name} on ${event.payload.repository.full_name}`);
        break;
      default:
        console.warn(`[GitHubWebhookAdapter] unhandled event type: ${event.type}`);
    }
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }

  // ---- Verification (GitHubBotPort) ----

  verifySignature(payload: string, signature: string, _secret: string): boolean {
    // The adapter always uses its own configured secret; ignoring the passed _secret
    // keeps the port surface simple and avoids accidental misconfiguration at call sites.
    return verifySignature(payload, signature, this.webhookSecret);
  }

  // ---- Event handlers (GitHubBotPort) ----

  async handlePush(event: GitHubWebhookEvent): Promise<void> {
    const repo = event.payload.repository.full_name;
    const after = event.payload.after;
    const commits = event.payload.commits?.length ?? 0;
    console.log(`[GitHubWebhookAdapter] push ${repo} ${after} (${commits} commits)`);
    if (this.delegateUrl) {
      await this.delegateToAgent(`GitHub push to ${repo} on ${after} (${commits} commits). Before: ${event.payload.before}`);
    }
  }

  async handlePullRequest(event: GitHubWebhookEvent): Promise<void> {
    const pr = event.payload.pull_request;
    if (!pr) return;
    const repo = event.payload.repository.full_name;
    const action = event.action;
    console.log(`[GitHubWebhookAdapter] PR #${pr.number} ${action} on ${repo}`)  ;
    if (this.delegateUrl) {
      await this.delegateToAgent(
        `GitHub PR #${pr.number} ${action} on ${repo}: ${pr.title}\nHead SHA: ${pr.head.sha}\nBody:\n${pr.body}`,
      );
    }
  }

  async handleIssue(event: GitHubWebhookEvent): Promise<void> {
    const issue = event.payload.issue;
    if (!issue) return;
    const repo = event.payload.repository.full_name;
    const action = event.action;
    console.log(`[GitHubWebhookAdapter] issue #${issue.number} ${action} on ${repo}`);
    if (this.delegateUrl) {
      await this.delegateToAgent(
        `GitHub issue #${issue.number} ${action} on ${repo}: ${issue.title}\nBody:\n${issue.body}`,
      );
    }
  }

  async handleCheckRun(event: GitHubWebhookEvent): Promise<void> {
    const cr = event.payload.check_run;
    if (!cr) return;
    console.log(`[GitHubWebhookAdapter] check_run ${cr.name} ${cr.status} (${cr.conclusion})`);
    if (this.delegateUrl) {
      await this.delegateToAgent(
        `GitHub check_run ${cr.name} ${cr.status}/${cr.conclusion} on ${event.payload.repository.full_name}`,
      );
    }
  }

  // ---- Response actions (GitHubBotPort) ----

  async createComment(repoFullName: string, issueNumber: number, body: string): Promise<void> {
    if (!this.token) {
      console.warn("[GitHubWebhookAdapter] createComment: no token configured — skipped");
      return;
    }
    const res = await fetch(`${this.apiBaseUrl}/repos/${repoFullName}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[GitHubWebhookAdapter] createComment failed ${res.status}: ${text}`);
    }
    console.log(`[GitHubWebhookAdapter] comment posted on ${repoFullName}#${issueNumber}`);
  }

  async updateCheckRun(
    checkRunId: number,
    status: "in_progress" | "completed",
    conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required",
  ): Promise<void> {
    if (!this.token) {
      console.warn("[GitHubWebhookAdapter] updateCheckRun: no token configured — skipped");
      return;
    }
    const repo = this.defaultRepo;
    const body: Record<string, unknown> = { status };
    if (status === "completed" && conclusion) body.conclusion = conclusion;
    const res = await fetch(`${this.apiBaseUrl}/repos/${repo}/check-runs/${checkRunId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[GitHubWebhookAdapter] updateCheckRun failed ${res.status}: ${text}`);
    }
    console.log(`[GitHubWebhookAdapter] check_run ${checkRunId} → ${status}/${conclusion}`);
  }

  // ---- Internal ----

  private async delegateToAgent(text: string): Promise<void> {
    const res = await fetch(this.delegateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/send",
        params: { message: { role: "user", parts: [{ kind: "text", text }] } },
      }),
    });
    if (!res.ok) {
      console.error(`[GitHubWebhookAdapter] delegate failed: ${res.status} ${res.statusText}`);
    }
  }
}
