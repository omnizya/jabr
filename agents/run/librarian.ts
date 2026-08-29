import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { Search9Router } from "@adapters/search-9router";
import { LibrarianAgent, LIBRARIAN_CARD } from "@core/librarian";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { runAgent } from "./serve.ts";
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";

if (import.meta.main) {
  const taskStore = new TaskMemory();
  const palace = new MemPalaceAdapter();
  const agent = new LibrarianAgent(taskStore, new SkillFS("skills"), new Search9Router(), palace);

  const realtimePort = Number(process.env.JABR_REALTIME_PORT);
  let realtime: RealtimePort;
  if (!isNaN(realtimePort) && realtimePort > 0) {
    realtime = {
      broadcast: (event) =>
        fetch(`http://localhost:${realtimePort}/emit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        }).catch((e) => console.warn(`[Librarian] realtime emit failed: ${e}`)),
      emitTo: () => {},
      on: () => {},
      getConnectionCount: () => 0,
    };
  } else {
    realtime = startBunWebSocketAdapter({ port: 4008 });
  }

  const lifecycle = initLifecycle(realtime, "librarian", 4002);
  lifecycle.announceOnline();

  process.on("SIGTERM", () => {
    realtime.broadcast({ type: "agent:offline", agent: "librarian" });
    process.exit(0);
  });
  process.on("uncaughtException", (e) => {
    lifecycle.uncaughtHandler(e);
    console.error(`[Librarian] uncaught exception:`, e);
  });

  runAgent({
    port: 4002,
    card: LIBRARIAN_CARD,
    execute: (taskId, text) => {
      console.log(`[Run:Librarian] dispatching task ${taskId}`);
      return agent.execute(taskId, text);
    },
    taskStore,
  });
}
