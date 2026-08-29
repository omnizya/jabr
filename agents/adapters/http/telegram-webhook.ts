import type { TelegramBotPort, TelegramParseMode, TelegramChatAction, TelegramInlineKeyboard } from "@ports/telegram-bot-port";
import { WebhookServer } from "./webhook-server";
import { ok } from "@utils/rpc";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramWebhookAdapterConfig {
  /** Telegram Bot token from @BotFather. Required. */
  botToken: string;
  /** Port for the Bun.serve webhook receiver. Default 4008. */
  port?: number;
  /** Which agent URL to delegate incoming Telegram updates to. */
  delegateUrl?: string;
  /** Shared secret token echoed in X-Telegram-Bot-Api-Secret-Token header
   *  so the receiver can verify the request came from Telegram. */
  webhookSecret?: string;
  /** Optional webhook URL override. Defaults to https://{host}:{port}/webhook. */
  webhookUrl?: string;
  /** Hostname for the default webhook URL. Default "localhost". */
  host?: string;
}

export class TelegramWebhookAdapter implements TelegramBotPort {
  private readonly botToken: string;
  private readonly port: number;
  private readonly delegateUrl: string;
  private readonly webhookSecret: string;
  private readonly webhookUrl: string;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private webhookServer: WebhookServer | null = null;

  constructor(config: TelegramWebhookAdapterConfig) {
    this.botToken = config.botToken;
    this.port = config.port ?? 4008;
    this.delegateUrl = config.delegateUrl ?? "";
    this.webhookSecret = config.webhookSecret ?? "";
    const host = config.host ?? "localhost";
    const port = this.port;
    this.webhookUrl =
      config.webhookUrl ??
      `https://${host}:${port}/webhook`;
  }

  // ---- Webhook lifecycle ----

  /**
   * Register the webhook URL with Telegram via setWebhook.
   * Call once on startup. Subsequent calls are no-ops if the server is already
   * listening (the URL won't have changed).
   */
  async setWebhook(url: string, secretToken?: string): Promise<void> {
    const token = secretToken ?? this.webhookSecret;
    const payload: Record<string, unknown> = { url };
    if (token) payload.secret_token = token;

    console.log(`[TelegramWebhookAdapter] setWebhook url=${url}${token ? ` secret_token=****` : ""}`);
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${this.botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json()) as { ok: boolean; description?: string; error_code?: number };
    if (!json.ok) {
      throw new Error(`Telegram setWebhook failed (code=${json.error_code}): ${json.description}`);
    }
    console.log(`[TelegramWebhookAdapter] setWebhook → ok`);
  }

  async deleteWebhook(): Promise<void> {
    console.log(`[TelegramWebhookAdapter] deleteWebhook`);
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${this.botToken}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = (await resp.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram deleteWebhook failed: ${json.description}`);
    }
    console.log(`[TelegramWebhookAdapter] deleteWebhook → ok`);
  }

  // ---- Sending messages ----

  async sendMessage(
    chatId: number,
    text: string,
    options?: { parse_mode?: TelegramParseMode; reply_markup?: TelegramInlineKeyboard },
  ): Promise<void> {
    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (options?.parse_mode) payload.parse_mode = options.parse_mode;
    if (options?.reply_markup) payload.reply_markup = JSON.stringify(options.reply_markup);

    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram sendMessage failed: ${json.description}`);
    }
  }

  async sendChatAction(chatId: number, action: TelegramChatAction): Promise<void> {
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${this.botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
    const json = (await resp.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram sendChatAction failed: ${json.description}`);
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;

    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${this.botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram answerCallbackQuery failed: ${json.description}`);
    }
  }

  // ---- Server ----

  start(): void {
    if (this.server) return;

    this.webhookServer = new WebhookServer({
      port: this.port,
      webhookSecret: this.webhookSecret,
      onEvent: async (payload) => {
        const p = payload.payload as Record<string, unknown>;
        const updateId = p.update_id as number | undefined;
        const chatId = (p.message as { chat?: { id?: number } })?.chat?.id
          ?? (p.callback_query as { from?: { id?: number } })?.from?.id;
        console.log(`[TelegramWebhookAdapter] ← event update_id=${updateId} chat_id=${chatId}`);
        // Forward to the delegate agent if configured.
        if (this.delegateUrl) {
          try {
            await fetch(this.delegateUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, chatId, updateId }),
            });
          } catch (e) {
            console.error(`[TelegramWebhookAdapter] delegate fetch failed:`, e);
          }
        }
        return ok(null, { received: true });
      },
    });

    this.webhookServer.start();

    // Register the webhook URL with Telegram (fire-and-forget on startup).
    Promise.resolve().then(async () => {
      try {
        await this.setWebhook(this.webhookUrl, this.webhookSecret || undefined);
      } catch (e) {
        console.error(`[TelegramWebhookAdapter] setWebhook on startup failed:`, e);
      }
    });

    console.log(`\n📱 Telegram Webhook Adapter → http://localhost:${this.port}/webhook`);
    console.log(`   Webhook URL: ${this.webhookUrl}`);
    console.log(`   Bot token:   ${"*".repeat(this.botToken.length)}\n`);
  }

  stop(): void {
    this.webhookServer?.stop();
    this.webhookServer = null;
    this.server = null;
    this.deleteWebhook().catch((e) => console.error("[TelegramWebhookAdapter] deleteWebhook on stop failed:", e));
  }
}
