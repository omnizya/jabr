export type GitHubEventAction = "opened" | "synchronize" | "closed" | "reopened" | "labeled" | "unlabeled" | "assigned" | "unassigned";

export type GitHubEventType = "push" | "pull_request" | "issues" | "check_run" | "release";

export interface GitHubRepository {
  full_name: string;
  default_branch: string;
  name: string;
  owner: { login: string; id: number };
}

export interface GitHubSender {
  login: string;
  id: number;
  avatar_url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  head: { sha: string; branch: { name: string } };
  base: { sha: string; branch: { name: string } };
  body: string;
  user: { login: string };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  user: { login: string };
  labels: { name: string }[];
}

export interface GitHubCheckRun {
  id: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
  name: string;
  check_suite: { id: number; pull_requests: { number: number }[] };
}

export interface GitHubWebhookEvent {
  id: string;            // X-GitHub-Delivery GUID (idempotency key)
  source: "github";
  type: GitHubEventType;
  action?: GitHubEventAction;
  payload: {
    repository: GitHubRepository;
    sender: GitHubSender;
    // Event-specific
    pull_request?: GitHubPullRequest;
    issue?: GitHubIssue;
    check_run?: GitHubCheckRun;
    check_run_id?: number;
    release?: { tag_name: string; name: string; body: string };
    after?: string;      // push: new commit SHA
    before?: string;     // push: old commit SHA
    commits?: { sha: string; message: string; author: { name: string; email: string } }[];
  };
  timestamp: string;     // ISO 8601
}

export type CheckRunStatus = "in_progress" | "completed";
export type CheckRunConclusion = "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";

export interface GitHubBotPort {
  // ---- Event handling ----
  handlePush(event: GitHubWebhookEvent): Promise<void>;
  handlePullRequest(event: GitHubWebhookEvent): Promise<void>;
  handleIssue(event: GitHubWebhookEvent): Promise<void>;
  handleCheckRun(event: GitHubWebhookEvent): Promise<void>;

  // ---- Response actions ----
  createComment(repoFullName: string, issueNumber: number, body: string): Promise<void>;
  updateCheckRun(checkRunId: number, status: CheckRunStatus, conclusion?: CheckRunConclusion): Promise<void>;

  // ---- Verification ----
  verifySignature(payload: string, signature: string, secret: string): boolean;
}
