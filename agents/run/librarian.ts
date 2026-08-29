import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { Search9Router } from "@adapters/search-9router";
import { LibrarianAgent, LIBRARIAN_CARD } from "@core/librarian";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const palace = new MemPalaceAdapter();
  const agent = new LibrarianAgent(taskStore, new SkillFS("skills"), new Search9Router(), palace);

  runAgent({
    port: 4002,
    card: LIBRARIAN_CARD,
    execute: (taskId, text) => {
      console.log(`[Run:Librarian] dispatching task ${taskId}`);
      return agent.execute(taskId, text);
    },
    taskStore,
  });
}
