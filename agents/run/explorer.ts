import { A2AServer } from "../adapters/http/a2a-server.ts";
import { TaskMemory } from "../adapters/task-memory.ts";
import { ExplorerAgent, EXPLORER_CARD } from "../core/explorer.ts";

// @ts-ignore - Bun provides import.meta.main
if (import.meta.main) {
  const PORT = 4003;

  const taskStore = new TaskMemory();
  const agent = new ExplorerAgent(taskStore);

  const server = new A2AServer({
    port: PORT,
    card: { ...EXPLORER_CARD, url: `http://localhost:${PORT}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      taskStore.create(taskId);
      await agent.execute(taskId, text);
      const task = taskStore.get(taskId);
      const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
      return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
    },
  });

  server.start();
}
