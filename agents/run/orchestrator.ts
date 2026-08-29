import { A2AServer } from "@adapters/http/a2a-server";
import { A2AClient } from "@adapters/a2a-client";
import { DynamicRegistry } from "@adapters/dynamic-registry";
import { OrchestratorAgent, ORCHESTRATOR_CARD } from "@core/orchestrator";
import { NineRouterLlmAdapter } from "@adapters/llm/9router";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { HeadroomAdapter } from "@adapters/headroom";
import { RateLimiter } from "@adapters/rate-limit";
import { HermesKanbanAdapter } from "@adapters/hermes-kanban";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import { SqliteMemoryStore } from "@adapters/sqlite-memory-store";
import { openJabrDb } from "@adapters/sqlite-db";
import { GitHubWebhookAdapter } from "@adapters/http/github-webhook";
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import type { RealtimePort } from "@ports/realtime-port";

if (import.meta.main) {
  const PORT = 4000;

  const budget = new HeadroomAdapter();
  const rateLimiter = new RateLimiter();
  const registryClient = new A2AClient(budget);
  const db = openJabrDb();                                  // memory/jabr.db
  const taskStore = new SqliteTaskStore(db);
  const memory = new SqliteMemoryStore(db, { mirrorFile: null }); // sqlite is source of truth; no .md mirror
  const llmPort = new NineRouterLlmAdapter(budget);

  const seedUrls: Record<string, string> = {
    oracle: "http://localhost:4001",
    librarian: "http://localhost:4002",
    explorer: "http://localhost:4003",
    designer: "http://localhost:4004",
    fixer: "http://localhost:4005",
    scientist: "http://localhost:4006",
    jarvis: "http://localhost:1337",
  };

  const dynamicRegistry = new DynamicRegistry(registryClient, seedUrls);
  await dynamicRegistry.initialize();

  const palace = new MemPalaceAdapter();
  const kanban = new HermesKanbanAdapter(process.env.HERMES_KANBAN_BOARD);

  const agent = new OrchestratorAgent(registryClient, taskStore, memory, dynamicRegistry, llmPort, undefined, palace, kanban);

  const authToken = process.env.A2A_AUTH_TOKEN ?? undefined;
  const requireAuth = Boolean(authToken) || process.env.A2A_REQUIRE_AUTH === "true";

  // GitHub webhook adapter: receives X-Hub-Signature-256-verified events on port
  // 4007 and delegates them to the orchestrator over A2A. The webhook secret and
  // a GitHub PAT (for comment / check-run actions) are read from env so the
  // adapter stays usable in CI without local secrets.
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "change-me";
  const ghToken = process.env.GITHUB_TOKEN ?? undefined;
  const ghDelegate = process.env.GITHUB_WEBHOOK_DELEGATE_URL ?? `http://localhost:${PORT}`;
  const githubWebhook = new GitHubWebhookAdapter({
    webhookSecret,
    token: ghToken,
    port: 4007,
    delegateUrl: ghDelegate,
    defaultRepo: process.env.GITHUB_REPO ?? "omnizya/jabr",
  });
  githubWebhook.start();

  const server = new A2AServer({
    port: PORT,
    card: { ...ORCHESTRATOR_CARD, url: `http://localhost:${PORT}` },
    authToken,
    requireAuth,
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      console.log(`[Run:Orchestrator] received task ${taskId}`);
      taskStore.create(taskId);
      await agent.execute(taskId, text);
      const task = taskStore.get(taskId);
      const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
      return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
    },
    async onWorldState() {
      return agent.getWorldState();
    },
  });

  server.start();
}
