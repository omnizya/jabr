// ports/a2a-client-port.ts
// Hexagonal port: outbound A2A calls from Jabr to Hermes (and other A2A agents).
// Adapters implement this (e.g. A2AClient in agents/adapters/).

import type { AgentCard } from "@agents/types";

/**
 * Structured result from a synchronous `tasks/send` call.
 *
 * Mirrors the JSON-RPC result envelope returned by A2A servers. The server
 * responds with one of three content shapes — `text` (flat), `artifacts`
 * (structured parts), or `message` (A2AMessage envelope) — all of which are
 * captured here so adapters can normalize them.
 */
export interface A2ATaskResult {
	/** Plain-text response, when the server returned the flat `{ text }` shape. */
	text?: string;
	/** Structured artifacts, when the server returned the `{ artifacts }` shape. */
	artifacts?: Array<{ parts?: Array<{ text?: string }> }>;
	/** Full message envelope, when the server returned the `{ message }` shape. */
	message?: { parts?: Array<{ text?: string }> };
}

/**
 * SSE event frame received from a `tasks/sendSubscribe` stream.
 *
 * The server emits two event types (see `a2a-server.ts`):
 *   - `TaskStatusUpdateEvent` — carries `taskId`, `state`, `message`, `timestamp`.
 *   - `TaskArtifactUpdateEvent` — carries `taskId`, `artifact` (name + parts).
 */
export type A2ASseEvent =
	| {
			event: "TaskStatusUpdateEvent";
			data: {
				taskId: string;
				state: string;
				message?: string;
				timestamp: string;
			};
	  }
	| {
			event: "TaskArtifactUpdateEvent";
			data: {
				taskId: string;
				artifact: {
					name: string;
					parts: Array<{ kind: string; text?: string }>;
				};
			};
	  };

export interface A2AClientPort {
	/**
	 * Send a task to an agent via synchronous `tasks/send` and await the
	 * full result. Resolves with the structured response envelope.
	 *
	 * @param agentUrl  Target agent's root URL (e.g. `http://localhost:4000`).
	 * @param message   User prompt text to send as the task message.
	 * @param contextId Optional conversation context ID for multi-turn tasks.
	 */
	sendTask(
		agentUrl: string,
		message: string,
		contextId?: string,
	): Promise<A2ATaskResult>;

	/**
	 * Send a task asynchronously via `tasks/send` and return immediately
	 * with the assigned task ID. The caller polls or streams separately
	 * for completion.
	 *
	 * @param agentUrl  Target agent's root URL.
	 * @param message   User prompt text.
	 * @param contextId Optional conversation context ID.
	 * @returns The server-assigned task ID string.
	 */
	sendTaskAsync(
		agentUrl: string,
		message: string,
		contextId?: string,
	): Promise<string>;

	/**
	 * Retrieve the current state of a task by its ID via `tasks/get`.
	 *
	 * @param agentUrl  Target agent's root URL.
	 * @param taskId    The task ID to look up.
	 * @returns The task state record (status, history, artifacts).
	 */
	getTask(agentUrl: string, taskId: string): Promise<Record<string, unknown>>;

	/**
	 * Cancel a running task via `tasks/cancel`.
	 *
	 * @param agentUrl  Target agent's root URL.
	 * @param taskId    The task ID to cancel.
	 * @returns `true` if the task was successfully canceled.
	 */
	cancelTask(agentUrl: string, taskId: string): Promise<boolean>;

	/**
	 * Discover an agent's capabilities by fetching its AgentCard from
	 * `/.well-known/agent-card.json`.
	 *
	 * @param agentUrl Target agent's root URL.
	 * @returns The parsed AgentCard as a record, or an empty record on failure.
	 */
	discover(agentUrl: string): Promise<Record<string, unknown>>;

	/**
	 * Check whether an agent is reachable and healthy via a GET /health probe.
	 *
	 * @param agentUrl Target agent's root URL.
	 * @returns `true` if the agent responds with 200 OK, `false` otherwise.
	 */
	healthCheck(agentUrl: string): Promise<boolean>;

	/**
	 * Subscribe to real-time progress events for a task via SSE streaming.
	 *
	 * Sends a `tasks/sendSubscribe` JSON-RPC request and consumes the resulting
	 * text/event-stream. Each parsed SSE frame is forwarded to the `onEvent`
	 * callback. The promise resolves when the stream closes (task completed,
	 * failed, or canceled) or rejects on network / parse errors.
	 *
	 * @param agentUrl  Target agent's root URL.
	 * @param message   User prompt text to send as the task message.
	 * @param onEvent   Callback invoked for each parsed SSE frame.
	 * @param contextId Optional conversation context ID for multi-turn tasks.
	 */
	subscribeTask(
		agentUrl: string,
		message: string,
		onEvent: (event: A2ASseEvent) => void,
		contextId?: string,
	): Promise<void>;
}
