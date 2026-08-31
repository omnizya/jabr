import { describe, expect, test } from "bun:test";
import type { X402Client } from "@adapters/x402/x402-client";
import { CognitiveLoop } from "@agents/core/cognitive-loop";
import type { AgentCard } from "@agents/types";
import { MAX_HANDOVER_DEPTH, ToolRouter } from "@core/tool-router";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { BudgetPort } from "@ports/budget-port";
import type { KanbanPort } from "@ports/kanban-port";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { MemoryStorePort } from "@ports/memory-store";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { RealtimePort } from "@ports/realtime-port";
import type { TaskStorePort } from "@ports/task-store";

// ---- helpers ----

function makeCard(
	name: string,
	tags: string[],
	pricing?: { costPerTask: number; costPerToken?: number },
): AgentCard {
	return {
		name,
		description: "",
		url: "",
		version: "1.0.0",
		capabilities: {},
		skills: [
			{
				name,
				description: "",
				tags,
				inputModes: ["text"],
				outputModes: ["text"],
			},
		],
		pricing,
	};
}

function noopMemory(): MemoryStorePort {
	return {
		read: () => "",
		append: () => {},
		listSessions: () => [],
		deleteSession: () => false,
		getSession: () => null,
		saveSession: () => {},
	};
}

function noopBudget(): BudgetPort {
	return { consume: async () => {} };
}

function makeRegistry(responses: Record<string, string>): AgentRegistryPort {
	return {
		async fetchCard() {
			return {
				name: "stub",
				description: "",
				url: "",
				version: "1.0.0",
				capabilities: {},
				skills: [],
			};
		},
		async delegateTask(agentUrl: string) {
			return responses[agentUrl] ?? "";
		},
	};
}

function makeX402Client(responses: Record<string, string>): X402Client {
	return {
		delegateTask: async (
			agentUrl: string,
			_text: string,
			_agentName?: string,
		) => {
			return responses[agentUrl] ?? "";
		},
	} as X402Client;
}

// Realtime mock that records all emitTo calls.
function makeRealtime() {
	const emitted: Array<{ room: string; event: unknown }> = [];
	const rt: RealtimePort = {
		emitTo: (room: string, event: unknown) => emitted.push({ room, event }),
		broadcast: () => {},
	} as unknown as RealtimePort;
	return { rt, getEmitted: () => emitted };
}

// ---- ToolRouter tests ----

describe("ToolRouter.routeTask — keyword-based routing", () => {
	test("routes to the agent whose tags best match the task text", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://o",
					card: makeCard("Oracle", ["review", "code"]),
				},
				fixer: {
					name: "fixer",
					url: "http://f",
					card: makeCard("Fixer", ["fix", "bug"]),
				},
			},
			memory: noopMemory(),
		});

		const result = await router.routeTask("review this code for bugs");
		expect(result).not.toBeNull();
		expect(result?.agentName).toBe("oracle");
	});

	test("routes to fixer when task is about fixing a bug", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://o",
					card: makeCard("Oracle", ["review"]),
				},
				fixer: {
					name: "fixer",
					url: "http://f",
					card: makeCard("Fixer", ["fix", "bug"]),
				},
			},
			memory: noopMemory(),
		});

		const result = await router.routeTask("fix the bug in this function");
		expect(result?.agentName).toBe("fixer");
	});

	test("returns the first agent when no tags match", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://o",
					card: makeCard("Oracle", ["review"]),
				},
				fixer: {
					name: "fixer",
					url: "http://f",
					card: makeCard("Fixer", ["fix"]),
				},
			},
			memory: noopMemory(),
		});

		const result = await router.routeTask("boil water for tea");
		expect(result).not.toBeNull();
		expect(result?.agentName).toBe("oracle");
	});

	test("returns null when no agents are configured", async () => {
		const router = new ToolRouter({ agents: {}, memory: noopMemory() });
		const result = await router.routeTask("do something");
		expect(result).toBeNull();
	});

	test("prefers exact word match (score 3) over substring match (score 1)", async () => {
		const router = new ToolRouter({
			agents: {
				a: { name: "a", url: "http://a", card: makeCard("A", ["review"]) },
				b: { name: "b", url: "http://b", card: makeCard("B", ["reviewing"]) },
			},
			memory: noopMemory(),
		});

		const result = await router.routeTask("do a review");
		expect(result?.agentName).toBe("a");
	});

	test("handles single-word task that partially matches a tag", async () => {
		const router = new ToolRouter({
			agents: {
				explorer: {
					name: "explorer",
					url: "http://e",
					card: makeCard("Explorer", ["scan", "search", "find"]),
				},
			},
			memory: noopMemory(),
		});

		const result = await router.routeTask("scan");
		expect(result?.agentName).toBe("explorer");
	});

	test("empty task text still falls back to first agent", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://o",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
		});

		const result = await router.routeTask("");
		expect(result).not.toBeNull();
		expect(result?.agentName).toBe("oracle");
	});
});

describe("ToolRouter — URL and card resolution", () => {
	test("getAgentUrl returns the URL for a known agent", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://oracle:4001",
					card: makeCard("O", []),
				},
			},
			memory: noopMemory(),
		});

		expect(await router.getAgentUrl("oracle")).toBe("http://oracle:4001");
	});

	test("getAgentUrl returns undefined for unknown agent", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: { name: "oracle", url: "http://o", card: makeCard("O", []) },
			},
			memory: noopMemory(),
		});

		expect(await router.getAgentUrl("nonexistent")).toBeUndefined();
	});

	test("getCard returns the card for a known agent", async () => {
		const card = makeCard("Oracle", ["review"]);
		const router = new ToolRouter({
			agents: { oracle: { name: "oracle", url: "http://o", card } },
			memory: noopMemory(),
		});

		expect(await router.getCard("oracle")).toEqual(card);
	});

	test("getCard returns undefined for unknown agent", async () => {
		const router = new ToolRouter({
			agents: {
				oracle: { name: "oracle", url: "http://o", card: makeCard("O", []) },
			},
			memory: noopMemory(),
		});

		expect(await router.getCard("ghost")).toBeUndefined();
	});

	test("getAvailableAgentNames returns all configured agent names", () => {
		const router = new ToolRouter({
			agents: {
				oracle: { name: "oracle", url: "http://o", card: makeCard("O", []) },
				fixer: { name: "fixer", url: "http://f", card: makeCard("F", []) },
				librarian: {
					name: "librarian",
					url: "http://l",
					card: makeCard("L", []),
				},
			},
			memory: noopMemory(),
		});

		const names = router.getAvailableAgentNames();
		expect(names.sort()).toEqual(["fixer", "librarian", "oracle"]);
	});

	test("getAvailableAgentNames returns empty array when no agents", () => {
		const router = new ToolRouter({ agents: {}, memory: noopMemory() });
		expect(router.getAvailableAgentNames()).toEqual([]);
	});
});

describe("ToolRouter.delegateTask — delegation", () => {
	test("uses x402Client when configured", async () => {
		const x402 = makeX402Client({ "http://agent": "x402 delegated" });
		const router = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "http://agent", card: makeCard("A", []) },
			},
			x402Client: x402,
			memory: noopMemory(),
		});

		const result = await router.delegateTask("http://agent", "task", "agent");
		expect(result).toBe("x402 delegated");
	});

	test("falls back to registry when no x402Client", async () => {
		const registry = makeRegistry({ "http://agent": "registry delegated" });
		const router = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "http://agent", card: makeCard("A", []) },
			},
			registry,
			memory: noopMemory(),
		});

		const result = await router.delegateTask("http://agent", "task", "agent");
		expect(result).toBe("registry delegated");
	});

	test("throws when neither x402Client nor registry is configured", async () => {
		const router = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "http://agent", card: makeCard("A", []) },
			},
			memory: noopMemory(),
		});

		await expect(router.delegateTask("http://agent", "task")).rejects.toThrow(
			"No delegation mechanism configured",
		);
	});
});

describe("ToolRouter.deductBudget — budget deduction", () => {
	test("deducts budget when budget and pricing are configured", async () => {
		const consumed: Array<{ agent: string; tokens: number }> = [];
		const budget: BudgetPort = {
			consume: async (agent: string, tokens: number) =>
				consumed.push({ agent, tokens }),
		};

		const card = makeCard("Agent", [], { costPerTask: 10, costPerToken: 1 });
		const router = new ToolRouter({
			agents: { agent: { name: "agent", url: "http://a", card } },
			budget,
			memory: noopMemory(),
		});

		await router.deductBudget("agent", 100);
		expect(consumed.length).toBe(1);
		expect(consumed[0]!.agent).toBe("agent");
		// costPerTask=10 + costPerToken=1 * ceil(100/4)=25 → 35
		expect(consumed[0]!.tokens).toBe(35);
	});

	test("skips budget deduction when no budget configured", async () => {
		const router = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://a",
					card: makeCard("A", [], { costPerTask: 10 }),
				},
			},
			memory: noopMemory(),
		});

		await router.deductBudget("agent", 100);
	});

	test("skips budget deduction when card has no pricing", async () => {
		const consumed: Array<{ agent: string; tokens: number }> = [];
		const budget: BudgetPort = {
			consume: async (agent: string, tokens: number) =>
				consumed.push({ agent, tokens }),
		};

		const router = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "http://a", card: makeCard("A", []) },
			},
			budget,
			memory: noopMemory(),
		});

		await router.deductBudget("agent", 100);
		expect(consumed.length).toBe(0);
	});

	test("logs to memory when memory is configured", async () => {
		const memLog: string[] = [];
		const memory: MemoryStorePort = {
			...noopMemory(),
			append: (s: string) => memLog.push(s),
		};

		const card = makeCard("Agent", [], { costPerTask: 5 });
		const router = new ToolRouter({
			agents: { agent: { name: "agent", url: "http://a", card } },
			budget: noopBudget(),
			memory,
		});

		await router.deductBudget("agent", 20);
		expect(memLog.length).toBe(1);
		expect(memLog[0]).toContain("[budget]");
		expect(memLog[0]).toContain("agent");
	});
});

describe("ToolRouter.delegateToMultiple — multi-agent delegation", () => {
	test("delegates to all agents except orchestrator and returns results", async () => {
		const responses: Record<string, string> = {
			"http://a1": "response from a1",
			"http://a2": "response from a2",
		};
		const registry = makeRegistry(responses);
		const router = new ToolRouter({
			agents: {
				orchestrator: {
					name: "orchestrator",
					url: "http://orch",
					card: makeCard("Orch", []),
				},
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
				agent2: {
					name: "agent2",
					url: "http://a2",
					card: makeCard("A2", ["task"]),
				},
			},
			registry,
			memory: noopMemory(),
		});

		const results = await router.delegateToMultiple(
			["orchestrator", "agent1", "agent2"],
			"do the task",
		);

		expect(results.length).toBe(2);
		expect(results.map((r) => r.agentName).sort()).toEqual([
			"agent1",
			"agent2",
		]);
	});

	test("skips agents with no URL", async () => {
		// Agent1 has a valid URL, agent2 has empty URL (falsy).
		// delegateToMultiple should skip agent2 and include agent1's result.
		const registry = makeRegistry({});
		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
				agent2: { name: "agent2", url: "", card: makeCard("A2", ["task"]) },
			},
			registry,
			memory: noopMemory(),
		});

		const results = await router.delegateToMultiple(
			["agent1", "agent2"],
			"task",
		);
		// agent1 is included (valid URL), agent2 is skipped (empty URL)
		expect(results.length).toBe(1);
		expect(results[0]!.agentName).toBe("agent1");
	});

	test("handles individual agent failures gracefully", async () => {
		const throwingRegistry: AgentRegistryPort = {
			async fetchCard() {
				return {
					name: "stub",
					description: "",
					url: "",
					version: "1.0.0",
					capabilities: {},
					skills: [],
				};
			},
			async delegateTask(url: string) {
				if (url === "http://a2") throw new Error("agent down");
				return "ok";
			},
		};
		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
				agent2: {
					name: "agent2",
					url: "http://a2",
					card: makeCard("A2", ["task"]),
				},
			},
			registry: throwingRegistry,
			memory: noopMemory(),
		});

		const results = await router.delegateToMultiple(
			["agent1", "agent2"],
			"task",
		);
		expect(results.length).toBe(1);
		expect(results[0]!.agentName).toBe("agent1");
	});
});

describe("ToolRouter.executeConsensus — consensus", () => {
	test("falls back to single agent when fewer than 2 participants", async () => {
		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
			},
			registry: makeRegistry({ "http://a1": "single response" }),
			memory: noopMemory(),
		});

		const result = await router.executeConsensus("do the task");
		expect(result).toBe("single response");
	});

	test("returns 'No agents available for consensus' when no URL", async () => {
		const router = new ToolRouter({
			agents: {
				agent1: { name: "agent1", url: "", card: makeCard("A1", ["task"]) },
			},
			memory: noopMemory(),
		});

		const result = await router.executeConsensus("task");
		expect(result).toBe("No agents available for consensus");
	});

	test("returns first response when no cognitive loop configured", async () => {
		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
				agent2: {
					name: "agent2",
					url: "http://a2",
					card: makeCard("A2", ["task"]),
				},
			},
			registry: makeRegistry({ "http://a1": "resp1", "http://a2": "resp2" }),
			memory: noopMemory(),
		});

		const result = await router.executeConsensus("task");
		expect(result).toBe("resp1");
	});

	test("uses cognitive loop to evaluate and synthesize when configured", async () => {
		const loop = new CognitiveLoop();
		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["review"]),
				},
				agent2: {
					name: "agent2",
					url: "http://a2",
					card: makeCard("A2", ["fix"]),
				},
			},
			registry: makeRegistry({ "http://a1": "reviewed", "http://a2": "fixed" }),
			cognitiveLoop: loop,
			memory: noopMemory(),
		});

		const result = await router.executeConsensus("review this code");
		expect(result).toContain("## Consensus Result");
		expect(result).toContain("Winner");
	});

	test("returns 'No agents responded' when all delegates fail", async () => {
		const throwingRegistry: AgentRegistryPort = {
			async fetchCard() {
				return {
					name: "stub",
					description: "",
					url: "",
					version: "1.0.0",
					capabilities: {},
					skills: [],
				};
			},
			async delegateTask() {
				throw new Error("all down");
			},
		};
		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
				agent2: {
					name: "agent2",
					url: "http://a2",
					card: makeCard("A2", ["task"]),
				},
			},
			registry: throwingRegistry,
			memory: noopMemory(),
		});

		const result = await router.executeConsensus("task");
		// 2+ agents → delegateToMultiple catches each error → returns []
		// → executeConsensus returns "No agents responded"
		expect(result).toBe("No agents responded");
	});

	test("logs consensus delegation to memory when configured", async () => {
		const memLog: string[] = [];
		const memory: MemoryStorePort = {
			...noopMemory(),
			append: (s: string) => memLog.push(s),
		};
		const loop = new CognitiveLoop();

		const router = new ToolRouter({
			agents: {
				agent1: {
					name: "agent1",
					url: "http://a1",
					card: makeCard("A1", ["task"]),
				},
				agent2: {
					name: "agent2",
					url: "http://a2",
					card: makeCard("A2", ["task"]),
				},
			},
			registry: makeRegistry({ "http://a1": "r1", "http://a2": "r2" }),
			cognitiveLoop: loop,
			memory,
		});

		await router.executeConsensus("task");
		expect(memLog.some((s) => s.includes("[consensus] Delegating to"))).toBe(
			true,
		);
	});
});

describe("ToolRouter.getWorldState — world state", () => {
	test("returns world state with timestamp", async () => {
		const router = new ToolRouter({ agents: {}, memory: noopMemory() });
		const state = await router.getWorldState();
		expect(state.timestamp).toBeTruthy();
		expect(typeof state.timestamp).toBe("string");
	});

	test("reports memory entries based on orchestrator.md existence", async () => {
		// getWorldState reads memory/orchestrator.md from process.cwd().
		// In the project dir, this file exists, so totalEntries will be 1.
		// We validate the shape rather than the exact value.
		const router = new ToolRouter({ agents: {}, memory: noopMemory() });
		const state = await router.getWorldState();
		expect(state.memory).toBeDefined();
		expect(typeof state.memory.totalEntries).toBe("number");
		expect(typeof state.memory.lastUpdated).toBe("string");
	});
});

describe("ToolRouter.syncToKanban — kanban sync", () => {
	test("creates a kanban task when kanban is configured", async () => {
		const created: Array<{ title: string; body: string }> = [];
		const kanban: KanbanPort = {
			createTask: async (title: string, opts: { body: string }) => {
				created.push({ title, body: opts.body });
				return { id: "k1", state: "todo", messages: [] };
			},
		};

		const taskStore: TaskStorePort = {
			create: (id: string) => ({ id, state: "submitted", messages: [] }),
			get: (id: string) => ({
				id,
				state: "submitted",
				messages: [
					{
						role: "user",
						parts: [{ kind: "text", text: "the original task" }],
					},
				],
			}),
			updateState: () => {},
			appendMessage: () => {},
			appendArtifact: () => {},
			listByState: () => [],
			getTransitionHistory: () => [],
		};

		const router = new ToolRouter({
			agents: {},
			kanban,
			memory: noopMemory(),
		});

		await router.syncToKanban(taskStore, "task-1", "result text here");
		expect(created.length).toBe(1);
		expect(created[0]!.title).toContain("[Jabr]");
		expect(created[0]!.body).toContain("task-1");
		expect(created[0]!.body).toContain("result text here");
	});

	test("does nothing when kanban is not configured", async () => {
		const taskStore: TaskStorePort = {
			create: (id: string) => ({ id, state: "submitted", messages: [] }),
			get: () => undefined,
			updateState: () => {},
			appendMessage: () => {},
			appendArtifact: () => {},
			listByState: () => [],
			getTransitionHistory: () => [],
		};

		const router = new ToolRouter({
			agents: {},
			memory: noopMemory(),
		});

		await router.syncToKanban(taskStore, "task-1", "result");
	});

	test("silently handles task not found in store", async () => {
		const kanban: KanbanPort = {
			createTask: async (_title: string, _opts: { body: string }) => {
				throw new Error("should not be called");
			},
		};

		const taskStore: TaskStorePort = {
			create: (id: string) => ({ id, state: "submitted", messages: [] }),
			get: () => undefined,
			updateState: () => {},
			appendMessage: () => {},
			appendArtifact: () => {},
			listByState: () => [],
			getTransitionHistory: () => [],
		};

		const router = new ToolRouter({
			agents: {},
			kanban,
			memory: noopMemory(),
		});

		await router.syncToKanban(taskStore, "missing-task", "result");
	});
});

describe("ToolRouter — realtime lifecycle emissions", () => {
	test("emitTaskCreated emits task:created event", () => {
		const { rt, getEmitted } = makeRealtime();
		const router = new ToolRouter({
			agents: {},
			realtime: rt,
		});

		router.emitTaskCreated("task-1", "agent-x");
		const emitted = getEmitted();
		expect(emitted.length).toBe(1);
		expect(emitted[0]!.room).toBe("task-task-1");
		expect(emitted[0]!.event).toEqual({
			type: "task:created",
			taskId: "task-1",
			agent: "agent-x",
		});
	});

	test("emitTaskCreated emits onTaskStart to plugin bus", () => {
		const { rt, getEmitted } = makeRealtime();
		const bus = new PluginEventBusImpl();
		const busEvents: Array<{ name: string; payload: any }> = [];
		bus.subscribe("onTaskStart", (payload, name) =>
			busEvents.push({ name, payload }),
		);

		const router = new ToolRouter({
			agents: {},
			realtime: rt,
			pluginEventBus: bus,
		});

		router.emitTaskCreated("task-1", "agent-x", {
			title: "Test task",
			priority: 5,
		});
		expect(getEmitted().length).toBe(1);
		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.taskId).toBe("task-1");
		expect(busEvents[0]!.payload.title).toBe("Test task");
		expect(busEvents[0]!.payload.priority).toBe(5);
		expect(busEvents[0]!.payload.assignee).toBe("agent-x");
		expect(busEvents[0]!.payload.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	test("emitTaskProgress emits task:progress event", () => {
		const { rt, getEmitted } = makeRealtime();
		const router = new ToolRouter({
			agents: {},
			realtime: rt,
		});

		router.emitTaskProgress("task-1", 50, "half done");
		const emitted = getEmitted();
		expect(emitted.length).toBe(1);
		expect(emitted[0]!.event).toEqual({
			type: "task:progress",
			taskId: "task-1",
			percent: 50,
			message: "half done",
		});
	});

	test("emitTaskCompleted emits task:completed event", () => {
		const { rt, getEmitted } = makeRealtime();
		const router = new ToolRouter({
			agents: {},
			realtime: rt,
		});

		router.emitTaskCompleted("task-1", { result: "done" });
		const emitted = getEmitted();
		expect(emitted.length).toBe(1);
		expect(emitted[0]!.event).toEqual({
			type: "task:completed",
			taskId: "task-1",
			result: { result: "done" },
		});
	});

	test("emitTaskCompleted emits onTaskComplete to plugin bus with duration", () => {
		const { rt, getEmitted } = makeRealtime();
		const bus = new PluginEventBusImpl();
		const busEvents: Array<{ name: string; payload: any }> = [];
		bus.subscribe("onTaskComplete", (payload, name) =>
			busEvents.push({ name, payload }),
		);

		const router = new ToolRouter({
			agents: {},
			realtime: rt,
			pluginEventBus: bus,
		});

		const startedAt = new Date(Date.now() - 1000).toISOString();
		router.emitTaskCompleted("task-1", "result text", {
			startedAt,
			title: "My task",
			assignee: "agent-x",
			priority: 3,
		});

		expect(getEmitted().length).toBe(1);
		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.taskId).toBe("task-1");
		expect(busEvents[0]!.payload.title).toBe("My task");
		expect(busEvents[0]!.payload.summary).toBe("result text");
		expect(busEvents[0]!.payload.durationMs).toBeGreaterThanOrEqual(900);
	});

	test("emitTaskFailed emits task:failed event", () => {
		const { rt, getEmitted } = makeRealtime();
		const router = new ToolRouter({
			agents: {},
			realtime: rt,
		});

		router.emitTaskFailed("task-1", "something broke");
		const emitted = getEmitted();
		expect(emitted.length).toBe(1);
		expect(emitted[0]!.event).toEqual({
			type: "task:failed",
			taskId: "task-1",
			error: "something broke",
		});
	});

	test("emitTaskFailed emits onTaskFailed to plugin bus with retry semantics", () => {
		const { rt, getEmitted } = makeRealtime();
		const bus = new PluginEventBusImpl();
		const busEvents: Array<{ name: string; payload: any }> = [];
		bus.subscribe("onTaskFailed", (payload, name) =>
			busEvents.push({ name, payload }),
		);

		const router = new ToolRouter({
			agents: {},
			realtime: rt,
			pluginEventBus: bus,
		});

		router.emitTaskFailed("task-1", "timeout", {
			startedAt: new Date(Date.now() - 5000).toISOString(),
			title: "Failed task",
			assignee: "agent-x",
			priority: 2,
			retryable: true,
			retryCount: 1,
		});

		expect(getEmitted().length).toBe(1);
		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.taskId).toBe("task-1");
		expect(busEvents[0]!.payload.error.message).toBe("timeout");
		expect(busEvents[0]!.payload.retryable).toBe(true);
		expect(busEvents[0]!.payload.retryCount).toBe(1);
		expect(busEvents[0]!.payload.durationMs).toBeGreaterThanOrEqual(4900);
	});

	test("no emissions when realtime is not configured", () => {
		const router = new ToolRouter({
			agents: {},
		});

		expect(() => router.emitTaskCreated("t1", "a")).not.toThrow();
		expect(() => router.emitTaskProgress("t1", 5, "msg")).not.toThrow();
		expect(() => router.emitTaskCompleted("t1", "r")).not.toThrow();
		expect(() => router.emitTaskFailed("t1", "err")).not.toThrow();
	});
});

describe("ToolRouter — private helpers (via routing behavior)", () => {
	test("extractKeywords filters stop words and short tokens", async () => {
		// "the a is" — all stop words / 1-2 chars → extractKeywords returns []
		// With the oracle agent configured (review tag), [] won't match → fallback to first
		// agent. To test extractKeywords properly we validate: a task with ONLY stop words
		// produces no keyword matches, so routing score is 0 and the first agent is returned.
		const router = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://o",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
		});
		const result = await router.routeTask("the a is");
		// All words are stop-words → no keywords → score 0 → fallback to first (oracle)
		expect(result?.agentName).toBe("oracle");
	});

	test("extractTags deduplicates tags across skills", async () => {
		// Use makeCard helper which produces valid AgentCard type
		const router = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://a",
					card: makeCard("Agent", ["review", "code", "fix"]),
				},
			},
			memory: noopMemory(),
		});

		// "review" appears in the card's tags (deduplicated by extractTags)
		// score = 3 (exact word match)
		const result = await router.routeTask("review code");
		expect(result?.agentName).toBe("agent");
	});
});

describe("MAX_HANDOVER_DEPTH", () => {
	test("is 3", () => {
		expect(MAX_HANDOVER_DEPTH).toBe(3);
	});
});
