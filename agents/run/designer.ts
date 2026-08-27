import { TaskMemory } from "@adapters/task-memory";
import { ImageGen9Router } from "@adapters/image-gen-9router";
import { DesignerAgent, DESIGNER_CARD } from "@core/designer";
import { runAgent } from "./serve";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const agent = new DesignerAgent(taskStore, new ImageGen9Router());

  runAgent({
    port: 4004,
    card: DESIGNER_CARD,
    execute: (taskId, text) => agent.execute(taskId, text),
    taskStore,
  });
}
