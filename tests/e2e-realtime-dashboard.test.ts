/**
 * e2e-realtime-dashboard.test.ts — E2E test for the real-time agent status
 * dashboard WebSocket flow.
 *
 * Simulates a dashboard client connecting to the BunWebSocketAdapter, joining
 * agent-status and task rooms, and verifying it receives the full lifecycle of
 * realtime events: agent:online / agent:offline, system:health, task:created /
 * task:progress / task:completed / task:failed, system:alert.
 *
 * Run:  bun test tests/e2e-realtime-dashboard.test.ts
 */

import { afterEach, describe, expect, test } from "bun:test";
import { BunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import type { RealtimeEvent } from "@ports/realtime-port";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collect messages from a WebSocket into an array, in order. */
function collectMessages(ws: WebSocket): Promise<RealtimeEvent[]> {
	return new Promise((resolve) => {
		const received: RealtimeEvent[] = [];
		ws.onmessage = (ev) => {
			try {
				const parsed = JSON.parse(ev.data) as RealtimeEvent;
				received.push(parsed);
			} catch {
				// ignore non-JSON noise
			}
		};
		// Resolve when the collector itself is dropped; caller must arrange timeout.
		resolve(received);
	});
}

describe("Real-time agent status dashboard E2E", () => {
	let adapter: BunWebSocketAdapter;
	let port = 24100; // below the Linux ephemeral range (32768-60999) so port-0 binds in other test files can never collide

	afterEach(() => {
		adapter?.stop();
		adapter = null!;
		// Each test binds a fresh port so parallel/back-to-back runs never collide
		// on a still-releasing listener.
		port += 1;
	});

	// ── Helper: open a WS, wait for open, return it. ──────────────────────────

	async function openWs(label: string): Promise<WebSocket> {
		const ws = new WebSocket(`ws://localhost:${port}`);
		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve();
			ws.onerror = () => reject(new Error(`${label} ws open failed`));
		});
		await delay(30);
		return ws;
	}

	// ── Helper: POST /emit and return the parsed response. ────────────────────

	async function emit(event: RealtimeEvent): Promise<void> {
		const res = await fetch(`http://localhost:${port}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(event),
		});
		expect(res.status).toBe(200);
	}

	// ── Helper: connect a dashboard client, returning collected messages + ws. ─

	async function connectDashboard(): Promise<{
		ws: WebSocket;
		messages: RealtimeEvent[];
	}> {
		const ws = await openWs("dashboard");
		const messages = await collectMessages(ws);
		return { ws, messages };
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 1. Dashboard sees agent:online and agent:offline
	// ──────────────────────────────────────────────────────────────────────────

	test("agent:online / agent:offline broadcast reaches dashboard", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const dashboard = await connectDashboard();

		// Agent "oracle" comes online.
		await emit({
			type: "agent:online",
			agent: "oracle",
			port: 4001,
		});
		await delay(50);

		// Agent "librarian" comes online.
		await emit({
			type: "agent:online",
			agent: "librarian",
			port: 4002,
		});
		await delay(50);

		// Agent "oracle" goes offline.
		await emit({ type: "agent:offline", agent: "oracle" });
		await delay(50);

		// Give the dashboard a moment to process.
		await delay(60);

		// Stop collecting — we snapshot what we have.
		dashboard.ws.close();
		await delay(30);

		// The dashboard's collected array should have at least the 3 events.
		// (collectMessages resolves immediately with the array reference, which
		//  grows as onmessage fires — we read it after closing.)
		const seen = dashboard.messages;
		const agentEvents = seen.filter(
			(e) => e.type === "agent:online" || e.type === "agent:offline",
		);
		expect(agentEvents).toHaveLength(3);

		const onlineOracle = agentEvents.find(
			(e) => e.type === "agent:online" && e.agent === "oracle",
		);
		expect(onlineOracle).toBeDefined();
		expect((onlineOracle as any).port).toBe(4001);

		const onlineLibrarian = agentEvents.find(
			(e) => e.type === "agent:online" && e.agent === "librarian",
		);
		expect(onlineLibrarian).toBeDefined();

		const offlineOracle = agentEvents.find(
			(e) => e.type === "agent:offline" && e.agent === "oracle",
		);
		expect(offlineOracle).toBeDefined();
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 2. Dashboard joins a room and receives room-scoped task events
	// ──────────────────────────────────────────────────────────────────────────

	test("dashboard in task-42 room receives task lifecycle events", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = await openWs("dashboard");
		// Join the task room.
		ws.send(JSON.stringify({ type: "join-room", room: "task-42" }));
		await delay(50);

		const messages = await collectMessages(ws);

		// Emit a sequence of task events to the room.
		await emit({
			type: "task:created",
			taskId: "task-42",
			agent: "oracle",
		});
		await delay(40);

		await emit({
			type: "task:progress",
			taskId: "task-42",
			percent: 25,
			message: "analyzing inputs",
		});
		await delay(40);

		await emit({
			type: "task:progress",
			taskId: "task-42",
			percent: 75,
			message: "writing output",
		});
		await delay(40);

		await emit({
			type: "task:completed",
			taskId: "task-42",
			result: { summary: "done" },
		});
		await delay(40);

		ws.close();
		await delay(30);

		const taskEvents = messages.filter((e) =>
			[
				"task:created",
				"task:progress",
				"task:completed",
				"task:failed",
			].includes(e.type),
		);
		expect(taskEvents).toHaveLength(4);

		expect(taskEvents[0]).toMatchObject({
			type: "task:created",
			taskId: "task-42",
			agent: "oracle",
		});
		expect((taskEvents[1] as any).percent).toBe(25);
		expect((taskEvents[1] as any).message).toBe("analyzing inputs");
		expect((taskEvents[2] as any).percent).toBe(75);
		expect((taskEvents[2] as any).message).toBe("writing output");
		expect(taskEvents[3]).toMatchObject({ type: "task:completed" });
		expect((taskEvents[3] as any).result).toEqual({ summary: "done" });
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 3. Dashboard NOT in room does NOT receive room-scoped events
	// ──────────────────────────────────────────────────────────────────────────

	test("dashboard outside room does not receive task events via emitTo", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = await openWs("dashboard");
		const messages = await collectMessages(ws);

		// Use emitTo (room-scoped) — NOT broadcast — to test room isolation.
		adapter.emitTo("task-99", {
			type: "task:progress",
			taskId: "task-99",
			percent: 50,
			message: "should not arrive",
		});
		await delay(60);

		ws.close();
		await delay(30);

		const taskEvents = messages.filter((e) =>
			[
				"task:created",
				"task:progress",
				"task:completed",
				"task:failed",
			].includes(e.type),
		);
		expect(taskEvents).toHaveLength(0);
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 4. system:health and system:alert broadcast
	// ──────────────────────────────────────────────────────────────────────────

	test("dashboard receives system:health and system:alert broadcasts", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = await openWs("dashboard");
		const messages = await collectMessages(ws);

		await emit({
			type: "system:health",
			agents: 7,
			tasks: 12,
			memory: 4,
		});
		await delay(40);

		await emit({
			type: "system:alert",
			level: "warning",
			message: "task queue backlog > 50",
		});
		await delay(40);

		await emit({
			type: "system:alert",
			level: "info",
			message: "sync complete",
		});
		await delay(40);

		ws.close();
		await delay(30);

		const systemEvents = messages.filter(
			(e) => e.type === "system:health" || e.type === "system:alert",
		);
		expect(systemEvents).toHaveLength(3);

		const health = systemEvents.find((e) => e.type === "system:health") as any;
		expect(health.agents).toBe(7);
		expect(health.tasks).toBe(12);
		expect(health.memory).toBe(4);

		const alerts = systemEvents.filter((e) => e.type === "system:alert");
		expect(alerts).toHaveLength(2);
		expect((alerts[0] as any).level).toBe("warning");
		expect((alerts[0] as any).message).toBe("task queue backlog > 50");
		expect((alerts[1] as any).level).toBe("info");
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 5. Multiple dashboard clients each see all broadcasts
	// ──────────────────────────────────────────────────────────────────────────

	test("multiple dashboards each receive all broadcasts", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const dash1 = await connectDashboard();
		const dash2 = await connectDashboard();
		await delay(50);

		await emit({
			type: "agent:online",
			agent: "scientist",
			port: 4006,
		});
		await delay(50);

		await emit({ type: "agent:offline", agent: "scientist" });
		await delay(50);

		dash1.ws.close();
		dash2.ws.close();
		await delay(30);

		const d1 = dash1.messages.filter(
			(e) => e.type === "agent:online" || e.type === "agent:offline",
		);
		const d2 = dash2.messages.filter(
			(e) => e.type === "agent:online" || e.type === "agent:offline",
		);
		expect(d1).toHaveLength(2);
		expect(d2).toHaveLength(2);
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 6. task:failed event reaches room subscribers
	// ──────────────────────────────────────────────────────────────────────────

	test("task:failed broadcast reaches room subscribers", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = await openWs("dashboard");
		ws.send(JSON.stringify({ type: "join-room", room: "task-77" }));
		await delay(50);

		const messages = await collectMessages(ws);

		await emit({
			type: "task:failed",
			taskId: "task-77",
			error: "timeout after 30s",
		});
		await delay(50);

		ws.close();
		await delay(30);

		const failed = messages.find(
			(e) => e.type === "task:failed" && (e as any).taskId === "task-77",
		);
		expect(failed).toBeDefined();
		expect((failed as any).error).toBe("timeout after 30s");
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 7. agent:error event reaches dashboard
	// ──────────────────────────────────────────────────────────────────────────

	test("agent:error broadcast reaches dashboard", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = await openWs("dashboard");
		const messages = await collectMessages(ws);

		await emit({
			type: "agent:error",
			agent: "fixer",
			error: "model load failed: context window exceeded",
		});
		await delay(50);

		ws.close();
		await delay(30);

		const err = messages.find(
			(e) => e.type === "agent:error" && (e as any).agent === "fixer",
		);
		expect(err).toBeDefined();
		expect((err as any).error).toBe(
			"model load failed: context window exceeded",
		);
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 8. Connection count reflects dashboard connections
	// ──────────────────────────────────────────────────────────────────────────

	test("getConnectionCount tracks dashboard connections", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		expect(adapter.getConnectionCount()).toBe(0);

		const dash1 = await openWs("dash1");
		await delay(30);
		expect(adapter.getConnectionCount()).toBe(1);

		const dash2 = await openWs("dash2");
		await delay(30);
		expect(adapter.getConnectionCount()).toBe(2);

		dash1.close();
		await delay(30);
		expect(adapter.getConnectionCount()).toBe(1);

		dash2.close();
		await delay(30);
		expect(adapter.getConnectionCount()).toBe(0);

		adapter.stop();
		await delay(30);
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 9. Dashboard reconnect: receives events after reconnect
	// ──────────────────────────────────────────────────────────────────────────

	test("dashboard reconnect receives subsequent events", async () => {
		adapter = new BunWebSocketAdapter({ port });
		adapter.start();
		await delay(150);

		const ws = await openWs("dashboard");
		const messages = await collectMessages(ws);

		// Emit before "reconnect".
		await emit({
			type: "agent:online",
			agent: "oracle",
			port: 4001,
		});
		await delay(50);

		// Simulate disconnect.
		ws.close();
		await delay(80);

		// Reconnect.
		const ws2 = await openWs("dashboard-reconnected");
		const messages2 = await collectMessages(ws2);

		await emit({
			type: "agent:online",
			agent: "librarian",
			port: 4002,
		});
		await delay(50);

		ws2.close();
		await delay(30);

		// First session saw the first event; second session saw the second.
		const firstSeen = messages.filter(
			(e) => e.type === "agent:online" && (e as any).agent === "oracle",
		);
		expect(firstSeen).toHaveLength(1);

		const secondSeen = messages2.filter(
			(e) => e.type === "agent:online" && (e as any).agent === "librarian",
		);
		expect(secondSeen).toHaveLength(1);
	});
});
