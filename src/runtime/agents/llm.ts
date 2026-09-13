import { A2AServer } from "@adapters/http/a2a-server";
import { createLlmAdapter } from "@adapters/llm/factory";
import type {
	ResolvedCaller,
	TaskState,
	TaskStreamingEvent,
} from "@agents/types";
import { JABR_PORTS } from "@constants/ecosystem";
import { LlmAgent } from "../../core/llm-agent.ts";
import { ApiKeyRegistry } from "../../security/api-key-registry.ts";
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

// Build API key registry from A2A_API_KEYS or legacy A2A_AUTH_TOKEN.
let apiKeyRegistry: ApiKeyRegistry | undefined;
const keysJson = process.env.A2A_API_KEYS;
if (keysJson) {
	try {
		const entries = JSON.parse(keysJson);
		apiKeyRegistry = new ApiKeyRegistry(entries);
		console.log(
			`[Run:LLM Agent] loaded ${entries.length} API key(s) from A2A_API_KEYS`,
		);
	} catch (e) {
		console.error(`[Run:LLM Agent] failed to parse A2A_API_KEYS: ${e}`);
		process.exit(1);
	}
}
// Inject legacy A2A_AUTH_TOKEN into existing registry so orchestrator can authenticate
const legacyToken = process.env.A2A_AUTH_TOKEN;
if (legacyToken && apiKeyRegistry) {
	apiKeyRegistry.addKey({
		key: legacyToken,
		description: "legacy-shared-token",
		allowedAgents: [],
		enabled: true,
	});
	console.log(
		`[Run:LLM Agent] injected legacy A2A_AUTH_TOKEN into key registry`,
	);
}
if (!apiKeyRegistry && legacyToken) {
	apiKeyRegistry = new ApiKeyRegistry([
		{
			key: legacyToken,
			description: "legacy-shared-token",
			allowedAgents: [],
			enabled: true,
		},
	]);
}
const requireAuth =
	Boolean(apiKeyRegistry) || process.env.A2A_REQUIRE_AUTH === "true";

const server = new A2AServer({
	port,
	card: agent.card,
	apiKeyRegistry,
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
