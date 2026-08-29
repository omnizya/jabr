import type { RealtimePort } from "@ports/realtime-port";

/**
 * Wire agent lifecycle events into a RealtimePort.
 *
 * Registers the following on the current process:
 *  - SIGINT  → agent:offline + process.exit(0)
 *  - SIGTERM → agent:offline + process.exit(0)
 *  - uncaughtException → agent:error (via returned uncaughtHandler)
 *  - unhandledRejection → agent:error
 *
 * Callers that already register their own SIGTERM handler (the pre-existing
 * pattern in agents/run/*.ts) will see a harmless duplicate offline broadcast
 * on SIGTERM — the event is idempotent and process.exit(0) is a no-op when
 * already exiting.
 *
 * Returns:
 *  - announceOnline(): call after the server is listening.
 *  - uncaughtHandler: pass to your own process.on("uncaughtException") so you
 *    can add per-agent logging around it.
 *  - cleanup(): removes the SIGINT/SIGTERM/unhandledRejection listeners and
 *    is meant for test teardown and graceful-restart paths.
 *
 * Usage (e.g. in agents/run/oracle.ts):
 *   const lifecycle = initLifecycle(realtime, "oracle", 4001);
 *   lifecycle.announceOnline();
 *   process.on("uncaughtException", (e) => { lifecycle.uncaughtHandler(e); ... });
 *   // SIGINT / SIGTERM / unhandledRejection are wired automatically.
 */
export function initLifecycle(
  realtime: RealtimePort,
  agentName: string,
  port?: number,
): {
  announceOnline: () => void;
  uncaughtHandler: (e: unknown) => void;
  cleanup: () => void;
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

  const offline = () => {
    realtime.broadcast({ type: "agent:offline", agent: agentName });
  };

  const onSignal = () => {
    offline();
    process.exit(0);
  };

  const onUnhandledRejection = (reason: unknown) => {
    uncaughtHandler(reason);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("unhandledRejection", onUnhandledRejection);

  const cleanup = () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("unhandledRejection", onUnhandledRejection);
  };

  return { announceOnline, uncaughtHandler, cleanup };
}
