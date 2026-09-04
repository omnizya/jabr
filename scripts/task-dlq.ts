#!/usr/bin/env -S bun run

/**
 * task-dlq.ts — Dead letter queue viewer + retry for failed A2A tasks.
 *
 * Usage:
 *   bun scripts/task-dlq.ts                  # list failed tasks
 *   bun scripts/task-dlq.ts --retry <id>     # retry a specific task
 *   bun scripts/task-dlq.ts --retry-all      # retry all failed tasks
 *   bun scripts/task-dlq.ts --purge          # delete all failed tasks
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH = resolve(process.cwd(), "memory/jabr.db");

function listFailed(db: Database) {
	const rows = db.query(
		`SELECT t.id, t.state, t.created_at, t.updated_at,
		        COUNT(m.id) as msg_count
		 FROM tasks t
		 LEFT JOIN messages m ON m.task_id = t.id
		 WHERE t.state = 'failed'
		 GROUP BY t.id
		 ORDER BY t.updated_at DESC`,
	).all() as Array<{
		id: string;
		state: string;
		created_at: string;
		updated_at: string;
		msg_count: number;
	}>;

	if (rows.length === 0) {
		console.log("No failed tasks. ✓");
		return;
	}

	console.log(`\nFailed tasks: ${rows.length}`);
	console.log("─".repeat(80));
	for (const r of rows) {
		console.log(`  ${r.id.slice(0, 12)}  ${r.updated_at}  ${r.msg_count} msgs`);
	}
	console.log(
		"\n  Use --retry <id> to retry, --retry-all to retry all, --purge to delete.",
	);
}

function retryTask(db: Database, taskId: string) {
	const row = db.query("SELECT id FROM tasks WHERE id = ?").get(taskId) as
		| { id: string }
		| undefined;
	if (!row) {
		console.error(`Task ${taskId} not found.`);
		process.exit(1);
	}
	db.query("UPDATE tasks SET state = 'submitted', updated_at = ? WHERE id = ?").run(
		new Date().toISOString(),
		taskId,
	);
	console.log(`✓ Task ${taskId.slice(0, 12)} → submitted (will be re-dispatched).`);
}

function retryAll(db: Database) {
	const result = db
		.query("UPDATE tasks SET state = 'submitted', updated_at = ? WHERE state = 'failed'")
		.run(new Date().toISOString());
	console.log(`✓ ${result.changes} failed task(s) → submitted.`);
}

function purgeFailed(db: Database) {
	const result = db.query("DELETE FROM tasks WHERE state = 'failed'").run();
	console.log(`✓ Deleted ${result.changes} failed task(s).`);
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const db = new Database(DB_PATH);

if (args.includes("--purge")) {
	purgeFailed(db);
} else if (args.includes("--retry-all")) {
	retryAll(db);
} else if (args.includes("--retry")) {
	const idx = args.indexOf("--retry");
	const taskId = args[idx + 1];
	if (!taskId) {
		console.error("Usage: --retry <task-id>");
		process.exit(1);
	}
	retryTask(db, taskId);
} else {
	listFailed(db);
}

db.close();
