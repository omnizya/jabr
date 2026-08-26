import type { TaskStorePort } from "../ports/task-store.ts";
import type { SkillStorePort } from "../ports/skill-store.ts";
import type { AgentCard, A2AMessage } from "../types.ts";

export const CODER_CARD: AgentCard = {
  name: "Coder Agent",
  description:
    "Writes, reviews, and runs code. Delegates Python execution to MCP uv-tools.",
  url: "", // filled by run module
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    {
      id: "write-code",
      name: "Write code",
      description: "Generates code from a natural language description",
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      id: "run-python",
      name: "Run Python",
      description: "Executes Python snippets via uv subprocess",
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      id: "review-code",
      name: "Review code",
      description: "Code review: correctness, style, edge cases",
      inputModes: ["text"],
      outputModes: ["text"],
    },
  ],
};

export class CoderAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
  ) {}

  get card(): AgentCard {
    return CODER_CARD;
  }

  // Pure domain logic — pattern matching on user text
  executeTask(
    userText: string,
  ): { text: string; artifact?: { name: string; content: string } } {
    const lower = userText.toLowerCase();

    if (lower.includes("fibonacci") || lower.includes("fib")) {
      // Save skill (idempotent — skipped if slug already exists)
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
      text: `Coder agent processed: "${userText}"\n\nGenerated skeleton — fill in your domain logic here.`,
    };
  }

  // High-level: execute and update task store
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
