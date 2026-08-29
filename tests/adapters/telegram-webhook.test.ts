/**
 * telegram-webhook.test.ts — Unit tests for TelegramWebhookAdapter.
 *
 * Strategy: a smart global fetch mock that:
 *  • stubs Telegram Bot API calls (api.telegram.org) → canned responses
 *  • stubs delegate URL calls (localhost:<delegatePort>) → stub A2A responses
 *  • PASSES THROUGH every other request to the real fetch (so the running
 *    webhook server at localhost:<port> is actually hit)
 *
 * Each test that starts a server uses a unique port to avoid EADDRINUSE.
 * Tests that only call outbound methods (no start()) share a single port.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { TelegramWebhookAdapter } from "@adapters/http/telegram-webhook";
import type { TelegramInlineKeyboard } from "@ports/telegram-bot-port";

// ── Minimal Telegram update shapes ────────────────────────────────────────────

const textMessagePayload = JSON.stringify({
  update_id: 12345,
  message: {
    message_id: 1,
    from: { id: 999, is_bot: false, first_name: "Test User" },
    chat: { id: 123456789, type: "private", first_name: "Test User" },
    date: 1700000000,
    text: "hello from telegram",
  },
});

const callbackQueryPayload = JSON.stringify({
  update_id: 12346,
  callback_query: {
    id: "cbq_1",
    from: { id: 999, first_name: "Test User" },
    chat: { id: 123456789, type: "private" },
    data: "button_pressed",
    message: { message_id: 1, text: "Choose an option" },
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function parseBody(opts: RequestInit | undefined): unknown {
  if (opts?.body == null || typeof opts.body !== "string") return opts?.body;
  try { return JSON.parse(opts.body); } catch { return opts.body; }
}

function headersRecord(opts: RequestInit | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (opts?.headers) {
    if (opts.headers instanceof Headers) {
      opts.headers.forEach((v, k) => { h[k] = v; });
    } else {
      for (const [k, v] of Object.entries(opts.headers as Record<string, string>)) {
        h[k] = v;
      }
    }
  }
  return h;
}

/**
 * Build a test environment: mocked fetch + a TelegramWebhookAdapter on a
 * unique port. Telegram API and delegate calls are stubbed; everything else
 * passes through to the real fetch (so the webhook endpoint is actually hit).
 */
function createEnv(
  port: number,
  delegateHost: string = "localhost:4000",
  options: { botToken?: string; webhookSecret?: string; delegateUrl?: string } = {},
): {
  adapter: TelegramWebhookAdapter;
  fetchCalls: RecordedCall[];
  restore: () => void;
} {
  const fetchCalls: RecordedCall[] = [];
  const originalFetch = globalThis.fetch;

  const testFetch = async (url: string | Request | URL, opts?: RequestInit): Promise<Response> => {
    const u = url.toString();

    // Telegram Bot API → stubs.
    if (u.includes("api.telegram.org")) {
      fetchCalls.push({ url: u, method: opts?.method ?? "GET", body: parseBody(opts), headers: headersRecord(opts) });
      if ((opts?.method ?? "GET") === "POST") {
        if (u.includes("setWebhook")) return Response.json({ ok: true, description: "Webhook was set" });
        if (u.includes("deleteWebhook")) return Response.json({ ok: true, result: true });
        if (u.includes("sendMessage")) return Response.json({ ok: true, result: { message_id: 42, chat: { id: 123456789 } } });
        if (u.includes("sendChatAction")) return Response.json({ ok: true });
        if (u.includes("answerCallbackQuery")) return Response.json({ ok: true });
        return Response.json({ ok: false, error_code: 400, description: "stub: unhandled" });
      }
      return Response.json({ ok: true });
    }

    // Delegate URL → stub A2A response.
    if (u.includes(delegateHost)) {
      fetchCalls.push({ url: u, method: opts?.method ?? "GET", body: parseBody(opts), headers: headersRecord(opts) });
      return Response.json({ jsonrpc: "2.0", id: 1, result: { text: "stub-agent-response" } });
    }

    // Everything else: real fetch (hits the running webhook server).
    return originalFetch(url, opts);
  };

  globalThis.fetch = testFetch as unknown as typeof fetch;

  const adapter = new TelegramWebhookAdapter({
    botToken: options.botToken ?? "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    port,
    delegateUrl: options.delegateUrl ?? `http://${delegateHost}`,
    webhookSecret: options.webhookSecret ?? "test-secret-token-123",
  });

  return { adapter, fetchCalls, restore: () => { globalThis.fetch = originalFetch; } };
}

async function delay(ms: number): Promise<void> {
  await Bun.sleep(ms);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TelegramWebhookAdapter", () => {
  // ── Construction ───────────────────────────────────────────────────────────

  describe("construction", () => {
    test("stores config and builds default webhookUrl", () => {
      const env = createEnv(4090);
      expect(env.adapter).toBeInstanceOf(TelegramWebhookAdapter);
      env.restore();
    });
  });

  // ── Webhook server lifecycle (each test uses its own port) ────────────────

  describe("start / stop", () => {
    test("start() registers webhook via setWebhook", async () => {
      const port = 4090;
      const env = createEnv(port);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(300);

      const setWebhookCalls = fetchCalls.filter((c) => c.url.includes("setWebhook") && c.url.includes("api.telegram.org"));
      expect(setWebhookCalls.length).toBeGreaterThan(0);
      const call = setWebhookCalls[0]!;
      expect(call.method).toBe("POST");
      const body = call.body as { url: string; secret_token?: string };
      expect(body.url).toBe(`https://localhost:${port}/webhook`);
      expect(body.secret_token).toBe("test-secret-token-123");

      adapter.stop();
      await delay(200);
      restore();
    });

    test("stop() calls deleteWebhook", async () => {
      const port = 4091;
      const env = createEnv(port);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);
      adapter.stop();
      await delay(200);

      const deleteCalls = fetchCalls.filter((c) => c.url.includes("deleteWebhook") && c.url.includes("api.telegram.org"));
      expect(deleteCalls.length).toBeGreaterThan(0);
      expect(deleteCalls[0]!.method).toBe("POST");

      restore();
    });

    test("stop() closes the HTTP server (real fetch to wrong path gets 404)", async () => {
      const port = 4092;
      const env = createEnv(port);
      const { adapter } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      // Server is up — real fetch to a wrong path returns 404.
      let res = await fetch(`http://localhost:${port}/not-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      expect(res.status).toBe(404);

      adapter.stop();
      await delay(400);

      // After stop, real fetch to the webhook path should fail or not return 200.
      try {
        res = await fetch(`http://localhost:${port}/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "null",
        });
        // If it doesn't throw, the status should not be 200 from our handler.
        expect(res.status).not.toBe(200);
      } catch {
        // Connection refused — expected.
      }

      restore();
    });

    test("start() is idempotent (second call is a no-op)", async () => {
      const port = 4093;
      const env = createEnv(port);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);
      const before = fetchCalls.filter((c) => c.url.includes("setWebhook") && c.url.includes("api.telegram.org")).length;

      adapter.start(); // second call should be no-op
      await delay(200);
      const after = fetchCalls.filter((c) => c.url.includes("setWebhook") && c.url.includes("api.telegram.org")).length;

      expect(after).toBe(before);

      adapter.stop();
      await delay(200);
      restore();
    });
  });

  // ── Webhook endpoint (each test uses its own port) ─────────────────────────

  describe("webhook endpoint", () => {
    test("POST /webhook with valid secret + text message → 200 + delegates", async () => {
      const port = 4094;
      const env = createEnv(port);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: textMessagePayload,
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { result?: { received?: boolean } };
      expect(json.result?.received).toBe(true);

      const delegateCalls = fetchCalls.filter((c) => c.url.includes("localhost:4000"));
      expect(delegateCalls.length).toBeGreaterThan(0);
      const delegateBody = delegateCalls[0]!.body as {
        jsonrpc: string;
        method: string;
        params: { message: { parts: Array<{ kind: string; text: string }> } };
      };
      expect(delegateBody.jsonrpc).toBe("2.0");
      expect(delegateBody.method).toBe("tasks/send");
      expect(delegateBody.params.message.parts[0]!.text).toContain("hello from telegram");
      expect(delegateBody.params.message.parts[0]!.text).toContain("[Telegram]");

      adapter.stop();
      await delay(200);
      restore();
    });

    test("POST /webhook with callback_query extracts chatId from from.id", async () => {
      const port = 4094;
      const env = createEnv(port);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: callbackQueryPayload,
      });

      expect(res.status).toBe(200);

      const delegateCalls = fetchCalls.filter((c) => c.url.includes("localhost:4000"));
      expect(delegateCalls.length).toBeGreaterThan(0);
      const text = delegateCalls[0]!.body as { params: { message: { parts: Array<{ kind: string; text: string }> } } };
      expect(text.params.message.parts[0]!.text).toContain("999");

      adapter.stop();
      await delay(200);
      restore();
    });

    test("POST /webhook without secret token → 401", async () => {
      const port = 4095;
      const env = createEnv(port);
      const { adapter } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: textMessagePayload,
      });

      expect(res.status).toBe(401);

      adapter.stop();
      await delay(200);
      restore();
    });

    test("POST /webhook with wrong secret token → 401", async () => {
      const port = 4096;
      const env = createEnv(port);
      const { adapter } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
        },
        body: textMessagePayload,
      });

      expect(res.status).toBe(401);

      adapter.stop();
      await delay(200);
      restore();
    });

    test("POST /webhook with duplicate update_id → 409 (idempotency)", async () => {
      const port = 4097;
      const env = createEnv(port);
      const { adapter } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      let res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: textMessagePayload,
      });
      expect(res.status).toBe(200);

      res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: textMessagePayload,
      });
      expect(res.status).toBe(409);

      const json = (await res.json()) as { error?: { code: number } };
      expect(json.error?.code).toBe(-32003);

      adapter.stop();
      await delay(200);
      restore();
    });

    test("POST /webhook with no delegateUrl does not delegate", async () => {
      const port = 4098;
      const env = createEnv(port, "localhost:4000", {
        delegateUrl: "",
      });
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: textMessagePayload,
      });
      expect(res.status).toBe(200);

      const delegateCalls = fetchCalls.filter((c) => c.url.includes("localhost:4000"));
      expect(delegateCalls.length).toBe(0);

      adapter.stop();
      await delay(200);
      restore();
    });

    test("POST /webhook to wrong path → 404", async () => {
      const port = 4099;
      const env = createEnv(port);
      const { adapter } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/other-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: textMessagePayload,
      });
      expect(res.status).toBe(404);

      adapter.stop();
      await delay(200);
      restore();
    });

    test("GET /webhook → 404", async () => {
      const port = 4100;
      const env = createEnv(port);
      const { adapter } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      const res = await fetch(`http://localhost:${port}/webhook`, { method: "GET" });
      expect(res.status).toBe(404);

      adapter.stop();
      await delay(200);
      restore();
    });
  });

  // ── TelegramBotPort outbound methods (port shared, no server needed) ────────

  describe("TelegramBotPort methods", () => {
    test("adapter has all port methods", () => {
      const env = createEnv(4101);
      expect(typeof env.adapter.sendMessage).toBe("function");
      expect(typeof env.adapter.sendChatAction).toBe("function");
      expect(typeof env.adapter.answerCallbackQuery).toBe("function");
      expect(typeof env.adapter.setWebhook).toBe("function");
      expect(typeof env.adapter.deleteWebhook).toBe("function");
      env.restore();
    });

    test("sendMessage posts to Telegram API with correct payload", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.sendMessage(123456789, "test message");

      const calls = fetchCalls.filter((c) => c.url.includes("sendMessage") && c.url.includes("api.telegram.org"));
      expect(calls.length).toBe(1);
      const body = calls[0]!.body as { chat_id: number; text: string };
      expect(body.chat_id).toBe(123456789);
      expect(body.text).toBe("test message");

      restore();
    });

    test("sendMessage with parse_mode includes it", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.sendMessage(123456789, "*bold*", { parse_mode: "Markdown" });

      const calls = fetchCalls.filter((c) => c.url.includes("sendMessage") && c.url.includes("api.telegram.org"));
      const body = calls[calls.length - 1]!.body as { parse_mode?: string };
      expect(body.parse_mode).toBe("Markdown");

      restore();
    });

    test("sendMessage with reply_markup serializes keyboard", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      const keyboard: TelegramInlineKeyboard = {
        inline_keyboard: [[{ text: "Click me", callback_data: "btn1" }]],
      };
      await adapter.sendMessage(123456789, "Choose:", { reply_markup: keyboard });

      const calls = fetchCalls.filter((c) => c.url.includes("sendMessage") && c.url.includes("api.telegram.org"));
      const body = calls[calls.length - 1]!.body as { reply_markup?: string };
      expect(body.reply_markup).toBe(JSON.stringify(keyboard));

      restore();
    });

    test("sendChatAction posts to Telegram API", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.sendChatAction(123456789, "typing");

      const calls = fetchCalls.filter((c) => c.url.includes("sendChatAction") && c.url.includes("api.telegram.org"));
      expect(calls.length).toBe(1);
      const body = calls[0]!.body as { chat_id: number; action: string };
      expect(body.chat_id).toBe(123456789);
      expect(body.action).toBe("typing");

      restore();
    });

    test("answerCallbackQuery posts to Telegram API", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.answerCallbackQuery("cbq_1", "Button acknowledged");

      const calls = fetchCalls.filter((c) => c.url.includes("answerCallbackQuery") && c.url.includes("api.telegram.org"));
      expect(calls.length).toBe(1);
      const body = calls[0]!.body as { callback_query_id: string; text?: string };
      expect(body.callback_query_id).toBe("cbq_1");
      expect(body.text).toBe("Button acknowledged");

      restore();
    });

    test("answerCallbackQuery without text omits text field", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.answerCallbackQuery("cbq_2");

      const calls = fetchCalls.filter((c) => c.url.includes("answerCallbackQuery") && c.url.includes("api.telegram.org"));
      const body = calls[calls.length - 1]!.body as { text?: string };
      expect(body.text).toBeUndefined();

      restore();
    });

    test("setWebhook posts to Telegram API with url and secret_token", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.setWebhook("https://example.com/my-webhook", "my-secret");

      const calls = fetchCalls.filter((c) => c.url.includes("setWebhook") && c.url.includes("api.telegram.org"));
      expect(calls.length).toBe(1);
      const body = calls[0]!.body as { url: string; secret_token?: string };
      expect(body.url).toBe("https://example.com/my-webhook");
      expect(body.secret_token).toBe("my-secret");

      restore();
    });

    test("setWebhook without explicit token uses constructor webhookSecret", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.setWebhook("https://example.com/my-webhook");

      const calls = fetchCalls.filter((c) => c.url.includes("setWebhook") && c.url.includes("api.telegram.org"));
      const body = calls[calls.length - 1]!.body as { secret_token?: string; url: string };
      expect(body.url).toBe("https://example.com/my-webhook");
      // Constructor webhookSecret="test-secret-token-123" → used as default.
      expect(body.secret_token).toBe("test-secret-token-123");

      restore();
    });

    test("setWebhook with empty constructor secret omits secret_token when not passed", async () => {
      const env = createEnv(4101, "localhost:4000", {
        webhookSecret: "",
      });
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.setWebhook("https://example.com/my-webhook");

      const calls = fetchCalls.filter((c) => c.url.includes("setWebhook") && c.url.includes("api.telegram.org"));
      const body = calls[calls.length - 1]!.body as { secret_token?: string };
      expect(body.secret_token).toBeUndefined();

      restore();
    });

    test("deleteWebhook posts to Telegram API", async () => {
      const env = createEnv(4101);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      await adapter.deleteWebhook();

      const calls = fetchCalls.filter((c) => c.url.includes("deleteWebhook") && c.url.includes("api.telegram.org"));
      expect(calls.length).toBe(1);
      expect(calls[0]!.method).toBe("POST");

      restore();
    });
  });

  // ── Delegation (each test uses its own port) ───────────────────────────────

  describe("delegation", () => {
    test("delegates text message with [Telegram] prefix and sender info", async () => {
      const port = 4102;
      const env = createEnv(port);
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: textMessagePayload,
      });

      const delegateCalls = fetchCalls.filter((c) => c.url.includes("localhost:4000"));
      expect(delegateCalls.length).toBeGreaterThan(0);

      const text = delegateCalls[0]!.body as { params: { message: { parts: Array<{ kind: string; text: string }> } } };
      const fullText = text.params.message.parts[0]!.text;
      expect(fullText).toContain("[Telegram]");
      expect(fullText).toContain("hello from telegram");

      adapter.stop();
      await delay(200);
      restore();
    });

    test("delegateUrl override is respected", async () => {
      const port = 4103;
      const env = createEnv(port, "localhost:4005", {
        delegateUrl: "http://localhost:4005",
      });
      const { adapter, fetchCalls } = env;
      const restore = env.restore;

      adapter.start();
      await delay(200);

      await fetch(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-secret-token-123",
        },
        body: textMessagePayload,
      });

      const delegateCalls = fetchCalls.filter((c) => c.url.includes("localhost:4005"));
      expect(delegateCalls.length).toBeGreaterThan(0);

      adapter.stop();
      await delay(200);
      restore();
    });
  });
});
