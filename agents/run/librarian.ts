import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import { createLlmAdapter } from "@adapters/llm/factory";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { Search9Router } from "@adapters/search-9router";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { LIBRARIAN_CARD, LibrarianAgent } from "@core/librarian";
import type { LlmPort } from "@ports/llm-port";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";
import { runAgent } from "./serve.ts";

function shouldWireLlm(): boolean {
	return !!(process.env.NINEROUTER_URL || process.env.NINEROUTER_MODEL);
}

function createLlm(): LlmPort {
	return createLlmAdapter();
}

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const palace = new MemPalaceAdapter();
	const agent = new LibrarianAgent(
		taskStore,
		new SkillFS("skills"),
		new Search9Router(),
		palace,
	);

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
		lifecycle.announceOffline();
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
