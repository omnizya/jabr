/**
 * x402 payment types for cross-agent settlement.
 *
 * Agents declare pricing in their AgentCard (costPerTask).
 * The delegating client attaches a PaymentToken header when calling a paid agent.
 * The receiving server verifies the token against the SettlementLedger before
 * processing the task. Failures return JSON-RPC 402-Payment Required.
 */

/** A signed, single-use payment token transferred from delegator to worker. */
export interface PaymentToken {
	/** Cross-agent transfer identifier (delegator→worker). */
	txId: string;
	/** URL of the paying agent (delegator). */
	from: string;
	/** URL of the paid worker agent. */
	to: string;
	/** Amount in agent-native units (matches costPerTask). */
	amount: number;
	/** When this token was minted (ISO). */
	issuedAt: string;
	/** Fingerprint of the pricing used to mint this token. */
	purpose: string;
	/** Proof of funds reference. For on-chain settlement this is a tx hash/block;
	 *  for the local ledger this is the mint record id. */
	proof: string;
	/** Token integrity signature (HMAC for local ledger; chain signature for on-chain). */
	signature: string;
}

/** Settlement outcome recorded by the worker after verifying a token. */
export interface SettlementReceipt {
	/** Wire txId from the PaymentToken. */
	txId: string;
	/** Worker agent URL. */
	to: string;
	/** Amount accepted (0 if rejected). */
	accepted: number;
	/** Whether the token passed verification. */
	verified: boolean;
	/** Why the token was rejected, if any. */
	rejectReason?: string;
	/** ISO timestamp of settlement. */
	settledAt: string;
	/** On-chain confirmation identifier (block height / tx hash) when available. */
	chainRef?: string;
}

/** Result of verifying a PaymentToken on the settlement ledger. */
export interface VerificationResult {
	/** Whether the token is valid and can be redeemed. */
	valid: boolean;
	/** Human-readable reason when invalid. */
	reason?: string;
	/** Receipt to record on success. */
	receipt?: SettlementReceipt;
}

/** Agent pricing with an optional settlement/currency extension. */
export interface SettlementPricing {
	/** Base cost deducted per delegated task (already in AgentPricing). */
	costPerTask: number;
	/** Optional per-token surcharge. */
	costPerToken?: number;
	/** Settlement currency/ledger identifier. When unset, uses the local Jabr ledger. */
	currency?: string;
	/** Maximum unpaid balance before auto-refill is triggered (0 = no auto-refill). */
	autoRefillThreshold?: number;
	/** Amount to refill when balance drops below autoRefillThreshold. */
	autoRefillAmount?: number;
	/** On-chain RPC endpoint for verification when currency is a chain token.
	 *  When unset, verification is local (in-memory ledger). */
	chainEndpoint?: string;
	/** Optional contract/program address for on-chain verification. */
	contractAddress?: string;
}

/** Bundles settlement pricing into the agent's existing pricing declaration. */
export interface AgentPricing {
	costPerTask: number;
	costPerToken?: number;
	settlement?: SettlementPricing;
}
