# Explorer Agent

## Role
Fast reconnaissance specialist that finds files, maps project structure, and searches code. Returns a static project map / guidance; does not perform real filesystem operations itself (delegates to MCP tools).

## Seed key / port / protocol
- Seed key: `explorer`
- Port: **4003**
- Protocol: A2A (HTTP JSON-RPC, `tasks/send` to root path)

## Card & skills
`EXPLORER_CARD` (module-level `AgentCard` const) exposes three skills whose tags drive tag-based routing:
- **Find files** — tags: `find`, `files`, `locate`
- **Map structure** — tags: `map`, `structure`, `overview`
- **Search code** — tags: `grep`, `search`, `pattern`, `code-search`

## Behavior
Deterministic keyword matcher — NOT LLM-driven. `executeTask(userText)` lowercases input and branches on `lower.includes(...)`:
- `find` / `where` / `file` → file-discovery guidance pointing at MCP `read_file` / `list_skills`
- `map` / `structure` / `overview` / `architecture` → a hardcoded **Project Map** of the Jabr repo (agents/, mcp-servers/, scripts/, skills/, memory/) plus a note about the 6 agents on ports 4000–4005
- `grep` / `search` / `pattern` → code-search guidance pointing at MCP tools
- fallback → "Explorer ready" menu

Returns a plain `string` (no artifacts).

## Conventions
Follows the de-facto agent class structure:
- `export const EXPLORER_CARD: AgentCard` at module scope
- `get card(): AgentCard` getter
- Constructor DI: `constructor(private taskStore: TaskStorePort)` — minimal, only the task store
- `async execute(taskId, userText): Promise<void>` → `executeTask`, then `updateState("completed")` + `appendMessage` with `crypto.randomUUID()` messageId

**Ports depended on:** `TaskStorePort` only.

## Handover note
Handover (`%%HANDOVER%%`) is DORMANT by design for rule-based specialists. Do NOT add handover rules to Explorer. Only jarvis (LLM-driven) is a candidate if handover is ever needed.
