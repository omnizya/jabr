import { describe, expect, test } from "bun:test";
import type { ConsensusInput } from "@agents/core/cognitive-loop";
import type { AgentCard, AgentSkill, SkillDocument } from "@agents/types";
import { VerificationAgent, type VerificationResult } from "@core/verification";
import type { SkillStorePort } from "@ports/skill-store";
import type { TaskStorePort } from "@ports/task-store";

// ---- test helpers ----

function makeCard(name: string, skills: AgentSkill[] = []): AgentCard {
	return {
		name,
		description: "",
		url: "http://localhost:9999",
		version: "1.0.0",
		capabilities: {},
		skills,
	};
}

function makeInput(
	agentName: string,
	response: string,
	card?: AgentCard,
): ConsensusInput {
	return {
		agentName,
		card: card ?? makeCard(agentName),
		response,
	};
}

function makeTaskStore(): TaskStorePort & { tasks: Record<string, any> } {
	const tasks: Record<string, any> = {};
	return {
		create(taskId: string) {
			tasks[taskId] = {
				id: taskId,
				state: "submitted",
				messages: [],
				artifacts: [],
			};
			return tasks[taskId];
		},
		get(taskId: string) {
			return tasks[taskId];
		},
		updateState(taskId: string, state: string) {
			if (tasks[taskId]) tasks[taskId].state = state;
		},
		appendMessage(taskId: string, msg: any) {
			if (!tasks[taskId]) return;
			tasks[taskId].messages.push(msg);
		},
		appendArtifact: () => {},
		listByState: () => [],
		getTransitionHistory: () => [],
		tasks,
	};
}

function makeSkillStore(): SkillStorePort {
	const skills: Record<string, SkillDocument> = {};
	return {
		save(slug: string, doc: SkillDocument) {
			if (skills[slug]) return false;
			skills[slug] = doc;
			return true;
		},
		exists(slug: string) {
			return slug in skills;
		},
		list() {
			return Object.keys(skills);
		},
	};
}

// ---- tests ----

describe("VerificationAgent.verify — consensus threshold", () => {
	test("returns consensus=true when top score meets threshold", async () => {
		const agent = new VerificationAgent(
			makeTaskStore(),
			makeSkillStore(),
			undefined,
			{ consensusThreshold: 0.5, minAgents: 2 },
		);

		const inputs = [
			makeInput(
				"oracle",
				"I reviewed the code and found it follows good patterns with proper error handling and comprehensive tests",
				makeCard("oracle", [
					{ name: "Review", description: "", tags: ["review", "code-review"] },
				]),
			),
			makeInput(
				"librarian",
				"The documentation covers the API well",
				makeCard("librarian", [
					{ name: "Research", description: "", tags: ["research", "doc"] },
				]),
			),
		];

		const result = await agent.verify(inputs, "review this code for quality");

		expect(result.participantCount).toBe(2);
		expect(result.winner).toBe("oracle");
		expect(result.confidence).toBeGreaterThanOrEqual(0.4);
		expect(result.consensus).toBe(false);
		expect(result.contested).toBe(true);
		expect(result.scores.length).toBe(2);
	});

	test("returns consensus=true with high-quality matching response", async () => {
		const agent = new VerificationAgent(
			makeTaskStore(),
			makeSkillStore(),
			undefined,
			{ consensusThreshold: 0.4, minAgents: 2 },
		);

		const inputs = [
			makeInput(
				"oracle",
				"I reviewed the code and found it follows good patterns with proper error handling and comprehensive quality tests",
				makeCard("oracle", [
					{ name: "Review", description: "", tags: ["review", "code-review"] },
				]),
			),
			makeInput(
				"librarian",
				"The documentation covers the API well",
				makeCard("librarian", [
					{ name: "Research", description: "", tags: ["research", "doc"] },
				]),
			),
		];

		const result = await agent.verify(inputs, "review this code for quality");

		expect(result.participantCount).toBe(2);
		expect(result.winner).toBe("oracle");
		expect(result.confidence).toBeGreaterThanOrEqual(0.4);
		expect(result.consensus).toBe(true);
		expect(result.contested).toBe(false);
		expect(result.scores.length).toBe(2);
	});

	test("returns contested=true when no agent meets threshold", async () => {
		const agent = new VerificationAgent(
			makeTaskStore(),
			makeSkillStore(),
			undefined,
			{ consensusThreshold: 0.95, minAgents: 2 },
		);

		const inputs = [makeInput("oracle", "ok"), makeInput("librarian", "ok")];

		const result = await agent.verify(inputs, "review this code");

		expect(result.consensus).toBe(false);
		expect(result.contested).toBe(true);
		expect(result.threshold).toBe(0.95);
	});

	test("returns contested when fewer than minAgents provided", async () => {
		const agent = new VerificationAgent(
			makeTaskStore(),
			makeSkillStore(),
			undefined,
			{ consensusThreshold: 0.7, minAgents: 3 },
		);

		const inputs = [makeInput("oracle", "response")];
		const result = await agent.verify(inputs, "review this code");

		expect(result.consensus).toBe(false);
		expect(result.contested).toBe(true);
		expect(result.participantCount).toBe(1);
		expect(result.synthesized).toContain("Insufficient agents");
	});

	test("threshold is configurable per instance", async () => {
		const lowThreshold = new VerificationAgent(
			makeTaskStore(),
			makeSkillStore(),
			undefined,
			{ consensusThreshold: 0.1, minAgents: 2 },
		);
		const highThreshold = new VerificationAgent(
			makeTaskStore(),
			makeSkillStore(),
			undefined,
			{ consensusThreshold: 0.99, minAgents: 2 },
		);

		const inputs = [
			makeInput("oracle", "good response with review content"),
			makeInput("librarian", "brief"),
		];

		const lowResult = await lowThreshold.verify(inputs, "review code");
		const highResult = await highThreshold.verify(inputs, "review code");

		// Low threshold should accept, high threshold should contest
		expect(lowResult.consensus).toBe(true);
		expect(highResult.consensus).toBe(false);
	});
});

describe("VerificationAgent.execute — A2A integration", () => {
	test("writes help message when no JSON inputs provided", async () => {
		const taskStore = makeTaskStore();
		const agent = new VerificationAgent(taskStore, makeSkillStore());

		const taskId = "test-task-1";
		taskStore.create(taskId);
		await agent.execute(taskId, "hello world");

		const task = taskStore.tasks[taskId];
		expect(task.state).toBe("completed");
		expect(task.messages.length).toBe(1);
		const text = task.messages[0].parts[0].text;
		expect(text).toContain("No Inputs");
		expect(text).toContain("Consensus threshold");
	});

	test("writes help message when JSON has no inputs array", async () => {
		const taskStore = makeTaskStore();
		const agent = new VerificationAgent(taskStore, makeSkillStore());

		const taskId = "test-task-2";
		taskStore.create(taskId);
		await agent.execute(taskId, JSON.stringify({ task: "something" }));

		const task = taskStore.tasks[taskId];
		expect(task.state).toBe("completed");
		const text = task.messages[0].parts[0].text;
		expect(text).toContain("No Inputs");
	});

	test("verifies inputs and writes synthesized result", async () => {
		const taskStore = makeTaskStore();
		const agent = new VerificationAgent(
			taskStore,
			makeSkillStore(),
			undefined,
			{
				consensusThreshold: 0.1,
				minAgents: 2,
			},
		);

		const taskId = "test-task-3";
		taskStore.create(taskId);

		const payload = {
			task: "review this code",
			inputs: [
				{
					agentName: "oracle",
					card: makeCard("oracle", [
						{ name: "Review", description: "", tags: ["review"] },
					]),
					response:
						"Code review complete: the logic is sound, edge cases are handled, and tests cover the main paths",
				},
				{
					agentName: "librarian",
					card: makeCard("librarian", [
						{ name: "Research", description: "", tags: ["research"] },
					]),
					response: "Found relevant documentation",
				},
			],
		};

		await agent.execute(taskId, JSON.stringify(payload));

		const task = taskStore.tasks[taskId];
		expect(task.state).toBe("completed");
		expect(task.messages.length).toBe(1);
		const text = task.messages[0].parts[0].text;
		// Should contain the synthesized result (winner's response)
		expect(text).toContain("Code review complete");
	});

	test("saves skill on successful verification", async () => {
		const taskStore = makeTaskStore();
		const skillStore = makeSkillStore();
		const agent = new VerificationAgent(taskStore, skillStore, undefined, {
			consensusThreshold: 0.1,
			minAgents: 2,
		});

		const taskId = "test-task-4";
		taskStore.create(taskId);

		const payload = {
			task: "review this code",
			inputs: [
				{
					agentName: "oracle",
					card: makeCard("oracle"),
					response:
						"Detailed review with comprehensive analysis of the code quality",
				},
				{
					agentName: "librarian",
					card: makeCard("librarian"),
					response: "Found docs",
				},
			],
		};

		await agent.execute(taskId, JSON.stringify(payload));

		// Skill should have been saved
		const skills = skillStore.list();
		expect(skills.length).toBe(1);
	});
});

describe("VerificationAgent — card and metadata", () => {
	test("exposes SHURA card with correct name", () => {
		const agent = new VerificationAgent(makeTaskStore(), makeSkillStore());
		expect(agent.card.name).toBe("SHURA");
		expect(agent.card.description).toContain("Cross-checks");
		expect(agent.card.skills.length).toBeGreaterThanOrEqual(3);
	});

	test("card has verification-related tags", () => {
		const agent = new VerificationAgent(makeTaskStore(), makeSkillStore());
		const allTags = agent.card.skills.flatMap((s) => s.tags);
		expect(allTags).toContain("verify");
		expect(allTags).toContain("consensus");
		expect(allTags).toContain("contested");
	});
});
