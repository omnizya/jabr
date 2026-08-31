import type { A2AMessage, AgentCard } from "@agents/types";
import type { LlmPort } from "@ports/llm-port";
import type { SkillStorePort } from "@ports/skill-store";
import type { TaskStorePort } from "@ports/task-store";
import { CognitiveLoop, type ConsensusInput } from "./cognitive-loop.ts";

export const VERIFICATION_CARD: AgentCard = {
	name: "SHURA",
	description:
		"SHURA (الشورى) — The Council. Independent verification agent. Cross-checks outputs from multiple agents and applies consensus thresholds for contested results.",
	url: "",
	version: "1.0.0",
	capabilities: {
		streaming: false,
		pushNotifications: false,
		stateTransitionHistory: true,
	},
	securitySchemes: {},
	securityRequirements: [],
	skills: [
		{
			name: "Cross-check outputs",
			description: "Compare outputs from multiple agents for consistency",
			tags: ["verify", "cross-check", "consensus", "audit"],
			inputModes: ["text"],
			outputModes: ["text"],
		},
		{
			name: "Consensus scoring",
			description: "Score and synthesize multi-agent responses with threshold",
			tags: ["consensus", "score", "synthesize", "threshold"],
			inputModes: ["text"],
			outputModes: ["text"],
		},
		{
			name: "Contested result detection",
			description: "Flag results where no agent meets the consensus threshold",
			tags: ["contested", "disagreement", "flag", "review"],
			inputModes: ["text"],
			outputModes: ["text"],
		},
	],
	pricing: { costPerTask: 10 },
};

export interface VerificationResult {
	/** Whether the top response met the consensus threshold. */
	consensus: boolean;
	/** The confidence score of the winning response (0-1). */
	confidence: number;
	/** Name of the winning agent. */
	winner: string;
	/** The synthesized final response. */
	synthesized: string;
	/** Score breakdown for all participants. */
	scores: Array<{ agentName: string; score: number; reason: string }>;
	/** True when no agent met the consensus threshold — result is contested. */
	contested: boolean;
	/** The threshold that was applied. */
	threshold: number;
	/** Number of agents that participated. */
	participantCount: number;
}

export interface VerificationConfig {
	/** Minimum score (0-1) for the top response to be accepted as consensus. */
	consensusThreshold: number;
	/** Minimum number of agents required to attempt verification. */
	minAgents: number;
}

const DEFAULT_CONFIG: VerificationConfig = {
	consensusThreshold: 0.7,
	minAgents: 2,
};

/**
 * VerificationAgent — independent cross-checking agent.
 *
 * Wraps CognitiveLoop with a configurable consensus threshold. When the
 * top-scoring response meets or exceeds the threshold, the result is
 * considered verified. Otherwise it is flagged as contested and surfaced
 * for human review.
 *
 * Inputs are provided as a JSON payload in the task text:
 * ```json
 * {
 *   "task": "original task text",
 *   "inputs": [
 *     { "agentName": "oracle", "card": {...}, "response": "..." },
 *     { "agentName": "librarian", "card": {...}, "response": "..." }
 *   ]
 * }
 * ```
 */
export class VerificationAgent {
	private cognitiveLoop: CognitiveLoop;
	private config: VerificationConfig;

	constructor(
		private taskStore: TaskStorePort,
		private skillStore: SkillStorePort,
		private llm?: LlmPort,
		config?: Partial<VerificationConfig>,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.cognitiveLoop = new CognitiveLoop(
			{
				minAgents: this.config.minAgents,
				confidenceThreshold: this.config.consensusThreshold,
			},
			llm,
		);
	}

	get card(): AgentCard {
		return VERIFICATION_CARD;
	}

	/**
	 * Cross-check multiple agent outputs and apply the consensus threshold.
	 *
	 * @param inputs — the agent responses to verify
	 * @param taskText — the original task text for relevance scoring
	 * @returns VerificationResult with consensus status and synthesized output
	 */
	async verify(
		inputs: ConsensusInput[],
		taskText: string,
	): Promise<VerificationResult> {
		if (inputs.length < this.config.minAgents) {
			return {
				consensus: false,
				confidence: 0,
				winner: "",
				synthesized: `Insufficient agents for verification: ${inputs.length} provided, ${this.config.minAgents} required.`,
				scores: [],
				contested: true,
				threshold: this.config.consensusThreshold,
				participantCount: inputs.length,
			};
		}

		const result = await this.cognitiveLoop.evaluate(inputs, taskText);
		const topScore = result.scores[0]?.score ?? 0;
		const consensus = topScore >= this.config.consensusThreshold;

		return {
			consensus,
			confidence: topScore,
			winner: result.winner.agentName,
			synthesized: result.synthesized,
			scores: result.scores,
			contested: !consensus,
			threshold: this.config.consensusThreshold,
			participantCount: inputs.length,
		};
	}

	/**
	 * A2A execute entry point. Parses JSON inputs from task text and runs
	 * verification. Writes the result (or an error/help message) to taskStore.
	 */
	async execute(taskId: string, userText: string): Promise<void> {
		let inputs: ConsensusInput[] = [];
		let taskText = userText;

		try {
			const parsed = JSON.parse(userText);
			if (parsed.inputs && Array.isArray(parsed.inputs)) {
				inputs = parsed.inputs;
				taskText = parsed.task || userText;
			}
		} catch {
			// Not JSON — fall through to the "no inputs" response.
		}

		if (inputs.length === 0) {
			this.taskStore.updateState(taskId, "completed");
			this.taskStore.appendMessage(taskId, {
				messageId: crypto.randomUUID(),
				role: "agent",
				kind: "message",
				parts: [
					{
						kind: "text",
						text: [
							"## Verification Agent — No Inputs",
							"",
							"Provide a JSON payload with agent outputs to cross-check:",
							"",
							"```json",
							"{",
							'  "task": "original task text",',
							'  "inputs": [',
							'    { "agentName": "...", "card": {...}, "response": "..." }',
							"  ]",
							"}",
							"```",
							"",
							`Consensus threshold: ${this.config.consensusThreshold}`,
							`Minimum agents: ${this.config.minAgents}`,
						].join("\n"),
					},
				],
				contextId: taskId,
			} as A2AMessage);
			return;
		}

		try {
			const result = await this.verify(inputs, taskText);

			// Save a skill record for high-confidence verifications.
			if (result.consensus && this.skillStore) {
				const slug = `verification-${Date.now()}`;
				if (!this.skillStore.exists(slug)) {
					this.skillStore.save(slug, {
						name: "Verification Result",
						description: `Verified task: "${taskText.slice(0, 60)}" — winner: ${result.winner} (confidence: ${result.confidence.toFixed(3)})`,
						tags: [
							"verification",
							"consensus",
							result.contested ? "contested" : "verified",
						],
						steps: [
							`Task: ${taskText}`,
							`Participants: ${result.participantCount}`,
							`Winner: ${result.winner} (score: ${result.confidence.toFixed(3)})`,
							`Threshold: ${result.threshold}`,
							`Consensus: ${result.consensus}`,
						],
						createdAt: new Date().toISOString(),
						usageCount: 1,
						successRate: result.confidence,
					});
				}
			}

			this.taskStore.updateState(taskId, "completed");
			this.taskStore.appendMessage(taskId, {
				messageId: crypto.randomUUID(),
				role: "agent",
				kind: "message",
				parts: [{ kind: "text", text: result.synthesized }],
				contextId: taskId,
			} as A2AMessage);
		} catch (e) {
			this.taskStore.updateState(taskId, "failed");
			this.taskStore.appendMessage(taskId, {
				messageId: crypto.randomUUID(),
				role: "agent",
				kind: "message",
				parts: [
					{
						kind: "text",
						text: `Verification failed: ${String(e)}`,
					},
				],
				contextId: taskId,
			} as A2AMessage);
		}
	}
}
