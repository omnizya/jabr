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
import type { RealtimeEvent } from "@ports/realtime-port";
import type { Task } from "@ports/task-store";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TEST_PLUGINS_DIR = join(__dirname, "..", "fixtures", "test-plugins");

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

function createValidPluginCode(
	name: string,
	version: string,
	events: string[] = [],
): string {
	return `
import type { IPlugin, PluginMetadata } from "@ports/plugin";

const metadata: PluginMetadata = {
	name: "${name}",
	version: "${version}",
	author: "Test Author",
	description: "Test plugin for ${name}",
	events: ${JSON.stringify(events)},
};

const plugin: IPlugin = {
	metadata,
	async onInitialize(ctx) {
		ctx.logger.info("Initialized");
	},
	async onEvent(event, payload) {
		ctx.logger.debug?.(\`Received \${event.name}\`);
	},
	async onShutdown() {
		ctx.logger.info("Shutting down");
	},
};

export default plugin;
export function createPlugin() {
	return plugin;
}
`;
}

function createInvalidPluginCode(): string {
	return `
// Missing required exports
export const something = "else";
`;
}

function createFactoryOnlyPluginCode(name: string, version: string): string {
	return `
import type { IPlugin, PluginMetadata } from "@ports/plugin";

const metadata: PluginMetadata = {
	name: "${name}",
	version: "${version}",
	author: "Test Author",
	description: "Factory-only plugin",
	events: [],
};

export function createPlugin(): IPlugin {
	return {
		metadata,
		async onInitialize(ctx) {},
		async onEvent(event, payload) {},
		async onShutdown() {},
	};
}
`;
}

async function setupTestPlugins() {
	await rm(TEST_PLUGINS_DIR, { recursive: true, force: true });
	await mkdir(TEST_PLUGINS_DIR, { recursive: true });

	// Valid plugin with factory export
	await mkdir(join(TEST_PLUGINS_DIR, "valid-factory"), { recursive: true });
	await writeFile(
		join(TEST_PLUGINS_DIR, "valid-factory", "index.ts"),
		createValidPluginCode("valid-factory", "1.0.0", ["onAgentStart"]),
	);

	// Valid plugin with default export
	await mkdir(join(TEST_PLUGINS_DIR, "valid-default"), { recursive: true });
	await writeFile(
		join(TEST_PLUGINS_DIR, "valid-default", "index.ts"),
		createValidPluginCode("valid-default", "2.0.0", ["onTaskStart"]),
	);

	// Plugin with multiple events
	await mkdir(join(TEST_PLUGINS_DIR, "multi-event"), { recursive: true });
	await writeFile(
		join(TEST_PLUGINS_DIR, "multi-event", "index.ts"),
		createValidPluginCode("multi-event", "1.0.0", [
			"onAgentStart",
			"onTaskComplete",
			"onSystemAlert",
		]),
	);

	// Invalid plugin (no valid export)
	await mkdir(join(TEST_PLUGINS_DIR, "invalid"), { recursive: true });
	await writeFile(
		join(TEST_PLUGINS_DIR, "invalid", "index.ts"),
		createInvalidPluginCode(),
	);

	// Factory-only plugin
	await mkdir(join(TEST_PLUGINS_DIR, "factory-only"), { recursive: true });
	await writeFile(
		join(TEST_PLUGINS_DIR, "factory-only", "index.ts"),
		createFactoryOnlyPluginCode("factory-only", "3.0.0"),
	);

	// Non-directory entry (should be skipped)
	await writeFile(join(TEST_PLUGINS_DIR, "not-a-plugin.txt"), "not a plugin");
}

async function cleanupTestPlugins() {
	await rm(TEST_PLUGINS_DIR, { recursive: true, force: true });
}

// =============================================================================
// Tests
// =============================================================================

describe("BunDynamicPluginLoaderAdapter", () => {
	let deps: PluginContextDeps;
	let loader: BunDynamicPluginLoaderAdapter;

	beforeEach(async () => {
		await setupTestPlugins();
		deps = makeDeps();
		loader = new BunDynamicPluginLoaderAdapter(deps, {
			pluginsDir: TEST_PLUGINS_DIR,
		});
	});

	afterEach(async () => {
		await loader.shutdownAll();
		await cleanupTestPlugins();
	});

	test("loadAll discovers and loads valid plugins", async () => {
		const result = await loader.loadAll();

		expect(result.plugins.length).toBeGreaterThanOrEqual(4); // 4 valid plugins + 1 invalid + 1 non-dir

		const loaded = result.plugins.filter((p) => p.state === "loaded");
		expect(loaded.length).toBe(4); // valid-factory, valid-default, multi-event, factory-only

		const names = loaded.map((p) => p.name).sort();
		expect(names).toEqual([
			"factory-only",
			"multi-event",
			"valid-default",
			"valid-factory",
		]);
	});

	test("loadAll reports errors for invalid plugins", async () => {
		const result = await loader.loadAll();

		const errors = result.plugins.filter((p) => p.state === "error");
		expect(errors.length).toBeGreaterThanOrEqual(1);

		const invalidPlugin = errors.find((p) => p.name === "invalid");
		expect(invalidPlugin).toBeDefined();
		expect(invalidPlugin?.error).toBeDefined();
	});

	test("loadAll reports errors for non-directory entries", async () => {
		const result = await loader.loadAll();

		const txtEntry = result.plugins.find((p) => p.name === "not-a-plugin.txt");
		expect(txtEntry).toBeDefined();
		expect(txtEntry?.state).toBe("error");
		expect(txtEntry?.error).toContain("Plugin must be a directory");
	});

	test("loadAll validates plugin metadata", async () => {
		const result = await loader.loadAll();

		for (const plugin of result.plugins) {
			if (plugin.state === "loaded") {
				expect(plugin.version).toBeDefined();
				expect(plugin.version).not.toBe("unknown");
			}
		}
	});

	test("initializeAll initializes all loaded plugins", async () => {
		await loader.loadAll();
		await loader.initializeAll();

		const registry = loader.getRegistry();
		const list = registry.list();

		for (const plugin of list) {
			if (plugin.name !== "invalid") {
				expect(plugin.state).toBe("Running");
			}
		}
	});

	test("loadPlugin loads a single plugin by name", async () => {
		const result = await loader.loadPlugin(
			"valid-factory",
			join(TEST_PLUGINS_DIR, "valid-factory"),
		);

		expect(result.state).toBe("loaded");
		expect(result.name).toBe("valid-factory");
		expect(result.version).toBe("1.0.0");
	});

	test("loadPlugin returns error for invalid plugin", async () => {
		const result = await loader.loadPlugin(
			"invalid",
			join(TEST_PLUGINS_DIR, "invalid"),
		);

		expect(result.state).toBe("error");
		expect(result.error).toBeDefined();
	});

	test("getRegistry returns the registry instance", async () => {
		const registry = loader.getRegistry();
		expect(registry).toBeDefined();
		expect(typeof registry.register).toBe("function");
		expect(typeof registry.list).toBe("function");
		expect(typeof registry.initializeAll).toBe("function");
		expect(typeof registry.shutdownAll).toBe("function");
	});

	test("getEventBus returns the event bus instance", async () => {
		const bus = loader.getEventBus();
		expect(bus).toBeDefined();
		expect(typeof bus.emit).toBe("function");
		expect(typeof bus.emitAsync).toBe("function");
	});

	test("shutdownAll shuts down all plugins", async () => {
		await loader.loadAll();
		await loader.initializeAll();
		await loader.shutdownAll();

		const registry = loader.getRegistry();
		const list = registry.list();

		for (const plugin of list) {
			if (plugin.state !== "Error") {
				expect(plugin.state).toBe("Shutdown");
			}
		}
	});

	test("supports both factory and default export shapes", async () => {
		const result = await loader.loadAll();

		const factoryPlugin = result.plugins.find(
			(p) => p.name === "valid-factory",
		);
		const defaultPlugin = result.plugins.find(
			(p) => p.name === "valid-default",
		);
		const factoryOnlyPlugin = result.plugins.find(
			(p) => p.name === "factory-only",
		);

		expect(factoryPlugin?.state).toBe("loaded");
		expect(defaultPlugin?.state).toBe("loaded");
		expect(factoryOnlyPlugin?.state).toBe("loaded");
	});

	test("error isolation: one bad plugin doesn't prevent others from loading", async () => {
		const result = await loader.loadAll();

		// Valid plugins should still load even though "invalid" exists
		const validFactory = result.plugins.find((p) => p.name === "valid-factory");
		const validDefault = result.plugins.find((p) => p.name === "valid-default");

		expect(validFactory?.state).toBe("loaded");
		expect(validDefault?.state).toBe("loaded");
	});

	test("plugins directory is created if it doesn't exist", async () => {
		const newDir = join(TEST_PLUGINS_DIR, "new-plugins-dir");
		await rm(newDir, { recursive: true, force: true });

		const newLoader = new BunDynamicPluginLoaderAdapter(deps, {
			pluginsDir: newDir,
		});
		const result = await newLoader.loadAll();

		// Should not throw, just return empty
		expect(result.plugins).toEqual([]);
		await newLoader.shutdownAll();
	});
});
