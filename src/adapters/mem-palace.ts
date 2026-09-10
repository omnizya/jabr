import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeEntry, KnowledgePort } from "@ports/knowledge-port";

export class MemPalaceAdapter implements KnowledgePort {
	private baseDir: string;

	// In-memory cache: slug → entry. Populated lazily on first list/query.
	private cache: Map<string, KnowledgeEntry> | null = null;

	// Inverted index: lowercase token → set of slugs containing it.
	// Built alongside the cache on first access.
	private index: Map<string, Set<string>> | null = null;

	// Tracks whether the index needs a rebuild (after store/relate mutations).
	private indexDirty = false;

	constructor(baseDir = "memory/palace") {
		this.baseDir = baseDir;
		if (!existsSync(this.baseDir)) {
			mkdirSync(this.baseDir, { recursive: true });
		}
	}

	async store(
		slug: string,
		content: string,
		tags: string[],
		relations: string[] = [],
	): Promise<void> {
		const filePath = join(this.baseDir, `${slug}.json`);
		let existingRelations = relations;
		let createdAt = new Date().toISOString();

		const file = Bun.file(filePath);
		if (await file.exists()) {
			try {
				const existing = (await file.json()) as KnowledgeEntry;
				createdAt = existing.createdAt || createdAt;
				existingRelations = Array.from(
					new Set([...(existing.relations || []), ...relations]),
				);
			} catch {
				// overwrite corrupted file
			}
		}

		const entry: KnowledgeEntry = {
			slug,
			content,
			tags,
			createdAt,
			relations: existingRelations,
		};

		await Bun.write(filePath, JSON.stringify(entry, null, 2));

		// Update cache + index if they've been built
		if (this.cache) {
			this.cache.set(slug, entry);
		}
		if (this.index) {
			this.indexEntry(entry);
		}
	}

	async get(slug: string): Promise<KnowledgeEntry | null> {
		// Serve from cache if available
		if (this.cache) {
			return this.cache.get(slug) ?? null;
		}
		const filePath = join(this.baseDir, `${slug}.json`);
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;
		try {
			return (await file.json()) as KnowledgeEntry;
		} catch (e) {
			console.error(`[MemPalace] failed to read knowledge entry ${slug}: ${e}`);
			return null;
		}
	}

	async list(): Promise<KnowledgeEntry[]> {
		await this.ensureIndexed();
		return Array.from(this.cache!.values());
	}

	async relate(slugA: string, slugB: string, relation: string): Promise<void> {
		const entryA = await this.get(slugA);
		const entryB = await this.get(slugB);

		if (entryA) {
			const rel = `${relation}:${slugB}`;
			if (!entryA.relations.includes(rel)) {
				entryA.relations.push(rel);
				await this.store(
					entryA.slug,
					entryA.content,
					entryA.tags,
					entryA.relations,
				);
			}
		}

		if (entryB) {
			const relInverse = `inverse_${relation}:${slugA}`;
			if (!entryB.relations.includes(relInverse)) {
				entryB.relations.push(relInverse);
				await this.store(
					entryB.slug,
					entryB.content,
					entryB.tags,
					entryB.relations,
				);
			}
		}
	}

	async query(text: string, topK = 3): Promise<KnowledgeEntry[]> {
		await this.ensureIndexed();

		const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
		if (tokens.length === 0) {
			return Array.from(this.cache!.values()).slice(0, topK);
		}

		// Score using the inverted index: only examine entries that share
		// at least one token with the query, instead of scanning everything.
		const candidateScores = new Map<string, number>();

		for (const token of tokens) {
			const slugSet = this.index!.get(token);
			if (!slugSet) continue;

			for (const slug of slugSet) {
				candidateScores.set(slug, (candidateScores.get(slug) ?? 0) + 1);
			}
		}

		if (candidateScores.size === 0) {
			// Fallback: no index hits — do a full scan (rare, but correct)
			return this.fallbackScan(tokens, topK);
		}

		// Score candidates with the same weighting as before, but only
		// over the reduced candidate set.
		const scored: Array<{ entry: KnowledgeEntry; score: number }> = [];
		for (const [slug, tokenOverlap] of candidateScores) {
			const entry = this.cache!.get(slug);
			if (!entry) continue;

			let score = tokenOverlap; // base score from token overlap
			const contentLower = entry.content.toLowerCase();
			const tagsLower = entry.tags.map((t) => t.toLowerCase());

			for (const token of tokens) {
				if (tagsLower.includes(token)) score += 5;
				if (entry.slug.toLowerCase().includes(token)) score += 3;
				// Word-boundary match in content (same as original)
				const matches = (
					contentLower.match(new RegExp(`\\b${token}\\b`, "g")) || []
				).length;
				score += matches;
			}

			scored.push({ entry, score });
		}

		return scored
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((s) => s.entry);
	}

	// --- internal ---

	/** Build the cache + inverted index from disk (idempotent). */
	private async ensureIndexed(): Promise<void> {
		if (this.cache && this.index && !this.indexDirty) return;

		const cache = new Map<string, KnowledgeEntry>();
		const index = new Map<string, Set<string>>();

		if (existsSync(this.baseDir)) {
			const files = readdirSync(this.baseDir).filter((f) =>
				f.endsWith(".json"),
			);
			for (const fileName of files) {
				try {
					const file = Bun.file(join(this.baseDir, fileName));
					const entry = (await file.json()) as KnowledgeEntry;
					cache.set(entry.slug, entry);
					this.indexEntryInto(entry, index);
				} catch {
					// Skip unparseable entry
				}
			}
		}

		this.cache = cache;
		this.index = index;
		this.indexDirty = false;
	}

	/** Add a single entry's tokens to the inverted index (does not mutate this.index). */
	private indexEntryInto(
		entry: KnowledgeEntry,
		index: Map<string, Set<string>>,
	): void {
		const tokens = this.tokenizeEntry(entry);
		for (const token of tokens) {
			let set = index.get(token);
			if (!set) {
				set = new Set();
				index.set(token, set);
			}
			set.add(entry.slug);
		}
	}

	/** Add/update a single entry in the existing inverted index. */
	private indexEntry(entry: KnowledgeEntry): void {
		if (!this.index) return;
		const tokens = this.tokenizeEntry(entry);
		for (const token of tokens) {
			let set = this.index.get(token);
			if (!set) {
				set = new Set();
				this.index.set(token, set);
			}
			set.add(entry.slug);
		}
	}

	/** Extract all searchable tokens from an entry (content + tags + slug). */
	private tokenizeEntry(entry: KnowledgeEntry): Set<string> {
		const tokens = new Set<string>();

		// Content tokens
		for (const t of entry.content.toLowerCase().split(/\W+/).filter(Boolean)) {
			tokens.add(t);
		}
		// Tag tokens
		for (const tag of entry.tags) {
			tokens.add(tag.toLowerCase());
		}
		// Slug tokens
		for (const t of entry.slug.toLowerCase().split(/\W+/).filter(Boolean)) {
			tokens.add(t);
		}

		return tokens;
	}

	/** Fallback full-scan scoring when the index yields no candidates. */
	private fallbackScan(tokens: string[], topK: number): KnowledgeEntry[] {
		const scored: Array<{ entry: KnowledgeEntry; score: number }> = [];

		for (const entry of this.cache!.values()) {
			let score = 0;
			const contentLower = entry.content.toLowerCase();
			const tagsLower = entry.tags.map((t) => t.toLowerCase());

			for (const token of tokens) {
				if (tagsLower.includes(token)) score += 5;
				if (entry.slug.toLowerCase().includes(token)) score += 3;
				const matches = (
					contentLower.match(new RegExp(`\\b${token}\\b`, "g")) || []
				).length;
				score += matches;
			}

			if (score > 0) scored.push({ entry, score });
		}

		return scored
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((s) => s.entry);
	}
}
