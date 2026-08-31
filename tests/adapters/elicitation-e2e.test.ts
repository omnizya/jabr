import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { McpClientAdapter } from "@adapters/mcp-client";
import { FakeElicitationPort } from "@ports/elicitation-port";
import type { ElicitationDecision } from "@ports/elicitation-port";

/**
 * End-to-end elicitation test.
 *
 * Spawns the real MCP tool server (mcp-servers/tools.ts) via McpClientAdapter,
 * wires a FakeElicitationPort that returns the configured decision, then calls
 * the elicitation tools and verifies the server-side response matches the
 * decision — not the old "Authorization declined by user" message.
 */

// ── FakeElicitationPort is re-exported from the port package for test use ──
// (It is defined in tests/adapters/elicitation-port.test.ts but also needed here.)
// We redefine it locally to avoid cross-test imports, since it's test-only.

class LocalFakePort implements
  import("@ports/elicitation-port").ElicitationPort {
  decision: ElicitationDecision = "decline";
  lastRequest: import("@ports/elicitation-port").ElicitationRequest | null = null;

  async elicit(
    request: import("@ports/elicitation-port").ElicitationRequest,
    _timeoutMs: number,
  ): Promise<ElicitationDecision> {
    this.lastRequest = request;
    return this.decision;
  }
}

describe("Elicitation e2e (form mode — accept)", () => {
  let adapter: McpClientAdapter;
  let fakePort: LocalFakePort;

  beforeAll(async () => {
    fakePort = new LocalFakePort();
    fakePort.decision = "accept";
    adapter = new McpClientAdapter(fakePort);
    // ensureClient lazily spawns the MCP server and connects
    await adapter["ensureClient"]();
  });

  afterAll(() => {
    // The adapter owns the transport; close by killing the underlying client.
    // McpClientAdapter doesn't expose close(), but the process will exit when
    // the test suite finishes.
  });

  test("elicit_payment returns approved message (not 'declined by user')", async () => {
    const result = await adapter.callTool("elicit_payment", {
      amount: 42.5,
      recipient: "Test Vendor",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContain("42.50");
    expect(result.content).toContain("Test Vendor");
    expect(result.content).not.toContain("declined by user");
    expect(result.content).toContain("approved");
  });

  test("fake port recorded the elicitation request with correct message", () => {
    expect(fakePort.lastRequest).not.toBeNull();
    expect(fakePort.lastRequest!.mode).toBe("form");
    expect(fakePort.lastRequest!.message).toContain("$42.50");
    expect(fakePort.lastRequest!.message).toContain("Test Vendor");
    expect(fakePort.lastRequest!.requestedSchema).toBeDefined();
  });
});

describe("Elicitation e2e (form mode — decline)", () => {
  let adapter: McpClientAdapter;
  let fakePort: LocalFakePort;

  beforeAll(async () => {
    fakePort = new LocalFakePort();
    fakePort.decision = "decline";
    adapter = new McpClientAdapter(fakePort);
    await adapter["ensureClient"]();
  });

  test("elicit_payment returns declined message (not error)", async () => {
    const result = await adapter.callTool("elicit_payment", {
      amount: 10.0,
      recipient: "Decline Test",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContain("declined by user");
    expect(result.content).not.toContain("approved");
  });
});

describe("Elicitation e2e (URL mode — accept)", () => {
  let adapter: McpClientAdapter;
  let fakePort: LocalFakePort;

  beforeAll(async () => {
    fakePort = new LocalFakePort();
    fakePort.decision = "accept";
    adapter = new McpClientAdapter(fakePort);
    await adapter["ensureClient"]();
  });

  test("elicit_url_auth returns accepted message (not 'declined by user')", async () => {
    const result = await adapter.callTool("elicit_url_auth", {
      provider: "test-oauth",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContain("accepted");
    expect(result.content).not.toContain("declined by user");
  });
});

describe("Elicitation e2e (URL mode — decline)", () => {
  let adapter: McpClientAdapter;
  let fakePort: LocalFakePort;

  beforeAll(async () => {
    fakePort = new LocalFakePort();
    fakePort.decision = "decline";
    adapter = new McpClientAdapter(fakePort);
    await adapter["ensureClient"]();
  });

  test("elicit_url_auth returns declined message (not error)", async () => {
    const result = await adapter.callTool("elicit_url_auth", {
      provider: "test-oauth",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContain("declined by user");
    expect(result.content).not.toContain("accepted");
  });
});
