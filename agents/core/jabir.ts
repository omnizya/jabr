import type {
	A2AMessage,
	AgentCard,
	HandoverRequest,
	ResolvedCaller,
} from "@agents/types";
import { decodeHandover } from "@agents/types";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { MemoryStorePort } from "@ports/memory-store";
import type { TaskStorePort } from "@ports/task-store";
import { MAX_HANDOVER_DEPTH, ToolRouter } from "./tool-router.ts";

export const JABIR_CARD: AgentCard = {
	name: "JABIR",
	description:
		"JABIR (جابر) — Alchemical Operator. Hermes-style orchestrator. Discovers agents, routes tasks, persists memory, writes skills.",
	url: "",
	version: "1.0.0",
	capabilities: { streaming: false, pushNotifications: false },
	skills: [
		{
			name: "Route task",
			description:
				"Classifies and delegates any task to the best specialist agent",
			tags: ["routing", "delegation", "orchestration"],
			inputModes: ["text"],
			outputModes: ["text"],
		},
		{
			name: "Discover agents",
			description: "Fetches Agent Cards from known sub-agents",
			tags: ["discovery", "agent-card", "registry"],
			inputModes: ["text"],
			outputModes: ["data"],
		},
	],
	pricing: { costPerTask: 10 },
};

export const ORCHESTRATOR_CARD = JABIR_CARD;

/**
 * JabirAgent — the task lifecycle manager (formerly OrchestratorAgent).
 *
 * Accepts a pre-built ToolRouter for all routing/delegation/consensus/noise,
 * plus the taskStore and memory for state management. Keeps only the
 * handover-chain execution loop.
 */
export class JabirAgent {
	constructor(
		private toolRouter: ToolRouter,
		private taskStore: TaskStorePort,
		private memory: MemoryStorePort,
	) {}

	get card(): AgentCard {
		return JABIR_CARD;
	}

	async getWorldState(): Promise<any> {
		return this.toolRouter.getWorldState();
	}

	// ---- Task entry point ----

	async execute(
		taskId: string,
		userText: string,
		caller?: ResolvedCaller,
	): Promise<void> {
		return this.executeWithDepth(taskId, userText, 0, caller);
	}

	// ---- Main execution loop (orchestrator-owned: handover chain + task lifecycle) ----

	private async executeWithDepth(
		taskId: string,
		userText: string,
		depth: number,
		caller?: ResolvedCaller,
		referenceTaskIds: string[] = [],
		forcedAgentName?: string,
		taskMeta?: {
			title?: string;
			assignee?: string;
			priority?: number;
			startedAt?: string;
			retryCount?: number;
		},
	): Promise<void> {
		const assignee = taskMeta?.assignee ?? "JABIR";
		this.toolRouter.emitTaskCreated(taskId, assignee, {
			title: taskMeta?.title ?? userText.slice(0, 80),
			priority: taskMeta?.priority ?? 0,
			parentTaskIds: referenceTaskIds.length > 0 ? referenceTaskIds : undefined,
		});

		try {
			this.taskStore.updateState(taskId, "working");
			this.toolRouter.emitTaskProgress(taskId, 5, "queued");

			// Knowledge augmentation: only at depth 0 (if knowledge port configured).
			let augmentedText = userText;
			const knowledge = this.toolRouter.cfg.knowledge;
			if (knowledge && depth === 0) {
				try {
					const palaceContext = await knowledge.query(userText, 3);
					if (palaceContext.length > 0) {
						const contextSummary = palaceContext
							.map((c) => `[Palace Knowledge: ${c.slug}]\n${c.content}`)
							.join("\n\n");
						augmentedText = `${contextSummary}\n\nUser Task: ${userText}`;
						this.memory.append(
							`[palace] Augmented query with ${palaceContext.length} knowledge entries`,
						);
					}
				} catch (e) {
					console.error("Palace query error:", e);
				}
			}

			// Route to an agent (or use forcedAgentName from handover).
			const routed = forcedAgentName
				? { agentName: forcedAgentName, label: forcedAgentName }
				: await this.toolRouter.routeTask(userText);
			if (!routed) {
				throw new Error("No agents discovered — cannot route task");
			}
			const { agentName, label } = routed;

			// --- ACL enforcement: caller must be allowed to invoke the routed agent ---
			if (caller && caller.allowedAgents.length > 0) {
				if (!caller.allowedAgents.includes(agentName)) {
					const msg = `Caller "${caller.description}" is not authorized to invoke agent "${agentName}" (allowed: [${caller.allowedAgents.join(", ")}])`;
					this.memory.append(`[acl] DENIED: ${msg}`);
					throw new Error(msg);
				}
			}

			this.memory.append(
				`[depth=${depth}] Routed "${userText.slice(0, 60)}" to ${label}${caller ? ` (caller: ${caller.description})` : ""}`,
			);

			const agentUrl = await this.toolRouter.getAgentUrl(agentName);
			if (!agentUrl)
				throw new Error(`No URL configured for agent: ${agentName}`);

			// Deduct per-agent pricing from the target's budget before delegation.
			const budget = this.toolRouter.cfg.budget;
			if (budget) {
				const card = await this.toolRouter.getCard(agentName);
				if (card?.pricing) {
					const costPerTask = card.pricing.costPerTask;
					const costPerToken = card.pricing.costPerToken ?? 0;
					const costTokens =
						costPerTask +
						costPerToken * Math.max(1, Math.ceil(augmentedText.length / 4));
					await budget.consume(agentName, costTokens);
					this.memory.append(
						`[depth=${depth}] Budget: deducted ${costTokens} tokens from ${agentName} (pricing=${JSON.stringify(card.pricing)})`,
					);
				}
			}

			let result = await this.toolRouter.delegateTask(
				agentUrl,
				augmentedText,
				agentName,
			);

			const handover = decodeHandover(result);

			if (handover && depth < MAX_HANDOVER_DEPTH) {
				this.memory.append(
					`[depth=${depth}] Handover detected: ${agentName} → ${handover.transferTo} (${handover.reason})`,
				);

				this.taskStore.appendMessage(taskId, {
					messageId: crypto.randomUUID(),
					role: "agent",
					kind: "message",
					parts: [
						{
							kind: "text",
							text: result.replace(/%%HANDOVER%%.*$/, "").trim(),
						},
					],
					contextId: taskId,
				} as A2AMessage);

				const childTaskId = crypto.randomUUID();
				this.taskStore.create(childTaskId);
				this.taskStore.updateState(taskId, "working");

				const childUserText = handover.context || userText;

				// Honor the explicit transferTo target when resolvable; otherwise fall back
				// to registry re-routing (the context text may route better on its own).
				let childForcedAgentName: string | undefined;
				if (handover.transferTo) {
					const targetUrl = await this.toolRouter.getAgentUrl(
						handover.transferTo,
					);
					if (targetUrl) {
						childForcedAgentName = handover.transferTo;
					} else {
						this.memory.append(
							`[depth=${depth}] Handover target "${handover.transferTo}" not resolvable — re-routing via registry`,
						);
					}
				}
				this.taskStore.appendMessage(childTaskId, {
					messageId: crypto.randomUUID(),
					role: "user",
					kind: "message",
					parts: [{ kind: "text", text: childUserText }],
					contextId: childTaskId,
					referenceTaskIds: [taskId, ...referenceTaskIds],
				} as A2AMessage);

				await this.executeWithDepth(
					childTaskId,
					childUserText,
					depth + 1,
					caller,
					[taskId, ...referenceTaskIds],
					childForcedAgentName,
					{
						title: taskMeta?.title ?? userText.slice(0, 80),
						assignee: childForcedAgentName ?? assignee,
						priority: taskMeta?.priority ?? 0,
						startedAt: taskMeta?.startedAt,
						retryCount: taskMeta?.retryCount ?? 0,
					},
				);

				const childTask = this.taskStore.get(childTaskId);
				const childResult =
					childTask?.messages
						.filter((m) => m.role === "agent")
						.map((m) =>
							m.parts
								.filter((p) => p.kind === "text")
								.map((p) => p.text)
								.join(""),
						)
						.join("\n") ?? "";

				this.taskStore.updateState(taskId, "completed");
				this.taskStore.appendMessage(taskId, {
					messageId: crypto.randomUUID(),
					role: "agent",
					kind: "message",
					parts: [{ kind: "text", text: childResult }],
					contextId: taskId,
					referenceTaskIds: [childTaskId],
				} as A2AMessage);
				this.memory.append(
					`[depth=${depth}] Handover chain completed. Result length: ${childResult.length} chars`,
				);
				this.toolRouter.emitTaskCompleted(taskId, childResult, {
					startedAt: taskMeta?.startedAt,
					title: taskMeta?.title ?? userText.slice(0, 80),
					assignee,
					priority: taskMeta?.priority ?? 0,
				});
				return;
			}

			if (handover && depth >= MAX_HANDOVER_DEPTH) {
				this.memory.append(
					`[depth=${depth}] Max handover depth (${MAX_HANDOVER_DEPTH}) reached. Completing with available result.`,
				);
				result = result.replace(/%%HANDOVER%%.*$/, "").trim() || result;
			}

			this.taskStore.updateState(taskId, "completed");
			this.taskStore.appendMessage(taskId, {
				messageId: crypto.randomUUID(),
				role: "agent",
				kind: "message",
				parts: [{ kind: "text", text: result }],
				contextId: taskId,
			} as A2AMessage);
			this.memory.append(
				`Completed task. Result length: ${result.length} chars`,
			);

			this.toolRouter.emitTaskCompleted(taskId, result, {
				startedAt: taskMeta?.startedAt,
				title: taskMeta?.title ?? userText.slice(0, 80),
				assignee,
				priority: taskMeta?.priority ?? 0,
			});

			await this.toolRouter.syncToKanban(this.taskStore, taskId, result);
		} catch (e) {
			this.taskStore.updateState(taskId, "failed");
			this.taskStore.appendMessage(taskId, {
				messageId: crypto.randomUUID(),
				role: "agent",
				kind: "message",
				parts: [{ kind: "text", text: `Error: ${String(e)}` }],
				contextId: taskId,
			} as A2AMessage);

			const isTimeout = /timeout/i.test(String(e));
			const isCancellation = /cancel/i.test(String(e));
			this.toolRouter.emitTaskFailed(taskId, String(e), {
				startedAt: taskMeta?.startedAt,
				title: taskMeta?.title ?? userText.slice(0, 80),
				assignee,
				priority: taskMeta?.priority ?? 0,
				retryable: isTimeout && !isCancellation,
				retryCount: taskMeta?.retryCount ?? 0,
			});
		}
	}
}

export { JabirAgent as OrchestratorAgent };
