export interface KnowledgeEntry {
	slug: string;
	content: string;
	tags: string[];
	embedding?: number[];
	createdAt: string;
	relations: string[];
}

export interface KnowledgePort {
	store(
		slug: string,
		content: string,
		tags: string[],
		relations?: string[],
	): Promise<void>;
	query(text: string, topK?: number): Promise<KnowledgeEntry[]>;
	relate(slugA: string, slugB: string, relation: string): Promise<void>;
	get(slug: string): Promise<KnowledgeEntry | null>;
	list(): Promise<KnowledgeEntry[]>;
}

console.log("[KnowledgePort] port interface loaded");
