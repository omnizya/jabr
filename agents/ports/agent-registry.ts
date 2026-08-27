import type { AgentCard } from "@agents/types";

export interface AgentRegistryPort {
  fetchCard(baseUrl: string): Promise<AgentCard | null>;

  discoverAgents(urls: string[]): Promise<Record<string, AgentCard>>;

  delegateTask(agentUrl: string, text: string): Promise<string>;
}
