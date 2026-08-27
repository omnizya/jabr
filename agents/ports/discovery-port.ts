import type { AgentCard } from "@agents/types";

export interface DiscoveryPort {
  initialize(): Promise<void>;
  addAgent(url: string): Promise<boolean>;
  matchAgent(taskText: string): { name: string; url: string; label: string } | null;
  getUrl(agentName: string): string | undefined;
  getCard(agentName: string): AgentCard | undefined;
  getAgentNames(): string[];
  getAllCards(): Record<string, AgentCard>;
  toUrlMap(): Record<string, string>;
}
