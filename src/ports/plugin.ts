/**
 * Plugin system — interface contract & outbound port references.
 *
 * A plugin implements IPlugin and interacts with the host only through
 * the ports exposed in PluginContext. Direct DB/network/filesystem access
 * is forbidden by design — plugins run in subprocess isolation
 * (see rfc-plugin-subprocess-isolation.md).
 */

import type { AgentRegistryPort } from "./agent-registry";
import type { BudgetPort } from "./budget-port";
import type { KanbanPort } from "./kanban-port";
import type { KnowledgePort } from "./knowledge-port";
import type { MemoryStorePort } from "./memory-store";
import type { DomainEventMap } from "./plugin-event-bus.types";
import type { RealtimePort } from "./realtime-port";
import type { TaskStorePort } from "./task-store";

// =============================================================================
// Logger
// =============================================================================

/**
 * Structured logging interface provided to plugins.
 * Logs are routed through the host's logging infrastructure and tagged
 * with the plugin name for filtering.
 */
export interface PluginLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	debug?(message: string): void;
}

// =============================================================================
// Event Subscription
// =============================================================================

/**
 * Handle returned from context.events.subscribe().
 * Used by plugins to unsubscribe during shutdown.
 */
export interface EventSubscription {
	/** Event name this subscription is bound to. */
	readonly eventName: keyof DomainEventMap;
	/** Remove this subscription. */
	unsubscribe(): void;
}

/**
 * Read-only view of the plugin event bus.
 * Plugins can only subscribe/unsubscribe — never emit to the bus directly.
 * (To emit back to the host, use the host:request protocol over stdio.)
 */
export interface PluginEventSubscriber {
	/**
	 * Subscribe to a domain event.
	 * @param eventName - Must be a key of DomainEventMap.
	 * @param handler    - Invoked synchronously when the event fires.
	 * @returns A subscription handle for later cleanup.
	 */
	subscribe<K extends keyof DomainEventMap>(
		eventName: K,
		handler: (
			payload: DomainEventMap[K],
			eventName: string,
		) => void | Promise<void>,
	): EventSubscription;

	/** Unsubscribe using the handle returned by subscribe. */
	unsubscribe(subscription: EventSubscription): void;

	/** Remove all subscriptions for an event (or all events if omitted). */
	unsubscribeAll<K extends keyof DomainEventMap>(eventName?: K): void;
}

// =============================================================================
// PluginCapability
// =============================================================================

/**
 * Capability flags for plugins needing special host permissions.
 * The host enforces these — plugins cannot self-grant.
 *
 * - "network"    — Outbound HTTP requests (default: denied)
 * - "filesystem" — Write access outside the plugin's bundle directory (default: denied)
 * - "database"   — Direct DB access, bypassing ports (default: denied; audited only)
 * - "shell"      — Execute shell commands (default: denied)
 */
export type PluginCapability = "network" | "filesystem" | "database" | "shell";

// =============================================================================
// PluginMetadata
// =============================================================================

/**
 * Static metadata describing a plugin.
 * Read by the host before initialization — never changes at runtime.
 */
export interface PluginMetadata {
	/** Unique plugin name. Must match the bundle directory name. */
	readonly name: string;
	/** Semantic version (MAJOR.MINOR.PATCH). */
	readonly version: string;
	/** Author name or organization. */
	readonly author: string;
	/** Short human-readable description. */
	readonly description: string;

	/**
	 * Events this plugin subscribes to.
	 *
	 * Declaring events upfront allows the host to:
	 * 1. Validate the plugin subscribes only to known events.
	 * 2. Skip dispatch entirely when no subscribers exist.
	 * 3. Report missing/unused subscriptions at load time.
	 *
	 * Use an empty array `[]` for plugins that only react to
	 * host:request messages (no event subscriptions).
	 */
	readonly events: (keyof DomainEventMap)[];

	/**
	 * Minimum host API version required.
	 * Host rejects plugins requiring a newer version.
	 * Semver range, e.g. ">=1.0.0".
	 * @default ">=1.0.0"
	 */
	readonly apiVersion?: string;

	/** Plugin homepage or documentation URL. */
	readonly homepage?: string;

	/** Special capabilities this plugin needs. Prompted to user at install. */
	readonly capabilities?: PluginCapability[];

	/** Arbitrary key-value pairs for discovery/catalog purposes. */
	readonly tags?: Record<string, string>;
}

// =============================================================================
// DomainEvent
// =============================================================================

/**
 * A single domain event with its name, payload, and emission timestamp.
 *
 * This is the wire format passed to onEvent(). The `payload` field is
 * strongly typed via DomainEventMap at the dispatch site; here it is
 * a union of all payload types for structural compatibility.
 */
export interface DomainEvent {
	/** Event name — a key in DomainEventMap. */
	readonly name: keyof DomainEventMap;
	/** Payload matching DomainEventMap[name] (union of all payload types). */
	readonly payload: DomainEventMap[keyof DomainEventMap];
	/** ISO 8601 timestamp when the event was emitted. */
	readonly timestamp: string;
}

// =============================================================================
// PluginContext
// =============================================================================

/**
 * PluginContext — the sole interface between a plugin and the host.
 *
 * Contains only outbound ports (repositories/read models) and a logger.
 * NO inbound ports, NO database connections, NO direct filesystem access.
 * This is the hexagonal-architecture safety boundary.
 *
 * All ports are interfaces (contracts) — the actual implementation is
 * injected by the host and may enforce additional security policies
 * (rate limiting, access control, subprocess isolation).
 */
export interface PluginContext {
	/** Plugin identity — available after the handshake completes. */
	readonly pluginName: string;
	readonly pluginVersion: string;

	/** Structured logging — tagged with the plugin name. */
	readonly logger: PluginLogger;

	/** Event subscription management (read-only bus view). */
	readonly events: PluginEventSubscriber;

	// ---------------------------------------------------------------------------
	// Outbound Ports
	// ---------------------------------------------------------------------------

	/** Task store — create, read, list tasks by status. */
	readonly taskStore: TaskStorePort;

	/** Memory store — read/write session memories and agent memory files. */
	readonly memoryStore: MemoryStorePort;

	/** Agent registry — fetch agent cards and delegate tasks to other agents. */
	readonly agentRegistry: AgentRegistryPort;

	/** Kanban board — create, read, update kanban tasks. */
	readonly kanban: KanbanPort;

	/** Knowledge base — store, query, and relate knowledge entries. */
	readonly knowledge: KnowledgePort;

	/** Realtime — broadcast events to connected WebSocket clients. */
	readonly realtime: RealtimePort;

	/** Budget — consume budget for paid operations (e.g., LLM calls). */
	readonly budget: BudgetPort;
}

// =============================================================================
// IPlugin
// =============================================================================

/**
 * IPlugin — the contract every plugin must implement.
 *
 * Lifecycle:
 * 1. Host reads `metadata` before spawning the plugin process.
 * 2. Host calls `onInitialize(context)` — subscribe to events, set up state.
 * 3. Host calls `onEvent(event, payload)` for each subscribed domain event.
 * 4. Host calls `onShutdown()` on unload — unsubscribe, flush, close.
 *
 * All methods return Promise<void> and are async-friendly.
 * The host enforces timeouts; plugins must not block indefinitely.
 */
export interface IPlugin {
	/** Static metadata — read by host before initialization. */
	readonly metadata: PluginMetadata;

	/**
	 * Initialize the plugin.
	 *
	 * Called once after the plugin process starts and the handshake completes.
	 * Use this to subscribe to events via context.events.subscribe(),
	 * set up internal state, open files, and validate configuration.
	 *
	 * Throwing here prevents the plugin from loading (surfaces PluginInitError).
	 */
	onInitialize(context: PluginContext): Promise<void>;

	/**
	 * Handle a domain event.
	 *
	 * Called by the host when a subscribed event fires.
	 * Plugins should process quickly; defer long-running work.
	 *
	 * Throwing here logs the error but does NOT crash the host.
	 */
	onEvent(event: DomainEvent, payload: unknown): Promise<void>;

	/**
	 * Graceful shutdown.
	 *
	 * Called when the plugin is being unloaded (host shutdown, plugin removal).
	 * Unsubscribe from events, flush buffers, close file handles.
	 *
	 * The host enforces a timeout (default 5s); the process is force-killed
	 * if shutdown hangs.
	 */
	onShutdown(): Promise<void>;
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Factory function type — plugins export a `createPlugin()` function
 * that returns a fresh IPlugin instance.
 *
 * This allows the host to instantiate multiple isolated copies
 * and supports the subprocess isolation model where each plugin
 * runs in its own child process.
 */
export type PluginFactory = () => IPlugin;

/**
 * Convenience: a plugin bundle's expected export shape.
 * Bundles can export either a factory (`createPlugin`) or a raw instance.
 */
export type PluginExport = PluginFactory | IPlugin;
