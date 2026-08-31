/**
 * a2a-server-sse.test.ts — SSE streaming tests for A2AServer.
 *
 * Verifies:
 *   1. tasks/sendSubscribe returns a text/event-stream response.
 *   2. The stream emits TaskStatusUpdateEvent (submitted → working → completed)
 *      and TaskArtifactUpdateEvent frames.
 *   3. The final event carries the task result.
 *   4. Fallback (no onTaskStreaming) emits synthetic status + artifact events.
 *   5. Invalid params on tasks/sendSubscribe → -32600 (not a stream).
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

function parseSSEFrames(raw: string): Array<{ event: string; data: unknown }> {
	const frames: Array<{ event: string; data: unknown }> = [];
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
			frames.push({ event, data });
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

	test("tasks/sendSubscribe with onTaskStreaming emits status + artifact frames", async () => {
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

		const res = await postA2A(PORT, "tasks/sendSubscribe", {
			message: { parts: [{ kind: "text", text: "hello" }] },
		});

		expect(res.status).toBe(200);
		expect(
			res.headers.get("Content-Type")?.startsWith("text/event-stream"),
		).toBe(true);

		const raw = await res.text();
		const frames = parseSSEFrames(raw);

		// Expect at least: submitted, working (custom), artifact, completed.
		expect(frames.length).toBeGreaterThanOrEqual(3);

		const statusEvents = frames.filter(
			(f) => f.event === "TaskStatusUpdateEvent",
		);
		const artifactEvents = frames.filter(
			(f) => f.event === "TaskArtifactUpdateEvent",
		);

		expect(statusEvents.length).toBeGreaterThanOrEqual(2);
		expect(artifactEvents.length).toBeGreaterThanOrEqual(1);

		// First status: submitted.
		expect(statusEvents[0].data.state).toBe("submitted");

		// Last status: completed.
		const lastStatus = statusEvents[statusEvents.length - 1].data;
		expect(lastStatus.state).toBe("completed");

		// Artifact event has the partial text.
		expect(artifactEvents[0].data.artifact.parts[0].text).toBe(
			"partial result",
		);
	});

	test("tasks/sendSubscribe without onTaskStreaming falls back to synthetic events", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-fallback",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
			},
			onTask: async (text) => `sync-result:${text}`,
		});
		server.start();

		const res = await postA2A(PORT, "tasks/sendSubscribe", {
			message: { parts: [{ kind: "text", text: "world" }] },
		});

		expect(res.status).toBe(200);
		const raw = await res.text();
		const frames = parseSSEFrames(raw);

		const statusEvents = frames.filter(
			(f) => f.event === "TaskStatusUpdateEvent",
		);
		const artifactEvents = frames.filter(
			(f) => f.event === "TaskArtifactUpdateEvent",
		);

		// submitted → working → completed
		expect(statusEvents.length).toBeGreaterThanOrEqual(3);
		expect(statusEvents[0].data.state).toBe("submitted");
		expect(statusEvents[statusEvents.length - 1].data.state).toBe("completed");

		// One artifact with the sync result.
		expect(artifactEvents.length).toBe(1);
		expect(artifactEvents[0].data.artifact.parts[0].text).toBe(
			"sync-result:world",
		);
	});

	test("tasks/sendSubscribe with invalid params returns -32600 (not a stream)", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-invalid",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
			},
			onTask: async (text) => text,
		});
		server.start();

		const res = await postA2A(PORT, "tasks/sendSubscribe", {
			message: { parts: [] }, // empty parts → invalid
		});

		expect(res.status).toBe(200);
		expect(
			res.headers.get("Content-Type")?.startsWith("application/json"),
		).toBe(true);
		const body = (await res.json()) as { error: { code: number } };
		expect(body.error.code).toBe(-32600);
	});

	test("tasks/sendSubscribe handler error emits failed status", async () => {
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-error",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
			},
			onTask: async () => "ok",
			onTaskStreaming: async (_text, _taskId, _emit) => {
				throw new Error("boom");
			},
		});
		server.start();

		const res = await postA2A(PORT, "tasks/sendSubscribe", {
			message: { parts: [{ kind: "text", text: "x" }] },
		});

		const raw = await res.text();
		const frames = parseSSEFrames(raw);
		const statusEvents = frames.filter(
			(f) => f.event === "TaskStatusUpdateEvent",
		);

		// submitted → failed
		expect(statusEvents.length).toBeGreaterThanOrEqual(2);
		const last = statusEvents[statusEvents.length - 1].data;
		expect(last.state).toBe("failed");
		expect(last.message).toContain("boom");
	});
});
