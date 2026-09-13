import { A2AServer } from "@adapters/http/a2a-server";
import { createLlmAdapter } from "@adapters/llm/factory";
import type {
	ResolvedCaller,
	TaskState,
	TaskStreamingEvent,
} from "@agents/types";
import { JABR_PORTS } from "@constants/ecosystem";
import { LlmAgent } from "../../core/llm-agent.ts";
import { initLifecycle } from "../lifecycle.ts";
import { createRealtimePort } from "../realtime.ts";

const port = JABR_PORTS.llm;
const llm = createLlmAdapter();
const agent = new LlmAgent(
	{
		name: "LLM Agent",
		description:
			"Generic LLM-backed A2A agent wrapping the LlmPort for v1.0 protocol",
		version: "1.0.0",
		port,
	},
	llm,
);

const realtime = createRealtimePort("LLM Agent");

const lifecycle = initLifecycle(realtime, "llm-agent", JABR_PORTS.llm);
lifecycle.announceOnline();

process.on("SIGTERM", () => {
	console.log("[LLM Agent] received SIGTERM, shutting down...");
	server.shutdown().then(() => {
		lifecycle.announceOffline();
		process.exit(0);
	});
});
process.on("SIGINT", () => {
	console.log("[LLM Agent] received SIGINT, shutting down...");
	server.shutdown().then(() => {
		lifecycle.announceOffline();
		process.exit(0);
	});
});
process.on("uncaughtException", (e) => {
	lifecycle.uncaughtHandler(e);
	console.error(`[LLM Agent] uncaught exception:`, e);
});

const authToken = process.env.A2A_AUTH_TOKEN ?? undefined;
const requireAuth =
	Boolean(authToken) || process.env.A2A_REQUIRE_AUTH === "true";

const server = new A2AServer({
	port,
	card: agent.card,
	requireAuth,
	enableOAuth: true,
	async onTask(message: string): Promise<string> {
		const taskId = crypto.randomUUID();
		console.log(`[Run:LLM Agent] received task ${taskId}`);
		const result = await agent.handleTask(message);
		return result;
	},
	async onTaskStreaming(
		message: string,
		taskId: string,
		emit: (event: TaskStreamingEvent) => void,
		_caller?: ResolvedCaller,
		_signal?: AbortSignal,
	): Promise<string> {
		console.log(`[Run:LLM Agent] streaming task ${taskId}`);
		const result = await agent.handleTaskStreaming(message, taskId, (event) => {
			if (event.type === "artifact") {
				emit({
					type: "artifact",
					taskId: event.taskId,
					artifact: event.artifact!,
				});
			} else {
				emit({
					type: "status",
					taskId: event.taskId,
					state: event.state as TaskState,
					message: event.message,
					timestamp: event.timestamp,
				});
			}
		});
		return result;
	},
});

server.start();
