export interface AgentConfig {
  name: string
  description: string
  url: string
  version: string
  port: number
}

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
  url: string;
  version: string;
  capabilities: AgentCardCapabilities;
  skills: AgentSkill[];
  supportedInterfaces?: AgentInterface[];
  successRate?: number
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

export const HANDOVER_MARKER = "%%HANDOVER%%";

export interface HandoverRequest {
  transferTo: string
  reason: string
  context: string
}

export function encodeHandover(req: HandoverRequest): string {
  return `${HANDOVER_MARKER}${JSON.stringify(req)}`;
}

export function decodeHandover(text: string): HandoverRequest | null {
  const idx = text.indexOf(HANDOVER_MARKER);
  if (idx === -1) return null;
  try {
    return JSON.parse(text.slice(idx + HANDOVER_MARKER.length)) as HandoverRequest;
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

export type WorldStateAgentStatus = "online" | "offline" | "unknown"
export interface WorldStateAgent {
  name: string
  port: number
  status: WorldStateAgentStatus
  skills: string[]
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

export interface A2AServerConfig {
  port: number;
  card: AgentCard;
  onTask: (message: string) => Promise<string>;
  /** Shared secret token; when set and requireAuth is true, X-API-Key must match */
  authToken?: string;
  /** Whether to enforce API key validation on POST / */
  requireAuth?: boolean;
}
export interface RegistryEntry {
  url: string;
  card: AgentCard;
  tags: string[];
}
