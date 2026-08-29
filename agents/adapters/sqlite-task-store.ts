import { Database } from "bun:sqlite";
import type { Task, TaskStorePort } from "@ports/task-store";
import type { A2AMessage, A2APart } from "@agents/types";
import { initSchema } from "@adapters/sqlite-db";

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

  constructor(db: Database) {
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
    this.db = db;

    this.stmtCreate = db.query(
      `INSERT OR REPLACE INTO tasks (id, state, created_at, updated_at) VALUES (?, 'working', ?, ?)`,
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
    this.stmtCreate.run(taskId, now, now);
    return { id: taskId, state: "working", messages: [], artifacts: [] };
  }

  get(taskId: string): Task | undefined {
    return this.reconstruct(taskId);
  }

  updateState(taskId: string, state: Task["state"]): void {
    const now = new Date().toISOString();
    this.stmtUpdateState.run(state, now, taskId);
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
      message.referenceTaskIds ? JSON.stringify(message.referenceTaskIds) : null,
      now,
      taskId,
    );
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
}
