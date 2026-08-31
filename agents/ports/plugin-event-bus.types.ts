/**
 * PluginEventBus — Public API Contract & Domain Event Types
 *
 * Canonical payload schemas per ADR-001 §3. Single source of truth for all
 * agent/task/system lifecycle events emitted on the in-process plugin bus.
 */

// =============================================================================
// Core Event Bus Interfaces
// =============================================================================

export type SubscriptionId = string;

export type EventHandler<TPayload = unknown> = (
	payload: TPayload,
	eventName: string,
) => void | Promise<void>;

export interface PluginEventBus<Events extends EventMap = EventMap> {
	subscribe<K extends keyof Events>(
		eventName: K,
		handler: EventHandler<Events[K]>,
	): SubscriptionId;

	unsubscribe(subscriptionId: SubscriptionId): void;

	emit<K extends keyof Events>(eventName: K, payload: Events[K]): void;

	emitAsync<K extends keyof Events>(
		eventName: K,
		payload: Events[K],
	): Promise<void>;

	clear<K extends keyof Events>(eventName?: K): void;

	listenerCount<K extends keyof Events>(eventName: K): number;
}

// =============================================================================
// Event Map Type Helper
// =============================================================================

export interface EventMap {
	[eventName: string]: unknown;
}

// =============================================================================
// Agent Lifecycle Events
// =============================================================================

export interface AgentStartPayload {
	agentId: string;
	agentName: string;
	provider: string;
	model: string;
	correlationId?: string;
	startedAt: string;
	metadata?: Record<string, unknown>;
}

export interface AgentCompletePayload {
	agentId: string;
	agentName: string;
	provider: string;
	model: string;
	correlationId?: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	tokenUsage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	metadata?: Record<string, unknown>;
}

export interface AgentErrorPayload {
	agentId: string;
	agentName: string;
	provider: string;
	model: string;
	correlationId?: string;
	erroredAt: string;
	error: {
		message: string;
		code?: string;
		stack?: string;
	};
	recoverable: boolean;
	metadata?: Record<string, unknown>;
}

// =============================================================================
// Task Lifecycle Events
// =============================================================================

export interface TaskStartPayload {
	taskId: string;
	title: string;
	assignee: string;
	priority: number;
	startedAt: string;
	parentTaskIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface TaskCompletePayload {
	taskId: string;
	title: string;
	assignee: string;
	priority: number;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	summary?: string;
	metadata?: Record<string, unknown>;
}

export interface TaskFailedPayload {
	taskId: string;
	title: string;
	assignee: string;
	priority: number;
	startedAt: string;
	failedAt: string;
	durationMs: number;
	error: {
		message: string;
		code?: string;
		stack?: string;
	};
	retryable: boolean;
	retryCount: number;
	metadata?: Record<string, unknown>;
}

// =============================================================================
// System Alert Events
// =============================================================================

export enum SystemAlertSeverity {
	INFO = "info",
	WARNING = "warning",
	ERROR = "error",
	CRITICAL = "critical",
}

export interface SystemAlertPayload {
	alertId: string;
	severity: SystemAlertSeverity;
	title: string;
	message: string;
	source: string;
	raisedAt: string;
	suggestedAction?: string;
	metadata?: Record<string, unknown>;
}

// =============================================================================
// Domain Event Map
// =============================================================================

export interface DomainEventMap extends EventMap {
	onAgentStart: AgentStartPayload;
	onAgentComplete: AgentCompletePayload;
	onAgentError: AgentErrorPayload;
	onTaskStart: TaskStartPayload;
	onTaskComplete: TaskCompletePayload;
	onTaskFailed: TaskFailedPayload;
	onSystemAlert: SystemAlertPayload;
}

// =============================================================================
// Convenience Typedefs
// =============================================================================

export type DomainEventBus = PluginEventBus<DomainEventMap>;

export type DomainEventHandler<K extends keyof DomainEventMap> = EventHandler<
	DomainEventMap[K]
>;
