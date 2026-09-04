import { HeadroomAdapter } from "@adapters/headroom";
import { HermesKanbanAdapter } from "@adapters/hermes-kanban";
import { A2AServer } from "@adapters/http/a2a-server";
import { createLlmAdapter } from "@adapters/llm/factory";
import { McpClientAdapter } from "@adapters/mcp-client";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { Search9Router } from "@adapters/search-9router";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { jabrUrl, jabrUrlForPort } from "@config/jabr-config";
import { JARVIS_CARD, JarvisAgent } from "@core/jarvis";
import { JABR_PORTS } from "@constants/ecosystem";
import { initLifecycle } from "./lifecycle.ts";
import { createRealtimePort } from "./realtime.ts";
import { extractLastResponse } from "./serve.ts";

if (import.meta.main) {
	const port = JABR_PORTS.jarvis;
	const budget = new HeadroomAdapter();
	const llm = createLlmAdapter(budget);
	const search = new Search9Router();
	const mcp = new McpClientAdapter();
	const skills = new SkillFS("skills");
	const palace = new MemPalaceAdapter();
	const kanban = new HermesKanbanAdapter(process.env.HERMES_KANBAN_BOARD);
	const taskStore = new TaskMemory();

	const agentEndpoint = jabrUrl();

	const jarvis = new JarvisAgent(
		taskStore,
		llm,
		search,
		mcp,
		skills,
		palace,
		budget,
		kanban,
		agentEndpoint,
	);

	const realtime = createRealtimePort("Jarvis");

	const lifecycle = initLifecycle(realtime, "jarvis", JABR_PORTS.jarvis);
	lifecycle.announceOnline();
	process.on("uncaughtException", (e) => {
		lifecycle.uncaughtHandler(e);
		console.error(`[Jarvis] uncaught exception:`, e);
	});

	const server = new A2AServer({
		port,
		card: { ...JARVIS_CARD, url: jabrUrlForPort(port) },
		async onTask(text: string): Promise<string> {
			const taskId = crypto.randomUUID();
			console.log(`[Run:Jarvis] received task ${taskId}`);
			taskStore.create(taskId);
			await jarvis.execute(taskId, text);
			return extractLastResponse(taskStore, taskId);
		},
	});

	server.start();

	const shutdown = () => {
		console.log("[Jarvis] received signal, shutting down...");
		server.shutdown().then(() => {
			lifecycle.announceOffline();
			process.exit(0);
		});
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
