import { Database } from "bun:sqlite";
import type { MemoryStorePort, SessionData } from "@ports/memory-store";
import { initSchema } from "@adapters/sqlite-db";
import { DEFAULT_MEMORY_DIR } from "@adapters/memory-fs";
import { join, dirname } from "node:path";
import { mkdirSync, appendFileSync } from "node:fs";

export interface SqliteMemoryStoreOptions {
  mirrorFile?: string | null;
}

export class SqliteMemoryStore implements MemoryStorePort {
  private readonly db: Database;
  private readonly mirrorFile: string | null;

  private readonly stmtReadLog;
  private readonly stmtAppendLog;
  private readonly stmtListSessions;
  private readonly stmtDeleteSession;
  private readonly stmtGetSession;
  private readonly stmtSaveSession;

  constructor(db: Database, opts?: SqliteMemoryStoreOptions) {
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
    this.db = db;
    this.mirrorFile =
      opts?.mirrorFile === undefined
        ? join(DEFAULT_MEMORY_DIR, "orchestrator.md")
        : opts.mirrorFile;

    this.stmtReadLog = db.query(`SELECT entry FROM memory_log ORDER BY id`);
    this.stmtAppendLog = db.query(
      `INSERT INTO memory_log (entry, created_at) VALUES (?, ?)`,
    );
    this.stmtListSessions = db.query(
      `SELECT id FROM sessions ORDER BY updated_at DESC`,
    );
    this.stmtDeleteSession = db.query(`DELETE FROM sessions WHERE id = ?`);
    this.stmtGetSession = db.query(
      `SELECT data_json FROM sessions WHERE id = ?`,
    );
    this.stmtSaveSession = db.query(
      `INSERT INTO sessions (id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
    );
  }

  read(): string {
    const rows = this.stmtReadLog.all() as Array<{ entry: string }>;
    return rows.map((r) => r.entry).join("\n\n");
  }

  append(entry: string): void {
    const now = new Date().toISOString();
    this.stmtAppendLog.run(entry, now);
    if (this.mirrorFile) {
      try {
        mkdirSync(dirname(this.mirrorFile), { recursive: true });
        appendFileSync(this.mirrorFile, "\n\n" + entry, "utf-8");
      } catch (e) {
        console.error("[SqliteMemoryStore] mirror write failed:", e);
      }
    }
  }

  listSessions(): string[] {
    const rows = this.stmtListSessions.all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  deleteSession(id: string): boolean {
    const res = this.stmtDeleteSession.run(id);
    return res.changes > 0;
  }

  getSession(id: string): SessionData | null {
    const row = this.stmtGetSession.get(id) as
      | { data_json: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data_json) as SessionData;
    } catch {
      return null;
    }
  }

  saveSession(id: string, data: SessionData): void {
    this.stmtSaveSession.run(
      id,
      JSON.stringify(data),
      data.createdAt,
      data.updatedAt,
    );
  }
}
