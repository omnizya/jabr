import { A2AServer } from "@adapters/http/a2a-server";
import { A2AClient } from "@adapters/a2a-client";
import { DynamicRegistry } from "@adapters/dynamic-registry";
import { TaskMemory } from "@adapters/task-memory";
import { MemoryFS } from "@adapters/memory-fs";
import { OrchestratorAgent, ORCHESTRATOR_CARD } from "@core/orchestrator";
import { NineRouterLlmAdapter } from "@adapters/llm/9router";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { HeadroomAdapter } from "@adapters/headroom";

if (import.meta.main) {
  const PORT = 4000;

  const budget = new HeadroomAdapter();
  const registryClient = new A2AClient(budget);
  const taskStore = new TaskMemory();
  const memory = new MemoryFS("memory/orchestrator.md");
  const llmPort = new NineRouterLlmAdapter(budget);

  const seedUrls: Record<string, string> = {
    oracle: "http://localhost:4001",
    librarian: "http://localhost:4002",
    explorer: "http://localhost:4003",
    designer: "http://localhost:4004",
    fixer: "http://localhost:4005",
    scientist: "http://localhost:4006",
    jarvis: "http://localhost:1337",
  };

  const dynamicRegistry = new DynamicRegistry(registryClient, seedUrls);
  await dynamicRegistry.initialize();

  const palace = new MemPalaceAdapter();

  const agent = new OrchestratorAgent(registryClient, taskStore, memory, dynamicRegistry, llmPort, undefined, palace);

  const server = new A2AServer({
    port: PORT,
    card: { ...ORCHESTRATOR_CARD, url: `http://localhost:${PORT}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      taskStore.create(taskId);
      await agent.execute(taskId, text);
      const task = taskStore.get(taskId);
      const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
      return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
    },
    async onWorldState() {
      return agent.getWorldState();
    },
  });

  server.start();
}
