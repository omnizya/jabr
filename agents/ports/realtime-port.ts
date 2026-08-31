// ports/realtime-port.ts
// Realtime event emission contract — broadcast, room emit, subscribe.
// Hexagonal port: adapters implement this (e.g. socket-io-adapter.ts).
// Events schema lives in REBRANDING.md §5 — consumers import both.

export type RealtimeEvent =
	| { type: "agent:online"; agent: string; port?: number }
	| { type: "agent:offline"; agent: string }
	| { type: "agent:error"; agent: string; error: string }
	| { type: "task:created"; taskId: string; agent: string }
	| { type: "task:progress"; taskId: string; percent: number; message: string }
	| { type: "task:completed"; taskId: string; result: unknown }
	| { type: "task:failed"; taskId: string; error: string }
	| { type: "system:health"; agents: number; tasks: number; memory: number }
	| {
			type: "system:alert";
			level: "info" | "warning" | "error";
			message: string;
	  };

export interface RealtimePort {
	/** Emit event to all connected clients. */
	broadcast(event: RealtimeEvent): void;

	/** Emit event to a specific room (e.g. task-{id}). */
	emitTo(room: string, event: RealtimeEvent): void;

	/** Subscribe to events from clients. Handler runs for every matching event. */
	on<E extends RealtimeEvent["type"]>(
		eventType: E,
		handler: (payload: Extract<RealtimeEvent, { type: E }>) => void,
	): void;

	/** Total connected clients across all rooms. */
	getConnectionCount(): number;
}

console.log("[RealtimePort] port interface loaded");
