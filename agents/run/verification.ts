import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { VERIFICATION_CARD, VerificationAgent } from "@core/verification";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const agent = new VerificationAgent(taskStore, new SkillFS("skills"));

	const realtimePort = Number(process.env.JABR_REALTIME_PORT);
	let realtime: RealtimePort;
	if (!isNaN(realtimePort) && realtimePort > 0) {
		realtime = {
			broadcast: (event) =>
				fetch(`http://localhost:${realtimePort}/emit`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(event),
				}).catch((e) =>
					console.warn(`[Verification] realtime emit failed: ${e}`),
				),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
	} else {
		realtime = startBunWebSocketAdapter({ port: 4008 });
	}

	const lifecycle = initLifecycle(realtime, "verification", 4009);
	lifecycle.announceOnline();

	process.on("SIGTERM", () => {
		lifecycle.announceOffline();
		process.exit(0);
	});
	process.on("uncaughtException", (e) => {
		lifecycle.uncaughtHandler(e);
		console.error(`[Verification] uncaught exception:`, e);
	});

	runAgent({
		port: 4009,
		card: VERIFICATION_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Verification] dispatching verification task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
