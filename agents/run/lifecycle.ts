import type {
	AgentCompletePayload,
	AgentErrorPayload,
	AgentStartPayload,
	DomainEventBus,
} from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";

/**
 * Wire agent lifecycle events into a RealtimePort and an optional DomainEventBus.
 *
 * Registers the following on the current process:
 *  - uncaughtException → agent:error (via returned uncaughtHandler)
 *  - unhandledRejection → agent:error
 *
 * Note: SIGINT/SIGTERM are NOT registered here. Callers that construct an
 * A2AServer must register their own signal handlers and invoke
 * `server.shutdown()` to drain in-flight work before exiting. This avoids
 * a race where `process.exit(0)` in a generic signal handler would terminate
 * the process before the async drain completes.
 *
 * Returns:
 *  - announceOnline(): call after the server is listening.
 *  - announceOffline(): call before process exit (emits agent:offline + onAgentComplete).
 *  - uncaughtHandler: pass to your own process.on("uncaughtException") so you
 *    can add per-agent logging around it.
 *  - cleanup(): removes the unhandledRejection listener and is meant for test
 *    teardown.
 *
 * Usage (e.g. in agents/run/oracle.ts):
 *   const lifecycle = initLifecycle(realtime, "oracle", 4001, bus);
 *   lifecycle.announceOnline();
 *   process.on("uncaughtException", (e) => { lifecycle.uncaughtHandler(e); ... });
 *   // SIGINT / SIGTERM are wired by the caller (see serve.ts for the pattern).
 */
export function initLifecycle(
	realtime: RealtimePort,
	agentName: string,
	port?: number,
	bus?: DomainEventBus,
): {
	announceOnline: () => void;
	announceOffline: () => void;
	uncaughtHandler: (e: unknown) => void;
	cleanup: () => void;
} {
	const agentId = crypto.randomUUID();
	const provider = "unknown";
	const model = "unknown";
	const startedAt = new Date().toISOString();

	const announceOnline = () => {
		// Wire-level event
		realtime.broadcast({
			type: "agent:online",
			agent: agentName,
			...(port !== undefined ? { port } : {}),
		});

		// Plugin bus event
		if (bus) {
			const payload: AgentStartPayload = {
				agentId,
				agentName,
				provider,
				model,
				startedAt,
				metadata: port !== undefined ? { port } : undefined,
			};
			bus.emit("onAgentStart", payload);
		}
	};

	const announceOffline = () => {
		// Wire-level event
		realtime.broadcast({ type: "agent:offline", agent: agentName });

		// Plugin bus event
		if (bus) {
			const completedAt = new Date().toISOString();
			const payload: AgentCompletePayload = {
				agentId,
				agentName,
				provider,
				model,
				startedAt,
				completedAt,
				durationMs: Date.now() - new Date(startedAt).getTime(),
			};
			bus.emit("onAgentComplete", payload);
		}
	};

	const uncaughtHandler = (e: unknown) => {
		// Wire-level event
		realtime.broadcast({
			type: "agent:error",
			agent: agentName,
			error: String(e),
		});

		// Plugin bus event
		if (bus) {
			const erroredAt = new Date().toISOString();
			const payload: AgentErrorPayload = {
				agentId,
				agentName,
				provider,
				model,
				erroredAt,
				error: sanitizeError(e),
				recoverable: isRecoverable(e),
			};
			bus.emit("onAgentError", payload);
		}
	};

	const onUnhandledRejection = (reason: unknown) => {
		uncaughtHandler(reason);
	};

	process.on("unhandledRejection", onUnhandledRejection);

	const cleanup = () => {
		process.off("unhandledRejection", onUnhandledRejection);
	};

	return { announceOnline, announceOffline, uncaughtHandler, cleanup };
}

function sanitizeError(err: unknown): AgentErrorPayload["error"] {
	if (err instanceof Error) {
		return {
			message: err.message,
			code: (err as any).code ?? undefined,
			stack: err.stack ?? undefined,
		};
	}
	if (typeof err === "object" && err !== null) {
		return {
			message: String((err as any).message ?? err),
			code: (err as any).code ?? undefined,
			stack: (err as any).stack ?? undefined,
		};
	}
	return { message: String(err) };
}

function isRecoverable(err: unknown): boolean {
	if (err instanceof Error) {
		const name = err.name;
		return name === "AbortError" || name === "TimeoutError";
	}
	return false;
}

/**
 * Bridge RealtimePort wire events to the PluginEventBus.
 *
 * Projects transport-layer events (colon-separated) onto the canonical
 * plugin bus (on-prefixed camelCase). This is the single integration point
 * for the two naming conventions documented in ADR-001.
 */
export function bridgeRealtimeToPlugin(
	realtime: RealtimePort,
	bus: DomainEventBus,
): void {
	realtime.on("agent:online", (e) => {
		bus.emit("onAgentStart", {
			agentId: e.agent,
			agentName: e.agent,
			provider: "unknown",
			model: "unknown",
			startedAt: new Date().toISOString(),
			...(e.port !== undefined ? { metadata: { port: e.port } } : {}),
		});
	});

	realtime.on("agent:error", (e) => {
		bus.emit("onAgentError", {
			agentId: e.agent,
			agentName: e.agent,
			provider: "unknown",
			model: "unknown",
			erroredAt: new Date().toISOString(),
			error: { message: e.error },
			recoverable: true,
		});
	});

	realtime.on("task:created", (e) => {
		bus.emit("onTaskStart", {
			taskId: e.taskId,
			title: "",
			assignee: e.agent,
			priority: 0,
			startedAt: new Date().toISOString(),
		});
	});

	realtime.on("task:completed", (e) => {
		const now = new Date().toISOString();
		bus.emit("onTaskComplete", {
			taskId: e.taskId,
			title: "",
			assignee: "",
			priority: 0,
			startedAt: now,
			completedAt: now,
			durationMs: 0,
			summary: typeof e.result === "string" ? e.result : undefined,
		});
	});

	realtime.on("task:failed", (e) => {
		const now = new Date().toISOString();
		bus.emit("onTaskFailed", {
			taskId: e.taskId,
			title: "",
			assignee: "",
			priority: 0,
			startedAt: now,
			failedAt: now,
			durationMs: 0,
			error: { message: e.error },
			retryable: false,
			retryCount: 0,
		});
	});
}
