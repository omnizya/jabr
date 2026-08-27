import type { AgentCard, RegistryEntry } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { DiscoveryPort } from "@ports/discovery-port";


export class DynamicRegistry implements DiscoveryPort {
  private entries: Map<string, RegistryEntry> = new Map();
  private cardCache: Map<string, AgentCard> = new Map();

  constructor(
    private registry: AgentRegistryPort,
    private seedUrls: Record<string, string> = {},
  ) { }

  async initialize(): Promise<void> {
    const urls = Object.values(this.seedUrls);

    const cards = await this.registry.discoverAgents(urls);

    for (const [name, card] of Object.entries(cards)) {
      const url = this.seedUrls[name] ?? "";
      if (!url) continue;

      const tags = this.extractTags(card);
      this.entries.set(name, { url, card, tags });
      this.cardCache.set(url, card);
    }

    console.log(
      `[DynamicRegistry] Initialized with ${this.entries.size} agents:`,
      [...this.entries.keys()].join(", "),
    );
  }

  async addAgent(url: string): Promise<boolean> {
    if (this.cardCache.has(url)) return false;

    const card = await this.registry.fetchCard(url);
    if (!card) return false;

    if (this.entries.has(card.name)) return false;

    const tags = this.extractTags(card);
    this.entries.set(card.name, { url, card, tags });
    this.cardCache.set(url, card);

    console.log(`[DynamicRegistry] Discovered new agent: ${card.name} at ${url}`);
    return true;
  }

  async getAgentsHealth(): Promise<Array<{name: string, status: any, port: number, skills: string[]}>> {
    const health = [];
    for (const [name, entry] of this.entries) {
      try {
        const url = new URL(entry.url);
        const res = await fetch(`${entry.url}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(2000) });
        const status = res.ok ? "online" : "offline";
        health.push({
          name,
          status,
          port: url.port ? parseInt(url.port) : 80,
          skills: entry.tags,
        });
      } catch {
        health.push({
          name,
          status: "offline",
          port: 0,
          skills: entry.tags,
        });
      }
    }
    return health;
  }

  matchAgent(taskText: string): { name: string; url: string; label: string } | null {
    const lower = taskText.toLowerCase();
    const words = this.extractKeywords(lower);

    let bestMatch: { name: string; url: string; label: string; score: number } | null = null;

    for (const [name, entry] of this.entries) {
      let score = 0;

      for (const tag of entry.tags) {
        const tagLower = tag.toLowerCase();
        if (lower.includes(tagLower)) {
          score += 2;
        }
        for (const word of words) {
          if (tagLower.includes(word) || word.includes(tagLower)) {
            score += 1;
          }
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          name,
          url: entry.url,
          label: entry.card.name,
          score,
        };
      }
    }

    if (bestMatch) {
      return { name: bestMatch.name, url: bestMatch.url, label: bestMatch.label };
    }

    const first = this.entries.values().next().value;
    if (first) {
      const name = this.findNameByUrl(first.url);
      return { name: name ?? "unknown", url: first.url, label: first.card.name };
    }

    return null;
  }

  getUrl(agentName: string): string | undefined {
    return this.entries.get(agentName)?.url;
  }

  getCard(agentName: string): AgentCard | undefined {
    return this.entries.get(agentName)?.card;
  }

  getAgentNames(): string[] {
    return [...this.entries.keys()];
  }

  getAllCards(): Record<string, AgentCard> {
    const cards: Record<string, AgentCard> = {};
    for (const [name, entry] of this.entries) {
      cards[name] = entry.card;
    }
    return cards;
  }

  toUrlMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [name, entry] of this.entries) {
      map[name] = entry.url;
    }
    return map;
  }

  private extractTags(card: AgentCard): string[] {
    const tags: string[] = [];
    for (const skill of card.skills) {
      for (const tag of skill.tags) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
    return tags;
  }

  private extractKeywords(text: string): string[] {
    const stop = new Set(["the", "a", "an", "is", "are", "was", "be", "to", "of", "in", "for", "and", "or", "it", "that", "this"]);
    return text
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !stop.has(w));
  }

  private findNameByUrl(url: string): string | undefined {
    for (const [name, entry] of this.entries) {
      if (entry.url === url) return name;
    }
    return undefined;
  }
}
