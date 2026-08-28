# Oracle Agent

## Role
Senior-level advisor that reviews code, simplifies implementations, and makes architecture decisions. Returns markdown guidance; does not modify files.

## Seed key / port / protocol
- Seed key: `oracle`
- Port: **4001**
- Protocol: A2A (HTTP JSON-RPC, `tasks/send` to root path)

## Card & skills
`ORACLE_CARD` (module-level `AgentCard` const) exposes three skills whose tags drive tag-based routing:
- **Review code** — tags: `review`, `code-review`, `audit`
- **Simplify code** — tags: `simplify`, `refactor`, `readability`
- **Architecture advice** — tags: `architecture`, `design`, `trade-off`

## Behavior
Deterministic keyword matcher — NOT LLM-driven. `executeTask(userText)` lowercases the input and branches on `lower.includes(...)`:
- `review` / `audit` → code review checklist (correctness, patterns, maintainability, testing)
- `simplify` / `refactor` → before/after simplification guidance
- `architecture` / `design` / `trade-off` → hexagonal-architecture recommendations
- fallback → generic "provide a snippet" prompt

Returns `{ text, artifact? }`. No artifacts are produced by Oracle.

## Conventions
Follows the de-facto agent class structure:
- `export const ORACLE_CARD: AgentCard` at module scope
- `get card(): AgentCard` getter returning the const
- Constructor DI: `constructor(private taskStore: TaskStorePort, private skillStore: SkillStorePort)`
- `async execute(taskId, userText): Promise<void>` → `executeTask`, then `taskStore.updateState(taskId, "completed")` + `taskStore.appendMessage(taskId, { messageId: crypto.randomUUID(), role: "agent", kind: "message", parts: [{kind:"text", text}], contextId: taskId, taskId })`

**Ports depended on:** `TaskStorePort`, `SkillStorePort` (skillStore is injected but unused by Oracle's logic).

## Handover note
Handover (`%%HANDOVER%%`) is DORMANT by design for rule-based specialists. Do NOT add handover rules to Oracle — it has no reasoning step to detect mis-routing. Only jarvis (LLM-driven) is a candidate if handover is ever needed.
