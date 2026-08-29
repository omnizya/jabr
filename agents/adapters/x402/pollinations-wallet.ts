/**
 * Pollinations wallet adapter — bridges Jabr's x402 settlement ledger to
 * Pollen (Pollinations' credit system). Agents hold a Pollinations API key;
 * this adapter checks balance and "reserves" Pollen for settlement tokens.
 *
 * The flow:
 * 1. Agent declares settlement pricing in Pollen (costPerTask) on its AgentCard.
 * 2. X402Client mints a PaymentToken, delegates the task.
 * 3. Worker agent executes, then calls ledger.settleWithPollen() to spend
 *    the corresponding Pollen from its own Pollinations balance.
 *
 * Pollen is not on-chain — it's a credit balance at gen.pollinations.ai.
 * So this adapter is a "proof of spend" bridge: the ledger records how much
 * Pollen each delegation should cost; the worker's wallet confirms the spend
 * against the actual Pollinations API.
 */

import type { PaymentToken, SettlementPricing } from "../x402/types";

export interface PollinationsWalletConfig {
  /** Pollinations API key (sk_... or pk_...). */
  apiKey: string;
  /** Base URL for Pollinations API. */
  baseUrl?: string;
}

export interface PollenBalance {
  balance: number;
  tier: number;
  paid: number;
}

export class PollinationsWallet {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: PollinationsWalletConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://gen.pollinations.ai").replace(/\/$/, "");
  }

  /**
   * Check the current Pollen balance for this wallet's API key.
   */
  async getBalance(): Promise<PollenBalance> {
    const res = await fetch(`${this.baseUrl}/account/balance`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`[PollinationsWallet] balance check failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as PollenBalance;
    return data;
  }

  /**
   * Verify that the API key is valid and has a non-zero balance.
   */
  async verifyKey(): Promise<boolean> {
    try {
      const balance = await this.getBalance();
      return balance.balance > 0;
    } catch {
      return false;
    }
  }

  /**
   * "Spend" Pollen by generating a resource. This is the bridge between
   * Jabr's x402 PaymentToken and actual Pollen consumption.
   *
   * Returns the URL of the generated resource (image, audio, etc.)
   * so the agent can attach it to its task result.
   */
  async spendOnGeneration(
    token: PaymentToken,
    modality: "image" | "audio" | "video" | "3d" | "text",
    prompt: string,
    model?: string,
  ): Promise<string> {
    const modelParam = model ? `&model=${encodeURIComponent(model)}` : "";
    const url = `${this.baseUrl}/${modality}/${encodeURIComponent(prompt)}${modelParam ? `?${modelParam.slice(1)}` : ""}`;

    console.log(`[PollinationsWallet] spending Pollen: txId=${token.txId} amount=${token.amount} modality=${modality}`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[PollinationsWallet] generation failed: ${res.status} ${body}`);
    }

    // For image/audio/video, the response is the binary; upload to media service
    // and return the public URL. For text, it's plain text.
    if (modality === "text") {
      return await res.text();
    }

    // For binary modalities, we rely on Pollinations' URL-based GET which
    // already returns the generated file. The URL itself is the resource link.
    return url;
  }

  /**
   * Convert a PaymentToken amount (in "agent-native units") to Pollen.
   * For now, 1:1 mapping — extend with dynamic pricing later.
   */
  tokenToPollen(amount: number): number {
    return amount;
  }

  /**
   * Build a SettlementPricing declaration for an AgentCard.
   * costPerTask is in Pollen units.
   */
  static declarePricing(costPerTask: number, costPerToken?: number): SettlementPricing {
    return {
      costPerTask,
      costPerToken,
      currency: "pollen",
      autoRefillThreshold: 1,
      autoRefillAmount: 5,
    };
  }
}
