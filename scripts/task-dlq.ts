#!/usr/bin/env -S bun run
/**
 * task-dlq.ts — Dead letter queue viewer + retry for failed A2A tasks.
 *
 * Usage:
 *   bun scripts/task-dlq.ts                  # list DLQ entries
 *   bun scripts/task-dlq.ts --retry <id>     # retry a specific DLQ entry
 *   bun scripts/task-dlq.ts --retry-all      # retry all DLQ entries
 *   bun scripts/task-dlq.ts --purge          # delete all DLQ entries
 *   bun scripts/task-dlq.ts --purge <id>     # delete a specific DLQ entry
 *   bun scripts/task-dlq.ts --failed         # show all failed tasks (incl. retries)
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH = resolve(process.cwd(), "memory/jabr.db");

function listDLQ(db: Database) {
	const rows = db
		.query(
			`SELECT dlq.task_id, dlq.error, dlq.retry_count, dlq.moved_at,
		        t.state, t.created_at, t.updated_at
		 FROM dead_letter_queue dlq
		 JOIN tasks t ON t.id = dlq.task_id
		 ORDER BY dlq.moved_at DESC`,
		)
		.all() as Array<{
		task_id: string;
		error: string;
		retry_count: number;
		moved_at: string;
		state: string;
		created_at: string;
		updated_at: string;
	}>;

	if (rows.length === 0) {
		console.log("No DLQ entries. ✓");
		return;
	}

	console.log(`\nDead Letter Queue: ${rows.length} entries`);
	console.log("─".repeat(100));
	for (const r of rows) {
		const id = r.task_id.slice(0, 12);
		const error = r.error.slice(0, 60);
		console.log(
			`  ${id}  retries=${r.retry_count}  moved=${r.moved_at}  err="${error}..."`,
		);
	}
	console.log(
		"\n  Use --retry <id> to retry, --retry-all to retry all, --purge to delete.",
	);
}

function retryFromDLQ(db: Database, taskId: string) {
	// Check if it's in the DLQ first
	const dlqRow = db
		.query("SELECT task_id FROM dead_letter_queue WHERE task_id = ?")
		.get(taskId) as { task_id: string } | undefined;

	if (!dlqRow) {
		console.error(`Task ${taskId} not found in DLQ.`);
		process.exit(1);
	}

	// Remove from DLQ
	db.query("DELETE FROM dead_letter_queue WHERE task_id = ?").run(taskId);
	// Reset task state for re-dispatch
	const now = new Date().toISOString();
	db.query(
		"UPDATE tasks SET state = 'submitted', updated_at = ? WHERE id = ?",
	).run(now, taskId);
	console.log(
		`✓ Task ${taskId.slice(0, 12)} → submitted (removed from DLQ, will be re-dispatched).`,
	);
}

function retryAllFromDLQ(db: Database) {
	const rows = db
		.query("SELECT task_id FROM dead_letter_queue")
		.all() as Array<{ task_id: string }>;
	if (rows.length === 0) {
		console.log("No DLQ entries to retry.");
		return;
	}

	const now = new Date().toISOString();
	for (const r of rows) {
		db.query("DELETE FROM dead_letter_queue WHERE task_id = ?").run(r.task_id);
		db.query(
			"UPDATE tasks SET state = 'submitted', updated_at = ? WHERE id = ?",
		).run(now, r.task_id);
	}
	console.log(`✓ ${rows.length} DLQ task(s) → submitted.`);
}

function purgeDLQ(db: Database, taskId?: string) {
	let changes: number;
	if (taskId) {
		const result = db
			.query("DELETE FROM dead_letter_queue WHERE task_id = ?")
			.run(taskId);
		changes = result.changes;
		console.log(`✓ Deleted ${changes} DLQ entr${changes === 1 ? "y" : "ies"}.`);
	} else {
		const result = db.query("DELETE FROM dead_letter_queue").run();
		changes = result.changes;
		console.log(`✓ Deleted ${changes} DLQ entr${changes === 1 ? "y" : "ies"}.`);
	}
}

function listAllFailed(db: Database) {
	const rows = db
		.query(
			`SELECT t.id, t.state, t.created_at, t.updated_at, t.retry_count,
		        CASE WHEN dlq.task_id IS NOT NULL THEN 'DLQ' ELSE 'FAILED' END as location
		 FROM tasks t
		 LEFT JOIN dead_letter_queue dlq ON dlq.task_id = t.id
		 WHERE t.state = 'failed'
		 ORDER BY t.updated_at DESC`,
		)
		.all() as Array<{
		id: string;
		state: string;
		created_at: string;
		updated_at: string;
		retry_count: number;
		location: string;
	}>;

	if (rows.length === 0) {
		console.log("No failed tasks. ✓");
		return;
	}

	console.log(`\nAll failed tasks: ${rows.length}`);
	console.log("─".repeat(100));
	for (const r of rows) {
		console.log(
			`  ${r.id.slice(0, 12)}  retries=${r.retry_count}  loc=${r.location}  updated=${r.updated_at}`,
		);
	}
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const db = new Database(DB_PATH);

if (args.includes("--purge")) {
	const idx = args.indexOf("--purge");
	const taskId = args[idx + 1];
	purgeDLQ(db, taskId);
} else if (args.includes("--retry-all")) {
	retryAllFromDLQ(db);
} else if (args.includes("--retry")) {
	const idx = args.indexOf("--retry");
	const taskId = args[idx + 1];
	if (!taskId) {
		console.error("Usage: --retry <task-id>");
		process.exit(1);
	}
	retryFromDLQ(db, taskId);
} else if (args.includes("--failed")) {
	listAllFailed(db);
} else {
	listDLQ(db);
}

db.close();
