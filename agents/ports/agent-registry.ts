import type { AgentCard } from "@agents/types";

export interface AgentRegistryPort {
	fetchCard(baseUrl: string): Promise<AgentCard | null>;

	delegateTask(
		agentUrl: string,
		text: string,
		agentName?: string,
	): Promise<string>;
}

console.log("[AgentRegistryPort] port interface loaded");
