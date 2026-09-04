import { DynamicRegistry } from "@adapters/dynamic-registry";
import type { AgentCard, AgentSkill } from "@agents/types";
import { JABR_PORTS } from "./src/constants/ecosystem.ts";
import type { AgentRegistryPort } from "@ports/agent-registry";
import { jabrUrlForPort } from "./src/config/jabr-config.ts";

// Offline registry: returns cards keyed by seed URL. Same shape DynamicRegistry
// would see from A2AClient.fetchCard against a running agent — keeps routing
// test on the real matchAgent algorithm without needing live agents.
const SKILLS: Record<string, AgentSkill[]> = {
	oracle: [
		{
			name: "Code Review",
			description: "",
			tags: ["review", "simplify", "refactor", "architecture", "audit"],
		},
	],
	librarian: [
		{
			name: "Research",
			description: "",
			tags: ["research", "doc", "api", "library", "how-to", "summarize"],
		},
	],
	explorer: [
		{
			name: "Scan",
			description: "",
			tags: ["find", "files", "map", "structure", "grep", "search"],
		},
	],
	designer: [
		{
			name: "UI",
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
	fixer: [
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
};
const seed = {
	oracle: jabrUrlForPort(JABR_PORTS.oracle),
	librarian: jabrUrlForPort(JABR_PORTS.librarian),
	explorer: jabrUrlForPort(JABR_PORTS.explorer),
	designer: jabrUrlForPort(JABR_PORTS.designer),
	fixer: jabrUrlForPort(JABR_PORTS.fixer),
};
const urlToName: Record<string, string> = {};
for (const [k, v] of Object.entries(seed)) urlToName[v] = k;

const offlineRegistry: AgentRegistryPort = {
	async fetchCard(url: string): Promise<AgentCard | null> {
		const name = urlToName[url];
		if (!name) return null;
		return {
			name: `${name[0]?.toUpperCase()}${name.slice(1)} Agent`,
			description: "",
			url,
			version: "1.0.0",
			capabilities: {},
			skills: SKILLS[name] ?? [],
		};
	},
	async delegateTask() {
		return "";
	},
};

const dyn = new DynamicRegistry(offlineRegistry, seed);
await dyn.initialize();

for (const t of [
	"find all TODO comments",
	"review this function for edge cases",
	"review this module for architecture concerns",
	"review the edge cases in this design",
]) {
	const m = await dyn.matchAgent(t);
	console.log(JSON.stringify(t), "->", m?.name, m?.label);
}

// Self-check: matchAgent must hit the real DynamicRegistry path.
const explorerHit = await dyn.matchAgent("find all TODO comments");
if (explorerHit?.name !== "explorer") {
	console.error(`FAIL: expected explorer, got ${explorerHit?.name}`);
	process.exit(1);
}
console.log("ok");
