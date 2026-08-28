import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { FixerAgent, FIXER_CARD } from "@core/fixer";
import { runAgent, extractLastResponse } from "./serve.ts";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const agent = new FixerAgent(taskStore, new SkillFS("skills"));

  runAgent({
    port: 4005,
    card: FIXER_CARD,
    execute: (taskId, text) => agent.execute(taskId, text),
    taskStore,
    formatResult: (ts, taskId) => {
      const text = extractLastResponse(ts, taskId);
      const task = ts.get(taskId);
      const artifact = task?.artifacts[0];
      if (artifact) {
        const artText = artifact.parts.find((p) => p.kind === "text")?.text;
        return artText
          ? `${text}\n\n**Artifact** (\`${artifact.name}\`):\n\`\`\`\n${artText}\n\`\`\``
          : text;
      }
      return text;
    },
  });
}
