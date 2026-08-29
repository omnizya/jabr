import { Database } from "bun:sqlite";
import { join } from "node:path";
import { DEFAULT_MEMORY_DIR } from "@adapters/memory-fs";

export const DEFAULT_DB_PATH = join(DEFAULT_MEMORY_DIR, "jabr.db");
export const DEFAULT_BRIDGE_DB_PATH = join(DEFAULT_MEMORY_DIR, "jabr-bridge.db");

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  state      TEXT NOT NULL CHECK (state IN ('submitted','working','input-required','completed','failed','canceled','rejected','auth-required','unknown')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_transitions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state   TEXT NOT NULL,
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transitions_task_id ON task_transitions(task_id);

CREATE TABLE IF NOT EXISTS messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('user','agent','assistant','tool')),
  kind              TEXT NOT NULL DEFAULT 'message',
  parts_json        TEXT NOT NULL,
  context_id        TEXT NOT NULL,
  msg_task_id       TEXT,
  ref_task_ids_json TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_task_id ON artifacts(task_id);

CREATE TABLE IF NOT EXISTS memory_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  data_json  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
}

export function openJabrDb(path: string = DEFAULT_DB_PATH): Database {
  try {
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
    return db;
  } catch (e) {
    console.error(`[SqliteDb] failed to open database at ${path}: ${e}`);
    throw e;
  }
}
