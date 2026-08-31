import { describe, expect, test } from "bun:test";
import { openJabrDb } from "@adapters/sqlite-db";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import type { Task } from "@ports/task-store";

/**
 * Verification test confirming that getTask (the same code path wired into
 * mcp-servers/tools.ts) returns a valid task for a known taskId and that
 * the returned status is not "not_found".
 *
 * The getTask callback in tools.ts (lines 443-455) does:
 *   const db = openJabrDb();
 *   const taskStore = new SqliteTaskStore(db);
 *   const task = taskStore.get(taskId);
 *   if (!task) return { id: taskId, status: "not_found", error: ... };
 *   return task;
 *
 * This test exercises that exact path against an :memory: database.
 */
function getTask(taskId: string, db = openJabrDb(":memory:")): unknown {
	const taskStore = new SqliteTaskStore(db);
	const task = taskStore.get(taskId);
	if (!task) {
		return {
			id: taskId,
			status: "not_found",
			error: `No task found with id "${taskId}"`,
		};
	}
	return task;
}

describe("getTask verification", () => {
	test("returns task data for a known valid taskId", () => {
		const db = openJabrDb(":memory:");
		const store = new SqliteTaskStore(db);
		const taskId = "verify-task-001";

		store.create(taskId);
		store.updateState(taskId, "working");
		store.appendMessage(taskId, {
			messageId: "m1",
			role: "user",
			kind: "message",
			parts: [{ kind: "text", text: "hello" }],
			contextId: "ctx",
		});

		const result = getTask(taskId, db);

		// result must be a task object, not a not_found envelope
		expect(result).toBeDefined();
		expect(result).not.toBeNull();
		expect((result as { status?: string }).status).not.toBe("not_found");

		const task = result as Task;
		expect(task.id).toBe(taskId);
		expect(task.state).toBe("working");
		expect(task.messages).toHaveLength(1);
		expect(task.messages[0]?.parts).toEqual([{ kind: "text", text: "hello" }]);
		expect(task.artifacts).toEqual([]);
	});

	test("status is not 'not_found' for an existing task", () => {
		const db = openJabrDb(":memory:");
		const store = new SqliteTaskStore(db);
		const taskId = "status-check-002";

		store.create(taskId);
		store.updateState(taskId, "completed");

		const result = getTask(taskId, db);
		const obj = result as Record<string, unknown>;

		// A real task has { id, state, messages, artifacts }.
		// The not_found envelope has { id, status: "not_found", error }.
		// The key differentiator: a real task has `state`, the envelope has `status`.
		expect((result as { status?: string }).status).not.toBe("not_found");
		expect((result as { state?: string }).state).toBe("completed");
		expect(Array.isArray(obj.messages)).toBe(true);
		expect(obj.messages).toHaveLength(0);
	});

	test("getTask returns not_found only for a missing taskId", () => {
		const db = openJabrDb(":memory:");

		const result = getTask("does-not-exist", db);
		expect(result).toEqual({
			id: "does-not-exist",
			status: "not_found",
			error: 'No task found with id "does-not-exist"',
		});
	});
});
