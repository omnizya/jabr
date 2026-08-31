import { describe, expect, test } from "bun:test";
import { HeadroomAdapter } from "@adapters/headroom";
import type { AgentCard } from "@agents/types";
import { OrchestratorAgent } from "@core/orchestrator";
import { ToolRouter } from "@core/tool-router";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { MemoryStorePort } from "@ports/memory-store";
import type { TaskStorePort } from "@ports/task-store";

// ---- Fixed-budget HeadroomAdapter with known cap for deterministic assertions ----

function makeBudget(cap = 1_000_000): HeadroomAdapter {
	delete process.env.JABR_TOKEN_CAP_TESTAGENT;
	const adapter = new HeadroomAdapter();
	(adapter as any).caps = { testagent: cap };
	return adapter;
}

// ---- Noop memory port ----

const noopMemory: MemoryStorePort = {
	read: () => "",
	append: () => {},
	listSessions: () => [],
	deleteSession: () => false,
	getSession: () => null,
	saveSession: () => {},
};

// ---- Task store that records state transitions (no-op otherwise) ----

function makeTaskStore() {
	return {
		create(taskId: string) {
			return { id: taskId, state: "submitted", messages: [], artifacts: [] };
		},
		get(_taskId: string) {
			return undefined;
		},
		updateState(_taskId: string, _state: string) {},
		appendMessage(_taskId: string, _msg: any) {},
		appendArtifact: () => {},
		listByState: () => [],
		getTransitionHistory: () => [],
	} as TaskStorePort;
}

// ---- Constants ----

const TEST_AGENT_URL = "http://localhost:4201";
const TEST_AGENT_NAME = "testagent";

// ---- Agent card with pricing ----

function makePricedCard(costPerTask: number, costPerToken?: number): AgentCard {
	return {
		name: "Test Agent",
		description: "priced test agent",
		url: TEST_AGENT_URL,
		version: "1.0.0",
		capabilities: {},
		skills: [],
		pricing: { costPerTask, costPerToken },
	};
}

// ---- Registry stub: returns a canned response, never actually calls the agent ----

function makeRegistry(responseText: string): AgentRegistryPort {
	return {
		async fetchCard(_url: string) {
			return {
				name: "Test Agent",
				description: "",
				url: TEST_AGENT_URL,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				pricing: { costPerTask: 5, costPerToken: 2 },
			};
		},
		async delegateTask(_agentUrl: string, _text: string) {
			return responseText;
		},
	};
}

// ============================================================
//  Budget deduction accuracy tests
// ============================================================

describe("Budget deduction — character-length/4 token approximation", () => {
	test("deducts ceil(400 / 4) * costPerToken = 100 * costPerToken when costPerToken is declared", async () => {
		const costPerToken = 2;
		const costPerTask = 5;
		const input = "A".repeat(400); // exactly 400 characters

		const budget = makeBudget();
		const registry = makeRegistry("done");
		const taskStore = makeTaskStore();
		const card = makePricedCard(costPerTask, costPerToken);

		const toolRouter = new ToolRouter({
			agents: {
				[TEST_AGENT_NAME]: { name: TEST_AGENT_NAME, url: TEST_AGENT_URL, card },
			},
			registry,
			budget,
			memory: noopMemory,
		});

		const agent = new OrchestratorAgent(toolRouter, taskStore, noopMemory);

		const taskId = crypto.randomUUID();
		(taskStore as any).create(taskId);
		(taskStore as any).updateState(taskId, "submitted");

		await agent.execute(taskId, input);

		// Expected deduction: costPerTask + costPerToken * ceil(400 / 4)
		// = 5 + 2 * 100 = 205
		const expectedDeduction =
			costPerTask + costPerToken * Math.ceil(input.length / 4);
		const usage = budget.getUsage();
		const used = usage[TEST_AGENT_NAME]?.used;

		expect(used).not.toBeUndefined();
		expect(used).toBe(expectedDeduction);
	});

	test("deducts ceil(input.length / 4) * costPerToken for an arbitrary-length input", async () => {
		const costPerToken = 3;
		const costPerTask = 10;
		// 410 chars → ceil(410/4) = 103
		const input = "x".repeat(410);

		const budget = makeBudget();
		const registry = makeRegistry("done");
		const taskStore = makeTaskStore();
		const card = makePricedCard(costPerTask, costPerToken);

		const toolRouter = new ToolRouter({
			agents: {
				[TEST_AGENT_NAME]: { name: TEST_AGENT_NAME, url: TEST_AGENT_URL, card },
			},
			registry,
			budget,
			memory: noopMemory,
		});

		const agent = new OrchestratorAgent(toolRouter, taskStore, noopMemory);

		const taskId = crypto.randomUUID();
		(taskStore as any).create(taskId);
		(taskStore as any).updateState(taskId, "submitted");

		await agent.execute(taskId, input);

		const expectedDeduction =
			costPerTask + costPerToken * Math.ceil(input.length / 4);
		// 10 + 3 * 103 = 319
		const usage = budget.getUsage();
		const used = usage[TEST_AGENT_NAME]?.used;

		expect(used).toBe(expectedDeduction);
	});

	test("deducts only costPerTask when costPerToken is not declared (undefined)", async () => {
		const costPerTask = 7;
		const input = "B".repeat(400);

		const budget = makeBudget();
		const registry = makeRegistry("done");
		const taskStore = makeTaskStore();
		const card = makePricedCard(costPerTask); // no costPerToken

		const toolRouter = new ToolRouter({
			agents: {
				[TEST_AGENT_NAME]: { name: TEST_AGENT_NAME, url: TEST_AGENT_URL, card },
			},
			registry,
			budget,
			memory: noopMemory,
		});

		const agent = new OrchestratorAgent(toolRouter, taskStore, noopMemory);

		const taskId = crypto.randomUUID();
		(taskStore as any).create(taskId);
		(taskStore as any).updateState(taskId, "submitted");

		await agent.execute(taskId, input);

		// Expected: costPerTask + 0 * ceil(400/4) = 7
		const expectedDeduction = costPerTask;
		const usage = budget.getUsage();
		const used = usage[TEST_AGENT_NAME]?.used;

		expect(used).toBe(expectedDeduction);
	});

	test("budget cap is enforced after deduction; isExhausted returns true when cap hit", async () => {
		const costPerToken = 1;
		const costPerTask = 0;
		const input = "C".repeat(400);
		const cap = Math.ceil(input.length / 4) * costPerToken; // exactly 100

		const budget = makeBudget(cap);
		const registry = makeRegistry("done");
		const taskStore = makeTaskStore();
		const card = makePricedCard(costPerTask, costPerToken);

		const toolRouter = new ToolRouter({
			agents: {
				[TEST_AGENT_NAME]: { name: TEST_AGENT_NAME, url: TEST_AGENT_URL, card },
			},
			registry,
			budget,
			memory: noopMemory,
		});

		const agent = new OrchestratorAgent(toolRouter, taskStore, noopMemory);

		const taskId = crypto.randomUUID();
		(taskStore as any).create(taskId);
		(taskStore as any).updateState(taskId, "submitted");

		await agent.execute(taskId, input);

		const usage = budget.getUsage();
		expect(usage[TEST_AGENT_NAME]?.used).toBe(cap);
		expect(budget.isExhausted(TEST_AGENT_NAME)).toBe(true);
		expect(await budget.remaining(TEST_AGENT_NAME)).toBe(0);
	});
});
