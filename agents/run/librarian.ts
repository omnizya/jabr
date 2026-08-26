import { A2AServer } from "../adapters/http/a2a-server.ts";
import { TaskMemory } from "../adapters/task-memory.ts";
import { SkillFS } from "../adapters/skill-fs.ts";
import { LibrarianAgent, LIBRARIAN_CARD } from "../core/librarian.ts";

// @ts-ignore - Bun provides import.meta.main
if (import.meta.main) {
  const PORT = 4002;

  const taskStore = new TaskMemory();
  const skillStore = new SkillFS("skills");
  const agent = new LibrarianAgent(taskStore, skillStore);

  const server = new A2AServer({
    port: PORT,
    card: { ...LIBRARIAN_CARD, url: `http://localhost:${PORT}` },
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
