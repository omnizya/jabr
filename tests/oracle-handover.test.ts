import { describe, expect, test } from "bun:test";
import { TaskMemory } from "@adapters/task-memory";
import { decodeHandover, HANDOVER_MARKER } from "@agents/types";
import { OracleAgent } from "@core/oracle";
import type { LlmPort } from "@ports/llm-port";
import type { SkillStorePort } from "@ports/skill-store";

const stubSkills: SkillStorePort = {
	save: () => false,
	exists: () => false,
	list: () => [],
};

function stubLlm(text: string): LlmPort {
	return {
		async generate() {
			return {
				text,
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			};
		},
		async streamGenerate(_req, onChunk) {
			onChunk(text);
			return {
				text,
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			};
		},
	};
}

function lastAgentText(store: TaskMemory, taskId: string): string {
	const task = store.get(taskId);
	const last = task?.messages.filter((m) => m.role === "agent").pop();
	return last?.parts.find((p) => p.kind === "text")?.text ?? "";
}

async function runOracle(
	llmText: string | null,
	taskText: string,
): Promise<string> {
	const store = new TaskMemory();
	const agent = new OracleAgent(
		store,
		stubSkills,
		llmText === null ? undefined : stubLlm(llmText),
	);
	const taskId = crypto.randomUUID();
	store.create(taskId);
	await agent.execute(taskId, taskText);
	return lastAgentText(store, taskId);
}

describe("OracleAgent LLM-driven routing", () => {
	test("emits %%HANDOVER%% with valid transferTo when LLM says handover", async () => {
		const text = await runOracle(
			JSON.stringify({
				decision: "handover",
				transferTo: "fixer",
				reason: "bug fix",
				context: "fix the bug in checkout",
			}),
			"the checkout flow drops the cart",
		);
		expect(text).toContain(HANDOVER_MARKER);
		const handover = decodeHandover(text);
		expect(handover).not.toBeNull();
		expect(handover?.transferTo).toBe("fixer");
		expect(handover?.reason).toBe("bug fix");
		expect(handover?.context).toBe("fix the bug in checkout");
	});

	test("answers directly when LLM says answer", async () => {
		const text = await runOracle(
			JSON.stringify({ decision: "answer" }),
			"review this function for edge cases",
		);
		expect(text).toContain("## Code Review");
		expect(text).not.toContain(HANDOVER_MARKER);
	});

	test("falls back to keyword answer on non-JSON LLM output", async () => {
		const text = await runOracle(
			"I think this is a review task, let me answer it.",
			"review this function",
		);
		expect(text).toContain("## Code Review");
		expect(text).not.toContain(HANDOVER_MARKER);
	});

	test("falls back to keyword answer when transferTo is invalid", async () => {
		const text = await runOracle(
			JSON.stringify({ decision: "handover", transferTo: "not-an-agent" }),
			"simplify this code",
		);
		expect(text).toContain("## Simplification");
		expect(text).not.toContain(HANDOVER_MARKER);
	});

	test("answers directly when no LLM is injected (backward compat)", async () => {
		const text = await runOracle(null, "architecture design of the monolith");
		expect(text).toContain("## Architecture Analysis");
	});
});
