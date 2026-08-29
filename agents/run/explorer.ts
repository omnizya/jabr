import { TaskMemory } from "@adapters/task-memory";
import { ExplorerAgent, EXPLORER_CARD } from "@core/explorer";
import { runAgent } from "./serve.ts";
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const agent = new ExplorerAgent(taskStore);

  const realtimePort = Number(process.env.JABR_REALTIME_PORT);
  let realtime: RealtimePort;
  if (!isNaN(realtimePort) && realtimePort > 0) {
    realtime = {
      broadcast: (event) =>
        fetch(`http://localhost:${realtimePort}/emit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        }).catch((e) => console.warn(`[Explorer] realtime emit failed: ${e}`)),
      emitTo: () => {},
      on: () => {},
      getConnectionCount: () => 0,
    };
  } else {
    realtime = startBunWebSocketAdapter({ port: 4008 });
  }

  const lifecycle = initLifecycle(realtime, "explorer", 4003);
  lifecycle.announceOnline();

  process.on("SIGTERM", () => {
    realtime.broadcast({ type: "agent:offline", agent: "explorer" });
    process.exit(0);
  });
  process.on("uncaughtException", (e) => {
    lifecycle.uncaughtHandler(e);
    console.error(`[Explorer] uncaught exception:`, e);
  });

  runAgent({
    port: 4003,
    card: EXPLORER_CARD,
    execute: (taskId, text) => {
      console.log(`[Run:Explorer] dispatching exploration task ${taskId}`);
      return agent.execute(taskId, text);
    },
    taskStore,
  });
}
