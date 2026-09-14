import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	ContextCompressor,
	getMemoryEnvConfig,
} from "@adapters/context-compressor";
import { initSchema, openJabrDb } from "@adapters/sqlite-db";
import { SqliteMemoryStore } from "@adapters/sqlite-memory-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh in-memory SQLite store with prepopulated entries. */
function buildStore(entries: string[]): SqliteMemoryStore {
	const db = openJabrDb(":memory:");
	const store = new SqliteMemoryStore(db, { mirrorFile: null });
	for (const e of entries) {
		store.append(e);
	}
	return store;
}

/** Build a compressor wrapping a store with explicit opts (no env). */
function buildCompressor(
	store: SqliteMemoryStore,
	opts: any = {},
): ContextCompressor {
	return new ContextCompressor(store, {
		maxTokens: opts.maxTokens ?? 100,
		ttlHours: opts.ttlHours ?? 24,
		enabled: opts.enabled ?? true,
	});
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

describe("ContextCompressor — token estimation", () => {
	test("estimates 1 token per 4 chars", () => {
		expect(ContextCompressor.estimateTokens("abcd")).toBe(1);
		expect(ContextCompressor.estimateTokens("abcdefgh")).toBe(2);
	});

	test("rounds up partial groups", () => {
		expect(ContextCompressor.estimateTokens("abc")).toBe(1);
		expect(ContextCompressor.estimateTokens("abcde")).toBe(2);
	});

	test("never returns zero", () => {
		expect(ContextCompressor.estimateTokens("")).toBe(1);
		expect(ContextCompressor.estimateTokens("a")).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// No compression when under threshold
// ---------------------------------------------------------------------------

describe("ContextCompressor — pass-through", () => {
	test("returns full text when under maxTokens", () => {
		const store = buildStore(["short", "also short"]);
		const c = buildCompressor(store, { maxTokens: 100 });
		const out = c.read();
		expect(out).toContain("short");
		expect(out).toContain("also short");
	});

	test("returns full text when disabled", () => {
		// Add many entries — without compression this would be huge.
		const entries = Array.from({ length: 50 }, (_, i) =>
			`entry ${i} `.repeat(10),
		);
		const store = buildStore(entries);
		const c = buildCompressor(store, { maxTokens: 10, enabled: false });
		const out = c.read();
		// Should contain all entries (no compression).
		expect(out).toContain("entry 0");
		expect(out).toContain("entry 49");
	});
});

// ---------------------------------------------------------------------------
// Compression algorithm
// ---------------------------------------------------------------------------

describe("ContextCompressor — compression", () => {
	test("summary captures key operational facts within budget", () => {
		// Small entries with clear operational prefixes.
		const entries = [
			"[dlq] Retry 1/3 for task abc",
			"[palace] Augmented query with 3 entries",
			"[security] DENIED: unauthorized access",
			"Budget: deducted 205 tokens from oracle",
			"[depth=0] Routed task to oracle agent",
		];
		// Total ~80 chars → ~20 tokens. Budget 15 → compression triggers.
		const store = buildStore(entries);
		const c = buildCompressor(store, { maxTokens: 15 });
		const out = c.read();
		const tokens = ContextCompressor.estimateTokens(out);
		expect(tokens).toBeLessThanOrEqual(15);
		// Should contain the summary header.
		expect(out).toContain("[Summary:");
		// Should contain at least some key operational facts.
		expect(out).toMatch(/\[(dlq|palace|security|depth|budget)\]/i);
	});

	test("respects strict maxTokens budget", () => {
		// 20 entries × 113 chars = ~565 tokens total. Target = 100 tokens.
		const entries = Array.from(
			{ length: 20 },
			(_, i) => `[depth=${i}] Routed task ${"x".repeat(80)} to agent-${i}`,
		);
		const store = buildStore(entries);
		const c = buildCompressor(store, { maxTokens: 100 });
		const out = c.read();
		const tokens = ContextCompressor.estimateTokens(out);
		expect(tokens).toBeLessThanOrEqual(100);
		// Must contain the summary header.
		expect(out).toContain("[Summary:");
		// Must preserve the most recent entry.
		expect(out).toContain("agent-19");
	});

	test("never loses recent entries even under aggressive limit", () => {
		const entries = Array.from({ length: 10 }, (_, i) =>
			`RECENT-${i} `.repeat(20),
		);
		// Reasonable budget — must preserve at least the last entry.
		const store = buildStore(entries);
		const c = buildCompressor(store, { maxTokens: 200 });
		const out = c.read();
		const tokens = ContextCompressor.estimateTokens(out);
		expect(tokens).toBeLessThanOrEqual(200);
		expect(out).toContain("RECENT-9");
	});
});

// ---------------------------------------------------------------------------
// TTL eviction
// ---------------------------------------------------------------------------

describe("SqliteMemoryStore — TTL eviction", () => {
	test("purgeOlderThan deletes entries older than cutoff", async () => {
		const db = openJabrDb(":memory:");
		initSchema(db);
		const store = new SqliteMemoryStore(db, { mirrorFile: null });

		// Insert with explicit timestamps.
		const stmtInsert = db.query(
			"INSERT INTO memory_log (entry, created_at) VALUES (?, ?)",
		);

		// Old entry (48h ago).
		const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		stmtInsert.run("old entry", old);

		// Fresh entry (1h ago).
		const fresh = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		stmtInsert.run("fresh entry", fresh);

		expect(store.read()).toContain("old entry");
		expect(store.read()).toContain("fresh entry");

		const purged = store.purgeOlderThan(24);
		expect(purged).toBe(1);
		expect(store.read()).not.toContain("old entry");
		expect(store.read()).toContain("fresh entry");
	});

	test("purgeOlderThan returns 0 when nothing matches", () => {
		const store = buildStore(["recent entry"]);
		const purged = store.purgeOlderThan(24);
		expect(purged).toBe(0);
		expect(store.read()).toContain("recent entry");
	});

	test("purgeOlderThan with 0 hours purges everything except now", () => {
		const db = openJabrDb(":memory:");
		initSchema(db);
		const store = new SqliteMemoryStore(db, { mirrorFile: null });
		const stmtInsert = db.query(
			"INSERT INTO memory_log (entry, created_at) VALUES (?, ?)",
		);
		// 1 minute ago.
		const old = new Date(Date.now() - 60 * 1000).toISOString();
		stmtInsert.run("1-min-old", old);

		const purged = store.purgeOlderThan(0);
		expect(purged).toBe(1);
		expect(store.read()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// ContextCompressor.purgeStale() integration
// ---------------------------------------------------------------------------

describe("ContextCompressor — purgeStale integration", () => {
	test("delegates to inner store's purgeOlderThan", () => {
		const store = buildStore(["entry1", "entry2"]);
		const c = buildCompressor(store, { ttlHours: 48 });
		// No error even though entries are fresh.
		const purged = c.purgeStale();
		expect(purged).toBe(0);
	});

	test("returns 0 when inner store does not support purgeOlderThan", () => {
		const fakeStore = {
			read: () => "test",
			append: () => {},
			listSessions: () => [],
			deleteSession: () => false,
			getSession: () => null,
			saveSession: () => {},
		} as any;
		const c = new ContextCompressor(fakeStore, { ttlHours: 24 });
		expect(c.purgeStale()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------

describe("getMemoryEnvConfig", () => {
	test("returns defaults when env unset", () => {
		delete process.env.JABR_MEMORY_MAX_TOKENS;
		delete process.env.JABR_MEMORY_TTL_HOURS;
		delete process.env.JABR_MEMORY_COMPRESS;
		const cfg = getMemoryEnvConfig();
		expect(cfg.maxTokens).toBe(4000);
		expect(cfg.ttlHours).toBe(24);
		expect(cfg.enabled).toBe(true);
	});

	test("reads env vars", () => {
		process.env.JABR_MEMORY_MAX_TOKENS = "8000";
		process.env.JABR_MEMORY_TTL_HOURS = "12";
		process.env.JABR_MEMORY_COMPRESS = "false";
		const cfg = getMemoryEnvConfig();
		expect(cfg.maxTokens).toBe(8000);
		expect(cfg.ttlHours).toBe(12);
		expect(cfg.enabled).toBe(false);
		// Cleanup.
		delete process.env.JABR_MEMORY_MAX_TOKENS;
		delete process.env.JABR_MEMORY_TTL_HOURS;
		delete process.env.JABR_MEMORY_COMPRESS;
	});
});

// ---------------------------------------------------------------------------
// Pass-through methods
// ---------------------------------------------------------------------------

describe("ContextCompressor — pass-through methods", () => {
	test("append/read round-trip", () => {
		const store = buildStore([]);
		const c = buildCompressor(store, { maxTokens: 1000 });
		c.append("hello");
		c.append("world");
		expect(c.read()).toContain("hello");
		expect(c.read()).toContain("world");
	});

	test("session methods delegate to inner store", () => {
		const store = buildStore([]);
		const c = buildCompressor(store, { maxTokens: 1000 });
		c.saveSession("s1", {
			id: "s1",
			history: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		expect(c.listSessions()).toContain("s1");
		expect(c.getSession("s1")).not.toBeNull();
		expect(c.deleteSession("s1")).toBe(true);
		expect(c.listSessions()).not.toContain("s1");
	});
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("ContextCompressor — observability fields", () => {
	test("lastCompressedAt is set after compression", () => {
		const entries = Array.from({ length: 20 }, (_, i) =>
			`entry ${i} `.repeat(20),
		);
		const store = buildStore(entries);
		const c = buildCompressor(store, { maxTokens: 30 });
		expect(c.lastCompressedAt).toBeNull();
		c.read();
		expect(c.lastCompressedAt).toBeInstanceOf(Date);
		expect(c.lastCompressedEntryCount).toBe(20);
	});
});
