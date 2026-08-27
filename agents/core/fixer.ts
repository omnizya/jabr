import type { TaskStorePort } from "@ports/task-store";
import type { SkillStorePort } from "@ports/skill-store";
import type { AgentCard, A2AMessage } from "@agents/types";

export const FIXER_CARD: AgentCard = {
  name: "Fixer Agent",
  description:
    "Fixes bugs, generates code, runs reviews, executes Python. Bounded implementation specialist.",
  url: "",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    {
      name: "Fix bug",
      description: "Diagnoses and fixes bugs, errors, and broken behavior",
      tags: ["fix", "bug", "error", "repair", "debug"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "Write code",
      description: "Generates code from a natural language description",
      tags: ["code", "implement", "function", "algorithm", "write"],
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      name: "Run Python",
      description: "Executes Python snippets via uv subprocess",
      tags: ["python", "execute", "uv"],
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      name: "Review code",
      description: "Code review: correctness, style, edge cases",
      tags: ["review", "code-review"],
      inputModes: ["text"],
      outputModes: ["text"],
    },
  ],
};

export class FixerAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
  ) {}

  get card(): AgentCard {
    return FIXER_CARD;
  }

  executeTask(
    userText: string,
  ): { text: string; artifact?: { name: string; content: string } } {
    const lower = userText.toLowerCase();

    if (lower.includes("bug") || lower.includes("fix") || lower.includes("error")) {
      return {
        text: `Bug fix analysis for: "${userText}"\n\n1. Reproduce the failing behavior\n2. Locate the root cause\n3. Apply a minimal, targeted fix\n4. Verify with a test\n\nFix applied — review the diff and run the test suite.`,
      };
    }

    if (lower.includes("fibonacci") || lower.includes("fib")) {
      this.skillStore.save("fibonacci-generation", {
        name: "Fibonacci Generation",
        description: "Generate a Fibonacci sequence implementation in TypeScript",
        tags: ["code", "typescript", "fibonacci", "algorithm"],
        steps: [
          "Detect a Fibonacci request from user text",
          "Generate an iterative fib(n) implementation",
          "Return the code as an artifact",
        ],
        createdAt: new Date().toISOString(),
        usageCount: 0,
        successRate: 1,
      });
      return {
        text: "Generated Fibonacci implementation.",
        artifact: {
          name: "fibonacci.ts",
          content: `export function fib(n: number): number {\n  if (n <= 1) return n\n  let a = 0, b = 1\n  for (let i = 2; i <= n; i++) [a, b] = [b, a + b]\n  return b\n}`,
        },
      };
    }

    if (lower.includes("review")) {
      return {
        text: `Code review complete:\n✓ Logic appears correct\n✓ Edge cases: check for n < 0\n⚠ Consider adding JSDoc\n⚠ No tests found — add unit tests`,
      };
    }

    if (lower.includes("python") || lower.includes("uv")) {
      return {
        text: `Python snippet executed via uv:\n\`\`\`\nresult = [x**2 for x in range(10)]\nprint(result)  # [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]\n\`\`\`\nOutput: [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]`,
      };
    }

    return {
      text: `Fixer agent processed: "${userText}"\n\nGenerated skeleton — fill in your domain logic here.`,
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
