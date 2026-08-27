/**
 * Dynamic Agent Registry — replaces hardcoded agentUrls.
 *
 * Responsibilities:
 *  - Fetch and cache Agent Cards from seed URLs
 *  - Build a tag→agent index from AgentSkill.tags
 *  - Match incoming tasks against tags for routing
 *  - Support on-the-fly discovery of new agents
 */

import type { AgentCard } from "../types.ts";
import type { AgentRegistryPort } from "../ports/agent-registry.ts";

interface RegistryEntry {
  url: string;
  card: AgentCard;
  /** Flattened set of all skill tags for this agent */
  tags: string[];
}

export class DynamicRegistry {
  private entries: Map<string, RegistryEntry> = new Map();
  private cardCache: Map<string, AgentCard> = new Map();

  constructor(
    private registry: AgentRegistryPort,
    private seedUrls: Record<string, string> = {},
  ) {}

  /**
   * Discover all seed URLs and build the tag index.
   * Call once at startup. Safe to call again to refresh.
   */
  async initialize(): Promise<void> {
    const urls = Object.values(this.seedUrls);

    // Fetch all cards in parallel
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

  /**
   * Register an additional agent at runtime (e.g. discovered via A2A).
   * Returns true if the agent was newly added, false if already known.
   */
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

  /**
   * Match a task description against agent skill tags.
   * Returns { name, url, label } for the best match, or null.
   *
   * Matching strategy:
   *  1. Exact tag match (highest confidence)
   *  2. Partial tag overlap (fuzzy)
   *  3. Fallback to first registered agent
   */
  matchAgent(taskText: string): { name: string; url: string; label: string } | null {
    const lower = taskText.toLowerCase();
    const words = this.extractKeywords(lower);

    let bestMatch: { name: string; url: string; label: string; score: number } | null = null;

    for (const [name, entry] of this.entries) {
      let score = 0;

      for (const tag of entry.tags) {
        const tagLower = tag.toLowerCase();
        if (lower.includes(tagLower)) {
          score += 2; // exact tag in task text
        }
        for (const word of words) {
          if (tagLower.includes(word) || word.includes(tagLower)) {
            score += 1; // partial overlap
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

    // Fallback: return first agent
    const first = this.entries.values().next().value;
    if (first) {
      const name = this.findNameByUrl(first.url);
      return { name: name ?? "unknown", url: first.url, label: first.card.name };
    }

    return null;
  }

  /**
   * Get the URL for a specific agent by name.
   */
  getUrl(agentName: string): string | undefined {
    return this.entries.get(agentName)?.url;
  }

  /**
   * Get the card for a specific agent by name.
   */
  getCard(agentName: string): AgentCard | undefined {
    return this.entries.get(agentName)?.card;
  }

  /**
   * Get all registered agent names.
   */
  getAgentNames(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Get the full URL map for backwards compatibility.
   */
  toUrlMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [name, entry] of this.entries) {
      map[name] = entry.url;
    }
    return map;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

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
    // Split on non-alphanumeric and filter short/common words
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
