export interface BudgetUsage {
	used: number;
	cap: number;
	pct: number;
}

export interface BudgetPort {
	/** Deduct `approximateTokens` from the agent's budget. Budget accounting uses
	 *  character-length / 4 as a token approximation (~4 chars/token) until a real
	 *  tokenizer is wired in. `approximateTokens` should be computed as
	 *  `Math.ceil(text.length / 4)` by callers. */
	consume(agentName: string, approximateTokens: number): Promise<void>;
	remaining(agentName: string): Promise<number>;
	isExhausted(agentName: string): boolean;
	reset(): void;
	getUsage(): Record<string, BudgetUsage>;
}

export class BudgetExhaustedError extends Error {
	constructor(
		public agentName: string,
		public remaining: number,
	) {
		super(
			`Budget exhausted for agent ${agentName}. Remaining: ${remaining} approximate tokens (char-length / 4)`,
		);
		this.name = "BudgetExhaustedError";
		console.error(
			`[BudgetPort] budget exhausted for ${agentName} (remaining ${remaining} approximate tokens)`,
		);
	}
}
