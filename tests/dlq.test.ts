import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { openJabrDb } from "@adapters/sqlite-db";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";

function makeStore(): { store: SqliteTaskStore; db: Database } {
	const db = openJabrDb(":memory:");
	const store = new SqliteTaskStore(db);
	return { store, db };
}

function makeMessage(role: "user" | "agent", text: string) {
	return {
		messageId: `msg-${role}-${text}`,
		role,
		kind: "message" as const,
		parts: [{ kind: "text" as const, text }],
		contextId: "ctx-1",
	};
}

describe("Dead Letter Queue (DLQ)", () => {
	let store: SqliteTaskStore;
	let db: Database;

	beforeEach(() => {
		const result = makeStore();
		store = result.store;
		db = result.db;
	});

	test("tasks table has retry_count column", () => {
		const info = db.query("PRAGMA table_info(tasks)").all() as Array<{
			name: string;
		}>;
		const colNames = info.map((c) => c.name);
		expect(colNames).toContain("retry_count");
	});

	test("dead_letter_queue table exists", () => {
		const tables = db
			.query(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dead_letter_queue'",
			)
			.all() as Array<{ name: string }>;
		expect(tables.length).toBe(1);
	});

	test("getRetryCount returns 0 for new task", () => {
		store.create("t-1");
		expect(store.getRetryCount("t-1")).toBe(0);
	});

	test("getRetryCount returns 0 for unknown task", () => {
		expect(store.getRetryCount("nonexistent")).toBe(0);
	});

	test("incrementRetryCount increases the counter", () => {
		store.create("t-1");
		expect(store.getRetryCount("t-1")).toBe(0);
		store.incrementRetryCount("t-1");
		expect(store.getRetryCount("t-1")).toBe(1);
		store.incrementRetryCount("t-1");
		expect(store.getRetryCount("t-1")).toBe(2);
	});

	test("moveToDLQ adds entry to DLQ", () => {
		store.create("t-1");
		store.updateState("t-1", "failed");
		store.appendMessage("t-1", makeMessage("user", "hello"));
		store.appendMessage("t-1", makeMessage("agent", "error occurred"));

		store.moveToDLQ("t-1", "Agent timeout after 30s");

		const dlqEntry = store.getDLQEntry("t-1");
		expect(dlqEntry).toBeDefined();
		expect(dlqEntry?.taskId).toBe("t-1");
		expect(dlqEntry?.error).toBe("Agent timeout after 30s");
		expect(dlqEntry?.state).toBe("failed");
		expect(dlqEntry?.messageCount).toBe(2);
	});

	test("listDLQ returns all entries sorted by moved_at DESC", () => {
		store.create("t-1");
		store.updateState("t-1", "failed");
		store.moveToDLQ("t-1", "Error 1");

		store.create("t-2");
		store.updateState("t-2", "failed");
		store.moveToDLQ("t-2", "Error 2");

		const entries = store.listDLQ();
		expect(entries.length).toBe(2);
		// DESC order — t-2 was added later
		expect(entries[0]!.taskId).toBe("t-2");
		expect(entries[1]!.taskId).toBe("t-1");
	});

	test("getDLQEntry returns undefined for non-DLQ task", () => {
		store.create("t-1");
		expect(store.getDLQEntry("t-1")).toBeUndefined();
	});

	test("retryFromDLQ removes entry and resets state", () => {
		store.create("t-1");
		store.updateState("t-1", "failed");
		store.moveToDLQ("t-1", "Agent timeout");

		const success = store.retryFromDLQ("t-1");
		expect(success).toBe(true);

		// DLQ entry should be gone
		expect(store.getDLQEntry("t-1")).toBeUndefined();

		// Task state should be reset
		const task = store.get("t-1");
		expect(task?.state).toBe("submitted");
	});

	test("retryFromDLQ returns false for non-DLQ task", () => {
		store.create("t-1");
		expect(store.retryFromDLQ("t-1")).toBe(false);
	});

	test("purgeDLQ deletes specific entry", () => {
		store.create("t-1");
		store.updateState("t-1", "failed");
		store.moveToDLQ("t-1", "Error 1");

		store.create("t-2");
		store.updateState("t-2", "failed");
		store.moveToDLQ("t-2", "Error 2");

		const deleted = store.purgeDLQ("t-1");
		expect(deleted).toBe(true);
		expect(store.getDLQEntry("t-1")).toBeUndefined();
		expect(store.getDLQEntry("t-2")).toBeDefined();
	});

	test("purgeAllDLQ deletes all entries", () => {
		store.create("t-1");
		store.updateState("t-1", "failed");
		store.moveToDLQ("t-1", "Error 1");

		store.create("t-2");
		store.updateState("t-2", "failed");
		store.moveToDLQ("t-2", "Error 2");

		const count = store.purgeAllDLQ();
		expect(count).toBe(2);
		expect(store.listDLQ().length).toBe(0);
	});

	test("retry_count persists across state changes", () => {
		store.create("t-1");
		store.incrementRetryCount("t-1");
		store.incrementRetryCount("t-1");
		store.updateState("t-1", "failed");
		store.moveToDLQ("t-1", "timeout");

		const entry = store.getDLQEntry("t-1");
		expect(entry?.retryCount).toBe(2);
	});
});
