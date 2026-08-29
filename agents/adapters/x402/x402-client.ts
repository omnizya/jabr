/**
 * x402 client — attaches PaymentToken headers when delegating to paid agents.
 *
 * Wraps an A2A client (fetch-based) so that when the target agent declares
 * settlement pricing in its AgentCard, a PaymentToken is minted and attached
 * as the X-Payment-Token header before the task is sent.
 */

import type { AgentCard } from "@agents/types";
import type { SettlementPricing, PaymentToken } from "./types";
import { SettlementLedger } from "./settlement-ledger";

const X_PAYMENT_TOKEN = "X-Payment-Token";

/** How to compute the required payment amount from an agent card. */
function requiredAmount(card: AgentCard): number {
  const p = card.pricing;
  if (!p) return 0;
  const base = p.costPerTask ?? 0;
  const perToken = p.costPerToken ?? 0;
  // Surrogate token count: text length / 100 (ceil).
  const textTokens = Math.ceil(base > 0 ? 0 : 0); // placeholder; refined at mint time
  return base + perToken * textTokens;
}

/** Compute the exact payment from a card + input text length. */
function computeAmount(card: AgentCard, textLen: number): number {
  const p = card.pricing;
  if (!p) return 0;
  const base = p.costPerTask ?? 0;
  const perToken = p.costPerToken ?? 0;
  // Tokenize: rough char-based estimate (1 token ~= 4 chars).
  const tokens = Math.max(1, Math.ceil(textLen / 4));
  return base + perToken * tokens;
}

export interface X402ClientConfig {
  /** Settlement ledger used to mint tokens and track balances. */
  ledger: SettlementLedger;
  /** URL of the paying (delegator) agent. */
  delegatorUrl: string;
  /** Optional default settlement currency override. */
  defaultCurrency?: string;
}

/**
 * Extracts settlement pricing from an agent card.
 * Returns null when the agent declares no settlement pricing.
 */
export function getSettlementPricing(card: AgentCard): SettlementPricing | null {
  const p = card.pricing;
  if (!p) return null;
  const settlement = p.settlement;
  if (!settlement) return null;
  return settlement;
}

/**
 * x402-aware delegation client. Delegates to an agent URL; if the agent's card
 * declares settlement pricing, mints a PaymentToken and attaches it as a header.
 */
export class X402Client {
  private ledger: SettlementLedger;
  private delegatorUrl: string;
  private defaultCurrency?: string;
  /** Cached agent cards (fetched on demand). */
  private cache = new Map<string, AgentCard | null>();

  constructor(config: X402ClientConfig) {
    this.ledger = config.ledger;
    this.delegatorUrl = config.delegatorUrl;
    this.defaultCurrency = config.defaultCurrency;
  }

  /**
   * Fetch the agent card for a URL (with in-memory caching).
   * Returns null on failure.
   */
  async fetchCard(agentUrl: string): Promise<AgentCard | null> {
    const cached = this.cache.get(agentUrl);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`${agentUrl}/.well-known/agent-card.json`);
      if (!res.ok) {
        this.cache.set(agentUrl, null);
        return null;
      }
      const card = (await res.json()) as AgentCard;
      this.cache.set(agentUrl, card);
      return card;
    } catch {
      this.cache.set(agentUrl, null);
      return null;
    }
  }

  /** Clear the card cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Delegate a task to an agent, attaching a PaymentToken when the agent
   * declares settlement pricing.
   *
   * Returns the response text (or error body) from the agent.
   */
  async delegateTask(agentUrl: string, text: string, agentName?: string): Promise<string> {
    const card = await this.fetchCard(agentUrl);
    const settlement = card ? getSettlementPricing(card) : null;

    // No settlement pricing → standard delegation (no header).
    if (!settlement) {
      return this.sendTask(agentUrl, text);
    }

    // Compute the required amount from the card + input length.
    const amount = computeAmount(card, text.length);

    // Auto-refill check: if the delegator's own balance is low, refill.
    const delegatorBalance = this.ledger.getBalance(this.delegatorUrl);
    if (delegatorBalance < settlement.autoRefillThreshold ?? 0) {
      const refilled = this.ledger.refillIfLow(this.delegatorUrl, delegatorBalance);
      if (refilled > 0) {
        console.log(`[X402Client] auto-refilled ${refilled} units for ${this.delegatorUrl} (balance now ${delegatorBalance + refilled})`);
      }
    }

    // Mint a PaymentToken.
    const purpose = `delegate ${agentName ?? "unknown"} task`;
    const token = this.ledger.mintToken(
      this.delegatorUrl,
      agentUrl,
      amount,
      purpose,
      { proof: `mint:${Date.now()}` },
    );

    console.log(`[X402Client] minted PaymentToken txId=${token.txId} amount=${amount} → ${agentUrl}`);
    return this.sendTask(agentUrl, text, token);
  }

  /**
   * Send the task to the agent, optionally with a PaymentToken header.
   */
  private async sendTask(agentUrl: string, text: string, token?: PaymentToken): Promise<string> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text }],
        },
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers[X_PAYMENT_TOKEN] = JSON.stringify(token);
    }

    const start = performance.now();
    const res = await fetch(agentUrl, {
      method: "POST",
      headers,
      body,
    });
    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const errMsg = `[X402Client] delegateTask failed: ${res.status} ${res.statusText}${bodyText ? ` ${bodyText.slice(0, 200)}` : ""}`;
      console.error(errMsg);
      return errMsg;
    }

    const data = (await res.json()) as { result?: { text?: string }; error?: { code: number; message: string } };
    if (data.error) {
      const msg = `[X402Client] error code=${data.error.code} msg=${data.error.message}`;
      console.error(msg);
      return msg;
    }

    const textResult = data.result?.text ?? "[X402Client] no text in response";
    console.log(`[X402Client] ← ${agentUrl} status=${res.status} latency=${latency}ms textLen=${textResult.length}`);
    return textResult;
  }
}
