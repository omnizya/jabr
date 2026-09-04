/**
 * webhook-to-a2a-bridge.test.ts — Unit tests for WebhookToA2ABridge.
 *
 * Strategy: a mock A2AClientPort that records calls and lets us control
 * success/failure. Tests verify:
 *   - onEvent kicks off A2A dispatch (fire-and-forget)
 *   - A2A failures are caught and logged, never thrown
 *   - inner onEvent is called and its result returned
 *   - message is built from webhook payload
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  WebhookToA2ABridge,
  type WebhookEvent,
  type WebhookToA2ABridgeConfig,
} from "@core/webhook-to-a2a-bridge";
import type { A2AClientPort } from "@ports/a2a-client-port";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    eventId: "evt-1",
    source: "github",
    type: "push",
    payload: { ref: "refs/heads/main" },
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

interface MockA2AClient extends A2AClientPort {
  sendTaskAsync: mock.Mock<
    (agentUrl: string, message: string, contextId?: string) => Promise<string>
  >;
  sendTask: mock.Mock<
    (
      agentUrl: string,
      message: string,
      contextId?: string,
    ) => Promise<{ text?: string }>
  >;
  discover: mock.Mock<(agentUrl: string) => Promise<Record<string, unknown>>>;
  healthCheck: mock.Mock<(agentUrl: string) => Promise<boolean>>;
}

function makeMockClient(): MockA2AClient {
  return {
    sendTaskAsync: mock(() => Promise.resolve("task-1")),
    sendTask: mock(() => Promise.resolve({ text: "ok" })),
    discover: mock(() => Promise.resolve({})),
    healthCheck: mock(() => Promise.resolve(true)),
  };
}

function makeBridge(
  client: MockA2AClient,
  hermesUrl = "http://localhost:4000",
  innerEvent?: (payload: WebhookEvent) => Promise<unknown>,
): WebhookToA2ABridge {
  const config: WebhookToA2ABridgeConfig = {
    a2aClient: client,
    hermesUrl,
    onEvent: innerEvent,
  };
  return new WebhookToA2ABridge(config);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("WebhookToA2ABridge", () => {
  let client: MockA2AClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  test("onEvent calls sendTaskAsync with Hermes URL and event message", async () => {
    const bridge = makeBridge(client);
    const event = makeEvent();

    const result = await bridge.onEvent(event);

    // sendTaskAsync should have been called.
    expect(client.sendTaskAsync).toHaveBeenCalledTimes(1);
    const [url, message, contextId] = client.sendTaskAsync.mock.calls[0]!;
    expect(url).toBe("http://localhost:4000");
    expect(message).toContain("Webhook event received");
    expect(message).toContain("evt-1");
    expect(message).toContain("github");
    expect(message).toContain("push");
    expect(contextId).toBe("evt-1");
    // Result is the default { dispatched: true, eventId }.
    expect(result).toEqual({ dispatched: true, eventId: "evt-1" });
  });

  test("onEvent calls inner onEvent and returns its result", async () => {
    const innerEvent = mock((payload: WebhookEvent) =>
      Promise.resolve({ handled: true, id: payload.eventId }),
    );
    const bridge = makeBridge(client, "http://localhost:4000", innerEvent);
    const event = makeEvent({ eventId: "evt-inner" });

    const result = await bridge.onEvent(event);

    expect(innerEvent).toHaveBeenCalledTimes(1);
    expect(innerEvent).toHaveBeenCalledWith(event);
    expect(result).toEqual({ handled: true, id: "evt-inner" });
  });

  test("A2A failure does not throw — webhook response still succeeds", async () => {
    // Make sendTaskAsync reject.
    client.sendTaskAsync = mock(() =>
      Promise.reject(new Error("A2A down")),
    ) as MockA2AClient["sendTaskAsync"];

    const bridge = makeBridge(client);
    const event = makeEvent();

    // Should NOT throw.
    const result = await bridge.onEvent(event);

    expect(result).toEqual({ dispatched: true, eventId: "evt-1" });
    expect(client.sendTaskAsync).toHaveBeenCalledTimes(1);
  });

  test("A2A dispatch is fire-and-forget (not awaited)", async () => {
    // Track when sendTaskAsync resolves relative to onEvent returning.
    let a2aResolved = false;
    client.sendTaskAsync = mock(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            a2aResolved = true;
            resolve("task-1");
          }, 50);
        }),
    ) as MockA2AClient["sendTaskAsync"];

    const bridge = makeBridge(client);
    const event = makeEvent();

    const result = await bridge.onEvent(event);

    // onEvent should have returned BEFORE the A2A call resolved.
    expect(result).toEqual({ dispatched: true, eventId: "evt-1" });
    expect(a2aResolved).toBe(false);
  });

  test("message includes payload JSON", async () => {
    const bridge = makeBridge(client);
    const event = makeEvent({
      payload: { action: "opened", sender: { login: "test" } },
    });

    await bridge.onEvent(event);

    const [, message] = client.sendTaskAsync.mock.calls[0]!;
    expect(message).toContain('"action":"opened"');
    expect(message).toContain('"login":"test"');
  });

  test("message includes ISO timestamp", async () => {
    const bridge = makeBridge(client);
    const event = makeEvent({ timestamp: 1_700_000_000_000 });

    await bridge.onEvent(event);

    const [, message] = client.sendTaskAsync.mock.calls[0]!;
    // 1_700_000_000_000 → 2023-11-14T22:13:20.000Z
    expect(message).toContain("2023-11-14T22:13:20.000Z");
  });
});
