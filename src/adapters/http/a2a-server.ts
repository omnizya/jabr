/**
 * a2a-server.ts — A2A v1.0 server with SSE streaming support.
 *
 * Transport branches (A2A v1.0 wire):
 *   - SendMessage (JSON-RPC, camelCase) — awaits onTask, returns SendMessageResponse.
 *   - SendStreamingMessage — returns text/event-stream; every frame is an
 *     anonymous `data:` line wrapping a JSON-RPC response whose result is a
 *     StreamResponse oneof.
 *   - GetTask / ListTasks / CancelTask / SubscribeToTask — task-store backed.
 *   - GetExtendedAgentCard + create/get/list/delete push-notification configs.
 *
 * Authentication:
 *   - X-API-Key header (ApiKeyRegistry) — per-key ACL.
 *   - OAuth 2.1 bearer tokens (JWT) — short-lived, scoped, refreshable.
 *   - Both are accepted; JWT takes precedence when present.
 */

import { RateLimiter, rateLimitResponse } from "@adapters/rate-limit";
import { X402Server, x402Reject } from "@adapters/x402/x402-server";
import type {
	A2AMessage,
	A2APart,
	A2AServerConfig,
	PushNotificationConfig,
	ResolvedCaller,
	TaskState,
	TaskStreamingEvent,
} from "@agents/types";
import {
	A2A_VERSION,
	V1_METHOD_CANCEL_TASK,
	V1_METHOD_CREATE_TASK_PUSH_NOTIFICATION_CONFIG,
	V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG,
	V1_METHOD_GET_EXTENDED_AGENT_CARD,
	V1_METHOD_GET_TASK,
	V1_METHOD_GET_TASK_PUSH_NOTIFICATION_CONFIG,
	V1_METHOD_LIST_TASK_PUSH_NOTIFICATION_CONFIGS,
	V1_METHOD_LIST_TASKS,
	V1_METHOD_SEND_MESSAGE,
	V1_METHOD_SEND_STREAMING_MESSAGE,
	V1_METHOD_SUBSCRIBE_TO_TASK,
} from "@constants/a2a-v1";
import {
	CALLBACK_INITIAL_BACKOFF_MS,
	CALLBACK_MAX_BACKOFF_MS,
	CALLBACK_MAX_RETRIES,
	CALLBACK_TIMEOUT_MS,
} from "@constants/app-constants";
import { a2aServerInstrumenter, taskMetrics } from "@observability";
import type {
	Task as StoreTask,
	TaskFilter,
	TaskStorePort,
} from "@ports/task-store";
import { verifyWithScopes } from "@security/jwt";
import { handleOAuthRoutes } from "@security/oauth-server";
import {
	buildCorsHeaders,
	buildCorsPreflightHeaders,
	err,
	formatAnonymousSSEFrame,
	type JSONRPCRequest,
	type JSONRPCResponse,
	ok,
} from "@utils/rpc";
import {
	fromWireCancelTaskRequest,
	fromWireDeleteTaskPushNotificationConfigRequest,
	fromWireGetExtendedAgentCardRequest,
	fromWireGetTaskPushNotificationConfigRequest,
	fromWireGetTaskRequest,
	fromWireListTaskPushNotificationConfigsRequest,
	fromWireListTasksRequest,
	fromWireSendMessageRequest,
	fromWireSubscribeToTaskRequest,
	toWireExtendedAgentCard,
	toWireListTaskPushNotificationConfigsResponse,
	toWireListTasksResponse,
	toWireSendMessageResponse,
	toWireStreamResponse,
	toWireTask,
} from "@/adapters/a2a/serialize";
import type {
	CancelTaskRequest,
	DeleteTaskPushNotificationConfigRequest,
	GetExtendedAgentCardRequest,
	GetTaskPushNotificationConfigRequest,
	GetTaskRequest,
	ListTaskPushNotificationConfigsRequest,
	ListTasksRequest,
	Part,
	SendMessageRequest,
	StreamResponse,
	SubscribeToTaskRequest,
	TaskPushNotificationConfig,
	Message as WireMessage,
	Task as WireTask,
	TaskState as WireTaskState,
} from "@/types/a2a-v1";
import { ApiKeyRegistry } from "../../security/api-key-registry";
import { scopesForMethod } from "../../security/auth-middleware";
import { loadTlsConfigSync } from "../../security/tls-config";

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

// --- A2A v1.0 wire-format helpers (used by the v1 dispatch handlers in start()) ---
const V1_FINAL_STATES: ReadonlySet<WireTaskState> = new Set([
	"completed",
	"failed",
	"canceled",
	"rejected",
	"auth-required",
]);

function v1State(state: string): WireTaskState {
	switch (state) {
		case "submitted":
		case "working":
		case "input-required":
		case "auth-required":
		case "completed":
		case "failed":
		case "canceled":
		case "rejected":
			return state;
		default:
			return "unspecified";
	}
}

function extractText(message: WireMessage | undefined): string {
	if (!message) return "";
	let out = "";
	for (const part of message.parts) {
		if (part.kind === "text") {
			out += `${part.text ?? ""}\n`;
		}
	}
	return out;
}

function v1AgentMessage(
	contextId: string,
	taskId: string,
	text: string,
): WireMessage {
	return {
		role: "agent",
		messageId: crypto.randomUUID(),
		contextId,
		taskId,
		parts: [{ kind: "text", text }],
	};
}

function v1PartFromInternal(part: A2APart): Part {
	switch (part.kind) {
		case "text":
			return { kind: "text", text: part.text };
		case "file":
			return {
				kind: "file",
				file: {
					name: part.file.filename ?? "attachment",
					mimeType: part.file.mimeType ?? "application/octet-stream",
					bytes: part.file.base64,
				},
			};
		case "data":
			return { kind: "data", data: part.data };
	}
}

function v1PartFromStreaming(part: { kind: string; text?: string }): Part {
	if (part.kind === "text") {
		return { kind: "text", text: part.text ?? "" };
	}
	return { kind: "data", data: JSON.stringify(part) };
}

function v1MessageFromInternal(
	message: A2AMessage,
	taskId: string,
): WireMessage {
	return {
		role: message.role === "user" ? "user" : "agent",
		messageId: message.messageId,
		contextId: message.contextId ?? taskId,
		taskId: message.taskId ?? taskId,
		parts: message.parts.map(v1PartFromInternal),
		...(message.referenceTaskIds && message.referenceTaskIds.length > 0
			? { referenceTaskIds: message.referenceTaskIds }
			: {}),
	};
}

function storeTaskToV1(task: StoreTask): WireTask {
	const lastMessage = task.messages[task.messages.length - 1];
	return {
		taskId: task.id,
		contextId: lastMessage?.contextId ?? task.id,
		status: { state: v1State(task.state) },
		...(task.messages.length > 0
			? { history: task.messages.map((m) => v1MessageFromInternal(m, task.id)) }
			: {}),
		...(task.artifacts.length > 0
			? {
					artifacts: task.artifacts.map((a, i) => ({
						artifactId: `${task.id}-artifact-${i + 1}`,
						name: a.name,
						parts: a.parts.map(v1PartFromInternal),
					})),
				}
			: {}),
	};
}

type V1CoreError = {
	ok: false;
	code: number;
	message: string;
	httpStatus?: number;
};

/**
 * Result of a shared v1 protocol core. Binding-agnostic: JSON-RPC and REST
 * binders render this differently. `httpStatus` is honored by REST always;
 * the JSON-RPC binder applies it only for 503 (its current error surface).
 */
type V1CoreOut = { ok: true; result: unknown } | V1CoreError;

export class A2AServer {
	private readonly config: A2AServerConfig<ApiKeyRegistry, TaskStorePort>;
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

	// --- task cancellation support ---
	private readonly taskAbortControllers = new Map<string, AbortController>();
	private readonly taskStore?: TaskStorePort;

	// --- push notification callback retry state ---
	private readonly taskCallbackRetryCount = new Map<string, number>();

	// --- v1.0 in-memory task push notification configs (per taskId) ---
	private readonly taskPushNotificationConfigs = new Map<
		string,
		TaskPushNotificationConfig[]
	>();

	constructor(
		config: A2AServerConfig<ApiKeyRegistry, TaskStorePort>,
		rateLimiter?: RateLimiter,
		x402?: X402Server,
		apiKeyRegistry?: ApiKeyRegistry,
	) {
		this.config = config;
		this.rateLimiter = rateLimiter ?? new RateLimiter();
		this.x402 = x402 ?? null;
		this.registry = apiKeyRegistry ?? config.apiKeyRegistry ?? null;
		this.drainTimeoutMs = config.drainTimeoutMs ?? 30_000;
		this.shutdownController = new AbortController();
		this.taskStore = config.taskStore;
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
		const {
			port,
			card,
			onTask,
			onTaskStreaming,
			onWorldState,
			requireAuth,
			enableOAuth,
		} = this.config;
		const rateLimiter = this.rateLimiter;
		const x402 = this.x402;
		const registry = this.registry;

		// Capture the A2AServer instance so handlers can track in-flight work.
		const self = this;

		// --- TLS configuration (optional, mTLS for agent-to-agent) ---
		const tlsConfig = loadTlsConfigSync();
		if (tlsConfig) {
			console.log(
				"[A2AServer] TLS enabled (mTLS for agent-to-agent communication)",
			);
		}

		this.server = Bun.serve({
			port,
			hostname: "127.0.0.1",
			...(tlsConfig
				? { tls: { key: tlsConfig.key, cert: tlsConfig.cert } }
				: {}),
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

				// OAuth 2.1 routes — token/revoke/metadata (before JSON-RPC dispatch).
				// These endpoints are never rate-limited (they are part of the control plane)
				// but do require authentication via API key.
				const isOAuthPath =
					url.pathname === "/oauth/token" ||
					url.pathname === "/oauth/revoke" ||
					url.pathname === "/.well-known/oauth-authorization-server" ||
					url.pathname === "/.well-known/jwks.json";

				if (registry && isOAuthPath) {
					// If OAuth is explicitly disabled, return 404.
					if (enableOAuth === false) {
						return new Response(JSON.stringify({ error: "not_found" }), {
							status: 404,
							headers: { "Content-Type": "application/json" },
						});
					}

					// OAuth enabled (default: true when undefined).
					const oauthResult = await handleOAuthRoutes(req, url, registry);
					if (oauthResult.handled) {
						return oauthResult.response!;
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
						url.pathname === "/.well-known/agent.json" ||
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
					console.log(`[A2AServer] GET ${url.pathname} (agent card)`);
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
					// JWT bearer tokens take precedence over X-API-Key.
					let caller: ResolvedCaller | undefined;
					let bearerToken: string | undefined;
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

						// Try JWT bearer token first.
						const authHeader = req.headers.get("Authorization");
						if (authHeader?.startsWith("Bearer ")) {
							const token = authHeader.slice(7);
							try {
								// Initial verify: token must be valid and not expired.
								// Per-method scope enforcement happens after parsing the method.
								const { verifyToken } = await import("@security/jwt");
								const verified = await verifyToken(token);
								caller = {
									description: verified.claims.sub,
									allowedAgents: (verified.claims as any).allowed_agents ?? [],
								};
								bearerToken = token;
								console.log(
									`[A2AServer] authenticated JWT caller: ${caller.description}`,
								);
							} catch (e) {
								const origin = req.headers.get("Origin");
								const corsHeaders = buildCorsHeaders(origin);
								return new Response(
									JSON.stringify(
										err(
											null,
											-32000,
											`Unauthorized: invalid bearer token (${String(e)})`,
										),
									),
									{
										status: 401,
										headers: {
											...(corsHeaders ?? {}),
											"Content-Type": "application/json",
										},
									},
								);
							}
						} else {
							// Fall back to X-API-Key.
							const apiKey = req.headers.get("X-API-Key");
							const resolved = registry.authenticate(apiKey);
							if (!resolved) {
								const origin = req.headers.get("Origin");
								const corsHeaders = buildCorsHeaders(origin);
								const status = apiKey ? 403 : 401;
								const msg = apiKey
									? "Forbidden: invalid API key"
									: "Unauthorized: missing X-API-Key or Bearer token";
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
								`[A2AServer] authenticated API key caller: ${resolved.description}`,
							);
						}
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

					// --- Per-method scope enforcement (JWT only; API keys skip) ---
					// API key callers already have an allowlist; JWT tokens need per-method scope checks.
					if (bearerToken && requireAuth) {
						const requiredScopes = scopesForMethod(method);
						try {
							await verifyWithScopes(bearerToken, requiredScopes);
						} catch (e) {
							const origin = req.headers.get("Origin");
							const corsHeaders = buildCorsHeaders(origin);
							return new Response(
								JSON.stringify(
									err(
										id,
										-32001,
										`Forbidden: insufficient scope for ${method} (${String(e)})`,
									),
								),
								{
									status: 403,
									headers: {
										...(corsHeaders ?? {}),
										"Content-Type": "application/json",
									},
								},
							);
						}
					}

					// --- A2A v1.0 protocol methods (JSON-RPC) ---
					const v1Origin = req.headers.get("Origin");
					const v1CorsHeaders = buildCorsHeaders(v1Origin);
					const v1JsonHeaders = {
						...(v1CorsHeaders ?? {}),
						"Content-Type": "application/json",
					};
					// JSON-RPC binder surfaces HTTP status only for 503; all other
					// v1 errors are 200 today and must stay 200.
					const renderV1Error = (rpcId: JSONRPCRequest["id"], e: V1CoreError) =>
						Response.json(err(rpcId, e.code, e.message), {
							status: e.httpStatus === 503 ? 503 : 200,
							headers: v1JsonHeaders,
						});

					if (method === V1_METHOD_SEND_MESSAGE) {
						let sendReq: SendMessageRequest;
						try {
							sendReq = fromWireSendMessageRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] SendMessage invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = await self._v1RunSendMessage(sendReq, caller);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_SEND_STREAMING_MESSAGE) {
						let sendReq: SendMessageRequest;
						try {
							sendReq = fromWireSendMessageRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] SendStreamingMessage invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const responseHeaders = {
							...(v1CorsHeaders ?? {}),
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache, no-transform",
							Connection: "keep-alive",
							"X-Accel-Buffering": "no",
						};
						const wrapFrame = (frame: StreamResponse) =>
							formatAnonymousSSEFrame(ok(id, toWireStreamResponse(frame)));
						const out = await self._v1StreamSend(
							sendReq,
							caller,
							wrapFrame,
							responseHeaders,
						);
						if (out instanceof Response) {
							return out;
						}
						return Response.json(err(id, out.code, out.message), {
							status: 503,
							headers: responseHeaders,
						});
					}

					if (method === V1_METHOD_GET_TASK) {
						let getReq: GetTaskRequest;
						try {
							getReq = fromWireGetTaskRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] tasks/get invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1GetTask(getReq);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_LIST_TASKS) {
						let listReq: ListTasksRequest;
						try {
							listReq = fromWireListTasksRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] tasks/list invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1ListTasks(listReq);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_CANCEL_TASK) {
						let cancelReq: CancelTaskRequest;
						try {
							cancelReq = fromWireCancelTaskRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] tasks/cancel invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1CancelTask(cancelReq);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_SUBSCRIBE_TO_TASK) {
						let subReq: SubscribeToTaskRequest;
						try {
							subReq = fromWireSubscribeToTaskRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] tasks/subscribeToTask invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const responseHeaders = {
							...(v1CorsHeaders ?? {}),
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache, no-transform",
							Connection: "keep-alive",
							"X-Accel-Buffering": "no",
						};
						const wrapFrame = (frame: StreamResponse) =>
							formatAnonymousSSEFrame(ok(id, toWireStreamResponse(frame)));
						const out = self._v1StreamSubscribe(
							subReq,
							wrapFrame,
							responseHeaders,
						);
						if (out instanceof Response) {
							return out;
						}
						return Response.json(err(id, out.code, out.message), {
							status: out.httpStatus === 503 ? 503 : 200,
							headers: out.httpStatus === 503 ? responseHeaders : v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_GET_EXTENDED_AGENT_CARD) {
						try {
							fromWireGetExtendedAgentCardRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] card/get invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1GetExtendedAgentCard();
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_CREATE_TASK_PUSH_NOTIFICATION_CONFIG) {
						const out = self._v1CreatePushConfig(
							(params ?? {}) as Record<string, unknown>,
						);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_GET_TASK_PUSH_NOTIFICATION_CONFIG) {
						let getReq: GetTaskPushNotificationConfigRequest;
						try {
							getReq = fromWireGetTaskPushNotificationConfigRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] push-notification-config/get invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1GetPushConfig(getReq);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_LIST_TASK_PUSH_NOTIFICATION_CONFIGS) {
						let listReq: ListTaskPushNotificationConfigsRequest;
						try {
							listReq = fromWireListTaskPushNotificationConfigsRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] push-notification-config/list invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1ListPushConfigs(listReq);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					if (method === V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG) {
						let delReq: DeleteTaskPushNotificationConfigRequest;
						try {
							delReq = fromWireDeleteTaskPushNotificationConfigRequest(params);
						} catch (e) {
							console.error(
								`[A2AServer] push-notification-config/delete invalid params (-32602) id=${id}: ${e}`,
							);
							return Response.json(err(id, -32602, `Invalid params: ${e}`), {
								headers: v1JsonHeaders,
							});
						}
						const out = self._v1DeletePushConfig(delReq);
						if (!out.ok) {
							return renderV1Error(id, out);
						}
						return Response.json(ok(id, out.result), {
							headers: v1JsonHeaders,
						});
					}

					// --- A2A v1.0 only: unknown JSON-RPC method → -32601 ---
					return Response.json(err(id, -32601, `Method not found: ${method}`), {
						headers: v1JsonHeaders,
					});
				}

				// --- A2A v1.0 REST binding ---
				const restBase = (() => {
					const tp = self.config.tenantPrefix;
					if (!tp) return url.pathname;
					return url.pathname.startsWith(`/${tp}`)
						? url.pathname.slice(tp.length + 1)
						: url.pathname;
				})();

				if (
					restBase.startsWith("/tasks/") ||
					restBase === "/tasks" ||
					restBase === "/message:send" ||
					restBase === "/message:stream" ||
					restBase === "/extendedAgentCard"
				) {
					const restCorsHeaders = buildCorsHeaders(req.headers.get("Origin"));
					const restJsonHeaders = {
						...(restCorsHeaders ?? {}),
						"Content-Type": "application/json",
					};
					const restSseHeaders = {
						...(restCorsHeaders ?? {}),
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						"X-Accel-Buffering": "no",
					};

					const renderRestError = (
						code: number,
						message: string,
						httpStatus?: number,
					) =>
						Response.json(
							{ ok: false, error: { code, message } },
							{ status: httpStatus ?? 400, headers: restJsonHeaders },
						);

					const readRestJsonBody = async (): Promise<
						| { ok: true; body: Record<string, unknown> }
						| { ok: false; response: Response }
					> => {
						let raw: string;
						try {
							raw = await req.text();
						} catch {
							return {
								ok: false,
								response: renderRestError(
									-32700,
									"Parse error: cannot read body",
									400,
								),
							};
						}
						if (!raw) return { ok: true, body: {} };
						try {
							return {
								ok: true,
								body: JSON.parse(raw) as Record<string, unknown>,
							};
						} catch {
							return {
								ok: false,
								response: renderRestError(
									-32700,
									"Parse error: invalid JSON",
									400,
								),
							};
						}
					};

					const wrapRestFrame = (frame: StreamResponse) =>
						`data: ${JSON.stringify(toWireStreamResponse(frame))}\n\n`;

					const dec = (val: string) => decodeURIComponent(val);

					// --- Authentication (fail-closed) ---
					let restCaller: ResolvedCaller | undefined;
					let restBearerToken: string | undefined;
					if (requireAuth) {
						if (!registry) {
							return renderRestError(
								-32603,
								"Server misconfigured: auth not configured",
								500,
							);
						}
						const authHeader = req.headers.get("Authorization");
						if (authHeader?.startsWith("Bearer ")) {
							const token = authHeader.slice(7);
							try {
								const { verifyToken } = await import("@security/jwt");
								const verified = await verifyToken(token);
								restCaller = {
									description: verified.claims.sub,
									allowedAgents: verified.claims.allowed_agents ?? [],
								};
								restBearerToken = token;
							} catch (e) {
								return renderRestError(
									-32000,
									`Unauthorized: invalid bearer token (${String(e)})`,
									401,
								);
							}
						} else {
							const apiKey = req.headers.get("X-API-Key");
							const resolved = registry.authenticate(apiKey);
							if (!resolved) {
								const status = apiKey ? 403 : 401;
								const code = status === 401 ? -32000 : -32001;
								const msg = apiKey
									? "Forbidden: invalid API key"
									: "Unauthorized: missing X-API-Key or Bearer token";
								return renderRestError(code, msg, status);
							}
							restCaller = resolved;
						}
					}

					// --- x402 payment check ---
					if (x402) {
						const check = await x402.check(req);
						if (!check.paid) {
							// PAYMENT_REQUIRED_CODE is -32022 (module-private in x402-server.ts — priority 1: gateway-consensus enum).
							return renderRestError(
								-32022,
								`Payment required: ${check.rejectReason ?? "unpaid"}`,
								402,
							);
						}
					}

					// --- A2A-Version header check ---
					const a2aVersion = req.headers.get("A2A-Version");
					if (!a2aVersion) {
						return renderRestError(-32602, "Missing A2A-Version header", 400);
					}
					if (a2aVersion !== A2A_VERSION) {
						return renderRestError(
							-32602,
							`Unsupported A2A version: ${a2aVersion}`,
							426,
						);
					}

					// --- Scope enforcement helper ---
					const enforceScope = async (
						v1Method: string,
					): Promise<Response | null> => {
						if (restBearerToken && requireAuth) {
							const requiredScopes = scopesForMethod(v1Method);
							try {
								await verifyWithScopes(restBearerToken, requiredScopes);
							} catch (e) {
								return renderRestError(
									-32001,
									`Forbidden: insufficient scope for ${v1Method} (${String(e)})`,
									403,
								);
							}
						}
						return null;
					};

					// --- Route matching (longest-first) ---
					const { method: httpMethod } = req;

					// Push notification config item: /tasks/{taskId}/pushNotificationConfigs/{configId}
					const pushConfigItemMatch = restBase.match(
						/^\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/,
					);
					if (pushConfigItemMatch) {
						const taskId = dec(pushConfigItemMatch[1]!);
						const configId = dec(pushConfigItemMatch[2]!);
						if (httpMethod === "GET") {
							const scopeErr = await enforceScope(
								V1_METHOD_GET_TASK_PUSH_NOTIFICATION_CONFIG,
							);
							if (scopeErr) return scopeErr;
							const out = self._v1GetPushConfig({ taskId, id: configId });
							if (!out.ok)
								return renderRestError(out.code, out.message, out.httpStatus);
							return Response.json(out.result, { headers: restJsonHeaders });
						}
						if (httpMethod === "DELETE") {
							const scopeErr = await enforceScope(
								V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG,
							);
							if (scopeErr) return scopeErr;
							const out = self._v1DeletePushConfig({ taskId, id: configId });
							if (!out.ok)
								return renderRestError(out.code, out.message, out.httpStatus);
							return Response.json(out.result, { headers: restJsonHeaders });
						}
						if (httpMethod === "PATCH") {
							const scopeErr = await enforceScope(
								V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG,
							);
							if (scopeErr) return scopeErr;
							const parsed = await readRestJsonBody();
							if (!parsed.ok) return parsed.response;
							const out = self._v1UpdatePushConfig({
								...parsed.body,
								taskId,
								id: configId,
							});
							if (!out.ok)
								return renderRestError(out.code, out.message, out.httpStatus);
							return Response.json(out.result, { headers: restJsonHeaders });
						}
						return renderRestError(
							-32601,
							`Method ${httpMethod} not allowed for push notification config item`,
							405,
						);
					}

					// Push notification configs: /tasks/{taskId}/pushNotificationConfigs
					const pushConfigsMatch = restBase.match(
						/^\/tasks\/([^/]+)\/pushNotificationConfigs$/,
					);
					if (pushConfigsMatch) {
						const taskId = dec(pushConfigsMatch[1]!);
						if (httpMethod === "GET") {
							const scopeErr = await enforceScope(
								V1_METHOD_LIST_TASK_PUSH_NOTIFICATION_CONFIGS,
							);
							if (scopeErr) return scopeErr;
							const out = self._v1ListPushConfigs({
								taskId,
								...(url.searchParams.get("pageSize")
									? { pageSize: Number(url.searchParams.get("pageSize")) }
									: {}),
								...(url.searchParams.get("pageToken")
									? { pageToken: url.searchParams.get("pageToken")! }
									: {}),
							});
							if (!out.ok)
								return renderRestError(out.code, out.message, out.httpStatus);
							return Response.json(out.result, { headers: restJsonHeaders });
						}
						if (httpMethod === "POST") {
							const scopeErr = await enforceScope(
								V1_METHOD_CREATE_TASK_PUSH_NOTIFICATION_CONFIG,
							);
							if (scopeErr) return scopeErr;
							const parsed = await readRestJsonBody();
							if (!parsed.ok) return parsed.response;
							const out = self._v1CreatePushConfig({
								...parsed.body,
								taskId,
							});
							if (!out.ok)
								return renderRestError(out.code, out.message, out.httpStatus);
							return Response.json(out.result, { headers: restJsonHeaders });
						}
						return renderRestError(
							-32601,
							`Method ${httpMethod} not allowed for push notification configs`,
							405,
						);
					}

					// Subscribe: /tasks/{id}:subscribe
					const subscribeMatch = restBase.match(/^\/tasks\/([^/]+):subscribe$/);
					if (subscribeMatch) {
						if (httpMethod !== "GET" && httpMethod !== "POST") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for subscribe`,
								405,
							);
						}
						const scopeErr = await enforceScope(V1_METHOD_SUBSCRIBE_TO_TASK);
						if (scopeErr) return scopeErr;
						let subReq: SubscribeToTaskRequest;
						if (httpMethod === "GET") {
							subReq = { id: dec(subscribeMatch[1]!) };
						} else {
							const parsed = await readRestJsonBody();
							if (!parsed.ok) return parsed.response;
							subReq = { id: dec(subscribeMatch[1]!), ...parsed.body };
						}
						try {
							const out = self._v1StreamSubscribe(
								subReq,
								wrapRestFrame,
								restSseHeaders,
							);
							if (out instanceof Response) return out;
							return renderRestError(out.code, out.message, out.httpStatus);
						} catch (e) {
							return renderRestError(
								-32603,
								`Internal error: ${String(e)}`,
								500,
							);
						}
					}

					// Cancel: /tasks/{id}:cancel
					const cancelMatch = restBase.match(/^\/tasks\/([^/]+):cancel$/);
					if (cancelMatch) {
						if (httpMethod !== "POST") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for cancel`,
								405,
							);
						}
						const scopeErr = await enforceScope(V1_METHOD_CANCEL_TASK);
						if (scopeErr) return scopeErr;
						const out = self._v1CancelTask({ id: dec(cancelMatch[1]!) });
						if (!out.ok)
							return renderRestError(out.code, out.message, out.httpStatus);
						return Response.json(out.result, { headers: restJsonHeaders });
					}

					// Get task: /tasks/{id}
					const taskItemMatch = restBase.match(/^\/tasks\/([^/]+)$/);
					if (taskItemMatch) {
						if (httpMethod !== "GET") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for get task`,
								405,
							);
						}
						const scopeErr = await enforceScope(V1_METHOD_GET_TASK);
						if (scopeErr) return scopeErr;
						const out = self._v1GetTask({
							id: dec(taskItemMatch[1]!),
							...(url.searchParams.get("historyLength")
								? {
										historyLength: Number(
											url.searchParams.get("historyLength"),
										),
									}
								: {}),
						});
						if (!out.ok)
							return renderRestError(out.code, out.message, out.httpStatus);
						return Response.json(out.result, { headers: restJsonHeaders });
					}

					// Send message: POST /message:send
					if (restBase === "/message:send") {
						if (httpMethod !== "POST") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for send message`,
								405,
							);
						}
						const scopeErr = await enforceScope(V1_METHOD_SEND_MESSAGE);
						if (scopeErr) return scopeErr;
						const parsed = await readRestJsonBody();
						if (!parsed.ok) return parsed.response;
						try {
							const sendReq = fromWireSendMessageRequest(parsed.body);
							const out = await self._v1RunSendMessage(sendReq, restCaller);
							if (!out.ok)
								return renderRestError(out.code, out.message, out.httpStatus);
							return Response.json(out.result, { headers: restJsonHeaders });
						} catch (e) {
							return renderRestError(
								-32602,
								`Invalid params: ${String(e)}`,
								400,
							);
						}
					}

					// Stream send: POST /message:stream
					if (restBase === "/message:stream") {
						if (httpMethod !== "POST") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for stream send`,
								405,
							);
						}
						const scopeErr = await enforceScope(
							V1_METHOD_SEND_STREAMING_MESSAGE,
						);
						if (scopeErr) return scopeErr;
						const parsed = await readRestJsonBody();
						if (!parsed.ok) return parsed.response;
						try {
							const sendReq = fromWireSendMessageRequest(parsed.body);
							const out = await self._v1StreamSend(
								sendReq,
								restCaller,
								wrapRestFrame,
								restSseHeaders,
							);
							if (out instanceof Response) return out;
							return renderRestError(out.code, out.message, out.httpStatus);
						} catch (e) {
							return renderRestError(
								-32602,
								`Invalid params: ${String(e)}`,
								400,
							);
						}
					}

					// List tasks: GET /tasks
					if (restBase === "/tasks") {
						if (httpMethod !== "GET") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for list tasks`,
								405,
							);
						}
						const scopeErr = await enforceScope(V1_METHOD_LIST_TASKS);
						if (scopeErr) return scopeErr;
						const out = self._v1ListTasks(
							fromWireListTasksRequest(
								Object.fromEntries(url.searchParams),
							) as ListTasksRequest,
						);
						if (!out.ok)
							return renderRestError(out.code, out.message, out.httpStatus);
						return Response.json(out.result, { headers: restJsonHeaders });
					}

					// Extended agent card: GET /extendedAgentCard
					if (restBase === "/extendedAgentCard") {
						if (httpMethod !== "GET") {
							return renderRestError(
								-32601,
								`Method ${httpMethod} not allowed for extended agent card`,
								405,
							);
						}
						const scopeErr = await enforceScope(
							V1_METHOD_GET_EXTENDED_AGENT_CARD,
						);
						if (scopeErr) return scopeErr;
						const out = self._v1GetExtendedAgentCard();
						if (!out.ok)
							return renderRestError(out.code, out.message, out.httpStatus);
						return Response.json(out.result, { headers: restJsonHeaders });
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
			`   Stream:     http://localhost:${port}/ (SendStreamingMessage → SSE)`,
		);
		console.log(
			`   Rate limit: ${rateLimiter.maxRequests} req/${rateLimiter.windowMs / 1000}s per caller (X-API-Key or IP)`,
		);
		console.log(
			`   Auth:       ${requireAuth ? "X-API-Key or Bearer JWT required (per-key ACL)" : "none (INSECURE)"}`,
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

	// --- shared v1 protocol cores (binding-agnostic; JSON-RPC + REST binders) ---

	/**
	 * SendMessage core. Push mode (a notification callback URL is present)
	 * replies with a submitted task and delivers the outcome via the callback;
	 * otherwise blocks until the handler returns, producing a completed task.
	 */
	private async _v1RunSendMessage(
		sendReq: SendMessageRequest,
		caller?: ResolvedCaller,
	): Promise<V1CoreOut> {
		const taskId = sendReq.message.taskId ?? crypto.randomUUID();
		const contextId = sendReq.message.contextId ?? taskId;
		const text = extractText(sendReq.message);
		const callbackUrl =
			sendReq.notificationUrl ??
			sendReq.sendMessageConfiguration?.taskPushNotificationConfig?.url;
		console.log(
			`[A2AServer] SendMessage taskId=${taskId} textLen=${text.length}`,
		);

		// --- OpenTelemetry span ---
		const span = a2aServerInstrumenter.startServerSpan("SendMessage", {
			taskId,
			textLength: text.length,
			caller: caller?.description,
			agentName: this.config.card.name,
		});

		// Push mode: reply immediately with a submitted task and deliver the
		// outcome (and failures) via the notification callback.
		if (callbackUrl) {
			const pushController = new AbortController();
			this.taskAbortControllers.set(taskId, pushController);
			(async () => {
				try {
					this._postCallback(callbackUrl, taskId, "submitted", {
						message: "Task accepted for execution",
					});
					const result = await this.config.onTask(
						text,
						caller,
						pushController.signal,
					);
					a2aServerInstrumenter.recordSuccess(span, result.length);
					this._postCallback(callbackUrl, taskId, "completed", {
						result,
					});
				} catch (e) {
					a2aServerInstrumenter.recordError(span, e);
					this._postCallback(callbackUrl, taskId, "failed", {
						message: String(e),
					});
				} finally {
					this.taskAbortControllers.delete(taskId);
					span.end();
				}
			})();
			return {
				ok: true,
				result: toWireSendMessageResponse({
					task: {
						taskId,
						contextId,
						status: { state: "submitted" },
					},
				}),
			};
		}

		// Sync mode: block until the handler returns.
		if (this.shuttingDown) {
			span.setAttribute("error.message", "Server is shutting down");
			span.setStatus({ code: "ERROR", message: "Server is shutting down" });
			span.end();
			return {
				ok: false,
				code: -32603,
				message: "Server is shutting down",
				httpStatus: 503,
			};
		}
		this.inflightSync++;
		try {
			const syncController = new AbortController();
			this.taskAbortControllers.set(taskId, syncController);
			const result = await this.config.onTask(
				text,
				caller,
				syncController.signal,
			);
			this.taskAbortControllers.delete(taskId);
			a2aServerInstrumenter.recordSuccess(span, result.length);
			const agentMessage = v1AgentMessage(contextId, taskId, result);
			const wireTask: WireTask = {
				taskId,
				contextId,
				status: {
					state: "completed",
					message: agentMessage,
					timestamp: new Date().toISOString(),
				},
				history: [sendReq.message, agentMessage],
			};
			return {
				ok: true,
				result: toWireSendMessageResponse({
					task: wireTask,
					message: agentMessage,
				}),
			};
		} catch (e) {
			a2aServerInstrumenter.recordError(span, e);
			console.error(`[A2AServer] SendMessage error: ${e}`);
			return {
				ok: false,
				code: -32603,
				message: `Task execution failed: ${e}`,
			};
		} finally {
			this.inflightSync--;
			this._resolveDrainWaiters();
			span.end();
		}
	}

	/**
	 * SendStreamingMessage core. Returns an SSE Response opened on the stream;
	 * a shutdown 503 is returned as a V1CoreError for the binder to render
	 * (with SSE headers) before any stream is opened.
	 */
	private async _v1StreamSend(
		sendReq: SendMessageRequest,
		caller: ResolvedCaller | undefined,
		wrapFrame: (frame: StreamResponse) => string,
		sseHeaders: Record<string, string>,
	): Promise<Response | V1CoreError> {
		const taskId = sendReq.message.taskId ?? crypto.randomUUID();
		const contextId = sendReq.message.contextId ?? taskId;
		const text = extractText(sendReq.message);

		const { stream, emit, end } = buildSSEStream();
		const streamController = new AbortController();
		this.taskAbortControllers.set(taskId, streamController);
		const onDone = () => {
			this.inflightStream--;
			this._resolveDrainWaiters();
		};
		this.inflightStream++;
		if (this.shuttingDown) {
			this.taskAbortControllers.delete(taskId);
			onDone();
			return {
				ok: false,
				code: -32603,
				message: "Server is shutting down",
				httpStatus: 503,
			};
		}

		const emitFrame = (frame: StreamResponse) => {
			emit(wrapFrame(frame));
		};

		console.log(
			`[A2AServer] SendStreamingMessage starting taskId=${taskId} textLen=${text.length}`,
		);

		// Emit the submitted task frame before spawning the handler so the
		// stream has an immediate first frame.
		emitFrame({
			task: {
				taskId,
				contextId,
				status: {
					state: "submitted",
					timestamp: new Date().toISOString(),
				},
			},
		});

		(async () => {
			let pushedFinal = false;
			let pushedArtifacts = false;
			const emitEvent = (event: TaskStreamingEvent) => {
				if (event.type === "status") {
					const state = v1State(event.state);
					const final = V1_FINAL_STATES.has(state);
					if (final) pushedFinal = true;
					emitFrame({
						statusUpdate: {
							taskId,
							contextId,
							status: {
								state,
								...(event.message
									? {
											message: v1AgentMessage(contextId, taskId, event.message),
										}
									: {}),
								timestamp: event.timestamp,
							},
							final,
						},
					});
				} else {
					pushedArtifacts = true;
					emitFrame({
						artifactUpdate: {
							taskId,
							contextId,
							artifact: {
								artifactId: `${taskId}-artifact`,
								name: event.artifact.name,
								parts: event.artifact.parts.map(v1PartFromStreaming),
							},
							append: true,
							lastChunk: false,
						},
					});
				}
			};

			try {
				let result: string;
				if (this.config.onTaskStreaming) {
					result = await this.config.onTaskStreaming(
						text,
						taskId,
						emitEvent,
						caller,
						streamController.signal,
					);
				} else if (this.config.onTask) {
					result = await this.config.onTask(
						text,
						caller,
						streamController.signal,
					);
				} else {
					throw new Error("Streaming not supported");
				}

				// The handler did not report a terminal state: close the
				// stream with a graceful completed final frame.
				if (!pushedFinal) {
					if (pushedArtifacts) {
						emitFrame({
							artifactUpdate: {
								taskId,
								contextId,
								artifact: {
									artifactId: `${taskId}-artifact`,
									name: "output",
									parts: [],
								},
								append: true,
								lastChunk: true,
							},
						});
					}
					emitFrame({
						statusUpdate: {
							taskId,
							contextId,
							status: {
								state: "completed",
								...(result
									? {
											message: v1AgentMessage(contextId, taskId, result),
										}
									: {}),
								timestamp: new Date().toISOString(),
							},
							final: true,
						},
					});
				}
			} catch (e) {
				console.error(`[A2AServer] SendStreamingMessage error: ${e}`);
				emitFrame({
					statusUpdate: {
						taskId,
						contextId,
						status: {
							state: "failed",
							message: v1AgentMessage(contextId, taskId, String(e)),
							timestamp: new Date().toISOString(),
						},
						final: true,
					},
				});
			} finally {
				this.taskAbortControllers.delete(taskId);
				end();
				onDone();
			}
		})();

		return new Response(stream, { headers: sseHeaders });
	}

	private _v1GetTask(getReq: GetTaskRequest): V1CoreOut {
		if (!this.taskStore) {
			return {
				ok: false,
				code: -32603,
				message: "Task store not configured",
				httpStatus: 500,
			};
		}
		const task = this.taskStore.get(getReq.id);
		if (!task) {
			return {
				ok: false,
				code: -32000,
				message: `Task not found: ${getReq.id}`,
				httpStatus: 404,
			};
		}
		return { ok: true, result: toWireTask(storeTaskToV1(task)) };
	}

	private _v1ListTasks(listReq: ListTasksRequest): V1CoreOut {
		if (!this.taskStore) {
			return {
				ok: false,
				code: -32603,
				message: "Task store not configured",
				httpStatus: 500,
			};
		}
		const stateFilter =
			listReq.status && listReq.status !== "unspecified"
				? listReq.status
				: undefined;
		const tasks = this.taskStore.list({
			...(listReq.contextId ? { contextId: listReq.contextId } : {}),
			...(stateFilter ? { status: stateFilter } : {}),
			...(listReq.pageSize !== undefined ? { pageSize: listReq.pageSize } : {}),
		});
		return {
			ok: true,
			result: toWireListTasksResponse({
				tasks: tasks.map(storeTaskToV1),
				pageSize: listReq.pageSize ?? tasks.length,
				totalSize: tasks.length,
			}),
		};
	}

	private _v1CancelTask(cancelReq: CancelTaskRequest): V1CoreOut {
		const controller = this.taskAbortControllers.get(cancelReq.id);
		if (controller) controller.abort();

		if (this.taskStore) {
			const task = this.taskStore.get(cancelReq.id);
			if (!task) {
				return {
					ok: false,
					code: -32000,
					message: `Task not found: ${cancelReq.id}`,
					httpStatus: 404,
				};
			}
			if (V1_FINAL_STATES.has(v1State(task.state))) {
				return {
					ok: false,
					code: -32002,
					message: `Task already in terminal state: ${task.state}`,
					httpStatus: 409,
				};
			}
			this.taskStore.updateState(cancelReq.id, "canceled");
			const canceled = this.taskStore.get(cancelReq.id);
			return {
				ok: true,
				result: toWireTask(
					storeTaskToV1(canceled ?? { ...task, state: "canceled" as const }),
				),
			};
		}

		// No store: fabricate a canceled task so the caller gets a v1-shaped
		// response.
		return {
			ok: true,
			result: toWireTask({
				taskId: cancelReq.id,
				contextId: cancelReq.id,
				status: {
					state: "canceled",
					timestamp: new Date().toISOString(),
				},
			}),
		};
	}

	private _v1StreamSubscribe(
		subReq: SubscribeToTaskRequest,
		wrapFrame: (frame: StreamResponse) => string,
		sseHeaders: Record<string, string>,
	): Response | V1CoreError {
		if (!this.taskStore) {
			return {
				ok: false,
				code: -32603,
				message: "Task store not configured",
				httpStatus: 500,
			};
		}
		const task = this.taskStore.get(subReq.id);
		if (!task) {
			return {
				ok: false,
				code: -32000,
				message: `Task not found: ${subReq.id}`,
				httpStatus: 404,
			};
		}

		const { stream, emit, end } = buildSSEStream();
		const onDone = () => {
			this.inflightStream--;
			this._resolveDrainWaiters();
		};
		this.inflightStream++;
		if (this.shuttingDown) {
			onDone();
			return {
				ok: false,
				code: -32603,
				message: "Server is shutting down",
				httpStatus: 503,
			};
		}

		const emitFrame = (frame: StreamResponse) => {
			emit(wrapFrame(frame));
		};

		console.log(`[A2AServer] tasks/subscribeToTask taskId=${subReq.id}`);

		// The store emits the current task synchronously on subscribe, so
		// the first frame doubles as the snapshot; the stream ends when a
		// final state arrives.
		const unsubscribe = this.taskStore.subscribe(subReq.id, (updated) => {
			emitFrame({ task: storeTaskToV1(updated) });
			if (V1_FINAL_STATES.has(v1State(updated.state))) {
				unsubscribe();
				end();
				onDone();
			}
		});

		return new Response(stream, { headers: sseHeaders });
	}

	private _v1GetExtendedAgentCard(): V1CoreOut {
		if (!this.config.extendedAgentCard) {
			return {
				ok: false,
				code: -32603,
				message: "Extended agent card not configured",
				httpStatus: 500,
			};
		}
		return {
			ok: true,
			result: toWireExtendedAgentCard({
				agentCard: this.config.extendedAgentCard,
			}),
		};
	}

	private _v1CreatePushConfig(raw: Record<string, unknown>): V1CoreOut {
		// The create request has no wire serializer: parse defensively inline.
		const taskId = typeof raw.taskId === "string" ? raw.taskId : undefined;
		const url = typeof raw.url === "string" ? raw.url : undefined;
		if (!taskId || !url) {
			return {
				ok: false,
				code: -32602,
				message: "taskId and url are required",
				httpStatus: 400,
			};
		}
		const config: TaskPushNotificationConfig = {
			id:
				typeof raw.id === "string" && raw.id !== ""
					? raw.id
					: crypto.randomUUID(),
			taskId,
			url,
			...(typeof raw.token === "string" ? { token: raw.token } : {}),
		};
		const existing = this.taskPushNotificationConfigs.get(taskId) ?? [];
		this.taskPushNotificationConfigs.set(taskId, [...existing, config]);
		return { ok: true, result: { config } };
	}

	private _v1GetPushConfig(
		getReq: GetTaskPushNotificationConfigRequest,
	): V1CoreOut {
		const configs = this.taskPushNotificationConfigs.get(getReq.taskId) ?? [];
		const config = configs.find((c) => c.id === getReq.id);
		if (!config) {
			return {
				ok: false,
				code: -32000,
				message: `Push notification config not found: ${getReq.id}`,
				httpStatus: 404,
			};
		}
		return { ok: true, result: { config } };
	}

	private _v1ListPushConfigs(
		listReq: ListTaskPushNotificationConfigsRequest,
	): V1CoreOut {
		const configs = this.taskPushNotificationConfigs.get(listReq.taskId) ?? [];
		const page =
			listReq.pageSize !== undefined
				? configs.slice(0, listReq.pageSize)
				: configs;
		return {
			ok: true,
			result: toWireListTaskPushNotificationConfigsResponse({
				configs: page,
				...(listReq.pageSize !== undefined && configs.length > listReq.pageSize
					? { nextPageToken: String(listReq.pageSize) }
					: {}),
			}),
		};
	}

	private _v1DeletePushConfig(
		delReq: DeleteTaskPushNotificationConfigRequest,
	): V1CoreOut {
		const existing = this.taskPushNotificationConfigs.get(delReq.taskId) ?? [];
		const target = existing.find((c) => c.id === delReq.id);
		if (!target) {
			return {
				ok: false,
				code: -32000,
				message: `Push notification config not found: ${delReq.id}`,
				httpStatus: 404,
			};
		}
		const remaining = existing.filter((c) => c.id !== delReq.id);
		if (remaining.length === 0) {
			this.taskPushNotificationConfigs.delete(delReq.taskId);
		} else {
			this.taskPushNotificationConfigs.set(delReq.taskId, remaining);
		}
		return { ok: true, result: { success: true } };
	}

	private _v1UpdatePushConfig(raw: Record<string, unknown>): V1CoreOut {
		// The update (PATCH) request has no wire serializer: parse inline.
		const taskId = typeof raw.taskId === "string" ? raw.taskId : undefined;
		const id = typeof raw.id === "string" ? raw.id : undefined;
		const url = typeof raw.url === "string" ? raw.url : undefined;
		if (!taskId || !id) {
			return {
				ok: false,
				code: -32602,
				message: "taskId and id are required",
				httpStatus: 400,
			};
		}
		const existing = this.taskPushNotificationConfigs.get(taskId) ?? [];
		const target = existing.find((c) => c.id === id);
		if (!target) {
			return {
				ok: false,
				code: -32000,
				message: `Push notification config not found: ${id}`,
				httpStatus: 404,
			};
		}
		const updated: TaskPushNotificationConfig = {
			...target,
			...(url !== undefined ? { url } : {}),
			...(typeof raw.token === "string" ? { token: raw.token } : {}),
		};
		const idx = existing.findIndex((c) => c.id === id);
		existing[idx] = updated;
		this.taskPushNotificationConfigs.set(taskId, existing);
		return { ok: true, result: { config: updated } };
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

	/**
	 * POST a task state change to a callback URL with retry, timeout, and DLQ.
	 *
	 * Retries up to CALLBACK_MAX_RETRIES times with exponential backoff.
	 * Each attempt has a CALLBACK_TIMEOUT_MS timeout. After all retries are
	 * exhausted, the task is moved to the DLQ (if a taskStore is configured).
	 *
	 * Invalid URLs fail immediately without retry.
	 */
	private _postCallback(
		callbackUrl: string,
		taskId: string,
		state: TaskState | "submitted" | "completed" | "failed",
		extra: Record<string, unknown> = {},
	): void {
		// Validate URL before attempting any fetch
		try {
			new URL(callbackUrl);
		} catch (err) {
			console.error(
				`[A2AServer] push callback invalid url url=${callbackUrl} taskId=${taskId}:`,
				err,
			);
			this._scheduleCallbackRetry(callbackUrl, taskId, state, extra, 0);
			return;
		}

		const body = {
			taskId,
			state,
			timestamp: new Date().toISOString(),
			...extra,
		};

		this._doCallbackFetch(callbackUrl, taskId, state, body, extra, 0);
	}

	/**
	 * Execute a single callback fetch attempt with timeout.
	 * On failure, schedules a retry or moves to DLQ.
	 */
	private _doCallbackFetch(
		callbackUrl: string,
		taskId: string,
		state: TaskState | "submitted" | "completed" | "failed",
		body: Record<string, unknown>,
		extra: Record<string, unknown>,
		attempt: number,
	): void {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

		fetch(callbackUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		})
			.then((res) => {
				clearTimeout(timeoutId);
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				// Success — reset retry count
				this.taskCallbackRetryCount.delete(taskId);
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				console.error(
					`[A2AServer] push callback failed url=${callbackUrl} taskId=${taskId} attempt=${attempt + 1}:`,
					err,
				);
				this._scheduleCallbackRetry(
					callbackUrl,
					taskId,
					state,
					extra,
					attempt + 1,
				);
			});
	}

	/**
	 * Schedule a retry with exponential backoff, or move to DLQ if max retries exhausted.
	 */
	private _scheduleCallbackRetry(
		callbackUrl: string,
		taskId: string,
		state: TaskState | "submitted" | "completed" | "failed",
		extra: Record<string, unknown>,
		nextAttempt: number,
	): void {
		if (nextAttempt >= CALLBACK_MAX_RETRIES) {
			// Max retries exhausted — move to DLQ
			console.error(
				`[A2AServer] push callback exhausted retries url=${callbackUrl} taskId=${taskId} attempts=${nextAttempt}`,
			);
			if (this.taskStore) {
				const errorMsg = `Callback failed after ${nextAttempt} retries (last: ${callbackUrl})`;
				this.taskStore.moveToDLQ(taskId, errorMsg);
			}
			this.taskCallbackRetryCount.delete(taskId);
			return;
		}

		// Exponential backoff: initial * 2^attempt, capped at max
		const backoffMs = Math.min(
			CALLBACK_INITIAL_BACKOFF_MS * Math.pow(2, nextAttempt - 1),
			CALLBACK_MAX_BACKOFF_MS,
		);

		console.log(
			`[A2AServer] push callback retry scheduled url=${callbackUrl} taskId=${taskId} attempt=${nextAttempt + 1}/${CALLBACK_MAX_RETRIES} backoff=${backoffMs}ms`,
		);

		setTimeout(() => {
			const body = {
				taskId,
				state,
				timestamp: new Date().toISOString(),
				...extra,
			};
			this._doCallbackFetch(
				callbackUrl,
				taskId,
				state,
				body,
				extra,
				nextAttempt,
			);
		}, backoffMs);
	}
}
