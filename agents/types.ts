// ─── Domain types ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  url: string;
  version: string;
  port: number;
}

// ─── A2A (Agent-to-Agent) types ───────────────────────────────────────────────

export interface AgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  inputModes: string[];
  outputModes: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: AgentCardCapabilities;
  skills: AgentSkill[];
}

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export interface A2ATaskStatus {
  state: TaskState;
  timestamp: string;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  history: A2AMessage[];
  artifacts?: A2AArtifact[];
}

export type A2AMessageRole = "user" | "agent";

export interface A2AMessage {
  messageId: string;
  role: A2AMessageRole;
  kind: "message";
  parts: A2APart[];
  contextId: string;
  taskId?: string;
}

export type A2APart =
  | { kind: "text"; text: string }
  | { kind: "data"; data: Record<string, unknown>; mimeType?: string };

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  parts: A2APart[];
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
