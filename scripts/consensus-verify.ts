import { openJabrDb } from "../src/adapters/sqlite-db.ts";
import { SqliteMemoryStore } from "../src/adapters/sqlite-memory-store.ts";
import { SqliteTaskStore } from "../src/adapters/sqlite-task-store.ts";
import { jabrUrlForPort } from "../src/config/jabr-config.ts";
import {
	PROTOCOL_BINDING_JSONRPC,
	SUPPORTED_INTERFACES_VERSION,
} from "../src/constants/a2a-v1.ts";
import { JABR_PORTS } from "../src/constants/ecosystem.ts";
import { ToolRouter } from "../src/core/tool-router.ts";
import type { AgentRegistryPort } from "../src/ports/agent-registry.ts";
import type { AgentCard, AgentConfig } from "../src/types/types.ts";

// ── Offline agent config seeded with the same agent cards the live system uses ──
const LIVE_CARDS: Record<string, { url: string; card: AgentCard }> = {
	oracle: {
		url: jabrUrlForPort(JABR_PORTS.oracle),
		card: {
			name: "RUSHD",
			description: "Code reviewer",
			url: jabrUrlForPort(JABR_PORTS.oracle),
			version: "1.0.0",
			capabilities: {},
			supportedInterfaces: [
				{
					url: jabrUrlForPort(JABR_PORTS.oracle),
					protocolBinding: PROTOCOL_BINDING_JSONRPC,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
			],
			skills: [
				{
					name: "Review code",
					description: "",
					tags: ["review", "code-review", "audit"],
				},
				{
					name: "Simplify code",
					description: "",
					tags: ["simplify", "refactor", "readability"],
				},
				{
					name: "Architecture advice",
					description: "",
					tags: ["architecture", "design", "trade-off"],
				},
			],
			pricing: { costPerTask: 15 },
		},
	},
	librarian: {
		url: jabrUrlForPort(JABR_PORTS.librarian),
		card: {
			name: "FIHRIYA",
			description: "Researcher",
			url: jabrUrlForPort(JABR_PORTS.librarian),
			version: "1.0.0",
			capabilities: {},
			supportedInterfaces: [
				{
					url: jabrUrlForPort(JABR_PORTS.librarian),
					protocolBinding: PROTOCOL_BINDING_JSONRPC,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
			],
			skills: [
				{
					name: "Lookup docs",
					description: "",
					tags: ["research", "doc", "api", "library", "how-to"],
				},
				{
					name: "Summarize text",
					description: "",
					tags: ["summarize", "summary"],
				},
			],
			pricing: { costPerTask: 8 },
		},
	},
	explorer: {
		url: jabrUrlForPort(JABR_PORTS.explorer),
		card: {
			name: "BATTUTA",
			description: "File finder",
			url: jabrUrlForPort(JABR_PORTS.explorer),
			version: "1.0.0",
			capabilities: {},
			supportedInterfaces: [
				{
					url: jabrUrlForPort(JABR_PORTS.explorer),
					protocolBinding: PROTOCOL_BINDING_JSONRPC,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
			],
			skills: [
				{
					name: "Scan files",
					description: "",
					tags: ["find", "files", "map", "structure", "grep", "search"],
				},
			],
			pricing: { costPerTask: 5 },
		},
	},
	designer: {
		url: jabrUrlForPort(JABR_PORTS.designer),
		card: {
			name: "FIRNAS",
			description: "UI designer",
			url: jabrUrlForPort(JABR_PORTS.designer),
			version: "1.0.0",
			capabilities: {},
			supportedInterfaces: [
				{
					url: jabrUrlForPort(JABR_PORTS.designer),
					protocolBinding: PROTOCOL_BINDING_JSONRPC,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
			],
			skills: [
				{
					name: "UI design",
					description: "",
					tags: [
						"layout",
						"responsive",
						"ui",
						"component",
						"button",
						"ux",
						"color",
						"palette",
					],
				},
			],
			pricing: { costPerTask: 10 },
		},
	},
	fixer: {
		url: jabrUrlForPort(JABR_PORTS.fixer),
		card: {
			name: "TARIQ",
			description: "Bug fixer",
			url: jabrUrlForPort(JABR_PORTS.fixer),
			version: "1.0.0",
			capabilities: {},
			supportedInterfaces: [
				{
					url: jabrUrlForPort(JABR_PORTS.fixer),
					protocolBinding: PROTOCOL_BINDING_JSONRPC,
					protocolVersion: SUPPORTED_INTERFACES_VERSION,
				},
			],
			skills: [
				{
					name: "Implement",
					description: "",
					tags: [
						"fix",
						"bug",
						"error",
						"patch",
						"repair",
						"debug",
						"code",
						"implement",
						"function",
						"algorithm",
						"typescript",
						"write",
						"python",
						"review",
					],
				},
			],
			pricing: { costPerTask: 12 },
		},
	},
};

const agents: Record<string, AgentConfig> = Object.fromEntries(
	Object.entries(LIVE_CARDS).map(([name, v]) => [
		name,
		{ name, url: v.url, card: v.card },
	]),
);

// Stub registry that returns a canned response per agent (no real HTTP).
const offlineRegistry: AgentRegistryPort = {
	async fetchCard(url: string): Promise<AgentCard | null> {
		for (const entry of Object.values(LIVE_CARDS)) {
			if (entry.url === url) return entry.card;
		}
		return null;
	},
	async delegateTask(
		_url: string,
		text: string,
		agentName?: string,
	): Promise<string> {
		return `[${agentName ?? "agent"}] handled: ${text}`;
	},
};

// TaskStore + MemoryStore for the router
const db = openJabrDb(":memory:");
const taskStore = new SqliteTaskStore(db);
const memoryStore = new SqliteMemoryStore(db);

const router = new ToolRouter({
	agents,
	registry: offlineRegistry,
	memory: memoryStore,
});

// ── Helper ──
async function runTask(text: string) {
	const taskId = crypto.randomUUID();
	await taskStore.create(taskId);
	const routed = await router.routeTask(text);
	const task = taskStore.get(taskId);
	const msgs = task?.messages ?? [];
	const agentMsgs = msgs.filter((m) => m.role === "agent");
	const resultText = agentMsgs
		.map((m) =>
			m.parts
				.filter((p) => p.kind === "text")
				.map((p) => p.text)
				.join(""),
		)
		.join("\n");
	return { taskId, routed, resultText, state: task?.state };
}

// ── Scenario A: multi-agent routing → consensus path ──
// "review and research this code" — oracle (review) and librarian (research) both score > 0
{
	const text = "review and research this code";
	const routed = await router.routeTask(text);
	console.log(
		`[A] routeTask("${text}"):`,
		routed ? `${routed.agentName}(${routed.label})` : "null",
	);

	const consensus = await router.executeConsensus(text, [
		"oracle",
		"librarian",
	]);
	console.log(`[A] executeConsensus length:`, consensus.length);

	const passed = routed !== null && consensus.length > 0;

	console.log(`[A] PASS: ${passed}`);
	if (!passed) {
		console.error(
			`[A] FAIL — expected a routed agent + non-empty consensus; got`,
			{ routed, consensusLen: consensus.length },
		);
		process.exit(1);
	}
}

// ── Scenario B: 1 matched agent → single-agent routing, no consensus ──
// "find all TODO comments" — only explorer matches
{
	const text = "find all TODO comments";
	const routed = await router.routeTask(text);
	console.log(
		`[B] routeTask("${text}"):`,
		routed ? `${routed.agentName}(${routed.label})` : "null",
	);

	const passed = routed?.agentName === "explorer";

	console.log(`[B] PASS: ${passed}`);
	if (!passed) {
		console.error(`[B] FAIL — expected explorer (single-agent); got`, {
			routed,
		});
		process.exit(1);
	}
}

// ── Scenario C: 3+ matched agents → consensus ──
// "review, research, and find bugs" — oracle(review), librarian(research), fixer(bug) all match
{
	const text = "review, research, and find bugs";
	const routed = await router.routeTask(text);
	console.log(
		`[C] routeTask("${text}"):`,
		routed ? `${routed.agentName}(${routed.label})` : "null",
	);

	const consensus = await router.executeConsensus(text, [
		"oracle",
		"librarian",
		"fixer",
	]);
	console.log(`[C] executeConsensus length:`, consensus.length);

	const passed = routed !== null && consensus.length > 0;

	console.log(`[C] PASS: ${passed}`);
	if (!passed) {
		console.error(
			`[C] FAIL — expected a routed agent + non-empty consensus; got`,
			{ routed, consensusLen: consensus.length },
		);
		process.exit(1);
	}
}

console.log("\n✓ All consensus / single-agent routing scenarios pass.");
