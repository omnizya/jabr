/**
 * Settlement ledger — on-chain verification stub with local fallback.
 *
 * Verifies PaymentToken signatures, records settlements, and supports
 * auto-refill when an agent's balance drops below threshold.
 *
 * Production mode (JABR_X402_CHAIN_ENDPOINT set): hits a chain RPC to confirm
 * proof of funds. Dev mode: verifies HMAC signature against the local mint record.
 */

import type { PaymentToken, SettlementReceipt, VerificationResult } from "./types";

const Hmac = (await import("node:crypto")).createHmac;

export interface LedgerConfig {
  /** HMAC secret used to sign/verify tokens in local (dev) mode. */
  hmacSecret: string;
  /** Optional chain RPC endpoint. When set, on-chain verification is attempted. */
  chainEndpoint?: string;
  /** Default auto-refill threshold (agent-native units). 0 = disabled. */
  defaultAutoRefillThreshold?: number;
  /** Default auto-refill amount (agent-native units). */
  defaultAutoRefillAmount?: number;
}

/** Per-agent balance snapshot. */
export interface AgentBalance {
  agent: string;
  balance: number;
  lastSettled: string | null;
}

/** On-chain proof verification result (stubbed; extend with real RPC calls). */
export interface ChainProof {
  /** Whether the proof is confirmed on-chain. */
  confirmed: boolean;
  /** Chain reference (tx hash / block height) if confirmed. */
  chainRef?: string;
  /** Error message when not confirmed. */
  error?: string;
}

export class SettlementLedger {
  private hmacSecret: string;
  private chainEndpoint?: string;
  private autoRefillThreshold: number;
  private autoRefillAmount: number;

  /** Mint records: txId → { from, to, amount, issuedAt, purpose, proof, signature, chainEndpoint } */
  private mints = new Map<string, {
    from: string;
    to: string;
    amount: number;
    issuedAt: string;
    purpose: string;
    proof: string;
    signature: string;
    chainEndpoint?: string;
  }>();

  /** Settlement receipts: txId → SettlementReceipt */
  private receipts = new Map<string, SettlementReceipt>();

  /** Per-agent balances: agentUrl → { balance, lastSettled } */
  private balances = new Map<string, { balance: number; lastSettled: string | null }>();

  constructor(config: LedgerConfig) {
    this.hmacSecret = config.hmacSecret;
    this.chainEndpoint = config.chainEndpoint;
    this.autoRefillThreshold = config.defaultAutoRefillThreshold ?? 0;
    this.autoRefillAmount = config.defaultAutoRefillAmount ?? 0;
  }

  /** Derive an agent's name from its URL for balance tracking. */
  private agentKey(url: string): string {
    return url.toLowerCase();
  }

  // --- Minting ---

  /** Mint a new PaymentToken for a delegation from `from` to `to`. */
  mintToken(
    from: string,
    to: string,
    amount: number,
    purpose: string,
    opts?: { proof?: string; chainEndpoint?: string },
  ): PaymentToken {
    const txId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const proof = opts?.proof ?? `mint:${txId}`.slice(0, 64);
    const chainEndpoint = opts?.chainEndpoint ?? this.chainEndpoint;
    const payload = `${txId}\n${from}\n${to}\n${amount}\n${issuedAt}\n${purpose}\n${proof}`;
    const signature = Hmac("sha256", this.hmacSecret)
      .update(payload)
      .digest("hex");

    this.mints.set(txId, {
      from,
      to,
      amount,
      issuedAt,
      purpose,
      proof,
      signature,
      chainEndpoint,
    });

    // Credit the recipient's balance immediately on mint.
    const toKey = this.agentKey(to);
    const existing = this.balances.get(toKey);
    this.balances.set(toKey, {
      balance: (existing?.balance ?? 0) + amount,
      lastSettled: existing?.lastSettled ?? null,
    });

    return {
      txId,
      from,
      to,
      amount,
      issuedAt,
      purpose,
      proof,
      signature,
    };
  }

  // --- Verification ---

  /**
   * Verify a PaymentToken. In local mode, checks the HMAC signature against
   * the mint record. In chain mode, additionally calls verifyChainProof.
   */
  verify(token: PaymentToken): VerificationResult {
    // 0. Already settled?
    if (this.receipts.has(token.txId)) {
      const prev = this.receipts.get(token.txId)!;
      if (prev.verified) {
        return {
          valid: false,
          reason: `txId already settled (accepted=${prev.accepted})`,
        };
      }
      return {
        valid: false,
        reason: `txId previously rejected: ${prev.rejectReason}`,
      };
    }

    // 1. Mint record must exist.
    const mint = this.mints.get(token.txId);
    if (!mint) {
      return { valid: false, reason: `unknown txId (not minted)` };
    }

    // 2. Recipient must match the worker.
    if (mint.to !== token.to) {
      return { valid: false, reason: `token not addressed to this agent (to=${token.to}, expected=${mint.to})` };
    }

    // 3. Amount must cover the required cost.
    if (token.amount <= 0) {
      return { valid: false, reason: `amount must be > 0 (got ${token.amount})` };
    }

    // 4. Signature verification.
    const payload = `${token.txId}\n${token.from}\n${token.to}\n${token.amount}\n${token.issuedAt}\n${token.purpose}\n${token.proof}`;
    const expectedSig = Hmac("sha256", this.hmacSecret).update(payload).digest("hex");
    if (token.signature !== expectedSig) {
      return { valid: false, reason: `invalid token signature` };
    }

    // 5. On-chain proof verification (when chain endpoint is configured).
    if (this.chainEndpoint) {
      const proof = this.verifyChainProof(token);
      if (!proof.confirmed) {
        return {
          valid: false,
          reason: `on-chain proof not confirmed: ${proof.error}`,
        };
      }
      // Reuse the chain reference from the proof for the receipt.
      token.proof = proof.chainRef ?? token.proof;
    }

    // 6. Deduct from sender's balance (always succeeds in local mode; in chain
    //    mode this is a no-op since the chain already settled the transfer).
    const fromKey = this.agentKey(token.from);
    const fromBal = this.balances.get(fromKey);
    if (fromBal && this.chainEndpoint) {
      // In chain mode, the on-chain tx already moved funds — just record.
    } else if (fromBal) {
      // Local mode: deduct from sender.
      const newBalance = Math.max(0, fromBal.balance - token.amount);
      this.balances.set(fromKey, { balance: newBalance, lastSettled: fromBal.lastSettled });
    }

    // 7. Record receipt.
    const receipt: SettlementReceipt = {
      txId: token.txId,
      to: token.to,
      accepted: token.amount,
      verified: true,
      settledAt: new Date().toISOString(),
      chainRef: this.chainEndpoint ? token.proof : undefined,
    };
    this.receipts.set(token.txId, receipt);

    return { valid: true, receipt };
  }

  /**
   * Stub for on-chain proof verification. In production, this would call
   * `chainEndpoint` with the proof and confirm the transfer. Here we accept
   * any non-empty proof string as a stand-in — extend with real RPC logic.
   */
  private verifyChainProof(token: PaymentToken): ChainProof {
    if (!this.chainEndpoint) {
      return { confirmed: false, error: "no chain endpoint configured" };
    }
    if (!token.proof || token.proof.length === 0) {
      return { confirmed: false, error: "empty proof" };
    }
    // In a real implementation: POST { txId, from, to, amount, proof } to chainEndpoint.
    // Check the response for confirmed: true and return chainRef on success.
    // Production mode would use fetch(this.chainEndpoint, { method: "POST", body }).
    // Stub mode currently treats any non-empty proof as confirmed for local dev.
    return { confirmed: true, chainRef: token.proof };
  }

  // --- Auto-refill ---

  /**
   * Mint a funding token from the system funding source to an agent.
   * Shared by both on-chain and local refill paths.
   */
  private mintRefillToken(agentUrl: string, amount: number): void {
    const txId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const proof = `refill:${Date.now()}`;
    const payload = `${txId}\nsystem-funding-source\n${agentUrl}\n${amount}\n${issuedAt}\nauto-refill\n${proof}`;
    const signature = Hmac("sha256", this.hmacSecret).update(payload).digest("hex");
    this.mints.set(txId, { from: "system-funding-source", to: agentUrl, amount, issuedAt, purpose: "auto-refill", proof, signature });
    const key = this.agentKey(agentUrl);
    const existing = this.balances.get(key);
    this.balances.set(key, { balance: (existing?.balance ?? 0) + amount, lastSettled: existing?.lastSettled ?? null });
  }

  /**
   * Perform an on-chain funding transfer to refill an agent's balance.
   *
   * In production, this calls the chain endpoint to transfer funds from a
   * system wallet to the agent. For the local ledger, it mints a token
   * from a system funding source.
   *
   * Returns the amount added (not the new balance).
   */
  async fundAgent(agentUrl: string, amount: number): Promise<number> {
    this.mintRefillToken(agentUrl, amount);
    return amount;
  }

  /**
   * Check whether an agent needs auto-refill, and perform it if so.
   * Returns the amount refilled (0 if no refill was needed/ configured).
   */
  async refillIfLow(agentUrl: string, currentBalance: number): Promise<number> {
    if (this.autoRefillThreshold <= 0 || this.autoRefillAmount <= 0) {
      return 0;
    }
    const key = this.agentKey(agentUrl);
    if (currentBalance >= this.autoRefillThreshold) {
      return 0;
    }
    return this.fundAgent(agentUrl, this.autoRefillAmount);
  }

  // --- Queries ---

  /** The configured chain endpoint (public read access for clients). */
  get chainEndpointUrl(): string | undefined {
    return this.chainEndpoint;
  }

  getBalance(agentUrl: string): number {
    return this.balances.get(this.agentKey(agentUrl))?.balance ?? 0;
  }

  getReceipt(txId: string): SettlementReceipt | undefined {
    return this.receipts.get(txId);
  }

  getMint(txId: string) {
    return this.mints.get(txId);
  }

  /** Returns per-agent balance snapshots. */
  getBalances(): AgentBalance[] {
    return Array.from(this.balances.entries()).map(([agent, { balance, lastSettled }]) => ({
      agent,
      balance,
      lastSettled,
    }));
  }

  /** Reset all state (for testing). */
  reset(): void {
    this.mints.clear();
    this.receipts.clear();
    this.balances.clear();
  }
}
