/**
 * A2A Protocol v1.0 Serialization
 * Pure functions — no I/O, no fetch, no fs.
 * Emit: strict camelCase. Parse: lenient (camelCase + snake_case + legacy discriminators).
 */

import type {
	AgentCapabilities,
	AgentCard,
	AgentCardSignature,
	AgentExtension,
	AgentInterface,
	AgentProvider,
	AgentSkill,
	APIKeySecurityScheme,
	Artifact,
	AuthorizationCodeOAuthFlow,
	CancelTaskRequest,
	ClientCredentialsOAuthFlow,
	DataPart,
	DeleteTaskPushNotificationConfigRequest,
	DeviceCodeOAuthFlow,
	ExtendedAgentCard,
	FilePart,
	FunctionCallPart,
	FunctionResponsePart,
	GetExtendedAgentCardRequest,
	GetTaskPushNotificationConfigRequest,
	GetTaskRequest,
	HTTPAuthSecurityScheme,
	ImplicitOAuthFlow,
	ListTaskPushNotificationConfigsRequest,
	ListTaskPushNotificationConfigsResponse,
	ListTasksRequest,
	ListTasksResponse,
	Message,
	MutualTlsSecurityScheme,
	OAuth2SecurityScheme,
	OAuthFlows,
	OpenIdConnectSecurityScheme,
	Part,
	PasswordOAuthFlow,
	RawPart,
	Role,
	SecurityRequirement,
	SecurityScheme,
	SendMessageConfiguration,
	SendMessageRequest,
	SendMessageResponse,
	StreamResponse,
	SubscribeToTaskRequest,
	Task,
	TaskArtifactUpdateEvent,
	TaskPushNotificationConfig,
	TaskState,
	TaskStatus,
	TaskStatusUpdateEvent,
	TextPart,
} from "../../types/a2a-v1.ts";

/** Type guard for plain objects */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize key: accept camelCase or snake_case */
function getKey(
	obj: Record<string, unknown>,
	camel: string,
	snake: string,
): unknown {
	if (camel in obj) return obj[camel];
	if (snake in obj) return obj[snake];
	return undefined;
}

function getKeyArray(
	obj: Record<string, unknown>,
	camel: string,
	snake: string,
): readonly unknown[] {
	const val = getKey(obj, camel, snake);
	if (Array.isArray(val)) return val;
	return [];
}

function getKeyString(
	obj: Record<string, unknown>,
	camel: string,
	snake: string,
): string | undefined {
	const val = getKey(obj, camel, snake);
	if (typeof val === "string") return val;
	return undefined;
}

function getKeyNumber(
	obj: Record<string, unknown>,
	camel: string,
	snake: string,
): number | undefined {
	const val = getKey(obj, camel, snake);
	if (typeof val === "number") return val;
	return undefined;
}

function getKeyBoolean(
	obj: Record<string, unknown>,
	camel: string,
	snake: string,
): boolean | undefined {
	const val = getKey(obj, camel, snake);
	if (typeof val === "boolean") return val;
	return undefined;
}

function getKeyObject(
	obj: Record<string, unknown>,
	camel: string,
	snake: string,
): Record<string, unknown> | undefined {
	const val = getKey(obj, camel, snake);
	if (isPlainObject(val)) return val;
	return undefined;
}

/** Parse a Part from wire format (lenient) */
function parsePart(raw: unknown): Part {
	if (!isPlainObject(raw)) {
		throw new Error("Part must be an object");
	}

	// Legacy discriminators: {kind: "text"|"file"|"data"} or {type: "text"}
	const kind = (raw.kind ?? raw.type) as string | undefined;

	// Check for explicit content fields (proto oneof)
	if ("text" in raw && typeof raw.text === "string") {
		return { kind: "text", text: raw.text } as TextPart;
	}
	if ("raw" in raw && typeof raw.raw === "string") {
		return { kind: "raw", raw: raw.raw } as RawPart;
	}
	if ("url" in raw && typeof raw.url === "string") {
		const file = raw as Record<string, unknown>;
		return {
			kind: "file",
			file: {
				name: getKeyString(file, "name", "filename") ?? "",
				mimeType:
					getKeyString(file, "mimeType", "media_type") ??
					"application/octet-stream",
				bytes: getKeyString(file, "bytes", "bytes"),
				uri: getKeyString(file, "uri", "url"),
			},
		} as FilePart;
	}
	if ("data" in raw) {
		return { kind: "data", data: raw.data } as DataPart;
	}
	if ("functionCall" in raw && isPlainObject(raw.functionCall)) {
		const fc = raw.functionCall as Record<string, unknown>;
		return {
			kind: "functionCall",
			functionCall: {
				id: getKeyString(fc, "id", "id") ?? "",
				name: getKeyString(fc, "name", "name") ?? "",
				args: (getKeyObject(fc, "args", "args") ?? {}) as Record<
					string,
					unknown
				>,
			},
		} as FunctionCallPart;
	}
	if ("functionResponse" in raw && isPlainObject(raw.functionResponse)) {
		const fr = raw.functionResponse as Record<string, unknown>;
		return {
			kind: "functionResponse",
			functionResponse: {
				id: getKeyString(fr, "id", "id") ?? "",
				name: getKeyString(fr, "name", "name") ?? "",
				response: fr.response ?? null,
			},
		} as FunctionResponsePart;
	}

	// Legacy kind-based parsing
	switch (kind) {
		case "text":
			return {
				kind: "text",
				text: getKeyString(raw, "text", "text") ?? "",
			} as TextPart;
		case "file": {
			const file = getKeyObject(raw, "file", "file") ?? raw;
			return {
				kind: "file",
				file: {
					name: getKeyString(file, "name", "filename") ?? "",
					mimeType:
						getKeyString(file, "mimeType", "media_type") ??
						"application/octet-stream",
					bytes: getKeyString(file, "bytes", "bytes"),
					uri: getKeyString(file, "uri", "url"),
				},
			} as FilePart;
		}
		case "raw":
			return {
				kind: "raw",
				raw: getKeyString(raw, "raw", "raw") ?? "",
			} as RawPart;
		case "data":
			return { kind: "data", data: raw.data ?? null } as DataPart;
		case "functionCall": {
			const fc = getKeyObject(raw, "functionCall", "function_call") ?? {};
			return {
				kind: "functionCall",
				functionCall: {
					id: getKeyString(fc, "id", "id") ?? "",
					name: getKeyString(fc, "name", "name") ?? "",
					args: (getKeyObject(fc, "args", "args") ?? {}) as Record<
						string,
						unknown
					>,
				},
			} as FunctionCallPart;
		}
		case "functionResponse": {
			const fr =
				getKeyObject(raw, "functionResponse", "function_response") ?? {};
			return {
				kind: "functionResponse",
				functionResponse: {
					id: getKeyString(fr, "id", "id") ?? "",
					name: getKeyString(fr, "name", "name") ?? "",
					response: fr.response ?? null,
				},
			} as FunctionResponsePart;
		}
	}

	throw new Error(`Unknown part format: ${JSON.stringify(raw).slice(0, 200)}`);
}

/** Serialize a Part to wire format (strict camelCase) */
function serializePart(part: Part): Record<string, unknown> {
	switch (part.kind) {
		case "text":
			return { text: part.text };
		case "file":
			return {
				url: part.file.uri ?? "",
				filename: part.file.name,
				media_type: part.file.mimeType,
				...(part.file.bytes !== undefined && { bytes: part.file.bytes }),
			};
		case "raw":
			return { raw: part.raw };
		case "data":
			return { data: part.data };
		case "functionCall":
			return {
				functionCall: {
					id: part.functionCall.id,
					name: part.functionCall.name,
					args: part.functionCall.args,
				},
			};
		case "functionResponse":
			return {
				functionResponse: {
					id: part.functionResponse.id,
					name: part.functionResponse.name,
					response: part.functionResponse.response,
				},
			};
	}
}

/** Parse Message */
export function fromWireMessage(raw: unknown): Message {
	if (!isPlainObject(raw)) throw new Error("Message must be an object");

	const roleVal = getKey(raw, "role", "role");
	const role: Role =
		roleVal === "agent" || roleVal === "ROLE_AGENT" ? "agent" : "user";

	return {
		role,
		messageId: getKeyString(raw, "messageId", "message_id") ?? "",
		contextId: getKeyString(raw, "contextId", "context_id"),
		taskId: getKeyString(raw, "taskId", "task_id"),
		parts: getKeyArray(raw, "parts", "parts").map(parsePart),
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
		extensions: getKeyArray(raw, "extensions", "extensions") as string[],
		referenceTaskIds: getKeyArray(
			raw,
			"referenceTaskIds",
			"reference_task_ids",
		) as string[],
	};
}

/** Serialize Message */
export function toWireMessage(msg: Message): Record<string, unknown> {
	const out: Record<string, unknown> = {
		role: msg.role,
		messageId: msg.messageId,
		parts: msg.parts.map(serializePart),
	};
	if (msg.contextId !== undefined) out.contextId = msg.contextId;
	if (msg.taskId !== undefined) out.taskId = msg.taskId;
	if (msg.metadata !== undefined) out.metadata = msg.metadata;
	if (msg.extensions !== undefined && msg.extensions.length > 0)
		out.extensions = msg.extensions;
	if (msg.referenceTaskIds !== undefined && msg.referenceTaskIds.length > 0)
		out.referenceTaskIds = msg.referenceTaskIds;
	return out;
}

/** Parse TaskStatus */
function parseTaskStatus(raw: unknown): TaskStatus {
	if (!isPlainObject(raw)) throw new Error("TaskStatus must be an object");

	const stateVal = getKey(raw, "state", "state");
	const stateMap: Record<string, TaskState> = {
		submitted: "submitted",
		working: "working",
		"input-required": "input-required",
		"auth-required": "auth-required",
		completed: "completed",
		failed: "failed",
		canceled: "canceled",
		rejected: "rejected",
		unspecified: "unspecified",
		TASK_STATE_SUBMITTED: "submitted",
		TASK_STATE_WORKING: "working",
		TASK_STATE_INPUT_REQUIRED: "input-required",
		TASK_STATE_AUTH_REQUIRED: "auth-required",
		TASK_STATE_COMPLETED: "completed",
		TASK_STATE_FAILED: "failed",
		TASK_STATE_CANCELED: "canceled",
		TASK_STATE_REJECTED: "rejected",
		TASK_STATE_UNSPECIFIED: "unspecified",
	};

	const state = stateMap[String(stateVal)] ?? "unspecified";

	return {
		state,
		message: getKeyObject(raw, "message", "message")
			? fromWireMessage(getKeyObject(raw, "message", "message")!)
			: undefined,
		timestamp: getKeyString(raw, "timestamp", "timestamp"),
	};
}

/** Serialize TaskStatus */
function serializeTaskStatus(status: TaskStatus): Record<string, unknown> {
	const out: Record<string, unknown> = { state: status.state };
	if (status.message !== undefined) out.message = toWireMessage(status.message);
	if (status.timestamp !== undefined) out.timestamp = status.timestamp;
	return out;
}

/** Parse Artifact */
function parseArtifact(raw: unknown): Artifact {
	if (!isPlainObject(raw)) throw new Error("Artifact must be an object");

	return {
		artifactId: getKeyString(raw, "artifactId", "artifact_id") ?? "",
		name: getKeyString(raw, "name", "name"),
		description: getKeyString(raw, "description", "description"),
		parts: getKeyArray(raw, "parts", "parts").map(parsePart),
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
		extensions: getKeyArray(raw, "extensions", "extensions") as string[],
	};
}

/** Serialize Artifact */
function serializeArtifact(artifact: Artifact): Record<string, unknown> {
	const out: Record<string, unknown> = {
		artifactId: artifact.artifactId,
		parts: artifact.parts.map(serializePart),
	};
	if (artifact.name !== undefined) out.name = artifact.name;
	if (artifact.description !== undefined)
		out.description = artifact.description;
	if (artifact.metadata !== undefined) out.metadata = artifact.metadata;
	if (artifact.extensions !== undefined && artifact.extensions.length > 0)
		out.extensions = artifact.extensions;
	return out;
}

/** Parse Task */
export function fromWireTask(raw: unknown): Task {
	if (!isPlainObject(raw)) throw new Error("Task must be an object");

	return {
		taskId:
			getKeyString(raw, "taskId", "id") ??
			getKeyString(raw, "taskId", "task_id") ??
			"",
		contextId: getKeyString(raw, "contextId", "context_id"),
		status: parseTaskStatus(getKey(raw, "status", "status")!),
		history: getKeyArray(raw, "history", "history").map(fromWireMessage),
		artifacts: getKeyArray(raw, "artifacts", "artifacts").map(parseArtifact),
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize Task */
export function toWireTask(task: Task): Record<string, unknown> {
	const out: Record<string, unknown> = {
		id: task.taskId,
		status: serializeTaskStatus(task.status),
	};
	if (task.contextId !== undefined) out.contextId = task.contextId;
	if (task.history !== undefined && task.history.length > 0)
		out.history = task.history.map(toWireMessage);
	if (task.artifacts !== undefined && task.artifacts.length > 0)
		out.artifacts = task.artifacts.map(serializeArtifact);
	if (task.metadata !== undefined) out.metadata = task.metadata;
	return out;
}

/** Parse SendMessageConfiguration */
function parseSendMessageConfiguration(
	raw: unknown,
): SendMessageConfiguration | undefined {
	if (!isPlainObject(raw)) return undefined;

	return {
		acceptedOutputModes: getKeyArray(
			raw,
			"acceptedOutputModes",
			"accepted_output_modes",
		) as string[],
		taskPushNotificationConfig: getKeyObject(
			raw,
			"taskPushNotificationConfig",
			"task_push_notification_config",
		)
			? parseTaskPushNotificationConfig(
					getKeyObject(
						raw,
						"taskPushNotificationConfig",
						"task_push_notification_config",
					)!,
				)
			: undefined,
		historyLength: getKeyNumber(raw, "historyLength", "history_length"),
		returnImmediately: getKeyBoolean(
			raw,
			"returnImmediately",
			"return_immediately",
		),
	};
}

/** Serialize SendMessageConfiguration */
function serializeSendMessageConfiguration(
	config: SendMessageConfiguration,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (
		config.acceptedOutputModes !== undefined &&
		config.acceptedOutputModes.length > 0
	)
		out.acceptedOutputModes = config.acceptedOutputModes;
	if (config.taskPushNotificationConfig !== undefined)
		out.taskPushNotificationConfig = serializeTaskPushNotificationConfig(
			config.taskPushNotificationConfig,
		);
	if (config.historyLength !== undefined)
		out.historyLength = config.historyLength;
	if (config.returnImmediately !== undefined)
		out.returnImmediately = config.returnImmediately;
	return out;
}

/** Parse TaskPushNotificationConfig */
function parseTaskPushNotificationConfig(
	raw: unknown,
): TaskPushNotificationConfig {
	if (!isPlainObject(raw))
		throw new Error("TaskPushNotificationConfig must be an object");

	const auth = getKeyObject(raw, "authentication", "authentication");
	return {
		id: getKeyString(raw, "id", "id") ?? "",
		taskId: getKeyString(raw, "taskId", "task_id") ?? "",
		url: getKeyString(raw, "url", "url") ?? "",
		token: getKeyString(raw, "token", "token"),
		authentication: auth
			? {
					schemes: getKeyArray(auth, "schemes", "schemes") as string[],
					credentials: getKeyString(auth, "credentials", "credentials"),
				}
			: undefined,
		tenant: getKeyString(raw, "tenant", "tenant"),
	};
}

/** Serialize TaskPushNotificationConfig */
function serializeTaskPushNotificationConfig(
	config: TaskPushNotificationConfig,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		id: config.id,
		taskId: config.taskId,
		url: config.url,
	};
	if (config.token !== undefined) out.token = config.token;
	if (config.authentication !== undefined)
		out.authentication = config.authentication;
	if (config.tenant !== undefined) out.tenant = config.tenant;
	return out;
}

/** Parse SendMessageRequest */
export function fromWireSendMessageRequest(raw: unknown): SendMessageRequest {
	if (!isPlainObject(raw))
		throw new Error("SendMessageRequest must be an object");

	return {
		message: fromWireMessage(getKey(raw, "message", "message")!),
		notificationUrl: getKeyString(raw, "notificationUrl", "notification_url"),
		sendMessageConfiguration: parseSendMessageConfiguration(
			getKey(raw, "sendMessageConfiguration", "configuration")!,
		),
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize SendMessageRequest */
export function toWireSendMessageRequest(
	req: SendMessageRequest,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		message: toWireMessage(req.message),
	};
	if (req.notificationUrl !== undefined)
		out.notificationUrl = req.notificationUrl;
	if (req.sendMessageConfiguration !== undefined)
		out.configuration = serializeSendMessageConfiguration(
			req.sendMessageConfiguration,
		);
	if (req.metadata !== undefined) out.metadata = req.metadata;
	return out;
}

/** Parse SendMessageResponse */
export function fromWireSendMessageResponse(raw: unknown): SendMessageResponse {
	if (!isPlainObject(raw))
		throw new Error("SendMessageResponse must be an object");

	const task = getKeyObject(raw, "task", "task");
	const message = getKeyObject(raw, "message", "message");

	return {
		task: task ? fromWireTask(task) : undefined,
		message: message ? fromWireMessage(message) : undefined,
	};
}

/** Serialize SendMessageResponse */
export function toWireSendMessageResponse(
	resp: SendMessageResponse,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (resp.task !== undefined) out.task = toWireTask(resp.task);
	if (resp.message !== undefined) out.message = toWireMessage(resp.message);
	return out;
}

/** Parse TaskStatusUpdateEvent */
export function fromWireTaskStatusUpdateEvent(
	raw: unknown,
): TaskStatusUpdateEvent {
	if (!isPlainObject(raw))
		throw new Error("TaskStatusUpdateEvent must be an object");

	return {
		taskId: getKeyString(raw, "taskId", "task_id") ?? "",
		contextId: getKeyString(raw, "contextId", "context_id") ?? "",
		status: parseTaskStatus(getKey(raw, "status", "status")!),
		final: getKeyBoolean(raw, "final", "final"),
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize TaskStatusUpdateEvent */
export function toWireTaskStatusUpdateEvent(
	event: TaskStatusUpdateEvent,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		taskId: event.taskId,
		contextId: event.contextId,
		status: serializeTaskStatus(event.status),
	};
	if (event.final !== undefined) out.final = event.final;
	if (event.metadata !== undefined) out.metadata = event.metadata;
	return out;
}

/** Parse TaskArtifactUpdateEvent */
export function fromWireTaskArtifactUpdateEvent(
	raw: unknown,
): TaskArtifactUpdateEvent {
	if (!isPlainObject(raw))
		throw new Error("TaskArtifactUpdateEvent must be an object");

	return {
		taskId: getKeyString(raw, "taskId", "task_id") ?? "",
		contextId: getKeyString(raw, "contextId", "context_id") ?? "",
		artifact: parseArtifact(getKey(raw, "artifact", "artifact")!),
		append: getKeyBoolean(raw, "append", "append"),
		lastChunk: getKeyBoolean(raw, "lastChunk", "last_chunk"),
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize TaskArtifactUpdateEvent */
export function toWireTaskArtifactUpdateEvent(
	event: TaskArtifactUpdateEvent,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		taskId: event.taskId,
		contextId: event.contextId,
		artifact: serializeArtifact(event.artifact),
	};
	if (event.append !== undefined) out.append = event.append;
	if (event.lastChunk !== undefined) out.lastChunk = event.lastChunk;
	if (event.metadata !== undefined) out.metadata = event.metadata;
	return out;
}

/** Parse StreamResponse */
export function fromWireStreamResponse(raw: unknown): StreamResponse {
	if (!isPlainObject(raw)) throw new Error("StreamResponse must be an object");

	// Check oneof payload fields
	if ("task" in raw) {
		return { task: fromWireTask(raw.task) };
	}
	if ("message" in raw) {
		return { message: fromWireMessage(raw.message) };
	}
	if ("statusUpdate" in raw || "status_update" in raw) {
		return {
			statusUpdate: fromWireTaskStatusUpdateEvent(
				raw.statusUpdate ?? raw.status_update,
			),
		};
	}
	if ("artifactUpdate" in raw || "artifact_update" in raw) {
		return {
			artifactUpdate: fromWireTaskArtifactUpdateEvent(
				raw.artifactUpdate ?? raw.artifact_update,
			),
		};
	}
	if ("jsonRpcResponse" in raw || "json_rpc_response" in raw) {
		const jrr = (raw.jsonRpcResponse ?? raw.json_rpc_response) as Record<
			string,
			unknown
		>;
		return {
			jsonRpcResponse: {
				result: jrr.result,
				error: isPlainObject(jrr.error)
					? {
							code: getKeyNumber(jrr.error, "code", "code") ?? -32603,
							message:
								getKeyString(jrr.error, "message", "message") ??
								"Internal error",
						}
					: undefined,
			},
		};
	}

	throw new Error(
		`Unknown StreamResponse payload: ${JSON.stringify(raw).slice(0, 200)}`,
	);
}

/** Serialize StreamResponse */
export function toWireStreamResponse(
	resp: StreamResponse,
): Record<string, unknown> {
	if ("task" in resp) return { task: toWireTask(resp.task) };
	if ("message" in resp) return { message: toWireMessage(resp.message) };
	if ("statusUpdate" in resp)
		return { statusUpdate: toWireTaskStatusUpdateEvent(resp.statusUpdate) };
	if ("artifactUpdate" in resp)
		return {
			artifactUpdate: toWireTaskArtifactUpdateEvent(resp.artifactUpdate),
		};
	if ("jsonRpcResponse" in resp)
		return { jsonRpcResponse: resp.jsonRpcResponse };
	throw new Error("Invalid StreamResponse variant");
}

/** Parse ListTasksRequest */
export function fromWireListTasksRequest(raw: unknown): ListTasksRequest {
	if (!isPlainObject(raw))
		throw new Error("ListTasksRequest must be an object");

	const statusVal = getKey(raw, "status", "status");
	const stateMap: Record<string, TaskState> = {
		submitted: "submitted",
		working: "working",
		"input-required": "input-required",
		"auth-required": "auth-required",
		completed: "completed",
		failed: "failed",
		canceled: "canceled",
		rejected: "rejected",
		unspecified: "unspecified",
	};

	return {
		contextId: getKeyString(raw, "contextId", "context_id"),
		status: statusVal ? stateMap[String(statusVal)] : undefined,
		pageSize: getKeyNumber(raw, "pageSize", "page_size"),
		pageToken: getKeyString(raw, "pageToken", "page_token"),
		historyLength: getKeyNumber(raw, "historyLength", "history_length"),
		statusTimestampAfter: getKeyString(
			raw,
			"statusTimestampAfter",
			"status_timestamp_after",
		),
		includeArtifacts: getKeyBoolean(
			raw,
			"includeArtifacts",
			"include_artifacts",
		),
	};
}

/** Serialize ListTasksRequest */
export function toWireListTasksRequest(
	req: ListTasksRequest,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (req.contextId !== undefined) out.contextId = req.contextId;
	if (req.status !== undefined) out.status = req.status;
	if (req.pageSize !== undefined) out.pageSize = req.pageSize;
	if (req.pageToken !== undefined) out.pageToken = req.pageToken;
	if (req.historyLength !== undefined) out.historyLength = req.historyLength;
	if (req.statusTimestampAfter !== undefined)
		out.statusTimestampAfter = req.statusTimestampAfter;
	if (req.includeArtifacts !== undefined)
		out.includeArtifacts = req.includeArtifacts;
	return out;
}

/** Parse ListTasksResponse */
export function fromWireListTasksResponse(raw: unknown): ListTasksResponse {
	if (!isPlainObject(raw))
		throw new Error("ListTasksResponse must be an object");

	return {
		tasks: getKeyArray(raw, "tasks", "tasks").map(fromWireTask),
		nextPageToken: getKeyString(raw, "nextPageToken", "next_page_token"),
		pageSize: getKeyNumber(raw, "pageSize", "page_size") ?? 0,
		totalSize: getKeyNumber(raw, "totalSize", "total_size") ?? 0,
	};
}

/** Serialize ListTasksResponse */
export function toWireListTasksResponse(
	resp: ListTasksResponse,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		tasks: resp.tasks.map(toWireTask),
		pageSize: resp.pageSize,
		totalSize: resp.totalSize,
	};
	if (resp.nextPageToken !== undefined) out.nextPageToken = resp.nextPageToken;
	return out;
}

/** Parse GetTaskRequest */
export function fromWireGetTaskRequest(raw: unknown): GetTaskRequest {
	if (!isPlainObject(raw)) throw new Error("GetTaskRequest must be an object");

	return {
		id: getKeyString(raw, "id", "id") ?? "",
		historyLength: getKeyNumber(raw, "historyLength", "history_length"),
	};
}

/** Serialize GetTaskRequest */
export function toWireGetTaskRequest(
	req: GetTaskRequest,
): Record<string, unknown> {
	const out: Record<string, unknown> = { id: req.id };
	if (req.historyLength !== undefined) out.historyLength = req.historyLength;
	return out;
}

/** Parse CancelTaskRequest */
export function fromWireCancelTaskRequest(raw: unknown): CancelTaskRequest {
	if (!isPlainObject(raw))
		throw new Error("CancelTaskRequest must be an object");

	return {
		id: getKeyString(raw, "id", "id") ?? "",
		metadata: getKeyObject(raw, "metadata", "metadata") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize CancelTaskRequest */
export function toWireCancelTaskRequest(
	req: CancelTaskRequest,
): Record<string, unknown> {
	const out: Record<string, unknown> = { id: req.id };
	if (req.metadata !== undefined) out.metadata = req.metadata;
	return out;
}

/** Parse GetTaskPushNotificationConfigRequest */
export function fromWireGetTaskPushNotificationConfigRequest(
	raw: unknown,
): GetTaskPushNotificationConfigRequest {
	if (!isPlainObject(raw))
		throw new Error("GetTaskPushNotificationConfigRequest must be an object");

	return {
		taskId: getKeyString(raw, "taskId", "task_id") ?? "",
		id: getKeyString(raw, "id", "id") ?? "",
	};
}

/** Serialize GetTaskPushNotificationConfigRequest */
export function toWireGetTaskPushNotificationConfigRequest(
	req: GetTaskPushNotificationConfigRequest,
): Record<string, unknown> {
	return { taskId: req.taskId, id: req.id };
}

/** Parse DeleteTaskPushNotificationConfigRequest */
export function fromWireDeleteTaskPushNotificationConfigRequest(
	raw: unknown,
): DeleteTaskPushNotificationConfigRequest {
	if (!isPlainObject(raw))
		throw new Error(
			"DeleteTaskPushNotificationConfigRequest must be an object",
		);

	return {
		taskId: getKeyString(raw, "taskId", "task_id") ?? "",
		id: getKeyString(raw, "id", "id") ?? "",
	};
}

/** Serialize DeleteTaskPushNotificationConfigRequest */
export function toWireDeleteTaskPushNotificationConfigRequest(
	req: DeleteTaskPushNotificationConfigRequest,
): Record<string, unknown> {
	return { taskId: req.taskId, id: req.id };
}

/** Parse ListTaskPushNotificationConfigsRequest */
export function fromWireListTaskPushNotificationConfigsRequest(
	raw: unknown,
): ListTaskPushNotificationConfigsRequest {
	if (!isPlainObject(raw))
		throw new Error("ListTaskPushNotificationConfigsRequest must be an object");

	return {
		taskId: getKeyString(raw, "taskId", "task_id") ?? "",
		pageSize: getKeyNumber(raw, "pageSize", "page_size"),
		pageToken: getKeyString(raw, "pageToken", "page_token"),
	};
}

/** Serialize ListTaskPushNotificationConfigsRequest */
export function toWireListTaskPushNotificationConfigsRequest(
	req: ListTaskPushNotificationConfigsRequest,
): Record<string, unknown> {
	const out: Record<string, unknown> = { taskId: req.taskId };
	if (req.pageSize !== undefined) out.pageSize = req.pageSize;
	if (req.pageToken !== undefined) out.pageToken = req.pageToken;
	return out;
}

/** Parse ListTaskPushNotificationConfigsResponse */
export function fromWireListTaskPushNotificationConfigsResponse(
	raw: unknown,
): ListTaskPushNotificationConfigsResponse {
	if (!isPlainObject(raw))
		throw new Error(
			"ListTaskPushNotificationConfigsResponse must be an object",
		);

	return {
		configs: getKeyArray(raw, "configs", "configs").map(
			parseTaskPushNotificationConfig,
		),
		nextPageToken: getKeyString(raw, "nextPageToken", "next_page_token"),
	};
}

/** Serialize ListTaskPushNotificationConfigsResponse */
export function toWireListTaskPushNotificationConfigsResponse(
	resp: ListTaskPushNotificationConfigsResponse,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		configs: resp.configs.map(serializeTaskPushNotificationConfig),
	};
	if (resp.nextPageToken !== undefined) out.nextPageToken = resp.nextPageToken;
	return out;
}

/** Parse SubscribeToTaskRequest */
export function fromWireSubscribeToTaskRequest(
	raw: unknown,
): SubscribeToTaskRequest {
	if (!isPlainObject(raw))
		throw new Error("SubscribeToTaskRequest must be an object");

	return { id: getKeyString(raw, "id", "id") ?? "" };
}

/** Serialize SubscribeToTaskRequest */
export function toWireSubscribeToTaskRequest(
	req: SubscribeToTaskRequest,
): Record<string, unknown> {
	return { id: req.id };
}

/** Parse GetExtendedAgentCardRequest */
export function fromWireGetExtendedAgentCardRequest(
	raw: unknown,
): GetExtendedAgentCardRequest {
	if (!isPlainObject(raw)) return { tenant: undefined };
	return { tenant: getKeyString(raw, "tenant", "tenant") };
}

/** Serialize GetExtendedAgentCardRequest */
export function toWireGetExtendedAgentCardRequest(
	req: GetExtendedAgentCardRequest,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (req.tenant !== undefined) out.tenant = req.tenant;
	return out;
}

/** Parse AgentInterface */
function parseAgentInterface(raw: unknown): AgentInterface {
	if (!isPlainObject(raw)) throw new Error("AgentInterface must be an object");

	return {
		url: getKeyString(raw, "url", "url") ?? "",
		protocolBinding:
			getKeyString(raw, "protocolBinding", "protocol_binding") ?? "",
		protocolVersion:
			getKeyString(raw, "protocolVersion", "protocol_version") ?? "",
		tenant: getKeyString(raw, "tenant", "tenant"),
	};
}

/** Serialize AgentInterface */
function serializeAgentInterface(
	iface: AgentInterface,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		url: iface.url,
		protocolBinding: iface.protocolBinding,
		protocolVersion: iface.protocolVersion,
	};
	if (iface.tenant !== undefined) out.tenant = iface.tenant;
	return out;
}

/** Parse AgentProvider */
function parseAgentProvider(raw: unknown): AgentProvider | undefined {
	if (!isPlainObject(raw)) return undefined;
	return {
		url: getKeyString(raw, "url", "url") ?? "",
		organization: getKeyString(raw, "organization", "organization") ?? "",
	};
}

/** Serialize AgentProvider */
function serializeAgentProvider(
	provider: AgentProvider,
): Record<string, unknown> {
	return { url: provider.url, organization: provider.organization };
}

/** Parse AgentCapabilities */
function parseAgentCapabilities(raw: unknown): AgentCapabilities | undefined {
	if (!isPlainObject(raw)) return undefined;
	return {
		streaming: getKeyBoolean(raw, "streaming", "streaming"),
		pushNotifications: getKeyBoolean(
			raw,
			"pushNotifications",
			"push_notifications",
		),
		extensions: getKeyArray(raw, "extensions", "extensions").map(
			parseAgentExtension,
		),
		extendedAgentCard: getKeyBoolean(
			raw,
			"extendedAgentCard",
			"extended_agent_card",
		),
	};
}

/** Serialize AgentCapabilities */
function serializeAgentCapabilities(
	caps: AgentCapabilities,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (caps.streaming !== undefined) out.streaming = caps.streaming;
	if (caps.pushNotifications !== undefined)
		out.pushNotifications = caps.pushNotifications;
	if (caps.extensions !== undefined && caps.extensions.length > 0)
		out.extensions = caps.extensions.map(serializeAgentExtension);
	if (caps.extendedAgentCard !== undefined)
		out.extendedAgentCard = caps.extendedAgentCard;
	return out;
}

/** Parse AgentExtension */
function parseAgentExtension(raw: unknown): AgentExtension {
	if (!isPlainObject(raw)) throw new Error("AgentExtension must be an object");
	return {
		uri: getKeyString(raw, "uri", "uri") ?? "",
		description: getKeyString(raw, "description", "description") ?? "",
		required: getKeyBoolean(raw, "required", "required") ?? false,
		params: getKeyObject(raw, "params", "params") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize AgentExtension */
function serializeAgentExtension(ext: AgentExtension): Record<string, unknown> {
	const out: Record<string, unknown> = {
		uri: ext.uri,
		description: ext.description,
		required: ext.required,
	};
	if (ext.params !== undefined) out.params = ext.params;
	return out;
}

/** Parse AgentSkill */
function parseAgentSkill(raw: unknown): AgentSkill {
	if (!isPlainObject(raw)) throw new Error("AgentSkill must be an object");
	return {
		id: getKeyString(raw, "id", "id") ?? "",
		name: getKeyString(raw, "name", "name"),
		description: getKeyString(raw, "description", "description"),
		tags: getKeyArray(raw, "tags", "tags") as string[],
		examples: getKeyArray(raw, "examples", "examples") as string[],
		inputModes: getKeyArray(raw, "inputModes", "input_modes") as string[],
		outputModes: getKeyArray(raw, "outputModes", "output_modes") as string[],
		securityRequirements: getKeyArray(
			raw,
			"securityRequirements",
			"security_requirements",
		).map(parseSecurityRequirement),
	};
}

/** Serialize AgentSkill */
function serializeAgentSkill(skill: AgentSkill): Record<string, unknown> {
	const out: Record<string, unknown> = { id: skill.id };
	if (skill.name !== undefined) out.name = skill.name;
	if (skill.description !== undefined) out.description = skill.description;
	if (skill.tags !== undefined && skill.tags.length > 0) out.tags = skill.tags;
	if (skill.examples !== undefined && skill.examples.length > 0)
		out.examples = skill.examples;
	if (skill.inputModes !== undefined && skill.inputModes.length > 0)
		out.inputModes = skill.inputModes;
	if (skill.outputModes !== undefined && skill.outputModes.length > 0)
		out.outputModes = skill.outputModes;
	if (
		skill.securityRequirements !== undefined &&
		skill.securityRequirements.length > 0
	)
		out.securityRequirements = skill.securityRequirements.map(
			serializeSecurityRequirement,
		);
	return out;
}

/** Parse SecurityRequirement */
function parseSecurityRequirement(raw: unknown): SecurityRequirement {
	if (!isPlainObject(raw))
		throw new Error("SecurityRequirement must be an object");
	const schemes = getKeyObject(raw, "schemes", "schemes") ?? {};
	const result: Record<string, readonly string[]> = {};
	for (const [k, v] of Object.entries(schemes)) {
		if (isPlainObject(v) && Array.isArray(v.list)) {
			result[k] = v.list as string[];
		} else if (Array.isArray(v)) {
			result[k] = v as string[];
		}
	}
	return { schemes: result };
}

/** Serialize SecurityRequirement */
function serializeSecurityRequirement(
	req: SecurityRequirement,
): Record<string, unknown> {
	const schemes: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(req.schemes)) {
		schemes[k] = { list: v };
	}
	return { schemes };
}

/** Parse SecurityScheme */
function parseSecurityScheme(raw: unknown): SecurityScheme | undefined {
	if (!isPlainObject(raw)) return undefined;

	// Check oneof scheme fields
	if ("apiKeySecurityScheme" in raw || "api_key_security_scheme" in raw) {
		const s = (raw.apiKeySecurityScheme ??
			raw.api_key_security_scheme) as Record<string, unknown>;
		return {
			type: "apiKey",
			description: getKeyString(s, "description", "description"),
			location:
				(getKeyString(s, "location", "location") as
					| "query"
					| "header"
					| "cookie") ?? "header",
			name: getKeyString(s, "name", "name") ?? "",
		} as APIKeySecurityScheme;
	}
	if ("httpAuthSecurityScheme" in raw || "http_auth_security_scheme" in raw) {
		const s = (raw.httpAuthSecurityScheme ??
			raw.http_auth_security_scheme) as Record<string, unknown>;
		return {
			type: "http",
			description: getKeyString(s, "description", "description"),
			scheme: getKeyString(s, "scheme", "scheme") ?? "",
			bearerFormat: getKeyString(s, "bearerFormat", "bearer_format"),
		} as HTTPAuthSecurityScheme;
	}
	if ("oauth2SecurityScheme" in raw || "oauth2_security_scheme" in raw) {
		const s = (raw.oauth2SecurityScheme ??
			raw.oauth2_security_scheme) as Record<string, unknown>;
		return {
			type: "oauth2",
			description: getKeyString(s, "description", "description"),
			flows: parseOAuthFlows(getKey(s, "flows", "flows"))!,
			oauth2MetadataUrl: getKeyString(
				s,
				"oauth2MetadataUrl",
				"oauth2_metadata_url",
			),
		} as OAuth2SecurityScheme;
	}
	if (
		"openIdConnectSecurityScheme" in raw ||
		"open_id_connect_security_scheme" in raw
	) {
		const s = (raw.openIdConnectSecurityScheme ??
			raw.open_id_connect_security_scheme) as Record<string, unknown>;
		return {
			type: "openIdConnect",
			description: getKeyString(s, "description", "description"),
			openIdConnectUrl:
				getKeyString(s, "openIdConnectUrl", "open_id_connect_url") ?? "",
		} as OpenIdConnectSecurityScheme;
	}
	if ("mutualTlsSecurityScheme" in raw || "mtls_security_scheme" in raw) {
		const s = (raw.mutualTlsSecurityScheme ??
			raw.mtls_security_scheme) as Record<string, unknown>;
		return {
			type: "mutualTls",
			description: getKeyString(s, "description", "description"),
		} as MutualTlsSecurityScheme;
	}

	return undefined;
}

/** Serialize SecurityScheme */
function serializeSecurityScheme(
	scheme: SecurityScheme,
): Record<string, unknown> {
	switch (scheme.type) {
		case "apiKey":
			return {
				api_key_security_scheme: {
					description: scheme.description,
					location: scheme.location,
					name: scheme.name,
				},
			};
		case "http":
			return {
				http_auth_security_scheme: {
					description: scheme.description,
					scheme: scheme.scheme,
					bearer_format: scheme.bearerFormat,
				},
			};
		case "oauth2":
			return {
				oauth2_security_scheme: {
					description: scheme.description,
					flows: serializeOAuthFlows(scheme.flows),
					oauth2_metadata_url: scheme.oauth2MetadataUrl,
				},
			};
		case "openIdConnect":
			return {
				open_id_connect_security_scheme: {
					description: scheme.description,
					open_id_connect_url: scheme.openIdConnectUrl,
				},
			};
		case "mutualTls":
			return {
				mtls_security_scheme: {
					description: scheme.description,
				},
			};
	}
}

/** Parse OAuthFlows */
function parseOAuthFlows(raw: unknown): OAuthFlows | undefined {
	if (!isPlainObject(raw)) return undefined;
	return {
		authorizationCode: getKeyObject(
			raw,
			"authorizationCode",
			"authorization_code",
		)
			? parseAuthorizationCodeOAuthFlow(
					getKeyObject(raw, "authorizationCode", "authorization_code")!,
				)
			: undefined,
		clientCredentials: getKeyObject(
			raw,
			"clientCredentials",
			"client_credentials",
		)
			? parseClientCredentialsOAuthFlow(
					getKeyObject(raw, "clientCredentials", "client_credentials")!,
				)
			: undefined,
		implicit: getKeyObject(raw, "implicit", "implicit")
			? parseImplicitOAuthFlow(getKeyObject(raw, "implicit", "implicit")!)
			: undefined,
		password: getKeyObject(raw, "password", "password")
			? parsePasswordOAuthFlow(getKeyObject(raw, "password", "password")!)
			: undefined,
		deviceCode: getKeyObject(raw, "deviceCode", "device_code")
			? parseDeviceCodeOAuthFlow(
					getKeyObject(raw, "deviceCode", "device_code")!,
				)
			: undefined,
	};
}

/** Serialize OAuthFlows */
function serializeOAuthFlows(flows: OAuthFlows): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (flows.authorizationCode !== undefined)
		out.authorization_code = serializeAuthorizationCodeOAuthFlow(
			flows.authorizationCode,
		);
	if (flows.clientCredentials !== undefined)
		out.client_credentials = serializeClientCredentialsOAuthFlow(
			flows.clientCredentials,
		);
	if (flows.implicit !== undefined)
		out.implicit = serializeImplicitOAuthFlow(flows.implicit);
	if (flows.password !== undefined)
		out.password = serializePasswordOAuthFlow(flows.password);
	if (flows.deviceCode !== undefined)
		out.device_code = serializeDeviceCodeOAuthFlow(flows.deviceCode);
	return out;
}

function parseAuthorizationCodeOAuthFlow(
	raw: unknown,
): AuthorizationCodeOAuthFlow {
	if (!isPlainObject(raw))
		throw new Error("AuthorizationCodeOAuthFlow must be an object");
	return {
		authorizationUrl:
			getKeyString(raw, "authorizationUrl", "authorization_url") ?? "",
		tokenUrl: getKeyString(raw, "tokenUrl", "token_url") ?? "",
		refreshUrl: getKeyString(raw, "refreshUrl", "refresh_url"),
		scopes: (getKeyObject(raw, "scopes", "scopes") ?? {}) as Record<
			string,
			string
		>,
		pkceRequired: getKeyBoolean(raw, "pkceRequired", "pkce_required"),
	};
}

function serializeAuthorizationCodeOAuthFlow(
	flow: AuthorizationCodeOAuthFlow,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		authorization_url: flow.authorizationUrl,
		token_url: flow.tokenUrl,
		scopes: flow.scopes,
	};
	if (flow.refreshUrl !== undefined) out.refresh_url = flow.refreshUrl;
	if (flow.pkceRequired !== undefined) out.pkce_required = flow.pkceRequired;
	return out;
}

function parseClientCredentialsOAuthFlow(
	raw: unknown,
): ClientCredentialsOAuthFlow {
	if (!isPlainObject(raw))
		throw new Error("ClientCredentialsOAuthFlow must be an object");
	return {
		tokenUrl: getKeyString(raw, "tokenUrl", "token_url") ?? "",
		refreshUrl: getKeyString(raw, "refreshUrl", "refresh_url"),
		scopes: (getKeyObject(raw, "scopes", "scopes") ?? {}) as Record<
			string,
			string
		>,
	};
}

function serializeClientCredentialsOAuthFlow(
	flow: ClientCredentialsOAuthFlow,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		token_url: flow.tokenUrl,
		scopes: flow.scopes,
	};
	if (flow.refreshUrl !== undefined) out.refresh_url = flow.refreshUrl;
	return out;
}

function parseImplicitOAuthFlow(raw: unknown): ImplicitOAuthFlow {
	if (!isPlainObject(raw))
		throw new Error("ImplicitOAuthFlow must be an object");
	return {
		authorizationUrl:
			getKeyString(raw, "authorizationUrl", "authorization_url") ?? "",
		refreshUrl: getKeyString(raw, "refreshUrl", "refresh_url"),
		scopes: (getKeyObject(raw, "scopes", "scopes") ?? {}) as Record<
			string,
			string
		>,
	};
}

function serializeImplicitOAuthFlow(
	flow: ImplicitOAuthFlow,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		authorization_url: flow.authorizationUrl,
		scopes: flow.scopes,
	};
	if (flow.refreshUrl !== undefined) out.refresh_url = flow.refreshUrl;
	return out;
}

function parsePasswordOAuthFlow(raw: unknown): PasswordOAuthFlow {
	if (!isPlainObject(raw))
		throw new Error("PasswordOAuthFlow must be an object");
	return {
		tokenUrl: getKeyString(raw, "tokenUrl", "token_url") ?? "",
		refreshUrl: getKeyString(raw, "refreshUrl", "refresh_url"),
		scopes: (getKeyObject(raw, "scopes", "scopes") ?? {}) as Record<
			string,
			string
		>,
	};
}

function serializePasswordOAuthFlow(
	flow: PasswordOAuthFlow,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		token_url: flow.tokenUrl,
		scopes: flow.scopes,
	};
	if (flow.refreshUrl !== undefined) out.refresh_url = flow.refreshUrl;
	return out;
}

function parseDeviceCodeOAuthFlow(raw: unknown): DeviceCodeOAuthFlow {
	if (!isPlainObject(raw))
		throw new Error("DeviceCodeOAuthFlow must be an object");
	return {
		deviceAuthorizationUrl:
			getKeyString(raw, "deviceAuthorizationUrl", "device_authorization_url") ??
			"",
		tokenUrl: getKeyString(raw, "tokenUrl", "token_url") ?? "",
		refreshUrl: getKeyString(raw, "refreshUrl", "refresh_url"),
		scopes: (getKeyObject(raw, "scopes", "scopes") ?? {}) as Record<
			string,
			string
		>,
	};
}

function serializeDeviceCodeOAuthFlow(
	flow: DeviceCodeOAuthFlow,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		device_authorization_url: flow.deviceAuthorizationUrl,
		token_url: flow.tokenUrl,
		scopes: flow.scopes,
	};
	if (flow.refreshUrl !== undefined) out.refresh_url = flow.refreshUrl;
	return out;
}

/** Parse AgentCard */
export function fromWireAgentCard(raw: unknown): AgentCard {
	if (!isPlainObject(raw)) throw new Error("AgentCard must be an object");

	return {
		name: getKeyString(raw, "name", "name") ?? "",
		description: getKeyString(raw, "description", "description"),
		url: getKeyString(raw, "url", "url") ?? "",
		version: getKeyString(raw, "version", "version") ?? "",
		supportedInterfaces: getKeyArray(
			raw,
			"supportedInterfaces",
			"supported_interfaces",
		).map(parseAgentInterface),
		provider: parseAgentProvider(getKey(raw, "provider", "provider")),
		documentationUrl: getKeyString(
			raw,
			"documentationUrl",
			"documentation_url",
		),
		capabilities: parseAgentCapabilities(
			getKey(raw, "capabilities", "capabilities"),
		),
		securitySchemes: (() => {
			const schemes = getKeyObject(raw, "securitySchemes", "security_schemes");
			if (!schemes) return undefined;
			const result: Record<string, SecurityScheme> = {};
			for (const [k, v] of Object.entries(schemes)) {
				const parsed = parseSecurityScheme(v);
				if (parsed) result[k] = parsed;
			}
			return result;
		})(),
		securityRequirements: getKeyArray(
			raw,
			"securityRequirements",
			"security_requirements",
		).map(parseSecurityRequirement),
		defaultInputModes: getKeyArray(
			raw,
			"defaultInputModes",
			"default_input_modes",
		) as string[],
		defaultOutputModes: getKeyArray(
			raw,
			"defaultOutputModes",
			"default_output_modes",
		) as string[],
		skills: getKeyArray(raw, "skills", "skills").map(parseAgentSkill),
		signatures: getKeyArray(raw, "signatures", "signatures").map(
			parseAgentCardSignature,
		),
		iconUrl: getKeyString(raw, "iconUrl", "icon_url"),
	};
}

/** Serialize AgentCard */
export function toWireAgentCard(card: AgentCard): Record<string, unknown> {
	const out: Record<string, unknown> = {
		name: card.name,
		url: card.url,
		version: card.version,
		supportedInterfaces: card.supportedInterfaces.map(serializeAgentInterface),
		defaultInputModes: card.defaultInputModes,
	};
	if (card.description !== undefined) out.description = card.description;
	if (card.provider !== undefined)
		out.provider = serializeAgentProvider(card.provider);
	if (card.documentationUrl !== undefined)
		out.documentationUrl = card.documentationUrl;
	if (card.capabilities !== undefined)
		out.capabilities = serializeAgentCapabilities(card.capabilities);
	if (card.securitySchemes !== undefined) {
		const schemes: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(card.securitySchemes)) {
			schemes[k] = serializeSecurityScheme(v);
		}
		out.security_schemes = schemes;
	}
	if (
		card.securityRequirements !== undefined &&
		card.securityRequirements.length > 0
	)
		out.security_requirements = card.securityRequirements.map(
			serializeSecurityRequirement,
		);
	if (
		card.defaultOutputModes !== undefined &&
		card.defaultOutputModes.length > 0
	)
		out.defaultOutputModes = card.defaultOutputModes;
	if (card.skills !== undefined && card.skills.length > 0)
		out.skills = card.skills.map(serializeAgentSkill);
	if (card.signatures !== undefined && card.signatures.length > 0)
		out.signatures = card.signatures.map(serializeAgentCardSignature);
	if (card.iconUrl !== undefined) out.iconUrl = card.iconUrl;
	return out;
}

/** Parse AgentCardSignature */
function parseAgentCardSignature(raw: unknown): AgentCardSignature {
	if (!isPlainObject(raw))
		throw new Error("AgentCardSignature must be an object");
	return {
		protected: getKeyString(raw, "protected", "protected") ?? "",
		signature: getKeyString(raw, "signature", "signature") ?? "",
		header: getKeyObject(raw, "header", "header") as
			| Record<string, unknown>
			| undefined,
	};
}

/** Serialize AgentCardSignature */
function serializeAgentCardSignature(
	sig: AgentCardSignature,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		protected: sig.protected,
		signature: sig.signature,
	};
	if (sig.header !== undefined) out.header = sig.header;
	return out;
}

/** Parse ExtendedAgentCard */
export function fromWireExtendedAgentCard(raw: unknown): ExtendedAgentCard {
	if (!isPlainObject(raw)) return {};
	const agentCard = getKeyObject(raw, "agentCard", "agent_card");
	return {
		agentCard: agentCard ? fromWireAgentCard(agentCard) : undefined,
	};
}

/** Serialize ExtendedAgentCard */
export function toWireExtendedAgentCard(
	card: ExtendedAgentCard,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (card.agentCard !== undefined)
		out.agentCard = toWireAgentCard(card.agentCard);
	return out;
}

/** Parse Part (exported for testing) */
export function fromWirePart(raw: unknown): Part {
	return parsePart(raw);
}

/** Serialize Part (exported for testing) */
export function toWirePart(part: Part): Record<string, unknown> {
	return serializePart(part);
}

/** Internal parse/serialize for Part (exported for testing) */
/** Parse Message (exported for testing) */
/** Parse Task (exported for testing) */
export {
	fromWireMessage as parseMessage,
	fromWireTask as parseTask,
	parsePart,
	serializePart,
	toWireMessage as serializeMessage,
	toWireTask as serializeTask,
};
