import type { AgentCard } from "@agents/types";
import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";

export function extractLastResponse(taskStore: TaskMemory, taskId: string): string {
  const task = taskStore.get(taskId);
  const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
  return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
}

export function runAgent(config: {
  port: number;
  card: AgentCard;
  execute: (taskId: string, text: string) => Promise<void>;
  taskStore?: TaskMemory;
  formatResult?: (taskStore: TaskMemory, taskId: string) => string;
}) {
  const taskStore = config.taskStore ?? new TaskMemory();
  const format = config.formatResult ?? extractLastResponse;

  const server = new A2AServer({
    port: config.port,
    card: { ...config.card, url: `http://localhost:${config.port}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      taskStore.create(taskId);
      await config.execute(taskId, text);
      return format(taskStore, taskId);
    },
  });

  server.start();
}
