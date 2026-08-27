// ─── Domain types ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  url: string;
  version: string;
  port: number;
}

// ─── A2A (Agent-to-Agent) v1.0 types ──────────────────────────────────────────

export type AgentInterfaceType = "http" | "grpc"

export interface AgentInterface {
  type: AgentInterfaceType
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
  name: string
  description: string
  tags: string[];
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
  | { kind: "data"; data: Record<string, unknown>; mimeType?: string };

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  parts: A2APart[];
}

// ─── Handover Protocol ────────────────────────────────────────────────────────

export const HANDOVER_MARKER = "%%HANDOVER%%";

export interface HandoverRequest {
  transferTo: string; // Agent name to transfer to. TODO: infer agent names to force and not to have unknown agent set.
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

// ── MCP Resource Types ──────────────────────────────────────────────────────

/** A resource represents a read-only data endpoint exposed via MCP */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Result from reading an MCP resource */
export interface McpResourceContent {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

/** A subscription to resource changes */
export interface ResourceSubscription {
  id: string;
  uri: string;
  listenerId?: string;
  createdAt: string;
}

/** World-state snapshot returned by the system resource */
export type WordStateAgentStatus = "online" | "offline" | "unknown"
export interface WordStateAgent {
  name: string
  port: number
  status: WordStateAgentStatus
  skills: string[]
}
export interface WordStateTasks {
  total: number;
  active: number;
  completed: number;
  failed: number;
};

export interface Memory {
  totalEntries: number;
  lastUpdated?: string;
};
export interface Skills {
  total: number;
  recentSlugs: string[];
};
export interface WorldState {
  timestamp: string;
  agents: Array<WordStateAgent>;
  tasks: WordStateTasks;
  memory: Memory;
  skills: Skills;
}

export interface A2AServerConfig {
  port: number;
  card: AgentCard;
  onTask: (message: string) => Promise<string>;
}
export interface RegistryEntry {
  url: string;
  card: AgentCard;
  tags: string[];
}
