import type { TaskStorePort } from "@ports/task-store";
import type { SkillStorePort } from "@ports/skill-store";
import type { LlmPort } from "@ports/llm-port";
import type { AgentCard, A2AMessage } from "@agents/types";
import { encodeHandover } from "@agents/types";

export const ORACLE_CARD: AgentCard = {
  name: "RUSHD",
  description: "RUSHD (ابن رشد) — Rational Sage. Reviews code, simplifies implementations, makes architecture decisions. Senior-level advisor.",
  url: "",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    { name: "Review code", description: "Senior-level code review for correctness, patterns, and maintainability", tags: ["review", "code-review", "audit"], inputModes: ["text"], outputModes: ["text"] },
    { name: "Simplify code", description: "Behavior-preserving simplification for readability", tags: ["simplify", "refactor", "readability"], inputModes: ["text"], outputModes: ["text"] },
    { name: "Architecture advice", description: "System design decisions, trade-offs, refactoring strategy", tags: ["architecture", "design", "trade-off"], inputModes: ["text"], outputModes: ["text"] },
  ],
  pricing: { costPerTask: 15 },
};

/**
 * Seed keys resolvable by DynamicRegistry.getUrl() (see seedUrls in
 * agents/run/orchestrator.ts). "oracle" is intentionally excluded — a
 * specialist cannot hand over to itself. Keep in sync with seedUrls.
 */
export const VALID_TRANSFER_TARGETS = [
  "fixer",
  "librarian",
  "explorer",
  "designer",
  "scientist",
  "jarvis",
] as const;

const ROUTING_SYSTEM_PROMPT = `You are the routing judge for ORACLE, a specialist agent in the Jabr multi-agent system.

ORACLE's lane — answer these yourself:
- Code review: correctness, patterns, maintainability
- Code simplification and refactoring advice
- Architecture and design decisions, trade-offs

Other specialists — hand off when the task clearly belongs to one of them:
- fixer: fixing bugs, writing code, mechanical implementation, running Python
- librarian: documentation, web research, code search
- explorer: finding files, repository mapping, codebase recon
- designer: UI/UX design, responsive layouts
- scientist: Python data analysis
- jarvis: codebase scanning, dependency watch, test gap analysis, doc sync, AI automation opportunities

Decide whether the incoming task belongs to ORACLE or is mis-routed.

Respond with ONLY a JSON object — no markdown fences, no prose, no trailing text:
{"decision":"answer"}
or
{"decision":"handover","transferTo":"<specialist>","reason":"<short reason>","context":"<task text for the target specialist>"}

Rules:
- Choose "answer" when the core ask is review, simplification, or architecture advice — even if the task also mentions bugs or features.
- Choose "handover" only when the task clearly belongs to another specialist's lane (e.g. "fix this bug", "write this function", "find these files", "design this UI").
- "transferTo" must be one of: fixer, librarian, explorer, designer, scientist, jarvis.
- "context" is the text the target specialist will receive. Default to the original task text; you may rephrase it so the target's lane is explicit (e.g. include "fix" or "bug" for fixer).`;

interface RouteDecision {
  decision: "answer" | "handover";
  transferTo?: string;
  reason?: string;
  context?: string;
}

export class OracleAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
    private llm?: LlmPort,
  ) {}

  get card(): AgentCard {
    return ORACLE_CARD;
  }

  executeTask(userText: string): { text: string; artifact?: { name: string; content: string } } {
    const lower = userText.toLowerCase();

    if (lower.includes("review") || lower.includes("audit")) {
      return {
        text: `## Code Review\n\n**Correctness**: Logic appears sound. Verify edge cases.\n**Patterns**: Consider extracting a helper function for repeated logic.\n**Maintainability**: Add JSDoc comments to public API.\n**Testing**: No tests found — add unit tests for core paths.\n**Suggestion**: The function could be simplified by using early returns.`,
      };
    }

    if (lower.includes("simplify") || lower.includes("refactor")) {
      return {
        text: `## Simplification\n\n**Before**: Complex nested conditionals\n**After**: Early-return guard clauses improve readability\n\nKey changes:\n1. Extract validation into a separate function\n2. Replace nested if-else with guard clauses\n3. Use descriptive variable names\n4. Add type annotations for clarity`,
      };
    }

    if (lower.includes("architecture") || lower.includes("design") || lower.includes("trade-off")) {
      return {
        text: `## Architecture Analysis\n\n**Current approach**: Single monolith with direct function calls.\n**Trade-offs**: Simple but limits independent scaling.\n\n**Recommendations**:\n1. Extract domain logic behind port interfaces (hexagonal)\n2. Keep adapters thin — one per transport (HTTP, stdio, CLI)\n3. Composition roots wire everything at startup\n4. Core modules must never import infrastructure`,
      };
    }

    return {
      text: `Oracle analyzed: "${userText}"\n\nProvide a code snippet, review request, or architecture question for detailed analysis.`,
    };
  }

  async execute(taskId: string, userText: string): Promise<void> {
    const { text, artifact } = await this.run(userText);
    this.taskStore.updateState(taskId, "completed");
    this.taskStore.appendMessage(taskId, {
      messageId: crypto.randomUUID(),
      role: "agent",
      kind: "message",
      parts: [{ kind: "text", text }],
      contextId: taskId,
      taskId,
    });
    if (artifact) {
      this.taskStore.appendArtifact(taskId, {
        name: artifact.name,
        parts: [{ kind: "text", text: artifact.content }],
      });
    }
  }

  private async run(
    userText: string,
  ): Promise<{ text: string; artifact?: { name: string; content: string } }> {
    if (!this.llm) return this.executeTask(userText);
    try {
      const decision = await this.decideRoute(userText, this.llm);
      if (decision.decision === "handover" && decision.transferTo) {
        const handoverText = encodeHandover({
          transferTo: decision.transferTo,
          reason: decision.reason ?? "Task is outside Oracle's lane",
          context: decision.context ?? userText,
        });
        console.log(`[Oracle] Handing off to ${decision.transferTo}: ${decision.reason ?? ""}`);
        return {
          text: `This task is outside my lane — handing off to the ${decision.transferTo} specialist.\n${handoverText}`,
        };
      }
    } catch (err) {
      console.error("[Oracle] Routing decision failed — answering directly:", err);
    }
    return this.executeTask(userText);
  }

  private async decideRoute(userText: string, llm: LlmPort): Promise<RouteDecision> {
    const response = await llm.generate({
      prompt: `Task: ${userText}`,
      systemPrompt: ROUTING_SYSTEM_PROMPT,
      temperature: 0.2,
      maxTokens: 400,
    });

    const parsed = this.extractJson(response.text) as Partial<RouteDecision> | null;
    if (!parsed || typeof parsed !== "object") return { decision: "answer" };

    if (parsed.decision === "handover") {
      const transferTo = typeof parsed.transferTo === "string" ? parsed.transferTo : undefined;
      if (transferTo && (VALID_TRANSFER_TARGETS as readonly string[]).includes(transferTo)) {
        return {
          decision: "handover",
          transferTo,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
          context: typeof parsed.context === "string" ? parsed.context : undefined,
        };
      }
      console.warn(`[Oracle] LLM requested handover to invalid target "${transferTo}" — answering directly`);
    }
    return { decision: "answer" };
  }

  private extractJson(text: string): any {
    const firstObj = text.indexOf("{");
    const firstArr = text.indexOf("[");

    // Determine which top-level value ({ or [) appears first.
    let start = -1;
    let open = "";
    let close = "";
    if (firstObj === -1 && firstArr === -1) return null;
    if (firstArr === -1 || (firstObj !== -1 && firstObj < firstArr)) {
      start = firstObj;
      open = "{";
      close = "}";
    } else {
      start = firstArr;
      open = "[";
      close = "]";
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
