import { jabrUrlForPort } from "@config/jabr-config";
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import { PollinationsImageAdapter } from "@adapters/pollinations-image";
import { TaskMemory } from "@adapters/task-memory";
import { DESIGNER_CARD, DesignerAgent } from "@core/designer";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const apiKey = process.env.POLLINATIONS_API_KEY ?? "";
	const imageGen = apiKey
		? new PollinationsImageAdapter({ apiKey })
		: undefined;
	const agent = new DesignerAgent(taskStore, imageGen);

	const realtimePort = Number(process.env.JABR_REALTIME_PORT);
	let realtime: RealtimePort;
	if (!isNaN(realtimePort) && realtimePort > 0) {
		realtime = {
			broadcast: (event) =>
				fetch(`${jabrUrlForPort(realtimePort)}/emit`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(event),
				}).catch((e) => console.warn(`[Designer] realtime emit failed: ${e}`)),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
	} else {
		realtime = startBunWebSocketAdapter({ port: 4008 });
	}

	const lifecycle = initLifecycle(realtime, "designer", 4004);
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
		port: 4004,
		card: DESIGNER_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Designer] dispatching design task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
