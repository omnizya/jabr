import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { Search9Router } from "@adapters/search-9router";
import { LibrarianAgent, LIBRARIAN_CARD } from "@core/librarian";
import { runAgent } from "./serve";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const agent = new LibrarianAgent(taskStore, new SkillFS("skills"), new Search9Router());

  runAgent({
    port: 4002,
    card: LIBRARIAN_CARD,
    execute: (taskId, text) => agent.execute(taskId, text),
    taskStore,
  });
}
