import { describe, test, expect, mock } from "bun:test";
import { IdempotencyLock, idempotencyConflictResponse } from "@adapters/idempotency-lock";

describe("IdempotencyLock", () => {
  test("acquire returns acquired:true for a fresh eventId", () => {
    const lock = new IdempotencyLock({ ttlMs: 60_000 });
    const result = lock.acquire("evt-1");
    expect(result.acquired).toBe(true);
    expect(result.ttlRemainingMs).toBe(60_000);
    expect(result.acquiredAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  test("acquire returns acquired:false for a replayed eventId within TTL", () => {
    const lock = new IdempotencyLock({ ttlMs: 60_000 });
    lock.acquire("evt-1");
    const result = lock.acquire("evt-1");
    expect(result.acquired).toBe(false);
    // On an immediate replay the remaining TTL is ~full; just confirm it's
    // within the valid range and the lock was not re-acquired.
    expect(result.ttlRemainingMs).toBeGreaterThan(0);
    expect(result.ttlRemainingMs).toBeLessThanOrEqual(60_000);
  });

  test("acquire refreshes the lock when the prior TTL has expired", async () => {
    const lock = new IdempotencyLock({ ttlMs: 50 });
    lock.acquire("evt-1");
    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 60));
    const result = lock.acquire("evt-1");
    expect(result.acquired).toBe(true);
    expect(result.ttlRemainingMs).toBe(50);
  });

  test("isLocked returns true for a locked eventId", () => {
    const lock = new IdempotencyLock({ ttlMs: 60_000 });
    lock.acquire("evt-1");
    expect(lock.isLocked("evt-1")).toBe(true);
    expect(lock.isLocked("evt-2")).toBe(false);
  });

  test("isLocked returns false after TTL expires", async () => {
    const lock = new IdempotencyLock({ ttlMs: 50 });
    lock.acquire("evt-1");
    await new Promise((r) => setTimeout(r, 60));
    expect(lock.isLocked("evt-1")).toBe(false);
  });

  test("multiple eventIds are tracked independently", () => {
    const lock = new IdempotencyLock({ ttlMs: 60_000 });
    lock.acquire("evt-1");
    lock.acquire("evt-2");
    expect(lock.acquire("evt-1").acquired).toBe(false);
    expect(lock.acquire("evt-2").acquired).toBe(false);
    expect(lock.acquire("evt-3").acquired).toBe(true);
  });

  test("getSnapshot returns current state for all locked events", () => {
    const lock = new IdempotencyLock({ ttlMs: 60_000 });
    lock.acquire("evt-1");
    lock.acquire("evt-2");
    const snapshot = lock.getSnapshot();
    expect(snapshot["evt-1"]).toBeDefined();
    expect(snapshot["evt-2"]).toBeDefined();
    expect(snapshot["evt-1"]!.acquiredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot["evt-1"]!.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot["evt-1"]!.ttlRemainingMs).toBeGreaterThan(0);
  });

  test("getSnapshot excludes expired entries", async () => {
    const lock = new IdempotencyLock({ ttlMs: 50 });
    lock.acquire("evt-1");
    await new Promise((r) => setTimeout(r, 60));
    const snapshot = lock.getSnapshot();
    expect(snapshot["evt-1"]).toBeUndefined();
  });

  test("reset clears all locks", () => {
    const lock = new IdempotencyLock({ ttlMs: 60_000 });
    lock.acquire("evt-1");
    lock.acquire("evt-2");
    lock.reset();
    expect(lock.isLocked("evt-1")).toBe(false);
    expect(lock.isLocked("evt-2")).toBe(false);
    expect(lock.acquire("evt-1").acquired).toBe(true);
  });

  test("default TTL is 24h when no config or env is provided", () => {
    const lock = new IdempotencyLock();
    expect(lock.ttlMs).toBe(86_400_000);
    const result = lock.acquire("evt-1");
    expect(result.ttlRemainingMs).toBe(86_400_000);
  });

  test("TTL is configurable via constructor", () => {
    const lock = new IdempotencyLock({ ttlMs: 12_000 });
    expect(lock.ttlMs).toBe(12_000);
    const result = lock.acquire("evt-1");
    expect(result.ttlRemainingMs).toBe(12_000);
  });

  test("ttlRemainingMs decays as time passes for an active lock", async () => {
    const lock = new IdempotencyLock({ ttlMs: 500 });
    const first = lock.acquire("evt-1");
    expect(first.ttlRemainingMs).toBe(500);
    // Wait long enough that the remaining TTL is visibly less than the cap.
    await new Promise((r) => setTimeout(r, 100));
    const second = lock.acquire("evt-1");
    expect(second.acquired).toBe(false);
    expect(second.ttlRemainingMs).toBeLessThan(500);
    expect(second.ttlRemainingMs).toBeGreaterThan(0);
  });
});

describe("idempotencyConflictResponse", () => {
  test("returns 409 status with JSON-RPC error shape", () => {
    const resp = idempotencyConflictResponse("evt-42");
    expect(resp.status).toBe(409);
    const body = resp.body as { jsonrpc: string; id: unknown; error: { code: number; message: string; data: { eventId: string; ttlRemainingMs: number } } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(null);
    expect(body.error.code).toBe(-32003);
    expect(body.error.message).toBe("Duplicate webhook event — already processed.");
    expect(body.error.data.eventId).toBe("evt-42");
  });

  test("sets X-Idempotency-Replay header to true", () => {
    const resp = idempotencyConflictResponse("evt-42");
    expect(resp.headers["X-Idempotency-Replay"]).toBe("true");
    expect(resp.headers["Content-Type"]).toBe("application/json");
  });
});
