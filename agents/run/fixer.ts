import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter";
import { HeadroomAdapter } from "@adapters/headroom";
import { createLlmAdapter } from "@adapters/llm/factory";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { FIXER_CARD, FixerAgent } from "@core/fixer";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { initLifecycle } from "./lifecycle.ts";
import { extractLastResponse, runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const budget = new HeadroomAdapter();
	const llm = createLlmAdapter(budget);
	const agent = new FixerAgent(taskStore, new SkillFS("skills"), llm);

	const realtimePort = Number(process.env.JABR_REALTIME_PORT);
	let realtime: RealtimePort;
	if (!isNaN(realtimePort) && realtimePort > 0) {
		realtime = {
			broadcast: (event) =>
				fetch(`http://localhost:${realtimePort}/emit`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(event),
				}).catch((e) => console.warn(`[Fixer] realtime emit failed: ${e}`)),
			emitTo: () => {},
			on: () => {},
			getConnectionCount: () => 0,
		};
	} else {
		realtime = startBunWebSocketAdapter({ port: 4008 });
	}

	const lifecycle = initLifecycle(realtime, "fixer", 4005);
	lifecycle.announceOnline();

	process.on("SIGTERM", () => {
		lifecycle.announceOffline();
		process.exit(0);
	});
	process.on("uncaughtException", (e) => {
		lifecycle.uncaughtHandler(e);
		console.error(`[Fixer] uncaught exception:`, e);
	});

	runAgent({
		port: 4005,
		card: FIXER_CARD,
		execute: (taskId, text) =>
			agent.execute(taskId, text).catch((e) => {
				console.error(`[Run:Fixer] task ${taskId} execution failed: ${e}`);
				throw e;
			}),
		taskStore,
		formatResult: (ts, taskId) => {
			const text = extractLastResponse(ts, taskId);
			const task = ts.get(taskId);
			const artifact = task?.artifacts[0];
			if (artifact) {
				const artText = artifact.parts.find((p) => p.kind === "text")?.text;
				return artText
					? `${text}\n\n**Artifact** (\`${artifact.name}\`):\n\`\`\`\n${artText}\n\`\`\``
					: text;
			}
			return text;
		},
	});
}
