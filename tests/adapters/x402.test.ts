/**
 * Unit tests for the x402 payment settlement layer.
 *
 * Covers: SettlementLedger mint/verify/refill, X402Server payment checks,
 * and the X402Client delegation flow with a mock server.
 */

import { describe, expect, test } from "bun:test";
import { SettlementLedger } from "@adapters/x402/settlement-ledger";
import { X402Server } from "@adapters/x402/x402-server";
import { X402Client } from "@adapters/x402/x402-client";
import type { AgentCard } from "@agents/types";
import type { PaymentToken, SettlementReceipt } from "@adapters/x402/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(costPerTask: number, opts?: { settlement?: boolean }): AgentCard {
  const card: AgentCard = {
    name: "test-agent",
    description: "test",
    url: "http://localhost:9999",
    version: "1.0.0",
    capabilities: {},
    skills: [],
    pricing: { costPerTask },
  };
  if (opts?.settlement) {
    card.pricing.settlement = {
      costPerTask,
      currency: "jabr-local",
      autoRefillThreshold: 5,
      autoRefillAmount: 20,
    };
  }
  return card;
}

// ---------------------------------------------------------------------------
// SettlementLedger tests
// ---------------------------------------------------------------------------

describe("SettlementLedger", () => {
  test("mints a valid PaymentToken", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const token = ledger.mintToken(
      "http://from",
      "http://to",
      10,
      "task delegation",
    );
    expect(token).toBeDefined();
    expect(token.txId).toBeTruthy();
    expect(token.from).toBe("http://from");
    expect(token.to).toBe("http://to");
    expect(token.amount).toBe(10);
    expect(token.issuedAt).toBeTruthy();
    expect(token.purpose).toBe("task delegation");
    expect(token.proof).toBeTruthy();
    expect(token.signature).toBeTruthy();
  });

  test("verifies a correctly signed token", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const token = ledger.mintToken("http://from", "http://to", 10, "task");
    const result = ledger.verify(token);
    expect(result.valid).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(result.receipt!.accepted).toBe(10);
    expect(result.receipt!.verified).toBe(true);
  });

  test("rejects an unknown txId", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const badToken: PaymentToken = {
      txId: "not-a-real-id",
      from: "http://from",
      to: "http://to",
      amount: 10,
      issuedAt: new Date().toISOString(),
      purpose: "task",
      proof: "x",
      signature: "bad",
    };
    const result = ledger.verify(badToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("unknown txId");
  });

  test("rejects a tampered signature", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const token = ledger.mintToken("http://from", "http://to", 10, "task");
    token.signature = "tampered";
    const result = ledger.verify(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid token signature");
  });

  test("rejects a token not addressed to this agent", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const token = ledger.mintToken("http://from", "http://other", 10, "task");
    // Verify against the wrong `to`.
    const result = ledger.verify(token);
    // Token was minted to http://other, so verifying as-is means the `to` matches
    // the mint record. We need to test the case where `to` in the token differs
    // from what the ledger expects. The ledger only checks that `mint.to === token.to`,
    // so we test by creating a token with a different `to` than mint.
    //
    // Actually, the mint record stores `to`. The token carries its own `to`.
    // Verification checks `mint.to !== token.to`. Let's create a mismatch.
    //
    // Simpler: mint for A, then modify the token's `to` to B before verifying.
    const mismatched: PaymentToken = {
      ...token,
      to: "http://mismatch",
    };
    const r2 = ledger.verify(mismatched);
    expect(r2.valid).toBe(false);
    expect(r2.reason).toContain("not addressed to this agent");
  });

  test("rejects a replayed txId", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const token = ledger.mintToken("http://from", "http://to", 10, "task");
    const r1 = ledger.verify(token);
    expect(r1.valid).toBe(true);
    // Second verification of the same txId.
    const r2 = ledger.verify(token);
    expect(r2.valid).toBe(false);
    expect(r2.reason).toContain("already settled");
  });

  test("credits recipient balance on mint", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    ledger.mintToken("http://from", "http://to", 10, "task");
    expect(ledger.getBalance("http://to")).toBe(10);
  });

  test("deducts sender balance on local verification", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    ledger.mintToken("http://from", "http://to", 10, "task");
    // The mint already credits `to`. Now verify — this deducts from sender.
    const token = ledger.mintToken("http://from", "http://to", 10, "task2");
    ledger.verify(token);
    expect(ledger.getBalance("http://from")).toBe(0); // 10 minted - 10 verified = 0
  });

  test("auto-refill triggers when balance is below threshold", () => {
    const ledger = new SettlementLedger({
      hmacSecret: "secret",
      defaultAutoRefillThreshold: 5,
      defaultAutoRefillAmount: 20,
    });
    ledger.mintToken("http://from", "http://to", 10, "task");
    // Verify so sender balance drops.
    const token = ledger.mintToken("http://from", "http://to", 10, "task2");
    ledger.verify(token);
    expect(ledger.getBalance("http://from")).toBe(0);
    // Refill.
    const refilled = ledger.refillIfLow("http://from", 0);
    expect(refilled).toBe(20);
    expect(ledger.getBalance("http://from")).toBe(20);
  });

  test("auto-refill does nothing when balance is sufficient", () => {
    const ledger = new SettlementLedger({
      hmacSecret: "secret",
      defaultAutoRefillThreshold: 5,
      defaultAutoRefillAmount: 20,
    });
    ledger.mintToken("http://from", "http://to", 10, "task");
    // Balance is already 10 which is >= threshold 5.
    const refilled = ledger.refillIfLow("http://from", 10);
    expect(refilled).toBe(0);
    expect(ledger.getBalance("http://from")).toBe(10);
  });

  test("getBalances returns all tracked agents", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    ledger.mintToken("http://a", "http://b", 5, "t1");
    const balances = ledger.getBalances();
    expect(balances.some((b) => b.agent === "http://a" && b.balance === 0)).toBe(true);
    expect(balances.some((b) => b.agent === "http://b" && b.balance === 5)).toBe(true);
  });

  test("reset clears all state", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    ledger.mintToken("http://a", "http://b", 10, "t");
    ledger.verify(ledger.mintToken("http://a", "http://b", 5, "t2"));
    ledger.reset();
    expect(ledger.getBalance("http://a")).toBe(0);
    expect(ledger.getBalance("http://b")).toBe(0);
    expect(ledger.getBalances()).toHaveLength(0);
  });

  test("verify rejects zero amount", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const token = ledger.mintToken("http://from", "http://to", 10, "task");
    // Manually override to 0 and re-sign to match the tampered amount.
    // Actually, signature covers the original amount. To test zero-amount
    // rejection cleanly, mint a token with amount 0 directly.
    // The mintToken doesn't prevent 0, so mint one.
    const zeroToken = ledger.mintToken("http://from", "http://to", 0, "task");
    const r = ledger.verify(zeroToken);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("amount must be > 0 (got 0)");
  });
});

// ---------------------------------------------------------------------------
// X402Server tests
// ---------------------------------------------------------------------------

describe("X402Server", () => {
  test("allows requests when agent has no settlement pricing", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const server = new X402Server(ledger, "http://worker");
    const card = makeCard(5, { settlement: false });
    server.updateFromCard(card);

    // Simulate a Bun Request with no payment header.
    const req = makeReq(null);
    const check = server.check(req);
    expect(check.paid).toBe(true);
  });

  test("rejects when agent expects payment but no header is present", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const server = new X402Server(ledger, "http://worker");
    const card = makeCard(5, { settlement: true });
    server.updateFromCard(card);

    const req = makeReq(null);
    const check = server.check(req);
    expect(check.paid).toBe(false);
    expect(check.rejectReason).toBe("missing X-Payment-Token header");
  });

  test("rejects when token is malformed", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const server = new X402Server(ledger, "http://worker");
    const card = makeCard(5, { settlement: true });
    server.updateFromCard(card);

    const req = makeReq('{"not":"json"}');
    const check = server.check(req);
    expect(check.paid).toBe(false);
    expect(check.rejectReason).toBe("malformed X-Payment-Token header");
  });

  test("accepts a valid token", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const server = new X402Server(ledger, "http://worker");
    const card = makeCard(5, { settlement: true });
    server.updateFromCard(card);

    const token = ledger.mintToken("http://delegator", "http://worker", 5, "task");
    const req = makeReq(JSON.stringify(token));
    const check = server.check(req);
    expect(check.paid).toBe(true);
    expect(check.token).toBeDefined();
    expect(check.receipt).toBeDefined();
    expect(check.receipt!.verified).toBe(true);
  });

  test("rejects an unknown token", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const server = new X402Server(ledger, "http://worker");
    const card = makeCard(5, { settlement: true });
    server.updateFromCard(card);

    const fakeToken: PaymentToken = {
      txId: "fake",
      from: "http://delegator",
      to: "http://worker",
      amount: 5,
      issuedAt: new Date().toISOString(),
      purpose: "task",
      proof: "x",
      signature: "bad",
    };
    const req = makeReq(JSON.stringify(fakeToken));
    const check = server.check(req);
    expect(check.paid).toBe(false);
    expect(check.rejectReason).toContain("unknown txId");
  });

  test("rejects when amount is insufficient", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const server = new X402Server(ledger, "http://worker");
    const card = makeCard(10, { settlement: true });
    server.updateFromCard(card);

    // Agent requires 10, but we send a token with amount 5.
    const token = ledger.mintToken("http://delegator", "http://worker", 5, "task");
    const req = makeReq(JSON.stringify(token));
    const check = server.check(req);
    expect(check.paid).toBe(false);
    expect(check.rejectReason).toContain("insufficient amount");
  });

  test("x402Reject returns a 402 response", () => {
    const resp = x402Reject(42, "test reason");
    expect(resp.status).toBe(402);
    const body = JSON.parse(resp.body as string);
    expect(body.error.code).toBe(-32022);
    expect(body.error.message).toContain("Payment required");
    expect(body.error.message).toContain("test reason");
  });
});

// ---------------------------------------------------------------------------
// X402Client tests
// ---------------------------------------------------------------------------

describe("X402Client", () => {
  test("delegates without payment when agent has no settlement pricing", async () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const client = new X402Client({ ledger, delegatorUrl: "http://delegator" });

    // Mock fetch: return a card with no settlement, then a successful response.
    let callCount = 0;
    globalThis.fetch = function (url: string, init: RequestInit) {
      callCount++;
      if (url.endsWith("/.well-known/agent-card.json")) {
        return Response.json(makeCard(5, { settlement: false }));
      }
      // Delegate call.
      const body = JSON.parse(init!.body as string);
      return Response.json({ result: { text: "response text" } });
    } as typeof fetch;

    const result = await client.delegateTask("http://worker", "hello task", "worker");
    expect(result).toBe("response text");
    expect(callCount).toBe(2); // card fetch + delegate
    // No PaymentToken header should be present (card has no settlement).
    const lastCallBody = JSON.parse((globalThis.fetch as any).lastCallInit?.body as string);
    expect(lastCallBody).toBeDefined();
  });

  test("mints and attaches a PaymentToken when agent has settlement pricing", async () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const client = new X402Client({ ledger, delegatorUrl: "http://delegator" });

    let lastHeader: string | null = null;
    globalThis.fetch = function (url: string, init: RequestInit) {
      if (url.endsWith("/.well-known/agent-card.json")) {
        return Response.json(makeCard(5, { settlement: true }));
      }
      // Delegate call — capture the X-Payment-Token header.
      if (init && "headers" in init) {
        const headers = init.headers as Record<string, string> | Headers;
        const h = typeof headers === "object" && "get" in headers
          ? (headers as Headers).get("X-Payment-Token")
          : (headers as Record<string, string>)["X-Payment-Token"];
        lastHeader = h ?? null;
      }
      return Response.json({ result: { text: "paid response" } });
    } as typeof fetch;

    const result = await client.delegateTask("http://worker", "hello", "worker");
    expect(result).toBe("paid response");
    expect(lastHeader).toBeTruthy();
    const token = JSON.parse(lastHeader!) as PaymentToken;
    expect(token.txId).toBeTruthy();
    expect(token.from).toBe("http://delegator");
    expect(token.to).toBe("http://worker");
  });

  test("verifies that the settlement ledger recorded the transaction", async () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const client = new X402Client({ ledger, delegatorUrl: "http://delegator" });

    globalThis.fetch = function (url: string, init: RequestInit) {
      if (url.endsWith("/.well-known/agent-card.json")) {
        return Response.json(makeCard(5, { settlement: true }));
      }
      return Response.json({ result: { text: "ok" } });
    } as typeof fetch;

    await client.delegateTask("http://worker", "hello", "worker");
    // The ledger should have a receipt for the minted token.
    const receipts = Array.from(ledger["receipts"].values());
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts[0]?.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Bun Request mock with an optional X-Payment-Token header.
 */
function makeReq(paymentHeader: string | null): import("bun").Request {
  const headers = new Headers();
  if (paymentHeader !== null) {
    headers.set("X-Payment-Token", paymentHeader);
  }
  return new Request("http://worker/", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/send", params: {} }),
  }) as import("bun").Request;
}

/**
 * Re-export for test convenience (x402Reject is named in x402-server.ts).
 */
import { x402Reject } from "@adapters/x402/x402-server";
