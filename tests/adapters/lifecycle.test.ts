import { describe, expect, test } from "bun:test";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { bridgeRealtimeToPlugin, initLifecycle } from "@run/lifecycle";

describe("initLifecycle", () => {
	test("announceOnline emits agent:online with agent name and optional port", () => {
		const emitted: Array<{
			type: string;
			agent?: string;
			error?: string;
			port?: number;
		}> = [];
		const realtime: RealtimePort = {
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

		const lifecycle = initLifecycle(realtime, "oracle", 4001);
		lifecycle.announceOnline();

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "agent:online",
			agent: "oracle",
			port: 4001,
		});
	});

	test("announceOnline emits onAgentStart to plugin bus when bus is provided", () => {
		const emitted: Array<{ type: string; agent?: string }> = [];
		const busEvents: Array<{ name: string; payload: any }> = [];
		const realtime: RealtimePort = {
			broadcast: (event) =>
				emitted.push({
					type: event.type as string,
					agent:
						"agent" in event ? (event as { agent: string }).agent : undefined,
				}),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
		const bus = new PluginEventBusImpl();
		bus.subscribe("onAgentStart", (payload, name) => {
			busEvents.push({ name, payload });
		});

		const lifecycle = initLifecycle(realtime, "oracle", 4001, bus);
		lifecycle.announceOnline();

		expect(emitted).toHaveLength(1);
		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.name).toBe("onAgentStart");
		expect(busEvents[0]!.payload.agentName).toBe("oracle");
		expect(busEvents[0]!.payload.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	test("announceOnline omits port when not provided", () => {
		const emitted: Array<{ type: string; agent?: string; error?: string }> = [];
		const realtime: RealtimePort = {
			broadcast: (event) =>
				emitted.push({
					type: event.type as string,
					agent:
						"agent" in event ? (event as { agent: string }).agent : undefined,
					error:
						"error" in event ? (event as { error: string }).error : undefined,
				}),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};

		const lifecycle = initLifecycle(realtime, "scientist");
		lifecycle.announceOnline();

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "agent:online",
			agent: "scientist",
		});
		expect(emitted[0]).not.toHaveProperty("port");
	});

	test("uncaughtHandler emits agent:error with stringified error", () => {
		const emitted: Array<{ type: string; agent?: string; error?: string }> = [];
		const realtime: RealtimePort = {
			broadcast: (event) =>
				emitted.push({
					type: event.type as string,
					agent:
						"agent" in event ? (event as { agent: string }).agent : undefined,
					error:
						"error" in event ? (event as { error: string }).error : undefined,
				}),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};

		const lifecycle = initLifecycle(realtime, "fixer");
		lifecycle.uncaughtHandler(new Error("boom"));

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "agent:error",
			agent: "fixer",
			error: "Error: boom",
		});
	});

	test("uncaughtHandler stringifies non-Error values", () => {
		const emitted: Array<{ type: string; agent?: string; error?: string }> = [];
		const realtime: RealtimePort = {
			broadcast: (event) =>
				emitted.push({
					type: event.type as string,
					agent:
						"agent" in event ? (event as { agent: string }).agent : undefined,
					error:
						"error" in event ? (event as { error: string }).error : undefined,
				}),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};

		const lifecycle = initLifecycle(realtime, "jarvis");
		lifecycle.uncaughtHandler("plain string");

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "agent:error",
			agent: "jarvis",
			error: "plain string",
		});
	});

	test("announceOffline emits agent:offline and onAgentComplete", () => {
		const emitted: Array<{ type: string; agent?: string }> = [];
		const busEvents: Array<{ name: string; payload: any }> = [];
		const realtime: RealtimePort = {
			broadcast: (event) =>
				emitted.push({
					type: event.type as string,
					agent:
						"agent" in event ? (event as { agent: string }).agent : undefined,
				}),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
		const bus = new PluginEventBusImpl();
		bus.subscribe("onAgentComplete", (payload, name) => {
			busEvents.push({ name, payload });
		});

		const lifecycle = initLifecycle(realtime, "oracle", 4001, bus);
		lifecycle.announceOffline();

		expect(emitted).toHaveLength(1);
		expect(emitted[0]!.type).toBe("agent:offline");
		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.name).toBe("onAgentComplete");
		expect(busEvents[0]!.payload.agentName).toBe("oracle");
	});

	test("uncaughtHandler emits onAgentError to bus with sanitized error", () => {
		const busEvents: Array<{ name: string; payload: any }> = [];
		const realtime: RealtimePort = {
			broadcast: () => {},
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
		const bus = new PluginEventBusImpl();
		bus.subscribe("onAgentError", (payload, name) => {
			busEvents.push({ name, payload });
		});

		const lifecycle = initLifecycle(realtime, "fixer", undefined, bus);
		lifecycle.uncaughtHandler(new Error("boom"));

		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.error.message).toBe("boom");
		expect(busEvents[0]!.payload.agentName).toBe("fixer");
	});
});

describe("bridgeRealtimeToPlugin", () => {
	test("bridges task:created to onTaskStart", () => {
		const busEvents: Array<{ name: string; payload: any }> = [];
		const realtime: RealtimePort = {
			broadcast: () => {},
			emitTo: () => {},
			on: (eventType: string, handler: any) => {
				if (eventType === "task:created") {
					handler({ type: "task:created", taskId: "t1", agent: "jabir" });
				}
			},
			getConnectionCount: () => 0,
		};
		const bus = new PluginEventBusImpl();
		bus.subscribe("onTaskStart", (payload, name) => {
			busEvents.push({ name, payload });
		});

		bridgeRealtimeToPlugin(realtime, bus);

		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.taskId).toBe("t1");
		expect(busEvents[0]!.payload.assignee).toBe("jabir");
	});

	test("bridges task:failed to onTaskFailed", () => {
		const busEvents: Array<{ name: string; payload: any }> = [];
		const realtime: RealtimePort = {
			broadcast: () => {},
			emitTo: () => {},
			on: (eventType: string, handler: any) => {
				if (eventType === "task:failed") {
					handler({ type: "task:failed", taskId: "t2", error: "timeout" });
				}
			},
			getConnectionCount: () => 0,
		};
		const bus = new PluginEventBusImpl();
		bus.subscribe("onTaskFailed", (payload, name) => {
			busEvents.push({ name, payload });
		});

		bridgeRealtimeToPlugin(realtime, bus);

		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.taskId).toBe("t2");
		expect(busEvents[0]!.payload.error.message).toBe("timeout");
	});

	test("bridges task:completed to onTaskComplete", () => {
		const busEvents: Array<{ name: string; payload: any }> = [];
		const realtime: RealtimePort = {
			broadcast: () => {},
			emitTo: () => {},
			on: (eventType: string, handler: any) => {
				if (eventType === "task:completed") {
					handler({ type: "task:completed", taskId: "t3", result: "done" });
				}
			},
			getConnectionCount: () => 0,
		};
		const bus = new PluginEventBusImpl();
		bus.subscribe("onTaskComplete", (payload, name) => {
			busEvents.push({ name, payload });
		});

		bridgeRealtimeToPlugin(realtime, bus);

		expect(busEvents).toHaveLength(1);
		expect(busEvents[0]!.payload.taskId).toBe("t3");
		expect(busEvents[0]!.payload.summary).toBe("done");
	});
});
