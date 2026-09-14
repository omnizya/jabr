import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BunDynamicPluginLoaderAdapter } from "@adapters/plugin-loader";
import type { A2AMessage, A2APart } from "@agents/types";
import {
	createPluginRegistryUseCase,
	type PluginContextDeps,
} from "@core/plugin-registry";
import type {
	CreateTaskOpts,
	KanbanTask,
	KanbanTaskStatus,
} from "@ports/kanban-port";
import type { KnowledgeEntry } from "@ports/knowledge-port";
import type { SessionData } from "@ports/memory-store";
import type { IPlugin, PluginMetadata } from "@ports/plugin";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventMap } from "@ports/plugin-event-bus.types";
import { SystemAlertSeverity } from "@ports/plugin-event-bus.types";
import type { RealtimeEvent } from "@ports/realtime-port";
import type { Task } from "@ports/task-store";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const RUNTIME_PROOF_DIR = join(__dirname, "..", "fixtures", "runtime-proof");

// =============================================================================
// Test Helpers
// =============================================================================

function makeDeps(
	overrides: Partial<PluginContextDeps> = {},
): PluginContextDeps {
	const bus = new PluginEventBusImpl<DomainEventMap>();
	const logs: string[] = [];

	return {
		taskStore: {
			create: (taskId: string): Task => ({
				id: taskId,
				state: "submitted",
				messages: [],
				artifacts: [],
			}),
			get: (taskId: string): Task | undefined => undefined,
			updateState: (taskId: string, state: Task["state"]): void => {},
			appendMessage: (taskId: string, message: A2AMessage): void => {},
			appendArtifact: (
				taskId: string,
				artifact: { name: string; parts: A2APart[] },
			): void => {},
			listByState: (state: Task["state"]): Task[] => [],
			getTransitionHistory: (
				taskId: string,
			): Array<{
				from: Task["state"];
				to: Task["state"];
				timestamp: string;
			}> => [],
			list: () => [],
			subscribe: () => () => {},
			getRetryCount: (_taskId: string): number => 0,
			incrementRetryCount: (_taskId: string): void => {},
			moveToDLQ: (_taskId: string, _error: string): void => {},
			listDLQ: () => [],
			getDLQEntry: (_taskId: string) => undefined,
			retryFromDLQ: (_taskId: string): boolean => false,
			purgeDLQ: (_taskId: string): boolean => false,
			purgeAllDLQ: (): number => 0,
		},
		memoryStore: {
			read: (): string => "",
			append: (entry: string): void => {},
			listSessions: (): string[] => [],
			deleteSession: (id: string): boolean => false,
			getSession: (id: string): SessionData | null => null,
			saveSession: (id: string, data: SessionData): void => {},
		},
		agentRegistry: {
			fetchCard: async (baseUrl: string) => null,
			delegateTask: async (
				agentUrl: string,
				text: string,
				agentName?: string,
			) => "",
		},
		kanban: {
			createTask: async (
				title: string,
				opts?: CreateTaskOpts,
			): Promise<KanbanTask> => ({
				id: crypto.randomUUID(),
				title,
				body: opts?.body ?? null,
				assignee: opts?.assignee ?? null,
				status: "todo",
				priority: opts?.priority ?? 0,
				result: null,
				created_at: Date.now(),
			}),
			listTasks: async (status?: KanbanTaskStatus): Promise<KanbanTask[]> => [],
			getTask: async (taskId: string): Promise<KanbanTask | null> => null,
			updateStatus: async (
				taskId: string,
				status: KanbanTaskStatus,
			): Promise<void> => {},
			complete: async (taskId: string, result?: string): Promise<void> => {},
			comment: async (taskId: string, text: string): Promise<void> => {},
			block: async (taskId: string, reason: string): Promise<void> => {},
			unblock: async (taskId: string): Promise<void> => {},
		},
		knowledge: {
			store: async (
				slug: string,
				content: string,
				tags: string[],
				relations?: string[],
			): Promise<void> => {},
			query: async (
				text: string,
				topK?: number,
			): Promise<KnowledgeEntry[]> => [],
			relate: async (
				slugA: string,
				slugB: string,
				relation: string,
			): Promise<void> => {},
			get: async (slug: string): Promise<KnowledgeEntry | null> => null,
			list: async (): Promise<KnowledgeEntry[]> => [],
		},
		realtime: {
			broadcast: (event: RealtimeEvent): void => {},
			emitTo: (room: string, event: RealtimeEvent): void => {},
			on: <E extends RealtimeEvent["type"]>(
				eventType: E,
				handler: (payload: Extract<RealtimeEvent, { type: E }>) => void,
			): void => {},
			getConnectionCount: (): number => 0,
		},
		budget: {
			consume: async (
				agentName: string,
				approximateTokens: number,
			): Promise<void> => {},
			remaining: async (agentName: string): Promise<number> => 0,
			isExhausted: (agentName: string): boolean => false,
			reset: (): void => {},
			getUsage: (): Record<
				string,
				{ used: number; cap: number; pct: number }
			> => ({}),
		},
		eventBus: bus,
		logger: {
			info: (msg) => logs.push(`INFO: ${msg}`),
			warn: (msg) => logs.push(`WARN: ${msg}`),
			error: (msg) => logs.push(`ERROR: ${msg}`),
			debug: (msg) => logs.push(`DEBUG: ${msg}`),
		},
		...overrides,
	};
}

function createRuntimeProofPluginCode(): string {
	return `
import type { IPlugin, PluginMetadata } from "@ports/plugin";

const metadata: PluginMetadata = {
	name: "runtime-proof-plugin",
	version: "1.0.0",
	author: "Runtime Proof Test",
	description: "Plugin for runtime proof test - tracks lifecycle events",
	events: [
		"onAgentStart",
		"onTaskStart",
		"onTaskComplete",
		"onSystemAlert",
	],
	capabilities: [],
	tags: {
		category: "test",
		purpose: "runtime-proof",
	},
};

let initContext: any = null;
let receivedEvents: Array<{ name: string; payload: any }> = [];
let shutdownCalled = false;

const plugin: IPlugin = {
	metadata,
	async onInitialize(ctx) {
		initContext = {
			pluginName: ctx.pluginName,
			pluginVersion: ctx.pluginVersion,
			hasLogger: !!ctx.logger,
			hasEvents: !!ctx.events,
			hasTaskStore: !!ctx.taskStore,
			hasMemoryStore: !!ctx.memoryStore,
			hasAgentRegistry: !!ctx.agentRegistry,
			hasKanban: !!ctx.kanban,
			hasKnowledge: !!ctx.knowledge,
			hasRealtime: !!ctx.realtime,
			hasBudget: !!ctx.budget,
		};
		ctx.logger.info("Runtime proof plugin initialized");
	},
	async onEvent(event, payload) {
		receivedEvents.push({ name: event.name, payload });
		ctx.logger.debug?.(\`Received \${event.name}\`);
	},
	async onShutdown() {
		shutdownCalled = true;
	},
};

// Export getters for test verification
export function getInitContext() { return initContext; }
export function getReceivedEvents() { return receivedEvents; }
export function getShutdownCalled() { return shutdownCalled; }
export function reset() {
	initContext = null;
	receivedEvents = [];
	shutdownCalled = false;
}

export default plugin;
export function createPlugin() {
	return plugin;
}
`;
}

async function setupRuntimeProofFixture() {
	await rm(RUNTIME_PROOF_DIR, { recursive: true, force: true });
	await mkdir(RUNTIME_PROOF_DIR, { recursive: true });
	await mkdir(join(RUNTIME_PROOF_DIR, "runtime-proof-plugin"), {
		recursive: true,
	});
	await writeFile(
		join(RUNTIME_PROOF_DIR, "runtime-proof-plugin", "index.ts"),
		createRuntimeProofPluginCode(),
	);
}

async function cleanupRuntimeProofFixture() {
	await rm(RUNTIME_PROOF_DIR, { recursive: true, force: true });
}

// =============================================================================
// Runtime Proof Test
// =============================================================================

describe("Runtime Proof: Full Plugin Lifecycle", () => {
	let deps: PluginContextDeps;
	let loader: BunDynamicPluginLoaderAdapter;

	beforeEach(async () => {
		await setupRuntimeProofFixture();
		deps = makeDeps();
		loader = new BunDynamicPluginLoaderAdapter(deps, {
			pluginsDir: RUNTIME_PROOF_DIR,
		});
	});

	afterEach(async () => {
		await loader.shutdownAll();
		await cleanupRuntimeProofFixture();
	});

	test("full lifecycle: discover → validate → load → initialize → event → shutdown", async () => {
		// 1. DISCOVER & LOAD: Scan directory and load plugin
		const loadResult = await loader.loadAll();

		expect(loadResult.plugins.length).toBe(1);
		const pluginInfo = loadResult.plugins[0]!;
		expect(pluginInfo.name).toBe("runtime-proof-plugin");
		expect(pluginInfo.version).toBe("1.0.0");
		expect(pluginInfo.state).toBe("loaded");
		expect(pluginInfo.error).toBeUndefined();

		console.log("✓ DISCOVER & LOAD: Plugin discovered and loaded");

		// 2. INITIALIZE: Initialize all loaded plugins
		await loader.initializeAll();

		const registry = loader.getRegistry();
		const entry = registry.get("runtime-proof-plugin");
		expect(entry).toBeDefined();
		expect(entry?.state).toBe("Running");
		expect(entry?.subscriptions.length).toBe(4); // 4 declared events

		console.log("✓ INITIALIZE: Plugin initialized and subscribed to 4 events");

		// 3. EVENT: Emit domain events and verify plugin receives them
		const bus = loader.getEventBus();

		// Emit onAgentStart
		bus.emit("onAgentStart", {
			agentId: "agent-123",
			agentName: "test-agent",
			provider: "test-provider",
			model: "test-model",
			startedAt: new Date().toISOString(),
		});

		// Emit onTaskStart
		bus.emit("onTaskStart", {
			taskId: "task-456",
			title: "Test Task",
			assignee: "test-agent",
			priority: 1,
			startedAt: new Date().toISOString(),
		});

		// Emit onTaskComplete
		bus.emit("onTaskComplete", {
			taskId: "task-456",
			title: "Test Task",
			assignee: "test-agent",
			priority: 1,
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			durationMs: 100,
			summary: "Task completed successfully",
		});

		// Emit onSystemAlert
		bus.emit("onSystemAlert", {
			alertId: "alert-789",
			severity: SystemAlertSeverity.WARNING,
			title: "High Memory Usage",
			message: "Memory usage exceeded 80%",
			source: "monitor",
			raisedAt: new Date().toISOString(),
		});

		// Give async handlers time to process
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Verify plugin received events by checking the registry entry's subscriptions
		// The plugin's onEvent was called for each emitted event
		const updatedEntry = registry.get("runtime-proof-plugin");
		expect(updatedEntry?.state).toBe("Running");

		console.log("✓ EVENT: Domain events emitted and delivered to plugin");

		// 4. SHUTDOWN: Gracefully shutdown the plugin
		await loader.shutdownAll();

		const finalEntry = registry.get("runtime-proof-plugin");
		expect(finalEntry?.state).toBe("Shutdown");
		expect(finalEntry?.subscriptions.length).toBe(0);

		console.log("✓ SHUTDOWN: Plugin shut down cleanly, subscriptions cleared");

		// 5. Verify the plugin's internal state via dynamic import
		const pluginModule = await import(
			`${RUNTIME_PROOF_DIR}/runtime-proof-plugin/index.ts`
		);
		const initContext = pluginModule.getInitContext();
		const receivedEvents = pluginModule.getReceivedEvents();
		const shutdownCalled = pluginModule.getShutdownCalled();

		expect(initContext).not.toBeNull();
		expect(initContext.pluginName).toBe("runtime-proof-plugin");
		expect(initContext.pluginVersion).toBe("1.0.0");
		expect(initContext.hasLogger).toBe(true);
		expect(initContext.hasEvents).toBe(true);
		expect(initContext.hasTaskStore).toBe(true);
		expect(initContext.hasMemoryStore).toBe(true);
		expect(initContext.hasAgentRegistry).toBe(true);
		expect(initContext.hasKanban).toBe(true);
		expect(initContext.hasKnowledge).toBe(true);
		expect(initContext.hasRealtime).toBe(true);
		expect(initContext.hasBudget).toBe(true);

		expect(receivedEvents.length).toBe(4);
		expect(receivedEvents.map((e: { name: string }) => e.name)).toEqual([
			"onAgentStart",
			"onTaskStart",
			"onTaskComplete",
			"onSystemAlert",
		]);

		expect(shutdownCalled).toBe(true);

		console.log(
			"✓ VERIFICATION: Plugin internal state confirms full lifecycle",
		);
		console.log("  - Init context:", JSON.stringify(initContext, null, 2));
		console.log("  - Received events:", receivedEvents.length);
		console.log("  - Shutdown called:", shutdownCalled);

		console.log("\n🎉 RUNTIME PROOF PASSED: Full plugin lifecycle verified!");
	});

	test("real plugins/ directory: analytics-plugin and notification-plugin load correctly", async () => {
		// Test with the actual plugins/ directory at repo root
		const realPluginsDir = join(__dirname, "..", "plugins");
		const realLoader = new BunDynamicPluginLoaderAdapter(deps, {
			pluginsDir: realPluginsDir,
		});

		const loadResult = await realLoader.loadAll();

		// Should find both analytics-plugin and notification-plugin
		const loaded = loadResult.plugins.filter((p) => p.state === "loaded");
		const names = loaded.map((p) => p.name).sort();

		expect(names).toContain("analytics-plugin");
		expect(names).toContain("notification-plugin");

		await realLoader.initializeAll();

		const registry = realLoader.getRegistry();
		const analyticsEntry = registry.get("analytics-plugin");
		const notificationEntry = registry.get("notification-plugin");

		expect(analyticsEntry?.state).toBe("Running");
		expect(notificationEntry?.state).toBe("Running");

		// Emit a task failed event - notification plugin should handle it
		const bus = realLoader.getEventBus();
		bus.emit("onTaskFailed", {
			taskId: "task-fail-1",
			title: "Failing Task",
			assignee: "test-agent",
			priority: 1,
			startedAt: new Date().toISOString(),
			failedAt: new Date().toISOString(),
			durationMs: 50,
			error: { message: "Connection timeout", code: "ETIMEDOUT" },
			retryable: true,
			retryCount: 0,
		});

		bus.emit("onSystemAlert", {
			alertId: "alert-1",
			severity: SystemAlertSeverity.CRITICAL,
			title: "Disk Full",
			message: "No space left on device",
			source: "disk-monitor",
			raisedAt: new Date().toISOString(),
		});

		await new Promise((r) => setTimeout(r, 50));

		await realLoader.shutdownAll();

		const finalAnalytics = registry.get("analytics-plugin");
		const finalNotification = registry.get("notification-plugin");

		expect(finalAnalytics?.state).toBe("Shutdown");
		expect(finalNotification?.state).toBe("Shutdown");

		console.log(
			"✓ REAL PLUGINS: analytics-plugin and notification-plugin work correctly",
		);
	});
});
