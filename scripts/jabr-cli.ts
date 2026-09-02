#!/usr/bin/env -S bun run

/**
 * jabr-cli — agent management CLI for the Jabr multi-agent system.
 *
 * Subcommands:
 *   start   [agent|all]   Start one agent or all (default: all).
 *   stop    [agent|all]   Stop one agent or all.
 *   restart [agent|all]   Restart one agent or all.
 *   status            Show live status of every agent (health + process).
 *   logs     [agent|all]  Tail log for one agent or all.
 *   send    <agent> <text>   Send a task to an agent via A2A POST.
 *   config            Show current agent config (ports, URLs, env).
 *
 * Usage:
 *   bun scripts/jabr-cli.ts start
 *   bun scripts/jabr-cli.ts stop oracle
 *   bun scripts/jabr-cli.ts status
 *   bun scripts/jabr-cli.ts logs fixer
 *   bun scripts/jabr-cli.ts send oracle "review this code"
 *   bun scripts/jabr-cli.ts config
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { jabrUrlForPort } from "../src/config/jabr-config.ts";

// ── Agent topology (mirrors agents/run/orchestrator.ts seedUrls) ──────────

const AGENTS: Array<{
	name: string;
	script: string; // run script filename (without .ts)
	port: number;
	sourceCmd: string; // bun command to run from source (fallback when no binary)
	env?: Record<string, string>;
}> = [
	{
		name: "orchestrator",
		script: "orchestrator",
		port: 4000,
		sourceCmd: "bun agents/run/orchestrator.ts",
		// Orchestrator owns the realtime WebSocket server on 4008
	},
	{
		name: "oracle",
		script: "oracle",
		port: 4001,
		sourceCmd: "bun agents/run/oracle.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "librarian",
		script: "librarian",
		port: 4002,
		sourceCmd: "bun agents/run/librarian.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "explorer",
		script: "explorer",
		port: 4003,
		sourceCmd: "bun agents/run/explorer.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "designer",
		script: "designer",
		port: 4004,
		sourceCmd: "bun agents/run/designer.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "fixer",
		script: "fixer",
		port: 4005,
		sourceCmd: "bun agents/run/fixer.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "scientist",
		script: "scientist",
		port: 4006,
		sourceCmd: "bun agents/run/scientist.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "verification",
		script: "verification",
		port: 4009,
		sourceCmd: "bun agents/run/verification.ts",
		env: { JABR_REALTIME_PORT: "4008", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "jarvis",
		script: "jarvis",
		port: 1337,
		sourceCmd: "bun agents/run/jarvis.ts",
		env: { JABR_REALTIME_PORT: "4008", JABR_URL: "http://localhost:4000", A2A_AUTH_TOKEN: "dev-secret-token-for-testing" },
	},
	{
		name: "mcp",
		script: "mcp",
		port: 0,
		sourceCmd: "bun mcp-servers/tools.ts",
		env: { JABR_REALTIME_PORT: "4008" },
	},
	{
		name: "acp-bridge",
		script: "acp-bridge",
		port: 0,
		sourceCmd: "bun agents/run/acp-bridge.ts",
		env: { JABR_REALTIME_PORT: "4008", JABR_URL: "http://localhost:4000", JABR_MEMORY_DIR: "/home/m7r/Work/agent-lab/memory" },
	},
];

/**
 * Resolve the command used to launch an agent: prefer the standalone binary
 * built into `dist/bin/<name>` (via `bun run build`) when present, otherwise
 * fall back to running from source.
 */
function runCommand(agent: (typeof AGENTS)[number]): string {
	const bin = join(ROOT, "dist", "bin", agent.name);
	return existsSync(bin) ? bin : agent.sourceCmd;
}

const ROOT = process.cwd();
const LOG_DIR = "/tmp/jabr-logs";

// ── Helpers ────────────────────────────────────────────────────────────────

function log(...args: unknown[]) {
	console.log(...args);
}
function warn(...args: unknown[]) {
	console.warn(...args);
}
function error(...args: unknown[]) {
	console.error(...args);
}

function agentByName(name: string): (typeof AGENTS)[number] | undefined {
	return AGENTS.find((a) => a.name === name);
}

function ensureLogDir() {
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}
}

function pidFile(agent: string) {
	return join(LOG_DIR, `jabr-${agent}.pid`);
}

function logFile(agent: string) {
	return join(LOG_DIR, `jabr-${agent}.log`);
}

/** Read PIDs from pid file. Returns empty array if file doesn't exist. */
function readPids(agent: string): number[] {
	const p = pidFile(agent);
	if (!existsSync(p)) return [];
	try {
		const content = readFileSync(p, "utf-8").trim();
		return content
			.split("\n")
			.map((s) => parseInt(s.trim(), 10))
			.filter((n) => !isNaN(n));
	} catch {
		return [];
	}
}

/** Write PIDs to pid file. */
function writePids(agent: string, pids: number[]) {
	ensureLogDir();
	writeFileSync(pidFile(agent), pids.join("\n"), "utf-8");
}

/** Delete pid file. */
function deletePidFile(agent: string) {
	const p = pidFile(agent);
	if (existsSync(p)) {
		try {
			unlinkSync(p);
		} catch {
			/* ignore */
		}
	}
}

/** Find PID(s) for an agent by scanning /proc (fallback when pid file is stale). */
function findPidsByProc(agent: (typeof AGENTS)[number]): number[] {
	const pids: number[] = [];
	const sourceNeedle = `agents/run/${agent.script}.ts`;
	const binNeedle = `dist/bin/${agent.name}`;
	try {
		const proc = "/proc";
		const entries = readdirSync(proc);
		for (const entry of entries) {
			if (!/^\d+$/.test(entry)) continue;
			const cmdlinePath = join(proc, entry, "cmdline");
			try {
				const cmdline = readFileSync(cmdlinePath, "utf-8")
					.replace(/\0/g, " ")
					.trim();
				if (cmdline.includes(sourceNeedle) || cmdline.includes(binNeedle)) {
					pids.push(parseInt(entry, 10));
				}
			} catch {
				// Permission or missing — skip.
			}
		}
	} catch {
		// /proc not available
	}
	return pids;
}

/** Kill processes for agents with a specific port (for port-based agents). */
async function killAgentByPort(port: number): Promise<void> {
	if (port === 0) return;
	spawnSync(
		"bash",
		["-c", `lsof -ti :${port} 2>/dev/null | xargs kill 2>/dev/null || true`],
		{ encoding: "utf-8" },
	);
}

/** Check if an HTTP endpoint responds (for port-based agents). */
async function healthCheck(
	name: string,
	port: number,
): Promise<{ up: boolean; card?: object }> {
	if (port === 0) return { up: false };
	try {
		const cardUrl = `${jabrUrlForPort(port)}/.well-known/agent-card.json`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2000);
		const res = await fetch(cardUrl, { signal: controller.signal });
		clearTimeout(timer);
		if (res.ok) {
			const card = (await res.json()) as object;
			return { up: true, card };
		}
		return { up: false };
	} catch {
		return { up: false };
	}
}

/** Wait for an agent to become healthy (poll up to 30s). */
async function waitForHealth(name: string, port: number): Promise<boolean> {
	if (port === 0) return true;
	for (let i = 0; i < 30; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		if ((await healthCheck(name, port)).up) return true;
	}
	return false;
}

// ── Subcommands ───────────────────────────────────────────────────────────

async function cmdStart(args: string[]) {
	const target = args[0]?.trim().toLowerCase();
	ensureLogDir();

	if (target && target !== "all") {
		const agent = agentByName(target);
		if (!agent) {
			error(`Unknown agent: ${target}`);
			error(`Known agents: ${AGENTS.map((a) => a.name).join(", ")}`);
			process.exit(1);
		}
		await startSingle(agent);
	} else {
		log(`Starting all ${AGENTS.length} agents...`);
		await Promise.all(AGENTS.map((a) => startSingle(a)));
		log("All agents started.");
	}
}

async function startSingle(agent: (typeof AGENTS)[number]) {
	const existingPids = readPids(agent.name);
	const procPids = findPidsByProc(agent);
	const allPids = [...existingPids, ...procPids];

	if (allPids.length > 0) {
		log(`  ${agent.name}: already running (PID ${allPids.join(", ")})`);
		return;
	}

	const logPath = logFile(agent.name);
	const envPrefix = agent.env
		? Object.entries(agent.env)
				.map(([k, v]) => `${k}="${v}"`)
				.join(" ") + " "
		: "";

	log(`  Starting ${agent.name} on port ${agent.port || "stdio"}...`);

	const bashCmd = `${envPrefix}${runCommand(agent)} 2>&1 | tee ${logPath}`;
	const proc = spawn("bash", ["-c", bashCmd], {
		cwd: ROOT,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...agent.env },
	});
	proc.unref();

	if (agent.port > 0) {
		const ready = await waitForHealth(agent.name, agent.port);
		if (ready) {
			const health = await healthCheck(agent.name, agent.port);
			const cardName = (health.card as any)?.name ?? "?";
			log(`  ✓ ${agent.name} — ${jabrUrlForPort(agent.port)} (${cardName})`);
		} else {
			warn(
				`  ? ${agent.name} — launched but not yet serving on port ${agent.port} (check ${logPath})`,
			);
		}
	} else {
		// For stdio agents, confirm process spawned.
		setTimeout(() => {
			const procPids = findPidsByProc(agent);
			if (procPids.length > 0) {
				writePids(agent.name, procPids);
				log(`  ✓ ${agent.name} — launched (stdio, PID ${procPids[0]})`);
			} else {
				warn(
					`  ? ${agent.name} — process may not have started (check ${logPath})`,
				);
			}
		}, 1500);
	}
}

async function cmdStop(args: string[]) {
	const target = args[0]?.trim().toLowerCase();

	if (target && target !== "all") {
		const agent = agentByName(target);
		if (!agent) {
			error(`Unknown agent: ${target}`);
			process.exit(1);
		}
		await stopSingle(agent);
	} else {
		log("Stopping all agents...");
		for (const agent of AGENTS) {
			await stopSingle(agent);
		}
		log("All agents stopped.");
	}
}

async function stopSingle(agent: (typeof AGENTS)[number]) {
	const pids = readPids(agent.name);
	const procPids = findPidsByProc(agent);
	const allPids = [...pids, ...procPids];

	if (allPids.length === 0 && agent.port === 0) {
		log(`  ${agent.name}: not running`);
		return;
	}

	if (agent.port > 0) {
		await killAgentByPort(agent.port);
	}

	// SIGTERM first.
	for (const pid of allPids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// already dead
		}
	}

	// Wait, then SIGKILL stragglers.
	await new Promise((r) => setTimeout(r, 1000));
	const remaining = findPidsByProc(agent);
	for (const pid of remaining) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// already dead
		}
	}

	deletePidFile(agent.name);

	if (agent.port > 0) {
		const stillUp = await healthCheck(agent.name, agent.port);
		if (stillUp.up) {
			warn(
				`  ✗ ${agent.name}: process killed but port ${agent.port} still serving`,
			);
		} else {
			log(`  ✓ ${agent.name}: stopped`);
		}
	} else {
		const stillRunning = findPidsByProc(agent).length > 0;
		if (!stillRunning) {
			log(`  ✓ ${agent.name}: stopped`);
		} else {
			warn(
				`  ✗ ${agent.name}: still running (PID ${findPidsByProc(agent).join(", ")})`,
			);
		}
	}
}

async function cmdRestart(args: string[]) {
	const target = args[0]?.trim().toLowerCase();
	if (target && target !== "all") {
		const agent = agentByName(target);
		if (!agent) {
			error(`Unknown agent: ${target}`);
			process.exit(1);
		}
		log(`Restarting ${agent.name}...`);
		await stopSingle(agent);
		await new Promise((r) => setTimeout(r, 1000));
		await startSingle(agent);
	} else {
		log("Restarting all agents...");
		for (const agent of AGENTS) {
			await stopSingle(agent);
		}
		await new Promise((r) => setTimeout(r, 1500));
		for (const agent of AGENTS) {
			await startSingle(agent);
		}
	}
	log("Done.");
}

async function cmdStatus() {
	const rows: Array<[string, string, string, string, string]> = [];

	for (const agent of AGENTS) {
		const pids = readPids(agent.name);
		const procPids = findPidsByProc(agent);
		const allPids = [...pids, ...procPids];
		const running = allPids.length > 0;
		const health =
			agent.port > 0 ? await healthCheck(agent.name, agent.port) : null;

		const procStr = running ? `PID ${allPids.join(",")}` : "—";
		const httpStr = health?.up
			? `up (=${agent.port})`
			: agent.port > 0
				? `down`
				: "n/a";
		const cardStr = health?.card
			? ((health.card as any)?.name ?? "?")
			: agent.port > 0
				? "—"
				: "stdio";

		rows.push([
			agent.name.padEnd(14),
			(agent.port || "stdio").toString().padEnd(6),
			procStr.padEnd(16),
			httpStr.padEnd(12),
			cardStr,
		]);
	}

	const colWidths = rows[0]!.map((_, i) =>
		Math.max(...rows.map((r) => r[i]!.length)),
	);
	for (const row of rows) {
		log(row.map((cell, i) => cell.padEnd(colWidths[i] ?? 0)).join("  "));
	}

	const httpAgents = AGENTS.filter((a) => a.port > 0).length;
	const stdioAgents = AGENTS.filter((a) => a.port === 0).length;
	const runningCount = rows.filter((r) => !r[2]!.includes("—")).length;
	log("");
	log(
		`Summary: ${httpAgents} HTTP + ${stdioAgents} stdio agents | ${runningCount}/${AGENTS.length} running`,
	);
}

async function cmdLogs(args: string[]) {
	const target = args[0]?.trim().toLowerCase();
	ensureLogDir();

	if (target && target !== "all") {
		const agent = agentByName(target);
		if (!agent) {
			error(`Unknown agent: ${target}`);
			process.exit(1);
		}
		const logPath = logFile(agent.name);
		if (!existsSync(logPath)) {
			log(`  (no log file yet — agent may not have been started via this CLI)`);
			log(
				`  Start the agent first: bun scripts/jabr-cli.ts start ${agent.name}`,
			);
			return;
		}
		log(`Tailing ${logPath} (Ctrl-C to stop)...`);
		const tail = spawn("tail", ["-f", logPath], {
			cwd: ROOT,
			stdio: ["ignore", "inherit", "inherit"],
		});
		tail.on("error", () => {
			log(`  Failed to tail — file may not exist.`);
		});
	} else {
		log("Logs for all agents (last 20 lines each):");
		for (const agent of AGENTS) {
			const logPath = logFile(agent.name);
			if (!existsSync(logPath)) {
				log(`  ${agent.name}: (no log)`);
				continue;
			}
			try {
				const content = readFileSync(logPath, "utf-8");
				const lines = content
					.split("\n")
					.filter((l) => l.trim())
					.slice(-20);
				log(`--- ${agent.name} (${logPath}) ---`);
				for (const line of lines) log(`  ${line}`);
				log("");
			} catch {
				log(`  ${agent.name}: (error reading log)`);
			}
		}
	}
}

async function cmdSend(args: string[]) {
	if (args.length < 2) {
		error("Usage: jabr-cli send <agent> <text...>");
		error("Sends a task to an agent via A2A POST /.");
		process.exit(1);
	}

	const target = args[0]!.trim();
	const text = args.slice(1).join(" ");
	const agent = agentByName(target);

	if (!agent) {
		error(`Unknown agent: ${target}`);
		error(`Known agents: ${AGENTS.map((a) => a.name).join(", ")}`);
		process.exit(1);
	}

	if (agent.port === 0) {
		error(
			`${agent.name} is stdio-based — cannot send via HTTP. Use the orchestrator instead.`,
		);
		process.exit(1);
	}

	log(`Sending to ${agent.name} (port ${agent.port})...`);
	log(`  Task: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

	try {
		const res = await fetch(`${jabrUrlForPort(agent.port)}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tasks/send",
				params: {
					message: {
						parts: [{ kind: "text", text }],
					},
				},
			}),
			signal: AbortSignal.timeout(30000),
		});

		const body = (await res.json()) as {
			result?: { text?: string } | unknown;
			error?: { code?: number | string; message?: string };
		};
		if (res.ok && body.result) {
			const resultText =
				(body.result as any).text ?? JSON.stringify(body.result);
			log(`\nResponse from ${agent.name}:`);
			log("─".repeat(60));
			log(resultText);
			log("─".repeat(60));
		} else if (body.error) {
			const errCode = body.error.code;
			const errMsg = body.error.message;
			error(`Agent returned error ${errCode}: ${errMsg}`);
		} else {
			error(`Unexpected response: ${JSON.stringify(body)}`);
		}
	} catch (e) {
		error(`Failed to send task: ${e}`);
		error(
			`Is the agent running? Start it with: bun scripts/jabr-cli.ts start ${agent.name}`,
		);
	}
}

async function cmdConfig() {
	log("Jabr Agent Configuration");
	log("═".repeat(60));
	log("");
	log("Agents:");
	for (const agent of AGENTS) {
		log(
			`  ${agent.name.padEnd(14)} port=${agent.port || "stdio"}  cmd=${runCommand(agent)}`,
		);
	}

	log("");
	log("Environment variables (current shell values shown):");
	const knownEnv: Array<[string, string, string]> = [
		["NINEROUTER_URL", "http://127.0.0.1:20128", "LLM gateway URL"],
		["NINEROUTER_KEY", "(unset)", "LLM API key"],
		["NINEROUTER_MODEL", "openrouter/minimax/minimax-m3:free", "Default model"],
		[
			"JABR_LLM_PROVIDER",
			"(unset)",
			"LLM provider selector: vercel or unset for 9Router",
		],
		[
			"VERCEL_AI_GATEWAY_KEY",
			"(unset)",
			"Vercel AI Gateway API key (also AI_GATEWAY_API_KEY)",
		],
		[
			"VERCEL_AI_GATEWAY_MODEL",
			"minimax/minimax-m3",
			"Vercel model ID (resilient form survives Sept 6 free-period end)",
		],
		[
			"VERCEL_AI_GATEWAY_BASE_URL",
			"https://ai-gateway.vercel.sh/v4/ai",
			"Vercel AI Gateway Base URL (optional override)",
		],
		[
			"JABR_URL",
			jabrUrlForPort(4000),
			"Orchestrator endpoint (required). Legacy: ORCHESTRATOR_URL",
		],
		["A2A_AUTH_TOKEN", "(unset)", "A2A auth token (optional)"],
		["A2A_REQUIRE_AUTH", "false", "Enforce A2A auth"],
		["JABR_TOKEN_CAP_<AGENT>", "100000", "Per-agent token budget"],
		["GITHUB_WEBHOOK_SECRET", "change-me", "Webhook signing secret"],
		["GITHUB_TOKEN", "(unset)", "GitHub PAT for webhook actions"],
		["GITHUB_REPO", "omnizya/jabr", "Default repo for webhooks"],
		["HERMES_KANBAN_BOARD", "(unset)", "Kanban board for task sync"],
	];

	const envWidth = 28;
	for (const [key, defaultVal, desc] of knownEnv) {
		const current = process.env[key] ?? defaultVal;
		log(`  ${key.padEnd(envWidth)} ${current}   # ${desc}`);
	}

	log("");
	log("Run scripts (from package.json):");
	const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as any;
	for (const [name, cmd] of Object.entries(pkg.scripts)) {
		if (name !== "test" && name !== "typecheck") {
			log(`  ${name.padEnd(16)} ${cmd}`);
		}
	}

	log("");
	log("Config file: none (env-driven). Set vars in your shell or a .env file.");
	log("");
	log("Log directory: " + LOG_DIR);
	log("PID files:   " + LOG_DIR + "/jabr-<agent>.pid");
}

// ── Entry point ────────────────────────────────────────────────────────────

const USAGE = `
jabr-cli — agent management for the Jabr multi-agent system

Usage:
  bun scripts/jabr-cli.ts <command> [args...]

Commands:
  start   [agent|all]   Start one agent or all (default: all)
  stop    [agent|all]   Stop one agent or all
  restart [agent|all]   Restart one agent or all
  status            Show live status of every agent
  logs    [agent|all]   Tail logs for one agent, or last 20 lines for all
  send    <agent> <text...>   Send a task to an agent via A2A
  config            Show agent topology, env vars, and run scripts

Examples:
  bun scripts/jabr-cli.ts start                     # start all agents
  bun scripts/jabr-cli.ts start all                 # start all agents (explicit)
  bun scripts/jabr-cli.ts start oracle              # start just the oracle
  bun scripts/jabr-cli.ts stop                      # stop all
  bun scripts/jabr-cli.ts restart fixer             # restart fixer
  bun scripts/jabr-cli.ts status                    # show health of all
  bun scripts/jabr-cli.ts logs oracle               # tail oracle log
  bun scripts/jabr-cli.ts send oracle "review this" # send task
  bun scripts/jabr-cli.ts config                    # show config

Agent topology:
  orchestrator  :4000  (A2A — JABIR, the orchestrator)
  oracle        :4001  (A2A — JABIR's LLM routing judge)
  librarian     :4002  (A2A — skill persistence)
  explorer      :4003  (A2A — codebase exploration)
  designer      :4004  (A2A — design tasks)
  fixer         :4005  (A2A — code fixes, artifacts)
  scientist     :4006  (A2A — data science via MCP)
  verification  :4009  (A2A — verification agent)
  jarvis        :1337  (A2A — proactive codebase steward)
  mcp           stdio  (MCP tool server — run_python, read/write, etc.)
  acp-bridge    stdio  (ACP bridge to orchestrator)
`;

function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
		log(USAGE);
		process.exit(0);
	}

	const cmd = args[0];
	const cmdArgs = args.slice(1);

	switch (cmd) {
		case "start":
			cmdStart(cmdArgs);
			break;
		case "stop":
			cmdStop(cmdArgs);
			break;
		case "restart":
			cmdRestart(cmdArgs);
			break;
		case "status":
			cmdStatus();
			break;
		case "logs":
			cmdLogs(cmdArgs);
			break;
		case "send":
			cmdSend(cmdArgs);
			break;
		case "config":
			cmdConfig();
			break;
		default:
			error(`Unknown command: ${cmd}`);
			log(USAGE);
			process.exit(1);
	}
}

main();
