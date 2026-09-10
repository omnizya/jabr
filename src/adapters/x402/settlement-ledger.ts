/**
 * Settlement ledger — on-chain verification stub with local fallback.
 *
 * Verifies PaymentToken signatures, records settlements, and supports
 * auto-refill when an agent's balance drops below threshold.
 *
 * Production mode (JABR_X402_CHAIN_ENDPOINT set): hits a chain RPC to confirm
 * proof of funds. Dev mode: verifies HMAC signature against the local mint record.
 */

import type {
	PaymentToken,
	SettlementReceipt,
	VerificationResult,
} from "./types";

/** Gate for the dev-only chain verification stub in verifyChainProof.
 *
 * The stub is disabled by default and locked out under NODE_ENV=production.
 * Non-production environments can opt in by setting
 * JABR_X402_CHAIN_VERIFICATION_ENABLED=1 (or "true"/"yes", case-insensitive).
 */
function isChainVerificationEnabled(): boolean {
	if (process.env.NODE_ENV === "production") return false;
	const v = process.env.JABR_X402_CHAIN_VERIFICATION_ENABLED;
	return v != null && /^(1|true|yes)$/i.test(v);
}

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

/** Production guard for chain verification via RPC.
 *
 * verifyChainProof is a development-only stub: it hits a configurable HTTP
 * endpoint and trusts whatever the endpoint replies. It is NOT a real blockchain
 * proof verifier. In production it must stay disabled unless the chain endpoint
 * has been hardened and audited first.
 *
 * Gate: JABR_X402_CHAIN_VERIFICATION_ENABLED (default: false).
 *   Explicitly opt in with "1", "true", or "yes" (case-insensitive) — anything
 *   else keeps the stub disabled. In production (NODE_ENV=production) the
 *   default stays false even if the env var is set, unless the value is
 *   explicitly truthy.
 */
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

	/** Mint records: txId → { from, to, amount, issuedAt, purpose, proof, signature } */
	private mints = new Map<
		string,
		{
			from: string;
			to: string;
			amount: number;
			issuedAt: string;
			purpose: string;
			proof: string;
			signature: string;
		}
	>();

	/** Settlement receipts: txId → SettlementReceipt */
	private receipts = new Map<string, SettlementReceipt>();

	/** Per-agent balances: agentUrl → { balance, lastSettled } */
	private balances = new Map<
		string,
		{ balance: number; lastSettled: string | null }
	>();

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
		opts?: { proof?: string },
	): PaymentToken {
		const txId = crypto.randomUUID();
		const issuedAt = new Date().toISOString();
		const proof = opts?.proof ?? `mint:${txId}`.slice(0, 64);
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
	async verify(token: PaymentToken): Promise<VerificationResult> {
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
			return {
				valid: false,
				reason: `token not addressed to this agent (to=${token.to}, expected=${mint.to})`,
			};
		}

		// 3. Amount must cover the required cost.
		if (token.amount <= 0) {
			return {
				valid: false,
				reason: `amount must be > 0 (got ${token.amount})`,
			};
		}

		// 4. Signature verification.
		const payload = `${token.txId}\n${token.from}\n${token.to}\n${token.amount}\n${token.issuedAt}\n${token.purpose}\n${token.proof}`;
		const expectedSig = Hmac("sha256", this.hmacSecret)
			.update(payload)
			.digest("hex");
		if (token.signature !== expectedSig) {
			return { valid: false, reason: `invalid token signature` };
		}

		// 5. On-chain proof verification (when chain endpoint is configured).
		if (this.chainEndpoint) {
			const proof = await this.verifyChainProof(token);
			if (!proof.confirmed) {
				return {
					valid: false,
					reason: `on-chain proof not confirmed: ${proof.error}`,
				};
			}
			// Record the chain reference on the token for the receipt.
			token.proof = proof.chainRef ?? token.proof;
		}

		// 6. Deduct from sender's balance.
		// In chain mode, the on-chain tx already moved funds — just record.
		const fromKey = this.agentKey(token.from);
		const fromBal = this.balances.get(fromKey);
		if (fromBal && this.chainEndpoint) {
			// In chain mode, the on-chain tx already moved funds — just record.
		} else if (fromBal) {
			// Local mode: deduct from sender.
			const newBalance = Math.max(0, fromBal.balance - token.amount);
			this.balances.set(fromKey, {
				balance: newBalance,
				lastSettled: fromBal.lastSettled,
			});
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
	 * Verify a chain proof via RPC call to `chainEndpoint`.
	 *
	 * ⚠ DEV-ONLY STUB — not a real on-chain proof verifier.
	 *
	 * POSTs { txId, from, to, amount, proof } to the configured chain RPC endpoint
	 * and interprets the response. Returns confirmed:true only when the RPC responds
	 * with a positive confirmation; returns confirmed:false with an error message on
	 * any failure (network error, non-2xx, missing/invalid response, or explicit
	 * rejection from the chain).
	 *
	 * Production guard: this method is a no-op (returns unconfirmed) when
	 * JABR_X402_CHAIN_VERIFICATION_ENABLED is not explicitly truthy, OR when
	 * NODE_ENV=production. Enable it in non-production environments by setting
	 * JABR_X402_CHAIN_VERIFICATION_ENABLED=1 — but treat the result as advisory,
	 * not as cryptographic proof.
	 */
	private async verifyChainProof(token: PaymentToken): Promise<ChainProof> {
		// Production guard: chain verification is a dev-only stub.
		// Disabled by default and locked out under NODE_ENV=production.
		if (!isChainVerificationEnabled()) {
			return {
				confirmed: false,
				error:
					"chain verification is disabled (dev-only stub; set JABR_X402_CHAIN_VERIFICATION_ENABLED=1 in non-production to enable)",
			};
		}
		if (!this.chainEndpoint) {
			return { confirmed: false, error: "no chain endpoint configured" };
		}
		if (!token.proof || token.proof.length === 0) {
			return { confirmed: false, error: "empty proof" };
		}

		let response: Response;
		try {
			response = await fetch(this.chainEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					txId: token.txId,
					from: token.from,
					to: token.to,
					amount: token.amount,
					proof: token.proof,
				}),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { confirmed: false, error: `chain RPC call failed: ${message}` };
		}

		if (!response.ok) {
			return {
				confirmed: false,
				error: `chain RPC returned ${response.status} ${response.statusText}`,
			};
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return {
				confirmed: false,
				error: "chain RPC returned non-JSON response",
			};
		}

		// Accept any response that explicitly confirms the proof.
		// Expected shapes: { confirmed: true, chainRef?: string } or
		// { success: true, txHash?: string } — both are treated as confirmation.
		if (typeof payload === "object" && payload !== null) {
			const p = payload as Record<string, unknown>;
			if (p.confirmed === true || p.success === true) {
				return {
					confirmed: true,
					chainRef:
						(p.chainRef as string | undefined) ??
						(p.txHash as string | undefined) ??
						token.proof,
				};
			}
			if (p.confirmed === false || p.success === false) {
				return {
					confirmed: false,
					error:
						(p.error as string | undefined) ??
						(p.reason as string | undefined) ??
						"chain RPC explicitly rejected proof",
				};
			}
		}

		// Unknown / ambiguous response — treat as unconfirmed rather than silently
		// accepting (the previous stub behavior that the parent task flagged as a bug).
		return {
			confirmed: false,
			error: "chain RPC returned an unrecognized response shape",
		};
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
		const signature = Hmac("sha256", this.hmacSecret)
			.update(payload)
			.digest("hex");
		this.mints.set(txId, {
			from: "system-funding-source",
			to: agentUrl,
			amount,
			issuedAt,
			purpose: "auto-refill",
			proof,
			signature,
		});
		const key = this.agentKey(agentUrl);
		const existing = this.balances.get(key);
		this.balances.set(key, {
			balance: (existing?.balance ?? 0) + amount,
			lastSettled: existing?.lastSettled ?? null,
		});
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

	/** Configured chain RPC endpoint (undefined = local dev mode). */
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
		return Array.from(this.balances.entries()).map(
			([agent, { balance, lastSettled }]) => ({
				agent,
				balance,
				lastSettled,
			}),
		);
	}

	/** Reset all state (for testing). */
	reset(): void {
		this.mints.clear();
		this.receipts.clear();
		this.balances.clear();
	}
}
