import { A2AServer } from "@adapters/http/a2a-server";
import { McpClientAdapter } from "@adapters/mcp-client";
import { ScientistAgent } from "@core/scientist";
import { JABR_PORTS } from "@constants/ecosystem";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";

const port = JABR_PORTS.scientist;
const mcpClient = new McpClientAdapter();
const scientist = new ScientistAgent(mcpClient);

const realtime = createRealtimePort("Scientist");

const lifecycle = initLifecycle(realtime, "scientist", JABR_PORTS.scientist);
lifecycle.announceOnline();

process.on("SIGTERM", () => {
	console.log("[Scientist] received SIGTERM, shutting down...");
	server.shutdown().then(() => {
		lifecycle.announceOffline();
		process.exit(0);
	});
});
process.on("SIGINT", () => {
	console.log("[Scientist] received SIGINT, shutting down...");
	server.shutdown().then(() => {
		lifecycle.announceOffline();
		process.exit(0);
	});
});
process.on("uncaughtException", (e) => {
	lifecycle.uncaughtHandler(e);
	console.error(`[Scientist] uncaught exception:`, e);
});

const authToken = process.env.A2A_AUTH_TOKEN ?? undefined;
const requireAuth =
	Boolean(authToken) || process.env.A2A_REQUIRE_AUTH === "true";

const server = new A2AServer({
	port,
	card: scientist.card,
	requireAuth,
	async onTask(message: string): Promise<string> {
		const taskId = crypto.randomUUID();
		console.log(`[Run:Scientist] received task ${taskId}`);
		const result = await scientist.execute(taskId, message);
		return result;
	},
});

server.start();
