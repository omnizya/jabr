import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import { SqliteMemoryStore } from "@adapters/sqlite-memory-store";
import { openJabrDb, initSchema } from "@adapters/sqlite-db";
import type { SessionData } from "@ports/memory-store";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function newMemoryDb(): Database {
  return openJabrDb(":memory:");
}

describe("SqliteTaskStore", () => {
  test("task round-trip on :memory: db", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);
    const taskId = "task-1";

    store.create(taskId);
    let task = store.get(taskId);
    expect(task).toBeDefined();
    expect(task!.state).toBe("submitted");
    expect(task!.messages).toEqual([]);
    expect(task!.artifacts).toEqual([]);

    store.appendMessage(taskId, {
      messageId: "m1",
      role: "user",
      kind: "message",
      parts: [{ kind: "text", text: "hi" }],
      contextId: "ctx",
      referenceTaskIds: ["t1"],
    });
    store.appendMessage(taskId, {
      messageId: "m2",
      role: "agent",
      kind: "message",
      parts: [{ kind: "data", data: { x: 1 } }],
      contextId: "ctx",
    });
    store.appendArtifact(taskId, {
      name: "art1",
      parts: [{ kind: "text", text: "result" }],
    });

    store.updateState(taskId, "completed");
    task = store.get(taskId);
    expect(task).toBeDefined();
    expect(task!.state).toBe("completed");
    expect(task!.messages.length).toBe(2);

    const [m1, m2] = task!.messages;
    expect(m1!.messageId).toBe("m1");
    expect(m1!.referenceTaskIds).toEqual(["t1"]);
    expect(m1!.taskId).toBe(taskId);
    expect(m1!.parts).toEqual([{ kind: "text", text: "hi" }]);

    expect(m2!.messageId).toBe("m2");
    expect(m2!.referenceTaskIds).toBeUndefined();
    expect(m2!.taskId).toBe(taskId);
    expect(m2!.parts).toEqual([{ kind: "data", data: { x: 1 } }]);

    expect(task!.artifacts.length).toBe(1);
    expect(task!.artifacts[0]!.name).toBe("art1");
    expect(task!.artifacts[0]!.parts).toEqual([{ kind: "text", text: "result" }]);
  });

  test("create overwrite clears children", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);
    const taskId = "task-2";

    store.create(taskId);
    store.appendMessage(taskId, {
      messageId: "m1",
      role: "user",
      kind: "message",
      parts: [{ kind: "text", text: "hi" }],
      contextId: "ctx",
    });
    store.appendArtifact(taskId, {
      name: "art1",
      parts: [{ kind: "text", text: "r" }],
    });

    store.create(taskId); // overwrite
    const task = store.get(taskId);
    expect(task!.state).toBe("submitted");
    expect(task!.messages).toEqual([]);
    expect(task!.artifacts).toEqual([]);
  });

  test("missing-task semantics", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);

    expect(store.get("nope")).toBeUndefined();
    expect(() => store.updateState("nope", "completed")).not.toThrow();
    expect(() =>
      store.appendMessage("nope", {
        messageId: "m1",
        role: "user",
        kind: "message",
        parts: [{ kind: "text", text: "hi" }],
        contextId: "ctx",
      }),
    ).not.toThrow();
    expect(() =>
      store.appendArtifact("nope", { name: "a", parts: [] }),
    ).not.toThrow();

    expect(store.get("nope")).toBeUndefined();
  });

  test("state CHECK rejects invalid state", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);
    store.create("task-3");
    expect(() => store.updateState("task-3", "bogus-state" as never)).toThrow();
  });

  test("all 9 states are reachable via updateState", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);

    store.create("s1");
    store.create("w1");
    store.create("i1");
    store.create("c1");
    store.create("f1");
    store.create("ca1");
    store.create("r1");
    store.create("a1");
    store.create("u1");

    store.updateState("s1", "submitted");
    store.updateState("w1", "working");
    store.updateState("i1", "input-required");
    store.updateState("c1", "completed");
    store.updateState("f1", "failed");
    store.updateState("ca1", "canceled");
    store.updateState("r1", "rejected");
    store.updateState("a1", "auth-required");
    store.updateState("u1", "unknown");

    expect(store.get("s1")!.state).toBe("submitted");
    expect(store.get("w1")!.state).toBe("working");
    expect(store.get("i1")!.state).toBe("input-required");
    expect(store.get("c1")!.state).toBe("completed");
    expect(store.get("f1")!.state).toBe("failed");
    expect(store.get("ca1")!.state).toBe("canceled");
    expect(store.get("r1")!.state).toBe("rejected");
    expect(store.get("a1")!.state).toBe("auth-required");
    expect(store.get("u1")!.state).toBe("unknown");
  });

  test("listByState filters and orders by created_at", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);

    store.create("a");
    store.create("b");
    store.create("c");
    store.updateState("a", "completed");
    store.updateState("b", "failed");
    store.updateState("c", "completed");

    const completed = store.listByState("completed");
    expect(completed.map((t) => t.id)).toEqual(["a", "c"]);
    expect(completed.every((t) => t.state === "completed")).toBe(true);
    const failed = store.listByState("failed");
    expect(failed.map((t) => t.id)).toEqual(["b"]);
  });

  test("transition history records every state change", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);
    const taskId = "hist-1";

    store.create(taskId);
    store.updateState(taskId, "working");
    store.updateState(taskId, "input-required");
    store.updateState(taskId, "working");
    store.updateState(taskId, "completed");

    const history = store.getTransitionHistory(taskId);
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ from: "submitted", to: "working", timestamp: expect.any(String) });
    expect(history[1]).toEqual({ from: "working", to: "input-required", timestamp: expect.any(String) });
    expect(history[2]).toEqual({ from: "input-required", to: "working", timestamp: expect.any(String) });
    expect(history[3]).toEqual({ from: "working", to: "completed", timestamp: expect.any(String) });
  });

  test("re-create clears transitions", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);
    const taskId = "recon-1";

    store.create(taskId);
    store.updateState(taskId, "working");
    store.updateState(taskId, "completed");

    store.create(taskId); // overwrite
    const task = store.get(taskId);
    expect(task!.state).toBe("submitted");
    expect(task!.messages).toEqual([]);
    expect(task!.artifacts).toEqual([]);

    const history = store.getTransitionHistory(taskId);
    expect(history).toHaveLength(0);
  });

  test("no-transition recorded when state unchanged", () => {
    const db = newMemoryDb();
    const store = new SqliteTaskStore(db);
    const taskId = "noop-1";

    store.create(taskId); // submitted
    store.updateState(taskId, "submitted");

    const history = store.getTransitionHistory(taskId);
    expect(history).toHaveLength(0);
  });
});

describe("SqliteMemoryStore", () => {
  test("memory log append + read", () => {
    const db = newMemoryDb();
    const store = new SqliteMemoryStore(db, { mirrorFile: null });
    store.append("a");
    store.append("b");
    expect(store.read()).toBe("a\n\nb");
  });

  test("memory log dedups exact-duplicate entries", () => {
    const db = newMemoryDb();
    const store = new SqliteMemoryStore(db, { mirrorFile: null });
    store.append("dup");
    store.append("dup");
    store.append("unique");
    store.append("dup");
    expect(store.read()).toBe("dup\n\nunique");
  });

  test("memory log caps to most recent maxEntries", () => {
    const db = newMemoryDb();
    const store = new SqliteMemoryStore(db, { mirrorFile: null, maxEntries: 3 });
    store.append("a");
    store.append("b");
    store.append("c");
    store.append("d");
    store.append("e");
    expect(store.read()).toBe("c\n\nd\n\ne");
  });

  test("sessions round-trip", () => {
    const db = newMemoryDb();
    const store = new SqliteMemoryStore(db, { mirrorFile: null });

    const data: SessionData = {
      id: "s1",
      history: [{ role: "user", content: "hello", timestamp: "t1" }],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    store.saveSession("s1", data);
    const got = store.getSession("s1");
    expect(got).toEqual(data);

    // save again: createdAt preserved, updatedAt updated
    const updated: SessionData = {
      ...data,
      updatedAt: "2024-01-02T00:00:00.000Z",
      history: [
        { role: "user", content: "hello", timestamp: "t1" },
        { role: "agent", content: "hi", timestamp: "t2" },
      ],
    };
    store.saveSession("s1", updated);
    const got2 = store.getSession("s1");
    expect(got2!.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(got2!.updatedAt).toBe("2024-01-02T00:00:00.000Z");
    expect(got2!.history.length).toBe(2);

    // listSessions most-recent-first
    store.saveSession("s2", {
      id: "s2",
      history: [],
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });
    const list = store.listSessions();
    expect(list).toContain("s1");
    expect(list).toContain("s2");

    // deleteSession
    expect(store.deleteSession("s1")).toBe(true);
    expect(store.deleteSession("s1")).toBe(false);
    expect(store.getSession("s1")).toBeNull();
    expect(store.getSession("missing")).toBeNull();
  });
});

describe("shared db", () => {
  test("both stores coexist on one :memory: connection", () => {
    const db = newMemoryDb();
    const tasks = new SqliteTaskStore(db);
    const memory = new SqliteMemoryStore(db, { mirrorFile: null });

    tasks.create("t1");
    tasks.appendMessage("t1", {
      messageId: "m1",
      role: "user",
      kind: "message",
      parts: [{ kind: "text", text: "hi" }],
      contextId: "ctx",
    });
    memory.append("entry");
    memory.saveSession("s1", {
      id: "s1",
      history: [],
      createdAt: "now",
      updatedAt: "now",
    });

    expect(tasks.get("t1")!.messages.length).toBe(1);
    expect(memory.read()).toBe("entry");
    expect(memory.getSession("s1")!.id).toBe("s1");
  });
});

describe("mirror file", () => {
  test("mirrorFile set writes file content", () => {
    const dir = mkdtempSync(join(tmpdir(), "jabr-mirror-"));
    const file = join(dir, "mirror.md");
    const db = newMemoryDb();
    const store = new SqliteMemoryStore(db, { mirrorFile: file });
    store.append("entry");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("\n\nentry");
    rmSync(dir, { recursive: true, force: true });
  });

  test("mirrorFile null creates no file", () => {
    const dir = mkdtempSync(join(tmpdir(), "jabr-mirror-"));
    const file = join(dir, "should-not-exist.md");
    const db = newMemoryDb();
    const store = new SqliteMemoryStore(db, { mirrorFile: null });
    store.append("entry");
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("durability across connections", () => {
  test("data survives close + reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "jabr-dur-"));
    const path = join(dir, "jabr.db");
    const db = openJabrDb(path);
    const tasks = new SqliteTaskStore(db);
    const memory = new SqliteMemoryStore(db, { mirrorFile: null });

    tasks.create("t1");
    tasks.appendMessage("t1", {
      messageId: "m1",
      role: "user",
      kind: "message",
      parts: [{ kind: "text", text: "hi" }],
      contextId: "ctx",
    });
    memory.saveSession("s1", {
      id: "s1",
      history: [],
      createdAt: "now",
      updatedAt: "now",
    });
    db.close();

    const db2 = new Database(path);
    initSchema(db2);
    const tasks2 = new SqliteTaskStore(db2);
    const memory2 = new SqliteMemoryStore(db2, { mirrorFile: null });

    expect(tasks2.get("t1")!.messages.length).toBe(1);
    expect(memory2.getSession("s1")!.id).toBe("s1");

    db2.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
