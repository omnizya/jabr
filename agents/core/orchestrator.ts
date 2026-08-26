import type { AgentCard, A2AMessage } from "../types.ts";
import type { AgentRegistryPort } from "../ports/agent-registry.ts";
import type { TaskStorePort } from "../ports/task-store.ts";
import type { MemoryStorePort } from "../ports/memory-store.ts";

// Keyword routing — exported for testability.
export const CODER_KEYWORDS = [
  "code",
  "function",
  "implement",
  "fibonacci",
  "algorithm",
  "python",
  "typescript",
  "bug",
  "review",
  "write",
];

// Agent card metadata
export const ORCHESTRATOR_CARD: AgentCard = {
  name: "Orchestrator",
  description:
    "Hermes-style orchestrator. Discovers agents, routes tasks, persists memory, writes skills.",
  url: "", // filled by run module with actual port
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    {
      id: "route-task",
      name: "Route task",
      description: "Classifies and delegates any task to the best specialist agent",
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      id: "discover-agents",
      name: "Discover agents",
      description: "Fetches Agent Cards from known sub-agents",
      inputModes: ["text"],
      outputModes: ["data"],
    },
  ],
};

export class OrchestratorAgent {
  constructor(
    private registry: AgentRegistryPort,
    private taskStore: TaskStorePort,
    private memory: MemoryStorePort,
    private agentUrls: Record<string, string> = {},
  ) {}

  get card(): AgentCard {
    return ORCHESTRATOR_CARD;
  }

  // Keyword routing — pure function
  routeTask(text: string): { agentName: string; label: string } {
    const lower = text.toLowerCase();
    const isCoder = CODER_KEYWORDS.some((k) => lower.includes(k));
    return isCoder
      ? { agentName: "coder", label: "Coder Agent" }
      : { agentName: "researcher", label: "Researcher Agent" };
  }

  // Main task execution — uses ports
  async execute(taskId: string, userText: string): Promise<void> {
    try {
      const { label } = this.routeTask(userText);
      this.memory.append(`Routed "${userText.slice(0, 60)}" to ${label}`);

      const { agentName } = this.routeTask(userText);
      const agentUrl = this.agentUrls[agentName];
      if (!agentUrl) throw new Error(`No URL configured for agent: ${agentName}`);
      const result = await this.registry.delegateTask(agentUrl, userText);

      this.taskStore.updateState(taskId, "completed");
      this.taskStore.appendMessage(taskId, {
        messageId: crypto.randomUUID(),
        role: "agent",
        kind: "message",
        parts: [{ kind: "text", text: result }],
        contextId: taskId,
      } as A2AMessage);
      this.memory.append(`Completed task. Result length: ${result.length} chars`);
    } catch (e) {
      this.taskStore.updateState(taskId, "failed");
      this.taskStore.appendMessage(taskId, {
        messageId: crypto.randomUUID(),
        role: "agent",
        kind: "message",
        parts: [{ kind: "text", text: `Error: ${String(e)}` }],
        contextId: taskId,
      } as A2AMessage);
    }
  }
}
