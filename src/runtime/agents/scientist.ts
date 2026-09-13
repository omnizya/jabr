import { A2AServer } from "@adapters/http/a2a-server";
import { McpClientAdapter } from "@adapters/mcp/mcp-client";
import { JABR_PORTS } from "@constants/ecosystem";
import { ScientistAgent } from "../../core/scientist.ts";
import { ApiKeyRegistry } from "../../security/api-key-registry.ts";
import { initLifecycle } from "../lifecycle.ts";
import { createRealtimePort } from "../realtime.ts";

const port = JABR_PORTS.scientist;
const mcpClient = new McpClientAdapter();
const scientist = new ScientistAgent(mcpClient);

const realtime = createRealtimePort("Scientist");

const lifecycle = initLifecycle(realtime, "scientist", JABR_PORTS.scientist);
lifecycle.announceOnline();

// Build API key registry from A2A_API_KEYS or legacy A2A_AUTH_TOKEN.
let apiKeyRegistry: ApiKeyRegistry | undefined;
const keysJson = process.env.A2A_API_KEYS;
if (keysJson) {
	try {
		const entries = JSON.parse(keysJson);
		apiKeyRegistry = new ApiKeyRegistry(entries);
		console.log(
			`[Run:Scientist] loaded ${entries.length} API key(s) from A2A_API_KEYS`,
		);
	} catch (e) {
		console.error(`[Run:Scientist] failed to parse A2A_API_KEYS: ${e}`);
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
		`[Run:Scientist] injected legacy A2A_AUTH_TOKEN into key registry`,
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
	card: scientist.card,
	apiKeyRegistry,
	requireAuth,
	enableOAuth: true,
	async onTask(message: string): Promise<string> {
		const taskId = crypto.randomUUID();
		console.log(`[Run:Scientist] received task ${taskId}`);
		const result = await scientist.execute(taskId, message);
		return result;
	},
});

server.start();

process.on("SIGTERM", () => {
	console.log("[Scientist] received SIGTERM, shutting down...");
	server.shutdown().then(() => {
		lifecycle.announceOffline();
		process.exit(0);
	});
});
process.on("SIGINT", () => {
	console.log("[Scientist] received SIGINT, shutting down...");
	server.shutdown().then(() => {
		lifecycle.announceOffline();
		process.exit(0);
	});
});
process.on("uncaughtException", (e) => {
	lifecycle.uncaughtHandler(e);
	console.error(`[Scientist] uncaught exception:`, e);
});
