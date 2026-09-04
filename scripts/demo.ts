/**
 * demo.ts — End-to-end test of the full agent stack
 *
 * What it tests:
 *   1. A2A agent card discovery (all 8 agents: Fixer, Librarian, Oracle, Explorer,
 *      Designer, Scientist, Jarvis, Orchestrator)
 *   2. Direct A2A task delegation (Fixer Agent)
 *   3. Orchestrator routing (Fixer / Librarian / Explorer / Oracle / Scientist / Jarvis)
 *   4. Self-improvement: skill file creation
 *   5. Memory persistence (sqlite-backed, memory/jabr.db)
 *   6. ACP bridge handshake (stdio simulation)
 *   7. Orchestrator world-state endpoint
 *
 * Run AFTER starting all agents:
 *   bun run dev &
 *   bun scripts/demo.ts
 *
 * Protocol note: the A2A server is synchronous. It accepts POST to the root
 * `/` with JSON-RPC method `tasks/send` and params
 * `{ message: { parts: [{ kind: "text", text }] } }`, and returns
 * `{ jsonrpc: "2.0", id, result: { text: string } }` inline — no polling.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { jabrUrlForPort, jabrUrlOrUndefined } from "@config/jabr-config";
import { JABR_PORTS } from "@constants/ecosystem";

const FIXER = jabrUrlForPort(JABR_PORTS.fixer);
const LIBRARIAN = jabrUrlForPort(JABR_PORTS.librarian);
const ORACLE = jabrUrlForPort(JABR_PORTS.oracle);
const EXPLORER = jabrUrlForPort(JABR_PORTS.explorer);
const DESIGNER = jabrUrlForPort(JABR_PORTS.designer);
const SCIENTIST = jabrUrlForPort(JABR_PORTS.scientist);
const JARVIS = jabrUrlForPort(JABR_PORTS.jarvis);
const ORCHESTRATOR = jabrUrlOrUndefined() ?? jabrUrlForPort(JABR_PORTS.orchestrator);

let passed = 0;
let failed = 0;

function step(label: string) {
	console.log(`\n${"─".repeat(60)}`);
	console.log(`▶ ${label}`);
	console.log("─".repeat(60));
}

async function check(label: string, fn: () => Promise<void>) {
	try {
		await fn();
		console.log(`  ✅ ${label}`);
		passed++;
	} catch (e) {
		console.log(`  ❌ ${label}: ${(e as Error).message}`);
		failed++;
	}
}

/**
 * POST a task to an A2A agent's root `/` endpoint using the `tasks/send`
 * method. The server is synchronous: it awaits the handler and returns the
 * result inline as `{ result: { text } }`.
 */
async function postA2A(agentUrl: string, text: string): Promise<string> {
	const res = await fetch(`${agentUrl}/`, {
		method: "POST",
		headers: { 
			"Content-Type": "application/json",
			"X-API-Key": "dev-secret-token-for-testing"
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tasks/send",
			params: { message: { parts: [{ kind: "text", text }] } },
		}),
	});
	const data = (await res.json()) as {
		result?: { text: string };
		error?: { code: number; message: string };
	};
	if (data.error) {
		throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
	}
	if (!data.result || typeof data.result.text !== "string") {
		throw new Error("Malformed response: missing result.text");
	}
	return data.result.text;
}

// ── 1. A2A agent card discovery ───────────────────────────────────────────────
step("1 · A2A Agent Card discovery");

async function checkCard(label: string, url: string) {
	await check(label, async () => {
		const res = await fetch(`${url}/.well-known/agent-card.json`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const card = (await res.json()) as { name: string; skills?: unknown[] };
		if (!card.name) throw new Error("No name in card");
		console.log(
			`     → ${card.name}` +
				(card.skills ? ` · ${card.skills.length} skills` : ""),
		);
	});
}

await checkCard("Fixer Agent card reachable", FIXER);
await checkCard("Librarian Agent card reachable", LIBRARIAN);
await checkCard("Oracle Agent card reachable", ORACLE);
await checkCard("Explorer Agent card reachable", EXPLORER);
await checkCard("Designer Agent card reachable", DESIGNER);
await checkCard("Scientist Agent card reachable", SCIENTIST);
await checkCard("Jarvis Agent card reachable", JARVIS);
await checkCard("Orchestrator card reachable", ORCHESTRATOR);

// ── 2. Direct A2A task delegation ─────────────────────────────────────────────
step("2 · Direct A2A task: Fixer Agent → Fibonacci");

await check("Send task and read result synchronously", async () => {
	const response = await postA2A(
		FIXER,
		"Implement a fibonacci function in TypeScript",
	);
	if (!response.includes("fibonacci") && !response.includes("Fibonacci"))
		throw new Error("Response doesn't mention fibonacci");
	console.log(`     → ${response.slice(0, 80)}…`);
});

// ── 3. Orchestrator routing ───────────────────────────────────────────────────
step("3 · Orchestrator routing");

await check("Orchestrator routes code task → Fixer", async () => {
	const response = await postA2A(
		ORCHESTRATOR,
		"Write a binary search function",
	);
	console.log(`     → ${response.slice(0, 80)}…`);
});

await check("Orchestrator routes research task → Librarian", async () => {
	const response = await postA2A(
		ORCHESTRATOR,
		"Research the MCP and A2A protocols",
	);
	if (!response.includes("MCP") && !response.includes("A2A"))
		throw new Error("Response doesn't mention protocols");
	console.log(`     → ${response.slice(0, 80)}…`);
});

await check("Orchestrator routes find task → Explorer", async () => {
	const response = await postA2A(
		ORCHESTRATOR,
		"find all TODO comments in the codebase",
	);
	console.log(`     → ${response.slice(0, 80)}…`);
});

await check("Orchestrator routes review task → Oracle", async () => {
	const response = await postA2A(
		ORCHESTRATOR,
		"review this function for edge cases: async function foo() { return 1; }",
	);
	console.log(`     → ${response.slice(0, 80)}…`);
});

await check("Orchestrator routes data task → Scientist", async () => {
	const response = await postA2A(ORCHESTRATOR, "analyze this data with python");
	if (!/Scientist/i.test(response))
		throw new Error("Response doesn't mention Scientist");
	console.log(`     → ${response.slice(0, 80)}…`);
});

await check("Orchestrator routes scan task → Jarvis", async () => {
	const response = await postA2A(
		ORCHESTRATOR,
		"scan the codebase for improvements",
	);
	if (!/Steward scan complete/i.test(response))
		throw new Error("Response doesn't mention Steward scan");
	console.log(`     → ${response.slice(0, 80)}…`);
});

// ── 4. Self-improvement: skill persistence ────────────────────────────────────
step("4 · Self-improvement — skill files created");

await check("Librarian creates skill files after tasks", async () => {
	// Trigger a research task to generate skills
	await postA2A(LIBRARIAN, "Research self-improvement in agent systems");

	// Check skill store
	const skillDir = join(process.cwd(), "skills");
	if (!existsSync(skillDir)) throw new Error("skills/ directory not created");
	const files = readdirSync(skillDir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) throw new Error("No skill files created");
	console.log(`     → ${files.length} skill(s): ${files.join(", ")}`);

	// Validate skill structure
	const skill = JSON.parse(readFileSync(join(skillDir, files[0]!), "utf-8"));
	if (!skill.name || !skill.steps || !Array.isArray(skill.steps))
		throw new Error("Invalid skill structure");
	console.log(`     → Sample: "${skill.name}" (${skill.steps.length} steps)`);
});

// ── 5. Memory persistence ─────────────────────────────────────────────────────
step("5 · Memory persistence (sqlite-backed)");

await check("Orchestrator memory persisted to sqlite", async () => {
	const dbPath = join(process.cwd(), "memory", "jabr.db");
	if (!existsSync(dbPath)) throw new Error("memory/jabr.db not found");
	const db = new Database(dbPath, { readonly: true });
	try {
		const tasks = db.query("SELECT COUNT(*) AS n FROM tasks").get() as {
			n: number;
		};
		const mem = db.query("SELECT COUNT(*) AS n FROM memory_log").get() as {
			n: number;
		};
		console.log(`     → ${tasks.n} task(s) · ${mem.n} memory log entr(ies)`);
		if (tasks.n < 1) throw new Error("No tasks recorded in sqlite memory");
	} finally {
		db.close();
	}
});

// ── 6. ACP bridge handshake (simulated) ──────────────────────────────────────
step("6 · ACP bridge — simulated initialize + session/list");

await check("ACP initialize returns capabilities", async () => {
	// Spawn the ACP bridge as a subprocess and test it via stdin/stdout.
	const proc = Bun.spawn(["bun", "agents/run/acp-bridge.ts"], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	// The bridge logs its ready notification on stderr; JSON-RPC responses
	// arrive on stdout.
	const stderrReader = proc.stderr.getReader();
	const stdoutReader = proc.stdout.getReader();
	const errBuf = { current: "" };
	const outBuf = { current: "" };

	const readLine = async (
		reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
		buf: { current: string },
	): Promise<string> => {
		while (true) {
			const nl = buf.current.indexOf("\n");
			if (nl >= 0) {
				const line = buf.current.slice(0, nl).trim();
				buf.current = buf.current.slice(nl + 1);
				return line;
			}
			const { value, done } = await reader.read();
			if (done) throw new Error("ACP bridge stream closed");
			if (!value) throw new Error("ACP bridge read returned no data");
			buf.current += new TextDecoder().decode(value);
		}
	};

	// Read ready notification (stderr).
	const ready = await Promise.race([
		readLine(stderrReader, errBuf),
		Bun.sleep(2000).then(() => "timeout"),
	]);
	if (ready === "timeout")
		throw new Error("ACP bridge did not send ready notification");

	// Send initialize
	const initReq =
		JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {},
		}) + "\n";
	proc.stdin.write(initReq);
	const initResp = await Promise.race([
		readLine(stdoutReader, outBuf),
		Bun.sleep(2000).then(() => "timeout"),
	]);
	if (initResp === "timeout") throw new Error("ACP bridge initialize timeout");

	const parsed = JSON.parse(initResp);
	if (!parsed.result?.capabilities)
		throw new Error("No capabilities in response");
	console.log(
		`     → capabilities: ${JSON.stringify(parsed.result.capabilities)}`,
	);

	// Send session/list (the bridge has no sessions/create — list is the
	// session API).
	proc.stdin.write(
		JSON.stringify({
			jsonrpc: "2.0",
			id: 2,
			method: "session/list",
			params: {},
		}) + "\n",
	);
	const sessResp = await Promise.race([
		readLine(stdoutReader, outBuf),
		Bun.sleep(2000).then(() => "timeout"),
	]);
	if (sessResp === "timeout") throw new Error("session/list timeout");
	const sessData = JSON.parse(sessResp);
	if (!Array.isArray(sessData.result?.sessions))
		throw new Error("No sessions array in response");
	console.log(`     → ${sessData.result.sessions.length} session(s)`);

	proc.kill();
});

// ── 7. Orchestrator world-state endpoint ──────────────────────────────────────
step("7 · Orchestrator world-state endpoint");

await check("world-state returns current state", async () => {
	const res = await fetch(`${ORCHESTRATOR}/.well-known/world-state`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const state = (await res.json()) as { agents?: unknown[]; tasks?: unknown[] };
	const agentCount = Array.isArray(state.agents) ? state.agents.length : 0;
	const taskCount = Array.isArray(state.tasks) ? state.tasks.length : 0;
	console.log(`     → ${agentCount} agent(s) · ${taskCount} task(s)`);
	if (agentCount < 5)
		throw new Error(`Expected at least 5 agents, got ${agentCount}`);
});

await check("Handover sentinel processed without crash", async () => {
	// The orchestrator should process the %%HANDOVER%% sentinel and return a
	// result inline (synchronous). We only verify it didn't error out.
	const response = await postA2A(
		ORCHESTRATOR,
		"%%HANDOVER%% Trigger a handover",
	);
	console.log(`     → ${response.slice(0, 80)}…`);
});

// ── 8. Pollinations image generation ──────────────────────────────────────────
step("8 · Pollinations image generation");

await check("PollinationsImageAdapter generates a real image", async () => {
	const { PollinationsImageAdapter } = await import(
		"@adapters/pollinations-image"
	);
	const apiKey = process.env.POLLINATIONS_API_KEY;
	if (!apiKey) {
		console.log("     ⚠ POLLINATIONS_API_KEY not set — skipping live test");
		return;
	}
	const adapter = new PollinationsImageAdapter({ apiKey });
	const url = await adapter.generate("a cute cat in space");
	if (!url.startsWith("https://gen.pollinations.ai/image/"))
		throw new Error(`Unexpected URL format: ${url}`);
	console.log(`     → ${url.slice(0, 70)}…`);

	// Verify the generated image is actually reachable (HTTP 200 + image/jpeg).
	const res = await fetch(url, { method: "HEAD" });
	if (!res.ok)
		throw new Error(`Generated image not reachable: HTTP ${res.status}`);
	const ct = res.headers.get("content-type") ?? "";
	if (!ct.startsWith("image/"))
		throw new Error(`Expected image content-type, got: ${ct}`);
	console.log(`     → HTTP ${res.status} · content-type: ${ct}`);
});

// ── 9. Pollinations wallet → x402 bridge ──────────────────────────────────────
step("9 · Pollen wallet → x402 settlement bridge");

await check("PollinationsWallet.getBalance reads Pollen balance", async () => {
	const { PollinationsWallet } = await import(
		"@adapters/x402/pollinations-wallet"
	);
	const apiKey = process.env.POLLINATIONS_API_KEY;
	if (!apiKey) {
		console.log("     ⚠ POLLINATIONS_API_KEY not set — skipping live test");
		return;
	}
	const wallet = new PollinationsWallet({ apiKey });
	const balance = await wallet.getBalance();
	if (typeof balance.balance !== "number" || balance.balance < 0)
		throw new Error(`Invalid balance: ${JSON.stringify(balance)}`);
	console.log(`     → balance: ${balance.balance} Pollen`);
});

await check(
	"PollinationsWallet.declarePricing builds AgentCard pricing",
	async () => {
		const { PollinationsWallet } = await import(
			"@adapters/x402/pollinations-wallet"
		);
		const pricing = PollinationsWallet.declarePricing(0.5, 0.01);
		if (pricing.costPerTask !== 0.5)
			throw new Error(`Wrong costPerTask: ${pricing.costPerTask}`);
		if (pricing.costPerToken !== 0.01)
			throw new Error(`Wrong costPerToken: ${pricing.costPerToken}`);
		if (pricing.currency !== "pollen")
			throw new Error(`Wrong currency: ${pricing.currency}`);
		console.log(`     → ${JSON.stringify(pricing)}`);
	},
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${passed} passed · ${failed} failed`);
console.log("═".repeat(60));

if (failed > 0) {
	console.log("\n⚠ Some tests failed. Make sure all agents are running:");
	console.log("  bun run dev &");
	console.log("  bun run demo");
}

process.exit(failed > 0 ? 1 : 0);
