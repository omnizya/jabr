import { A2AClient } from "@adapters/http/a2a-client-adapter";
import { V1_METHOD_SEND_MESSAGE } from "@constants/a2a-v1";
// ── Helpers ────────────────────────────────────────────────────────────────
export interface RecordedCall {
	url: string;
	method: string;
	body: unknown;
	headers: Record<string, string>;
}

export function parseBody(opts: RequestInit | undefined): unknown {
	if (opts?.body == null || typeof opts.body !== "string") return opts?.body;
	try {
		return JSON.parse(opts.body);
	} catch {
		return opts.body;
	}
}
export function headersRecord(
	opts: RequestInit | undefined,
): Record<string, string> {
	const h: Record<string, string> = {};
	if (opts?.headers) {
		if (opts.headers instanceof Headers) {
			opts.headers.forEach((v, k) => {
				h[k] = v;
			});
		} else {
			for (const [k, v] of Object.entries(
				opts.headers as Record<string, string>,
			)) {
				h[k] = v;
			}
		}
	}
	return h;
}
export function createTestEnv(): {
	client: A2AClient;
	fetchCalls: RecordedCall[];
	restore: () => void;
} {
	const fetchCalls: RecordedCall[] = [];
	const originalFetch = globalThis.fetch;

	const testFetch = async (
		url: string | Request | URL,
		opts?: RequestInit,
	): Promise<Response> => {
		const u = url.toString();
		fetchCalls.push({
			url: u,
			method: opts?.method ?? "GET",
			body: parseBody(opts),
			headers: headersRecord(opts),
		});

		// GET /.well-known/agent.json → AgentCard (v1.0).
		if (u.includes("/.well-known/agent.json")) {
			return Response.json({
				name: "test-agent",
				version: "1.0.0",
				capabilities: { taskRouting: true },
			});
		}

		// GET /.well-known/agent-card.json → AgentCard (legacy fallback).
		if (u.includes("/.well-known/agent-card.json")) {
			return Response.json({
				name: "test-agent",
				version: "1.0.0",
				capabilities: { taskRouting: true },
			});
		}

		// GET /health → 200 OK.
		if (u.endsWith("/health")) {
			return Response.json({ status: "ok", agent: "test-agent" });
		}

		// POST / → JSON-RPC SendMessage.
		if ((opts?.method ?? "GET") === "POST") {
			const body = parseBody(opts) as {
				method?: string;
				id?: number;
			};
			if (body.method === V1_METHOD_SEND_MESSAGE) {
				return Response.json({
					jsonrpc: "2.0",
					id: body.id,
					result: {
						task: {
							taskId: "task-1",
							status: {
								state: "completed",
								message: {
									role: "agent",
									messageId: "msg-1",
									parts: [{ kind: "text", text: "pong" }],
								},
							},
						},
					},
				});
			}
		}

		return new Response("Not found", { status: 404 });
	};

	globalThis.fetch = testFetch as typeof fetch;
	return {
		client: new A2AClient(),
		fetchCalls,
		restore: () => {
			globalThis.fetch = originalFetch;
		},
	};
}

export function overrideFetch(
	handler: (url: string, opts?: RequestInit) => Response | Promise<Response>,
): () => void {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((url: string | Request | URL, opts?: RequestInit) =>
		Promise.resolve(
			handler(typeof url === "string" ? url : url.toString(), opts),
		) as unknown) as typeof fetch;
	return () => {
		globalThis.fetch = originalFetch;
	};
}
