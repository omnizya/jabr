import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import type { AgentCard, TaskStreamingEvent } from "@agents/types";
import { jabrUrlForPort } from "@config/jabr-config";
import type { TaskStorePort } from "@ports/task-store";
import { ApiKeyRegistry } from "@security/api-key-registry";

export function extractLastResponse(
	taskStore: TaskStorePort,
	taskId: string,
): string {
	const task = taskStore.get(taskId);
	const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
	return lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response";
}

export function runAgent(config: {
	port: number;
	card: AgentCard;
	execute: (taskId: string, text: string) => Promise<void>;
	taskStore?: TaskStorePort;
	formatResult?: (taskStore: TaskStorePort, taskId: string) => string;
	/**
	 * Optional streaming handler for `tasks/sendSubscribe`. Receives the user
	 * text, a fresh taskId, and an emit() callback for SSE events. When set,
	 * the server advertises `capabilities.streaming: true` on its AgentCard.
	 */
	onTaskStreaming?: (
		message: string,
		taskId: string,
		emit: (event: TaskStreamingEvent) => void,
	) => Promise<string>;
}) {
	const taskStore = config.taskStore ?? new TaskMemory();
	const format = config.formatResult ?? extractLastResponse;

	console.log(
		`[Serve] starting ${config.card.name} server on port ${config.port}`,
	);

	// --- API key registry (per-key authentication + ACL) ---
	// Loads keys from JSON env var A2A_API_KEYS. Each entry is:
	//   { key: string, description: string, allowedAgents: string[], enabled?: boolean }
	// Empty allowedAgents = wildcard (all agents).
	let apiKeyRegistry: ApiKeyRegistry | undefined;
	const keysJson = process.env.A2A_API_KEYS;
	if (keysJson) {
		try {
			const entries = JSON.parse(keysJson);
			apiKeyRegistry = new ApiKeyRegistry(entries);
			console.log(
				`[Serve] ${config.card.name}: loaded ${entries.length} API key(s) from A2A_API_KEYS`,
			);
		} catch (e) {
			console.error(
				`[Serve] ${config.card.name}: failed to parse A2A_API_KEYS: ${e}`,
			);
			process.exit(1);
		}
	}

	// Auth is mandatory at the agent boundary. Refuse to start
	// without a configured registry or legacy token so the endpoint is never
	// accidentally exposed without authentication.
	const requireAuth = true;
	const legacyToken = process.env.A2A_AUTH_TOKEN;
	if (!apiKeyRegistry && !legacyToken) {
		console.error(
			`Fatal: A2A_API_KEYS or A2A_AUTH_TOKEN environment variable is required to start ${config.card.name}`,
		);
		process.exit(1);
	}

	// Legacy single-token mode: build a registry with one wildcard key.
	if (!apiKeyRegistry && legacyToken) {
		console.warn(
			`[Serve] ${config.card.name}: using legacy A2A_AUTH_TOKEN (single shared token, consider migrating to A2A_API_KEYS)`,
		);
		apiKeyRegistry = new ApiKeyRegistry([
			{ key: legacyToken, description: "legacy", allowedAgents: [], enabled: true },
		]);
	}

	const server = new A2AServer({
		port: config.port,
		card: {
			...config.card,
			url: jabrUrlForPort(config.port),
			capabilities: {
				...config.card.capabilities,
				streaming: Boolean(config.onTaskStreaming),
			},
		},
		onTask: async (text: string): Promise<string> => {
			const taskId = crypto.randomUUID();
			console.log(`[Serve] received task ${taskId} for ${config.card.name}`);
			taskStore.create(taskId);
			await config.execute(taskId, text);
			return format(taskStore, taskId);
		},
		onTaskStreaming: config.onTaskStreaming,
		requireAuth,
		apiKeyRegistry,
	});

	server.start();

	// Wire graceful shutdown for SIGINT/SIGTERM.
	const onSignal = () => {
		console.log(
			`[Serve] received signal, shutting down ${config.card.name}...`,
		);
		server.shutdown().then(() => {
			console.log(`[Serve] ${config.card.name} shut down gracefully`);
			process.exit(0);
		});
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
}
