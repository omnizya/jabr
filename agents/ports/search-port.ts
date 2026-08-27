// ─── Search domain types ───────────────────────────────────────────────────────

/** A single search result returned by a search provider. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Optional relevance score when provided by the upstream API. */
  score?: number;
}

/**
 * Outbound port: gather external knowledge via web search.
 * Adapter: 9Router Web Search HTTP client.
 *
 * Core agents depend on this abstraction rather than making HTTP calls directly,
 * keeping the domain layer free of infrastructure concerns.
 */
export interface SearchPort {
  /** Run a web search and return a list of ranked results. */
  search(query: string): Promise<SearchResult[]>;
}
