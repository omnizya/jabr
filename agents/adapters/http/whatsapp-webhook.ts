import { createHmac } from "node:crypto";
import type { BunRequest } from "bun";
import type {
  WhatsAppBotPort,
  WhatsAppMessageType,
  WhatsAppInteractiveMessage,
  WhatsAppWebhookEvent,
  WhatsAppInboundMessage,
  isTextMessage,
  isImageMessage,
  isAudioMessage,
  isDocumentMessage,
  isVideoMessage,
  isStickerMessage,
  isLocationMessage,
  isInteractiveMessage,
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

/**
 * Raw WhatsApp Cloud message as delivered by the webhook.
 * The real payload has no `type` field — we compute it during normalisation.
 */
type RawWhatsAppMessage = {
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
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
};

/**
 * Normalise a raw WhatsApp Cloud message into a typed `WhatsAppInboundMessage`.
 * The port's type guards (`isTextMessage`, etc.) discriminate on the `type` field.
 */
function normalizeMessage(
  raw: RawWhatsAppMessage,
): WhatsAppInboundMessage {
  // Text messages have the `text` field.
  if (raw.text !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "text",
      text: { body: raw.text.body },
    } as WhatsAppInboundMessage;
  }
  // Image.
  if (raw.image !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "image",
      image: { id: raw.image.id, caption: raw.image.caption ?? "" },
    } as WhatsAppInboundMessage;
  }
  // Audio.
  if (raw.audio !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "audio",
      audio: { id: raw.audio.id },
    } as WhatsAppInboundMessage;
  }
  // Document.
  if (raw.document !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "document",
      document: {
        id: raw.document.id,
        filename: raw.document.filename ?? "",
        caption: raw.document.caption ?? "",
      },
    } as WhatsAppInboundMessage;
  }
  // Video.
  if (raw.video !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "video",
      video: { id: raw.video.id, caption: raw.video.caption ?? "" },
    } as WhatsAppInboundMessage;
  }
  // Sticker.
  if (raw.sticker !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "sticker",
      sticker: { id: raw.sticker.id },
    } as WhatsAppInboundMessage;
  }
  // Location.
  if (raw.location !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "location",
      location: {
        latitude: raw.location.latitude,
        longitude: raw.location.longitude,
        address: raw.location.address ?? "",
      },
    } as WhatsAppInboundMessage;
  }
  // Interactive (button or list reply).
  if (raw.interactive !== undefined) {
    return {
      from: raw.from,
      id: raw.id,
      timestamp: raw.timestamp,
      type: "interactive",
      interactive: {
        type: raw.interactive.type,
        sender_name: raw.interactive.sender_name ?? "",
        button_reply: raw.interactive.button_reply ?? undefined,
        list_reply: raw.interactive.list_reply ?? undefined,
      },
    } as WhatsAppInboundMessage;
  }

  // Unknown — fall back to text with the raw body as a placeholder.
  return {
    from: raw.from,
    id: raw.id,
    timestamp: raw.timestamp,
    type: "text",
    text: { body: "" },
  } as WhatsAppInboundMessage;
}

/** Parse the raw WhatsApp Cloud webhook body into our typed event. */
export function parseWhatsAppEvent(rawBody: string): WhatsAppWebhookEvent {
  const body = JSON.parse(rawBody || "{}");

  if (!body.object || body.object !== "whatsapp") {
    throw new Error(
      `[WhatsAppWebhookAdapter] unexpected webhook object: ${body.object ?? "undefined"}`,
    );
  }

  const entries = body.entry;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("[WhatsAppWebhookAdapter] empty webhook entry");
  }

  const firstEntry = entries[0];
  if (!firstEntry) {
    throw new Error("[WhatsAppWebhookAdapter] first entry is undefined");
  }
  const changes = firstEntry.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("[WhatsAppWebhookAdapter] empty entry changes");
  }

  const change = changes[0];
  if (!change) {
    throw new Error("[WhatsAppWebhookAdapter] first change is undefined");
  }

  const rawValue = change.value as {
    messaging_product?: string;
    metadata?: { display_phone_number: string; phone_number_id: string };
    messages?: RawWhatsappMessage[];
    statuses?: Array<{
      id: string;
      recipient_id: string;
      status: string;
      timestamp: string;
    }>;
  };

  const messages = rawValue.messages ?? [];
  const statuses = rawValue.statuses ?? [];

  const eventType: WhatsAppWebhookEvent["type"] =
    messages.length > 0 ? "message" : statuses.length > 0 ? "status" : "message";

  const normalizedMessages: WhatsAppInboundMessage[] | undefined =
    messages.length > 0
      ? messages.map((m) => normalizeMessage(m))
      : undefined;

  const typedStatuses: WhatsAppWebhookEvent["payload"]["entry"][0]["changes"][0]["value"]["statuses"] | undefined =
    statuses.length > 0
      ? statuses.map((s) => ({
          id: s.id,
          recipient_id: s.recipient_id,
          status: s.status as "sent" | "delivered" | "read" | "failed",
          timestamp: s.timestamp,
        }))
      : undefined;

  const payload: WhatsAppWebhookEvent["payload"] = {
    entry: [
      {
        id: firstEntry.id,
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: rawValue.metadata ?? {
                display_phone_number: "",
                phone_number_id: "",
              },
              messages: normalizedMessages,
              statuses: typedStatuses,
            },
          },
        ],
      },
    ],
  };

  // sessionId = user phone number for conversation continuity.
  const firstMsg = messages[0];
  const firstStatus = statuses[0];
  const sessionId = firstMsg?.from ?? firstStatus?.recipient_id ?? "";

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

    const adapter = this; // capture `this` for use inside the fetch closure.

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

        // 1. Signature verification (HMAC-SHA256 via node:crypto).
        const sigHeader = req.headers.get("x-wa-webhook-signature") ?? "";
        const sig = sigHeader.startsWith("sha256=")
          ? sigHeader.slice("sha256=".length)
          : sigHeader;

        const computed = createHmac("sha256", adapter.webhookSecret)
          .update(rawBody)
          .digest("hex");

        if (computed !== sig) {
          console.warn("[WhatsAppWebhookAdapter] rejected: bad signature");
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
        adapter.route(event).catch(
          (e: Error) =>
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
      const entries = event.payload.entry;
      const firstEntry = entries[0];
      if (!firstEntry) return;

      const changes = firstEntry.changes;
      const firstChange = changes[0];
      if (!firstChange) return;

      const msgs = firstChange.value.messages;
      if (!msgs || msgs.length === 0) return;

      for (const msg of msgs) {
        // Mark as read before processing.
        if (msg.id) {
          this.markAsRead(msg.id).catch(
            (e: Error) =>
              console.error(
                `[WhatsAppWebhookAdapter] markAsRead failed for ${msg.id}:`,
                e,
              ),
          );
        }

        // Extract a text description to forward to the agent.
        let text: string | undefined;

        if (isTextMessage(msg)) {
          text = msg.text.body;
        } else if (isInteractiveMessage(msg)) {
          text =
            `[${msg.interactive.type.toUpperCase()}] ` +
            (msg.interactive.button_reply?.title ??
              msg.interactive.list_reply?.title ??
              "interaction");
        } else if (isImageMessage(msg)) {
          text = msg.image.caption ?? undefined;
        } else if (isDocumentMessage(msg)) {
          text = msg.document.caption ?? undefined;
        } else if (isVideoMessage(msg)) {
          text = msg.video.caption ?? undefined;
        }

        if (!text) {
          // Non-text message type — signal the agent with a summary.
          const type: WhatsAppMessageType = msg.type as WhatsAppMessageType;
          text = `[${type}] message received (id: ${msg.id}) from ${msg.from}`;
        }

        if (text && this.delegateUrl) {
          await this.delegateToAgent(msg.from, text);
        }
      }
    } else if (event.type === "status") {
      const entries = event.payload.entry;
      const firstEntry = entries[0];
      if (!firstEntry) return;

      const changes = firstEntry.changes;
      const firstChange = changes[0];
      if (!firstChange) return;

      const statuses = firstChange.value.statuses;
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

  async sendTemplateMessage(
    to: string,
    template: import("@ports/whatsapp-bot-port").WhatsAppTemplateMessage,
  ): Promise<void> {
    if (!this.accessToken) {
      console.warn(
        `[WhatsAppWebhookAdapter] sendTemplateMessage: no accessToken — skipped (to=${to})`,
      );
      return;
    }
    if (!template.name) {
      throw new Error("[WhatsAppWebhookAdapter] sendTemplateMessage: template.name is required");
    }
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: template.name,
        language: {
          code: template.languageCode ?? "en_US",
        },
      },
    };
    if (template.components && template.components.length > 0) {
      payload.template.components = template.components.map((c) => ({
        type: c.type,
        parameters: c.parameters?.map((p) => ({
          type: p.type,
          text: p.text ?? undefined,
          media: p.media ? { link: p.media.link ?? "" } : undefined,
          fallback: p.fallback ?? undefined,
        })),
      }));
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
        `[WhatsAppWebhookAdapter] sendTemplateMessage failed ${res.status}: ${text}`,
      );
    }
    console.log(
      `[WhatsAppWebhookAdapter] sent template ${template.name} to ${to}`,
    );
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
      const interactive = body.interactive;
      if (!interactive) return;
      payload.type = "interactive";
      payload.interactive = {
        type: interactive.type,
        header: { type: "text", text: interactive.header },
        body: { text: interactive.body },
        footer: interactive.footer
          ? { text: interactive.footer }
          : undefined,
        buttons: interactive.buttons.map((b) => ({
          type: "reply" as const,
          reply: { id: b.id, title: b.title },
        })),
      };
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
