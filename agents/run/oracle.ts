import { HeadroomAdapter } from "@adapters/headroom";
import { createLlmAdapter } from "@adapters/llm/factory";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { ORACLE_CARD, OracleAgent } from "@core/oracle";
import { JABR_PORTS } from "@constants/ecosystem";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
	const taskStore = new TaskMemory();
	const budget = new HeadroomAdapter();
	const llm = createLlmAdapter(budget);
	const agent = new OracleAgent(taskStore, new SkillFS("skills"), llm);

	// --- Real-time event transport (shared with orchestrator) ---
	// The orchestrator starts the adapter on port 4008; this runner connects
	// to it by reading JABR_REALTIME_URL (set by jabr-cli when launching
	// parallel agents) and using the shared adapter instance pattern is NOT
	// possible across processes — so each runner starts its own adapter.
	//
	// To avoid port conflicts, runners only start the adapter when the env var
	// is unset and this is the primary orchestrator-like entry point. For
	// simplicity, we follow the same pattern as the orchestrator: start a
	// local adapter and emit lifecycle events through it. Dashboards subscribe
	// to the orchestrator's adapter; agent runners emit via HTTP POST to it.
	//
	// The cleanest cross-process approach: start the adapter here too, and let
	// the orchestrator's adapter be the primary transport. But to keep things
	// simple and avoid duplicate adapters, we rely on JABR_REALTIME_PORT from
	// the orchestrator. When set, we skip starting a second adapter and instead
	// emit via HTTP to the orchestrator's /emit endpoint.
	const realtime = createRealtimePort("Oracle");

	const lifecycle = initLifecycle(realtime, "oracle", JABR_PORTS.oracle);
	lifecycle.announceOnline();

	process.on("SIGTERM", () => {
		lifecycle.announceOffline();
		process.exit(0);
	});
	process.on("uncaughtException", (e) => {
		lifecycle.uncaughtHandler(e);
		console.error(`[Oracle] uncaught exception:`, e);
	});

	runAgent({
		port: JABR_PORTS.oracle,
		card: ORACLE_CARD,
		execute: (taskId, text) => {
			console.log(`[Run:Oracle] dispatching task ${taskId}`);
			return agent.execute(taskId, text);
		},
		taskStore,
	});
}
