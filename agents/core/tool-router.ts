import { X402Client } from "@adapters/x402/x402-client";
import type { A2AMessage, AgentCard, HandoverRequest } from "@agents/types";
import { decodeHandover } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { BudgetPort } from "@ports/budget-port";
import type { KanbanPort } from "@ports/kanban-port";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { MemoryStorePort } from "@ports/memory-store";
import type {
	DomainEventBus,
	TaskCompletePayload,
	TaskFailedPayload,
	TaskStartPayload,
} from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import type { TaskStorePort } from "@ports/task-store";
import { CognitiveLoop, type ConsensusInput } from "./cognitive-loop.ts";

export const MAX_HANDOVER_DEPTH = 3;
export type { ConsensusInput };

/** Static agent config — replaces DynamicRegistry for YAGNI routing. */
export interface AgentConfig {
	name: string;
	url: string;
	card: AgentCard;
}

export interface ToolRouterConfig {
	agents: Record<string, AgentConfig>;
	registry?: AgentRegistryPort;
	x402Client?: X402Client;
	budget?: BudgetPort;
	cognitiveLoop?: CognitiveLoop;
	memory?: MemoryStorePort;
	knowledge?: KnowledgePort;
	kanban?: KanbanPort;
	realtime?: RealtimePort;
	pluginEventBus?: DomainEventBus;
}

/**
 * ToolRouter — standalone module for tool lookup and routing.
 *
 * Accepts a static agent config map for routing/URL/card lookups. No dependency
 * on a Registry interface — the registry is only used for delegation fallback.
 */
export class ToolRouter {
	constructor(public cfg: ToolRouterConfig) {}

	// ---- Routing (keyword-based, from static agent config) ----

	async routeTask(
		text: string,
	): Promise<{ agentName: string; label: string } | null> {
		const lower = text.toLowerCase();
		const words = this.extractKeywords(lower);

		let bestMatch: {
			name: string;
			url: string;
			label: string;
			score: number;
		} | null = null;

		for (const [name, agent] of Object.entries(this.cfg.agents)) {
			let score = 0;
			const tags = this.extractTags(agent.card);

			for (const tag of tags) {
				const tagLower = tag.toLowerCase();
				if (words.includes(tagLower)) {
					score += 3;
				} else if (lower.includes(tagLower)) {
					score += 1;
				}
				for (const word of words) {
					if (tagLower.includes(word) || word.includes(tagLower)) {
						score += 1;
					}
				}
			}

			if (score > 0 && (!bestMatch || score > bestMatch.score)) {
				bestMatch = { name, url: agent.url, label: agent.card.name, score };
			}
		}

		if (bestMatch) {
			return { agentName: bestMatch.name, label: bestMatch.label };
		}

		const first = Object.values(this.cfg.agents)[0];
		if (first) {
			return { agentName: first.name, label: first.card.name };
		}

		return null;
	}

	// ---- URL resolution ----

	async getAgentUrl(agentName: string): Promise<string | undefined> {
		return this.cfg.agents[agentName]?.url;
	}

	// ---- Card lookup (for pricing) ----

	async getCard(agentName: string): Promise<AgentCard | undefined> {
		return this.cfg.agents[agentName]?.card;
	}

	// ---- Available agent names ----

	getAvailableAgentNames(): string[] {
		return Object.keys(this.cfg.agents);
	}

	// ---- Delegation (single-agent) ----

	async delegateTask(
		agentUrl: string,
		text: string,
		agentName?: string,
	): Promise<string> {
		if (this.cfg.x402Client) {
			return this.cfg.x402Client.delegateTask(agentUrl, text, agentName);
		}
		if (this.cfg.registry) {
			return this.cfg.registry.delegateTask(agentUrl, text, agentName);
		}
		throw new Error(
			"No delegation mechanism configured (need x402Client or registry)",
		);
	}

	// ---- Budget deduction (pre-delegation) ----

	async deductBudget(agentName: string, textLength: number): Promise<void> {
		const budget = this.cfg.budget;
		if (!budget) return;

		const card = await this.getCard(agentName);
		if (!card?.pricing) return;

		const costPerTask = card.pricing.costPerTask;
		const costPerToken = card.pricing.costPerToken ?? 0;
		const costTokens =
			costPerTask + costPerToken * Math.max(1, Math.ceil(textLength / 4));
		await budget.consume(agentName, costTokens);

		const mem = this.cfg.memory;
		if (mem) {
			mem.append(
				`[budget] Deducted ${costTokens} tokens from ${agentName} (pricing=${JSON.stringify(card.pricing)})`,
			);
		}
	}

	// ---- Multi-agent consensus ----

	async delegateToMultiple(
		agentNames: string[],
		userText: string,
	): Promise<ConsensusInput[]> {
		const tasks = agentNames
			.filter((name) => name !== "orchestrator")
			.map(async (name) => {
				const url = await this.getAgentUrl(name);
				if (!url) return null;
				try {
					await this.deductBudget(name, userText.length);
					const response = await this.delegateTask(url, userText, name);
					const card = await this.getCard(name);
					if (!card) return null;
					return { agentName: name, card, response } satisfies ConsensusInput;
				} catch {
					return null;
				}
			});

		const results = await Promise.all(tasks);
		return results.filter((r): r is ConsensusInput => r !== null);
	}

	async executeConsensus(
		userText: string,
		agentNames?: string[],
	): Promise<string> {
		const available = this.getAvailableAgentNames();
		const participants =
			agentNames && agentNames.length > 0
				? available.filter((name) => agentNames.includes(name))
				: available;

		if (participants.length < 2) {
			const agentName = participants[0] ?? "librarian";
			const url = await this.getAgentUrl(agentName);
			if (!url) return "No agents available for consensus";
			await this.deductBudget(agentName, userText.length);
			return this.delegateTask(url, userText, agentName);
		}

		const mem = this.cfg.memory;
		if (mem) {
			mem.append(`[consensus] Delegating to ${participants.length} agents`);
		}

		const inputs = await this.delegateToMultiple(participants, userText);

		if (inputs.length === 0) return "No agents responded";

		const cognitiveLoop = this.cfg.cognitiveLoop;
		if (!cognitiveLoop) {
			return inputs[0]?.response ?? "No agents responded";
		}

		const result = await cognitiveLoop.evaluate(inputs, userText);
		const topScore = result.scores[0]?.score.toFixed(3) ?? "N/A";
		if (mem) {
			mem.append(
				`[consensus] Winner: ${result.winner.agentName} (score: ${topScore})`,
			);
		}

		return result.synthesized;
	}

	// ---- World state ----

	async getWorldState(): Promise<Record<string, unknown>> {
		const root = process.cwd();
		const memoryDir = `${root}/memory`;
		const skillsDir = `${root}/skills`;

		let lastUpdated: string | undefined;
		let skillTotal = 0;
		let recentSlugs: string[] = [];

		try {
			const fs = await import("fs");
			const memPath = `${memoryDir}/orchestrator.md`;
			if (fs.existsSync(memPath)) {
				lastUpdated = fs.statSync(memPath).mtime.toISOString();
			}

			if (fs.existsSync(skillsDir)) {
				const skillFiles = fs
					.readdirSync(skillsDir)
					.filter((f) => f.endsWith(".json"));
				skillTotal = skillFiles.length;
				recentSlugs = skillFiles
					.map((f) => f.replace(".json", ""))
					.reverse()
					.slice(0, 5);
			}
		} catch {
			// Filesystem access failed — report empty stats.
		}

		return {
			timestamp: new Date().toISOString(),
			agents: [],
			tasks: {},
			memory: { totalEntries: lastUpdated ? 1 : 0, lastUpdated },
			skills: { total: skillTotal, recentSlugs },
		};
	}

	// ---- Kanban sync ----

	async syncToKanban(
		taskStore: TaskStorePort,
		taskId: string,
		result: string,
	): Promise<void> {
		const kanban = this.cfg.kanban;
		if (!kanban) return;
		try {
			const task = taskStore.get(taskId);
			if (!task) return;
			const title =
				task.messages
					.find((m) => m.role === "user")
					?.parts.find((p) => p.kind === "text")?.text ?? "Jabr task";
			await kanban.createTask(`[Jabr] ${title.slice(0, 80)}`, {
				body: `Task ID: ${taskId}\nResult: ${result.slice(0, 500)}`,
			});
		} catch (err) {
			console.error("[ToolRouter] Kanban sync failed:", err);
		}
	}

	// ---- Realtime lifecycle emissions ----

	private emitToRoom(taskId: string, event: any): void {
		const realtime = this.cfg.realtime;
		if (!realtime) return;
		realtime.emitTo(`task-${taskId}`, event);
	}

	emitTaskCreated(
		taskId: string,
		agent: string,
		extra?: { title?: string; priority?: number; parentTaskIds?: string[] },
	): void {
		this.emitToRoom(taskId, { type: "task:created", taskId, agent });

		const bus = this.cfg.pluginEventBus;
		if (!bus) return;
		const now = new Date().toISOString();
		const payload: TaskStartPayload = {
			taskId,
			title: extra?.title ?? "",
			assignee: agent,
			priority: extra?.priority ?? 0,
			startedAt: now,
			parentTaskIds: extra?.parentTaskIds,
		};
		bus.emit("onTaskStart", payload);
	}

	emitTaskProgress(taskId: string, percent: number, message: string): void {
		this.emitToRoom(taskId, {
			type: "task:progress",
			taskId,
			percent,
			message,
		});
	}

	emitTaskCompleted(
		taskId: string,
		result: unknown,
		extra?: {
			startedAt?: string;
			title?: string;
			assignee?: string;
			priority?: number;
		},
	): void {
		this.emitToRoom(taskId, { type: "task:completed", taskId, result });

		const bus = this.cfg.pluginEventBus;
		if (!bus) return;
		const now = new Date().toISOString();
		const startedAt = extra?.startedAt ?? now;
		const durationMs = Date.parse(now) - Date.parse(startedAt);
		const payload: TaskCompletePayload = {
			taskId,
			title: extra?.title ?? "",
			assignee: extra?.assignee ?? "",
			priority: extra?.priority ?? 0,
			startedAt,
			completedAt: now,
			durationMs,
			summary: typeof result === "string" ? result : undefined,
		};
		bus.emit("onTaskComplete", payload);
	}

	emitTaskFailed(
		taskId: string,
		error: string,
		extra?: {
			startedAt?: string;
			title?: string;
			assignee?: string;
			priority?: number;
			retryable?: boolean;
			retryCount?: number;
		},
	): void {
		this.emitToRoom(taskId, { type: "task:failed", taskId, error });

		const bus = this.cfg.pluginEventBus;
		if (!bus) return;
		const now = new Date().toISOString();
		const startedAt = extra?.startedAt ?? now;
		const durationMs = Date.parse(now) - Date.parse(startedAt);
		const payload: TaskFailedPayload = {
			taskId,
			title: extra?.title ?? "",
			assignee: extra?.assignee ?? "",
			priority: extra?.priority ?? 0,
			startedAt,
			failedAt: now,
			durationMs,
			error: { message: error },
			retryable: extra?.retryable ?? false,
			retryCount: extra?.retryCount ?? 0,
		};
		bus.emit("onTaskFailed", payload);
	}

	// ---- helpers ----

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
		const stop = new Set([
			"the",
			"a",
			"an",
			"is",
			"are",
			"was",
			"be",
			"to",
			"of",
			"in",
			"for",
			"and",
			"or",
			"it",
			"that",
			"this",
		]);
		return text.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
	}
}
