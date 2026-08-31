import type { ApiKeyRegistry } from "@security/api-key-registry";

export interface AgentConfig {
	name: string;
	description: string;
	url: string;
	version: string;
	port: number;
}

export type AgentInterfaceType = "http" | "grpc";

export interface AgentInterface {
	type: AgentInterfaceType;
	url: string;
}

/**
 * Pricing declaration for an agent. The orchestrator deducts costPerTask
 * (plus an optional costPerToken surcharge) from the target agent's budget
 * before delegating a task.
 */
export interface AgentPricing {
	/** Flat cost deducted from the target agent's budget each time it is delegated a task. */
	costPerTask: number;
	/** Optional per-token surcharge on top of costPerTask; multiplied by input length. */
	costPerToken?: number;
	/** Optional settlement/currency extension for cross-agent payment (x402).
	 *  `costPerTask` is duplicated here so this object satisfies the x402 `SettlementPricing` type. */
	settlement?: {
		/** Base cost per task (mirrors AgentPricing.costPerTask for x402 compatibility). */
		costPerTask: number;
		/** Optional per-token surcharge. */
		costPerToken?: number;
		/** Settlement currency/ledger identifier. When unset, uses the local Jabr ledger. */
		currency?: string;
		/** Maximum unpaid balance before auto-refill is triggered (0 = no auto-refill). */
		autoRefillThreshold?: number;
		/** Amount to refill when balance drops below autoRefillThreshold. */
		autoRefillAmount?: number;
		/** On-chain RPC endpoint for verification when currency is a chain token. */
		chainEndpoint?: string;
		/** Optional contract/program address for on-chain verification. */
		contractAddress?: string;
	};
}

export interface AgentCardCapabilities {
	streaming?: boolean;
	pushNotifications?: boolean;
	/** Whether the agent records state transition history for audit trails. */
	stateTransitionHistory?: boolean;
	extensions?: AgentExtension[];
	extendedAgentCard?: boolean;
}

export interface AgentExtension {
	uri: string;
	description?: string;
	/** If true, the client must understand and comply with the extension's requirements. */
	required?: boolean;
}

// ---------------------------------------------------------------------------
// A2A v1.0 Security Types
// ---------------------------------------------------------------------------

/**
 * Discriminated union of security schemes supported by an agent.
 * Mirrors the A2A v1.0 proto `SecurityScheme` oneof.
 */
export type SecurityScheme =
	| APIKeySecurityScheme
	| HTTPAuthSecurityScheme
	| OAuth2SecurityScheme
	| OpenIdConnectSecurityScheme
	| MutualTlsSecurityScheme;

export interface APIKeySecurityScheme {
	type: "apiKey";
	description?: string;
	/** "query" | "header" | "cookie" */
	location: string;
	name: string;
}

export interface HTTPAuthSecurityScheme {
	type: "http";
	description?: string;
	/** e.g. "Bearer", "Basic" */
	scheme: string;
	/** e.g. "JWT" — hint for bearer token format */
	bearerFormat?: string;
}

export interface OAuth2SecurityScheme {
	type: "oauth2";
	description?: string;
	flows: OAuthFlows;
	/** RFC 8414 authorization server metadata URL */
	oauth2MetadataUrl?: string;
}

export interface OpenIdConnectSecurityScheme {
	type: "openIdConnect";
	description?: string;
	openIdConnectUrl: string;
}

export interface MutualTlsSecurityScheme {
	type: "mtls";
	description?: string;
}

/**
 * OAuth 2.0 flow configuration. At least one flow must be present.
 */
export interface OAuthFlows {
	authorizationCode?: AuthorizationCodeOAuthFlow;
	clientCredentials?: ClientCredentialsOAuthFlow;
	implicit?: ImplicitOAuthFlow;
	password?: PasswordOAuthFlow;
	deviceCode?: DeviceCodeOAuthFlow;
}

export interface AuthorizationCodeOAuthFlow {
	authorizationUrl: string;
	tokenUrl: string;
	refreshUrl?: string;
	scopes: Record<string, string>;
	pkceRequired?: boolean;
}

export interface ClientCredentialsOAuthFlow {
	tokenUrl: string;
	refreshUrl?: string;
	scopes: Record<string, string>;
}

export interface ImplicitOAuthFlow {
	authorizationUrl: string;
	refreshUrl?: string;
	scopes: Record<string, string>;
}

export interface PasswordOAuthFlow {
	tokenUrl: string;
	refreshUrl?: string;
	scopes: Record<string, string>;
}

export interface DeviceCodeOAuthFlow {
	deviceAuthorizationUrl: string;
	tokenUrl: string;
	refreshUrl?: string;
	scopes: Record<string, string>;
}

/**
 * Security requirement for an agent or skill.
 * Maps a security scheme name to the required scopes.
 * Mirrors the A2A v1.0 proto `SecurityRequirement`.
 */
export interface SecurityRequirement {
	/** Key = scheme name (must match a key in AgentCard.securitySchemes), value = required scopes */
	schemes: Record<string, string[]>;
}

// ---------------------------------------------------------------------------

export interface AgentSkill {
	name: string;
	description: string;
	tags: string[];
	examples?: string[];
	inputModes?: string[];
	outputModes?: string[];
	/** Skill-level security requirements (overrides agent-level). */
	securityRequirements?: SecurityRequirement[];
}

export interface AgentCard {
	name: string;
	description: string;
	url: string;
	version: string;
	capabilities: AgentCardCapabilities;
	skills: AgentSkill[];
	supportedInterfaces?: AgentInterface[];
	successRate?: number;
	/** Per-task pricing declaration — consumed from the target agent's budget by the orchestrator. */
	pricing?: AgentPricing;
	/** Security scheme details used for authenticating with this agent (A2A v1.0). */
	securitySchemes?: Record<string, SecurityScheme>;
	/** Security requirements for contacting the agent (A2A v1.0). */
	securityRequirements?: SecurityRequirement[];
}

export type TaskState =
	| "submitted"
	| "working"
	| "input-required"
	| "completed"
	| "failed"
	| "canceled"
	| "rejected"
	| "auth-required"
	| "unknown";

/**
 * Event emitted by the streaming handler during task execution.
 * Carries either a status update or a partial artifact.
 */
export type TaskStreamingEvent =
	| {
			type: "status";
			taskId: string;
			state: TaskState;
			message?: string;
			timestamp: string;
	  }
	| {
			type: "artifact";
			taskId: string;
			artifact: { name: string; parts: Array<{ kind: string; text?: string }> };
	  };

export interface A2ATaskStatus {
	state: TaskState;
	timestamp: string;
	message?: A2AMessage;
}

export interface A2ATask {
	id: string;
	contextId: string;
	status: A2ATaskStatus;
	history: A2AMessage[];
	artifacts?: A2AArtifact[];
	metadata?: Record<string, unknown>;
}

export type A2AMessageRole = "user" | "agent" | "assistant" | "tool";

export interface A2AMessage {
	messageId: string;
	role: A2AMessageRole;
	kind: "message";
	parts: A2APart[];
	contextId: string;
	taskId?: string;
	referenceTaskIds?: string[];
}

export type A2APart =
	| { kind: "text"; text: string }
	| {
			kind: "file";
			file: { base64: string; mimeType?: string; filename?: string };
	  }
	| { kind: "data"; data: Record<string, unknown>; mimeType?: string };

export interface A2AArtifact {
	artifactId: string;
	name?: string;
	description?: string;
	parts: A2APart[];
	metadata?: Record<string, unknown>;
	extensions?: string[];
}

/** Create a text artifact. */
export function createTextArtifact(
	artifactId: string,
	text: string,
	name?: string,
): A2AArtifact {
	return { artifactId, name, parts: [{ kind: "text", text }] };
}

/** Create a binary file artifact (base64-encoded bytes). */
export function createFileArtifact(
	artifactId: string,
	base64: string,
	mimeType?: string,
	filename?: string,
	name?: string,
): A2AArtifact {
	return {
		artifactId,
		name,
		parts: [{ kind: "file", file: { base64, mimeType, filename } }],
	};
}

/** Create a structured data artifact (JSON-serializable object). */
export function createDataArtifact(
	artifactId: string,
	data: Record<string, unknown>,
	mimeType?: string,
	name?: string,
): A2AArtifact {
	return { artifactId, name, parts: [{ kind: "data", data, mimeType }] };
}

/** Create a multi-part artifact from raw A2APart entries. */
export function createMultipartArtifact(
	artifactId: string,
	parts: A2APart[],
	name?: string,
): A2AArtifact {
	return { artifactId, name, parts };
}

export const HANDOVER_MARKER = "%%HANDOVER%%";

export interface HandoverRequest {
	transferTo: string;
	reason: string;
	context: string;
}

export function encodeHandover(req: HandoverRequest): string {
	return `${HANDOVER_MARKER}${JSON.stringify(req)}`;
}

export function decodeHandover(text: string): HandoverRequest | null {
	const idx = text.indexOf(HANDOVER_MARKER);
	if (idx === -1) return null;
	try {
		return JSON.parse(
			text.slice(idx + HANDOVER_MARKER.length),
		) as HandoverRequest;
	} catch {
		return null;
	}
}

export interface ACPRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

export interface ErrorCard {
	code: number;
	message: string;
	data?: unknown;
}

export interface ACPResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: ErrorCard;
}

export interface SkillDocument {
	name: string;
	description: string;
	tags: string[];
	steps: string[];
	createdAt: string;
	usageCount: number;
	successRate: number;
}

export interface MCPToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface MCPToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

export interface McpResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface McpResourceContent {
	uri: string;
	text?: string;
	blob?: string;
	mimeType?: string;
}

export interface ResourceSubscription {
	id: string;
	uri: string;
	listenerId?: string;
	createdAt: string;
}

export type WorldStateAgentStatus = "online" | "offline" | "unknown";
export interface WorldStateAgent {
	name: string;
	port: number;
	status: WorldStateAgentStatus;
	skills: string[];
}

export interface WorldStateTasks {
	total: number;
	active: number;
	completed: number;
	failed: number;
}

export interface WorldStateMemory {
	totalEntries: number;
	lastUpdated?: string;
}

export interface WorldStateSkills {
	total: number;
	recentSlugs: string[];
}

export interface WorldState {
	timestamp: string;
	agents: Array<WorldStateAgent>;
	tasks: WorldStateTasks;
	memory: WorldStateMemory;
	skills: WorldStateSkills;
}

export interface ResolvedCaller {
	description: string;
	allowedAgents: string[];
}

export interface A2AServerConfig {
	port: number;
	card: AgentCard;
	onTask: (message: string, caller?: ResolvedCaller) => Promise<string>;
	/** ApiKeyRegistry for per-key authentication. */
	apiKeyRegistry?: ApiKeyRegistry;
	/** Whether to enforce API key validation on POST /. */
	requireAuth?: boolean;
	/** Max milliseconds to wait for in-flight requests during graceful shutdown. Default 30000. */
	drainTimeoutMs?: number;
	/**
	 * Optional streaming handler for `tasks/sendSubscribe`. Receives the user
	 * text, a fresh taskId, and an emit() callback for SSE events. When set,
	 * the server advertises `capabilities.streaming: true` on its AgentCard.
	 */
	onTaskStreaming?: (
		message: string,
		taskId: string,
		emit: (event: TaskStreamingEvent) => void,
		caller?: ResolvedCaller,
	) => Promise<string>;
	/** Optional world-state handler for GET /.well-known/world-state. */
	onWorldState?: () => Promise<any>;
}

export interface RegistryEntry {
	url: string;
	card: AgentCard;
	tags: string[];
}
