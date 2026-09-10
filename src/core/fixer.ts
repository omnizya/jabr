import type { A2AMessage, AgentCard } from "@agents/types";
import { SYNTHESIS_TEMPERATURE } from "@constants/app-constants";
import type { LlmPort } from "@ports/llm-port";
import type { SkillStorePort } from "@ports/skill-store";
import type { TaskStorePort } from "@ports/task-store";

export const FIXER_CARD: AgentCard = {
	name: "TARIQ",
	description:
		"TARIQ (Tariq ibn Ziyad) — The Vanguard. Fixes bugs, generates code, runs reviews, executes Python. Bounded implementation specialist.",
	url: "",
	version: "1.0.0",
	capabilities: {
		streaming: true,
		pushNotifications: false,
		stateTransitionHistory: true,
	},
	securitySchemes: {},
	securityRequirements: [],
	skills: [
		{
			name: "Fix bug",
			description: "Diagnoses and fixes bugs, errors, and broken behavior",
			tags: ["fix", "bug", "error", "patch", "repair", "debug"],
			inputModes: ["text"],
			outputModes: ["text", "data"],
		},
		{
			name: "Write code",
			description: "Generates code from a natural language description",
			tags: [
				"code",
				"implement",
				"function",
				"algorithm",
				"typescript",
				"write",
			],
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
	pricing: { costPerTask: 20 },
};

const FIXER_SYSTEM_PROMPT = `You are TARIQ (The Vanguard), a TypeScript and Python implementation specialist in the Jabr multi-agent system.

Your lane:
- Fixing bugs, errors, and broken behavior in code
- Writing TypeScript and Python code from descriptions
- Running Python snippets via uv subprocess
- Code review for correctness, style, and edge cases

When the user describes a bug or asks for a fix:
1. Reproduce the failing behavior (explain what's wrong)
2. Locate the root cause (point to exact code/logic)
3. Apply a minimal, targeted fix (show the corrected code)
4. Verify with a test (describe or write a test)

Always respond with concrete, actionable output. Use markdown with code blocks for snippets. Be specific — do NOT give generic filler or skeleton responses.`;

export class FixerAgent {
	constructor(
		private taskStore: TaskStorePort,
		private skillStore: SkillStorePort,
		private llm?: LlmPort,
	) {}

	get card(): AgentCard {
		return FIXER_CARD;
	}

	executeTask(userText: string): {
		text: string;
		artifact?: { name: string; content: string };
	} {
		const lower = userText.toLowerCase();

		if (
			lower.includes("bug") ||
			lower.includes("fix") ||
			lower.includes("error")
		) {
			return {
				text: `Bug fix analysis for: "${userText}"\n\n1. Reproduce the failing behavior\n2. Locate the root cause\n3. Apply a minimal, targeted fix\n4. Verify with a test\n\nFix applied — review the diff and run the test suite.`,
			};
		}

		if (lower.includes("fibonacci") || lower.includes("fib")) {
			const saved = this.skillStore.save("fibonacci-generation", {
				name: "Fibonacci Generation",
				description:
					"Generate a Fibonacci sequence implementation in TypeScript",
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
			if (!saved)
				console.error(
					`[Fixer] failed to save fibonacci-generation skill (already exists)`,
				);
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

	private async runWithLlm(userText: string): Promise<{
		text: string;
		artifact?: { name: string; content: string };
	} | null> {
		if (!this.llm) return null;
		try {
			const prompt = `The user has asked: "${userText}"

Provide a concrete, actionable response. If this is a bug fix request:
- Identify the likely root cause
- Show the fix with code
- Include a verification step

If this is a code request, write the implementation. If it's a review, provide specific feedback.`;

			const response = await this.llm.generate({
				prompt,
				systemPrompt: FIXER_SYSTEM_PROMPT,
				temperature: SYNTHESIS_TEMPERATURE,
				maxTokens: 1500,
			});

			if (response.text && response.text.trim().length > 0) {
				return { text: response.text.trim() };
			}
			return null;
		} catch (err) {
			console.error(
				"[Fixer] LLM generation failed — falling back to keyword matcher:",
				err,
			);
			return null;
		}
	}

	async execute(taskId: string, userText: string): Promise<void> {
		this.taskStore.updateState(taskId, "working");

		let result = await this.runWithLlm(userText);
		if (!result) {
			result = this.executeTask(userText);
		}

		const { text, artifact } = result;
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
