/**
 * A2A Protocol v1.0 Wire Types
 * All keys are camelCase per proto3 JSON mapping from snake_case proto fields.
 * These types represent the exact wire format — emit strict camelCase, parse leniently.
 */

/** Role of the message sender */
export type Role = "user" | "agent";

/** Part content variants (oneof in proto) */
export interface TextPart {
	readonly kind: "text";
	readonly text: string;
}

export interface FilePart {
	readonly kind: "file";
	readonly file: {
		readonly name: string;
		readonly mimeType: string;
		readonly bytes?: string; // base64 encoded
		readonly uri?: string;
	};
}

export interface RawPart {
	readonly kind: "raw";
	readonly raw: string; // base64 encoded bytes
}

export interface DataPart {
	readonly kind: "data";
	readonly data: unknown; // arbitrary JSON value
}

export interface FunctionCallPart {
	readonly kind: "functionCall";
	readonly functionCall: {
		readonly id: string;
		readonly name: string;
		readonly args: Record<string, unknown>;
	};
}

export interface FunctionResponsePart {
	readonly kind: "functionResponse";
	readonly functionResponse: {
		readonly id: string;
		readonly name: string;
		readonly response: unknown;
	};
}

/** Union of all part kinds */
export type Part =
	| TextPart
	| FilePart
	| RawPart
	| DataPart
	| FunctionCallPart
	| FunctionResponsePart;

/** Message in A2A protocol */
export interface Message {
	readonly role: Role;
	readonly messageId: string;
	readonly contextId?: string;
	readonly taskId?: string;
	readonly parts: readonly Part[];
	readonly metadata?: Record<string, unknown>;
	readonly extensions?: readonly string[];
	readonly referenceTaskIds?: readonly string[];
}

/** Artifact produced by a task */
export interface Artifact {
	readonly artifactId: string;
	readonly name?: string;
	readonly description?: string;
	readonly parts: readonly Part[];
	readonly metadata?: Record<string, unknown>;
	readonly extensions?: readonly string[];
}

/** Task lifecycle states */
export type TaskState =
	| "submitted"
	| "working"
	| "input-required"
	| "auth-required"
	| "completed"
	| "failed"
	| "canceled"
	| "rejected"
	| "unspecified";

/** Task status with optional message and timestamp */
export interface TaskStatus {
	readonly state: TaskState;
	readonly message?: Message;
	readonly timestamp?: string; // ISO 8601
}

/** Core task object */
export interface Task {
	readonly taskId: string;
	readonly contextId?: string;
	readonly status: TaskStatus;
	readonly history?: readonly Message[];
	readonly artifacts?: readonly Artifact[];
	readonly metadata?: Record<string, unknown>;
}

/** Configuration for sending a message */
export interface SendMessageConfiguration {
	readonly acceptedOutputModes?: readonly string[];
	readonly taskPushNotificationConfig?: TaskPushNotificationConfig;
	readonly historyLength?: number;
	readonly returnImmediately?: boolean;
}

/** Request to send a message */
export interface SendMessageRequest {
	readonly message: Message;
	readonly notificationUrl?: string;
	readonly sendMessageConfiguration?: SendMessageConfiguration;
	readonly metadata?: Record<string, unknown>;
}

/** Response from sending a message */
export interface SendMessageResponse {
	readonly task?: Task;
	readonly message?: Message;
}

/** Task status update event (streaming) */
export interface TaskStatusUpdateEvent {
	readonly taskId: string;
	readonly contextId: string;
	readonly status: TaskStatus;
	readonly final?: boolean;
	readonly metadata?: Record<string, unknown>;
}

/** Task artifact update event (streaming) */
export interface TaskArtifactUpdateEvent {
	readonly taskId: string;
	readonly contextId: string;
	readonly artifact: Artifact;
	readonly append?: boolean;
	readonly lastChunk?: boolean;
	readonly metadata?: Record<string, unknown>;
}

/** Stream response variants (oneof in proto) */
export interface StreamResponseTask {
	readonly task: Task;
}

export interface StreamResponseMessage {
	readonly message: Message;
}

export interface StreamResponseStatusUpdate {
	readonly statusUpdate: TaskStatusUpdateEvent;
}

export interface StreamResponseArtifactUpdate {
	readonly artifactUpdate: TaskArtifactUpdateEvent;
}

export interface StreamResponseJsonRpcResponse {
	readonly jsonRpcResponse: {
		readonly result?: unknown;
		readonly error?: {
			readonly code: number;
			readonly message: string;
		};
	};
}

export type StreamResponse =
	| StreamResponseTask
	| StreamResponseMessage
	| StreamResponseStatusUpdate
	| StreamResponseArtifactUpdate
	| StreamResponseJsonRpcResponse;

/** List tasks request */
export interface ListTasksRequest {
	readonly contextId?: string;
	readonly status?: TaskState;
	readonly pageSize?: number;
	readonly pageToken?: string;
	readonly historyLength?: number;
	readonly statusTimestampAfter?: string; // ISO 8601
	readonly includeArtifacts?: boolean;
}

/** List tasks response */
export interface ListTasksResponse {
	readonly tasks: readonly Task[];
	readonly nextPageToken?: string;
	readonly pageSize: number;
	readonly totalSize: number;
}

/** Get task request */
export interface GetTaskRequest {
	readonly id: string;
	readonly historyLength?: number;
}

/** Cancel task request */
export interface CancelTaskRequest {
	readonly id: string;
	readonly metadata?: Record<string, unknown>;
}

/** Push notification configuration */
export interface TaskPushNotificationConfig {
	readonly id: string;
	readonly taskId: string;
	readonly url: string;
	readonly token?: string;
	readonly authentication?: {
		readonly schemes: readonly string[];
		readonly credentials?: string;
	};
	readonly tenant?: string;
}

/** Get task push notification config request */
export interface GetTaskPushNotificationConfigRequest {
	readonly taskId: string;
	readonly id: string;
}

/** Delete task push notification config request */
export interface DeleteTaskPushNotificationConfigRequest {
	readonly taskId: string;
	readonly id: string;
}

/** List task push notification configs request */
export interface ListTaskPushNotificationConfigsRequest {
	readonly taskId: string;
	readonly pageSize?: number;
	readonly pageToken?: string;
}

/** List task push notification configs response */
export interface ListTaskPushNotificationConfigsResponse {
	readonly configs: readonly TaskPushNotificationConfig[];
	readonly nextPageToken?: string;
}

/** Subscribe to task request */
export interface SubscribeToTaskRequest {
	readonly id: string;
}

/** Get extended agent card request */
export interface GetExtendedAgentCardRequest {
	readonly tenant?: string;
}

/** Agent interface declaration */
export interface AgentInterface {
	readonly url: string;
	readonly protocolBinding: string;
	readonly protocolVersion: string;
	readonly tenant?: string;
}

/** Agent provider info */
export interface AgentProvider {
	readonly url: string;
	readonly organization: string;
}

/** Agent capabilities */
export interface AgentCapabilities {
	readonly streaming?: boolean;
	readonly pushNotifications?: boolean;
	readonly extensions?: readonly AgentExtension[];
	readonly extendedAgentCard?: boolean;
}

/** Agent extension */
export interface AgentExtension {
	readonly uri: string;
	readonly description: string;
	readonly required: boolean;
	readonly params?: Record<string, unknown>;
}

/** Agent skill */
export interface AgentSkill {
	readonly id: string;
	readonly name?: string;
	readonly description?: string;
	readonly tags?: readonly string[];
	readonly examples?: readonly string[];
	readonly inputModes?: readonly string[];
	readonly outputModes?: readonly string[];
	readonly securityRequirements?: readonly SecurityRequirement[];
}

/** Security requirement */
export interface SecurityRequirement {
	readonly schemes: Record<string, readonly string[]>;
}

/** Agent card (manifest) */
export interface AgentCard {
	readonly name: string;
	readonly description?: string;
	readonly url: string;
	readonly version: string;
	readonly supportedInterfaces: readonly AgentInterface[];
	readonly provider?: AgentProvider;
	readonly documentationUrl?: string;
	readonly capabilities?: AgentCapabilities;
	readonly securitySchemes?: Record<string, SecurityScheme>;
	readonly securityRequirements?: readonly SecurityRequirement[];
	readonly defaultInputModes: readonly string[];
	readonly defaultOutputModes?: readonly string[];
	readonly skills?: readonly AgentSkill[];
	readonly signatures?: readonly AgentCardSignature[];
	readonly iconUrl?: string;
}

/** Agent card signature (JWS) */
export interface AgentCardSignature {
	readonly protected: string;
	readonly signature: string;
	readonly header?: Record<string, unknown>;
}

/** Security scheme variants (oneof in proto) */
export interface APIKeySecurityScheme {
	readonly type: "apiKey";
	readonly description?: string;
	readonly location: "query" | "header" | "cookie";
	readonly name: string;
}

export interface HTTPAuthSecurityScheme {
	readonly type: "http";
	readonly description?: string;
	readonly scheme: string; // e.g., "Bearer"
	readonly bearerFormat?: string;
}

export interface OAuth2SecurityScheme {
	readonly type: "oauth2";
	readonly description?: string;
	readonly flows: OAuthFlows;
	readonly oauth2MetadataUrl?: string;
}

export interface OpenIdConnectSecurityScheme {
	readonly type: "openIdConnect";
	readonly description?: string;
	readonly openIdConnectUrl: string;
}

export interface MutualTlsSecurityScheme {
	readonly type: "mutualTls";
	readonly description?: string;
}

export type SecurityScheme =
	| APIKeySecurityScheme
	| HTTPAuthSecurityScheme
	| OAuth2SecurityScheme
	| OpenIdConnectSecurityScheme
	| MutualTlsSecurityScheme;

/** OAuth flows */
export interface OAuthFlows {
	readonly authorizationCode?: AuthorizationCodeOAuthFlow;
	readonly clientCredentials?: ClientCredentialsOAuthFlow;
	readonly implicit?: ImplicitOAuthFlow;
	readonly password?: PasswordOAuthFlow;
	readonly deviceCode?: DeviceCodeOAuthFlow;
}

export interface AuthorizationCodeOAuthFlow {
	readonly authorizationUrl: string;
	readonly tokenUrl: string;
	readonly refreshUrl?: string;
	readonly scopes: Record<string, string>;
	readonly pkceRequired?: boolean;
}

export interface ClientCredentialsOAuthFlow {
	readonly tokenUrl: string;
	readonly refreshUrl?: string;
	readonly scopes: Record<string, string>;
}

export interface ImplicitOAuthFlow {
	readonly authorizationUrl: string;
	readonly refreshUrl?: string;
	readonly scopes: Record<string, string>;
}

export interface PasswordOAuthFlow {
	readonly tokenUrl: string;
	readonly refreshUrl?: string;
	readonly scopes: Record<string, string>;
}

export interface DeviceCodeOAuthFlow {
	readonly deviceAuthorizationUrl: string;
	readonly tokenUrl: string;
	readonly refreshUrl?: string;
	readonly scopes: Record<string, string>;
}

/** Extended agent card (returned by GetExtendedAgentCard) */
export interface ExtendedAgentCard {
	readonly agentCard?: AgentCard;
	// Additional fields from proto if any
}
