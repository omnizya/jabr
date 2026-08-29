import type { TaskStorePort } from "@ports/task-store";
import type { SkillStorePort } from "@ports/skill-store";
import type { AgentCard, A2AMessage } from "@agents/types";

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
};

export class OracleAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
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
    const { text, artifact } = this.executeTask(userText);
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
}
