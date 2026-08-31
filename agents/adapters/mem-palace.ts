import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeEntry, KnowledgePort } from "@ports/knowledge-port";

export class MemPalaceAdapter implements KnowledgePort {
	private baseDir: string;

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
	}

	async get(slug: string): Promise<KnowledgeEntry | null> {
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
		if (!existsSync(this.baseDir)) return [];
		const files = readdirSync(this.baseDir).filter((f) => f.endsWith(".json"));
		const entries: KnowledgeEntry[] = [];
		for (const fileName of files) {
			try {
				const file = Bun.file(join(this.baseDir, fileName));
				entries.push((await file.json()) as KnowledgeEntry);
			} catch {
				// Skip unparseable entry
			}
		}
		return entries;
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
		const all = await this.list();
		if (all.length === 0) return [];

		const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
		if (tokens.length === 0) return all.slice(0, topK);

		// BM25-like / token overlap scoring
		const scored = all.map((entry) => {
			let score = 0;
			const contentLower = entry.content.toLowerCase();
			const tagsLower = entry.tags.map((t) => t.toLowerCase());

			for (const token of tokens) {
				if (tagsLower.includes(token)) {
					score += 5;
				}
				if (entry.slug.toLowerCase().includes(token)) {
					score += 3;
				}
				const matches = (
					contentLower.match(new RegExp(`\\b${token}\\b`, "g")) || []
				).length;
				score += matches;
			}

			return { entry, score };
		});

		return scored
			.filter((s) => s.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((s) => s.entry);
	}
}
