import {
	IdempotencyLock,
	idempotencyConflictResponse,
} from "@adapters/idempotency-lock";
import { rateLimitResponse } from "@adapters/rate-limit";
import type {
	TelegramBotPort,
	TelegramChatAction,
	TelegramInlineKeyboard,
	TelegramParseMode,
} from "@ports/telegram-bot-port";
import { buildCorsHeaders, err, ok } from "@utils/rpc";
import { JABR_PORTS } from "@constants/ecosystem";

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
	/** Optional rate limiter. */
	rateLimiter?: import("@agents/adapters/rate-limit").RateLimiter;
}

export class TelegramWebhookAdapter implements TelegramBotPort {
	private readonly botToken: string;
	private readonly port: number;
	private readonly delegateUrl: string;
	private readonly webhookSecret: string;
	private readonly webhookUrl: string;
	private readonly rateLimiter?: import("@agents/adapters/rate-limit").RateLimiter;
	private server: ReturnType<typeof Bun.serve> | null = null;
	private idempotencyLock: IdempotencyLock;
	private seenUpdateIds: Set<number> = new Set();

	constructor(config: TelegramWebhookAdapterConfig) {
		this.botToken = config.botToken;
		this.port = config.port ?? JABR_PORTS.realtime;
		this.delegateUrl = config.delegateUrl ?? "";
		this.webhookSecret = config.webhookSecret ?? "";
		this.idempotencyLock = new IdempotencyLock();
		this.rateLimiter = config.rateLimiter;
		const host = config.host ?? "localhost";
		const port = this.port;
		this.webhookUrl = config.webhookUrl ?? `https://${host}:${port}/webhook`;
	}

	// ---- Webhook lifecycle ----

	/** Register the webhook URL with Telegram via setWebhook. */
	async setWebhook(url: string, secretToken?: string): Promise<void> {
		const token = secretToken ?? this.webhookSecret;
		const payload: Record<string, unknown> = { url };
		if (token) payload.secret_token = token;

		console.log(
			`[TelegramWebhookAdapter] setWebhook url=${url}${token ? ` secret_token=****` : ""}`,
		);
		const resp = await fetch(
			`${TELEGRAM_API_BASE}/bot${this.botToken}/setWebhook`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
		const json = (await resp.json()) as {
			ok: boolean;
			description?: string;
			error_code?: number;
		};
		if (!json.ok) {
			throw new Error(
				`Telegram setWebhook failed (code=${json.error_code}): ${json.description}`,
			);
		}
		console.log(`[TelegramWebhookAdapter] setWebhook → ok`);
	}

	async deleteWebhook(): Promise<void> {
		console.log(`[TelegramWebhookAdapter] deleteWebhook`);
		const resp = await fetch(
			`${TELEGRAM_API_BASE}/bot${this.botToken}/deleteWebhook`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
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
		options?: {
			parse_mode?: TelegramParseMode;
			reply_markup?: TelegramInlineKeyboard;
		},
	): Promise<void> {
		const payload: Record<string, unknown> = { chat_id: chatId, text };
		if (options?.parse_mode) payload.parse_mode = options.parse_mode;
		if (options?.reply_markup)
			payload.reply_markup = JSON.stringify(options.reply_markup);

		const resp = await fetch(
			`${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
		const json = (await resp.json()) as { ok: boolean; description?: string };
		if (!json.ok) {
			throw new Error(`Telegram sendMessage failed: ${json.description}`);
		}
	}

	async sendChatAction(
		chatId: number,
		action: TelegramChatAction,
	): Promise<void> {
		const resp = await fetch(
			`${TELEGRAM_API_BASE}/bot${this.botToken}/sendChatAction`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, action }),
			},
		);
		const json = (await resp.json()) as { ok: boolean; description?: string };
		if (!json.ok) {
			throw new Error(`Telegram sendChatAction failed: ${json.description}`);
		}
	}

	async answerCallbackQuery(
		callbackQueryId: string,
		text?: string,
	): Promise<void> {
		const payload: Record<string, unknown> = {
			callback_query_id: callbackQueryId,
		};
		if (text) payload.text = text;

		const resp = await fetch(
			`${TELEGRAM_API_BASE}/bot${this.botToken}/answerCallbackQuery`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
		const json = (await resp.json()) as { ok: boolean; description?: string };
		if (!json.ok) {
			throw new Error(
				`Telegram answerCallbackQuery failed: ${json.description}`,
			);
		}
	}

	// ---- Server ----

	start(): void {
		if (this.server) return;

		const adapter = this;

		this.server = Bun.serve({
			port: this.port,
			hostname: "127.0.0.1",
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
				if (adapter.rateLimiter) {
					const rl = adapter.rateLimiter.check(req);
					if (!rl.allowed) {
						console.warn(`[TelegramWebhookAdapter] rate-limited: 429`);
						const rr = rateLimitResponse(rl.retryAfterMs);
						return new Response(JSON.stringify(rr.body), {
							status: rr.status,
							headers: rr.headers,
						});
					}
				}

				// --- Read raw body ONCE ---
				let rawBody: string;
				try {
					rawBody = await req.text();
				} catch (e) {
					console.error(`[TelegramWebhookAdapter] body read error:`, e);
					const origin = req.headers.get("Origin");
					const headers = buildCorsHeaders(origin) ?? {
						"Content-Type": "application/json",
					};
					return new Response(
						JSON.stringify(err(null, -32700, "Parse error: cannot read body")),
						{ status: 400, headers },
					);
				}

				// --- Telegram signature verification ---
				// Telegram uses X-Telegram-Bot-Api-Secret-Token: a plaintext secret token
				// (not HMAC). Compare directly.
				const secretTokenHeader =
					req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
				if (
					!secretTokenHeader ||
					adapter.webhookSecret === "" ||
					secretTokenHeader !== adapter.webhookSecret
				) {
					console.warn(
						`[TelegramWebhookAdapter] rejected: bad or missing secret token`,
					);
					const origin = req.headers.get("Origin");
					const headers = buildCorsHeaders(origin) ?? {
						"Content-Type": "application/json",
					};
					return new Response(
						JSON.stringify(
							err(null, -32002, "Unauthorized: invalid webhook secret token"),
						),
						{ status: 401, headers },
					);
				}

				// --- Idempotency (by update_id) ---
				let updateId: number | undefined;
				try {
					const parsed = JSON.parse(rawBody);
					updateId = parsed.update_id;
				} catch {
					// If we can't parse, allow the request but don't track idempotency
				}

				if (updateId !== undefined) {
					const lockKey = `telegram:${updateId}`;
					const lockResult = adapter.idempotencyLock.acquire(lockKey);
					if (!lockResult.acquired) {
						console.log(
							`[TelegramWebhookAdapter] duplicate update_id=${updateId} (409)`,
						);
						const resp = idempotencyConflictResponse(lockKey);
						const origin = req.headers.get("Origin");
						const headers = buildCorsHeaders(origin) ?? {};
						return new Response(JSON.stringify(resp.body), {
							status: resp.status,
							headers: { ...headers, "Content-Type": "application/json" },
						});
					}
					// Track seen update IDs for duplicate detection
					adapter.seenUpdateIds.add(updateId);
				}

				// --- Parse and dispatch ---
				let parsedPayload: unknown = {};
				try {
					parsedPayload = JSON.parse(rawBody || "{}");
				} catch {
					parsedPayload = { raw: rawBody };
				}

				// Extract chat ID and sender info for delegation
				const p = parsedPayload as Record<string, unknown>;
				const updateIdNum = p.update_id as number | undefined;
				let chatId: number | undefined;
				let senderId: number | undefined;
				let senderName: string | undefined;
				let messageText: string | undefined;

				// Text message
				if (p.message) {
					const msg = p.message as Record<string, unknown>;
					chatId = (msg.chat as Record<string, unknown>)?.id as
						| number
						| undefined;
					const from = msg.from as Record<string, unknown> | undefined;
					senderId = from?.id as number | undefined;
					senderName = from?.first_name as string | undefined;
					messageText = msg.text as string | undefined;
				}

				// Callback query
				if (p.callback_query) {
					const cb = p.callback_query as Record<string, unknown>;
					chatId = (cb.chat as Record<string, unknown>)?.id as
						| number
						| undefined;
					const from = cb.from as Record<string, unknown> | undefined;
					senderId = from?.id as number | undefined;
					senderName = from?.first_name as string | undefined;
				}

				console.log(
					`[TelegramWebhookAdapter] ← event update_id=${updateIdNum} chat_id=${chatId}`,
				);

				// Route to handler (fire-and-forget so HTTP response returns fast)
				adapter
					.route({
						updateId: updateIdNum,
						chatId,
						senderId,
						senderName,
						messageText,
						rawPayload: parsedPayload,
					})
					.catch((e) =>
						console.error(
							`[TelegramWebhookAdapter] handler error for update_id=${updateIdNum}:`,
							e,
						),
					);

				const origin = req.headers.get("Origin");
				const headers = buildCorsHeaders(origin) ?? {};
				return new Response(JSON.stringify(ok(null, { received: true })), {
					headers,
				});
			},
		});

		console.log(
			`\n📱 Telegram Webhook Adapter → http://localhost:${this.port}/webhook`,
		);
		console.log(`   Webhook URL: ${this.webhookUrl}`);
		console.log(`   Bot token:   ${"*".repeat(this.botToken.length)}\n`);

		// Register the webhook URL with Telegram (fire-and-forget on startup).
		Promise.resolve().then(async () => {
			try {
				await adapter.setWebhook(
					adapter.webhookUrl,
					adapter.webhookSecret || undefined,
				);
			} catch (e) {
				console.error(
					`[TelegramWebhookAdapter] setWebhook on startup failed:`,
					e,
				);
			}
		});
	}

	stop(): void {
		this.server?.stop();
		this.server = null;
		this.seenUpdateIds.clear();
		this.deleteWebhook().catch((e) =>
			console.error(
				"[TelegramWebhookAdapter] deleteWebhook on stop failed:",
				e,
			),
		);
	}

	// ---- Event routing ----

	private async route(event: {
		updateId?: number;
		chatId?: number;
		senderId?: number;
		senderName?: string;
		messageText?: string;
		rawPayload: unknown;
	}): Promise<void> {
		if (!this.delegateUrl) {
			console.log(
				`[TelegramWebhookAdapter] no delegateUrl — dropping update_id=${event.updateId}`,
			);
			return;
		}

		// Build the text to send to the agent
		const parts: string[] = ["[Telegram]"];

		if (event.senderId !== undefined) {
			parts.push(
				`Sender: ${event.senderId}${event.senderName ? ` (${event.senderName})` : ""}`,
			);
		}

		if (event.chatId !== undefined) {
			parts.push(`Chat: ${event.chatId}`);
		}

		if (event.messageText !== undefined) {
			parts.push(event.messageText);
		} else {
			// Non-text update (e.g., callback query, status)
			parts.push(`Update received (update_id: ${event.updateId})`);
		}

		const fullText = parts.join("\n");
		console.log(
			`[TelegramWebhookAdapter] delegating to agent: ${fullText.slice(0, 120)}...`,
		);

		await this.delegateToAgent(fullText);
	}

	/** Delegate an inbound message to an agent via JSON-RPC tasks/send. */
	private async delegateToAgent(text: string): Promise<void> {
		if (!this.delegateUrl) {
			console.log(`[TelegramWebhookAdapter] no delegateUrl — dropping message`);
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
						parts: [{ kind: "text", text }],
					},
				},
			}),
		});
		if (!res.ok) {
			console.error(
				`[TelegramWebhookAdapter] delegate failed: ${res.status} ${res.statusText}`,
			);
		}
	}
}
