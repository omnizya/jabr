import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { FixerAgent, FIXER_CARD } from "@core/fixer";

if (import.meta.main) {
  const PORT = 4005;

  const taskStore = new TaskMemory();
  const skillStore = new SkillFS("skills");
  const agent = new FixerAgent(taskStore, skillStore);

  const server = new A2AServer({
    port: PORT,
    card: { ...FIXER_CARD, url: `http://localhost:${PORT}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      taskStore.create(taskId);
      await agent.execute(taskId, text);
      const task = taskStore.get(taskId);
      const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
      const textPart =
        lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
      const artifact = task?.artifacts[0];
      if (artifact) {
        const artText = artifact.parts.find((p) => p.kind === "text")?.text;
        return artText
          ? `${textPart}\n\n**Artifact** (\`${artifact.name}\`):\n\`\`\`\n${artText}\n\`\`\``
          : textPart;
      }
      return textPart;
    },
  });

  server.start();
}
