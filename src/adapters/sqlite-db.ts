import { Database } from "bun:sqlite";
import { join } from "node:path";
import { DEFAULT_MEMORY_DIR } from "@adapters/memory-fs";

export const DEFAULT_DB_PATH = join(DEFAULT_MEMORY_DIR, "jabr.db");
export const DEFAULT_BRIDGE_DB_PATH = join(
	DEFAULT_MEMORY_DIR,
	"jabr-bridge.db",
);

const TASKS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  state      TEXT NOT NULL CHECK (state IN ('submitted','working','input-required','completed','failed','canceled','rejected','auth-required','unknown')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

export const SCHEMA_SQL = `
${TASKS_TABLE_SQL}

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

/**
 * Migrate a pre-A2A-v1.0 `tasks` table (4-state CHECK constraint) to the
 * current 9-state schema. SQLite cannot ALTER a CHECK constraint, so the table
 * is rebuilt while preserving existing rows. Foreign keys are disabled around
 * the rebuild; dependent tables (task_transitions, messages, artifacts)
 * reference `tasks(id)` by name and remain valid after the rename.
 */
export function migrateTasksTable(db: Database): void {
	const row = db
		.query(
			"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
		)
		.get() as { sql: string } | undefined;
	if (!row) return; // no tasks table yet — SCHEMA_SQL will create it
	if (row.sql.includes("'submitted'")) return; // already current schema

	console.warn(
		"[SqliteDb] migrating tasks table schema (state CHECK constraint)",
	);
	db.exec("PRAGMA foreign_keys = OFF");
	try {
		db.exec("BEGIN");
		db.exec("DROP TABLE IF EXISTS tasks_new");
		db.exec(
			TASKS_TABLE_SQL.replace(
				"CREATE TABLE IF NOT EXISTS tasks",
				"CREATE TABLE tasks_new",
			),
		);
		db.exec(
			"INSERT INTO tasks_new (id, state, created_at, updated_at) SELECT id, state, created_at, updated_at FROM tasks",
		);
		db.exec("DROP TABLE tasks");
		db.exec("ALTER TABLE tasks_new RENAME TO tasks");
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	} finally {
		db.exec("PRAGMA foreign_keys = ON");
	}
}

export function initSchema(db: Database): void {
	db.exec(SCHEMA_SQL);
	migrateTasksTable(db);
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
