/**
 * A2A Protocol v1.0 Constants
 * Wire format uses camelCase (proto3 JSON mapping from snake_case proto fields).
 */

export const A2A_VERSION = "1.0";

/** JSON-RPC method names (match proto RPC names exactly) */
export const V1_METHOD_SEND_MESSAGE = "SendMessage";
export const V1_METHOD_SEND_STREAMING_MESSAGE = "SendStreamingMessage";
export const V1_METHOD_GET_TASK = "GetTask";
export const V1_METHOD_LIST_TASKS = "ListTasks";
export const V1_METHOD_CANCEL_TASK = "CancelTask";
export const V1_METHOD_SUBSCRIBE_TO_TASK = "SubscribeToTask";
export const V1_METHOD_GET_EXTENDED_AGENT_CARD = "GetExtendedAgentCard";

/** Push notification config methods */
export const V1_METHOD_CREATE_TASK_PUSH_NOTIFICATION_CONFIG =
	"CreateTaskPushNotificationConfig";
export const V1_METHOD_GET_TASK_PUSH_NOTIFICATION_CONFIG =
	"GetTaskPushNotificationConfig";
export const V1_METHOD_LIST_TASK_PUSH_NOTIFICATION_CONFIGS =
	"ListTaskPushNotificationConfigs";
export const V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG =
	"DeleteTaskPushNotificationConfig";

/** REST path templates (prototype style with {id} placeholders) */
export const REST_MESSAGE_SEND = "/message:send";
export const REST_MESSAGE_STREAM = "/message:stream";
export const REST_TASKS = "/tasks";
export const REST_TASK = "/tasks/{id}";
export const REST_TASK_CANCEL = "/tasks/{id}:cancel";
export const REST_TASK_SUBSCRIBE = "/tasks/{id}:subscribe";
export const REST_EXTENDED_AGENT_CARD = "/extendedAgentCard";
export const REST_TASK_PUSH_NOTIFICATION_CONFIGS =
	"/tasks/{id}/pushNotificationConfigs{/configId}";

/** Well-known paths */
export const WELL_KNOWN_AGENT_JSON = ".well-known/agent.json";
export const WELL_KNOWN_AGENT_CARD_JSON = ".well-known/agent-card.json";

/** Protocol binding identifiers */
export const PROTOCOL_BINDING_JSONRPC = "JSONRPC";
export const PROTOCOL_BINDING_HTTP = "HTTP+JSON";

/** Supported interfaces version */
export const SUPPORTED_INTERFACES_VERSION = "1.0";
