/**
 * webhook-to-a2a-bridge.ts — On verified webhook event, A2A-call Hermes.
 *
 * Implements the WebhookServer onEvent signature so it plugs directly into
 * the webhook server's onEvent config. A2A dispatch is fire-and-forget:
 * failures are logged but never thrown, so the webhook response is never
 * blocked by A2A call latency or errors.
 */

import type { A2AClientPort } from "@ports/a2a-client-port";

/** The subset of WebhookPayload this bridge needs — no infrastructure types. */
export interface WebhookEvent {
  eventId: string;
  source: "github" | "telegram" | "whatsapp" | "generic";
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface WebhookToA2ABridgeConfig {
  /** A2A client port for dispatching tasks to Hermes. */
  a2aClient: A2AClientPort;
  /** Hermes agent URL (e.g. http://localhost:4000). */
  hermesUrl: string;
  /**
   * Optional inner onEvent handler. Called after A2A dispatch is kicked
   * off, regardless of A2A success/failure. Use for logging, metrics, or
   * chaining additional webhook processing.
   */
  onEvent?: (payload: WebhookEvent) => Promise<unknown>;
}

export class WebhookToA2ABridge {
  private readonly a2aClient: A2AClientPort;
  private readonly hermesUrl: string;
  private readonly innerEvent?: (payload: WebhookEvent) => Promise<unknown>;

  constructor(config: WebhookToA2ABridgeConfig) {
    this.a2aClient = config.a2aClient;
    this.hermesUrl = config.hermesUrl;
    this.innerEvent = config.onEvent;
  }

  /**
   * Handle a webhook event: kick off A2A dispatch to Hermes (fire-and-forget),
   * then call the inner handler. A2A failures are caught and logged — never
   * thrown, never blocking the webhook response.
   */
  async onEvent(payload: WebhookEvent): Promise<unknown> {
    const message = this.buildMessage(payload);

    // Fire-and-forget: don't await, don't block the webhook response.
    this.dispatchToA2A(payload, message);

    // Call inner handler immediately and return its result as the webhook response.
    if (this.innerEvent) {
      return this.innerEvent(payload);
    }
    return { dispatched: true, eventId: payload.eventId };
  }

  /**
   * Kick off the A2A dispatch. Returns void — callers must NOT await.
   * Failures are logged via `.catch()` so they never propagate.
   */
  private dispatchToA2A(payload: WebhookEvent, message: string): void {
    this.a2aClient
      .sendTaskAsync(this.hermesUrl, message, payload.eventId)
      .then((taskId) => {
        console.log(
          `[WebhookToA2A] dispatched eventId=${payload.eventId} → taskId=${taskId}`,
        );
      })
      .catch((e) => {
        console.error(
          `[WebhookToA2A] failed to dispatch eventId=${payload.eventId}:`,
          e,
        );
      });
  }

  private buildMessage(payload: WebhookEvent): string {
    return [
      "Webhook event received",
      `  Source: ${payload.source}`,
      `  Type: ${payload.type}`,
      `  Event ID: ${payload.eventId}`,
      `  Timestamp: ${new Date(payload.timestamp).toISOString()}`,
      `  Payload: ${JSON.stringify(payload.payload)}`,
    ].join("\n");
  }
}

export function createWebhookToA2ABridge(
  config: WebhookToA2ABridgeConfig,
): WebhookToA2ABridge {
  return new WebhookToA2ABridge(config);
}
