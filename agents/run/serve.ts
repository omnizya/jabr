import type { AgentCard } from "@agents/types";
import type { TaskStorePort } from "@ports/task-store";
import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";

export function extractLastResponse(taskStore: TaskStorePort, taskId: string): string {
  const task = taskStore.get(taskId);
  const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
  return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
}

export function runAgent(config: {
  port: number;
  card: AgentCard;
  execute: (taskId: string, text: string) => Promise<void>;
  taskStore?: TaskStorePort;
  formatResult?: (taskStore: TaskStorePort, taskId: string) => string;
}) {
  const taskStore = config.taskStore ?? new TaskMemory();
  const format = config.formatResult ?? extractLastResponse;

  console.log(`[Serve] starting ${config.card.name} server on port ${config.port}`);

  const authToken = process.env.A2A_AUTH_TOKEN ?? undefined;
  const requireAuth = Boolean(authToken) || process.env.A2A_REQUIRE_AUTH === "true";

  const server = new A2AServer({
    port: config.port,
    card: { ...config.card, url: `http://localhost:${config.port}` },
    onTask: async (text: string): Promise<string> => {
      const taskId = crypto.randomUUID();
      console.log(`[Serve] received task ${taskId} for ${config.card.name}`);
      taskStore.create(taskId);
      await config.execute(taskId, text);
      return format(taskStore, taskId);
    },
    authToken,
    requireAuth,
  });

  server.start();
}
