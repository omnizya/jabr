import { describe, test, expect } from "bun:test";
import { RateLimiter, rateLimitResponse } from "@adapters/rate-limit";

describe("RateLimiter", () => {
  test("allows requests under the limit", () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const req = new Request("http://localhost/", { headers: { "X-API-Key": "key1" } });
    for (let i = 0; i < 5; i++) {
      const result = rl.check(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - i - 1);
    }
  });

  test("blocks requests over the limit", () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const req = new Request("http://localhost/", { headers: { "X-API-Key": "key1" } });
    for (let i = 0; i < 3; i++) rl.check(req);
    const result = rl.check(req);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("tracks different callers independently", () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req1 = new Request("http://localhost/", { headers: { "X-API-Key": "key1" } });
    const req2 = new Request("http://localhost/", { headers: { "X-API-Key": "key2" } });
    rl.check(req1);
    rl.check(req1);
    // key1 is now at limit
    expect(rl.check(req1).allowed).toBe(false);
    // key2 still has quota
    expect(rl.check(req2).allowed).toBe(true);
  });

  test("resets after window expires", async () => {
    const rl = new RateLimiter({ windowMs: 50, maxRequests: 1 });
    const req = new Request("http://localhost/", { headers: { "X-API-Key": "key1" } });
    expect(rl.check(req).allowed).toBe(true);
    expect(rl.check(req).allowed).toBe(false);
    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));
    expect(rl.check(req).allowed).toBe(true);
  });

  test("rateLimitResponse returns 429 with Retry-After", () => {
    const resp = rateLimitResponse(30_000);
    expect(resp.status).toBe(429);
    expect(resp.headers["Retry-After"]).toBe("30");
    expect(resp.body.error.code).toBe(-32002);
  });

  test("getSnapshot returns current state", () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });
    const req = new Request("http://localhost/", { headers: { "X-API-Key": "key1" } });
    rl.check(req);
    rl.check(req);
    const snapshot = rl.getSnapshot();
    expect(snapshot["key:key1"]).toBeDefined();
    expect(snapshot["key:key1"].used).toBe(2);
    expect(snapshot["key:key1"].cap).toBe(10);
  });

  test("reset clears all windows", () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const req = new Request("http://localhost/", { headers: { "X-API-Key": "key1" } });
    rl.check(req);
    expect(rl.check(req).allowed).toBe(false);
    rl.reset();
    expect(rl.check(req).allowed).toBe(true);
  });
});
