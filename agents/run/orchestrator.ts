import { A2AServer } from "../adapters/http/a2a-server.ts";
import { A2AClient } from "../adapters/a2a-client.ts";
import { TaskMemory } from "../adapters/task-memory.ts";
import { MemoryFS } from "../adapters/memory-fs.ts";
import { OrchestratorAgent, ORCHESTRATOR_CARD } from "../core/orchestrator.ts";

// @ts-ignore - Bun provides import.meta.main
if (import.meta.main) {
  const PORT = 4000;

  const registry = new A2AClient();
  const taskStore = new TaskMemory();
  const memory = new MemoryFS("memory/orchestrator.md");

  const agentUrls: Record<string, string> = {
    coder: "http://localhost:4001",
    researcher: "http://localhost:4002",
  };

  const agent = new OrchestratorAgent(registry, taskStore, memory, agentUrls);

  const server = new A2AServer({
    port: PORT,
    card: { ...ORCHESTRATOR_CARD, url: `http://localhost:${PORT}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      taskStore.create(taskId);
      await agent.execute(taskId, text);
      const task = taskStore.get(taskId);
      // Return the last agent message text
      const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
      return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
    },
  });

  server.start();
}
