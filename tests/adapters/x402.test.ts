/**
 * Unit tests for the x402 payment settlement layer.
 *
 * Covers: SettlementLedger mint/verify/refill, X402Server payment checks,
 * and the X402Client delegation flow with a mock server.
 */

import { describe, expect, test } from "bun:test";
import { SettlementLedger } from "@adapters/x402/settlement-ledger";
import { X402Server, x402Reject } from "@adapters/x402/x402-server";
import { X402Client } from "@adapters/x402/x402-client";
import type { AgentCard } from "@agents/types";
import type { PaymentToken } from "@adapters/x402/types";

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
    // Mint a token for http://other, then re-sign with a different `to`.
    // We can't re-use a minted token's txId with a different `to` because
    // the signature is tied to the mint record. Instead, mint one for A,
    // then construct a new token with a different txId but pointing `to` to
    // the wrong agent — the ledger won't have a mint record for it.
    const badToken: PaymentToken = {
      txId: crypto.randomUUID(),
      from: "http://from",
      to: "http://wrong-agent",
      amount: 10,
      issuedAt: new Date().toISOString(),
      purpose: "task",
      proof: "x",
      signature: "bad",
    };
    const r = ledger.verify(badToken);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("unknown txId (not minted)");
    // Now mint for the right agent and verify — then mutate `to` and re-sign
    // with a tampered signature to test the "not addressed" path specifically.
    const token = ledger.mintToken("http://from", "http://worker", 10, "task");
    const tampered = { ...token, to: "http://wrong" };
    // Re-compute signature with tampered `to`.
    const Hmac = (await import("node:crypto")).createHmac;
    tampered.signature = Hmac("sha256", "secret")
      .update(`${tampered.txId}\n${tampered.from}\n${tampered.to}\n${tampered.amount}\n${tampered.issuedAt}\n${tampered.purpose}\n${tampered.proof}`)
      .digest("hex");
    // This token has a valid sig but `to` doesn't match the mint record.
    const r2 = ledger.verify(tampered);
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
    // Mint to `http://from` (as recipient) so its balance is 10.
    ledger.mintToken("http://someone", "http://from", 10, "task");
    // Balance is 10 which is >= threshold 5.
    const refilled = ledger.refillIfLow("http://from", 10);
    expect(refilled).toBe(0);
    expect(ledger.getBalance("http://from")).toBe(10);
  });

  test("getBalances returns all tracked agents", () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    ledger.mintToken("http://a", "http://b", 5, "t1"); // b gets 5
    ledger.mintToken("http://c", "http://a", 3, "t2"); // a gets 3
    const balances = ledger.getBalances();
    expect(balances.some((b) => b.agent === "http://a" && b.balance === 3)).toBe(true);
    expect(balances.some((b) => b.agent === "http://b" && b.balance === 5)).toBe(true);
    expect(balances.some((b) => b.agent === "http://c")).toBe(false); // c never received
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

    // A genuinely unparseable header value (not JSON).
    const req = makeReq('not-json{{{');
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
    const bodyText = resp.body instanceof ReadableStream
      ? "" // Bun Response.body is a stream; parse from a clone instead.
      : resp.body as string;
    // For Bun, resp.text() works but is async. Use a sync path:
    const body = (() => {
      // Bun Response.json() parses the body; fall back to text.
      try {
        return resp.json() as Promise<any>;
      } catch {
        return { error: { code: -1 } };
      }
    })();
    // resp.json() is async; in a sync test we check the status only and
    // trust the implementation. The error code is set in x402Reject.
    // Do an async check via a separate test. Here just verify status 402.
    // For full body verification, use an async test.
    expect(resp.status).toBe(402);
  });

  test("x402Reject body contains payment-required error (async)", async () => {
    const resp = x402Reject(42, "test reason");
    const data = await resp.json();
    expect(data.error.code).toBe(-32022);
    expect(data.error.message).toContain("Payment required");
    expect(data.error.message).toContain("test reason");
  });
});

// ---------------------------------------------------------------------------
// X402Client tests
// ---------------------------------------------------------------------------

describe("X402Client", () => {
  test("delegates without payment when agent has no settlement pricing", async () => {
    const ledger = new SettlementLedger({ hmacSecret: "secret" });
    const client = new X402Client({ ledger, delegatorUrl: "http://delegator" });

    let lastInit: RequestInit | null = null;
    globalThis.fetch = function (url: string, init: RequestInit) {
      lastInit = init;
      if (url.endsWith("/.well-known/agent-card.json")) {
        return Response.json(makeCard(5, { settlement: false }));
      }
      const body = JSON.parse(init!.body as string);
      return Response.json({ result: { text: "response text" } });
    } as typeof fetch;

    const result = await client.delegateTask("http://worker", "hello task", "worker");
    expect(result).toBe("response text");
    // No PaymentToken header should be present.
    const headers = lastInit?.headers as Headers | undefined;
    const paymentHeader = headers?.get("X-Payment-Token");
    expect(paymentHeader).toBeNull();
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

    let txId: string | null = null;
    globalThis.fetch = function (url: string, init: RequestInit) {
      if (url.endsWith("/.well-known/agent-card.json")) {
        return Response.json(makeCard(5, { settlement: true }));
      }
      // Capture the txId from the PaymentToken header.
      const headers = init?.headers as Headers | undefined;
      const h = headers?.get("X-Payment-Token");
      if (h) {
        const token = JSON.parse(h) as PaymentToken;
        txId = token.txId;
      }
      return Response.json({ result: { text: "ok" } });
    } as typeof fetch;

    await client.delegateTask("http://worker", "hello", "worker");
    expect(txId).toBeTruthy();
    const receipt = ledger.getReceipt(txId!);
    expect(receipt).toBeDefined();
    expect(receipt!.verified).toBe(true);
    expect(receipt!.to).toBe("http://worker");
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
