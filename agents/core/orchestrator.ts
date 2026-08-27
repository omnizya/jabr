import type { AgentCard, A2AMessage, HandoverRequest } from "@agents/types";
import { decodeHandover } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { TaskStorePort } from "@ports/task-store";
import type { MemoryStorePort } from "@ports/memory-store";
import type { DiscoveryPort } from "@ports/discovery-port";
import { CognitiveLoop, type ConsensusInput } from "./cognitive-loop.ts";
import type { LlmPort } from "@ports/llm-port";

export const ORCHESTRATOR_CARD: AgentCard = {
  name: "Orchestrator",
  description:
    "Hermes-style orchestrator. Discovers agents, routes tasks, persists memory, writes skills.",
  url: "",
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    {
      name: "Route task",
      description: "Classifies and delegates any task to the best specialist agent",
      tags: ["routing", "delegation", "orchestration"],
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      name: "Discover agents",
      description: "Fetches Agent Cards from known sub-agents",
      tags: ["discovery", "agent-card", "registry"],
      inputModes: ["text"],
      outputModes: ["data"],
    },
  ],
};

export const MAX_HANDOVER_DEPTH = 3;

export class OrchestratorAgent {
  private cognitiveLoop: CognitiveLoop;

  constructor(
    private registry: AgentRegistryPort,
    private taskStore: TaskStorePort,
    private memory: MemoryStorePort,
    private dynamicRegistry?: DiscoveryPort,
    private llmPort?: LlmPort,
    cognitiveConfig?: { judgeAgentName?: string; minAgents?: number; confidenceThreshold?: number },
  ) {
    this.cognitiveLoop = new CognitiveLoop(cognitiveConfig, llmPort);
  }

  get card(): AgentCard {
    return ORCHESTRATOR_CARD;
  }

  routeTask(text: string): { agentName: string; label: string } {
    const match = this.dynamicRegistry?.matchAgent(text);
    if (match) {
      return { agentName: match.name, label: match.label };
    }
    return { agentName: "librarian", label: "Librarian Agent" };
  }

  async getWorldState(): Promise<any> {
    const agents = await this.dynamicRegistry?.getAgentsHealth() ?? [];
    
    // Aggregate filesystem metrics (mirroring old tools.ts logic)
    const memoryDir = "/home/m7r/Projects/Labs/agent-lab/memory";
    const skillsDir = "/home/m7r/Projects/Labs/agent-lab/skills";
    
    let lastUpdated: string | undefined;
    try {
      const fs = await import("fs");
      const memPath = `${memoryDir}/orchestrator.md`;
      if (fs.existsSync(memPath)) {
        lastUpdated = fs.statSync(memPath).mtime.toISOString();
      }
      
      let skillTotal = 0;
      let recentSlugs: string[] = [];
      if (fs.existsSync(skillsDir)) {
        const skillFiles = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".json"));
        skillTotal = skillFiles.length;
        recentSlugs = skillFiles.map(f => f.replace(".json", "")).reverse().slice(0, 5);
      }

      let taskTotal = 0;
      if (fs.existsSync(memoryDir)) {
        taskTotal = fs.readdirSync(memoryDir).filter(f => f.startsWith("task-") && f.endsWith(".json")).length;
      }

      return {
        timestamp: new Date().toISOString(),
        agents,
        tasks: { total: taskTotal, active: 0, completed: 0, failed: 0 },
        memory: { totalEntries: lastUpdated ? 1 : 0, lastUpdated },
        skills: { total: skillTotal, recentSlugs },
      };
    } catch (e) {
      console.error("Error gathering world state:", e);
      return { timestamp: new Date().toISOString(), agents: [], error: "Filesystem access failed" };
    }
  }

  private getAgentUrl(agentName: string): string | undefined {
    if (this.dynamicRegistry) {
      return this.dynamicRegistry.getUrl(agentName);
    }
    return undefined;
  }

  private getAvailableAgentNames(): string[] {
    if (!this.dynamicRegistry) return [];
    const cards = this.dynamicRegistry.getAllCards();
    return Object.keys(cards);
  }

  private async delegateToMultiple(
    agentNames: string[],
    userText: string,
  ): Promise<ConsensusInput[]> {
    const tasks = agentNames
      .filter((name) => name !== "orchestrator")
      .map(async (name) => {
        const url = this.getAgentUrl(name);
        if (!url) return null;
        try {
          const response = await this.registry.delegateTask(url, userText);
          const card = this.dynamicRegistry?.getCard(name);
          if (!card) return null;
          return { agentName: name, card, response } satisfies ConsensusInput;
        } catch {
          return null;
        }
      });

    const results = await Promise.all(tasks);
    return results.filter((r): r is ConsensusInput => r !== null);
  }

  async executeConsensus(taskId: string, userText: string): Promise<string> {
    const available = this.getAvailableAgentNames();
    if (available.length < 2) {
      const url = this.getAgentUrl(available[0] ?? "librarian");
      if (!url) return "No agents available for consensus";
      return this.registry.delegateTask(url, userText);
    }

    this.memory.append(`[consensus] Delegating to ${available.length} agents`);
    const inputs = await this.delegateToMultiple(available, userText);

    if (inputs.length === 0) return "No agents responded";

    const result = await this.cognitiveLoop.evaluate(inputs, userText);
    const topScore = result.scores[0]?.score.toFixed(3) ?? "N/A";
    this.memory.append(
      `[consensus] Winner: ${result.winner.agentName} (score: ${topScore})`,
    );

    return result.synthesized;
  }

  async execute(taskId: string, userText: string): Promise<void> {
    return this.executeWithDepth(taskId, userText, 0);
  }

  private async executeWithDepth(
    taskId: string,
    userText: string,
    depth: number,
    referenceTaskIds: string[] = [],
  ): Promise<void> {
    try {
      const { agentName, label } = this.routeTask(userText);
      this.memory.append(
        `[depth=${depth}] Routed "${userText.slice(0, 60)}" to ${label}`,
      );

      const agentUrl = this.getAgentUrl(agentName);
      if (!agentUrl) throw new Error(`No URL configured for agent: ${agentName}`);

      const result = await this.registry.delegateTask(agentUrl, userText);

      const handover = decodeHandover(result);

      if (handover && depth < MAX_HANDOVER_DEPTH) {
        this.memory.append(
          `[depth=${depth}] Handover detected: ${agentName} → ${handover.transferTo} (${handover.reason})`,
        );

        this.taskStore.appendMessage(taskId, {
          messageId: crypto.randomUUID(),
          role: "agent",
          kind: "message",
          parts: [{ kind: "text", text: result.replace(/%%HANDOVER%%.*$/, "").trim() }],
          contextId: taskId,
        } as A2AMessage);

        const childTaskId = crypto.randomUUID();
        this.taskStore.create(childTaskId);
        this.taskStore.updateState(taskId, "working");

        const childUserText = handover.context || userText;
        this.taskStore.appendMessage(childTaskId, {
          messageId: crypto.randomUUID(),
          role: "user",
          kind: "message",
          parts: [{ kind: "text", text: childUserText }],
          contextId: childTaskId,
          referenceTaskIds: [taskId, ...referenceTaskIds],
        } as A2AMessage);

        await this.executeWithDepth(
          childTaskId,
          childUserText,
          depth + 1,
          [taskId, ...referenceTaskIds],
        );

        const childTask = this.taskStore.get(childTaskId);
        const childResult =
          childTask?.messages
            .filter((m) => m.role === "agent")
            .map((m) => m.parts.filter((p) => p.kind === "text").map((p) => p.text).join(""))
            .join("\n") ?? "";

        this.taskStore.updateState(taskId, "completed");
        this.taskStore.appendMessage(taskId, {
          messageId: crypto.randomUUID(),
          role: "agent",
          kind: "message",
          parts: [{ kind: "text", text: childResult }],
          contextId: taskId,
          referenceTaskIds: [childTaskId],
        } as A2AMessage);
        this.memory.append(
          `[depth=${depth}] Handover chain completed. Result length: ${childResult.length} chars`,
        );
        return;
      }

      if (handover && depth >= MAX_HANDOVER_DEPTH) {
        this.memory.append(
          `[depth=${depth}] Max handover depth (${MAX_HANDOVER_DEPTH}) reached. Completing with available result.`,
        );
      }

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
