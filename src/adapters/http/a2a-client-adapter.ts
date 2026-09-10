/**
 * a2a-client-adapter.ts — Concrete A2A client adapter speaking JSON-RPC over HTTP.
 *
 * Implements the A2AClientPort interface. Uses Bun's native fetch to send
 * JSON-RPC 2.0 `tasks/send` requests, discover AgentCards via GET
 * /.well-known/agent-card.json, and probe health via GET /health.
 */

import type {
	A2AClientPort,
	A2ASseEvent,
	A2ATaskResult,
} from "@ports/a2a-client-port";
import {
	type JSONRPCRequest,
	type JSONRPCResponse,
	ok,
	parseSSEStream,
} from "@utils/rpc";

export class A2AClient implements A2AClientPort {
	private nextId = 1;
	private readonly apiKey?: string;
	private readonly bearerToken?: string;

	constructor(apiKey?: string, bearerToken?: string) {
		this.apiKey = apiKey;
		this.bearerToken = bearerToken;
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { "Content-Type": "application/json" };
		if (this.bearerToken) h["Authorization"] = `Bearer ${this.bearerToken}`;
		else if (this.apiKey) h["X-API-Key"] = this.apiKey;
		return h;
	}

	/**
	 * Send a task synchronously via `tasks/send` and await the full result.
	 */
	async sendTask(
		agentUrl: string,
		message: string,
		contextId?: string,
	): Promise<A2ATaskResult> {
		const id = this.nextId++;
		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id,
			method: "tasks/send",
			params: {
				message: { role: "user", parts: [{ kind: "text", text: message }] },
				...(contextId ? { contextId } : {}),
			},
		};

		const res = await fetch(agentUrl, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`A2A sendTask failed: ${res.status} ${res.statusText}`);
		}

		const json = (await res.json()) as JSONRPCResponse;
		if (json.error) {
			throw new Error(
				`A2A sendTask RPC error (code=${json.error.code}): ${json.error.message}`,
			);
		}

		return json.result as A2ATaskResult;
	}

	/**
	 * Send a task asynchronously via `tasks/send` and return immediately
	 * with the assigned task ID. The caller polls or streams separately
	 * for completion.
	 */
	async sendTaskAsync(
		agentUrl: string,
		message: string,
		contextId?: string,
	): Promise<string> {
		const id = this.nextId++;
		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id,
			method: "tasks/send",
			params: {
				message: { role: "user", parts: [{ kind: "text", text: message }] },
				...(contextId ? { contextId } : {}),
			},
		};

		const res = await fetch(agentUrl, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(
				`A2A sendTaskAsync failed: ${res.status} ${res.statusText}`,
			);
		}

		const json = (await res.json()) as JSONRPCResponse;
		if (json.error) {
			throw new Error(
				`A2A sendTaskAsync RPC error (code=${json.error.code}): ${json.error.message}`,
			);
		}

		// A2A returns a task object in the result; extract the id.
		const result = json.result as {
			id?: string;
			taskId?: string;
			text?: string;
		};
		const taskId = result.id ?? result.taskId;
		if (!taskId) {
			// Some agents (e.g. orchestrator) return `{text}` synchronously with no task ID.
			// Generate a synthetic ID for logging purposes.
			return `sync-${id}-${Date.now()}`;
		}
		return taskId;
	}

	/**
	 * Retrieve the current state of a task via `tasks/get`.
	 */
	async getTask(
		agentUrl: string,
		taskId: string,
	): Promise<Record<string, unknown>> {
		const id = this.nextId++;
		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id,
			method: "tasks/get",
			params: { taskId },
		};

		const res = await fetch(agentUrl, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`A2A getTask failed: ${res.status} ${res.statusText}`);
		}

		const json = (await res.json()) as JSONRPCResponse;
		if (json.error) {
			throw new Error(
				`A2A getTask RPC error (code=${json.error.code}): ${json.error.message}`,
			);
		}

		return (json.result ?? {}) as Record<string, unknown>;
	}

	/**
	 * Cancel a running task via `tasks/cancel`.
	 */
	async cancelTask(agentUrl: string, taskId: string): Promise<boolean> {
		const id = this.nextId++;
		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id,
			method: "tasks/cancel",
			params: { taskId },
		};

		const res = await fetch(agentUrl, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`A2A cancelTask failed: ${res.status} ${res.statusText}`);
		}

		const json = (await res.json()) as JSONRPCResponse;
		if (json.error) {
			throw new Error(
				`A2A cancelTask RPC error (code=${json.error.code}): ${json.error.message}`,
			);
		}

		const result = json.result as { state?: string } | undefined;
		return result?.state === "canceled";
	}

	/**
	 * Discover an agent's capabilities by fetching its AgentCard from
	 * /.well-known/agent-card.json.
	 */
	async discover(agentUrl: string): Promise<Record<string, unknown>> {
		const res = await fetch(
			`${agentUrl.replace(/\/$/, "")}/.well-known/agent-card.json`,
		);
		if (!res.ok) {
			throw new Error(`A2A discover failed: ${res.status} ${res.statusText}`);
		}
		return (await res.json()) as Record<string, unknown>;
	}

	/**
	 * Check whether an agent is reachable and healthy via a GET /health probe.
	 */
	async healthCheck(agentUrl: string): Promise<boolean> {
		const res = await fetch(`${agentUrl.replace(/\/$/, "")}/health`, {
			signal: AbortSignal.timeout(5_000),
		});
		return res.ok;
	}

	/**
	 * Subscribe to real-time progress events for a task via SSE streaming.
	 *
	 * Sends a `tasks/sendSubscribe` JSON-RPC request and consumes the resulting
	 * text/event-stream. Each parsed SSE frame is forwarded to the `onEvent`
	 * callback. The promise resolves when the stream closes (task completed,
	 * failed, or canceled) or rejects on network / parse errors.
	 */
	async subscribeTask(
		agentUrl: string,
		message: string,
		onEvent: (event: A2ASseEvent) => void,
		contextId?: string,
	): Promise<void> {
		const id = this.nextId++;
		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id,
			method: "tasks/sendSubscribe",
			params: {
				message: { role: "user", parts: [{ kind: "text", text: message }] },
				...(contextId ? { contextId } : {}),
			},
		};

		const res = await fetch(agentUrl, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(
				`A2A subscribeTask failed: ${res.status} ${res.statusText}`,
			);
		}

		const contentType = res.headers.get("Content-Type") ?? "";
		if (!contentType.includes("text/event-stream")) {
			// Server returned JSON (likely an error) instead of an SSE stream.
			const json = (await res.json()) as JSONRPCResponse;
			if (json.error) {
				throw new Error(
					`A2A subscribeTask RPC error (code=${json.error.code}): ${json.error.message}`,
				);
			}
			throw new Error(
				`A2A subscribeTask: expected text/event-stream, got ${contentType}`,
			);
		}

		// Read the stream incrementally and parse SSE frames as they arrive.
		const reader = res.body?.getReader();
		if (!reader) {
			throw new Error("A2A subscribeTask: response body is not readable");
		}

		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE frames (separated by double newlines).
				const parts = buffer.split("\n\n");
				buffer = parts.pop() ?? ""; // keep incomplete last chunk
				for (const part of parts) {
					if (part.trim().length === 0) continue;
					const frames = parseSSEStream(part + "\n\n");
					for (const frame of frames) {
						const evt = frame as { event: string; data: unknown };
						if (evt.event === "TaskStatusUpdateEvent") {
							onEvent({
								event: "TaskStatusUpdateEvent",
								data: evt.data as {
									taskId: string;
									state: string;
									message?: string;
									timestamp: string;
								},
							});
						} else if (evt.event === "TaskArtifactUpdateEvent") {
							onEvent({
								event: "TaskArtifactUpdateEvent",
								data: evt.data as {
									taskId: string;
									artifact: {
										name: string;
										parts: Array<{ kind: string; text?: string }>;
									};
								},
							});
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
}

export function createA2AClient(): A2AClient {
	return new A2AClient();
}
