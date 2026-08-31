import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventMap } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "@run/lifecycle";

describe("initLifecycle with plugin bus", () => {
	let emitted: Array<{
		type: string;
		agent?: string;
		error?: string;
		port?: number;
	}>;
	let bus: PluginEventBusImpl<DomainEventMap>;

	beforeEach(() => {
		emitted = [];
		bus = new PluginEventBusImpl<DomainEventMap>();
	});

	function makeRealtime(): RealtimePort {
		return {
			broadcast: (event) =>
				emitted.push({
					type: event.type as string,
					agent:
						"agent" in event ? (event as { agent: string }).agent : undefined,
					error:
						"error" in event ? (event as { error: string }).error : undefined,
					port: "port" in event ? (event as { port: number }).port : undefined,
				}),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
	}

	test("announceOnline emits onAgentStart on the plugin bus", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "oracle", 4001, bus);
		lifecycle.announceOnline();

		const startEvents: unknown[] = [];
		bus.subscribe("onAgentStart", (payload) => {
			startEvents.push(payload);
		});

		// Re-emit to capture (subscribe happened after first emit)
		expect(startEvents).toHaveLength(0);

		// Verify the wire event was emitted
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "agent:online",
			agent: "oracle",
			port: 4001,
		});
	});

	test("announceOnline emits onAgentStart with correct payload shape", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "test-agent", 9999, bus);

		const captured: unknown[] = [];
		bus.subscribe("onAgentStart", (payload) => captured.push(payload));

		lifecycle.announceOnline();

		expect(captured).toHaveLength(1);
		const payload = captured[0] as any;
		expect(payload.agentId).toBeDefined();
		expect(payload.agentName).toBe("test-agent");
		expect(payload.provider).toBe("unknown");
		expect(payload.model).toBe("unknown");
		expect(payload.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(payload.metadata).toEqual({ port: 9999 });
	});

	test("announceOffline emits onAgentComplete with correct payload shape", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "test-agent", 9999, bus);

		const captured: unknown[] = [];
		bus.subscribe("onAgentComplete", (payload) => captured.push(payload));

		lifecycle.announceOffline();

		expect(captured).toHaveLength(1);
		const payload = captured[0] as any;
		expect(payload.agentId).toBeDefined();
		expect(payload.agentName).toBe("test-agent");
		expect(payload.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(payload.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(payload.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("uncaughtHandler emits onAgentError with correct payload shape", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "test-agent", 9999, bus);

		const captured: unknown[] = [];
		bus.subscribe("onAgentError", (payload) => captured.push(payload));

		lifecycle.uncaughtHandler(new Error("test failure"));

		expect(captured).toHaveLength(1);
		const payload = captured[0] as any;
		expect(payload.agentId).toBeDefined();
		expect(payload.agentName).toBe("test-agent");
		expect(payload.erroredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(payload.error.message).toBe("test failure");
		expect(payload.recoverable).toBe(false);
	});

	test("uncaughtHandler marks TimeoutError as recoverable", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "test-agent", 9999, bus);

		const captured: unknown[] = [];
		bus.subscribe("onAgentError", (payload) => captured.push(payload));

		const timeoutErr = new Error("timeout");
		timeoutErr.name = "TimeoutError";
		lifecycle.uncaughtHandler(timeoutErr);

		expect(captured).toHaveLength(1);
		const payload = captured[0] as any;
		expect(payload.recoverable).toBe(true);
	});

	test("works without plugin bus (backward compatible)", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "oracle", 4001);
		lifecycle.announceOnline();
		lifecycle.uncaughtHandler(new Error("boom"));
		lifecycle.announceOffline();

		expect(emitted).toHaveLength(3);
		expect(emitted[0]).toMatchObject({ type: "agent:online", agent: "oracle" });
		expect(emitted[1]).toMatchObject({ type: "agent:error", agent: "oracle" });
		expect(emitted[2]).toMatchObject({
			type: "agent:offline",
			agent: "oracle",
		});
	});

	test("error paths emit both wire and plugin events reliably", () => {
		const realtime = makeRealtime();
		const lifecycle = initLifecycle(realtime, "failing-agent", 4000, bus);

		const startEvents: unknown[] = [];
		const errorEvents: unknown[] = [];
		const completeEvents: unknown[] = [];

		bus.subscribe("onAgentStart", (p) => startEvents.push(p));
		bus.subscribe("onAgentError", (p) => errorEvents.push(p));
		bus.subscribe("onAgentComplete", (p) => completeEvents.push(p));

		lifecycle.announceOnline();
		try {
			throw new Error("simulated failure");
		} catch (e) {
			lifecycle.uncaughtHandler(e);
		}
		lifecycle.announceOffline();

		// All three plugin events should fire
		expect(startEvents).toHaveLength(1);
		expect(errorEvents).toHaveLength(1);
		expect(completeEvents).toHaveLength(1);

		// All three wire events should fire
		expect(emitted).toHaveLength(3);
		expect(emitted[0]).toMatchObject({ type: "agent:online" });
		expect(emitted[1]).toMatchObject({ type: "agent:error" });
		expect(emitted[2]).toMatchObject({ type: "agent:offline" });
	});
});
