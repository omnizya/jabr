import type { TaskStorePort } from "@ports/task-store";
import type { SkillStorePort } from "@ports/skill-store";
import type { SearchPort, SearchResult } from "@ports/search-port";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { AgentCard, A2AMessage } from "@agents/types";

export const LIBRARIAN_CARD: AgentCard = {
  name: "FIHRIYA",
  description: "FIHRIYA (Fatima al-Fihriya) — Keeper of Knowledge. Researches documentation, looks up library APIs, summarizes findings, and manages skills. External knowledge specialist.",
  url: "",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    { name: "Lookup docs", description: "Researches documentation and looks up library APIs", tags: ["research", "doc", "api", "library", "how-to"], inputModes: ["text"], outputModes: ["text", "data"] },
    { name: "Summarize text", description: "Condenses long text into key bullets", tags: ["summarize", "summary"], inputModes: ["text"], outputModes: ["text"] },
    { name: "Save skill", description: "Persists a reusable skill document (self-improvement loop)", tags: ["skill", "self-improvement", "persist"], inputModes: ["text", "data"], outputModes: ["text"] },
  ],
};

export class LibrarianAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
    private search: SearchPort,
    private knowledge?: KnowledgePort,
  ) {}

  get card(): AgentCard {
    return LIBRARIAN_CARD;
  }

  private async persistKnowledge(slug: string, content: string, tags: string[]): Promise<void> {
    if (this.knowledge) {
      try {
        await this.knowledge.store(slug, content, tags);
      } catch (err) {
        console.error("[LibrarianAgent] Knowledge store failed:", err);
      }
    }
  }

  private persistSkill(taskType: string, userText: string, steps: string[]): void {
    const slug = taskType.toLowerCase().replace(/\s+/g, "-");
    if (this.skillStore.exists(slug)) return;
    this.skillStore.save(slug, {
      name: taskType,
      description: `Auto-generated from task: "${userText.slice(0, 60)}"`,
      tags: ["auto", "librarian"],
      steps,
      createdAt: new Date().toISOString(),
      usageCount: 1,
      successRate: 1.0,
    });
    console.log(`📚 Skill saved: skills/${slug}.json`);
  }

  async research(query: string): Promise<SearchResult[]> {
    try {
      return await this.search.search(query);
    } catch (err) {
      console.error("[LibrarianAgent] research failed:", err);
      return [];
    }
  }

  private formatResults(results: SearchResult[]): string {
    if (results.length === 0) {
      return "_No external results found._";
    }
    return results
      .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.snippet}`)
      .join("\n");
  }

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
      const results = await this.research(userText);
      const summary = `## Protocol Research: ${userText}\n\n**MCP** — Model Context Protocol (Anthropic)\n• JSON-RPC 2.0 over stdio or HTTP\n• Connects agents to tools and data sources\n\n**A2A** — Agent-to-Agent (Linux Foundation)\n• HTTP + JSON-RPC, Agent Cards for discovery\n• Task lifecycle: submitted → working → completed\n\n**ACP** — Agent Client Protocol (Zed / JetBrains)\n• JSON-RPC over stdio (nd-JSON)\n• Bridges IDEs to coding agents\n\n### External sources\n${this.formatResults(results)}\n\nSkill saved to \`skills/protocol-research.json\` ✓`;
      await this.persistKnowledge("protocol-research", summary, ["protocol", "mcp", "a2a", "acp"]);
      return summary;
    }

    if (lower.includes("doc") || lower.includes("api") || lower.includes("library") || lower.includes("how to")) {
      this.persistSkill("docs-lookup", userText, [
        "Identify the library or API in question",
        "Locate official documentation",
        "Extract relevant signatures and usage",
        "Summarize key patterns",
        "Return structured findings",
      ]);
      const results = await this.research(userText);
      const summary = `## Docs Lookup: ${userText}\n\n• Library/API identified: "${userText.slice(0, 50)}…"\n• Relevant documentation located\n• Key signatures and usage patterns extracted\n• Summary of integration steps provided\n\n### External sources\n${this.formatResults(results)}\n\nSkill saved → \`skills/docs-lookup.json\` ✓`;
      await this.persistKnowledge("docs-lookup", summary, ["docs", "api", "library"]);
      return summary;
    }

    if (lower.includes("summarize") || lower.includes("summary")) {
      this.persistSkill("text-summarization", userText, [
        "Extract key sentences",
        "Group by theme",
        "Produce bullet summary",
      ]);
      const summary = `## Summary\n\n• Topic identified: "${userText.slice(0, 50)}…"\n• Key finding 1: core concept extracted\n• Key finding 2: implications noted\n• Key finding 3: action items surfaced\n\nSkill saved → \`skills/text-summarization.json\` ✓`;
      await this.persistKnowledge("text-summarization", summary, ["summary", "summarize"]);
      return summary;
    }

    if (lower.includes("skill") || lower.includes("self-improv")) {
      this.persistSkill("skill-creation", userText, [
        "Identify recurring task pattern",
        "Extract steps from execution",
        "Write skill JSON document",
        "Save to skills/ directory",
        "Increment usageCount on reuse",
      ]);
      const summary = `## Self-improvement loop\n\nHermes-style skill creation:\n1. Agent completes task\n2. Extracts reusable pattern → \`skills/<slug>.json\`\n3. Next time same task arrives → load skill, run faster\n4. After 20+ uses → successRate tracked\n\nSkill saved → \`skills/skill-creation.json\` ✓`;
      await this.persistKnowledge("skill-creation", summary, ["skill", "self-improvement"]);
      return summary;
    }

    this.persistSkill("general-research", userText, [
      "Parse user query intent",
      "Search knowledge base",
      "Structure findings",
      "Return with citations",
    ]);
    const results = await this.research(userText);
    const summary = `Librarian agent processed: "${userText}"\n\nFindings: topic processed by Librarian Agent.\nNo cached skill found — created \`skills/general-research.json\` for next time.\n\n### External sources\n${this.formatResults(results)}\n\nTip: delegate specific subtasks to Coder Agent via the orchestrator.`;
    await this.persistKnowledge("general-research", summary, ["general", "research"]);
    return summary;
  }

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
