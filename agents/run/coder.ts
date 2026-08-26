import { A2AServer } from "../adapters/http/a2a-server.ts";
import { TaskMemory } from "../adapters/task-memory.ts";
import { SkillFS } from "../adapters/skill-fs.ts";
import { CoderAgent, CODER_CARD } from "../core/coder.ts";

// @ts-ignore - Bun provides import.meta.main
if (import.meta.main) {
  const PORT = 4001;

  const taskStore = new TaskMemory();
  const skillStore = new SkillFS("skills");
  const agent = new CoderAgent(taskStore, skillStore);

  const server = new A2AServer({
    port: PORT,
    card: { ...CODER_CARD, url: `http://localhost:${PORT}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      taskStore.create(taskId);
      await agent.execute(taskId, text);
      const task = taskStore.get(taskId);
      const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
      const textPart =
        lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
      // Include artifact content if present
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
