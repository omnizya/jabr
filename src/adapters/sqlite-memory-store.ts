import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MEMORY_DIR } from "@adapters/memory-fs";
import { initSchema } from "@adapters/sqlite-db";
import type { MemoryStorePort, SessionData } from "@ports/memory-store";

export interface SqliteMemoryStoreOptions {
	mirrorFile?: string | null;
	/** Maximum number of entries to retain in memory_log (oldest trimmed). Default 500. */
	maxEntries?: number;
}

export class SqliteMemoryStore implements MemoryStorePort {
	private readonly db: Database;
	private readonly mirrorFile: string | null;
	private readonly maxEntries: number;

	private readonly stmtReadLog;
	private readonly stmtAppendLog;
	private readonly stmtHasEntry;
	private readonly stmtTrimLog;
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
		this.maxEntries = opts?.maxEntries ?? 500;

		this.stmtReadLog = db.query(`SELECT entry FROM memory_log ORDER BY id`);
		this.stmtAppendLog = db.query(
			`INSERT INTO memory_log (entry, created_at) VALUES (?, ?)`,
		);
		this.stmtHasEntry = db.query(
			`SELECT 1 AS found FROM memory_log WHERE entry = ? LIMIT 1`,
		);
		this.stmtTrimLog = db.query(
			`DELETE FROM memory_log WHERE id IN (
         SELECT id FROM memory_log ORDER BY id DESC LIMIT -1 OFFSET ?
       )`,
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
		// Dedup: skip exact-duplicate entries so the log doesn't accumulate repeats.
		const existing = this.stmtHasEntry.get(entry) as
			| { found: number }
			| undefined;
		if (existing) return;

		const now = new Date().toISOString();
		this.stmtAppendLog.run(entry, now);
		// Cap: keep only the most recent maxEntries rows (oldest trimmed).
		this.stmtTrimLog.run(this.maxEntries);

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
