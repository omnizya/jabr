import { PollinationsImageAdapter } from "@adapters/pollinations-image";
import { TaskMemory } from "@adapters/task-memory";
import { DESIGNER_CARD, DesignerAgent } from "@core/designer";
import { JABR_PORTS } from "@constants/ecosystem";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const apiKey = process.env.POLLINATIONS_API_KEY ?? "";
	const imageGen = apiKey
		? new PollinationsImageAdapter({ apiKey })
		: undefined;
	const agent = new DesignerAgent(taskStore, imageGen);

	const realtime = createRealtimePort("Designer");

	const lifecycle = initLifecycle(realtime, "designer", JABR_PORTS.designer);
	lifecycle.announceOnline();

	process.on("SIGTERM", () => {
		lifecycle.announceOffline();
		process.exit(0);
	});
	process.on("uncaughtException", (e) => {
		lifecycle.uncaughtHandler(e);
		console.error(`[Designer] uncaught exception:`, e);
	});

	runAgent({
		port: JABR_PORTS.designer,
		card: DESIGNER_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Designer] dispatching design task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
