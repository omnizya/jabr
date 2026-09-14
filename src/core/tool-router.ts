import { delegationInstrumenter, taskMetrics } from "@observability";
import type {
	TaskCompletePayload,
	TaskFailedPayload,
	TaskStartPayload,
} from "@/ports";
import type { TaskStorePort } from "@/ports/task-store";
import type {
	AgentCard,
	ConsensusInput,
	ToolRouterConfig,
	VerificationConfig,
	VerificationResult,
} from "@/types/types";

export type { ConsensusInput };

/** Static agent config — replaces DynamicRegistry for YAGNI routing. */
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

			if (score > 0) {
				if (!bestMatch) {
					bestMatch = { name, url: agent.url, label: agent.card.name, score };
				} else if (score > bestMatch.score) {
					bestMatch = { name, url: agent.url, label: agent.card.name, score };
				} else if (score === bestMatch.score) {
					// Tie-break: weighted scoring (successRate, responseTime, cost)
					const tieA = this.tieBreakScore(agent.card);
					const tieB = this.tieBreakScore(
						this.cfg.agents[bestMatch.name]!.card,
					);
					if (tieA > tieB) {
						bestMatch = { name, url: agent.url, label: agent.card.name, score };
					}
				}
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
		const span = delegationInstrumenter.startDelegationSpan({
			sourceAgent: "orchestrator",
			targetAgent: agentName ?? "unknown",
			textLength: text.length,
		});
		try {
			let result: string;
			if (this.cfg.x402Client) {
				result = await this.cfg.x402Client.delegateTask(
					agentUrl,
					text,
					agentName,
				);
			} else if (this.cfg.registry) {
				result = await this.cfg.registry.delegateTask(
					agentUrl,
					text,
					agentName,
				);
			} else {
				throw new Error(
					"No delegation mechanism configured (need x402Client or registry)",
				);
			}
			delegationInstrumenter.recordSuccess(span, result.length);
			return result;
		} catch (err) {
			delegationInstrumenter.recordError(span, err);
			throw err;
		} finally {
			span.end();
		}
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

	// ---- SHURA verification ----

	/**
	 * Decide whether a task warrants SHURA verification. True when:
	 *   1. Verification is enabled in config.
	 *   2. The task text contains any configured high-stakes keyword.
	 */
	shouldVerifyTask(taskText: string): boolean {
		const v = this.cfg.verification;
		if (!v || !v.enabled) return false;
		const lower = taskText.toLowerCase();
		return v.keywords
			.split(",")
			.map((k) => k.trim().toLowerCase())
			.some((k) => k.length > 0 && lower.includes(k));
	}

	/**
	 * Run SHURA verification on a completed task result. Delegates the task to
	 * the verification agent with a JSON payload containing the specialist's
	 * output, and returns a VerificationResult indicating consensus.
	 */
	async runVerification(
		taskText: string,
		specialistResult: string,
		specialistAgentName: string,
	): Promise<VerificationResult | null> {
		const v = this.cfg.verification;
		if (!v || !v.enabled) return null;

		const cognitiveLoop = this.cfg.cognitiveLoop;
		if (!cognitiveLoop) {
			console.warn(
				"[ToolRouter] verification: cognitiveLoop not configured, skipping",
			);
			return null;
		}

		const inputs: ConsensusInput[] = [];

		// Primary: the specialist that produced the result.
		const specialistCard = await this.getCard(specialistAgentName);
		inputs.push({
			agentName: specialistAgentName,
			card: specialistCard ?? {
				name: specialistAgentName,
				description: "",
				url: "",
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			response: specialistResult,
		});

		// Secondary: delegate the same task to one additional agent for
		// independent cross-check (if a second non-specialist is available).
		const available = this.getAvailableAgentNames().filter(
			(n) => n !== specialistAgentName && n !== v.agentName,
		);
		for (const name of available.slice(0, 1)) {
			try {
				const url = await this.getAgentUrl(name);
				if (!url) continue;
				const card = await this.getCard(name);
				if (!card) continue;
				await this.deductBudget(name, taskText.length);
				const response = await this.delegateTask(url, taskText, name);
				inputs.push({ agentName: name, card, response });
			} catch {
				// skip failed secondary agent
			}
		}

		if (inputs.length < 2) {
			return {
				consensus: true,
				confidence: 0.5,
				winner: specialistAgentName,
				synthesized: specialistResult,
				scores: [
					{
						agentName: specialistAgentName,
						score: 0.5,
						reason: "single-agent result (no peer available)",
					},
				],
				contested: false,
				threshold: v.consensusThreshold,
				participantCount: inputs.length,
			};
		}

		const result = await cognitiveLoop.evaluate(inputs, taskText);
		const topScore = result.scores[0]?.score ?? 0;
		const consensus = topScore >= v.consensusThreshold;

		return {
			consensus,
			confidence: topScore,
			winner: result.winner.agentName,
			synthesized: result.synthesized,
			scores: result.scores,
			contested: !consensus,
			threshold: v.consensusThreshold,
			participantCount: inputs.length,
		};
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

	/**
	 * Compute a weighted tie-break score from agent card metrics.
	 * Higher is better. Used when multiple agents have equal tag scores.
	 *
	 * Weights:
	 *   - successRate: 0.5 (higher is better)
	 *   - responseTime: 0.3 (lower is better, normalized against 5000ms ceiling)
	 *   - cost: 0.2 (lower is better, normalized against 100-cost ceiling)
	 */
	private tieBreakScore(card: AgentCard): number {
		let score = 0;

		// successRate: 0..1 range, higher is better
		const successRate = card.successRate ?? 0.5;
		score += successRate * 0.5;

		// responseTime: normalize against 5000ms ceiling, lower is better
		const responseTime = card.responseTime ?? 2500;
		const rtNormalized = Math.max(0, Math.min(1, 1 - responseTime / 5000));
		score += rtNormalized * 0.3;

		// cost: normalize against 100-costPerTask ceiling, lower is better
		const cost = card.pricing?.costPerTask ?? 50;
		const costNormalized = Math.max(0, Math.min(1, 1 - cost / 100));
		score += costNormalized * 0.2;

		return score;
	}

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
