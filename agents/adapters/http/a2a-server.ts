/**
 * a2a-server.ts — A2A v1.0 server with SSE streaming support.
 *
 * Two transport branches:
 *   - tasks/send (synchronous) — awaits onTask, returns JSON-RPC response.
 *   - tasks/sendSubscribe (streaming) — returns text/event-stream, emits
 *     TaskStatusUpdateEvent and TaskArtifactUpdateEvent frames.
 */

import { RateLimiter, rateLimitResponse } from "@adapters/rate-limit";
import { X402Server, x402Reject } from "@adapters/x402/x402-server";
import type {
	A2AServerConfig,
	ResolvedCaller,
	TaskStreamingEvent,
} from "@agents/types";
import { ApiKeyRegistry } from "@security/api-key-registry";
import {
	buildCorsHeaders,
	buildCorsPreflightHeaders,
	err,
	formatSSEEvent,
	type JSONRPCNotification,
	type JSONRPCRequest,
	type JSONRPCResponse,
	notification,
	ok,
} from "@utils/rpc";

/**
 * Validates the params shape for a tasks/send JSON-RPC call.
 */
function validateTasksSendParams(params: unknown): string | null {
	if (params === null || typeof params !== "object") {
		return "params must be an object";
	}
	const p = params as Record<string, unknown>;
	if (!("message" in p)) return "missing required field: message";
	if (p.message === null || typeof p.message !== "object") {
		return "message must be an object";
	}
	const msg = p.message as Record<string, unknown>;
	if (!("parts" in msg)) return "missing required field: message.parts";
	if (!Array.isArray(msg.parts)) return "message.parts must be an array";
	if (msg.parts.length === 0) return "message.parts must not be empty";
	for (const part of msg.parts) {
		if (part === null || typeof part !== "object")
			return "each part must be an object";
		const partObj = part as Record<string, unknown>;
		if (typeof partObj.kind !== "string")
			return "each part must have a string 'kind'";
		if (partObj.kind === "text" && typeof partObj.text !== "string") {
			return "text parts must have a string 'text' field";
		}
	}
	if ("role" in msg && typeof msg.role !== "string") {
		return "message.role must be a string";
	}
	return null;
}

/**
 * Build an SSE stream with emit() and end() callbacks.
 *
 * Uses a pull-based approach: the ReadableStream's pull() method is called
 * whenever the consumer is ready for more data. We flush the internal buffer
 * in pull() and close the stream when end() has been called and the buffer
 * is empty. This avoids race conditions with drain timers and works reliably
 * with Bun's Response + fetch() text() consumption.
 */
function buildSSEStream(): {
	stream: ReadableStream<Uint8Array>;
	emit: (chunk: string) => void;
	end: () => void;
} {
	const encoder = new TextEncoder();
	const buffer: string[] = [];
	let ended = false;
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let pullScheduled = false;

	// Attempt to flush the buffer into the controller. Returns true if the
	// stream is now closed (ended + buffer empty), false otherwise.
	function flush(): boolean {
		if (!controller) return false;
		while (buffer.length > 0) {
			try {
				controller.enqueue(encoder.encode(buffer.shift()!));
			} catch {
				// Controller closed; stop.
				return true;
			}
		}
		if (ended) {
			try {
				controller.close();
			} catch {
				/* already closed */
			}
			return true;
		}
		return false;
	}

	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
			// If events were emitted before start(), flush them now.
			flush();
		},
		pull(_c) {
			// Avoid re-entrant pull scheduling.
			if (pullScheduled) return;
			pullScheduled = true;
			queueMicrotask(() => {
				pullScheduled = false;
				flush();
			});
		},
		cancel() {
			controller = null;
		},
	});

	return {
		stream,
		emit(chunk: string) {
			buffer.push(chunk);
			// Best-effort immediate flush if controller is available.
			flush();
		},
		end() {
			ended = true;
			// If buffer is already empty, close immediately on next microtask.
			if (buffer.length === 0 && controller) {
				queueMicrotask(() => flush());
			}
		},
	};
}

export class A2AServer {
	private readonly config: A2AServerConfig;
	private readonly rateLimiter: RateLimiter;
	private readonly x402: X402Server | null;
	private readonly registry: ApiKeyRegistry | null;
	private server: ReturnType<typeof Bun.serve> | null = null;

	// --- in-flight request tracking for graceful shutdown ---
	private inflightSync = 0;
	private inflightStream = 0;
	private shuttingDown = false;
	private drainWaiters: Array<() => void> = [];
	private drainTimeoutMs: number;
	private readonly shutdownController: AbortController;

	constructor(
		config: A2AServerConfig & {
			onWorldState?: () => Promise<any>;
		},
		rateLimiter?: RateLimiter,
		x402?: X402Server,
		apiKeyRegistry?: ApiKeyRegistry,
	) {
		this.config = config as any;
		this.rateLimiter = rateLimiter ?? new RateLimiter();
		this.x402 = x402 ?? null;
		this.registry = apiKeyRegistry ?? config.apiKeyRegistry ?? null;
		this.drainTimeoutMs = config.drainTimeoutMs ?? 30_000;
		this.shutdownController = new AbortController();
	}

	/**
	 * Current number of in-flight requests (sync + streaming).
	 */
	get inFlightCount(): number {
		return this.inflightSync + this.inflightStream;
	}

	/**
	 * True when the server is shutting down and not accepting new work.
	 */
	get isShuttingDown(): boolean {
		return this.shuttingDown;
	}

	start(): void {
		const { port, card, onTask, onTaskStreaming, onWorldState, requireAuth } =
			this.config as any;
		const rateLimiter = this.rateLimiter;
		const x402 = this.x402;
		const registry = this.registry;

		// Capture the A2AServer instance so handlers can track in-flight work.
		const self = this;

		this.server = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);

				if (req.method === "OPTIONS") {
					const origin = req.headers.get("Origin");
					const headers = buildCorsPreflightHeaders(origin);
					if (!headers) return new Response(null, { status: 204 });
					return new Response(null, { headers });
				}

				// Rate-limit BEFORE any auth or dispatch — keyed by X-API-Key (when
				// present) or remote IP. Health-card GETs and world-state GETs are
				// excluded so discovery/liveness checks don't count against limits.
				if (req.method !== "GET") {
					const rl = rateLimiter.check(req);
					if (!rl.allowed) {
						const snapshot = rateLimiter.getSnapshot();
						const totalHits = Object.values(snapshot).reduce(
							(sum, e) => sum + e.used,
							0,
						);
						console.warn(
							`[A2AServer] rate-limited: 429 (window hits=${totalHits})`,
						);
						const rr = rateLimitResponse(rl.retryAfterMs);
						return new Response(JSON.stringify(rr.body), {
							status: rr.status,
							headers: rr.headers,
						});
					}
				}

				// Health / readiness / discovery GETs — no body, no payment check.
				if (req.method === "GET" && url.pathname === "/health") {
					// Liveness: always 200 once the server is up. Load balancers / orchestrators
					// use this to verify the process is alive and accepting connections.
					return Response.json({
						status: "ok",
						agent: card.name,
						version: card.version,
						uptimeMs: Math.round(performance.now()),
					});
				}

				if (req.method === "GET" && url.pathname === "/ready") {
					// Readiness: 503 while draining so orchestrators stop sending traffic.
					// Reflects both the shutdown flag and in-flight request count so a
					// rolling update waits for active work to finish before cutting over.
					const origin = req.headers.get("Origin");
					const corsHeaders = buildCorsHeaders(origin);
					const headers = {
						...(corsHeaders ?? {}),
						"Content-Type": "application/json",
					};
					if (self.shuttingDown) {
						return new Response(
							JSON.stringify({
								status: "not_ready",
								reason: "shutting_down",
								inflightSync: self.inflightSync,
								inflightStream: self.inflightStream,
							}),
							{ status: 503, headers },
						);
					}
					return Response.json(
						{
							status: "ready",
							inflightSync: self.inflightSync,
							inflightStream: self.inflightStream,
						},
						{ headers },
					);
				}

				// Health / discovery GETs — no body, no payment check.
				if (
					req.method === "GET" &&
					(url.pathname === "/.well-known/agent-card.json" ||
						url.pathname === "/.well-known/world-state")
				) {
					const origin = req.headers.get("Origin");
					const corsHeaders = buildCorsHeaders(origin);
					const headers = corsHeaders ?? {};

					if (url.pathname === "/.well-known/world-state") {
						console.log("[A2AServer] GET /.well-known/world-state");
						if (!onWorldState)
							return new Response("Not found", {
								status: 404,
								headers,
							});
						const state = await onWorldState();
						return Response.json(state, { headers });
					}
					console.log("[A2AServer] GET /.well-known/agent-card.json");
					return Response.json(card, { headers });
				}

				// POST / — read body once for both x402 check and JSON-RPC dispatch.
				if (req.method === "POST" && url.pathname === "/") {
					// Read raw body once.
					let rawBody: string;
					try {
						rawBody = await req.text();
					} catch {
						console.error("[A2AServer] POST / body read error");
						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return new Response(
							JSON.stringify(
								err(null, -32700, "Parse error: cannot read body"),
							),
							{
								status: 400,
								headers: {
									...(corsHeaders ?? {}),
									"Content-Type": "application/json",
								},
							},
						);
					}

					// --- Authentication (when enabled) ---
					// Fail-closed: if requireAuth is true, reject unauthenticated requests.
					let caller: ResolvedCaller | undefined;
					if (requireAuth) {
						if (!registry) {
							console.error(
								"[A2AServer] requireAuth=true but no ApiKeyRegistry configured (500)",
							);
							const origin = req.headers.get("Origin");
							const corsHeaders = buildCorsHeaders(origin);
							return new Response(
								JSON.stringify(
									err(
										null,
										-32603,
										"Server misconfigured: auth not configured",
									),
								),
								{
									status: 500,
									headers: {
										...(corsHeaders ?? {}),
										"Content-Type": "application/json",
									},
								},
							);
						}
						const apiKey = req.headers.get("X-API-Key");
						const resolved = registry.authenticate(apiKey);
						if (!resolved) {
							const origin = req.headers.get("Origin");
							const corsHeaders = buildCorsHeaders(origin);
							const status = apiKey ? 403 : 401;
							const msg = apiKey
								? "Forbidden: invalid API key"
								: "Unauthorized: missing X-API-Key";
							console.error(`[A2AServer] POST / ${msg} (${status})`);
							return new Response(
								JSON.stringify(
									err(null, status === 401 ? -32000 : -32001, msg),
								),
								{
									status,
									headers: {
										...(corsHeaders ?? {}),
										"Content-Type": "application/json",
									},
								},
							);
						}
						caller = resolved;
						console.log(
							`[A2AServer] authenticated caller: ${resolved.description}`,
						);
					}

					// --- x402 payment check (when middleware is configured) ---
					if (x402) {
						const check = await x402.check(req);
						if (!check.paid) {
							console.warn(
								`[A2AServer] x402 rejected: ${check.rejectReason ?? "unpaid"}`,
							);
							return x402Reject(null, check.rejectReason ?? "unpaid");
						}
					}

					let body: unknown;
					try {
						body = JSON.parse(rawBody);
					} catch {
						console.error("[A2AServer] POST / parse error (-32700)");
						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return Response.json(err(null, -32700, "Parse error"), {
							headers: corsHeaders ?? {},
						});
					}

					const rpc = body as JSONRPCRequest;

					if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
						console.error(
							`[A2AServer] POST / invalid request (-32600) id=${rpc?.id ?? null}`,
						);
						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return Response.json(
							err(rpc?.id ?? null, -32600, "Invalid Request"),
							{ headers: corsHeaders ?? {} },
						);
					}

					const { id, method, params } = rpc;

					// --- tasks/sendSubscribe — SSE streaming branch ---
					if (method === "tasks/sendSubscribe") {
						console.log(`[A2AServer] ← POST / tasks/sendSubscribe id=${id}`);

						const validationError = validateTasksSendParams(params);
						if (validationError) {
							console.error(
								`[A2AServer] tasks/sendSubscribe invalid params (-32600) id=${id}: ${validationError}`,
							);
							const origin = req.headers.get("Origin");
							const corsHeaders = buildCorsHeaders(origin);
							return Response.json(
								err(id, -32600, `Invalid params: ${validationError}`),
								{ headers: corsHeaders ?? {} },
							);
						}

						const message = params as {
							message: {
								role?: string;
								parts: Array<{ kind: string; text?: string }>;
							};
						};
						const parts = message.message.parts;
						const text = parts.find((p) => p.kind === "text")?.text ?? "";

						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						const responseHeaders = {
							...(corsHeaders ?? {}),
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache, no-transform",
							Connection: "keep-alive",
							"X-Accel-Buffering": "no",
						};

						const { stream, emit, end } = buildSSEStream();

						// Emit an SSE event frame for a TaskStreamingEvent.
						const emitEvent = (event: TaskStreamingEvent) => {
							if (event.type === "status") {
								emit(
									formatSSEEvent("TaskStatusUpdateEvent", {
										taskId: event.taskId,
										state: event.state,
										message: event.message,
										timestamp: event.timestamp,
									}),
								);
							} else {
								emit(
									formatSSEEvent("TaskArtifactUpdateEvent", {
										taskId: event.taskId,
										artifact: event.artifact,
									}),
								);
							}
						};

						const taskId = crypto.randomUUID();
						console.log(
							`[A2AServer] tasks/sendSubscribe starting taskId=${taskId} textLen=${text.length}`,
						);

						// Track in-flight streaming request for graceful shutdown.
						self.inflightStream++;
						const onDone = () => {
							self.inflightStream--;
							self._resolveDrainWaiters();
						};
						if (self.shuttingDown) {
							onDone();
							return new Response(
								JSON.stringify({
									error: { code: -32603, message: "Server is shutting down" },
								}),
								{ status: 503, headers: responseHeaders },
							);
						}

						// Kick off the handler; do not await — SSE must stream concurrently.
						(async () => {
							try {
								// Emit initial "submitted" status.
								emitEvent({
									type: "status",
									taskId,
									state: "submitted",
									message: "Task accepted for streaming execution",
									timestamp: new Date().toISOString(),
								});

								let result: string;
								if (onTaskStreaming) {
									result = await onTaskStreaming(
										text,
										taskId,
										emitEvent,
										caller,
									);
								} else {
									// Fallback: synthetic status events around sync onTask.
									emitEvent({
										type: "status",
										taskId,
										state: "working",
										message: "Processing",
										timestamp: new Date().toISOString(),
									});
									result = await onTask(text, caller);
									emitEvent({
										type: "artifact",
										taskId,
										artifact: {
											name: "result",
											parts: [{ kind: "text", text: result }],
										},
									});
								}

								// Emit completion.
								emitEvent({
									type: "status",
									taskId,
									state: "completed",
									message: result.slice(0, 200),
									timestamp: new Date().toISOString(),
								});
							} catch (e) {
								console.error("[A2AServer] tasks/sendSubscribe error:", e);
								emitEvent({
									type: "status",
									taskId,
									state: "failed",
									message: String(e),
									timestamp: new Date().toISOString(),
								});
							} finally {
								// Signal stream end. The pull-based stream will close after
								// flushing any remaining buffered events.
								end();
								onDone();
							}
						})();

						return new Response(stream, { headers: responseHeaders });
					}

					// --- tasks/send — synchronous branch ---
					if (method !== "tasks/send") {
						console.error(
							`[A2AServer] POST / method not found (-32601) id=${id} method=${method}`,
						);
						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return Response.json(
							err(id, -32601, `Method not found: ${method}`),
							{ headers: corsHeaders ?? {} },
						);
					}

					// --- Input shape validation before dispatch ---
					const validationError = validateTasksSendParams(params);
					if (validationError) {
						console.error(
							`[A2AServer] POST / invalid params (-32600) id=${id}: ${validationError}`,
						);
						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return Response.json(
							err(id, -32600, `Invalid params: ${validationError}`),
							{ headers: corsHeaders ?? {} },
						);
					}

					try {
						const message = params as {
							message: {
								role?: string;
								parts: Array<{ kind: string; text?: string }>;
							};
						};
						const parts = message.message.parts;
						const text = parts.find((p) => p.kind === "text")?.text ?? "";

						console.log(
							`[A2AServer] ← POST / tasks/send id=${id} textLen=${text.length}`,
						);

						// Track in-flight sync request for graceful shutdown.
						self.inflightSync++;
						if (self.shuttingDown) {
							self.inflightSync--;
							const origin = req.headers.get("Origin");
							const corsHeaders = buildCorsHeaders(origin);
							return new Response(
								JSON.stringify(err(id, -32603, "Server is shutting down")),
								{
									status: 503,
									headers: {
										...(corsHeaders ?? {}),
										"Content-Type": "application/json",
									},
								},
							);
						}

						console.log(`[A2AServer] executing onTask (id=${id})`);
						const start = performance.now();
						const result = await onTask(text, caller);
						const latency = Math.round(performance.now() - start);
						console.log(
							`[A2AServer] onTask done (id=${id}) latency=${latency}ms resultLen=${String(result).length}`,
						);
						self.inflightSync--;
						self._resolveDrainWaiters();

						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return Response.json(ok(id, { text: result }), {
							headers: corsHeaders ?? {},
						});
					} catch (e) {
						self.inflightSync--;
						self._resolveDrainWaiters();
						console.error("[A2AServer] internal error:", e);
						const origin = req.headers.get("Origin");
						const corsHeaders = buildCorsHeaders(origin);
						return Response.json(
							err(id, -32603, `Internal error: ${String(e)}`),
							{ headers: corsHeaders ?? {} },
						);
					}
				}

				console.error(
					`[A2AServer] ← ${req.method} ${url.pathname} not found (404)`,
				);
				const origin = req.headers.get("Origin");
				const corsHeaders = buildCorsHeaders(origin);
				return new Response("Not found", {
					status: 404,
					headers: corsHeaders ?? {},
				});
			},
		});

		console.log(`\n🚀 A2A Server → http://127.0.0.1:${port}`);
		console.log(
			`   Card:       http://localhost:${port}/.well-known/agent-card.json`,
		);
		console.log(
			`   Stream:     http://localhost:${port}/ (tasks/sendSubscribe → SSE)`,
		);
		console.log(
			`   Rate limit: ${rateLimiter.maxRequests} req/${rateLimiter.windowMs / 1000}s per caller (X-API-Key or IP)`,
		);
		console.log(
			`   Auth:       ${requireAuth ? "X-API-Key required (per-key ACL)" : "none (INSECURE)"}`,
		);
		console.log(`   Bound to:   127.0.0.1 (localhost only)`);
		console.log(`   Agent:      ${card.name} v${card.version}\n`);
	}

	/**
	 * Gracefully shut down the server.
	 *
	 * Stops accepting new requests, then waits for in-flight requests to complete
	 * (up to drainTimeoutMs). After the drain period (or timeout), the underlying
	 * Bun.serve is stopped and the method resolves.
	 *
	 * During the drain window:
	 *  - /health continues to return 200 (liveness: the process is still alive).
	 *  - /ready returns 503 (readiness: the server is draining, send traffic elsewhere).
	 *  - New POST requests receive 503 with a JSON-RPC error (-32603).
	 *  - In-flight requests are allowed to finish naturally.
	 */
	async shutdown(): Promise<void> {
		if (this.shuttingDown) {
			// Already draining — wait for drain to complete.
			await this._waitForDrain(0);
			return;
		}
		this.shuttingDown = true;
		this.shutdownController.abort("shutdown");
		await this._waitForDrain(this.drainTimeoutMs);
		this.server?.stop();
		this.server = null;
	}

	/**
	 * Force an immediate stop without draining. Use shutdown() for normal operation;
	 * this is a last resort (e.g. external supervisor SIGKILL imminent).
	 */
	stop(): void {
		this.shuttingDown = true;
		this.shutdownController.abort("stop");
		this.inflightSync = 0;
		this.inflightStream = 0;
		this.server?.stop();
		this.server = null;
	}

	// --- drain helpers ---

	private _resolveDrainWaiters(): void {
		if (this.inflightSync <= 0 && this.inflightStream <= 0) {
			const waiters = this.drainWaiters;
			this.drainWaiters = [];
			for (const w of waiters) w();
		}
	}

	private async _waitForDrain(timeoutMs: number): Promise<void> {
		if (this.inflightSync <= 0 && this.inflightStream <= 0) return;
		return new Promise((resolve) => {
			let timer: ReturnType<typeof setTimeout> | null = null;
			this.drainWaiters.push(() => {
				if (timer) clearTimeout(timer);
				resolve();
			});
			if (timeoutMs > 0) {
				timer = setTimeout(() => {
					const idx = this.drainWaiters.indexOf(resolve as any);
					if (idx >= 0) this.drainWaiters.splice(idx, 1);
					resolve();
				}, timeoutMs);
			}
		});
	}
}
