// Re-export plugin event bus types and implementation

// Plugin interface contract
export type {
	DomainEvent,
	EventSubscription,
	IPlugin,
	PluginCapability,
	PluginContext,
	PluginEventSubscriber,
	PluginExport,
	PluginFactory,
	PluginLogger,
	PluginMetadata,
} from "./plugin";
export type { ErrorHandler, Middleware } from "./plugin-event-bus";
export { PluginEventBusImpl } from "./plugin-event-bus";
export type {
	AgentCompletePayload,
	AgentErrorPayload,
	AgentStartPayload,
	DomainEventBus,
	DomainEventHandler,
	DomainEventMap,
	EventHandler,
	EventMap,
	PluginEventBus,
	SubscriptionId,
	SystemAlertPayload,
	SystemAlertSeverity,
	TaskCompletePayload,
	TaskFailedPayload,
	TaskStartPayload,
} from "./plugin-event-bus.types";
