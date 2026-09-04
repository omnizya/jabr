import { McpClientAdapter } from "@adapters/mcp-client";
import { TaskMemory } from "@adapters/task-memory";
import { EXPLORER_CARD, ExplorerAgent } from "@core/explorer";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
import { runAgent } from "./serve.ts";
import { JABR_PORTS } from "@constants/ecosystem";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const mcpClient = new McpClientAdapter();
	const agent = new ExplorerAgent(taskStore, mcpClient);

	const realtime = createRealtimePort("Explorer");

	const lifecycle = initLifecycle(realtime, "explorer", JABR_PORTS.explorer);
	lifecycle.announceOnline();

	process.on("SIGTERM", () => {
		lifecycle.announceOffline();
		process.exit(0);
	});
	process.on("uncaughtException", (e) => {
		lifecycle.uncaughtHandler(e);
		console.error(`[Explorer] uncaught exception:`, e);
	});

	runAgent({
		port: JABR_PORTS.explorer,
		card: EXPLORER_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Explorer] dispatching exploration task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
