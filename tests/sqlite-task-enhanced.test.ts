import { describe, test, expect } from "bun:test";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import type { Task, TaskStatus } from "@ports/task-store";

function makeStore(): SqliteTaskStore {
  return new SqliteTaskStore({ maxEntries: 100, mirrorFile: null });
}

function makeTask(id: string, state: TaskStatus): Task {
  return {
    id,
    state,
    text: `task-${id}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    artifacts: [],
  };
}

describe("SqliteTaskStore", () => {
  test("creates and retrieves a task", async () => {
    const store = makeStore();
    const task = makeTask("t-1", "submitted");
    await store.create(task);
    const got = await store.get("t-1");
    expect(got).toBeDefined();
    expect(got?.id).toBe("t-1");
    expect(got?.state).toBe("submitted");
  });

  test("updates task state", async () => {
    const store = makeStore();
    await store.create(makeTask("t-1", "submitted"));
    await store.updateState("t-1", "working");
    const got = await store.get("t-1");
    expect(got?.state).toBe("working");
  });

  test("lists tasks by state", async () => {
    const store = makeStore();
    await store.create(makeTask("t-1", "submitted"));
    await store.create(makeTask("t-2", "working"));
    await store.create(makeTask("t-3", "completed"));
    await store.create(makeTask("t-4", "completed"));

    const submitted = await store.listByState("submitted");
    expect(submitted.length).toBe(1);
    const completed = await store.listByState("completed");
    expect(completed.length).toBe(2);
  });

  test("appends messages to task", async () => {
    const store = makeStore();
    await store.create(makeTask("t-1", "submitted"));
    await store.appendMessage("t-1", { role: "user", content: "hello" });
    await store.appendMessage("t-1", { role: "agent", content: "hi" });
    const got = await store.get("t-1");
    expect(got?.messages.length).toBe(2);
  });

  test("returns undefined for missing task", async () => {
    const store = makeStore();
    const got = await store.get("nonexistent");
    expect(got).toBeUndefined();
  });

  test("handles all A2A v1.0 states", async () => {
    const store = makeStore();
    const states: TaskStatus[] = [
      "submitted",
      "working",
      "input-required",
      "completed",
      "canceled",
      "failed",
      "rejected",
      "auth-required",
      "unknown",
    ];
    for (let i = 0; i < states.length; i++) {
      await store.create(makeTask(`t-${i}`, states[i]));
    }
    for (let i = 0; i < states.length; i++) {
      const got = await store.get(`t-${i}`);
      expect(got?.state).toBe(states[i]);
    }
  });
});
