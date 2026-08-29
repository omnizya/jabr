import { McpClientAdapter } from "@adapters/mcp-client";
import { ScientistAgent } from "@core/scientist";
import { A2AServer } from "@adapters/http/a2a-server";
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";

const port = 4006;
const mcpClient = new McpClientAdapter();
const scientist = new ScientistAgent(mcpClient);

const realtimePort = Number(process.env.JABR_REALTIME_PORT);
let realtime: RealtimePort;
if (!isNaN(realtimePort) && realtimePort > 0) {
  realtime = {
    broadcast: (event) =>
      fetch(`http://localhost:${realtimePort}/emit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }).catch((e) => console.warn(`[Scientist] realtime emit failed: ${e}`)),
    emitTo: () => {},
    on: () => {},
    getConnectionCount: () => 0,
  };
} else {
  realtime = startBunWebSocketAdapter({ port: 4008 });
}

const lifecycle = initLifecycle(realtime, "scientist", 4006);
lifecycle.announceOnline();

process.on("SIGTERM", () => {
  realtime.broadcast({ type: "agent:offline", agent: "scientist" });
  process.exit(0);
});
process.on("uncaughtException", (e) => {
  lifecycle.uncaughtHandler(e);
  console.error(`[Scientist] uncaught exception:`, e);
});

const authToken = process.env.A2A_AUTH_TOKEN ?? undefined;
const requireAuth = Boolean(authToken) || process.env.A2A_REQUIRE_AUTH === "true";

const server = new A2AServer({
  port,
  card: scientist.card,
  authToken,
  requireAuth,
  async onTask(message: string): Promise<string> {
    const taskId = crypto.randomUUID();
    console.log(`[Run:Scientist] received task ${taskId}`);
    const result = await scientist.execute(taskId, message);
    return result;
  },
});

server.start();
