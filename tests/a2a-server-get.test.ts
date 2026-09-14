/**
 * a2a-server-get.test.ts — Tests for GetTask and CancelTask endpoints.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import type { TaskStorePort } from "@ports/task-store";

const PORT = 4918;

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

describe("A2AServer GetTask", () => {
	let server: A2AServer | null = null;
	let taskStore: TaskStorePort;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("returns task state for existing task", async () => {
		taskStore = new TaskMemory();
		const existingTask = taskStore.create("task-existing-1");
		taskStore.appendMessage("task-existing-1", {
			messageId: "msg1",
			role: "user",
			kind: "message",
			parts: [{ kind: "text", text: "hello" }],
			contextId: "task-existing-1",
		});

		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-get",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await postA2A(PORT, "GetTask", { id: "task-existing-1" });
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			result: { id: string; status: { state: string }; history: unknown[] };
		};
		expect(json.result.id).toBe("task-existing-1");
		expect(json.result.status.state).toBe("submitted");
		expect(json.result.history).toHaveLength(1);
	});

	test("returns -32000 for non-existent task", async () => {
		taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-get-missing",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await postA2A(PORT, "GetTask", { id: "does-not-exist" });
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			error: { code: number; message: string };
		};
		expect(json.error.code).toBe(-32000);
		expect(json.error.message).toContain("Task not found");
	});

	test("returns -32000 for missing id param", async () => {
		taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-get-params",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await postA2A(PORT, "GetTask", {});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32000);
	});
});

describe("A2AServer CancelTask", () => {
	let server: A2AServer | null = null;
	let taskStore: TaskStorePort;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("cancels an existing task", async () => {
		taskStore = new TaskMemory();
		taskStore.create("task-to-cancel");

		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-cancel",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		// We need to register the abort controller for the task manually
		// since tasks/cancel expects it to exist
		const res = await postA2A(PORT, "CancelTask", {
			id: "task-to-cancel",
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			result: { id: string; status: { state: string } };
		};
		expect(json.result.id).toBe("task-to-cancel");
		expect(json.result.status.state).toBe("canceled");
	});

	test("cancel succeeds even without abort controller (task store only)", async () => {
		taskStore = new TaskMemory();
		taskStore.create("task-no-controller");
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-cancel-no-controller",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await postA2A(PORT, "CancelTask", {
			id: "task-no-controller",
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			result: { status: { state: string } };
		};
		expect(json.result.status.state).toBe("canceled");
	});

	test("returns -32000 for missing id param", async () => {
		taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: {
				name: "test-cancel-params",
				description: "test",
				url: `http://localhost:${PORT}`,
				version: "1.0.0",
				capabilities: {},
				skills: [],
				supportedInterfaces: [],
			},
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await postA2A(PORT, "CancelTask", {});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32000);
	});
});
