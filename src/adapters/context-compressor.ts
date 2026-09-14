/**
 * context-compressor.ts — LLM context window management for memory.
 *
 * Wraps a MemoryStorePort and ensures that read() output never exceeds
 * JABR_MEMORY_MAX_TOKENS (approximate token count). When the threshold
 * is exceeded:
 *
 *   1. Older entries are summarized into key facts.
 *   2. Recent entries are preserved verbatim (they fit in budget).
 *   3. Stale data (older than JABR_MEMORY_TTL_HOURS) is evicted via
 *      the inner store's purgeOlderThan() method.
 *
 * Token counting uses the standard chars/4 approximation already used
 * by the budget system (see budget-token-approximation.test.ts).
 *
 * Configurable via env:
 *   - JABR_MEMORY_MAX_TOKENS  — soft ceiling (default 4000).
 *   - JABR_MEMORY_TTL_HOURS   — eviction age (default 24).
 *   - JABR_MEMORY_COMPRESS    — "true" to enable (default true).
 */

import { optionalBoolEnv, optionalIntEnv } from "@config/env-manager";
import type { MemoryStorePort, SessionData } from "@ports/memory-store";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ContextCompressorOptions {
	/** Soft token ceiling. When read() exceeds this, compression triggers. */
	maxTokens?: number;
	/** Hours after which entries are considered stale and evicted. */
	ttlHours?: number;
	/** Master switch. When false, read() passes through uncompressed. */
	enabled?: boolean;
}

export interface MemoryEnvConfig {
	maxTokens: number;
	ttlHours: number;
	enabled: boolean;
}

/** Read memory-specific env vars. Split out so tests can mock individually. */
export function getMemoryEnvConfig(): MemoryEnvConfig {
	return {
		maxTokens: optionalIntEnv("JABR_MEMORY_MAX_TOKENS", 4000),
		ttlHours: optionalIntEnv("JABR_MEMORY_TTL_HOURS", 24),
		enabled: optionalBoolEnv("JABR_MEMORY_COMPRESS", true),
	};
}

// ---------------------------------------------------------------------------
// Internal entry model
// ---------------------------------------------------------------------------

interface Entry {
	text: string;
	/** Index in the original read() output (0 = oldest). */
	index: number;
}

// ---------------------------------------------------------------------------
// Compressor
// ---------------------------------------------------------------------------

export class ContextCompressor implements MemoryStorePort {
	private readonly inner: MemoryStorePort;
	private readonly maxTokens: number;
	private readonly ttlHours: number;
	private readonly enabled: boolean;

	/** Exposed for observability / testing. */
	lastCompressedAt: Date | null = null;
	lastCompressedEntryCount = 0;

	constructor(inner: MemoryStorePort, opts?: ContextCompressorOptions) {
		this.inner = inner;
		const env = getMemoryEnvConfig();
		this.maxTokens = opts?.maxTokens ?? env.maxTokens;
		this.ttlHours = opts?.ttlHours ?? env.ttlHours;
		this.enabled = opts?.enabled ?? env.enabled;
	}

	// ---- Token approximation (chars / 4, matching budget system) ----

	static estimateTokens(text: string): number {
		return Math.max(1, Math.ceil(text.length / 4));
	}

	// ---- Core: read with compression ----

	read(): string {
		if (!this.enabled) return this.inner.read();

		const full = this.inner.read();
		const totalTokens = ContextCompressor.estimateTokens(full);

		if (totalTokens <= this.maxTokens) return full;

		// Over threshold — compress.
		const entries = this.parseEntries(full);
		return this.compress(entries, totalTokens);
	}

	// ---- Compression algorithm ----

	private parseEntries(fullText: string): Entry[] {
		const parts = fullText.split("\n\n").filter((e) => e.trim().length > 0);
		return parts.map((text, index) => ({ text, index }));
	}

	/**
	 * Keep recent entries that fit within the token budget.
	 * Summarize everything older into key facts.
	 */
	private compress(entries: Entry[], totalTokens: number): string {
		// Target: recent entries get half the budget, summary gets the other half.
		const recentBudget = Math.floor(this.maxTokens * 0.5);

		// Greedily take entries from the end (most recent first) until budget full.
		const keep: Entry[] = [];
		let keepTokens = 0;
		for (let i = entries.length - 1; i >= 0; i--) {
			const t = ContextCompressor.estimateTokens(entries[i]!.text);
			if (keepTokens + t > recentBudget && keep.length > 0) break;
			keep.unshift(entries[i]!);
			keepTokens += t;
		}

		const toCompress = entries.filter((e) => !keep.includes(e));
		// Account for "\n\n" separator between summary and keep (2 chars → ~1 token).
		const separatorTokens = toCompress.length > 0 ? 1 : 0;
		const summaryBudget = Math.max(
			0,
			this.maxTokens - keepTokens - separatorTokens,
		);
		const summary =
			toCompress.length > 0
				? this.summarizeEntries(toCompress, summaryBudget)
				: "";
		const summaryTokens = ContextCompressor.estimateTokens(summary);

		// If summary + keep still exceeds maxTokens, trim more from keep.
		let finalKeep = keep;
		let finalSummary = summary;
		while (
			finalKeep.length > 0 &&
			keepTokens + separatorTokens + summaryTokens > this.maxTokens
		) {
			const removed = finalKeep.shift()!;
			keepTokens -= ContextCompressor.estimateTokens(removed.text);
		}

		const keepText = finalKeep.map((e) => e.text).join("\n\n");
		this.lastCompressedAt = new Date();
		this.lastCompressedEntryCount = entries.length;

		return finalSummary ? `${finalSummary}\n\n${keepText}` : keepText;
	}

	/**
	 * Extractive summarization: pull lines that carry operational signal.
	 * No LLM call — pure regex extraction so it's safe to run inline.
	 */
	private summarizeEntries(entries: Entry[], budgetTokens = 200): string {
		const facts: string[] = [];
		const seen = new Set<string>();

		for (const entry of entries) {
			const lines = entry.text.split("\n");
			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (line.length === 0) continue;

				// Match lines with operational prefixes that carry signal.
				// These mirror the log patterns used throughout the codebase:
				//   [depth=N] ..., [dlq] ..., [palace] ..., [acl] ..., [security] ...
				const isKeyFact =
					/^\[(depth|dlq|palace|acl|security|error|fail|reject|budget|verify|handover|circular|retry|purge|evict)/i.test(
						line,
					) ||
					/(error|fail|reject|denied|contest|exhaust|overflow)/i.test(line);

				if (isKeyFact && !seen.has(line)) {
					seen.add(line);
					facts.push(line);
				}
			}
		}

		const header = `[Summary: ${entries.length}]`;
		const headerTokens = ContextCompressor.estimateTokens(header);

		if (facts.length === 0) {
			return header;
		}

		// Budget-aware: cap facts so the whole summary fits within budgetTokens.
		const availableForFacts = Math.max(0, budgetTokens - headerTokens);
		const capped: string[] = [];
		let usedTokens = 0;
		for (const fact of facts) {
			const t = ContextCompressor.estimateTokens(fact);
			if (usedTokens + t > availableForFacts && capped.length > 0) break;
			capped.push(fact);
			usedTokens += t;
		}

		return `${header}\n${capped.join("\n")}`;
	}

	// ---- TTL eviction ----

	/**
	 * Evict stale entries from the underlying store.
	 * Only works if the inner store exposes purgeOlderThan().
	 * Returns the number of entries purged, or 0 if unsupported.
	 */
	purgeStale(): number {
		const inner = this.inner as any;
		if (typeof inner.purgeOlderThan === "function") {
			return inner.purgeOlderThan(this.ttlHours);
		}
		return 0;
	}

	// ---- Pass-through methods ----

	append(entry: string): void {
		this.inner.append(entry);
	}

	listSessions(): string[] {
		return this.inner.listSessions();
	}

	deleteSession(id: string): boolean {
		return this.inner.deleteSession(id);
	}

	getSession(id: string): SessionData | null {
		return this.inner.getSession(id);
	}

	saveSession(id: string, data: SessionData): void {
		this.inner.saveSession(id, data);
	}
}
