import { A2AServer } from "@adapters/http/a2a-server";
import { TaskMemory } from "@adapters/task-memory";
import type { AgentCard, TaskStreamingEvent } from "@agents/types";
import { jabrUrlForPort } from "@config/jabr-config";
import type { TaskStorePort } from "@ports/task-store";

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

	const authToken = process.env.A2A_AUTH_TOKEN ?? undefined;
	const requireAuth =
		Boolean(authToken) || process.env.A2A_REQUIRE_AUTH === "true";

	if (requireAuth && !authToken) {
		console.warn(
			`[Serve] ${config.card.name}: A2A_REQUIRE_AUTH=true but no A2A_AUTH_TOKEN set — auth will reject all requests`,
		);
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
