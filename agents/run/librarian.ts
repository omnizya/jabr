import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { Search9Router } from "@adapters/search-9router";
import { LibrarianAgent, LIBRARIAN_CARD } from "@core/librarian";

if (import.meta.main) {
  const PORT = 4002;

  const taskStore = new TaskMemory();
  const skillStore = new SkillFS("skills");
  const search = new Search9Router();
  const agent = new LibrarianAgent(taskStore, skillStore, search);

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
