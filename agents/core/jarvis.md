# Jarvis Agent

## Role
Proactive codebase steward — scans for improvements, generates agent profiles, watches dependencies, identifies test gaps, syncs docs, and surfaces AI/automation opportunities. The only specialist (besides the orchestrator's consensus loop) that is genuinely LLM-driven.

## Seed key / port / protocol
- Seed key: `jarvis`
- Port: **1337**
- Protocol: A2A (HTTP JSON-RPC)

## Card & skills
`JARVIS_CARD` (module-level `AgentCard` const) exposes six skills whose tags drive tag-based routing:
- **Codebase scan** — tags: `scan`, `audit`, `anti-pattern`, `dead-code`, `complexity`, `security`
- **Profile generation** — tags: `profile`, `agent-profile`, `skill-creation`, `pattern`
- **Dependency watch** — tags: `dependency`, `outdated`, `security`, `audit`, `package`
- **Test gap analysis** — tags: `test`, `coverage`, `edge-case`, `flaky`, `gap`
- **Doc sync** — tags: `doc`, `readme`, `adr`, `changelog`, `drift`
- **AI enhancement** — tags: `ai`, `llm`, `automation`, `agentic`, `enhancement`

## Behavior
Hybrid: a thin keyword router in `execute(taskId, userText)` selects a sub-report, but the heavy lifting is LLM-backed. `execute` lowercases input and branches on `lower.includes(...)`:
- `scan` / `steward` → `steward(workspace)` (runs all five sub-reports in parallel via `Promise.all`)
- `dependency` / `package` → `watchDependencies` (reads `package.json` via MCP `read_file`, queries `search` for latest versions)
- `test` / `coverage` → `analyzeTestGaps` (LLM prompt → JSON)
- `doc` / `readme` → `syncDocs` (LLM prompt → JSON)
- `ai` / `automat` → `identifyAIEnhancements` (LLM prompt → JSON)
- fallback → prints a "Jarvis ready" command list

LLM calls (`this.llm.generate(...)`) return structured JSON parsed by `extractJson`. Findings are persisted to `knowledge` (guarded) and synced to kanban via `syncFindingsToKanban` (guarded by `if (this.kanban)`). `steward` returns a `StewardReport` aggregating all sub-reports.

## Conventions
Follows the de-facto agent class structure:
- `export const JARVIS_CARD: AgentCard` at module scope
- `get card(): AgentCard` getter
- Constructor DI (the widest of any agent): `constructor(private llm: LlmPort, private search: SearchPort, private mcpTools: McpToolPort, private skillStore: SkillStorePort, private knowledge?: KnowledgePort, private budget?: BudgetPort, private kanban?: KanbanPort)`
- `async execute(taskId, userText): Promise<void>` → routes to a sub-report and `console.log`s the summary (writes task output via `taskStore.updateState` / `appendMessage`)

**Ports depended on:** `LlmPort` (required), `SearchPort`, `McpToolPort`, `SkillStorePort`, `KnowledgePort` (optional), `BudgetPort` (optional, injected but unused), `KanbanPort` (optional).

## Handover note
Jarvis is the LLM-driven agent and therefore the ONLY specialist that is a realistic candidate for the dormant `%%HANDOVER%%` mechanism — it can genuinely reason about mis-routing. No handover rules are wired today; add them here first if the feature is activated.
