import { TaskMemory } from "@adapters/task-memory";
import { ExplorerAgent, EXPLORER_CARD } from "@core/explorer";
import { runAgent } from "./serve";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const agent = new ExplorerAgent(taskStore);

  runAgent({
    port: 4003,
    card: EXPLORER_CARD,
    execute: (taskId, text) => agent.execute(taskId, text),
    taskStore,
  });
}
