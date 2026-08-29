export interface BudgetUsage {
  used: number;
  cap: number;
  pct: number;
}

export interface BudgetPort {
  consume(agentName: string, tokens: number): Promise<void>;
  remaining(agentName: string): Promise<number>;
  isExhausted(agentName: string): boolean;
  reset(): void;
  getUsage(): Record<string, BudgetUsage>;
}

export class BudgetExhaustedError extends Error {
  constructor(public agentName: string, public remaining: number) {
    super(`Budget exhausted for agent ${agentName}. Remaining: ${remaining} tokens`);
    this.name = "BudgetExhaustedError";
    console.error(`[BudgetPort] budget exhausted for ${agentName} (remaining ${remaining} tokens)`);
  }
}
