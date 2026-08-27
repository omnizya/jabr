// ─── Domain types ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  url: string;
  version: string;
  port: number;
}

// ─── A2A (Agent-to-Agent) v1.0 types ──────────────────────────────────────────

export interface AgentInterface {
  type: string; // e.g. "http", "grpc"
  url: string;
}

export interface AgentCardCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  extensions?: AgentExtension[];
  extendedAgentCard?: boolean;
}

export interface AgentExtension {
  uri: string;
  description?: string;
}

export interface AgentSkill {
  name: string; // Required
  description: string; // Required
  tags: string[]; // Required (non-empty in v1.0)
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  url: string; // Canonical URL (kept for backwards compat; canonical endpoint)
  version: string;
  capabilities: AgentCardCapabilities;
  skills: AgentSkill[];
  supportedInterfaces?: AgentInterface[]; // v1.0: preferred over top-level url
}

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "auth-required";

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

export type A2AMessageRole = "user" | "agent";

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
  | { kind: "data"; data: Record<string, unknown>; mimeType?: string };

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  parts: A2APart[];
}

// ─── Handover Protocol ────────────────────────────────────────────────────────

export const HANDOVER_MARKER = "%%HANDOVER%%";

export interface HandoverRequest {
  transferTo: string; // Agent name to transfer to
  reason: string; // Why the transfer is needed
  context: string; // Relevant context for the next agent
}

/** Encode a handover signal into a text string. */
export function encodeHandover(req: HandoverRequest): string {
  return `${HANDOVER_MARKER}${JSON.stringify(req)}`;
}

/** Decode a handover signal from text. Returns null if no marker found. */
export function decodeHandover(text: string): HandoverRequest | null {
  const idx = text.indexOf(HANDOVER_MARKER);
  if (idx === -1) return null;
  try {
    return JSON.parse(text.slice(idx + HANDOVER_MARKER.length)) as HandoverRequest;
  } catch {
    return null;
  }
}

// ─── ACP (Agent Client Protocol) types ────────────────────────────────────────

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

// ─── Skill types (self-improvement loop) ──────────────────────────────────────

export interface SkillDocument {
  name: string;
  description: string;
  tags: string[];
  steps: string[];
  createdAt: string;
  usageCount: number;
  successRate: number;
}

// ─── MCP tool types ───────────────────────────────────────────────────────────

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
