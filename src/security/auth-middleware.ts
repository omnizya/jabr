/**
 * auth-middleware.ts — Per-endpoint scope enforcement for OAuth 2.1.
 *
 * Maps each A2A v1.0 wire method to the minimum scope required.
 *
 *   - SendMessage                  → a2a:write
 *   - SendStreamingMessage         → a2a:stream OR a2a:write
 *   - GetTask / ListTasks          → a2a:read
 *   - CancelTask                   → a2a:admin
 *   - SubscribeToTask              → a2a:stream OR a2a:read
 *   - GetExtendedAgentCard         → a2a:read
 *   - Push notification config CRUD → a2a:admin
 */

import {
	V1_METHOD_CANCEL_TASK,
	V1_METHOD_CREATE_TASK_PUSH_NOTIFICATION_CONFIG,
	V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG,
	V1_METHOD_GET_EXTENDED_AGENT_CARD,
	V1_METHOD_GET_TASK,
	V1_METHOD_GET_TASK_PUSH_NOTIFICATION_CONFIG,
	V1_METHOD_LIST_TASK_PUSH_NOTIFICATION_CONFIGS,
	V1_METHOD_LIST_TASKS,
	V1_METHOD_SEND_MESSAGE,
	V1_METHOD_SEND_STREAMING_MESSAGE,
	V1_METHOD_SUBSCRIBE_TO_TASK,
} from "../constants/a2a-v1.ts";
import { type OAuthScope, verifyWithScopes } from "./jwt.ts";

const WRITE = ["a2a:write"] as OAuthScope[];
const STREAM_OR_WRITE = ["a2a:stream", "a2a:write"] as OAuthScope[];
const READ = ["a2a:read"] as OAuthScope[];
const STREAM_OR_READ = ["a2a:stream", "a2a:read"] as OAuthScope[];
const ADMIN = ["a2a:admin"] as OAuthScope[];

/** Minimum scope required per A2A v1.0 wire method. */
const METHOD_SCOPES: Record<string, OAuthScope[]> = {
	[V1_METHOD_SEND_MESSAGE]: WRITE,
	[V1_METHOD_SEND_STREAMING_MESSAGE]: STREAM_OR_WRITE,
	[V1_METHOD_GET_TASK]: READ,
	[V1_METHOD_LIST_TASKS]: READ,
	[V1_METHOD_CANCEL_TASK]: ADMIN,
	[V1_METHOD_SUBSCRIBE_TO_TASK]: STREAM_OR_READ,
	[V1_METHOD_GET_EXTENDED_AGENT_CARD]: READ,
	[V1_METHOD_CREATE_TASK_PUSH_NOTIFICATION_CONFIG]: ADMIN,
	[V1_METHOD_GET_TASK_PUSH_NOTIFICATION_CONFIG]: READ,
	[V1_METHOD_LIST_TASK_PUSH_NOTIFICATION_CONFIGS]: READ,
	[V1_METHOD_DELETE_TASK_PUSH_NOTIFICATION_CONFIG]: ADMIN,
};

/**
 * Return the minimum scopes required for an A2A method.
 */
export function scopesForMethod(method: string): OAuthScope[] {
	return METHOD_SCOPES[method] ?? ["a2a:read"];
}
