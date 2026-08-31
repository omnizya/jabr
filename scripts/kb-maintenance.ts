#!/usr/bin/env -S bun run

/**
 * kb-maintenance.ts — Knowledge-base upkeep for the Jabr agent-lab.
 *
 * Performs idempotent maintenance on both knowledge layers:
 *   (A) MemPalace (memory/palace/*.json) — dedup, stale-TTL, integrity validation
 *   (B) SQLite memory_log (memory/jabr.db) — trim entries older than TTL, vacuum
 *
 * Flags:
 *   --dry-run       Preview changes without writing (default: false)
 *   --stale-days N  Entries older than N days are considered stale (default: 90)
 *   --verbose       Print per-entry detail for every action
 *   --quiet         Suppress summary, only emit JSON log lines
 *
 * Exit codes:
 *   0  success (or dry-run completed with findings)
 *   1  unrecoverable error
 *
 * Structured log format (JSON lines to stdout):
 *   {"ts":"...","level":"info|warn|error","action":"...","detail":{...}}
 *
 * Usage:
 *   bun scripts/kb-maintenance.ts --dry-run
 *   bun scripts/kb-maintenance.ts --stale-days 30
 *   bun scripts/kb-maintenance.ts --verbose
 *
 * Cron (example):
 *   0 3 * * * cd /home/m7r/Projects/Labs/agent-lab && bun scripts/kb-maintenance.ts --quiet >> /var/log/jabr-kb.log 2>&1
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// ── Path constants ────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const PALACE_DIR = join(ROOT, "memory", "palace");
const DB_PATH = join(ROOT, "memory", "jabr.db");

// ── Arg parsing ───────────────────────────────────────────────────────────────

interface Flags {
	dryRun: boolean;
	staleDays: number;
	verbose: boolean;
	quiet: boolean;
}

function parseArgs(argv: string[]): Flags {
	const flags: Flags = {
		dryRun: false,
		staleDays: 90,
		verbose: false,
		quiet: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") flags.dryRun = true;
		else if (arg === "--stale-days") {
			const n = parseInt(argv[++i] ?? "", 10);
			if (isNaN(n) || n < 0) {
				logError("arg-parse", {
					message: `--stale-days requires a non-negative integer, got "${argv[i]}"`,
				});
				process.exit(1);
			}
			flags.staleDays = n;
		} else if (arg === "--verbose") flags.verbose = true;
		else if (arg === "--quiet") flags.quiet = true;
		else if (arg === "--help" || arg === "-h") {
			console.log(
				[
					"Usage: bun scripts/kb-maintenance.ts [options]",
					"",
					"Options:",
					"  --dry-run          Preview without making changes",
					"  --stale-days N     Stale threshold in days (default: 90)",
					"  --verbose          Print per-entry detail",
					"  --quiet            Suppress human-readable summary",
					"  --help, -h         Show this help",
				].join("\n"),
			);
			process.exit(0);
		} else {
			logError("arg-parse", { message: `unknown flag: ${arg}` });
			process.exit(1);
		}
	}
	return flags;
}

// ── Structured logging ────────────────────────────────────────────────────────

interface LogEntry {
	ts: string;
	level: "info" | "warn" | "error";
	action: string;
	detail: Record<string, unknown>;
}

function emitLog(
	level: LogEntry["level"],
	action: string,
	detail: Record<string, unknown>,
) {
	const entry: LogEntry = {
		ts: new Date().toISOString(),
		level,
		action,
		detail,
	};
	const line = JSON.stringify(entry);
	if (level === "error") console.error(line);
	else console.log(line);
}

function logInfo(action: string, detail: Record<string, unknown>) {
	emitLog("info", action, detail);
}
function logWarn(action: string, detail: Record<string, unknown>) {
	emitLog("warn", action, detail);
}
function logError(action: string, detail: Record<string, unknown>) {
	emitLog("error", action, detail);
}

// ── Counters for summary ──────────────────────────────────────────────────────

const stats = {
	palaceTotal: 0,
	palaceCorrupt: 0,
	palaceDeduped: 0,
	palaceStale: 0,
	palaceValidated: 0,
	sqliteTotal: 0,
	sqliteStale: 0,
	sqliteVacuumed: false,
};

// ── Content hashing for dedup ─────────────────────────────────────────────────

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Palace maintenance ────────────────────────────────────────────────────────

interface PalaceEntry {
	slug: string;
	content: string;
	tags: string[];
	createdAt: string;
	relations: string[];
	filePath: string;
	contentHash: string;
}

/**
 * Parse a single palace JSON file. Returns null if unparseable (corrupt).
 */
function parsePalaceEntry(filePath: string, raw: string): PalaceEntry | null {
	try {
		const obj = JSON.parse(raw) as Partial<PalaceEntry>;
		if (
			typeof obj.slug !== "string" ||
			typeof obj.content !== "string" ||
			!Array.isArray(obj.tags)
		) {
			return null;
		}
		return {
			slug: obj.slug,
			content: obj.content,
			tags: obj.tags,
			createdAt: obj.createdAt ?? new Date(0).toISOString(),
			relations: obj.relations ?? [],
			filePath,
			contentHash: hashContent(obj.content),
		};
	} catch {
		return null;
	}
}

/**
 * Heuristic: is this slug a timestamp-based auto-generated entry?
 * Pattern: <prefix>-<13-digit-millis> or <prefix>-<uuid>
 * These are candidates for dedup and TTL cleanup.
 */
function isTimestampSlug(slug: string): boolean {
	return (
		/-\d{13}$/.test(slug) ||
		/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(slug)
	);
}

/**
 * Heuristic: is the content low-value (template-only, no real data)?
 * Examples: "Steward scan complete: 0 findings...", "Librarian agent processed..."
 */
function isLowValueContent(content: string): boolean {
	const c = content.trim();
	if (c.length < 60) return true; // very short
	if (/^Steward scan complete: 0 findings/.test(c)) return true;
	if (
		/^Librarian agent processed:[\s\S]*Findings: topic processed by Librarian Agent\./.test(
			c,
		)
	)
		return true;
	if (/^\u2022 Library\/API identified:/.test(c) && c.length < 300) return true;
	return false;
}

async function maintainPalace(flags: Flags): Promise<void> {
	if (!existsSync(PALACE_DIR)) {
		logWarn("palace-skip", {
			message: "palace directory does not exist",
			path: PALACE_DIR,
		});
		return;
	}

	const files = readdirSync(PALACE_DIR).filter((f) => f.endsWith(".json"));
	stats.palaceTotal = files.length;

	const entries: PalaceEntry[] = [];
	const corruptFiles: string[] = [];

	for (const file of files) {
		const filePath = join(PALACE_DIR, file);
		const raw = await Bun.file(filePath).text();
		const entry = parsePalaceEntry(filePath, raw);
		if (entry) {
			entries.push(entry);
		} else {
			corruptFiles.push(file);
			stats.palaceCorrupt++;
		}
	}

	// ── Step 1: Integrity ──────────────────────────────────────────────────────

	for (const file of corruptFiles) {
		const filePath = join(PALACE_DIR, file);
		logWarn("palace-corrupt", {
			file,
			action: flags.dryRun ? "would-skip" : "skipped",
		});
		if (!flags.dryRun) {
			try {
				unlinkSync(filePath);
				logInfo("palace-corrupt-removed", { file });
			} catch (e) {
				logError("palace-corrupt-remove-failed", { file, error: String(e) });
			}
		}
	}

	// ── Step 2: Dedup ──────────────────────────────────────────────────────────
	// Group by contentHash, keep oldest (by createdAt then by slug lexicographic).

	const hashGroups = new Map<string, PalaceEntry[]>();
	for (const entry of entries) {
		const group = hashGroups.get(entry.contentHash) ?? [];
		group.push(entry);
		hashGroups.set(entry.contentHash, group);
	}

	for (const [hash, group] of hashGroups) {
		if (group.length < 2) continue;
		// Sort oldest first, then by slug for determinism
		group.sort((a, b) => {
			const t = a.createdAt.localeCompare(b.createdAt);
			return t !== 0 ? t : a.slug.localeCompare(b.slug);
		});
		const keeper = group[0]!;
		for (const dup of group.slice(1)) {
			stats.palaceDeduped++;
			logInfo("palace-dedup", {
				kept: keeper.slug,
				removed: dup.slug,
				hash,
				reason: flags.dryRun ? "would-remove" : "removed",
			});
			if (flags.verbose) {
				logInfo("palace-dedup-detail", {
					keeper: keeper.slug,
					dup: dup.slug,
					contentPreview: dup.content.slice(0, 80),
				});
			}
			if (!flags.dryRun) {
				try {
					unlinkSync(dup.filePath);
				} catch (e) {
					logError("palace-dedup-remove-failed", {
						file: dup.slug,
						error: String(e),
					});
				}
			}
		}
	}

	// ── Step 3: Stale cleanup ──────────────────────────────────────────────────
	// Candidates: timestamp-based slugs older than TTL OR low-value content older than TTL.
	// We do NOT delete curated entries (protocol-research, skill-creation, docs-lookup, etc.)
	// unless they are duplicates of something already kept.

	const staleCutoff = new Date(
		Date.now() - flags.staleDays * 86_400_000,
	).toISOString();

	for (const entry of entries) {
		// Skip if already removed (dedup)
		if (!existsSync(entry.filePath)) continue;

		const isStale = entry.createdAt < staleCutoff;
		if (!isStale) {
			stats.palaceValidated++;
			continue;
		}

		// Only auto-remove if it's a timestamp-based slug OR low-value content
		const isAutoCandidate =
			isTimestampSlug(entry.slug) || isLowValueContent(entry.content);
		if (!isAutoCandidate) {
			stats.palaceValidated++;
			if (flags.verbose) {
				logInfo("palace-retained-curated", {
					slug: entry.slug,
					createdAt: entry.createdAt,
					ageDays: flags.staleDays,
				});
			}
			continue;
		}

		stats.palaceStale++;
		logInfo("palace-stale", {
			slug: entry.slug,
			createdAt: entry.createdAt,
			ageDays: Math.floor(
				(Date.now() - new Date(entry.createdAt).getTime()) / 86_400_000,
			),
			reason: isTimestampSlug(entry.slug) ? "timestamp-slug" : "low-value",
			action: flags.dryRun ? "would-remove" : "removed",
		});
		if (!flags.dryRun) {
			try {
				unlinkSync(entry.filePath);
			} catch (e) {
				logError("palace-stale-remove-failed", {
					file: entry.slug,
					error: String(e),
				});
			}
		}
	}
}

// ── SQLite maintenance ────────────────────────────────────────────────────────

async function maintainSqlite(flags: Flags): Promise<void> {
	if (!existsSync(DB_PATH)) {
		logWarn("sqlite-skip", {
			message: "SQLite database does not exist",
			path: DB_PATH,
		});
		return;
	}

	let db: Database;
	try {
		db = new Database(DB_PATH);
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
	} catch (e) {
		logError("sqlite-open-failed", { path: DB_PATH, error: String(e) });
		return;
	}

	// ── Count current entries ──────────────────────────────────────────────────

	const countRow = db.query("SELECT COUNT(*) AS c FROM memory_log").get() as {
		c: number;
	};
	stats.sqliteTotal = countRow.c;

	// ── Trim stale entries ─────────────────────────────────────────────────────
	// Remove entries older than TTL. Entries without a valid ISO created_at are
	// kept (can't determine age). The store already caps at 500, but that only
	// runs on append — old entries that were never trimmed remain.

	const staleCutoff = new Date(
		Date.now() - flags.staleDays * 86_400_000,
	).toISOString();

	const staleRows = db
		.query(
			"SELECT id, created_at FROM memory_log WHERE created_at < ? ORDER BY id",
		)
		.all(staleCutoff) as Array<{ id: number; created_at: string }>;

	stats.sqliteStale = staleRows.length;

	if (staleRows.length > 0) {
		logInfo("sqlite-stale-found", {
			count: staleRows.length,
			cutoff: staleCutoff,
		});
		if (flags.verbose) {
			for (const row of staleRows) {
				logInfo("sqlite-stale-entry", {
					id: row.id,
					createdAt: row.created_at,
				});
			}
		}
		if (!flags.dryRun) {
			const stmt = db.prepare("DELETE FROM memory_log WHERE id = ?");
			const deleteMany = db.transaction((ids: number[]) => {
				for (const id of ids) stmt.run(id);
			});
			try {
				deleteMany(staleRows.map((r) => r.id));
				logInfo("sqlite-stale-deleted", { count: staleRows.length });
			} catch (e) {
				logError("sqlite-stale-delete-failed", { error: String(e) });
			}
		}
	}

	// ── Vacuum if we made changes ───────────────────────────────────────────────

	if (!flags.dryRun && staleRows.length > 0) {
		try {
			db.exec("VACUUM");
			stats.sqliteVacuumed = true;
			logInfo("sqlite-vacuum", { reclaimed: true });
		} catch (e) {
			logError("sqlite-vacuum-failed", { error: String(e) });
		}
	}

	db.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const flags = parseArgs(process.argv.slice(2));

	logInfo("kb-maintenance-start", {
		dryRun: flags.dryRun,
		staleDays: flags.staleDays,
		palaceDir: PALACE_DIR,
		dbPath: DB_PATH,
	});

	const startedAt = Date.now();

	// Run palace and sqlite maintenance sequentially (palace writes are independent of SQLite)
	await maintainPalace(flags);
	await maintainSqlite(flags);

	const elapsedMs = Date.now() - startedAt;

	const summary = {
		elapsedMs,
		dryRun: flags.dryRun,
		palaceTotal: stats.palaceTotal,
		palaceCorrupt: stats.palaceCorrupt,
		palaceDeduped: stats.palaceDeduped,
		palaceStale: stats.palaceStale,
		palaceValidated: stats.palaceValidated,
		sqliteTotal: stats.sqliteTotal,
		sqliteStale: stats.sqliteStale,
		sqliteVacuumed: stats.sqliteVacuumed,
	};

	logInfo("kb-maintenance-complete", summary);

	if (!flags.quiet) {
		console.log(
			[
				"",
				"═══════════════════════════════════════════════════════════════",
				`  KB Maintenance Summary${flags.dryRun ? " (DRY RUN)" : ""}`,
				"═══════════════════════════════════════════════════════════════",
				`  Palace entries scanned:   ${stats.palaceTotal}`,
				`  Palace corrupt removed:   ${stats.palaceCorrupt}`,
				`  Palace duplicates removed: ${stats.palaceDeduped}`,
				`  Palace stale removed:     ${stats.palaceStale}`,
				`  Palace validated OK:      ${stats.palaceValidated}`,
				`  ─────────────────────────────────────────────────────────────`,
				`  SQLite memory_log total:  ${stats.sqliteTotal}`,
				`  SQLite stale entries:     ${stats.sqliteStale}`,
				`  SQLite vacuumed:          ${stats.sqliteVacuumed}`,
				`  ─────────────────────────────────────────────────────────────`,
				`  Elapsed: ${elapsedMs}ms`,
				"═══════════════════════════════════════════════════════════════",
			].join("\n"),
		);
	}
}

main().catch((e) => {
	logError("kb-maintenance-fatal", {
		error: String(e),
		stack: (e as Error)?.stack ?? "none",
	});
	process.exit(1);
});
