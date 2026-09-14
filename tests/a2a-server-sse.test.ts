/**
 * a2a-server-sse.test.ts — SSE streaming tests for A2AServer (A2A v1.0 wire).
 *
 * Verifies:
 *   1. SendStreamingMessage returns a text/event-stream response.
 *   2. The stream emits anonymous JSON-RPC data frames carrying `task`
 *      (submitted), `statusUpdate` (working → completed) and
 *      `artifactUpdate` payloads.
 *   3. The final statusUpdate carries the task result as an agent message.
 *   4. Fallback (no onTaskStreaming) emits a completed statusUpdate with the
 *      sync result; no artifact frames when the handler pushed none.
 *   5. Invalid params on SendStreamingMessage → -32602 (not a stream).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import type { TaskStreamingEvent } from "@agents/types";

const PORT = 4917; // avoid collision with live agents

async function postA2A(
	port: number,
	method: string,
	params: unknown,
): Promise<Response> {
	return fetch(`http://localhost:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method,
			params,
		}),
	});
}

type StreamFrameData = {
	result?: {
		task?: { status: { state: string } };
		statusUpdate?: {
			status: {
				state: string;
				message?: { parts: Array<{ text: string }> };
			};
			final?: boolean;
		};
		artifactUpdate?: { artifact?: { parts: Array<{ text: string }> } };
	};
};

type StreamFrame = { event: string; data: StreamFrameData };

function parseSSEFrames(raw: string): StreamFrame[] {
	const frames: StreamFrame[] = [];
	const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
	for (const block of blocks) {
		let event = "message";
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("event: ")) event = line.slice(7).trim();
			else if (line.startsWith("data: ")) data += line.slice(6);
		}
		try {
			frames.push({ event, data: JSON.parse(data) });
		} catch {
			frames.push({ event, data: {} });
		}
	}
	return frames;
}

describe("A2AServer SSE streaming", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("SendStreamingMessage with onTaskStreaming emits status + artifact frames", async () => {
		const events: TaskStreamingEvent[] = [];
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-stream",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: { streaming: true },
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => `sync:${text}`,
			onTaskStreaming: async (text, taskId, emit) => {
				emit({
					type: "status",
					taskId,
					state: "working",
					message: "custom working",
					timestamp: new Date().toISOString(),
				});
				emit({
					type: "artifact",
					taskId,
					artifact: {
						name: "partial",
						parts: [{ kind: "text", text: "partial result" }],
					},
				});
				return `streamed:${text}`;
			},
		});
		server.start();

		const res = await postA2A(PORT, "SendStreamingMessage", {
			message: { parts: [{ kind: "text", text: "hello" }] },
		});

		expect(res.status).toBe(200);
		expect(
			res.headers.get("Content-Type")?.startsWith("text/event-stream"),
		).toBe(true);

		const raw = await res.text();
		const frames = parseSSEFrames(raw);

		// Expect at least: task (submitted), working (custom), artifact, completed.
		expect(frames.length).toBeGreaterThanOrEqual(3);

		const taskFrames = frames.filter((f) => f.data.result?.task !== undefined);
		const statusEvents = frames.filter(
			(f) => f.data.result?.statusUpdate !== undefined,
		);
		const artifactEvents = frames.filter(
			(f) => f.data.result?.artifactUpdate !== undefined,
		);

		expect(statusEvents.length).toBeGreaterThanOrEqual(2);
		expect(artifactEvents.length).toBeGreaterThanOrEqual(1);

		// First frame: the submitted task (not a statusUpdate).
		expect(taskFrames[0]!.data.result!.task!.status.state).toBe("submitted");

		// Custom working status followed by the completed status.
		expect(statusEvents[0]!.data.result!.statusUpdate!.status.state).toBe(
			"working",
		);
		expect(
			statusEvents[0]!.data.result!.statusUpdate!.status.message!.parts[0]!
				.text,
		).toBe("custom working");

		// Last status: completed.
		const lastStatus =
			statusEvents[statusEvents.length - 1]!.data.result!.statusUpdate!;
		expect(lastStatus.status.state).toBe("completed");
		expect(lastStatus.status.message!.parts[0]!.text.trim()).toBe(
			"streamed:hello",
		);

		// Artifact event has the partial text.
		expect(
			artifactEvents[0]!.data.result!.artifactUpdate!.artifact!.parts[0]!.text,
		).toBe("partial result");
	});

	test("SendStreamingMessage without onTaskStreaming falls back to synthetic events", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-fallback",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => `sync-result:${text}`,
		});
		server.start();

		const res = await postA2A(PORT, "SendStreamingMessage", {
			message: { parts: [{ kind: "text", text: "world" }] },
		});

		expect(res.status).toBe(200);
		const raw = await res.text();
		const frames = parseSSEFrames(raw);

		const taskFrames = frames.filter((f) => f.data.result?.task !== undefined);
		const statusEvents = frames.filter(
			(f) => f.data.result?.statusUpdate !== undefined,
		);
		const artifactEvents = frames.filter(
			(f) => f.data.result?.artifactUpdate !== undefined,
		);

		// task (submitted) + exactly one completed statusUpdate with the result.
		expect(taskFrames[0]!.data.result!.task!.status.state).toBe("submitted");
		expect(statusEvents.length).toBeGreaterThanOrEqual(1);
		const lastStatus =
			statusEvents[statusEvents.length - 1]!.data.result!.statusUpdate!;
		expect(lastStatus.status.state).toBe("completed");
		expect(lastStatus.final).toBe(true);
		expect(lastStatus.status.message!.parts[0]!.text.trim()).toBe(
			"sync-result:world",
		);

		// No synthetic artifact when the handler pushed none.
		expect(artifactEvents.length).toBe(0);
	});

	test("SendStreamingMessage with invalid params returns -32602 (not a stream)", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-invalid",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
		});
		server.start();

		const res = await postA2A(PORT, "SendStreamingMessage", {}); // missing message → invalid

		expect(res.status).toBe(200);
		expect(
			res.headers.get("Content-Type")?.startsWith("application/json"),
		).toBe(true);
		const body = (await res.json()) as { error: { code: number } };
		expect(body.error.code).toBe(-32602);
	});

	test("SendStreamingMessage handler error emits failed status", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-error",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async () => "ok",
			onTaskStreaming: async (_text, _taskId, _emit) => {
				throw new Error("boom");
			},
		});
		server.start();

		const res = await postA2A(PORT, "SendStreamingMessage", {
			message: { parts: [{ kind: "text", text: "x" }] },
		});

		const raw = await res.text();
		const frames = parseSSEFrames(raw);
		const statusEvents = frames.filter(
			(f) => f.data.result?.statusUpdate !== undefined,
		);

		// task (submitted) → failed
		expect(statusEvents.length).toBeGreaterThanOrEqual(1);
		const last =
			statusEvents[statusEvents.length - 1]!.data.result!.statusUpdate!;
		expect(last.status.state).toBe("failed");
		expect(last.status.message!.parts[0]!.text).toContain("boom");
	});
});
