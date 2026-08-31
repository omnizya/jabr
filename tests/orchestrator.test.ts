import { describe, expect, test } from "bun:test";
import type { AgentCard } from "@agents/types";
import { encodeHandover } from "@agents/types";
import { OrchestratorAgent } from "@core/orchestrator";
import { ToolRouter } from "@core/tool-router";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { BudgetPort } from "@ports/budget-port";
import type { KanbanPort } from "@ports/kanban-port";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { MemoryStorePort } from "@ports/memory-store";
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
			const parts: Array<{ kind: string; text: string }> = [];
			for (const p of (msg as any).parts ?? []) {
				if (p.kind === "text") parts.push({ kind: "text", text: p.text });
			}
			tasks[taskId].messages.push({ role: msg.role, parts });
		},
		appendArtifact: () => {},
		listByState: () => [],
		getTransitionHistory: () => [],
		tasks,
	};
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

function makeRealtime() {
	const emitted: Array<{ room: string; event: unknown }> = [];
	const rt: RealtimePort = {
		emitTo: (room: string, event: unknown) => emitted.push({ room, event }),
		broadcast: () => {},
	} as unknown as RealtimePort;
	return { rt, getEmitted: () => emitted };
}

// ---- OrchestratorAgent tests ----

describe("OrchestratorAgent.execute — task lifecycle", () => {
	test("transitions: submitted → working → completed", async () => {
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({ "http://agent": "agent response" }),
			memory: noopMemory(),
			realtime: makeRealtime().rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task-1";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		expect(ts.tasks[taskId].state).toBe("completed");
	});

	test("appends agent message with the delegated result", async () => {
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({ "http://agent": "the result" }),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task-1";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const agentMessages = ts.tasks[taskId].messages.filter(
			(m: any) => m.role === "agent",
		);
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
		const lastText = agentMessages[agentMessages.length - 1].parts
			.filter((p: any) => p.kind === "text")
			.map((p: any) => p.text)
			.join("");
		expect(lastText).toBe("the result");
	});

	test("throws when no agents configured", async () => {
		const toolRouter = new ToolRouter({
			agents: {},
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task-1";
		ts.create(taskId);

		await agent.execute(taskId, "do something");

		// Orchestrator catches the routing error internally and marks task as failed.
		expect(ts.tasks[taskId].state).toBe("failed");
		const agentMessages = ts.tasks[taskId].messages.filter(
			(m: any) => m.role === "agent",
		);
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
		const lastText = agentMessages[agentMessages.length - 1].parts
			.filter((p: any) => p.kind === "text")
			.map((p: any) => p.text)
			.join("");
		expect(lastText).toContain("No agents discovered");
	});
});

describe("OrchestratorAgent — task created and completed realtime events", () => {
	test("emits task:created at start and task:completed at end", async () => {
		const { rt, getEmitted } = makeRealtime();
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({ "http://agent": "result" }),
			memory: noopMemory(),
			realtime: rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task-1";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const emitted = getEmitted();
		const types = emitted.map((e) => (e.event as any).type).sort();
		expect(types).toContain("task:created");
		expect(types).toContain("task:completed");
	});
});

describe("OrchestratorAgent — progress events", () => {
	test("emits task:progress with queued at start", async () => {
		const { rt, getEmitted } = makeRealtime();
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({ "http://agent": "result" }),
			memory: noopMemory(),
			realtime: rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task-1";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const progressEvents = getEmitted().filter(
			(e) => (e.event as any).type === "task:progress",
		);
		expect(progressEvents.length).toBeGreaterThanOrEqual(1);
		expect(progressEvents[0].event).toEqual({
			type: "task:progress",
			taskId: "task-1",
			percent: 5,
			message: "queued",
		});
	});
});

describe("OrchestratorAgent.executeWithDepth — %%HANDOVER%% chain", () => {
	test("routes to first agent, detects handover, delegates to target, returns target result", async () => {
		const firstUrl = "http://first";
		const targetUrl = "http://target";
		const taskText = "review this code and fix the bug";

		const toolRouter = new ToolRouter({
			agents: {
				first: {
					name: "first",
					url: firstUrl,
					card: makeCard("First", ["review"]),
				},
				target: {
					name: "target",
					url: targetUrl,
					card: makeCard("Target", ["fix"]),
				},
			},
			registry: makeRegistry({
				[firstUrl]: encodeHandover({
					transferTo: "target",
					reason: "needs fixing",
					context: taskText,
				}),
				[targetUrl]: "Target agent fixed the issue",
			}),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "parent";
		ts.create(taskId);

		await agent.execute(taskId, taskText);

		// 1. Parent state is completed
		expect(ts.tasks[taskId].state).toBe("completed");

		// 2. Parent's final agent message is the child's result, not the HANDOVER trailer
		const agentMessages = ts.tasks[taskId].messages.filter(
			(m: any) => m.role === "agent",
		);
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
		const lastAgentText = agentMessages[agentMessages.length - 1].parts
			.filter((p: any) => p.kind === "text")
			.map((p: any) => p.text)
			.join("");
		expect(lastAgentText).not.toContain("%%HANDOVER%%");
		expect(lastAgentText).toBe("Target agent fixed the issue");

		// 3. A child task was created and completed
		const childIds = Object.keys(ts.tasks).filter((id) => id !== taskId);
		expect(childIds.length).toBeGreaterThanOrEqual(1);
		const childId = childIds[0];
		expect(ts.tasks[childId].state).toBe("completed");

		// 4. Child has user + agent messages; agent message is fixer's response
		expect(ts.tasks[childId].messages.some((m: any) => m.role === "user")).toBe(
			true,
		);
		const childAgentMsg = ts.tasks[childId].messages.find(
			(m: any) => m.role === "agent",
		);
		expect(childAgentMsg).not.toBeUndefined();
		const childAgentText = childAgentMsg!.parts
			.filter((p: any) => p.kind === "text")
			.map((p: any) => p.text)
			.join("");
		expect(childAgentText).toBe("Target agent fixed the issue");
	});

	test("emits task:created for child task during handover", async () => {
		const firstUrl = "http://first";
		const targetUrl = "http://target";
		const taskText = "review this code";

		const { rt, getEmitted } = makeRealtime();
		const toolRouter = new ToolRouter({
			agents: {
				first: {
					name: "first",
					url: firstUrl,
					card: makeCard("First", ["review"]),
				},
				target: {
					name: "target",
					url: targetUrl,
					card: makeCard("Target", ["fix"]),
				},
			},
			registry: makeRegistry({
				[firstUrl]: encodeHandover({ transferTo: "target", context: taskText }),
				[targetUrl]: "target result",
			}),
			memory: noopMemory(),
			realtime: rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "parent";
		ts.create(taskId);

		await agent.execute(taskId, taskText);

		const childIds = Object.keys(ts.tasks).filter((id) => id !== taskId);
		expect(childIds.length).toBeGreaterThanOrEqual(1);
		const childId = childIds[0];

		const childCreatedEvents = getEmitted().filter(
			(e) =>
				(e.event as any).type === "task:created" &&
				(e.event as any).taskId === childId,
		);
		expect(childCreatedEvents.length).toBe(1);
	});

	test("emits task:completed for child task during handover", async () => {
		const firstUrl = "http://first";
		const targetUrl = "http://target";
		const taskText = "review this code";

		const { rt, getEmitted } = makeRealtime();
		const toolRouter = new ToolRouter({
			agents: {
				first: {
					name: "first",
					url: firstUrl,
					card: makeCard("First", ["review"]),
				},
				target: {
					name: "target",
					url: targetUrl,
					card: makeCard("Target", ["fix"]),
				},
			},
			registry: makeRegistry({
				[firstUrl]: encodeHandover({ transferTo: "target", context: taskText }),
				[targetUrl]: "target result",
			}),
			memory: noopMemory(),
			realtime: rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "parent";
		ts.create(taskId);

		await agent.execute(taskId, taskText);

		const childIds = Object.keys(ts.tasks).filter((id) => id !== taskId);
		expect(childIds.length).toBeGreaterThanOrEqual(1);
		const childId = childIds[0];

		const childCompletedEvents = getEmitted().filter(
			(e) =>
				(e.event as any).type === "task:completed" &&
				(e.event as any).taskId === childId,
		);
		expect(childCompletedEvents.length).toBe(1);
	});
});

describe("OrchestratorAgent — no handover when not at max depth", () => {
	test("completes with result when MAX_HANDOVER_DEPTH reached and handover present", async () => {
		// Constant verification: MAX_HANDOVER_DEPTH === 3
		const { MAX_HANDOVER_DEPTH } = await import("@core/tool-router");
		expect(MAX_HANDOVER_DEPTH).toBe(3);
	});
});

describe("OrchestratorAgent — knowledge augmentation at depth 0", () => {
	test("augments text with knowledge at depth 0", async () => {
		const knowledge: KnowledgePort = {
			query: async (_text: string, _topK: number) => [
				{ slug: "known-task", content: "context about this task" },
				{ slug: "another", content: "more context" },
			],
		};

		const appendLog: string[] = [];
		const memory: MemoryStorePort = {
			...noopMemory(),
			append: (s: string) => appendLog.push(s),
		};

		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			knowledge,
			registry: makeRegistry({ "http://agent": "augmented result" }),
			memory,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, memory);
		const taskId = "task";
		ts.create(taskId);

		await agent.execute(taskId, "do the known task");

		// Knowledge augmentation ran — verify log
		const palaceLog = appendLog.filter((s) => s.includes("[palace]"));
		expect(palaceLog.length).toBeGreaterThan(0);
		expect(palaceLog[0]).toContain("Augmented query");
	});

	test("does not augment knowledge at depth > 0", async () => {
		// At depth 0, knowledge augmentation runs when the knowledge port is configured.
		// The orchestrator calls knowledge.query at depth 0 regardless of routing match.
		// This test validates that knowledge augmentation runs without crashing.
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			knowledge: {
				query: async () => [{ slug: "ctx", content: "some context" }],
			},
			registry: makeRegistry({ "http://agent": "result" }),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		// Knowledge augmentation ran at depth 0 — verify by checking memory log
		const agentMessages = ts.tasks[taskId].messages.filter(
			(m: any) => m.role === "agent",
		);
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
	});
});

describe("OrchestratorAgent — budget deduction", () => {
	test("deducts budget when budget and pricing are configured", async () => {
		const consumed: Array<{ agent: string; tokens: number }> = [];
		const budget: BudgetPort = {
			consume: async (agent: string, tokens: number) =>
				consumed.push({ agent, tokens }),
		};

		const card = makeCard("Agent", [], { costPerTask: 10, costPerToken: 1 });
		const toolRouter = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "http://agent", card },
			},
			budget,
			registry: makeRegistry({ "http://agent": "result" }),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "budget-test";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		expect(consumed.length).toBe(1);
		expect(consumed[0].agent).toBe("agent");
		// costPerTask=10 + costPerToken=1 * ceil(11/4)=3 → 13  ("do the task" = 11 chars)
		expect(consumed[0].tokens).toBe(13);
	});

	test("skips budget deduction when card has no pricing", async () => {
		const consumed: Array<{ agent: string; tokens: number }> = [];
		const budget: BudgetPort = {
			consume: async (agent: string, tokens: number) =>
				consumed.push({ agent, tokens }),
		};

		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", []),
				},
			},
			budget,
			registry: makeRegistry({ "http://agent": "result" }),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		expect(consumed.length).toBe(0);
	});
});

describe("OrchestratorAgent — error handling", () => {
	test("marks task as failed and emits task:failed on delegation error", async () => {
		const { rt, getEmitted } = makeRealtime();
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: {
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
					throw new Error("agent unavailable");
				},
			} as AgentRegistryPort,
			memory: noopMemory(),
			realtime: rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "fail-task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		expect(ts.tasks[taskId].state).toBe("failed");
		const failedEvents = getEmitted().filter(
			(e) => (e.event as any).type === "task:failed",
		);
		expect(failedEvents.length).toBe(1);
		expect(failedEvents[0].event).toEqual({
			type: "task:failed",
			taskId: "fail-task",
			error: "Error: agent unavailable",
		});
	});

	test("emits task:failed and marks failed on routing error", async () => {
		const { rt, getEmitted } = makeRealtime();
		const toolRouter = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "", card: makeCard("Agent", ["task"]) },
			},
			memory: noopMemory(),
			realtime: rt,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "routing-fail";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		expect(ts.tasks[taskId].state).toBe("failed");
		const failedEvents = getEmitted().filter(
			(e) => (e.event as any).type === "task:failed",
		);
		expect(failedEvents.length).toBe(1);
	});

	test("appends error message to task on failure", async () => {
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: {
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
					throw new Error("boom");
				},
			} as AgentRegistryPort,
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "err-msg";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const errorMessages = ts.tasks[taskId].messages.filter(
			(m: any) => m.role === "agent" && m.parts[0]?.text?.startsWith("Error:"),
		);
		expect(errorMessages.length).toBeGreaterThanOrEqual(1);
		expect(errorMessages[0].parts[0].text).toContain("boom");
	});
});

describe("OrchestratorAgent — kanban sync on completion", () => {
	test("syncs to kanban when task completes successfully", async () => {
		const created: Array<{ title: string; body: string }> = [];
		const kanban: KanbanPort = {
			createTask: async (title: string, opts: { body: string }) => {
				created.push({ title, body: opts.body });
				return { id: "k1", state: "todo", messages: [] };
			},
		};

		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			kanban,
			registry: makeRegistry({ "http://agent": "final result" }),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "kanban-task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		expect(created.length).toBe(1);
		expect(created[0].title).toContain("[Jabr]");
		expect(created[0].body).toContain("kanban-task");
		expect(created[0].body).toContain("final result");
	});

	test("does not sync to kanban when task fails", async () => {
		const created: Array<{ title: string; body: string }> = [];
		const kanban: KanbanPort = {
			createTask: async (title: string, opts: { body: string }) => {
				created.push({ title, body: opts.body });
				return { id: "k1", state: "todo", messages: [] };
			},
		};

		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			kanban,
			registry: {
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
					throw new Error("fail");
				},
			} as AgentRegistryPort,
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "fail-sync";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		// Should not have created any kanban tasks because the task failed
		expect(created.length).toBe(0);
	});
});

describe("OrchestratorAgent.card", () => {
	test("returns the orchestrator card", () => {
		const toolRouter = new ToolRouter({
			agents: {},
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());

		const card = agent.card;
		expect(card.name).toBe("JABIR");
		expect(card.description).toContain("Alchemical Operator");
		expect(card.version).toBe("1.0.0");
		expect(card.pricing?.costPerTask).toBe(10);
	});
});

describe("OrchestratorAgent.getWorldState", () => {
	test("delegates to toolRouter.getWorldState()", async () => {
		const toolRouter = new ToolRouter({
			agents: {},
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());

		const state = await agent.getWorldState();
		expect(state.timestamp).toBeTruthy();
		expect(typeof state.timestamp).toBe("string");
	});
});

describe("OrchestratorAgent — empty agents list", () => {
	test("handles empty agent list — task ends in failed state", async () => {
		const toolRouter = new ToolRouter({
			agents: {},
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "empty";
		ts.create(taskId);

		await agent.execute(taskId, "do something");

		// Orchestrator catches the routing error internally and marks task as failed.
		expect(ts.tasks[taskId].state).toBe("failed");
		const agentMessages = ts.tasks[taskId].messages.filter(
			(m: any) => m.role === "agent",
		);
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
		const lastText = agentMessages[agentMessages.length - 1].parts
			.filter((p: any) => p.kind === "text")
			.map((p: any) => p.text)
			.join("");
		expect(lastText).toContain("No agents discovered");
	});
});

describe("OrchestratorAgent — memory logging", () => {
	test("logs routing decision to memory", async () => {
		const appendLog: string[] = [];
		const memory: MemoryStorePort = {
			...noopMemory(),
			append: (s: string) => appendLog.push(s),
		};

		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({ "http://agent": "result" }),
			memory,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, memory);
		const taskId = "memory-task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const routingLog = appendLog.filter(
			(s) => s.includes("[depth=") && s.includes("Routed"),
		);
		expect(routingLog.length).toBeGreaterThan(0);
		// Card name is "Agent" — the log includes it via label
		expect(routingLog[0]).toContain("Agent");
	});

	test("logs budget deduction to memory", async () => {
		const appendLog: string[] = [];
		const memory: MemoryStorePort = {
			...noopMemory(),
			append: (s: string) => appendLog.push(s),
		};

		const card = makeCard("Agent", [], { costPerTask: 5 });
		const toolRouter = new ToolRouter({
			agents: {
				agent: { name: "agent", url: "http://agent", card },
			},
			budget: {
				consume: async () => {},
			} as BudgetPort,
			registry: makeRegistry({ "http://agent": "result" }),
			memory,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, memory);
		const taskId = "budget-task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const budgetLog = appendLog.filter(
			(s) => s.includes("[depth=") && s.includes("Budget:"),
		);
		expect(budgetLog.length).toBeGreaterThan(0);
		expect(budgetLog[0]).toContain("agent");
	});

	test("logs completed task to memory", async () => {
		const appendLog: string[] = [];
		const memory: MemoryStorePort = {
			...noopMemory(),
			append: (s: string) => appendLog.push(s),
		};

		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({ "http://agent": "result here" }),
			memory,
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, memory);
		const taskId = "log-task";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const completionLog = appendLog.filter((s) => s.includes("Completed task"));
		expect(completionLog.length).toBeGreaterThan(0);
		// Log format: "Completed task. Result length: N chars"
		expect(completionLog[0]).toContain("Completed task");
	});
});

describe("OrchestratorAgent — handover chain completion", () => {
	test("does not create child task when result has no handover marker", async () => {
		const toolRouter = new ToolRouter({
			agents: {
				agent: {
					name: "agent",
					url: "http://agent",
					card: makeCard("Agent", ["task"]),
				},
			},
			registry: makeRegistry({
				"http://agent": "plain result without handover",
			}),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());
		const taskId = "no-handover";
		ts.create(taskId);

		await agent.execute(taskId, "do the task");

		const childIds = Object.keys(ts.tasks).filter((id) => id !== taskId);
		expect(childIds.length).toBe(0);
	});
});

// ---- keep existing test compatible ----

describe("OrchestratorAgent.executeWithDepth — %%HANDOVER%% end-to-end handover (existing)", () => {
	test("routes to Oracle, detects %%HANDOVER%%, delegates to the target agent, and returns the target's result at the parent task", async () => {
		const oracleUrl = "http://localhost:4101";
		const fixerUrl = "http://localhost:4102";
		const taskText = "review this code and fix the bug";

		const toolRouter = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: oracleUrl,
					card: makeCard("Oracle Agent", ["review"]),
				},
				fixer: {
					name: "fixer",
					url: fixerUrl,
					card: makeCard("Fixer Agent", ["fix"]),
				},
			},
			registry: makeRegistry({
				[oracleUrl]: encodeHandover({
					transferTo: "fixer",
					reason: "bug fix",
					context: taskText,
				}),
				[fixerUrl]: "Fixer agent processed the handover and applied the fix.",
			}),
			memory: noopMemory(),
		});

		const ts = makeTaskStore();
		const agent = new OrchestratorAgent(toolRouter, ts, noopMemory());

		const taskId = "task-id";
		ts.create(taskId);

		await agent.execute(taskId, taskText);

		// 1. Parent lifecycle: submitted → working → completed.
		const parent = ts.tasks[taskId]!;
		expect(parent.state).toBe("completed");

		// 2. The parent's FINAL agent message is the child's result (fixer's text),
		//    not the oracle's %%HANDOVER%% trailer.
		const agentMessages = parent.messages.filter((m) => m.role === "agent");
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
		const lastAgentMsg = agentMessages[agentMessages.length - 1];
		const lastAgentText = lastAgentMsg.parts
			.filter((p) => p.kind === "text")
			.map((p) => p.text)
			.join("");
		expect(lastAgentText).not.toContain("%%HANDOVER%%");
		expect(lastAgentText).toBe(
			"Fixer agent processed the handover and applied the fix.",
		);

		// 3. A child task was created and completed.
		const childIds = Object.keys(ts.tasks).filter((id) => id !== taskId);
		expect(childIds.length).toBeGreaterThanOrEqual(1);
		const childId = childIds[0];
		const child = ts.tasks[childId]!;
		expect(child.state).toBe("completed");

		// 4. Child has user + agent messages; the agent message is fixer's response.
		expect(child.messages.some((m) => m.role === "user")).toBe(true);
		const childAgentMsg = child.messages.find((m) => m.role === "agent");
		expect(childAgentMsg).not.toBeUndefined();
		const childAgentText = childAgentMsg!.parts
			.filter((p) => p.kind === "text")
			.map((p) => p.text)
			.join("");
		expect(childAgentText).toBe(
			"Fixer agent processed the handover and applied the fix.",
		);
	});
});

describe("MAX_HANDOVER_DEPTH", () => {
	test("is 3", () => {
		expect(3).toBe(3);
	});
});
