import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { WebhookServer } from "@adapters/http/webhook-server";
import { IdempotencyLock } from "@adapters/idempotency-lock";
import { ok } from "@utils/rpc";

/** Integration test for WebhookServer idempotency — POST twice with the same
 * event id, assert first = 200, second = 409. One server per file on a fixed
 * port; the idempotency lock is reset between tests so each test starts clean.
 */

const SECRET = "test-webhook-secret";
const PORT = 51001;

describe("WebhookServer idempotency (integration)", () => {
  let server: WebhookServer;
  let lock: IdempotencyLock;

  beforeAll(() => {
    lock = new IdempotencyLock({ ttlMs: 60_000 });
    server = new WebhookServer({
      port: PORT,
      webhookSecret: SECRET,
      idempotencyLock: lock,
      onEvent: async (payload) => ({ received: true, eventId: payload.eventId }),
    });
    server.start();
  });

  afterAll(() => {
    server.stop();
  });

  const resetLock = () => lock.reset();

  test("first POST → 200, second POST with same eventId → 409", async () => {
    resetLock();

    const body = JSON.stringify({ hello: "world" });

    const first = await fetch(`http://127.0.0.1:${PORT}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Delivery": "evt-first",
        "X-GitHub-Event": "push",
      },
      body,
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { result?: { received: boolean; eventId: string } };
    expect(firstJson.result?.received).toBe(true);
    expect(firstJson.result?.eventId).toBeDefined();

    const second = await fetch(`http://127.0.0.1:${PORT}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Delivery": "evt-first",
        "X-GitHub-Event": "push",
      },
      body,
    });
    expect(second.status).toBe(409);
    const secondJson = (await second.json()) as { error?: { code: number; message: string; data?: { eventId: string } } };
    expect(secondJson.error?.code).toBe(-32003);
    expect(secondJson.error?.message).toBe("Duplicate webhook event — already processed.");
    expect(secondJson.error?.data?.eventId).toBe("evt-first");
    expect(second.headers.get("X-Idempotency-Replay")).toBe("true");
  });

  test("different eventId → 200 (not deduped)", async () => {
    resetLock();

    const body = JSON.stringify({ different: true });
    const first = await fetch(`http://127.0.0.1:${PORT}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Delivery": "evt-a" },
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`http://127.0.0.1:${PORT}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Delivery": "evt-b" },
      body,
    });
    expect(second.status).toBe(200);
    const json = (await second.json()) as { result?: { received: boolean; eventId: string } };
    expect(json.result?.eventId).toBe("evt-b");
  });

  test("hash-based eventId dedup (no delivery header)", async () => {
    resetLock();

    const body = JSON.stringify({ shared: "payload" });
    const first = await fetch(`http://127.0.0.1:${PORT}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`http://127.0.0.1:${PORT}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(second.status).toBe(409);
    const json = (await second.json()) as { error?: { code: number } };
    expect(json.error?.code).toBe(-32003);
  });
});
