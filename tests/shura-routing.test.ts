import { describe, expect, test } from "bun:test";
import type { AgentCard } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { BudgetPort } from "@ports/budget-port";
import type { MemoryStorePort } from "@ports/memory-store";
import type { TaskStorePort } from "@ports/task-store";
import type { ConsensusEvaluator, ConsensusResult } from "@/types/types";
import { ToolRouter } from "../src/core/tool-router";

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

function noopBudget(): BudgetPort {
	return {
		consume: async () => {},
		remaining: async () => Number.POSITIVE_INFINITY,
		isExhausted: () => false,
		reset: () => {},
		getUsage: () => ({}),
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
				supportedInterfaces: [],
			};
		},
		async delegateTask(agentUrl: string) {
			return responses[agentUrl] ?? "";
		},
	};
}

function makeCognitiveLoop(
	results: Array<{ agentName: string; score: number; reason: string }>,
	winnerAgentName: string,
	winnerCard: AgentCard,
	synthesized: string,
): ConsensusEvaluator {
	return {
		async evaluate(inputs: any[], _taskText: string): Promise<ConsensusResult> {
			return {
				winner: {
					agentName: winnerAgentName,
					card: winnerCard,
					response: "winner response",
				},
				scores: results,
				synthesized,
			};
		},
	};
}

// ---- tests ----

describe("ToolRouter.shouldVerifyTask", () => {
	test("returns false when verification config is not set", () => {
		const tr = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://x",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
		});
		expect(tr.shouldVerifyTask("implement security auth")).toBe(false);
	});

	test("returns false when verification is disabled", () => {
		const tr = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://x",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
			verification: {
				enabled: false,
				keywords: "security,auth",
				agentName: "verification",
				consensusThreshold: 0.7,
			},
		});
		expect(tr.shouldVerifyTask("implement security auth")).toBe(false);
	});

	test("returns true when task text contains a keyword", () => {
		const tr = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://x",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
			verification: {
				enabled: true,
				keywords: "security,auth,financial",
				agentName: "verification",
				consensusThreshold: 0.7,
			},
		});
		expect(tr.shouldVerifyTask("implement security auth")).toBe(true);
		expect(tr.shouldVerifyTask("setup payment processing")).toBe(false);
	});

	test("matches keywords case-insensitively", () => {
		const tr = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://x",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
			verification: {
				enabled: true,
				keywords: "Security,AUTH",
				agentName: "verification",
				consensusThreshold: 0.7,
			},
		});
		expect(tr.shouldVerifyTask("need to SECURE the auth")).toBe(true);
	});

	test("handles trailing/leading spaces in keyword list", () => {
		const tr = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://x",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
			verification: {
				enabled: true,
				keywords: " security , auth ",
				agentName: "verification",
				consensusThreshold: 0.7,
			},
		});
		expect(tr.shouldVerifyTask("implement security auth")).toBe(true);
	});
});

describe("ToolRouter.runVerification", () => {
	test("returns null when verification disabled", async () => {
		const tr = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: "http://x",
					card: makeCard("Oracle", ["review"]),
				},
			},
			memory: noopMemory(),
			registry: makeRegistry({ "http://x": "result" }),
			verification: {
				enabled: false,
				keywords: "security",
				agentName: "verification",
				consensusThreshold: 0.7,
			},
			cognitiveLoop: makeCognitiveLoop([], "", makeCard("Oracle", [""]), ""),
		});
		const r = await tr.runVerification("security task", "result", "oracle");
		expect(r).toBeNull();
	});

	test("returns consensus=true with single peer when below threshold", async () => {
		const card = makeCard("Oracle", ["review"]);
		const tr = new ToolRouter({
			agents: {
				oracle: { name: "oracle", url: "http://oracle", card },
			},
			memory: noopMemory(),
			registry: makeRegistry({}),
			budget: noopBudget(),
			verification: {
				enabled: true,
				keywords: "security",
				agentName: "verification",
				consensusThreshold: 0.7,
			},
			cognitiveLoop: makeCognitiveLoop(
				[{ agentName: "oracle", score: 0.6, reason: "below threshold" }],
				"oracle",
				card,
				"result",
			),
		});
		const r = await tr.runVerification(
			"security task",
			"specialist output",
			"oracle",
		);
		expect(r).not.toBeNull();
		expect(r!.participantCount).toBe(1);
		expect(r!.consensus).toBe(true);
		expect(r!.contested).toBe(false);
	});

	test("returns contested=true when top score below threshold with peers", async () => {
		const oracleCard = makeCard("Oracle", ["review"]);
		const fixerCard = makeCard("Fixer", ["fix"]);
		const tr = new ToolRouter({
			agents: {
				oracle: { name: "oracle", url: "http://oracle", card: oracleCard },
				fixer: { name: "fixer", url: "http://fixer", card: fixerCard },
			},
			memory: noopMemory(),
			registry: makeRegistry({
				"http://fixer": "fixer says needs refactoring for security",
			}),
			budget: noopBudget(),
			verification: {
				enabled: true,
				keywords: "security",
				agentName: "verification",
				consensusThreshold: 0.9,
			},
			cognitiveLoop: makeCognitiveLoop(
				[
					{ agentName: "oracle", score: 0.8, reason: "good" },
					{ agentName: "fixer", score: 0.5, reason: "minor" },
				],
				"oracle",
				oracleCard,
				"oracle response",
			),
		});
		const r = await tr.runVerification(
			"security vulnerability found",
			"oracle says safe",
			"oracle",
		);
		expect(r).not.toBeNull();
		expect(r!.participantCount).toBe(2);
		expect(r!.consensus).toBe(false);
		expect(r!.contested).toBe(true);
		expect(r!.threshold).toBe(0.9);
	});

	test("returns contested=false when top score meets threshold", async () => {
		const oracleCard = makeCard("Oracle", ["review"]);
		const librarianCard = makeCard("Librarian", ["research"]);
		const tr = new ToolRouter({
			agents: {
				oracle: { name: "oracle", url: "http://oracle", card: oracleCard },
				librarian: {
					name: "librarian",
					url: "http://librarian",
					card: librarianCard,
				},
			},
			memory: noopMemory(),
			registry: makeRegistry({
				"http://librarian": "librarian confirms",
			}),
			budget: noopBudget(),
			verification: {
				enabled: true,
				keywords: "security",
				agentName: "verification",
				consensusThreshold: 0.5,
			},
			cognitiveLoop: makeCognitiveLoop(
				[
					{ agentName: "oracle", score: 0.8, reason: "strong" },
					{ agentName: "librarian", score: 0.3, reason: "weak" },
				],
				"oracle",
				oracleCard,
				"oracle verified",
			),
		});
		const r = await tr.runVerification(
			"security audit",
			"oracle output",
			"oracle",
		);
		expect(r).not.toBeNull();
		expect(r!.consensus).toBe(true);
		expect(r!.contested).toBe(false);
		expect(r!.winner).toBe("oracle");
	});
});
