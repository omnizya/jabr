import { createHash } from "node:crypto";
import type { BunRequest } from "bun";
import { WebhookServer, type WebhookPayload } from "./webhook-server.ts";
import type {
  WhatsAppBotPort,
  WhatsAppMessageType,
  WhatsAppInteractiveMessage,
  WhatsAppWebhookEvent,
} from "@ports/whatsapp-bot-port";

/**
 * Configuration for WhatsAppWebhookAdapter.
 *
 * The WhatsApp Cloud API delivers webhook events to a registered URL via
 * HTTPS POST. This adapter:
 *  1. Verifies the HMAC-SHA256 signature (X-WA-Webhook-Signature).
 *  2. Parses the nested WhatsApp Cloud payload into WhatsAppWebhookEvent.
 *  3. Routes inbound messages to agents via delegateUrl (JSON-RPC tasks/send).
 *  4. Exposes sendMessage / sendInteractiveMessage / sendDocument / markAsRead
 *     by calling the WhatsApp Cloud API on behalf of the bot.
 */
export interface WhatsAppWebhookAdapterConfig {
  /** WhatsApp Cloud webhook secret (set in Meta Business Suite → Webhooks → Secret). */
  webhookSecret: string;

  /** WhatsApp phone number ID (from Meta → Phone numbers → ID column). */
  phoneNumberId: string;

  /** WhatsApp business account ID (from Meta → Account → Business account ID). */
  businessAccountId: string;

  /**
   * WhatsApp Cloud API version, e.g. "v18.0".
   * @default "v18.0"
   */
  apiVersion?: string;

  /**
   * Access token with `whatsapp_business_messaging` scope.
   *
   * Required for sendMessage / sendInteractiveMessage / sendDocument / markAsRead.
   * When omitted, outbound calls log a warning and skip.
   */
  accessToken?: string;

  /** Bun.serve port. Default 4009. */
  port?: number;

  /**
   * Agent URL to forward inbound messages to.
   * Uses JSON-RPC `tasks/send` with the message text as the prompt.
   */
  delegateUrl?: string;
}

const DEFAULT_API_VERSION = "v18.0";

function apiBaseUrl(
  phoneNumberId: string,
  businessAccountId: string,
  apiVersion: string,
): string {
  return `https://graph.facebook.com/${apiVersion}/${businessAccountId}/phone_numbers/${phoneNumberId}`;
}

/** Normalize a single WhatsApp Cloud message into our internal event shape. */
function normalizeMessage(
  msg: {
    from: string;
    id: string;
    timestamp: string;
    text?: { body: string };
    image?: { id: string; caption?: string };
    audio?: { id: string };
    document?: { id: string; filename?: string; caption?: string };
    video?: { id: string; caption?: string };
    sticker?: { id: string };
    location?: { latitude: number; longitude: number; address?: string };
    interactive?: {
      type: string;
      sender_name?: string;
      // buttonReply / listReply vary by type
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string };
    };
  },
  phoneNumberId: string,
): WhatsAppWebhookEvent["payload"]["entry"][0]["changes"][0]["value"]["messages"][0] {
  const base = {
    from: msg.from,
    id: msg.id,
    timestamp: msg.timestamp,
  };

  if (msg.text !== undefined) {
    return { ...base, text: { body: msg.text.body } };
  }
  if (msg.image !== undefined) {
    return {
      ...base,
      image: { id: msg.image.id, caption: msg.image.caption ?? "" },
    };
  }
  if (msg.audio !== undefined) {
    return { ...base, audio: { id: msg.audio.id } };
  }
  if (msg.document !== undefined) {
    return {
      ...base,
      document: {
        id: msg.document.id,
        filename: msg.document.filename ?? "",
        caption: msg.document.caption ?? "",
      },
    };
  }
  if (msg.video !== undefined) {
    return {
      ...base,
      video: { id: msg.video.id, caption: msg.video.caption ?? "" },
    };
  }
  if (msg.sticker !== undefined) {
    return { ...base, sticker: { id: msg.sticker.id } };
  }
  if (msg.location !== undefined) {
    return {
      ...base,
      location: {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
        address: msg.location.address ?? "",
      },
    };
  }
  if (msg.interactive !== undefined) {
    const interactive: WhatsAppWebhookEvent["payload"]["entry"][0]["changes"][0]["value"]["messages"][0]["interactive"] =
      {
        type: msg.interactive.type,
        sender_name: msg.interactive.sender_name ?? "",
        button_reply: msg.interactive.button_reply ?? undefined,
        list_reply: msg.interactive.list_reply ?? undefined,
      };
    return { ...base, interactive };
  }

  // Unknown message type — keep the raw shape for forward-compatibility.
  return base as WhatsAppWebhookEvent["payload"]["entry"][0]["changes"][0]["value"]["messages"][0];
}

/** Parse the raw WhatsApp Cloud webhook body into our typed event. */
export function parseWhatsAppEvent(rawBody: string): WhatsAppWebhookEvent {
  const body = JSON.parse(rawBody || "{}");

  if (!body.object || body.object !== "whatsapp") {
    throw new Error(`[WhatsAppWebhookAdapter] unexpected webhook object: ${body.object ?? "undefined"}`);
  }

  const entries = body.entry;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("[WhatsAppWebhookAdapter] empty webhook entry");
  }

  const firstEntry = entries[0];
  const changes = firstEntry.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("[WhatsAppWebhookAdapter] empty entry changes");
  }

  const change = changes[0];
  const value = change.value;

  const messages = value.messages ?? [];
  const statuses = value.statuses ?? [];

  const eventType: WhatsAppWebhookEvent["type"] =
    messages.length > 0 ? "message" : statuses.length > 0 ? "status" : "message";

  const payload: WhatsAppWebhookEvent["payload"] = {
    entry: [
      {
        id: firstEntry.id,
        changes: [
          {
            ...change,
            value: {
              ...value,
              messaging_product: "whatsapp",
              metadata: value.metadata ?? {
                display_phone_number: "",
                phone_number_id: "",
              },
              messages: messages.length > 0
                ? messages.map((m: unknown) => normalizeMessage(m as never, value.metadata?.phone_number_id ?? ""))
                : undefined,
              statuses: statuses.length > 0
                ? statuses.map(
                    (s: {
                      id: string;
                      recipient_id: string;
                      status: string;
                      timestamp: string;
                    }) => ({
                      id: s.id,
                      recipient_id: s.recipient_id,
                      status: s.status as WhatsAppWebhookEvent["payload"]["entry"][0]["changes"][0]["value"]["statuses"][0]["status"],
                      timestamp: s.timestamp,
                    }),
                  )
                : undefined,
            },
          },
        ],
      },
    ],
  };

  // sessionId = the user phone number (E.164) for conversation continuity.
  const firstMsg = messages[0];
  const firstStatus = statuses[0];
  const sessionId =
    (firstMsg && (firstMsg as { from: string }).from) ??
    (firstStatus && (firstStatus as { recipient_id: string }).recipient_id) ??
    "";

  return {
    source: "whatsapp",
    type: eventType,
    payload,
    sessionId,
  };
}

/**
 * WhatsApp Webhook Adapter.
 *
 * Implements WhatsAppBotPort and starts a Bun webhook server that:
 *  - Receives WhatsApp Cloud webhook events on POST /webhook
 *  - Verifies the X-WA-Webhook-Signature HMAC
 *  - Parses messages and routes them to agents via delegateUrl
 *  - Provides sendMessage / sendInteractiveMessage / sendDocument / markAsRead
 *    via the WhatsApp Cloud API
 */
export class WhatsAppWebhookAdapter implements WhatsAppBotPort {
  private readonly webhookSecret: string;
  private readonly phoneNumberId: string;
  private readonly businessAccountId: string;
  private readonly apiVersion: string;
  private readonly accessToken: string;
  private readonly port: number;
  private readonly delegateUrl: string;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: WhatsAppWebhookAdapterConfig) {
    this.webhookSecret = config.webhookSecret;
    this.phoneNumberId = config.phoneNumberId;
    this.businessAccountId = config.businessAccountId;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.accessToken = config.accessToken ?? "";
    this.port = config.port ?? 4009;
    this.delegateUrl = config.delegateUrl ?? "";
  }

  // ---- Server lifecycle ----

  start(): void {
    if (this.server) return;

    const baseUrl = apiBaseUrl(
      this.phoneNumberId,
      this.businessAccountId,
      this.apiVersion,
    );

    this.server = Bun.serve({
      port: this.port,
      async fetch(req: BunRequest) {
        const url = new URL(req.url);

        if (req.method !== "POST" || url.pathname !== "/webhook") {
          return new Response("Not found", { status: 404 });
        }

        // Read raw body once — needed for HMAC verification.
        let rawBody: string;
        try {
          rawBody = await req.text();
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        // 1. Signature verification.
        //    WhatsApp sends the signature in X-WA-Webhook-Signature.
        //    WebhookServer.verifySignature handles the HMAC-SHA256 check.
        const sigHeader = req.headers.get("x-wa-webhook-signature") ?? "";
        const sig = sigHeader.startsWith("sha256=")
          ? sigHeader.slice("sha256=".length)
          : sigHeader;

        const expected = createHash("sha256")
          .update(rawBody)
          .digest("hex");

        const hmac = createHash("sha256")
          .update(rawBody)
          .digest("hex");

        // Use node crypto HMAC for the actual verification.
        const { createHmac } = await import("node:crypto");
        const computed = createHmac("sha256", this.webhookSecret)
          .update(rawBody)
          .digest("hex");

        if (computed !== sig) {
          console.warn(
            `[WhatsAppWebhookAdapter] rejected: bad signature (expected ${sig.slice(0, 16)}..., got ${computed.slice(0, 16)}...)`,
          );
          return new Response("Unauthorized", { status: 401 });
        }

        // 2. Parse.
        let event: WhatsAppWebhookEvent;
        try {
          event = parseWhatsAppEvent(rawBody);
        } catch (e) {
          console.error("[WhatsAppWebhookAdapter] parse failed:", e);
          return new Response("Bad payload", { status: 400 });
        }

        // 3. Route to handler (fire-and-forget so HTTP response returns fast).
        this.route(event).catch((e) =>
          console.error(
            `[WhatsAppWebhookAdapter] handler error for session ${event.sessionId}:`,
            e,
          ),
        );

        return new Response("OK", { status: 200 });
      },
    });

    console.log(
      `[WhatsAppWebhookAdapter] listening on http://localhost:${this.port}/webhook`,
    );
    console.log(
      `[WhatsAppWebhookAdapter] phoneNumberId=${this.phoneNumberId} businessAccountId=${this.businessAccountId} apiVersion=${this.apiVersion}`,
    );
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }

  // ---- Event routing ----

  private async route(event: WhatsAppWebhookEvent): Promise<void> {
    if (event.type === "message") {
      const msgs = event.payload.entry[0].changes[0].value.messages;
      if (!msgs || msgs.length === 0) return;

      for (const msg of msgs) {
        // Mark as read before processing.
        if (msg.id) {
          this.markAsRead(msg.id).catch((e) =>
            console.error(
              `[WhatsAppWebhookAdapter] markAsRead failed for ${msg.id}:`,
              e,
            ),
          );
        }

        let text: string | undefined;

        if (msg.text?.body) {
          text = msg.text.body;
        } else if (msg.interactive) {
          // Button or list reply — build a readable description.
          text = `[${msg.interactive.type.toUpperCase()}] ` +
            (msg.interactive.button_reply?.title ??
              msg.interactive.list_reply?.title ??
              "interaction");
        } else if (msg.image?.caption) {
          text = msg.image.caption;
        } else if (msg.document?.caption) {
          text = msg.document.caption;
        } else if (msg.video?.caption) {
          text = msg.video.caption;
        } else {
          // Non-text message type — signal the agent with a summary.
          const type: WhatsAppMessageType =
            msg.image ? "image" :
            msg.audio ? "audio" :
            msg.document ? "document" :
            msg.video ? "video" :
            msg.sticker ? "sticker" :
            msg.location ? "location" :
            msg.interactive ? "interactive" : "text";
          text = `[${type}] message received (id: ${msg.id}) from ${msg.from}`;
        }

        if (text && this.delegateUrl) {
          await this.delegateToAgent(msg.from, text);
        }
      }
    } else if (event.type === "status") {
      // Status updates (sent / delivered / read / failed) — log for observability.
      const statuses = event.payload.entry[0].changes[0].value.statuses;
      if (!statuses || statuses.length === 0) return;

      for (const status of statuses) {
        console.log(
          `[WhatsAppWebhookAdapter] status update: message ${status.id} → ${status.status} (recipient ${status.recipient_id})`,
        );
      }
    }
  }

  /**
   * Delegate an inbound message to an agent via JSON-RPC tasks/send.
   */
  private async delegateToAgent(from: string, text: string): Promise<void> {
    if (!this.delegateUrl) {
      console.log(
        `[WhatsAppWebhookAdapter] no delegateUrl — dropping message from ${from}: ${text.slice(0, 80)}`,
      );
      return;
    }

    const res = await fetch(this.delegateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: `[WhatsApp] From +${from}:\n${text}` }],
          },
        },
      }),
    });

    if (!res.ok) {
      console.error(
        `[WhatsAppWebhookAdapter] delegate failed for ${from}: ${res.status} ${res.statusText}`,
      );
    }
  }

  // ---- WhatsAppBotPort: outbound ----

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.accessToken) {
      console.warn(
        `[WhatsAppWebhookAdapter] sendMessage: no accessToken — skipped (to=${to})`,
      );
      return;
    }
    await this.postMessage(to, {
      type: "text",
      text,
    });
  }

  async sendInteractiveMessage(
    to: string,
    message: WhatsAppInteractiveMessage,
  ): Promise<void> {
    if (!this.accessToken) {
      console.warn(
        `[WhatsAppWebhookAdapter] sendInteractiveMessage: no accessToken — skipped (to=${to})`,
      );
      return;
    }
    await this.postMessage(to, {
      type: "interactive",
      interactive: {
        type: message.type,
        header: message.header,
        body: message.body,
        footer: message.footer,
        buttons: message.buttons,
      },
    });
  }

  async sendDocument(
    to: string,
    document: Buffer,
    filename: string,
  ): Promise<void> {
    if (!this.accessToken) {
      console.warn(
        `[WhatsAppWebhookAdapter] sendDocument: no accessToken — skipped (to=${to})`,
      );
      return;
    }
    await this.postMessage(to, {
      type: "document",
      document: {
        url: `data:application/octet-stream;base64,${document.toString("base64")}`,
        filename,
      },
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    if (!this.accessToken) {
      console.warn(
        `[WhatsAppWebhookAdapter] markAsRead: no accessToken — skipped (messageId=${messageId})`,
      );
      return;
    }

    const res = await fetch(`${this.apiBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `[WhatsAppWebhookAdapter] markAsRead failed ${res.status}: ${text}`,
      );
    }

    console.log(
      `[WhatsAppWebhookAdapter] markAsRead: message ${messageId} → read`,
    );
  }

  // ---- Internal: construct and POST a WhatsApp Cloud message ----

  private get apiBaseUrl(): string {
    return apiBaseUrl(
      this.phoneNumberId,
      this.businessAccountId,
      this.apiVersion,
    );
  }

  private async postMessage(
    to: string,
    body: {
      type: "text" | "interactive" | "document";
      text?: string;
      interactive?: {
        type: string;
        header: string;
        body: string;
        footer?: string;
        buttons: Array<{ id: string; title: string }>;
      };
      document?: { url: string; filename: string };
    },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
    };

    if (body.type === "text") {
      payload.type = "text";
      payload.text = { body: body.text };
    } else if (body.type === "interactive") {
      payload.type = "interactive";
      payload.interactive = {
        type: body.interactive.type,
        header: { type: "text", text: body.interactive.header },
        body: { text: body.interactive.body },
        footer: body.interactive.footer ? { text: body.interactive.footer } : undefined,
        buttons: body.interactive.buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      };
      // Remove undefined footer.
      if (!payload.interactive.footer) {
        delete payload.interactive.footer;
      }
    } else if (body.type === "document") {
      payload.type = "document";
      payload.document = body.document;
    }

    const res = await fetch(`${this.apiBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `[WhatsAppWebhookAdapter] sendMessage failed ${res.status}: ${text}`,
      );
    }

    console.log(
      `[WhatsAppWebhookAdapter] sent ${body.type} message to ${to}`,
    );
  }
}

// ---- Standalone demo (when run directly) ----

if (import.meta.main) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const delegateUrl = process.env.WHATSAPP_DELEGATE_URL;
  const port = Number(process.env.WHATSAPP_PORT ?? "4009");

  if (!secret || !phoneNumberId || !businessAccountId) {
    console.error(
      "[WhatsAppWebhookAdapter] missing required env vars: WHATSAPP_WEBHOOK_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID",
    );
    process.exit(1);
  }

  const adapter = new WhatsAppWebhookAdapter({
    webhookSecret: secret,
    phoneNumberId,
    businessAccountId,
    accessToken: accessToken ?? "",
    port,
    delegateUrl: delegateUrl ?? "",
  });

  adapter.start();

  console.log(
    `\n📱 WhatsApp Webhook Adapter → http://localhost:${port}/webhook\n`,
  );

  // Keep the process alive.
  const signal = async () => {
    console.log("\n[WhatsAppWebhookAdapter] shutting down...");
    adapter.stop();
    process.exit(0);
  };

  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
}
