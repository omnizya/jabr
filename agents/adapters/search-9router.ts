import type { SearchPort, SearchResult } from "../ports/search-port.ts";

// ─── 9Router wire format ───────────────────────────────────────────────────────

interface NineRouterSearchRequest {
  model: string;
  query: string;
  max_results?: number;
}

interface NineRouterSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    content?: string;
    score?: number;
  }>;
}

// ─── 9Router search adapter ────────────────────────────────────────────────────

/**
 * Adapter implementing SearchPort against the 9Router Web Search API.
 *
 * Endpoint: POST ${NINEROUTER_URL}/v1/search
 * Auth:     Authorization: Bearer ${NINEROUTER_KEY}
 */
export class Search9Router implements SearchPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxResults: number;

  constructor(opts?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    maxResults?: number;
  }) {
    this.baseUrl = (opts?.baseUrl ?? process.env.NINEROUTER_URL ?? "").replace(/\/$/, "");
    this.apiKey = opts?.apiKey ?? process.env.NINEROUTER_KEY ?? "";
    this.model = opts?.model ?? "search-combo";
    this.maxResults = opts?.maxResults ?? 5;
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.baseUrl || !this.apiKey) {
      console.error("[Search9Router] missing NINEROUTER_URL or NINEROUTER_KEY");
      return [];
    }

    const body: NineRouterSearchRequest = {
      model: this.model,
      query,
      max_results: this.maxResults,
    };

    try {
      const res = await fetch(`${this.baseUrl}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[Search9Router] search failed: ${res.status} ${res.statusText}`);
        return [];
      }

      const data = (await res.json()) as NineRouterSearchResponse;
      const raw = data.results ?? [];

      return raw
        .filter((r) => r.url)
        .map((r) => ({
          title: r.title ?? r.url ?? "",
          url: r.url ?? "",
          snippet: r.snippet ?? r.content ?? "",
          score: r.score,
        }));
    } catch (err) {
      console.error(`[Search9Router] search error:`, err);
      return [];
    }
  }
}
