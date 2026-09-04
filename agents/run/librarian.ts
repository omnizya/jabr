import { createLlmAdapter } from "@adapters/llm/factory";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { Search9Router } from "@adapters/search-9router";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { LIBRARIAN_CARD, LibrarianAgent } from "@core/librarian";
import { JABR_PORTS } from "@constants/ecosystem";
import type { LlmPort } from "@ports/llm-port";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
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

	const realtime = createRealtimePort("Librarian");

	const lifecycle = initLifecycle(realtime, "librarian", JABR_PORTS.librarian);
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
		port: JABR_PORTS.librarian,
		card: LIBRARIAN_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Librarian] dispatching task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
