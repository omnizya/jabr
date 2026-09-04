/**
 * realtime.ts — DRY factory for the duplicated realtime-emit block
 * that every specialist runner contained (C2 anti-pattern fix).
 *
 * When JABR_REALTIME_PORT is set, connects to that port via HTTP POST
 * (the child-runner mode). Otherwise, starts a local Bun WebSocket
 * adapter on `fallbackPort` (which defaults to JABR_PORTS.realtime).
 */
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import { jabrUrlForPort } from "@config/jabr-config";
import { JABR_PORTS } from "@constants/ecosystem";
import type { RealtimePort } from "@ports/realtime-port";

export function createRealtimePort(
	name: string,
	fallbackPort: number = JABR_PORTS.realtime,
): RealtimePort {
	const realtimePort = Number(process.env.JABR_REALTIME_PORT);
	if (!isNaN(realtimePort) && realtimePort > 0) {
		return {
			broadcast: (event) =>
				fetch(`${jabrUrlForPort(realtimePort)}/emit`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(event),
				}).catch((e) => console.warn(`[${name}] realtime emit failed: ${e}`)),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
	}
	return startBunWebSocketAdapter({ port: fallbackPort });
}