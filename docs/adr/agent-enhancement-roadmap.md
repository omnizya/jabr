# ADR: Agent-Lab Enhancement Roadmap (V1)

**Status**: Proposed
**Date**: 2026-08-27
**Context**: After initial Hexagonal refactor and protocol research (MCP, ACP, A2A), the system needs a structured path to move from a basic specialist-router to a high-fidelity multi-agent ecosystem.

---

## 1. Live Context Kit (MCP Evolution)
**Goal**: Move from passive "pull" context to active "push" context.

### Specifications

- **MCP Resource Subscriptions**:
  - Implement `subscriptions/listen` in `mcp-servers/tools.ts` (replaces the removed `resources/subscribe` RPC).
  - The Orchestrator will maintain a `SubscriptionManager` tracking which agents are interested in which file patterns.
  - On `notifications/resources/updated`, the Orchestrator pushes updated content to the relevant agent's context.
- **Global World-State Resource**:
  - A virtual MCP resource (`res://system/state`) that returns a JSON summary of active tasks, agent health, and current goals.
  - Agents can read this to synchronize their behavior with the global objective.

> **Protocol Fact/Justification**
>
> The MCP 2026-07-28 specification removed the standalone `resources/subscribe` and `resources/unsubscribe` RPC methods. Subscriptions are now handled through a unified `subscriptions/listen` request that opens a long-lived notification stream. The client sends:
>
> ```json
> {
>   "jsonrpc": "2.0",
>   "id": 1,
>   "method": "subscriptions/listen",
>   "params": {
>     "notifications": {
>       "resourcesListChanged": true,
>       "resourceSubscriptions": ["file:///project/src/main.rs"]
>     }
>   }
> }
> ```
>
> The server **MUST** acknowledge with `notifications/subscriptions/acknowledged` before any notification is sent, tagging the stream with `io.modelcontextprotocol/subscriptionId` in `_meta`. When a watched resource changes, the server delivers:
>
> ```json
> {
>   "jsonrpc": "2.0",
>   "method": "notifications/resources/updated",
>   "params": {
>     "_meta": { "io.modelcontextprotocol/subscriptionId": 1 },
>     "uri": "file:///project/src/main.rs"
>   }
> }
> ```
>
> The client then re-reads the resource with `resources/read`. Two distinct notification types exist:
> - `notifications/resources/list_changed` — the **set** of available resources changed (capability flag: `resources.listChanged`)
> - `notifications/resources/updated` — a **specific** resource's content changed (capability flag: `resources.subscribe`)
>
> The server advertises both capabilities in its capability declaration:
> ```json
> { "capabilities": { "resources": { "subscribe": true, "listChanged": true } } }
> ```
>
> **Implementation note for Jabr**: The current `mcp-servers/tools.ts` uses `@modelcontextprotocol/sdk/server/mcp.js` which handles the subscription stream internally. To expose resource subscriptions, we need to register resources (not just tools) via `server.registerResource()` and declare the `subscribe` capability. The `SubscriptionManager` in the Orchestrator should correlate `subscriptionId` values to agent interest sets for targeted push delivery.
>
> *Sources: MCP Specification 2026-07-28, Resources section; MCP Subscriptions pattern; ChatForest MCP Notifications Guide (2026-03-28)*

---

## 2. Cognitive Loop Kit (Reasoning Evolution)
**Goal**: Implement iterative, recursive reasoning patterns.

### Specifications

- **MCP Sampling with Tools (SEP-1577)**:
  - Implement the Sampling capability (SEP-1577).
  - When a tool returns a "complex" result, the server can trigger a `sampling/createMessage` request to the LLM to interpret the result *before* returning it to the main agent.
- **Consensus Mechanisms**:
  - **The Judge Pattern**: Orchestrator sends critical tasks to N agents → collects responses → dispatches a "Consensus Task" to the Oracle to synthesize the final answer.
  - **Weighted Voting**: Assign confidence scores to agent responses based on their `successRate` from the Agent Card.

> **Protocol Fact/Justification**
>
> SEP-1577 (Status: Final, 2025-09-30) introduced `tools` and `toolChoice` parameters to `sampling/createMessage`, enabling MCP servers to run agentic tool-use loops using the client's LLM tokens. The request/response cycle works as follows:
>
> **Step 1 — Server sends sampling request with tools:**
> ```json
> {
>   "jsonrpc": "2.0",
>   "id": 1,
>   "method": "sampling/createMessage",
>   "params": {
>     "messages": [{ "role": "user", "content": { "type": "text", "text": "Analyze this codebase..." } }],
>     "tools": [{
>       "name": "read_file",
>       "description": "Read a file from the workspace",
>       "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }
>     }],
>     "toolChoice": { "mode": "auto" },
>     "maxTokens": 4096
>   }
> }
> ```
>
> **Step 2 — LLM responds with tool calls** (stopReason: `"toolUse"`):
> The `CreateMessageResult.content` contains `ToolUseContent` blocks:
> ```json
> {
>   "role": "assistant",
>   "content": [{ "type": "tool_use", "id": "call_abc123", "name": "read_file", "input": { "path": "src/main.ts" } }],
>   "stopReason": "toolUse"
> }
> ```
>
> **Step 3 — Server executes tools locally, sends results back:**
> Every assistant `ToolUseContent` MUST be balanced by a user `ToolResultContent` in the next message:
> ```json
> {
>   "jsonrpc": "2.0",
>   "id": 2,
>   "method": "sampling/createMessage",
>   "params": {
>     "messages": [
>       { "role": "user", "content": { "type": "text", "text": "Analyze this codebase..." } },
>       { "role": "assistant", "content": [{ "type": "tool_use", "id": "call_abc123", "name": "read_file", "input": { "path": "src/main.ts" } }] },
>       { "role": "user", "content": [{ "type": "tool_result", "toolUseId": "call_abc123", "content": [{ "type": "text", "text": "..." }] }] }
>     ],
>     "tools": [{ "name": "read_file", "description": "...", "inputSchema": {} }],
>     "maxTokens": 4096
>   }
> }
> ```
>
> The loop continues until `stopReason: "endTurn"`. `toolChoice.mode` controls behavior: `"auto"` (model decides), `"required"` (must use tools), `"none"` (forbidden). This is fenced by `clientCapabilities.sampling.tools`.
>
> **⚠️ Deprecation notice**: As of MCP 2026-07-28 (SEP-2577), Sampling is deprecated with a 12-month grace period. New implementations should migrate to direct LLM provider API integration. However, for Jabr's architecture where the MCP server runs inside a controlled environment, the sampling-with-tools pattern remains valuable as a design reference for recursive reasoning — the key insight (server-initiated tool loops with LLM backends) can be replicated via direct API calls even after sampling removal.
>
> **Message content constraint**: When a user message contains `tool_result` blocks, it **MUST** contain ONLY tool results — no mixing with text/image/audio. This mirrors Claude API's dedicated tool role and OpenAI's `tool` role.
>
> *Sources: SEP-1577 (Final, 2025-09-30); MCP Specification 2025-11-25, Sampling section; SEP-2577 (Sampling deprecated in 2026-07-28)*

---

## 3. IDE-Native Kit (ACP Evolution)
**Goal**: Deeply integrate agent outputs into the developer's workflow.

### Specifications

- **Multi-File Diff Streaming**:
  - Extend `stdio-bridge.ts` to support ACP's native `diff` content type within `tool_call_update` notifications.
  - Instead of `write_file`, agents emit structured diffs: `{ type: "diff", changes: [{ operation: "modify", path: "...", fileType: "text" }], patch: { format: "git_patch", text: "..." } }`.
  - This allows the IDE to render real-time "ghost" edits using the same `session/update` notification stream.
- **Stateful Session Handover**:
  - Implement `session/list` and `session/delete` in the ACP adapter.
  - Store session metadata (cursor position, open files, task history) in `MemoryStorePort`.
  - Allow the Orchestrator to "migrate" a session from one ACP connection to another via `session/resume` with `replayFrom`.

> **Protocol Fact/Justification**
>
> **Diff Streaming**: ACP defines a first-class `diff` content type for tool call results. Agents report diffs through `session/update` notifications with `sessionUpdate: "tool_call_update"`. The structured diff format includes:
>
> ```json
> {
>   "type": "diff",
>   "changes": [
>     {
>       "operation": "modify",
>       "path": "/home/user/project/src/config.json",
>       "fileType": "text",
>       "mimeType": "application/json"
>     }
>   ],
>   "patch": {
>     "format": "git_patch",
>     "text": "diff --git a/src/config.json b/src/config.json\n..."
>   }
> }
> ```
>
> Supported operations: `add`, `delete`, `modify`, `move`, `copy`. The `changes` array is authoritative; `patch` is optional renderable text (agents SHOULD provide it). This is not a custom extension — it's defined in the ACP spec's tool-calls section. The notification flow uses `tool_call_update` (upsert by `toolCallId`) and `tool_call_content_chunk` for streaming incremental content.
>
> **Session Handover**: ACP v2 requires `session/list` when the `session` capability is advertised (no longer optional in v2). The method returns:
>
> ```json
> {
>   "jsonrpc": "2.0",
>   "id": 2,
>   "result": {
>     "sessions": [
>       {
>         "sessionId": "sess_abc123def456",
>         "cwd": "/home/user/project",
>         "title": "Implement session list API",
>         "updatedAt": "2025-10-29T14:22:15Z",
>         "_meta": { "messageCount": 12, "hasErrors": false }
>       }
>     ],
>     "nextCursor": "eyJwYWdlIjogMn0="
>   }
> }
> ```
>
> `session/delete` is capability-gated behind `session.delete: {}` in the initialize response. On success it returns `{}`. Deleted sessions no longer appear in `session/list`.
>
> **Key v2 change**: `session/load` was removed. `session/resume` now handles both cases:
> - Without `replayFrom`: restores context without replaying history
> - With `replayFrom: { "type": "start" }`: replays entire conversation as `session/update` notifications before responding
>
> For session migration between ACP connections, the Orchestrator can call `session/resume` on the new connection with `replayFrom: { "type": "start" }` to reconstruct the full conversation state. The `sessionId` is the stable identifier that persists across connections.
>
> *Sources: ACP Protocol v2 Specification (agentclientprotocol.com); ACP v2 Session Setup RFD; ACP v2 Migration Guide; ACP v2 Tool Calls section (diff content type)*

---

## 4. Plug-and-Play (PnP) Kit (A2A Evolution)
**Goal**: Zero-config agent onboarding.

### Specifications

- **Dynamic Agent Registry**:
  - Replace hardcoded `agentUrls` in `run/orchestrator.ts` with a `DynamicRegistry` class.
  - At startup, the registry fetches `/.well-known/agent-card.json` from a set of seed URLs.
  - The Orchestrator routes based on `AgentCard.skills` matching rather than hardcoded keyword lists.
- **A2A Handover Protocol**:
  - Implement a `HandoverTask` type.
  - When Agent A determines it is the wrong specialist, it emits a `transfer` signal containing the current `TaskState` and `Artifacts`.
  - The Orchestrator transparently re-routes the task to Agent B without user intervention.

> **Protocol Fact/Justification**
>
> **Dynamic Registry**: The A2A v1.0 specification defines `/.well-known/agent-card.json` as the standard discovery endpoint (per RFC 8615). The `AgentCard` schema is:
>
> ```typescript
> interface AgentCard {
>   name: string;                    // Required
>   description: string;             // Required
>   version: string;                 // Required
>   supportedInterfaces: AgentInterface[];  // Required (replaces old top-level `url`)
>   capabilities: AgentCapabilities;        // Required
>   defaultInputModes: string[];     // Required
>   defaultOutputModes: string[];    // Required
>   skills: AgentSkill[];            // Required, non-empty
>   provider?: AgentProvider;
>   documentationUrl?: string;
>   securitySchemes?: Record<string, SecurityScheme>;
>   signatures?: AgentCardSignature[];
>   iconUrl?: string;
> }
>
> interface AgentSkill {
>   id: string;           // Required
>   name: string;         // Required
>   description: string;  // Required
>   tags: string[];       // Required (non-empty in v1.0)
>   examples?: string[];
>   inputModes?: string[];
>   outputModes?: string[];
> }
>
> interface AgentCapabilities {
>   streaming?: boolean;
>   pushNotifications?: boolean;
>   extensions?: AgentExtension[];
>   extendedAgentCard?: boolean;
> }
> ```
>
> For keyword-less routing, the `DynamicRegistry` should match incoming tasks against `AgentSkill.tags` and `AgentSkill.description` using semantic similarity or keyword extraction, rather than the current hardcoded `ROUTING_TABLE` in `agents/core/orchestrator.ts` (lines 8–43). The `skills[].tags` field (required, non-empty in v1.0) provides the primary routing signal — e.g., `["debug", "fix", "repair"]` for the Fixer agent.
>
> **Current gap**: The existing `AgentCard` type in `agents/types.ts` uses the v0.x schema (top-level `url`, `skills[].inputModes/outputModes` without `tags`). The v1.0 schema moves `url` into `supportedInterfaces[].url` and requires `tags` on every skill. This is a breaking type change.
>
> **Handover**: A2A v1.0 defines the `Task` object as:
>
> ```typescript
> interface Task {
>   id: string;                    // Required — unique task identifier
>   contextId: string;             // Groups multiple tasks/messages
>   status: TaskStatus;            // Required — state + timestamp + optional message
>   artifacts?: Artifact[];        // Output artifacts
>   history?: Message[];           // Interaction history
>   metadata?: Record<string, unknown>;
> }
>
> interface TaskStatus {
>   state: TaskState;              // Required
>   message?: Message;             // Optional status message
>   timestamp: string;             // ISO 8601 UTC
> }
> ```
>
> Task states: `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_REJECTED`, `TASK_STATE_AUTH_REQUIRED`.
>
> The handover transfer object should contain:
> - `taskId` — the original task identifier
> - `contextId` — preserves conversation grouping across handovers
> - `history` — the `Message[]` array containing the conversation so far
> - `artifacts` — any partial outputs from the original agent
> - `referenceTaskIds` — the `Message.referenceTaskIds` field lets the receiving agent correlate with prior tasks in the same context
>
> The Orchestrator acts as the handover coordinator: when Agent A returns `TASK_STATE_INPUT_REQUIRED` with a message indicating wrong-specialist, the Orchestrator uses the `contextId` to create a new task with Agent B, passing `referenceTaskIds: [originalTaskId]` in the initial message so Agent B can request the original task's state via `GetTask` if needed.
>
> *Sources: A2A Protocol v1.0 Specification (a2a-protocol.org/v1.0.0/specification); A2A Agent Card Schema Reference (agentcard.net); A2A proto definitions (spec/a2a.proto); RFC 8615 (Well-Known URIs)*

---

## Implementation Priority
1. **PnP Kit** (Enables rapid scaling of specialists)
2. **Live Context Kit** (Fundamental for long-running coding tasks)
3. **IDE-Native Kit** (Crucial for UX/Productivity)
4. **Cognitive Loop Kit** (Advanced reasoning, higher risk; note Sampling deprecation — evaluate direct LLM API integration as alternative)
