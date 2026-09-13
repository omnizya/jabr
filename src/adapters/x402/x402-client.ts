/**
 * x402 client — attaches PaymentToken headers when delegating to paid agents.
 *
 * Wraps an A2A client (fetch-based) so that when the target agent declares
 * settlement pricing in its AgentCard, a PaymentToken is minted and attached
 * as the X-Payment-Token header before the task is sent.
 */

import type { AgentCard } from "@agents/types";
import {
	V1_METHOD_SEND_MESSAGE,
	WELL_KNOWN_AGENT_CARD_JSON,
	WELL_KNOWN_AGENT_JSON,
} from "@constants/a2a-v1";
import {
	fromWireSendMessageResponse,
	toWireSendMessageRequest,
} from "@/adapters/a2a/serialize";
import type {
	Message,
	SendMessageRequest,
	SendMessageResponse,
} from "@/types/a2a-v1";
import type { JSONRPCResponse } from "@/utils/rpc";
import { SettlementLedger } from "./settlement-ledger";
import type { PaymentToken, SettlementPricing } from "./types";

const X_PAYMENT_TOKEN = "X-Payment-Token";

export interface X402ClientConfig {
	/** Settlement ledger used to mint tokens and track balances. */
	ledger: SettlementLedger;
	/** URL of the paying (delegator) agent. */
	delegatorUrl: string;
	/** Optional default settlement currency override. */
	defaultCurrency?: string;
	/** Optional API key sent as X-API-Key to target agents that require auth. */
	apiKey?: string;
}

/**
 * Extracts settlement pricing from an agent card.
 * Returns null when the agent declares no settlement pricing.
 */
export function getSettlementPricing(
	card: AgentCard,
): SettlementPricing | null {
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
	/** Cached settlement pricing per agent URL. */
	private settlementCache = new Map<string, SettlementPricing | null>();

	constructor(config: X402ClientConfig) {
		this.ledger = config.ledger;
		this.delegatorUrl = config.delegatorUrl;
		this.defaultCurrency = config.defaultCurrency;
		this.apiKey = config.apiKey;
	}

	private apiKey?: string;

	/**
	 * Fetch the agent card for a URL (with in-memory caching).
	 * Returns null on failure.
	 */
	async fetchCard(agentUrl: string): Promise<AgentCard | null> {
		const cached = this.cache.get(agentUrl);
		if (cached !== undefined) return cached;
		try {
			// Try v1.0 well-known path first
			let res = await fetch(`${agentUrl}/${WELL_KNOWN_AGENT_JSON}`);
			if (!res.ok) {
				// Fallback to legacy path
				res = await fetch(`${agentUrl}/${WELL_KNOWN_AGENT_CARD_JSON}`);
				if (!res.ok) {
					this.cache.set(agentUrl, null);
					return null;
				}
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
	async delegateTask(
		agentUrl: string,
		text: string,
		agentName?: string,
	): Promise<string> {
		// Check cached settlement pricing first.
		const cachedSettlement = this.settlementCache.get(agentUrl);
		if (cachedSettlement !== undefined && cachedSettlement !== null) {
			return this.delegateWithPayment(
				agentUrl,
				text,
				cachedSettlement,
				agentName,
			);
		}

		// Fetch card and cache settlement pricing.
		const card = await this.fetchCard(agentUrl);
		const settlement = card ? getSettlementPricing(card) : null;
		this.settlementCache.set(agentUrl, settlement);

		// No settlement pricing → standard delegation (no header).
		if (!settlement) {
			return this.sendTask(agentUrl, text);
		}

		return this.delegateWithPayment(agentUrl, text, settlement, agentName);
	}

	/**
	 * Delegate with a cached settlement pricing object — avoids re-fetching the card.
	 */
	async delegateWithPayment(
		agentUrl: string,
		text: string,
		settlement: SettlementPricing,
		agentName?: string,
	): Promise<string> {
		// Compute the required amount from the settlement + approximate token count (~4 chars/token).
		const amount =
			settlement.costPerTask +
			(settlement.costPerToken ?? 0) * Math.max(1, Math.ceil(text.length / 4));

		// Auto-refill check: if the delegator's own balance is low, refill.
		const delegatorBalance = this.ledger.getBalance(this.delegatorUrl);
		if (delegatorBalance < (settlement.autoRefillThreshold ?? 0)) {
			const refilled = await this.ledger.refillIfLow(
				this.delegatorUrl,
				delegatorBalance,
			);
			if (refilled > 0) {
				console.log(
					`[X402Client] auto-refilled ${refilled} units for ${this.delegatorUrl}`,
				);
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

		console.log(
			`[X402Client] minted PaymentToken txId=${token.txId} amount=${amount} → ${agentUrl}`,
		);
		return this.sendTask(agentUrl, text, token);
	}

	/**
	 * Send the task to the agent, optionally with a PaymentToken header.
	 */
	private async sendTask(
		agentUrl: string,
		text: string,
		token?: PaymentToken,
	): Promise<string> {
		const message: Message = {
			role: "user",
			messageId: crypto.randomUUID(),
			parts: [{ kind: "text", text }],
		};

		const request: SendMessageRequest = { message };
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: V1_METHOD_SEND_MESSAGE,
			params: toWireSendMessageRequest(request),
		});

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.apiKey) {
			headers["X-API-Key"] = this.apiKey;
		}
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

		const data = (await res.json()) as JSONRPCResponse;
		if (data.error) {
			const msg = `[X402Client] error code=${data.error.code} msg=${data.error.message}`;
			console.error(msg);
			return msg;
		}

		// The A2AServer sync path returns a flat result { text }. Prefer it,
		// then fall back to structured SendMessageResponse forms.
		const rawResult = data.result as { text?: unknown } | undefined;
		let resultText: string | undefined;
		if (typeof rawResult?.text === "string") {
			resultText = rawResult.text;
		} else {
			const response = fromWireSendMessageResponse(data.result);
			if (response.task?.status?.message?.parts?.[0]?.kind === "text") {
				resultText = response.task.status.message.parts[0].text;
			} else if (response.message?.parts?.[0]?.kind === "text") {
				resultText = response.message.parts[0].text;
			} else if (response.task?.artifacts?.[0]?.parts?.[0]?.kind === "text") {
				resultText = response.task.artifacts[0].parts[0].text;
			}
		}

		const textResult = resultText ?? "[X402Client] no text in response";
		console.log(
			`[X402Client] ← ${agentUrl} status=${res.status} latency=${latency}ms textLen=${textResult.length}`,
		);
		return textResult;
	}
}
