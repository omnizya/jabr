import type { RealtimePort } from "@ports/realtime-port";

/**
 * Wire agent lifecycle events into a RealtimePort.
 *
 * Called by agent runners to publish `agent:online` on start and wire
 * `agent:offline` + `agent:error` handlers for graceful shutdown.
 *
 * Usage (e.g. in agents/run/oracle.ts):
 *   initLifecycle(realtime, "oracle", 4001);
 *   process.on("SIGTERM", () => { realtime.broadcast({ type: "agent:offline", agent: "oracle" }); process.exit(0); });
 *   process.on("uncaughtException", (e) => { realtime.broadcast({ type: "agent:error", agent: "oracle", error: String(e) }); });
 */
export function initLifecycle(
  realtime: RealtimePort,
  agentName: string,
  port?: number,
): {
  /** Broadcast the agent:online event (call after the server is listening). */
  announceOnline: () => void;
  /** Return an uncaughtException handler to broadcast agent:error. */
  uncaughtHandler: (e: unknown) => void;
} {
  const announceOnline = () => {
    realtime.broadcast({
      type: "agent:online",
      agent: agentName,
      ...(port !== undefined ? { port } : {}),
    });
  };

  const uncaughtHandler = (e: unknown) => {
    realtime.broadcast({
      type: "agent:error",
      agent: agentName,
      error: String(e),
    });
  };

  return { announceOnline, uncaughtHandler };
}
