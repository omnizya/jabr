import { Database, type SQLQueryBindings } from "bun:sqlite";
import { initSchema } from "@adapters/sqlite-db";
import type { A2AMessage, A2APart } from "@agents/types";
import type {
	DLQEntry,
	Task,
	TaskFilter,
	TaskStorePort,
} from "@ports/task-store";
import type { Task as A2ATask } from "../types/a2a-v1.ts";

export class SqliteTaskStore implements TaskStorePort {
	private readonly db: Database;

	private readonly stmtCreate;
	private readonly stmtGetTask;
	private readonly stmtGetMessages;
	private readonly stmtGetArtifacts;
	private readonly stmtUpdateState;
	private readonly stmtAppendMessage;
	private readonly stmtAppendArtifact;
	private readonly stmtListByState;
	private readonly stmtRecordTransition;
	private readonly stmtGetTransitions;
	private readonly stmtListTasks;

	// DLQ statements
	private readonly stmtGetRetryCount;
	private readonly stmtIncrementRetryCount;
	private readonly stmtMoveToDLQ;
	private readonly stmtListDLQ;
	private readonly stmtGetDLQEntry;
	private readonly stmtRetryFromDLQ;
	private readonly stmtPurgeDLQ;
	private readonly stmtPurgeAllDLQ;

	// Subscriptions for real-time updates
	private readonly subscriptions = new Map<string, Set<(task: Task) => void>>();

	constructor(db: Database) {
		db.exec("PRAGMA foreign_keys = ON");
		initSchema(db);
		this.db = db;

		this.stmtCreate = db.query(
			`INSERT OR REPLACE INTO tasks (id, state, created_at, updated_at) VALUES (?, 'submitted', ?, ?)`,
		);
		this.stmtGetTask = db.query(
			`SELECT id, state, created_at, updated_at FROM tasks WHERE id = ?`,
		);
		this.stmtGetMessages = db.query(
			`SELECT message_id, role, kind, parts_json, context_id, msg_task_id, ref_task_ids_json FROM messages WHERE task_id = ? ORDER BY id`,
		);
		this.stmtGetArtifacts = db.query(
			`SELECT name, parts_json FROM artifacts WHERE task_id = ? ORDER BY id`,
		);
		this.stmtUpdateState = db.query(
			`UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?`,
		);
		this.stmtAppendMessage = db.query(
			`INSERT INTO messages (task_id, message_id, role, kind, parts_json, context_id, msg_task_id, ref_task_ids_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)`,
		);
		this.stmtAppendArtifact = db.query(
			`INSERT INTO artifacts (task_id, name, parts_json, created_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)`,
		);
		this.stmtListByState = db.query(
			`SELECT id, state, created_at, updated_at FROM tasks WHERE state = ? ORDER BY created_at`,
		);
		this.stmtRecordTransition = db.query(
			`INSERT INTO task_transitions (task_id, from_state, to_state, timestamp) VALUES (?, ?, ?, ?)`,
		);
		this.stmtGetTransitions = db.query(
			`SELECT from_state, to_state, timestamp FROM task_transitions WHERE task_id = ? ORDER BY id`,
		);
		this.stmtListTasks = db.query(
			`SELECT id, state, created_at, updated_at FROM tasks ORDER BY created_at`,
		);

		// DLQ prepared statements
		this.stmtGetRetryCount = db.query(
			`SELECT retry_count FROM tasks WHERE id = ?`,
		);
		this.stmtIncrementRetryCount = db.query(
			`UPDATE tasks SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?`,
		);
		this.stmtMoveToDLQ = db.query(
			`INSERT OR REPLACE INTO dead_letter_queue (task_id, original_id, error, retry_count, moved_at, state_snapshot)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		);
		this.stmtListDLQ = db.query(
			`SELECT dlq.task_id, t.state, dlq.error, dlq.retry_count, dlq.moved_at,
			        (SELECT COUNT(*) FROM messages m WHERE m.task_id = dlq.task_id) as msg_count
			 FROM dead_letter_queue dlq
			 JOIN tasks t ON t.id = dlq.task_id
			 ORDER BY dlq.moved_at DESC`,
		);
		this.stmtGetDLQEntry = db.query(
			`SELECT dlq.task_id, t.state, dlq.error, dlq.retry_count, dlq.moved_at,
			        (SELECT COUNT(*) FROM messages m WHERE m.task_id = dlq.task_id) as msg_count
			 FROM dead_letter_queue dlq
			 JOIN tasks t ON t.id = dlq.task_id
			 WHERE dlq.task_id = ?`,
		);
		this.stmtRetryFromDLQ = db.query(
			`DELETE FROM dead_letter_queue WHERE task_id = ?`,
		);
		this.stmtPurgeDLQ = db.query(
			`DELETE FROM dead_letter_queue WHERE task_id = ?`,
		);
		this.stmtPurgeAllDLQ = db.query(`DELETE FROM dead_letter_queue`);
	}

	private reconstruct(taskId: string): Task | undefined {
		const row = this.stmtGetTask.get(taskId) as
			| { id: string; state: Task["state"] }
			| undefined;
		if (!row) return undefined;

		const msgRows = this.stmtGetMessages.all(taskId) as Array<{
			message_id: string;
			role: A2AMessage["role"];
			kind: string;
			parts_json: string;
			context_id: string;
			msg_task_id: string | null;
			ref_task_ids_json: string | null;
		}>;

		const messages: A2AMessage[] = msgRows.map((r) => ({
			messageId: r.message_id,
			role: r.role,
			kind: r.kind as "message",
			parts: JSON.parse(r.parts_json) as A2APart[],
			contextId: r.context_id,
			taskId: r.msg_task_id ?? taskId,
			...(r.ref_task_ids_json
				? { referenceTaskIds: JSON.parse(r.ref_task_ids_json) as string[] }
				: {}),
		}));

		const artRows = this.stmtGetArtifacts.all(taskId) as Array<{
			name: string;
			parts_json: string;
		}>;

		const artifacts = artRows.map((r) => ({
			name: r.name,
			parts: JSON.parse(r.parts_json) as A2APart[],
		}));

		return {
			id: row.id,
			state: row.state,
			messages,
			artifacts,
		};
	}

	create(taskId: string): Task {
		const now = new Date().toISOString();
		try {
			this.stmtCreate.run(taskId, now, now);
		} catch (e) {
			console.error(`[SqliteTaskStore] failed to create task ${taskId}: ${e}`);
			throw e;
		}
		return { id: taskId, state: "submitted", messages: [], artifacts: [] };
	}

	get(taskId: string): Task | undefined {
		return this.reconstruct(taskId);
	}

	updateState(taskId: string, state: Task["state"]): void {
		// Record the transition for audit trail, but only if the task exists.
		const existing = this.reconstruct(taskId);
		if (!existing) {
			const now = new Date().toISOString();
			this.stmtUpdateState.run(state, now, taskId);
			return;
		}
		const from = existing.state;
		if (from !== state) {
			const now = new Date().toISOString();
			try {
				this.stmtRecordTransition.run(taskId, from, state, now);
			} catch (e) {
				console.error(`[SqliteTaskStore] transition record failed: ${e}`);
			}
		}
		const now = new Date().toISOString();
		this.stmtUpdateState.run(state, now, taskId);

		// Notify subscribers
		const task = this.reconstruct(taskId);
		if (task) {
			this.notifySubscribers(taskId, task);
		}
	}

	appendMessage(taskId: string, message: A2AMessage): void {
		const now = new Date().toISOString();
		this.stmtAppendMessage.run(
			taskId,
			message.messageId,
			message.role,
			message.kind,
			JSON.stringify(message.parts),
			message.contextId,
			message.taskId ?? null,
			message.referenceTaskIds
				? JSON.stringify(message.referenceTaskIds)
				: null,
			now,
			taskId,
		);

		// Notify subscribers
		const task = this.reconstruct(taskId);
		if (task) {
			this.notifySubscribers(taskId, task);
		}
	}

	appendArtifact(
		taskId: string,
		artifact: { name: string; parts: A2APart[] },
	): void {
		const now = new Date().toISOString();
		this.stmtAppendArtifact.run(
			taskId,
			artifact.name,
			JSON.stringify(artifact.parts),
			now,
			taskId,
		);

		// Notify subscribers
		const task = this.reconstruct(taskId);
		if (task) {
			this.notifySubscribers(taskId, task);
		}
	}

	listByState(state: Task["state"]): Task[] {
		const rows = this.stmtListByState.all(state) as Array<{
			id: string;
			state: Task["state"];
		}>;
		return rows
			.map((r) => this.reconstruct(r.id))
			.filter((t): t is Task => t !== undefined);
	}

	list(filter?: TaskFilter): Task[] {
		let query = `SELECT id, state, created_at, updated_at FROM tasks`;
		const params: SQLQueryBindings[] = [];

		const conditions: string[] = [];
		if (filter?.status) {
			conditions.push(`state = ?`);
			params.push(filter.status);
		}
		if (filter?.contextId) {
			// We don't store contextId in tasks table, so we'd need to join with messages
			// For now, we'll skip this filter as it's not in the schema
		}

		if (conditions.length > 0) {
			query += ` WHERE ` + conditions.join(` AND `);
		}

		query += ` ORDER BY created_at`;

		if (filter?.pageSize) {
			query += ` LIMIT ?`;
			params.push(filter.pageSize);
		}

		const stmt = this.db.query(query);
		const rows = stmt.all(...params) as Array<{
			id: string;
			state: Task["state"];
		}>;

		return rows
			.map((r) => this.reconstruct(r.id))
			.filter((t): t is Task => t !== undefined);
	}

	subscribe(taskId: string, cb: (task: Task) => void): () => void {
		if (!this.subscriptions.has(taskId)) {
			this.subscriptions.set(taskId, new Set());
		}
		this.subscriptions.get(taskId)!.add(cb);

		// Immediately emit current task state
		const task = this.reconstruct(taskId);
		if (task) {
			cb(task);
		}

		// Return unsubscribe function
		return () => {
			const subs = this.subscriptions.get(taskId);
			if (subs) {
				subs.delete(cb);
				if (subs.size === 0) {
					this.subscriptions.delete(taskId);
				}
			}
		};
	}

	private notifySubscribers(taskId: string, task: Task): void {
		const subs = this.subscriptions.get(taskId);
		if (subs) {
			for (const cb of subs) {
				try {
					cb(task);
				} catch (e) {
					console.error(`[SqliteTaskStore] subscriber callback error: ${e}`);
				}
			}
		}
	}

	getTransitionHistory(
		taskId: string,
	): Array<{ from: Task["state"]; to: Task["state"]; timestamp: string }> {
		const rows = this.stmtGetTransitions.all(taskId) as Array<{
			from_state: Task["state"];
			to_state: Task["state"];
			timestamp: string;
		}>;
		return rows.map((r) => ({
			from: r.from_state,
			to: r.to_state,
			timestamp: r.timestamp,
		}));
	}

	// ---- Dead Letter Queue (DLQ) ----

	getRetryCount(taskId: string): number {
		const row = this.stmtGetRetryCount.get(taskId) as
			| { retry_count: number }
			| undefined;
		return row?.retry_count ?? 0;
	}

	incrementRetryCount(taskId: string): void {
		const now = new Date().toISOString();
		this.stmtIncrementRetryCount.run(now, taskId);
	}

	moveToDLQ(taskId: string, error: string): void {
		const now = new Date().toISOString();
		const retryCount = this.getRetryCount(taskId);
		const task = this.reconstruct(taskId);
		const stateSnapshot = JSON.stringify({
			id: task?.id ?? taskId,
			state: task?.state ?? "failed",
			messages: task?.messages ?? [],
			artifacts: task?.artifacts ?? [],
		});
		this.stmtMoveToDLQ.run(
			taskId,
			taskId,
			error,
			retryCount,
			now,
			stateSnapshot,
		);
	}

	listDLQ(): DLQEntry[] {
		const rows = this.stmtListDLQ.all() as Array<{
			task_id: string;
			state: string;
			error: string;
			retry_count: number;
			moved_at: string;
			msg_count: number;
		}>;
		return rows.map((r) => ({
			taskId: r.task_id,
			state: r.state,
			error: r.error,
			retryCount: r.retry_count,
			movedAt: r.moved_at,
			messageCount: r.msg_count,
		}));
	}

	getDLQEntry(taskId: string): DLQEntry | undefined {
		const row = this.stmtGetDLQEntry.get(taskId) as
			| {
					task_id: string;
					state: string;
					error: string;
					retry_count: number;
					moved_at: string;
					msg_count: number;
			  }
			| undefined;
		if (!row) return undefined;
		return {
			taskId: row.task_id,
			state: row.state,
			error: row.error,
			retryCount: row.retry_count,
			movedAt: row.moved_at,
			messageCount: row.msg_count,
		};
	}

	retryFromDLQ(taskId: string): boolean {
		const entry = this.getDLQEntry(taskId);
		if (!entry) return false;
		// Remove from DLQ
		this.stmtRetryFromDLQ.run(taskId);
		// Reset task state to submitted for re-dispatch
		const now = new Date().toISOString();
		this.stmtUpdateState.run("submitted", now, taskId);
		return true;
	}

	purgeDLQ(taskId: string): boolean {
		const result = this.stmtPurgeDLQ.run(taskId);
		return result.changes > 0;
	}

	purgeAllDLQ(): number {
		const result = this.stmtPurgeAllDLQ.run();
		return result.changes;
	}
}
