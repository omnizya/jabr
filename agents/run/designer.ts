import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import { ImageGen9Router } from "@adapters/image-gen-9router";
import { DesignerAgent, DESIGNER_CARD } from "@core/designer";

if (import.meta.main) {
  const PORT = 4004;

  const taskStore = new TaskMemory();
  const imageGen = new ImageGen9Router();
  const agent = new DesignerAgent(taskStore, imageGen);

  const server = new A2AServer({
    port: PORT,
    card: { ...DESIGNER_CARD, url: `http://localhost:${PORT}` },
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
