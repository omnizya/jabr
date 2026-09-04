import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { VERIFICATION_CARD, VerificationAgent } from "@core/verification";
import { JABR_PORTS } from "@constants/ecosystem";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const agent = new VerificationAgent(taskStore, new SkillFS("skills"));

	const realtime = createRealtimePort("Verification");

	const lifecycle = initLifecycle(realtime, "verification", JABR_PORTS.verification);
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
		port: JABR_PORTS.verification,
		card: VERIFICATION_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Verification] dispatching verification task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
