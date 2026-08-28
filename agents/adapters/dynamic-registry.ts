import type { AgentCard, RegistryEntry } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { DiscoveryPort } from "@ports/discovery-port";

export class DynamicRegistry implements DiscoveryPort {
  private entries: Map<string, RegistryEntry> = new Map();
  private cardCache: Map<string, AgentCard> = new Map();
  private initialized = false;

  constructor(
    private registry: AgentRegistryPort,
    private seedUrls: Record<string, string> = {},
  ) { }

  async initialize(): Promise<void> {
    await this.ensureReady();
  }

  private async discover(): Promise<void> {
    this.entries.clear();
    this.cardCache.clear();

    for (const [name, url] of Object.entries(this.seedUrls)) {
      const card = await this.registry.fetchCard(url);
      if (!card) continue;

      const tags = this.extractTags(card);
      this.entries.set(name, { url, card, tags });
      this.cardCache.set(url, card);
    }

    if (this.entries.size > 0) {
      console.log(
        `[DynamicRegistry] Initialized with ${this.entries.size} agents:`,
        [...this.entries.keys()].join(", "),
      );
    }
  }

  async ensureReady(): Promise<void> {
    if (this.entries.size > 0) return;
    await this.discoverWithRetry();
  }

  private async discoverWithRetry(maxAttempts = 30, intervalMs = 1000): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.discover();
      if (this.entries.size > 0) {
        console.log(`[DynamicRegistry] Agents ready after ${attempt + 1} attempt(s)`);
        return;
      }
      console.log(`[DynamicRegistry] Waiting for agents (attempt ${attempt + 1}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    console.warn("[DynamicRegistry] No agents discovered after retries");
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

  async getAgentsHealth(): Promise<Array<{name: string, status: "up" | "down", port: number, lastSeen: string}>> {
    await this.ensureReady();
    const health: Array<{name: string, status: "up" | "down", port: number, lastSeen: string}> = [];
    for (const [name, entry] of this.entries) {
      try {
        const url = new URL(entry.url);
        const res = await fetch(`${entry.url}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(2000) });
        const status: "up" | "down" = res.ok ? "up" : "down";
        health.push({
          name,
          status,
          port: url.port ? parseInt(url.port) : 80,
          lastSeen: new Date().toISOString(),
        });
      } catch {
        health.push({
          name,
          status: "down",
          port: 0,
          lastSeen: new Date().toISOString(),
        });
      }
    }
    return health;
  }

  async matchAgent(taskText: string): Promise<{ name: string; url: string; label: string } | null> {
    await this.ensureReady();
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

  async getUrl(agentName: string): Promise<string | undefined> {
    await this.ensureReady();
    return this.entries.get(agentName)?.url;
  }

  async getCard(agentName: string): Promise<AgentCard | undefined> {
    await this.ensureReady();
    return this.entries.get(agentName)?.card;
  }

  async getAgentNames(): Promise<string[]> {
    await this.ensureReady();
    return [...this.entries.keys()];
  }

  async getAllCards(): Promise<Record<string, AgentCard>> {
    await this.ensureReady();
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
