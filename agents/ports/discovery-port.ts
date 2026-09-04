import type { AgentCard } from "@agents/types";

export interface AgentHealth {
	name: string;
	port: number;
	status: "up" | "down";
	lastSeen: string;
}

export interface DiscoveryPort {
	initialize(): Promise<void>;
	addAgent(url: string): Promise<boolean>;
	matchAgent(
		taskText: string,
	): Promise<{ name: string; url: string; label: string } | null>;
	getUrl(agentName: string): Promise<string | undefined>;
	getCard(agentName: string): Promise<AgentCard | undefined>;
	getAgentNames(): Promise<string[]>;
	getAllCards(): Promise<Record<string, AgentCard>>;
	toUrlMap(): Record<string, string>;
	getAgentsHealth(): Promise<AgentHealth[]>;
	ensureReady?(): Promise<void>;
}


