import { describe, expect, test } from "bun:test";
import {
	CognitiveLoop,
	type ConsensusInput,
} from "@agents/core/cognitive-loop";
import type { AgentCard, AgentSkill } from "@agents/types";

const makeCard = (skills: AgentSkill[] = []): AgentCard => ({
	name: "test-agent",
	description: "",
	url: "http://localhost:9999",
	version: "1.0.0",
	capabilities: {},
	skills,
});

const makeInput = (response: string, card = makeCard()): ConsensusInput => ({
	agentName: "test-agent",
	card,
	response,
});

describe("CognitiveLoop.scoreResponse — stop-word filtering", () => {
	const loop = new CognitiveLoop();

	test("scores below 0.1 when the task consists only of stop-words", () => {
		const task = "the a this is";
		const input = makeInput("some response text here");
		const { score } = loop.scoreResponse(input, task);
		expect(score).toBeLessThan(0.1);
	});

	test("scores below 0.1 when task is only common stop-words", () => {
		const task = "the and or but of in on at to for with by from";
		const input = makeInput("a completely unrelated response");
		const { score } = loop.scoreResponse(input, task);
		expect(score).toBeLessThan(0.1);
	});

	test("retains expected scoring for a normal task after stop-word filtering", () => {
		const task = "fix the bug in this function";
		const input = makeInput(
			"I fixed the bug in the function by patching the error",
		);
		const { score, reasons } = loop.scoreResponse(input, task);

		// The filtered task words are ["fix", "bug", "function"] — all three appear
		// in the response, so relevance should be 1.0, contributing 0.3 to the score.
		expect(score).toBeGreaterThanOrEqual(0.3);
		expect(reasons).toContainEqual(expect.stringContaining("relevance="));
	});

	test("relevance drops when stop-words are the only overlap", () => {
		// Task has real content; response only overlaps on stop-words.
		const task = "analyze the code structure";
		const input = makeInput("the and or but of");
		const { score, reasons } = loop.scoreResponse(input, task);

		// Filtered task words: ["analyze", "code", "structure"] — none in response.
		// Relevance should be 0, so score should come only from successRate (0) and
		// response length (0.2 if > 100 chars).
		expect(score).toBeLessThan(0.25);
		expect(reasons).toContainEqual(expect.stringContaining("relevance=0.00"));
	});

	test("empty filtered task yields zero relevance without division by zero", () => {
		const task = "the a is";
		const input = makeInput("whatever response");
		const { score, reasons } = loop.scoreResponse(input, task);

		// All words are stop-words → filtered set is empty → relevance = 0.
		expect(score).toBeLessThan(0.1);
		expect(reasons).toContainEqual(expect.stringContaining("relevance=0.00"));
	});
});
