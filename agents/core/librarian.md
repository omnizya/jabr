# Librarian Agent

## Role
External-knowledge specialist that researches documentation, looks up library APIs, summarizes text, and persists reusable skills (the self-improvement loop). Returns markdown with optional citations.

## Seed key / port / protocol
- Seed key: `librarian`
- Port: **4002**
- Protocol: A2A (HTTP JSON-RPC, `tasks/send` to root path)

## Card & skills
`LIBRARIAN_CARD` (module-level `AgentCard` const) exposes three skills whose tags drive tag-based routing:
- **Lookup docs** — tags: `research`, `doc`, `api`, `library`, `how-to`
- **Summarize text** — tags: `summarize`, `summary`
- **Save skill** — tags: `skill`, `self-improvement`, `persist`

## Behavior
Deterministic keyword matcher (with async external calls) — NOT LLM-driven. `executeTask(userText)` lowercases input and branches on `lower.includes(...)`:
- `mcp` / `a2a` / `acp` → protocol research: persists a `protocol-research` skill, runs `search.search(...)`, returns MCP/A2A/ACP summary + external sources, and stores to knowledge
- `doc` / `api` / `library` / `how to` → docs lookup: persists `docs-lookup` skill, searches, returns findings
- `summarize` / `summary` → text summarization: persists `text-summarization` skill, returns bullet summary
- `skill` / `self-improv` → self-improvement loop explanation, persists `skill-creation` skill
- fallback → `general-research`: persists a skill, runs search, returns findings

Every branch calls `persistSkill(...)` (idempotent via `skillStore.exists`) and `persistKnowledge(...)` (guarded by `if (this.knowledge)`). `research()` and `formatResults()` wrap the `SearchPort`.

## Conventions
Follows the de-facto agent class structure:
- `export const LIBRARIAN_CARD: AgentCard` at module scope
- `get card(): AgentCard` getter
- Constructor DI: `constructor(private taskStore: TaskStorePort, private skillStore: SkillStorePort, private search: SearchPort, private knowledge?: KnowledgePort)`
- `async execute(taskId, userText): Promise<void>` → `await executeTask`, then `updateState("completed")` + `appendMessage` with `crypto.randomUUID()` messageId

**Ports depended on:** `TaskStorePort`, `SkillStorePort`, `SearchPort` (required), `KnowledgePort` (optional).

## Handover note
Handover (`%%HANDOVER%%`) is DORMANT by design for rule-based specialists. Do NOT add handover rules to Librarian. Only jarvis (LLM-driven) is a candidate if handover is ever needed.
