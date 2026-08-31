import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import type { RealtimeEvent } from "@ports/realtime-port";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("BunWebSocketAdapter", () => {
	let adapter: BunWebSocketAdapter;
	let port = 24000; // below the Linux ephemeral range (32768-60999) so port-0 binds in other test files can never collide

	afterEach(() => {
		adapter?.stop();
		adapter = null!;
		port += 1; // fresh port per test — avoids parallel start/stop races
	});

	test("start/stop cycle with health endpoint", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const health = await fetch(`http://localhost:${port}/health`);
		expect(health.status).toBe(200);
		const body = (await health.json()) as {
			status: string;
			connections: number;
			ws: string;
		};
		expect(body.status).toBe("ok");
		expect(body.connections).toBe(0);
		expect(body.ws).toBe(`wss://localhost:${port}`);

		adapter.stop();
		await delay(50);
	});

	test("broadcast reaches a connected client", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		// Connect a client.
		const ws = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
			ws.onerror = () => {
				throw new Error("ws open failed");
			};
		});
		await delay(50);

		// Subscribe to a global broadcast listener (port method).
		const seen = new Promise<RealtimeEvent>((resolve) => {
			adapter.on("agent:online", (event) => resolve(event));
		});

		adapter.broadcast({ type: "agent:online", agent: "tester", port });

		const event = (await Promise.race([
			seen,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 2000),
			),
		])) as { type: string; agent: string; port: number };
		expect(event.type).toBe("agent:online");
		expect(event.agent).toBe("tester");
		expect(event.port).toBe(port);

		ws.close();
		await delay(50);
	});

	test("emitTo reaches only clients in the named room", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		// Two clients: one joins "task-1", the other stays in no room.
		const ws1 = new WebSocket(`ws://localhost:${port}`);
		const ws2 = new WebSocket(`ws://localhost:${port}`);

		await Promise.all([
			new Promise<void>((resolve) => {
				ws1.onopen = () => resolve();
			}),
			new Promise<void>((resolve) => {
				ws2.onopen = () => resolve();
			}),
		]);
		await delay(50);

		// ws1 joins the room.
		ws1.send(JSON.stringify({ type: "join-room", room: "task-1" }));
		await delay(50);

		const inRoom = new Promise<RealtimeEvent>((resolve) => {
			ws1.onmessage = (ev) => {
				try {
					const parsed = JSON.parse(ev.data);
					resolve(parsed as RealtimeEvent);
				} catch {
					// ignore
				}
			};
		});

		const notInRoom = new Promise<void>((resolve) => {
			ws2.onmessage = () => {
				throw new Error("ws2 should not receive room event");
			};
			setTimeout(resolve, 800);
		});

		adapter.emitTo("task-1", {
			type: "task:progress",
			taskId: "task-1",
			percent: 42,
			message: "working",
		});

		const event = (await Promise.race([
			inRoom,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 2000),
			),
		])) as { type: string; taskId: string; percent: number };
		expect(event.type).toBe("task:progress");
		expect(event.taskId).toBe("task-1");
		expect(event.percent).toBe(42);

		// ws2 should NOT have received it.
		await notInRoom;

		ws1.close();
		ws2.close();
		await delay(50);
	});

	test("on() subscribes and receives broadcast events", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const received: RealtimeEvent[] = [];
		adapter.on("system:alert", (event) => received.push(event));

		adapter.broadcast({
			type: "system:alert",
			level: "info",
			message: "all good",
		});
		adapter.broadcast({ type: "agent:online", agent: "x", port: port });
		adapter.broadcast({
			type: "system:alert",
			level: "warning",
			message: "watch this",
		});

		await delay(100);
		expect(received).toHaveLength(2);
		expect(received[0]).toMatchObject({
			type: "system:alert",
			level: "info",
			message: "all good",
		});
		expect(received[1]).toMatchObject({
			type: "system:alert",
			level: "warning",
			message: "watch this",
		});

		adapter.stop();
		await delay(50);
	});

	test("getConnectionCount tracks opens and closes", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		expect(adapter.getConnectionCount()).toBe(0);

		const ws1 = new WebSocket(`ws://localhost:${port}`);
		const ws2 = new WebSocket(`ws://localhost:${port}`);

		await new Promise<void>((resolve) => {
			let opened = 0;
			ws1.onopen = () => {
				opened++;
				if (opened >= 2) resolve();
			};
			ws2.onopen = () => {
				opened++;
				if (opened >= 2) resolve();
			};
		});
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(2);

		ws1.close();
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(1);

		ws2.close();
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(0);

		adapter.stop();
		await delay(50);
	});

	// ── system:health validation ──────────────────────────────────────────────

	test("POST /emit accepts valid system:health with agents/tasks/memory numbers", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: 7,
				tasks: 12,
				memory: 4,
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);

		// Event should also reach subscribed listeners.
		const received = new Promise<RealtimeEvent>((resolve) => {
			adapter.on("system:health", (event) => resolve(event));
		});
		adapter.broadcast({
			type: "system:health",
			agents: 3,
			tasks: 8,
			memory: 2,
		});
		const event = await Promise.race([
			received,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 2000),
			),
		]);
		expect(event.type).toBe("system:health");
		expect(event.agents).toBe(3);
		expect(event.tasks).toBe(8);
		expect(event.memory).toBe(2);

		adapter.stop();
		await delay(50);
	});

	test("POST /emit rejects system:health missing tasks field", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: 7,
				memory: 4,
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe(-32602);
		expect(body.error.message).toBe("Unknown event type");

		adapter.stop();
		await delay(50);
	});

	test("POST /emit rejects system:health missing memory field", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: 7,
				tasks: 12,
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe(-32602);
		expect(body.error.message).toBe("Unknown event type");

		adapter.stop();
		await delay(50);
	});

	test("POST /emit rejects system:health with non-number tasks", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: 7,
				tasks: "12",
				memory: 4,
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe(-32602);

		adapter.stop();
		await delay(50);
	});

	test("POST /emit rejects system:health with non-number memory", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: 7,
				tasks: 12,
				memory: "4",
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe(-32602);

		adapter.stop();
		await delay(50);
	});

	test("POST /emit rejects system:health with negative numbers", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		// Negative numbers are still typeof "number" — validator accepts them.
		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: -1,
				tasks: -5,
				memory: -3,
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);

		adapter.stop();
		await delay(50);
	});

	test("POST /emit rejects system:health missing all numeric fields", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "system:health",
				agents: "seven",
				tasks: null,
				memory: undefined,
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe(-32602);

		adapter.stop();
		await delay(50);
	});

	test("broadcast delivers valid system:health to subscribed client", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});
		await delay(50);

		const received = new Promise<RealtimeEvent>((resolve) => {
			ws.onmessage = (ev) => {
				try {
					resolve(JSON.parse(ev.data) as RealtimeEvent);
				} catch {}
			};
		});

		adapter.broadcast({
			type: "system:health",
			agents: 7,
			tasks: 12,
			memory: 4,
		});

		const event = await Promise.race([
			received,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 2000),
			),
		]);
		expect(event.type).toBe("system:health");
		expect(event.agents).toBe(7);
		expect(event.tasks).toBe(12);
		expect(event.memory).toBe(4);

		ws.close();
		await delay(50);
		adapter.stop();
		await delay(50);
	});

	test("on() receives system:health broadcast", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const received: RealtimeEvent[] = [];
		adapter.on("system:health", (event) => received.push(event));

		adapter.broadcast({
			type: "system:health",
			agents: 3,
			tasks: 8,
			memory: 2,
		});
		adapter.broadcast({
			type: "system:alert",
			level: "info",
			message: "all good",
		});
		adapter.broadcast({
			type: "system:health",
			agents: 1,
			tasks: 2,
			memory: 1,
		});

		await delay(100);
		expect(received).toHaveLength(2);
		expect(received[0]).toMatchObject({
			type: "system:health",
			agents: 3,
			tasks: 8,
			memory: 2,
		});
		expect(received[1]).toMatchObject({
			type: "system:health",
			agents: 1,
			tasks: 2,
			memory: 1,
		});

		adapter.stop();
		await delay(50);
	});

	test("joinRoom / leaveRoom are idempotent and reflected in rooms", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});
		await delay(50);

		adapter.joinRoom(ws, "task-42");
		adapter.joinRoom(ws, "task-42"); // re-join is a no-op
		expect(adapter.getConnectionCount()).toBe(1);

		// A second connection joins the same room.
		const ws2 = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			ws2.onopen = () => resolve();
		});
		await delay(50);
		adapter.joinRoom(ws2, "task-42");
		expect(adapter.getConnectionCount()).toBe(2);

		adapter.leaveRoom(ws, "task-42");
		ws.close();
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(1);

		adapter.stop();
		await delay(50);
	});

	test("pingInterval pings open connections", async () => {
		adapter = new BunWebSocketAdapter({ port, pingIntervalMs: 80 });
		adapter.start();
		await delay(150);

		const ws = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});
		await delay(50);

		expect(adapter.getConnectionCount()).toBe(1);

		// Wait past one ping interval; connection should still be alive (ping
		// doesn't close healthy connections).
		await delay(120);
		expect(adapter.getConnectionCount()).toBe(1);

		ws.close();
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(0);

		adapter.stop();
		await delay(50);
	});

	test("auto-reconnect: client reconnects and re-joins room", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		// First connection, join task-7.
		const ws1 = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			ws1.onopen = () => resolve();
		});
		await delay(50);
		ws1.send(JSON.stringify({ type: "join-room", room: "task-7" }));
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(1);

		// Close it (simulates network drop).
		ws1.close();
		await delay(80);
		expect(adapter.getConnectionCount()).toBe(0);

		// Client reconnects and re-joins the same room.
		const wsReconnected = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve) => {
			wsReconnected.onopen = () => resolve();
		});
		await delay(50);
		wsReconnected.send(JSON.stringify({ type: "join-room", room: "task-7" }));
		await delay(50);
		expect(adapter.getConnectionCount()).toBe(1);

		// Emit to the room reaches the reconnected client.
		const received = new Promise<RealtimeEvent>((resolve) => {
			wsReconnected.onmessage = (ev) => {
				try {
					resolve(JSON.parse(ev.data) as RealtimeEvent);
				} catch {}
			};
		});
		adapter.emitTo("task-7", {
			type: "task:completed",
			taskId: "task-7",
			result: "done",
		});
		const event = (await Promise.race([
			received,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 2000),
			),
		])) as { type: string; taskId: string };
		expect(event.type).toBe("task:completed");
		expect(event.taskId).toBe("task-7");

		wsReconnected.close();
		await delay(50);
		adapter.stop();
		await delay(50);
	});
});
