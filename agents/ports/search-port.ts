export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export interface SearchPort {
  search(query: string): Promise<SearchResult[]>;
}
