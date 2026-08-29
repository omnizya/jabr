import { createHmac, createHash } from "node:crypto";
import type { Request } from "bun";
import { IdempotencyLock, idempotencyConflictResponse } from "@adapters/idempotency-lock";
import { rateLimitResponse } from "@adapters/rate-limit";
import { ok, err, buildCorsHeaders } from "@utils/rpc";

export interface WebhookServerConfig {
  /** Port to listen on. */
  port: number;
  /** HMAC secret shared with the sender for signature verification. */
  webhookSecret: string;
  /**
   * Optional per-caller rate limiter. When provided, POST /webhook is
   * rate-limited before signature/idempotency — mirroring A2AServer's layout.
   */
  rateLimiter?: import("@agents/adapters/rate-limit").RateLimiter;
  /**
   * Idempotency lock instance. When omitted, a default 24h TTL one is created.
   */
  idempotencyLock?: IdempotencyLock;
  /** Called for every verified, first-occurrence webhook event. */
  onEvent: (payload: WebhookPayload) => Promise<unknown>;
}

/** Normalized webhook event — mirrors the research doc's WebhookEvent shape. */
export interface WebhookPayload {
  /** Unique event ID — the idempotency lock key. */
  eventId: string;
  source: "github" | "telegram" | "whatsapp" | "generic";
  type: string;
  payload: unknown;
  timestamp: number;
  /** The raw request — provided for adapters that need headers/body after dispatch. */
  request: Request;
  /** Raw body string the signature was verified against. */
  rawBody: string;
}

const SIGNATURE_HEADER = "x-hub-signature-256";
const DELIVERY_HEADER = "x-github-delivery";

/**
 * Derive the canonical event ID. Priority:
 *  1. X-GitHub-Delivery (GitHub delivery GUID — canonical dedup key).
 *  2. X-Webhook-Event-Id (explicit generic override).
 *  3. SHA-256 hash of the raw body (fallback so identical replays dedupe).
 */
function eventIdFromRequest(req: Request, rawBody: string): string {
  const delivery = req.headers.get(DELIVERY_HEADER);
  if (delivery && delivery.trim().length > 0) return delivery.trim();

  const explicit = req.headers.get("x-webhook-event-id");
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  // Fallback: first 16 hex chars of the SHA-256 of the raw body.
  const hash = createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
  return `hash:${hash}`;
}

/** Infer source from well-known headers. */
function sourceFromHeaders(req: Request): WebhookPayload["source"] {
  if (req.headers.get("x-github-event")) return "github";
  if (req.headers.get("x-telegram-bot-api-secret-token")) return "telegram";
  if (req.headers.get("x-wa-webhook-signature")) return "whatsapp";
  return "generic";
}

/** Verify an HMAC-SHA256 signature computed over the raw body. */
function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  return computed === expected;
}

/**
 * Generic webhook server. Layered fetch handler:
 *   method/path check → rate limit → read raw body → signature → idempotency → dispatch
 *
 * Mirrors `A2AServer`'s architecture: a single Bun.serve handler with layered
 * checks and a JSON-RPC-style error shape.
 */
export class WebhookServer {
  private readonly config: WebhookServerConfig;
  private readonly idempotencyLock: IdempotencyLock;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: WebhookServerConfig) {
    this.config = config;
    this.idempotencyLock = config.idempotencyLock ?? new IdempotencyLock();
  }

  start(): void {
    const { port, webhookSecret, rateLimiter, onEvent } = this.config;

    this.server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        // Preflight
        if (req.method === "OPTIONS") {
          const origin = req.headers.get("Origin");
          const headers = buildCorsHeaders(origin);
          if (!headers) return new Response(null, { status: 204 });
          return new Response(null, { headers });
        }

        // Only POST /webhook
        if (req.method !== "POST" || url.pathname !== "/webhook") {
          const origin = req.headers.get("Origin");
          const headers = buildCorsHeaders(origin) ?? {};
          return new Response("Not found", {
            status: 404,
            headers: { ...headers, "Content-Type": "text/plain" },
          });
        }

        // --- Rate limiting (when configured) ---
        // Mirrors A2AServer: rate-limit BEFORE signature/idempotency so a flood
        // of bogus deliveries doesn't cost us signature/hash work.
        if (rateLimiter) {
          const rl = rateLimiter.check(req);
          if (!rl.allowed) {
            console.warn(`[WebhookServer] rate-limited: 429`);
            const rr = rateLimitResponse(rl.retryAfterMs);
            return new Response(JSON.stringify(rr.body), {
              status: rr.status,
              headers: rr.headers,
            });
          }
        }

        // --- Read raw body ONCE ---
        // Bun.Request.text() consumes the body stream; we call it once and use
        // the string for both HMAC verification and JSON parsing. This avoids
        // the double-consumption problem and keeps the exact bytes the sender
        // signed available for the HMAC check.
        let rawBody: string;
        try {
          rawBody = await req.text();
        } catch (e) {
          console.error(`[WebhookServer] body read error:`, e);
          const origin = req.headers.get("Origin");
          const headers = buildCorsHeaders(origin) ?? { "Content-Type": "application/json" };
          return new Response(
            JSON.stringify(err(null, -32700, "Parse error: cannot read body")),
            { status: 400, headers }
          );
        }

        // --- Signature verification ---
        const signature = req.headers.get(SIGNATURE_HEADER);
        if (signature) {
          if (!verifySignature(rawBody, signature, webhookSecret)) {
            console.error(`[WebhookServer] invalid signature (401) signature=${signature.slice(0, 12)}...`);
            const origin = req.headers.get("Origin");
            const headers = buildCorsHeaders(origin) ?? { "Content-Type": "application/json" };
            return new Response(
              JSON.stringify(err(null, -32002, "Unauthorized: invalid webhook signature")),
              { status: 401, headers }
            );
          }
        } else {
          // No signature header — allow but log. Production deployments should
          // require one; this is a dev-friendly default.
          console.warn(`[WebhookServer] no ${SIGNATURE_HEADER} header — allowing (dev mode)`);
        }

        // --- Idempotency ---
        const eventId = eventIdFromRequest(req, rawBody);
        const lockResult = this.idempotencyLock.acquire(eventId);
        if (!lockResult.acquired) {
          console.log(`[WebhookServer] duplicate event (409) eventId=${eventId}`);
          const resp = idempotencyConflictResponse(eventId);
          return new Response(JSON.stringify(resp.body), {
            status: resp.status,
            headers: resp.headers,
          });
        }

        // --- Dispatch ---
        const source = sourceFromHeaders(req);
        const eventType =
          req.headers.get("x-webhook-event-type") ??
          req.headers.get("x-github-event") ??
          "unknown";

        let parsedPayload: unknown = {};
        try {
          parsedPayload = JSON.parse(rawBody || "{}");
        } catch {
          parsedPayload = { raw: rawBody };
        }

        const payload: WebhookPayload = {
          eventId,
          source,
          type: eventType,
          payload: parsedPayload,
          timestamp: Date.now(),
          request: req,
          rawBody,
        };

        console.log(`[WebhookServer] dispatching event eventId=${eventId} source=${source} type=${eventType}`);
        try {
          const result = await onEvent(payload);
          const origin = req.headers.get("Origin");
          const headers = buildCorsHeaders(origin) ?? {};
          return Response.json(ok(null, result), { headers });
        } catch (e) {
          console.error(`[WebhookServer] onEvent error:`, e);
          const origin = req.headers.get("Origin");
          const headers = buildCorsHeaders(origin) ?? { "Content-Type": "application/json" };
          return new Response(
            JSON.stringify(err(null, -32603, `Internal error: ${String(e)}`)),
            { status: 500, headers }
          );
        }
      },
    });

    console.log(`\n📡 Webhook Server → http://localhost:${port}/webhook`);
    console.log(`   Idempotency TTL: ${this.idempotencyLock.ttlMs / 1000}s`);
    if (rateLimiter) {
      console.log(`   Rate limit: ${rateLimiter.maxRequests} req/${rateLimiter.windowMs / 1000}s per caller`);
    }
    console.log(`   Secret: ${webhookSecret.length > 0 ? "set" : "unset (dev mode)"}\n`);
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }
}
