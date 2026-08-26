import type { TaskStorePort } from "../ports/task-store.ts";
import type { SkillStorePort } from "../ports/skill-store.ts";
import type { AgentCard, A2AMessage } from "../types.ts";

export const RESEARCHER_CARD: AgentCard = {
  name: "Researcher Agent",
  description: "Researches topics, summarizes findings, and saves skills. Self-improving.",
  url: "", // filled by run module
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    { id: "research", name: "Research topic", description: "Summarizes a topic and returns structured findings", inputModes: ["text"], outputModes: ["text", "data"] },
    { id: "summarize", name: "Summarize text", description: "Condenses long text into key bullets", inputModes: ["text"], outputModes: ["text"] },
    { id: "save-skill", name: "Save skill", description: "Persists a reusable skill document (self-improvement loop)", inputModes: ["text", "data"], outputModes: ["text"] },
  ],
};

export class ResearcherAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
  ) {}

  get card(): AgentCard {
    return RESEARCHER_CARD;
  }

  // Helper: persist skill via port (idempotent)
  private persistSkill(taskType: string, userText: string, steps: string[]): void {
    const slug = taskType.toLowerCase().replace(/\s+/g, "-");
    if (this.skillStore.exists(slug)) return;
    this.skillStore.save(slug, {
      name: taskType,
      description: `Auto-generated from task: "${userText.slice(0, 60)}"`,
      tags: ["auto", "researcher"],
      steps,
      createdAt: new Date().toISOString(),
      usageCount: 1,
      successRate: 1.0,
    });
    console.log(`📚 Skill saved: skills/${slug}.json`);
  }

  // Pure domain logic — pattern matching on user text
  async executeTask(userText: string): Promise<string> {
    const lower = userText.toLowerCase();

    if (lower.includes("mcp") || lower.includes("a2a") || lower.includes("acp")) {
      this.persistSkill("protocol-research", userText, [
        "Identify the protocol (MCP / A2A / ACP)",
        "Fetch official spec from docs",
        "Summarize transport layer",
        "List key use cases",
        "Return structured findings",
      ]);
      return `## Protocol Research: ${userText}\n\n**MCP** — Model Context Protocol (Anthropic)\n• JSON-RPC 2.0 over stdio or HTTP\n• Connects agents to tools and data sources\n\n**A2A** — Agent-to-Agent (Linux Foundation)\n• HTTP + JSON-RPC, Agent Cards for discovery\n• Task lifecycle: submitted → working → completed\n\n**ACP** — Agent Client Protocol (Zed / JetBrains)\n• JSON-RPC over stdio (nd-JSON)\n• Bridges IDEs to coding agents\n\nSkill saved to \`skills/protocol-research.json\` ✓`;
    }

    if (lower.includes("summarize") || lower.includes("summary")) {
      this.persistSkill("text-summarization", userText, [
        "Extract key sentences",
        "Group by theme",
        "Produce bullet summary",
      ]);
      return `## Summary\n\n• Topic identified: "${userText.slice(0, 50)}…"\n• Key finding 1: core concept extracted\n• Key finding 2: implications noted\n• Key finding 3: action items surfaced\n\nSkill saved → \`skills/text-summarization.json\` ✓`;
    }

    if (lower.includes("skill") || lower.includes("self-improv")) {
      this.persistSkill("skill-creation", userText, [
        "Identify recurring task pattern",
        "Extract steps from execution",
        "Write skill JSON document",
        "Save to skills/ directory",
        "Increment usageCount on reuse",
      ]);
      return `## Self-improvement loop\n\nHermes-style skill creation:\n1. Agent completes task\n2. Extracts reusable pattern → \`skills/<slug>.json\`\n3. Next time same task arrives → load skill, run faster\n4. After 20+ uses → successRate tracked\n\nSkill saved → \`skills/skill-creation.json\` ✓`;
    }

    this.persistSkill("general-research", userText, [
      "Parse user query intent",
      "Search knowledge base",
      "Structure findings",
      "Return with citations",
    ]);
    return `## Research: "${userText}"\n\nFindings: topic processed by Researcher Agent.\nNo cached skill found — created \`skills/general-research.json\` for next time.\n\nTip: delegate specific subtasks to Coder Agent via the orchestrator.`;
  }

  // High-level: execute and update task store
  async execute(taskId: string, userText: string): Promise<void> {
    const responseText = await this.executeTask(userText);
    this.taskStore.updateState(taskId, "completed");
    this.taskStore.appendMessage(taskId, {
      messageId: crypto.randomUUID(),
      role: "agent",
      kind: "message",
      parts: [{ kind: "text", text: responseText }],
      contextId: taskId,
      taskId,
    });
  }
}
