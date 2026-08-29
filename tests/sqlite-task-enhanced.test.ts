import { describe, test, expect } from "bun:test";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import { openJabrDb } from "@adapters/sqlite-db";
import type { Task } from "@ports/task-store";
import type { A2AMessage } from "@agents/types";

function makeStore(): SqliteTaskStore {
  return new SqliteTaskStore(openJabrDb(":memory:"));
}

function makeMessage(role: A2AMessage["role"], text: string): A2AMessage {
  return {
    messageId: `msg-${role}-${text}`,
    role,
    kind: "message",
    parts: [{ kind: "text", text }],
    contextId: "ctx-1",
  };
}

describe("SqliteTaskStore", () => {
  test("creates and retrieves a task", () => {
    const store = makeStore();
    store.create("t-1");
    const got = store.get("t-1");
    expect(got).toBeDefined();
    expect(got?.id).toBe("t-1");
    expect(got?.state).toBe("submitted");
  });

  test("updates task state", () => {
    const store = makeStore();
    store.create("t-1");
    store.updateState("t-1", "working");
    const got = store.get("t-1");
    expect(got?.state).toBe("working");
  });

  test("lists tasks by state", () => {
    const store = makeStore();
    store.create("t-1"); // stays submitted
    store.create("t-2");
    store.updateState("t-2", "working");
    store.create("t-3");
    store.updateState("t-3", "completed");
    store.create("t-4");
    store.updateState("t-4", "completed");

    const submitted = store.listByState("submitted");
    expect(submitted.length).toBe(1);
    const completed = store.listByState("completed");
    expect(completed.length).toBe(2);
  });

  test("appends messages to task", () => {
    const store = makeStore();
    store.create("t-1");
    store.appendMessage("t-1", makeMessage("user", "hello"));
    store.appendMessage("t-1", makeMessage("agent", "hi"));
    const got = store.get("t-1");
    expect(got?.messages.length).toBe(2);
    expect(got?.messages[0]?.parts[0]).toEqual({ kind: "text", text: "hello" });
  });

  test("returns undefined for missing task", () => {
    const store = makeStore();
    const got = store.get("nonexistent");
    expect(got).toBeUndefined();
  });

  test("handles all A2A v1.0 states", () => {
    const store = makeStore();
    const states: Task["state"][] = [
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
    states.forEach((state, i) => {
      store.create(`t-${i}`);
      store.updateState(`t-${i}`, state);
    });
    states.forEach((state, i) => {
      const got = store.get(`t-${i}`);
      expect(got?.state).toBe(state);
    });
  });
});