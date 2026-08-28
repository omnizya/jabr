import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { OracleAgent, ORACLE_CARD } from "@core/oracle";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const agent = new OracleAgent(taskStore, new SkillFS("skills"));

  runAgent({
    port: 4001,
    card: ORACLE_CARD,
    execute: (taskId, text) => agent.execute(taskId, text),
    taskStore,
  });
}
