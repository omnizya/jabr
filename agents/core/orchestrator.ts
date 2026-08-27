import type { AgentCard, A2AMessage, HandoverRequest } from "../types.ts";
import { decodeHandover } from "../types.ts";
import type { AgentRegistryPort } from "../ports/agent-registry.ts";
import type { TaskStorePort } from "../ports/task-store.ts";
import type { MemoryStorePort } from "../ports/memory-store.ts";
import type { DynamicRegistry } from "../adapters/dynamic-registry.ts";

// Keyword routing — exported for testability.
// Each agent has its own keyword list; orchestrator picks the first match.
export const ROUTING_TABLE: Array<{
  keywords: string[];
  agentName: string;
  label: string;
}> = [
  {
    agentName: "fixer",
    label: "Fixer Agent",
    keywords: ["fix", "bug", "error", "patch", "repair", "debug"],
  },
  {
    agentName: "oracle",
    label: "Oracle Agent",
    keywords: ["review", "simplify", "refactor", "architecture", "audit"],
  },
  {
    agentName: "explorer",
    label: "Explorer Agent",
    keywords: ["find", "files", "map", "structure", "grep", "search"],
  },
  {
    agentName: "designer",
    label: "Designer Agent",
    keywords: ["layout", "responsive", "component", "button", "color", "palette", "ui", "ux"],
  },
  {
    agentName: "librarian",
    label: "Librarian Agent",
    keywords: ["research", "doc", "api", "library", "how-to", "summarize"],
  },
  {
    agentName: "fixer", // default for code tasks
    label: "Fixer Agent",
    keywords: ["code", "function", "implement", "algorithm", "python", "typescript", "write"],
  },
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

/** Max handover depth before the orchestrator forces completion. */
export const MAX_HANDOVER_DEPTH = 3;

export class OrchestratorAgent {
  constructor(
    private registry: AgentRegistryPort,
    private taskStore: TaskStorePort,
    private memory: MemoryStorePort,
    private dynamicRegistry?: DynamicRegistry,
  ) {}

  get card(): AgentCard {
    return ORCHESTRATOR_CARD;
  }

  /**
   * Route task — tries keyword table first, then falls back to DynamicRegistry tag matching.
   */
  routeTask(text: string): { agentName: string; label: string } {
    // 1. Try hardcoded keyword table (fast, deterministic)
    const lower = text.toLowerCase();
    for (const entry of ROUTING_TABLE) {
      if (entry.keywords.some((k) => lower.includes(k))) {
        return { agentName: entry.agentName, label: entry.label };
      }
    }

    // 2. Try DynamicRegistry tag-based matching (discoverable, extensible)
    if (this.dynamicRegistry) {
      const match = this.dynamicRegistry.matchAgent(text);
      if (match) {
        return { agentName: match.name, label: match.label };
      }
    }

    // 3. Fallback
    return { agentName: "librarian", label: "Librarian Agent" };
  }

  /**
   * Get URL for an agent — DynamicRegistry takes precedence over legacy map.
   */
  private getAgentUrl(agentName: string): string | undefined {
    if (this.dynamicRegistry) {
      return this.dynamicRegistry.getUrl(agentName);
    }
    return undefined;
  }

  /**
   * Main task execution entry point.
   * Delegates to `executeWithDepth` with depth 0.
   */
  async execute(taskId: string, userText: string): Promise<void> {
    return this.executeWithDepth(taskId, userText, 0);
  }

  /**
   * Core execution loop with handover support.
   *
   * 1. Route the task to a specialist.
   * 2. Delegate and receive result.
   * 3. If result contains a handover marker and depth < MAX:
   *    - Create a new child task for the requested agent.
   *    - Link via referenceTaskIds.
   *    - Recurse.
   * 4. Otherwise, complete the current task.
   */
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

      // ── Check for handover signal ──────────────────────────────────────
      const handover = decodeHandover(result);

      if (handover && depth < MAX_HANDOVER_DEPTH) {
        this.memory.append(
          `[depth=${depth}] Handover detected: ${agentName} → ${handover.transferTo} (${handover.reason})`,
        );

        // Store the intermediate result in the current task
        this.taskStore.appendMessage(taskId, {
          messageId: crypto.randomUUID(),
          role: "agent",
          kind: "message",
          parts: [{ kind: "text", text: result.replace(/%%HANDOVER%%.*$/, "").trim() }],
          contextId: taskId,
        } as A2AMessage);

        // Create child task for the handover target
        const childTaskId = crypto.randomUUID();
        this.taskStore.create(childTaskId);
        this.taskStore.updateState(taskId, "working");

        // Link tasks via referenceTaskIds
        const childUserText = handover.context || userText;
        this.taskStore.appendMessage(childTaskId, {
          messageId: crypto.randomUUID(),
          role: "user",
          kind: "message",
          parts: [{ kind: "text", text: childUserText }],
          contextId: childTaskId,
          referenceTaskIds: [taskId, ...referenceTaskIds],
        } as A2AMessage);

        // Recurse into the handover target
        await this.executeWithDepth(
          childTaskId,
          childUserText,
          depth + 1,
          [taskId, ...referenceTaskIds],
        );

        // After child completes, collect its result and complete parent
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

      // ── Max depth reached or no handover — complete normally ───────────
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
