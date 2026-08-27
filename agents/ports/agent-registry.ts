import type { AgentCard } from "../types.ts";

/**
 * Outbound port: discover and communicate with sub-agents.
 * Adapter: HTTP A2A client (fetch + poll).
 */
export interface AgentRegistryPort {
  /** Fetch the Agent Card from a sub-agent's well-known URL. */
  fetchCard(baseUrl: string): Promise<AgentCard | null>;

  /**
   * Discover multiple agents by fetching their Agent Cards in parallel.
   * Returns a map keyed by agent name. Agents whose cards fail to fetch are skipped.
   */
  discoverAgents(urls: string[]): Promise<Record<string, AgentCard>>;

  /** Send a task to a sub-agent and return the response text. */
  delegateTask(agentUrl: string, text: string): Promise<string>;
}
