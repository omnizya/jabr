import { describe, expect, test } from "bun:test";
import type { AgentCard } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { MemoryStorePort } from "@ports/memory-store.ts";
import { ToolRouter } from "../src/core/tool-router.ts";

// ---- helpers ----

function makeCard(name: string, tags: string[]): AgentCard {
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
		supportedInterfaces: [],
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

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function makeRegistry(
	responses: Record<string, string>,
	fetchImpl?: FetchMock,
): AgentRegistryPort & {
	fetchCalls: Array<{ url: string; init?: RequestInit }>;
} {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const defaultFetch: FetchMock = async (url) => {
		const body = responses[url];
		if (body !== undefined) {
			return new Response(body, { status: 200 });
		}
		return new Response("not found", { status: 404 });
	};
	const f = fetchImpl ?? defaultFetch;
	return {
		fetchCalls: calls,
		async fetchCard() {
			return makeCard("stub", []);
		},
		async delegateTask(agentUrl: string, _text: string) {
			calls.push({ url: agentUrl });
			const resp = await f(agentUrl);
			if (!resp.ok) return `error: ${resp.status}`;
			return resp.text();
		},
	};
}

function makeRecordingMemory(): MemoryStorePort & { logs: string[] } {
	const logs: string[] = [];
	return {
		logs,
		read: () => "",
		append: (s: string) => logs.push(s),
		listSessions: () => [],
		deleteSession: () => false,
		getSession: () => null,
		saveSession: () => {},
	};
}

// ---- Tests ----

describe("Preflight: agent health checks before fan-out", () => {
	test("delegateToMultiple should run preflight health checks when configured", async () => {
		const registry = makeRegistry({
			"http://a1": "response1",
			"http://a2": "response2",
		});
		const recordingMemory = makeRecordingMemory();
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
			memory: recordingMemory,
		});

		// Run with preflight enabled
		await router.delegateToMultiple(["agent1", "agent2"], "test task", {
			preflight: true,
			fetchImpl: async (url) => {
				if (url.includes("/health")) {
					return new Response(JSON.stringify({ status: "ok", agent: url }), {
						status: 200,
					});
				}
				return new Response("ok", { status: 200 });
			},
		});

		// Memory should contain preflight check logs
		const preflightLogs = recordingMemory.logs.filter((l: string) =>
			l.includes("[preflight]"),
		);
		expect(preflightLogs.length).toBeGreaterThan(0);
		preflightLogs.forEach((log) => {
			expect(log).toContain("preflight");
		});
	});

	test("delegateToMultiple should skip agents that fail health check", async () => {
		const registry = makeRegistry({
			"http://a1": "response1",
			"http://a2": "response2",
		});
		const recordingMemory = makeRecordingMemory();
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
			memory: recordingMemory,
		});

		// agent2's health check returns 503
		const results = await router.delegateToMultiple(
			["agent1", "agent2"],
			"test task",
			{
				preflight: true,
				fetchImpl: async (url) => {
					if (url.includes("/health")) {
						if (url.includes("a2")) {
							return new Response(
								JSON.stringify({
									status: "not_ready",
									reason: "shutting_down",
								}),
								{ status: 503 },
							);
						}
						return new Response(JSON.stringify({ status: "ok", agent: url }), {
							status: 200,
						});
					}
					return new Response("ok", { status: 200 });
				},
			},
		);

		// Only agent1 should be in results (agent2 skipped by preflight)
		expect(results.length).toBe(1);
		expect(results[0]?.agentName).toBe("agent1");

		// Memory should record the skip
		const skipLogs = recordingMemory.logs.filter(
			(l: string) => l.includes("agent2") && l.includes("not ready"),
		);
		expect(skipLogs.length).toBeGreaterThan(0);
	});

	test("delegateToMultiple should fail fast when all agents are unhealthy", async () => {
		const registry = makeRegistry({});
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
			["agent1", "agent2"],
			"test task",
			{
				preflight: true,
				fetchImpl: async () => new Response("unreachable", { status: 503 }),
			},
		);

		expect(results.length).toBe(0);
	});

	test("delegateToMultiple should capture and report delegation errors", async () => {
		var throwingRegistry: AgentRegistryPort = {
			async fetchCard() {
				return makeCard("stub", []);
			},
			async delegateTask(_url: string, _text: string) {
				throw new Error("connection refused: ECONNREFUSED");
			},
		};
		const recordingMemory = makeRecordingMemory();
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
			},
			registry: throwingRegistry,
			memory: recordingMemory,
		});

		const results = await router.delegateToMultiple(["agent1"], "test task");

		// Results should be empty (delegation failed)
		expect(results.length).toBe(0);

		// Memory should contain the actual error message
		const errorLogs = recordingMemory.logs.filter((l: string) =>
			l.includes("ECONNREFUSED"),
		);
		expect(errorLogs.length).toBeGreaterThan(0);
	});

	test("delegateToMultiple should not run preflight when option is false", async () => {
		const registry = makeRegistry({
			"http://a1": "response1",
		});
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
			},
			registry,
			memory: noopMemory(),
		});

		let preflightCalled = false;
		await router.delegateToMultiple(["agent1"], "test task", {
			preflight: false,
			fetchImpl: async (url) => {
				if (url.includes("/health")) {
					preflightCalled = true;
				}
				return new Response("ok", { status: 200 });
			},
		});

		expect(preflightCalled).toBe(false);
	});

	test("executeConsensus should pass preflight option through to delegateToMultiple", async () => {
		const registry = makeRegistry({
			"http://a1": "response1",
			"http://a2": "response2",
		});
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

		var preflightCalled = false;
		const result = await router.executeConsensus(
			"test task",
			["agent1", "agent2"],
			{
				preflight: true,
				fetchImpl: async (url) => {
					if (url.includes("/health")) {
						preflightCalled = true;
						return new Response(JSON.stringify({ status: "ok" }), {
							status: 200,
						});
					}
					return new Response("ok", { status: 200 });
				},
			},
		);

		expect(preflightCalled).toBe(true);
		// Without cognitive loop, returns first agent's response
		expect(result).toBeTruthy();
	});
});
