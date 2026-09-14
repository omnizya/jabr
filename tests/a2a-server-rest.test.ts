/**
 * a2a-server-rest.test.ts — A2A v1.0 REST binding tests for A2AServer.
 *
 * Verifies the REST route handlers (src/adapters/http/a2a-server.ts):
 *   1. A2A-Version header enforcement (missing / mismatch)
 *   2. X-API-Key auth on REST paths (missing / wrong / correct / no-registry)
 *   3. POST /message:send — sync path → bare result {task, message}
 *   4. POST /message:stream — SSE frames (submitted → working → completed)
 *   5. GET /tasks — list (empty, populated, status filter)
 *   6. GET /tasks/{id} — get (found / -32000 404)
 *   7. POST /tasks/{id}:cancel — store-backed / no-store / 404 / terminal 409
 *   8. GET /tasks/{id}:subscribe — SSE snapshot + end on final state
 *   9. Push notification configs — create / list / get / patch / delete
 *  10. GET /extendedAgentCard — configured / -32603 500
 *  11. tenantPrefix stripping on REST paths
 *  12. Fallthrough → plain 404 "Not found"
 */

import { afterEach, describe, expect, test } from "bun:test";
import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import type { TaskStreamingEvent } from "@agents/types";
import type { TaskStorePort } from "@ports/task-store";
import { ApiKeyRegistry } from "../src/security/api-key-registry";
import type { AgentCard as A2AAgentCard } from "../src/types/a2a-v1.ts";
import type { AgentCard } from "../src/types/types.ts";

const PORT = 4919; // siblings: 4917 (sse), 4918 (get)

const V1_VERSION = "1.0";

function cardConfig(port: number, name: string): AgentCard {
	return {
		name,
		description: "test",
		url: `http://localhost:${port}`,
		version: "1.0.0",
		capabilities: {},
		skills: [],
		supportedInterfaces: [],
	};
}

/** Every REST request must carry the A2A-Version header. */
async function restFetch(
	port: number,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (!headers.has("A2A-Version")) headers.set("A2A-Version", V1_VERSION);
	if (init.body !== undefined && !headers.has("Content-Type"))
		headers.set("Content-Type", "application/json");
	return fetch(`http://localhost:${port}${path}`, { ...init, headers });
}

function parseSSEFrames(raw: string): Array<{ data: unknown }> {
	const frames: Array<{ data: unknown }> = [];
	for (const block of raw.split("\n\n").filter((b) => b.trim().length > 0)) {
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("data: ")) data += line.slice(6);
		}
		frames.push({ data: JSON.parse(data) });
	}
	return frames;
}

describe("A2AServer REST binding — version header", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("missing A2A-Version header → 400/-32602", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest"),
			onTask: async (t) => t,
		});
		server.start();
		const res = await fetch(`http://localhost:${PORT}/tasks`, {
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32602);
	});

	test("mismatched A2A-Version header → 426/-32602", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest"),
			onTask: async (t) => t,
		});
		server.start();
		const res = await fetch(`http://localhost:${PORT}/tasks`, {
			headers: { "A2A-Version": "0.9", "Content-Type": "application/json" },
		});
		expect(res.status).toBe(426);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32602);
	});
});

describe("A2AServer REST binding — X-API-Key auth", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	const VALID_TOKEN = "rest-test-token-42";

	function startAuthServer(): void {
		const registry = new ApiKeyRegistry([
			{
				key: VALID_TOKEN,
				description: "rest-test",
				allowedAgents: [],
				enabled: true,
			},
		]);
		server = new A2AServer(
			{
				port: PORT,
				card: cardConfig(PORT, "rest-auth"),
				onTask: async (t) => t,
				requireAuth: true,
			},
			undefined,
			undefined,
			registry,
		);
		server.start();
	}

	test("missing X-API-Key → 401/-32000", async () => {
		startAuthServer();
		const res = await restFetch(PORT, "/tasks");
		expect(res.status).toBe(401);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32000);
	});

	test("invalid X-API-Key → 403/-32001", async () => {
		startAuthServer();
		const res = await restFetch(PORT, "/tasks", {
			headers: { "X-API-Key": "wrong-key" },
		});
		expect(res.status).toBe(403);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32001);
	});

	test("correct X-API-Key → 200", async () => {
		startAuthServer();
		const taskStore = new TaskMemory();
		(server as unknown as { taskStore: TaskStorePort }).taskStore = taskStore;
		taskStore.create("auth-task");
		const res = await restFetch(PORT, "/tasks", {
			headers: { "X-API-Key": VALID_TOKEN },
		});
		expect(res.status).toBe(200);
	});

	test("requireAuth without registry → 500 fail-closed", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-no-reg"),
			onTask: async (t) => t,
			requireAuth: true,
		});
		server.start();
		const res = await restFetch(PORT, "/tasks");
		expect(res.status).toBe(500);
	});
});

describe("A2AServer REST binding — /message:send", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("POST /message:send → 200 bare result {task, message}", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-send"),
			onTask: async (text) => `sync:${text}`,
		});
		server.start();

		const res = await restFetch(PORT, "/message:send", {
			method: "POST",
			body: JSON.stringify({
				message: { role: "user", parts: [{ kind: "text", text: "hello" }] },
			}),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			task: { taskId: string; contextId: string; status: { state: string } };
			message: { role: string; parts: Array<{ text: string }> };
		};
		expect(json.task.status.state).toBe("completed");
		expect(json.message.role).toBe("agent");
		// Wire text parts serialize to {text} (no kind discriminator); the
		// trailing \n comes from extractText joining text parts.
		expect(json.message.parts[0]).toEqual({ text: "sync:hello\n" });
	});

	test("POST /message:send with invalid body → 400/-32602", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-send-bad"),
			onTask: async (text) => text,
		});
		server.start();

		// {} parses to an empty-but-valid message; a missing "message" key is
		// what makes fromWireSendMessageRequest throw.
		const res = await restFetch(PORT, "/message:send", {
			method: "POST",
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32602);
	});

	test("GET /message:send → 405/-32601", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-send-405"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(PORT, "/message:send");
		expect(res.status).toBe(405);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32601);
	});
});

describe("A2AServer REST binding — /message:stream", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("POST /message:stream → SSE submitted → working → completed", async () => {
		const events: TaskStreamingEvent[] = [];
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-stream"),
			onTask: async (text) => `sync:${text}`,
			onTaskStreaming: async (text, taskId, emit) => {
				emit({
					type: "status",
					taskId,
					state: "working",
					message: "rest working",
					timestamp: new Date().toISOString(),
				});
				events.push({
					type: "status",
					taskId,
					state: "working",
					timestamp: new Date().toISOString(),
				});
				return `streamed:${text}`;
			},
		});
		server.start();

		const res = await restFetch(PORT, "/message:stream", {
			method: "POST",
			body: JSON.stringify({
				message: { role: "user", parts: [{ kind: "text", text: "hello" }] },
			}),
		});
		expect(res.status).toBe(200);
		expect(
			res.headers.get("Content-Type")?.startsWith("text/event-stream"),
		).toBe(true);

		const frames = parseSSEFrames(await res.text());
		expect(frames.length).toBeGreaterThanOrEqual(2);

		const first = frames[0]!.data as {
			task: { status: { state: string } };
		};
		expect(first.task.status.state).toBe("submitted");

		const last = frames[frames.length - 1]!.data as {
			statusUpdate: { status: { state: string }; final: boolean };
		};
		expect(last.statusUpdate.status.state).toBe("completed");
		expect(last.statusUpdate.final).toBe(true);
	});

	test("GET /message:stream → 405/-32601", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-stream-405"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(PORT, "/message:stream");
		expect(res.status).toBe(405);
	});
});

describe("A2AServer REST binding — /tasks", () => {
	let server: A2AServer | null = null;
	let taskStore: TaskStorePort;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	function startServer(): void {
		taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-tasks"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();
	}

	test("GET /tasks empty → {tasks: [], pageSize: 0, totalSize: 0}", async () => {
		startServer();
		const res = await restFetch(PORT, "/tasks");
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			tasks: unknown[];
			pageSize: number;
			totalSize: number;
		};
		expect(json.tasks).toEqual([]);
		expect(json.pageSize).toBe(0);
		expect(json.totalSize).toBe(0);
	});

	test("GET /tasks returns seeded tasks with wire shape", async () => {
		startServer();
		taskStore.create("list-a");
		taskStore.create("list-b");

		const res = await restFetch(PORT, "/tasks");
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			tasks: Array<{ id: string; status: { state: string } }>;
			pageSize: number;
			totalSize: number;
		};
		expect(json.tasks).toHaveLength(2);
		expect(json.totalSize).toBe(2);
		for (const t of json.tasks) {
			expect(t.status.state).toBe("submitted");
			expect(t.id).toBeDefined();
		}
	});

	test("GET /tasks?status=completed filters state", async () => {
		startServer();
		taskStore.create("filter-a");
		taskStore.create("filter-b");
		taskStore.updateState("filter-a", "completed");

		const res = await restFetch(PORT, "/tasks?status=completed");
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			tasks: Array<{ id: string }>;
			totalSize: number;
		};
		expect(json.tasks).toHaveLength(1);
		expect(json.tasks[0]!.id).toBe("filter-a");
		expect(json.totalSize).toBe(1);
	});

	test("POST /tasks → 405/-32601", async () => {
		startServer();
		const res = await restFetch(PORT, "/tasks", { method: "POST" });
		expect(res.status).toBe(405);
	});
});

describe("A2AServer REST binding — /tasks/{id}", () => {
	let server: A2AServer | null = null;
	let taskStore: TaskStorePort;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("GET /tasks/{id} → 200 with wire task", async () => {
		taskStore = new TaskMemory();
		taskStore.create("get-task");
		taskStore.appendMessage("get-task", {
			messageId: "m1",
			role: "user",
			kind: "message",
			parts: [{ kind: "text", text: "hi" }],
			contextId: "get-task",
		});
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-get"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/get-task");
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			id: string;
			status: { state: string };
			history: unknown[];
		};
		expect(json.id).toBe("get-task");
		expect(json.status.state).toBe("submitted");
		expect(json.history).toHaveLength(1);
	});

	test("GET /tasks/missing → 404/-32000", async () => {
		taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-get-404"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/nope");
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32000);
	});

	test("POST /tasks/{id} → 405/-32601", async () => {
		taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-get-405"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/get-task", { method: "POST" });
		expect(res.status).toBe(405);
	});
});

describe("A2AServer REST binding — /tasks/{id}:cancel", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("POST :cancel with store → 200 canceled", async () => {
		const taskStore = new TaskMemory();
		taskStore.create("cancel-me");
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-cancel"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/cancel-me:cancel", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			id: string;
			status: { state: string };
		};
		expect(json.id).toBe("cancel-me");
		expect(json.status.state).toBe("canceled");
	});

	test("POST :cancel without store → 200 fabricated canceled", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-cancel-nostore"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/ghost:cancel", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			id: string;
			status: { state: string };
		};
		expect(json.id).toBe("ghost");
		expect(json.status.state).toBe("canceled");
	});

	test("POST :cancel unknown task with store → 404/-32000", async () => {
		const taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-cancel-404"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/missing:cancel", {
			method: "POST",
		});
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32000);
	});

	test("POST :cancel terminal task → 409/-32002", async () => {
		const taskStore = new TaskMemory();
		taskStore.create("done-task");
		taskStore.updateState("done-task", "completed");
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-cancel-terminal"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/done-task:cancel", {
			method: "POST",
		});
		expect(res.status).toBe(409);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32002);
	});
});

describe("A2AServer REST binding — /tasks/{id}:subscribe", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("GET :subscribe → SSE snapshot, ends on final state", async () => {
		const taskStore = new TaskMemory();
		taskStore.create("sub-task");
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-sub"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/sub-task:subscribe");
		expect(res.status).toBe(200);
		expect(
			res.headers.get("Content-Type")?.startsWith("text/event-stream"),
		).toBe(true);

		// Subscribe emits a synchronous snapshot; update to a final state to end
		// the stream.
		const readPromise = res.text().then(parseSSEFrames);
		taskStore.updateState("sub-task", "completed");
		const frames = await readPromise;

		expect(frames.length).toBeGreaterThanOrEqual(1);
		const first = frames[0]!.data as {
			task: { id: string; status: { state: string } };
		};
		expect(first.task.id).toBe("sub-task");
		const last = frames[frames.length - 1]!.data as {
			task: { status: { state: string } };
		};
		expect(last.task.status.state).toBe("completed");
	});

	test("GET :subscribe unknown task → 404/-32000", async () => {
		const taskStore = new TaskMemory();
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-sub-404"),
			onTask: async (text) => text,
			taskStore,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/nope:subscribe");
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32000);
	});

	test("GET :subscribe without store → 500/-32603", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-sub-nostore"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(PORT, "/tasks/ghost:subscribe");
		expect(res.status).toBe(500);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32603);
	});
});

describe("A2AServer REST binding — push notification configs", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("POST create config → 200 {config}", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-push"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs",
			{
				method: "POST",
				body: JSON.stringify({ url: "https://example.com/cb" }),
			},
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			config: { id: string; taskId: string; url: string };
		};
		expect(json.config.taskId).toBe("task-push");
		expect(json.config.url).toBe("https://example.com/cb");
		expect(json.config.id).toBeDefined();
	});

	test("POST create config missing url → 400/-32602", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-push-bad"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs",
			{ method: "POST", body: JSON.stringify({}) },
		);
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32602);
	});

	test("GET list → 200 {configs}", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-push"),
			onTask: async (text) => text,
		});
		server.start();

		await restFetch(PORT, "/tasks/task-push/pushNotificationConfigs", {
			method: "POST",
			body: JSON.stringify({ url: "https://example.com/cb" }),
		});
		const res = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs",
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { configs: unknown[] };
		expect(json.configs).toHaveLength(1);
	});

	test("GET item → 200 / 404", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-push"),
			onTask: async (text) => text,
		});
		server.start();

		const create = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs",
			{
				method: "POST",
				body: JSON.stringify({ url: "https://example.com/cb" }),
			},
		);
		const created = (await create.json()) as {
			config: { id: string };
		};

		const res = await restFetch(
			PORT,
			`/tasks/task-push/pushNotificationConfigs/${created.config.id}`,
		);
		expect(res.status).toBe(200);
		const found = (await res.json()) as { config: { id: string; url: string } };
		expect(found.config.id).toBe(created.config.id);

		const missing = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs/nope",
		);
		expect(missing.status).toBe(404);
		const missingJson = (await missing.json()) as { error: { code: number } };
		expect(missingJson.error.code).toBe(-32000);
	});

	test("PATCH item → 200 updated config", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-push"),
			onTask: async (text) => text,
		});
		server.start();

		const create = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs",
			{
				method: "POST",
				body: JSON.stringify({ url: "https://example.com/cb" }),
			},
		);
		const created = (await create.json()) as { config: { id: string } };

		const res = await restFetch(
			PORT,
			`/tasks/task-push/pushNotificationConfigs/${created.config.id}`,
			{
				method: "PATCH",
				body: JSON.stringify({ url: "https://new.example.com/cb" }),
			},
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { config: { url: string } };
		expect(json.config.url).toBe("https://new.example.com/cb");
	});

	test("DELETE item → 200 {success} then 404", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-push"),
			onTask: async (text) => text,
		});
		server.start();

		const create = await restFetch(
			PORT,
			"/tasks/task-push/pushNotificationConfigs",
			{
				method: "POST",
				body: JSON.stringify({ url: "https://example.com/cb" }),
			},
		);
		const created = (await create.json()) as { config: { id: string } };

		const del = await restFetch(
			PORT,
			`/tasks/task-push/pushNotificationConfigs/${created.config.id}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(200);
		const delJson = (await del.json()) as { success: boolean };
		expect(delJson.success).toBe(true);

		const missing = await restFetch(
			PORT,
			`/tasks/task-push/pushNotificationConfigs/${created.config.id}`,
		);
		expect(missing.status).toBe(404);
	});
});

describe("A2AServer REST binding — /extendedAgentCard", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("GET /extendedAgentCard configured → 200 {agentCard}", async () => {
		const extended: A2AAgentCard = {
			name: "rest-extended",
			description: "extended description",
			url: `http://localhost:${PORT}`,
			version: "1.0.0",
			supportedInterfaces: [
				{
					url: "http://localhost:0/",
					protocolBinding: "A2A",
					protocolVersion: "1.0",
				},
			],
			defaultInputModes: ["text"],
			skills: [{ id: "extended-skill", name: "ext" }],
		};
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-extended"),
			onTask: async (text) => text,
			extendedAgentCard: extended,
		});
		server.start();

		const res = await restFetch(PORT, "/extendedAgentCard");
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			agentCard: { name: string; skills: Array<{ id: string }> };
		};
		expect(json.agentCard.name).toBe("rest-extended");
		expect(json.agentCard.skills).toHaveLength(1);
		expect(json.agentCard.skills[0]!.id).toBe("extended-skill");
	});

	test("GET /extendedAgentCard not configured → 500/-32603", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-extended-nc"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(PORT, "/extendedAgentCard");
		expect(res.status).toBe(500);
		const json = (await res.json()) as { error: { code: number } };
		expect(json.error.code).toBe(-32603);
	});
});

describe("A2AServer REST binding — tenant prefix & fallthrough", () => {
	let server: A2AServer | null = null;

	afterEach(() => {
		server?.stop();
		server = null;
	});

	test("tenantPrefix strips prefix from REST path", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-tenant"),
			onTask: async (text) => `tenant:${text}`,
			tenantPrefix: "acme",
		});
		server.start();

		const res = await restFetch(PORT, "/acme/message:send", {
			method: "POST",
			body: JSON.stringify({
				message: { role: "user", parts: [{ kind: "text", text: "hi" }] },
			}),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			task: { status: { state: string } };
			message: { parts: Array<{ text: string }> };
		};
		expect(json.task.status.state).toBe("completed");
		expect(json.message.parts[0]!.text).toBe("tenant:hi\n");
	});

	test("non-REST path falls through to plain 404", async () => {
		server = new A2AServer({
			port: PORT,
			card: cardConfig(PORT, "rest-404"),
			onTask: async (text) => text,
		});
		server.start();

		const res = await restFetch(PORT, "/bogus/path");
		expect(res.status).toBe(404);
		expect(await res.text()).toBe("Not found");
	});
});
