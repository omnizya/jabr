/**
 * a2a-client-sse.test.ts — SSE streaming tests for A2AClient adapter.
 *
 * Verifies:
 *   1. subscribeTask sends a SendStreamingMessage JSON-RPC request.
 *   2. SSE frames (TaskStatusUpdateEvent, TaskArtifactUpdateEvent) are parsed
 *      and forwarded to the onEvent callback.
 *   3. The promise resolves when the stream closes.
 *   4. Non-stream error responses reject with an RPC error.
 */

import { describe, expect, test } from "bun:test";
import { A2AClient } from "@adapters/http/a2a-client-adapter";
import { V1_METHOD_SEND_STREAMING_MESSAGE } from "@constants/a2a-v1";
import type { A2ASseEvent } from "@ports/a2a-client-port";

const PORT = 4923;

/**
 * Encode an SSE frame as the server would send it.
 */
function sseFrame(event: string, data: unknown): Uint8Array {
	const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	return new TextEncoder().encode(text);
}

function sseStream(frames: Uint8Array[]): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < frames.length) {
				controller.enqueue(frames[i++]);
			} else {
				controller.close();
			}
		},
	});
}

describe("A2AClient subscribeTask SSE", () => {
	test("subscribeTask parses SSE frames and forwards them to onEvent", async () => {
		const originalFetch = globalThis.fetch;
		const events: A2ASseEvent[] = [];

		globalThis.fetch = (async (_url: any, _opts: any) => {
			const body = sseStream([
				sseFrame("TaskStatusUpdateEvent", {
					taskId: "t-1",
					state: "submitted",
					message: "Task accepted",
					timestamp: "2026-09-06T21:00:00Z",
				}),
				sseFrame("TaskStatusUpdateEvent", {
					taskId: "t-1",
					state: "working",
					message: "Processing",
					timestamp: "2026-09-06T21:00:01Z",
				}),
				sseFrame("TaskArtifactUpdateEvent", {
					taskId: "t-1",
					artifact: {
						name: "partial",
						parts: [{ kind: "text", text: "hello" }],
					},
				}),
				sseFrame("TaskStatusUpdateEvent", {
					taskId: "t-1",
					state: "completed",
					message: "Done",
					timestamp: "2026-09-06T21:00:02Z",
				}),
			]);
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		}) as typeof fetch;

		try {
			const client = new A2AClient();
			await client.subscribeTask(
				`http://localhost:${PORT}`,
				"test prompt",
				(event) => events.push(event),
			);

			// Should have received all 4 events.
			expect(events.length).toBe(4);

			// First event: submitted status.
			const first = events[0]!;
			expect(first.event).toBe("TaskStatusUpdateEvent");
			if (first.event === "TaskStatusUpdateEvent") {
				expect(first.data.state).toBe("submitted");
				expect(first.data.taskId).toBe("t-1");
			}

			// Second event: working status.
			const second = events[1]!;
			expect(second.event).toBe("TaskStatusUpdateEvent");
			if (second.event === "TaskStatusUpdateEvent") {
				expect(second.data.state).toBe("working");
			}

			// Third event: artifact update.
			const third = events[2]!;
			expect(third.event).toBe("TaskArtifactUpdateEvent");
			if (third.event === "TaskArtifactUpdateEvent") {
				expect(third.data.artifact.name).toBe("partial");
				expect(third.data.artifact.parts[0]!.text).toBe("hello");
			}

			// Fourth event: completed status.
			const fourth = events[3]!;
			expect(fourth.event).toBe("TaskStatusUpdateEvent");
			if (fourth.event === "TaskStatusUpdateEvent") {
				expect(fourth.data.state).toBe("completed");
			}
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("subscribeTask sends a valid SendStreamingMessage JSON-RPC body", async () => {
		const originalFetch = globalThis.fetch;
		let capturedBody: any = null;

		globalThis.fetch = (async (_url: any, opts: any) => {
			capturedBody = JSON.parse(opts.body);
			// Close immediately.
			return new Response(sseStream([]), {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		}) as typeof fetch;

		try {
			const client = new A2AClient();
			await client.subscribeTask(
				`http://localhost:${PORT}`,
				"ping",
				() => {},
				"ctx-123",
			);

			expect(capturedBody.jsonrpc).toBe("2.0");
			expect(capturedBody.method).toBe(V1_METHOD_SEND_STREAMING_MESSAGE);
			expect(capturedBody.params.message.parts[0].text).toBe("ping");
			expect(capturedBody.params.message.contextId).toBe("ctx-123");
			expect(capturedBody.params.message.messageId).toBeDefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("subscribeTask rejects on JSON-RPC error (non-stream response)", async () => {
		const originalFetch = globalThis.fetch;

		globalThis.fetch = (async () => {
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					error: { code: -32600, message: "Invalid params" },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		try {
			const client = new A2AClient();
			let caught: Error | null = null;
			try {
				await client.subscribeTask(`http://localhost:${PORT}`, "x", () => {});
			} catch (e) {
				caught = e as Error;
			}
			expect(caught).not.toBeNull();
			expect(caught!.message).toContain("Invalid params");
			expect(caught!.message).toContain("-32600");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("subscribeTask rejects on non-200 response", async () => {
		const originalFetch = globalThis.fetch;

		globalThis.fetch = (async () => {
			return new Response("Service Unavailable", { status: 503 });
		}) as unknown as typeof fetch;

		try {
			const client = new A2AClient();
			let caught: Error | null = null;
			try {
				await client.subscribeTask(`http://localhost:${PORT}`, "x", () => {});
			} catch (e) {
				caught = e as Error;
			}
			expect(caught).not.toBeNull();
			expect(caught!.message).toContain("503");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
