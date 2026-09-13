import type { AgentRegistryPort } from "@ports/agent-registry";
import type { BudgetPort } from "@ports/budget-port";
import type { KanbanPort } from "@ports/kanban-port";
import type { KnowledgePort } from "@ports/knowledge-port";
import type { MemoryStorePort } from "@ports/memory-store";
import type {
	EventSubscription,
	IPlugin,
	PluginCapability,
	PluginContext,
	PluginEventSubscriber,
	PluginExport,
	PluginMetadata,
} from "@ports/plugin";
import type {
	DomainEventBus,
	DomainEventMap,
	SubscriptionId,
} from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import type { TaskStorePort } from "@ports/task-store";

// =============================================================================
// Plugin Lifecycle State
// =============================================================================

export type PluginLifecycleState =
	| "Discovered"
	| "Validated"
	| "Loaded"
	| "Initialized"
	| "Running"
	| "Shutdown"
	| "Error";

export interface PluginRegistryEntry {
	readonly plugin: IPlugin;
	readonly metadata: PluginMetadata;
	readonly export: PluginExport;
	state: PluginLifecycleState;
	subscriptions: SubscriptionId[];
	error?: string;
}

// =============================================================================
// PluginContext Factory
// =============================================================================

export interface PluginContextDeps {
	taskStore: TaskStorePort;
	memoryStore: MemoryStorePort;
	agentRegistry: AgentRegistryPort;
	kanban: KanbanPort;
	knowledge: KnowledgePort;
	realtime: RealtimePort;
	budget: BudgetPort;
	eventBus: DomainEventBus;
	logger: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
		debug?: (msg: string) => void;
	};
}

function createPluginEventSubscriber(
	eventBus: DomainEventBus,
	pluginName: string,
): PluginEventSubscriber {
	const subscriptions = new Map<
		SubscriptionId,
		{ eventName: keyof DomainEventMap; unsubscribe: () => void }
	>();

	return {
		subscribe<K extends keyof DomainEventMap>(
			eventName: K,
			handler: (
				payload: DomainEventMap[K],
				eventName: string,
			) => void | Promise<void>,
		): EventSubscription {
			const id = eventBus.subscribe(eventName, handler);
			const unsub = () => eventBus.unsubscribe(id);
			const subscription: EventSubscription = {
				eventName,
				unsubscribe: unsub,
			};
			subscriptions.set(id, { eventName, unsubscribe: unsub });
			return subscription;
		},

		unsubscribe(subscription: EventSubscription): void {
			subscription.unsubscribe();
		},

		unsubscribeAll<K extends keyof DomainEventMap>(eventName?: K): void {
			if (eventName) {
				eventBus.clear(eventName);
			} else {
				eventBus.clear();
			}
			subscriptions.clear();
		},
	};
}

export function createPluginContext(
	deps: PluginContextDeps,
	pluginName: string,
	pluginVersion: string,
): PluginContext {
	const subscriber = createPluginEventSubscriber(deps.eventBus, pluginName);

	const logger = {
		info: (msg: string) => deps.logger.info(`[${pluginName}] ${msg}`),
		warn: (msg: string) => deps.logger.warn(`[${pluginName}] ${msg}`),
		error: (msg: string) => deps.logger.error(`[${pluginName}] ${msg}`),
		debug: deps.logger.debug
			? (msg: string) => deps.logger.debug!(`[${pluginName}] ${msg}`)
			: undefined,
	};

	return {
		pluginName,
		pluginVersion,
		logger,
		events: subscriber,
		taskStore: deps.taskStore,
		memoryStore: deps.memoryStore,
		agentRegistry: deps.agentRegistry,
		kanban: deps.kanban,
		knowledge: deps.knowledge,
		realtime: deps.realtime,
		budget: deps.budget,
	};
}

// =============================================================================
// PluginRegistryUseCase
// =============================================================================

export interface PluginRegistryUseCase {
	/** Register a plugin export (factory or instance) */
	register(
		pluginExport: PluginExport,
	): Promise<{ success: boolean; error?: string }>;

	/** Get all registered plugins with their state */
	list(): ReadonlyArray<{
		name: string;
		version: string;
		state: PluginLifecycleState;
		error?: string;
	}>;

	/** Get a plugin by name */
	get(name: string): Readonly<PluginRegistryEntry> | undefined;

	/** Initialize all loaded plugins (call after registration) */
	initializeAll(): Promise<void>;

	/** Shutdown all running plugins */
	shutdownAll(): Promise<void>;

	/** Shutdown a specific plugin by name */
	shutdown(name: string): Promise<void>;

	/** Get the event bus for external emitters */
	getEventBus(): DomainEventBus;
}

export function createPluginRegistryUseCase(
	deps: PluginContextDeps,
): PluginRegistryUseCase {
	const registry = new Map<string, PluginRegistryEntry>();
	const eventBus = deps.eventBus;

	async function validatePlugin(
		pluginExport: PluginExport,
	): Promise<{ plugin: IPlugin; metadata: PluginMetadata }> {
		let plugin: IPlugin;

		if (typeof pluginExport === "function") {
			// Factory function
			plugin = pluginExport();
		} else {
			// Raw instance
			plugin = pluginExport;
		}

		const metadata = plugin.metadata;

		// Validate required metadata fields
		if (!metadata.name || typeof metadata.name !== "string") {
			throw new Error("Plugin metadata.name is required and must be a string");
		}
		if (!metadata.version || typeof metadata.version !== "string") {
			throw new Error(
				"Plugin metadata.version is required and must be a string",
			);
		}
		if (!metadata.author || typeof metadata.author !== "string") {
			throw new Error(
				"Plugin metadata.author is required and must be a string",
			);
		}
		if (!metadata.description || typeof metadata.description !== "string") {
			throw new Error(
				"Plugin metadata.description is required and must be a string",
			);
		}
		if (!Array.isArray(metadata.events)) {
			throw new Error("Plugin metadata.events must be an array");
		}

		// Validate events are known domain events
		const knownEvents = new Set<keyof DomainEventMap>([
			"onAgentStart",
			"onAgentComplete",
			"onAgentError",
			"onTaskStart",
			"onTaskComplete",
			"onTaskFailed",
			"onSystemAlert",
		]);

		for (const event of metadata.events) {
			if (!knownEvents.has(event)) {
				throw new Error(`Plugin declares unknown event: ${String(event)}`);
			}
		}

		// Validate capabilities if present
		if (metadata.capabilities) {
			const validCapabilities: PluginCapability[] = [
				"network",
				"filesystem",
				"database",
				"shell",
			];
			for (const cap of metadata.capabilities) {
				if (!validCapabilities.includes(cap)) {
					throw new Error(`Plugin declares unknown capability: ${cap}`);
				}
			}
		}

		// Validate apiVersion format if present
		if (metadata.apiVersion && typeof metadata.apiVersion !== "string") {
			throw new Error("Plugin metadata.apiVersion must be a string");
		}

		return { plugin, metadata };
	}

	async function register(
		pluginExport: PluginExport,
	): Promise<{ success: boolean; error?: string }> {
		let plugin: IPlugin;
		let metadata: PluginMetadata;

		try {
			const validated = await validatePlugin(pluginExport);
			plugin = validated.plugin;
			metadata = validated.metadata;
		} catch (e) {
			const error = `Validation failed: ${String(e)}`;
			deps.logger.error(`[PluginRegistry] ${error}`);
			return { success: false, error };
		}

		// Unique name enforcement
		if (registry.has(metadata.name)) {
			const error = `Plugin with name "${metadata.name}" already registered`;
			deps.logger.error(`[PluginRegistry] ${error}`);
			return { success: false, error };
		}

		const entry: PluginRegistryEntry = {
			plugin,
			metadata,
			export: pluginExport,
			state: "Validated",
			subscriptions: [],
		};

		registry.set(metadata.name, entry);
		deps.logger.info(
			`[PluginRegistry] Registered plugin: ${metadata.name}@${metadata.version}`,
		);
		return { success: true };
	}

	function list() {
		return Array.from(registry.values()).map((entry) => ({
			name: entry.metadata.name,
			version: entry.metadata.version,
			state: entry.state,
			error: entry.error,
		}));
	}

	function get(name: string) {
		return registry.get(name);
	}

	async function initializeAll(): Promise<void> {
		for (const [name, entry] of registry) {
			if (entry.state !== "Validated" && entry.state !== "Loaded") {
				continue; // Skip already initialized or errored plugins
			}

			try {
				entry.state = "Loaded";

				const context = createPluginContext(deps, name, entry.metadata.version);
				await entry.plugin.onInitialize(context);

				// Subscribe to declared events
				for (const eventName of entry.metadata.events) {
					const subscriptionId = eventBus.subscribe(
						eventName,
						async (payload) => {
							try {
								const domainEvent = {
									name: eventName,
									payload,
									timestamp: new Date().toISOString(),
								};
								await entry.plugin.onEvent(domainEvent, payload);
							} catch (e) {
								deps.logger.error(
									`[PluginRegistry] Plugin "${name}" onEvent error for ${String(eventName)}: ${String(e)}`,
								);
								// Error isolation: log but don't crash the bus
							}
						},
					);
					entry.subscriptions.push(subscriptionId);
				}

				entry.state = "Initialized";
				entry.state = "Running";
				deps.logger.info(
					`[PluginRegistry] Plugin "${name}" initialized and running`,
				);
			} catch (e) {
				const error = `Initialization failed: ${String(e)}`;
				entry.state = "Error";
				entry.error = error;
				deps.logger.error(`[PluginRegistry] Plugin "${name}" ${error}`);
				// Error isolation: plugin disabled, logged, but registry continues
			}
		}
	}

	async function shutdownAll(): Promise<void> {
		// Shutdown in reverse order (last initialized first)
		const entries = Array.from(registry.entries()).reverse();

		for (const [name, entry] of entries) {
			await shutdownPlugin(name, entry);
		}
	}

	async function shutdown(name: string): Promise<void> {
		const entry = registry.get(name);
		if (entry) {
			await shutdownPlugin(name, entry);
		}
	}

	async function shutdownPlugin(
		name: string,
		entry: PluginRegistryEntry,
	): Promise<void> {
		if (entry.state === "Shutdown") {
			return; // Idempotent
		}

		try {
			// Unsubscribe from all events
			for (const subId of entry.subscriptions) {
				eventBus.unsubscribe(subId);
			}
			entry.subscriptions = [];

			await entry.plugin.onShutdown();
			entry.state = "Shutdown";
			deps.logger.info(`[PluginRegistry] Plugin "${name}" shut down`);
		} catch (e) {
			const error = `Shutdown failed: ${String(e)}`;
			entry.state = "Error";
			entry.error = error;
			deps.logger.error(`[PluginRegistry] Plugin "${name}" ${error}`);
			// Still mark as shutdown to prevent retry loops
			entry.state = "Shutdown";
		}
	}

	function getEventBus(): DomainEventBus {
		return eventBus;
	}

	return {
		register,
		list,
		get,
		initializeAll,
		shutdownAll,
		shutdown,
		getEventBus,
	};
}
