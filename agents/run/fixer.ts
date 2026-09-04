import { HeadroomAdapter } from "@adapters/headroom";
import { createLlmAdapter } from "@adapters/llm/factory";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { FIXER_CARD, FixerAgent } from "@core/fixer";
import { JABR_PORTS } from "@constants/ecosystem";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
import { extractLastResponse, runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const budget = new HeadroomAdapter();
	const llm = createLlmAdapter(budget);
	const agent = new FixerAgent(taskStore, new SkillFS("skills"), llm);

	const realtime = createRealtimePort("Fixer");

	const lifecycle = initLifecycle(realtime, "fixer", JABR_PORTS.fixer);
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
		port: JABR_PORTS.fixer,
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
