import type { AgentCard } from "../types.ts";

export interface AgentRegistryPort {
  fetchCard(baseUrl: string): Promise<AgentCard | null>;

  discoverAgents(urls: string[]): Promise<Record<string, AgentCard>>;

  delegateTask(agentUrl: string, text: string): Promise<string>;
}
