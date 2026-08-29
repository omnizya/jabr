/**
 * x402 server middleware — intercepts POST / on an A2A server, verifies the
 * X-Payment-Token header, and rejects unpaid tasks with a JSON-RPC 402 response.
 *
 * Drops into the A2AServer fetch handler between rate-limiting and dispatch,
 * so the payment check runs after rate limits but before the task is executed.
 */

import type { PaymentToken, VerificationResult } from "./types";
import { SettlementLedger } from "./settlement-ledger";
import type { SomeId } from "@utils/rpc";
import { err } from "@utils/rpc";

const X_PAYMENT_TOKEN = "X-Payment-Token";

/** JSON-RPC error for payment required. */
const PAYMENT_REQUIRED_CODE = -32022;
const PAYMENT_REQUIRED_MESSAGE = "Payment required — attach a valid X-Payment-Token header.";

/**
 * Build the 402 JSON-RPC response body.
 */
function paymentRequiredResponse(rpcId: unknown): Response {
  const body = err((rpcId ?? null) as SomeId, PAYMENT_REQUIRED_CODE, PAYMENT_REQUIRED_MESSAGE);
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Parse the X-Payment-Token header into a PaymentToken, or null on failure.
 */
function parsePaymentToken(header: string | null): PaymentToken | null {
  if (!header) return null;
  try {
    return JSON.parse(header) as PaymentToken;
  } catch {
    return null;
  }
}

/**
 * Middleware result after checking payment.
 */
export interface PaymentCheckResult {
  /** Whether the request passed the payment check. */
  paid: boolean;
  /** The verified token (if paid). */
  token?: PaymentToken;
  /** The settlement receipt (if paid and verified). */
  receipt?: import("./types").SettlementReceipt;
  /** Human-readable reason for rejection. */
  rejectReason?: string;
}

/**
 * x402 payment middleware.
 *
 * Call `check` in the A2AServer fetch handler after rate-limiting and before
 * dispatching the task. When the agent declares settlement pricing AND the
 * request carries a valid PaymentToken, the task proceeds; otherwise 402.
 */
export class X402Server {
  private ledger: SettlementLedger;
  private agentUrl: string;
  /** Whether this agent expects payment (set from its AgentCard). */
  private expectsPayment: boolean;
  /** Required payment amount (from AgentCard). 0 = no payment expected. */
  private requiredAmount: number;
  /** Cached agent card. */
  private cardCache: import("@agents/types").AgentCard | null = null;

  constructor(ledger: SettlementLedger, agentUrl: string) {
    this.ledger = ledger;
    this.agentUrl = agentUrl;
    this.expectsPayment = false;
    this.requiredAmount = 0;
  }

  /**
   * Update settlement expectations from an agent card.
   * Call this when the card is loaded or refreshed.
   */
  updateFromCard(card: import("@agents/types").AgentCard): void {
    const p = card.pricing;
    if (!p || !p.settlement) {
      this.expectsPayment = false;
      this.requiredAmount = 0;
      this.cardCache = card;
      return;
    }
    this.expectsPayment = true;
    // Use costPerTask as the minimum required payment.
    this.requiredAmount = p.costPerTask ?? 0;
    this.cardCache = card;
  }

  /**
   * Check whether the incoming request is paid.
   *
   * Returns a PaymentCheckResult. When `paid` is false, the caller should
   * respond with a 402 payment-required and not dispatch the task.
   */
  check(req: Request): PaymentCheckResult {
    // If the agent doesn't expect payment, allow (but still check if a token
    // is present — it may be a courtesy payment).
    if (!this.expectsPayment) {
      const header = req.headers.get(X_PAYMENT_TOKEN);
      if (header) {
        const token = parsePaymentToken(header);
        if (token) {
          const result = this.ledger.verify(token);
          if (result.valid && result.receipt) {
            return { paid: true, token, receipt: result.receipt };
          }
        }
      }
      // No payment expected and no token → allow.
      return { paid: true };
    }

    // Agent expects payment: require a valid token.
    const header = req.headers.get(X_PAYMENT_TOKEN);
    if (!header) {
      return { paid: false, rejectReason: "missing X-Payment-Token header" };
    }

    const token = parsePaymentToken(header);
    if (!token) {
      return { paid: false, rejectReason: "malformed X-Payment-Token header" };
    }

    // Verify on the ledger.
    const result = this.ledger.verify(token);
    if (!result.valid) {
      return { paid: false, rejectReason: result.reason ?? "verification failed" };
    }

    // Token is valid. Check that the amount covers the required cost.
    if (token.amount < this.requiredAmount) {
      return {
        paid: false,
        rejectReason: `insufficient amount (paid ${token.amount}, required ${this.requiredAmount})`,
      };
    }

    return { paid: true, token, receipt: result.receipt };
  }

  /** Get the agent card cached from updateFromCard. */
  get card(): import("@agents/types").AgentCard | null {
    return this.cardCache;
  }
}

/**
 * Convenience: build a 402 response for an A2AServer fetch handler.
 * Call after parsing the RPC id but before dispatching.
 */
export function x402Reject(rpcId: unknown, reason: string): Response {
  const body = err((rpcId ?? null) as SomeId, PAYMENT_REQUIRED_CODE, `${PAYMENT_REQUIRED_MESSAGE} ${reason}`);
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "Content-Type": "application/json" },
  });
}
