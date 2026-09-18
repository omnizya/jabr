#!/usr/bin/env -S bun run
/**
 * planner.ts — Persistent plan tracker for the Jabr/Kasbah roadmap.
 *
 * Keeps goals, tasks, and decision logs in SQLite so planning survives
 * across sessions. The human-readable plan lives in docs/plans/ROADMAP.md;
 * this tool tracks execution state. DB path is env-overridable.
 *
 * Usage:
 *   bun run planner                          # status summary
 *   bun run planner init                     # ensure schema exists (idempotent)
 *   bun run planner goal add "<title>" [--phase N]
 *   bun run planner goal list [--phase N]
 *   bun run planner goal set <id> <active|done>
 *   bun run planner task add "<title>" [--phase N] [--goal <id>]
 *   bun run planner task list [--phase N] [--status <s>]
 *   bun run planner task set <id> <todo|in_progress|done|blocked>
 *   bun run planner log "<message>"
 *   bun run planner log list [--limit N]
 *
 * Env:
 *   JABR_PLANNER_DB   SQLite path (default: <cwd>/memory/planner.db)
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH =
	process.env.JABR_PLANNER_DB ?? resolve(process.cwd(), "memory/planner.db");

const TASK_STATUSES = new Set(["todo", "in_progress", "done", "blocked"]);
const GOAL_STATUSES = new Set(["active", "done"]);

function openDb(): Database {
	const db = new Database(DB_PATH);
	ensureSchema(db);
	return db;
}

function ensureSchema(db: Database) {
	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS goals (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			phase INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE IF NOT EXISTS tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			phase INTEGER NOT NULL DEFAULT 0,
			goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
			status TEXT NOT NULL DEFAULT 'todo',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE IF NOT EXISTS plan_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts TEXT NOT NULL DEFAULT (datetime('now')),
			message TEXT NOT NULL
		);
	`);
}

function fail(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

function parseArgs(args: string[]): {
	positionals: string[];
	flags: Record<string, string>;
} {
	const positionals: string[] = [];
	const flags: Record<string, string> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) break;
		if (arg.startsWith("--") && i + 1 < args.length) {
			const value = args[i + 1];
			if (value !== undefined) flags[arg.slice(2)] = value;
			i++;
		} else {
			positionals.push(arg);
		}
	}
	return { positionals, flags };
}

function printUsage() {
	console.log(`plan-tracker — persistent goals/tasks/logs in SQLite

Usage:
  bun run planner                          status summary
  bun run planner init                     ensure schema exists (idempotent)
  bun run planner goal add "<title>" [--phase N]
  bun run planner goal list [--phase N]
  bun run planner goal set <id> <active|done>
  bun run planner task add "<title>" [--phase N] [--goal <id>]
  bun run planner task list [--phase N] [--status <s>]
  bun run planner task set <id> <todo|in_progress|done|blocked>
  bun run planner log "<message>"
  bun run planner log list [--limit N]

Env: JABR_PLANNER_DB   SQLite path (default: ${DB_PATH})`);
}

function cmdInit() {
	const db = openDb();
	console.log(`✓ Schema ready at ${DB_PATH}`);
	db.close();
}

function cmdGoalAdd(args: string[]) {
	const { positionals, flags } = parseArgs(args);
	const title = positionals.join(" ").trim();
	if (!title) fail("goal add requires a title");
	const phase = Number(flags.phase ?? 0);
	const db = openDb();
	const res = db
		.query("INSERT INTO goals (title, phase) VALUES (?, ?)")
		.run(title, phase);
	console.log(`✓ Goal #${res.lastInsertRowid}: ${title} (phase ${phase})`);
	db.close();
}

function cmdGoalList(args: string[]) {
	const phaseFilter = Number(parseArgs(args).flags.phase ?? NaN);
	const db = openDb();
	const rows = db
		.query(
			`SELECT id, title, phase, status, created_at FROM goals
			 ORDER BY phase, id`,
		)
		.all() as Array<{
		id: number;
		title: string;
		phase: number;
		status: string;
		created_at: string;
	}>;
	if (rows.length === 0) {
		console.log('No goals yet. Add one: bun run planner goal add "<title>"');
		db.close();
		return;
	}
	console.log("\nGoals:");
	console.log("─".repeat(72));
	for (const g of rows) {
		if (!Number.isNaN(phaseFilter) && g.phase !== phaseFilter) continue;
		console.log(`  #${g.id}  [${g.status.padEnd(6)}] p${g.phase}  ${g.title}`);
	}
	console.log("─".repeat(72));
	db.close();
}

function cmdGoalSet(id: number, status: string) {
	if (!GOAL_STATUSES.has(status)) fail(`invalid goal status: ${status}`);
	const db = openDb();
	const res = db
		.query(
			"UPDATE goals SET status = ?, updated_at = datetime('now') WHERE id = ?",
		)
		.run(status, id);
	if (res.changes === 0) fail(`goal #${id} not found`);
	console.log(`✓ Goal #${id} → ${status}`);
	db.close();
}

function cmdTaskAdd(args: string[]) {
	const { positionals, flags } = parseArgs(args);
	const title = positionals.join(" ").trim();
	if (!title) fail("task add requires a title");
	const phase = Number(flags.phase ?? 0);
	const goalId = Number(flags.goal ?? NaN);
	const db = openDb();
	if (!Number.isNaN(goalId)) {
		const goal = db.query("SELECT id FROM goals WHERE id = ?").get(goalId);
		if (!goal) fail(`goal #${goalId} not found`);
	}
	const res = db
		.query("INSERT INTO tasks (title, phase, goal_id) VALUES (?, ?, ?)")
		.run(title, phase, Number.isNaN(goalId) ? null : goalId);
	console.log(
		`✓ Task #${res.lastInsertRowid}: ${title} (phase ${phase}${Number.isNaN(goalId) ? "" : `, goal #${goalId}`})`,
	);
	db.close();
}

function cmdTaskList(args: string[]) {
	const flags = parseArgs(args).flags;
	const phaseFilter = Number(flags.phase ?? NaN);
	const statusFilter = flags.status;
	const db = openDb();
	const rows = db
		.query(
			`SELECT t.id, t.title, t.phase, t.goal_id, t.status, g.title AS goal
			 FROM tasks t LEFT JOIN goals g ON g.id = t.goal_id
			 ORDER BY t.phase, t.id`,
		)
		.all() as Array<{
		id: number;
		title: string;
		phase: number;
		goal_id: number | null;
		status: string;
		goal: string | null;
	}>;
	if (rows.length === 0) {
		console.log('No tasks yet. Add one: bun run planner task add "<title>"');
		db.close();
		return;
	}
	console.log("\nTasks:");
	console.log("─".repeat(80));
	for (const t of rows) {
		if (!Number.isNaN(phaseFilter) && t.phase !== phaseFilter) continue;
		if (statusFilter && t.status !== statusFilter) continue;
		const goalTag = t.goal ? `  goal=${t.goal.slice(0, 24)}` : "";
		console.log(
			`  #${t.id}  [${t.status.padEnd(10)}] p${t.phase}  ${t.title}${goalTag}`,
		);
	}
	console.log("─".repeat(80));
	db.close();
}

function cmdTaskSet(id: number, status: string) {
	if (!TASK_STATUSES.has(status)) fail(`invalid task status: ${status}`);
	const db = openDb();
	const res = db
		.query(
			"UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
		)
		.run(status, id);
	if (res.changes === 0) fail(`task #${id} not found`);
	console.log(`✓ Task #${id} → ${status}`);
	db.close();
}

function cmdLog(args: string[]) {
	const message = args.join(" ").trim();
	if (!message) fail("log requires a message");
	const db = openDb();
	const res = db
		.query("INSERT INTO plan_log (message) VALUES (?)")
		.run(message);
	console.log(`✓ Logged entry #${res.lastInsertRowid}: ${message}`);
	db.close();
}

function cmdLogList(args: string[]) {
	const limit = Number(parseArgs(args).flags.limit ?? 20);
	const db = openDb();
	const rows = db
		.query("SELECT id, ts, message FROM plan_log ORDER BY id DESC LIMIT ?")
		.all(limit) as Array<{ id: number; ts: string; message: string }>;
	if (rows.length === 0) {
		console.log('No log entries yet. Add one: bun run planner log "<message>"');
		db.close();
		return;
	}
	console.log("\nRecent log:");
	console.log("─".repeat(72));
	for (const r of rows) {
		console.log(`  ${r.ts}  ${r.message}`);
	}
	console.log("─".repeat(72));
	db.close();
}

function cmdStatus() {
	const db = openDb();
	const goals = db
		.query("SELECT status, COUNT(*) AS n FROM goals GROUP BY status")
		.all() as Array<{ status: string; n: number }>;
	const tasks = db
		.query("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status")
		.all() as Array<{ status: string; n: number }>;
	const logCount = db.query("SELECT COUNT(*) AS n FROM plan_log").get() as {
		n: number;
	};
	console.log(`\nPlan tracker — ${DB_PATH}`);
	console.log("─".repeat(72));
	console.log(
		"Goals:  " +
			(goals.length === 0
				? "(none)"
				: goals.map((g) => `${g.status}=${g.n}`).join(", ")),
	);
	console.log(
		"Tasks:  " +
			(tasks.length === 0
				? "(none)"
				: tasks.map((t) => `${t.status}=${t.n}`).join(", ")),
	);
	console.log(`Log:    ${logCount.n} entries`);
	console.log("─".repeat(72));
	console.log("Plan file: docs/plans/ROADMAP.md");
	db.close();
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
	case undefined:
	case "status":
		cmdStatus();
		break;
	case "help":
	case "--help":
	case "-h":
		printUsage();
		break;
	case "init":
		cmdInit();
		break;
	case "goal":
		switch (rest[0]) {
			case "add":
				cmdGoalAdd(rest.slice(1));
				break;
			case "list":
				cmdGoalList(rest.slice(1));
				break;
			case "set": {
				const id = rest[1];
				const status = rest[2];
				if (!id || !status) fail("goal set: expected <id> <status>");
				cmdGoalSet(Number(id), status);
				break;
			}
			default:
				fail("goal: expected add | list | set <id> <status>");
		}
		break;
	case "task":
		switch (rest[0]) {
			case "add":
				cmdTaskAdd(rest.slice(1));
				break;
			case "list":
				cmdTaskList(rest.slice(1));
				break;
			case "set": {
				const id = rest[1];
				const status = rest[2];
				if (!id || !status) fail("task set: expected <id> <status>");
				cmdTaskSet(Number(id), status);
				break;
			}
			default:
				fail("task: expected add | list | set <id> <status>");
		}
		break;
	case "log":
		if (rest[0] === "list") {
			cmdLogList(rest.slice(1));
		} else if (rest[0] === "add") {
			cmdLog(rest.slice(1));
		} else {
			cmdLog(rest);
		}
		break;
	default:
		fail(`unknown command: ${cmd}`);
}
