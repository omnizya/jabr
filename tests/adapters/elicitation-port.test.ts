import { NullElicitationPort } from "@ports/elicitation-port";

/**
 * Tests for the elicitation port layer.
 *
 * These are pure unit tests — no MCP server or transport involved.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { ElicitationPort, ElicitationRequest } from "@ports/elicitation-port";

describe("NullElicitationPort", () => {
  it("always returns decline", async () => {
    const port: ElicitationPort = NullElicitationPort;
    const request: ElicitationRequest = {
      mode: "form",
      message: "Authorize payment?",
      requestedSchema: { type: "object", properties: { approved: { type: "boolean" } } },
    };
    const result = await port.elicit(request, 1000);
    expect(result).toBe("decline");
  });

  it("handles URL-mode requests without crashing", async () => {
    const port: ElicitationPort = NullElicitationPort;
    const request: ElicitationRequest = {
      mode: "url",
      message: "Open this URL to authenticate",
      url: "https://example.com/auth",
      elicitationId: "e1",
    };
    const result = await port.elicit(request, 1000);
    expect(result).toBe("decline");
  });

  it("respects timeout parameter without blocking", async () => {
    const port: ElicitationPort = NullElicitationPort;
    const request: ElicitationRequest = { mode: "form", message: "test" };
    const start = Date.now();
    const result = await port.elicit(request, 5000);
    const elapsed = Date.now() - start;
    expect(result).toBe("decline");
    // Should return nearly instantly, not wait for the timeout
    expect(elapsed).toBeLessThan(100);
  });
});

describe("ElicitationRequest shape", () => {
  it("form mode has requestedSchema", () => {
    const req: ElicitationRequest = {
      mode: "form",
      message: "fill this out",
      requestedSchema: { type: "object", properties: { name: { type: "string" } } },
    };
    expect(req.mode).toBe("form");
    expect(req.requestedSchema).toBeDefined();
  });

  it("url mode has url and elicitationId", () => {
    const req: ElicitationRequest = {
      mode: "url",
      message: "visit this url",
      url: "https://example.com",
      elicitationId: "abc-123",
    };
    expect(req.mode).toBe("url");
    expect(req.url).toBe("https://example.com");
    expect(req.elicitationId).toBe("abc-123");
    expect((req as any).requestedSchema).toBeUndefined();
  });
});

/**
 * A test-only port that returns a configurable decision. Used to simulate
 * the full elicitation callback chain in adapter tests.
 */
class FakeElicitationPort implements ElicitationPort {
  decision: "accept" | "decline" | "cancel" = "decline";
  lastRequest: ElicitationRequest | null = null;

  async elicit(request: ElicitationRequest, _timeoutMs: number): Promise<"accept" | "decline" | "cancel"> {
    this.lastRequest = request;
    return this.decision;
  }
}

describe("FakeElicitationPort", () => {
  it("records the request and returns the configured decision", async () => {
    const port = new FakeElicitationPort();
    port.decision = "accept";
    const req: ElicitationRequest = { mode: "form", message: "pay $5" };
    const result = await port.elicit(req, 10_000);
    expect(result).toBe("accept");
    expect(port.lastRequest).toBe(req);
  });
});
