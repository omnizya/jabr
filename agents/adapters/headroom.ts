import type { BudgetPort, BudgetUsage } from "@ports/budget-port";

export class HeadroomAdapter implements BudgetPort {
  private counters: Map<string, number> = new Map();
  private caps: Record<string, number> = {};

  constructor() {
    this.loadCapsFromEnv();
  }

  private loadCapsFromEnv() {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("JABR_TOKEN_CAP_") && value !== undefined) {
        const agentName = key.replace("JABR_TOKEN_CAP_", "").toLowerCase();
        this.caps[agentName] = parseInt(value, 10) || 100000;
      }
    }
  }

  async consume(agentName: string, tokens: number): Promise<void> {
    const name = agentName.toLowerCase();
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + tokens);
  }

  async remaining(agentName: string): Promise<number> {
    const name = agentName.toLowerCase();
    const cap = this.caps[name] || 100000;
    const used = this.counters.get(name) || 0;
    return Math.max(0, cap - used);
  }

  isExhausted(agentName: string): boolean {
    const name = agentName.toLowerCase();
    const cap = this.caps[name] || 100000;
    const used = this.counters.get(name) || 0;
    return used >= cap;
  }

  reset(): void {
    this.counters.clear();
  }

  getUsage(): Record<string, BudgetUsage> {
    const usage: Record<string, BudgetUsage> = {};
    for (const [name, used] of this.counters) {
      const cap = this.caps[name] || 100000;
      usage[name] = {
        used,
        cap,
        pct: (used / cap) * 100,
      };
    }
    return usage;
  }
}
