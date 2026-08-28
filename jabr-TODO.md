# Jabr — Gap Tasks (v0.3.0 → v0.4.0)

## GAP-1 · Kill `ROUTING_TABLE` — pure tag routing
**File**: `agents/core/orchestrator.ts`
**Problem**: `routeTask()` checks `ROUTING_TABLE` first, only falls through to `DynamicRegistry.matchAgent()` on miss. Keyword table is dead weight — `DynamicRegistry` already has tag-matching from PnP kit.
**Task**:
- Delete `ROUTING_TABLE` export and the `for` loop in `routeTask()`
- `routeTask()` becomes: `dynamicRegistry.matchAgent(text) ?? { agentName: "librarian", label: "Librarian Agent" }`
- Add `tags` to every `AgentSkill` in each specialist `run/*.ts` entry point (they seed the registry)
- Confirm `bun run typecheck` passes
- Update `AGENTS.md` routing section

---

## GAP-2 · Live-wire `jabr://world-state` — real agent health ✅
**File**: `mcp-servers/tools.ts`
**File**: `mcp-servers/tools.ts`
**Problem**: `getWorldState` callback returns `agents: []` — no live data from the running orchestrator. Tasks count from `memory/task-*.json` files (stale on disk), not in-memory `TaskStorePort`.
**Task**:
- Expose a lightweight HTTP endpoint on Orchestrator (e.g. `GET /state`) returning `{ agents, tasks }` from live in-memory stores
- `getWorldState` in `tools.ts` fetches `ORCHESTRATOR_URL/state` (with 1s timeout + fallback empty)
- `agents[]` shape: `{ name, port, status: "up"|"down", lastSeen: ISO }`
- Wire health-check pings in `DynamicRegistry` → update `lastSeen` on each successful card fetch
- `tasks` counts from live `TaskStorePort` snapshot (pass callback into `registerResources`)

---

## GAP-3 · Demo script — reflect 6-agent topology
**File**: `scripts/demo.ts`
**Problem**: Demo still tests 3-agent layout (Coder / Researcher / Orchestrator). Agents renamed and split into Oracle / Librarian / Explorer / Designer / Fixer.
**Task**:
- Replace all references: Coder→Fixer (4005), Researcher→Librarian (4002)
- Add card-discovery checks for Explorer (4003), Oracle (4001), Designer (4004)
- Add routing test: "find all TODO comments" → must route to Explorer
- Add routing test: "review this function for edge cases" → must route to Oracle
- Add consensus test: `discover` method → returns all 5 specialist cards
- Add handover test: send task with `%%HANDOVER%%` in mock response, verify depth counter
- Keep skill-persistence and memory checks

---

## GAP-4 · `run_python` — persistent uv venv + dependency support ✅
**File**: `mcp-servers/tools.ts`
**File**: `mcp-servers/tools.ts`
**Problem**: Each `run_python` call writes a temp `.py` and runs `uv run --quiet`. No way to install packages — `import numpy` fails silently. Each call is fully isolated (good for security, bad for data science tasks).
**Task**:
- Add `packages` param: `{ code: string, packages?: string[] }`
- When `packages` present: `uv run --with numpy,pandas --quiet tmpPath`
- Add `run_python_file` tool: `{ path: string, packages?: string[] }` — runs a workspace `.py` file directly (no tmp copy)
- Add `python_repl` tool: persists a `uv` venv at `./tmp/jabr-venv/`, runs code inside it, shares state across calls in the same session
- 30s timeout for package installs, 10s for plain code
- Sanitize `packages` list: alphanumeric + `-_.` only

---

## GAP-5 · Python agent layer — `agents/run/scientist.ts`
**File**: new `agents/run/scientist.ts` + `agents/core/scientist.ts`
**Problem**: Python capability exists only as an MCP tool (`run_python`). No dedicated A2A agent for data science / scripting tasks. Fixer handles Python requests via keyword match — wrong specialist.
**Task**:
- New Scientist Agent on port 4006
- Skills: `data-analysis`, `script-generation`, `statistical-modeling`, `visualization`
- Tags: `python`, `data`, `analysis`, `pandas`, `numpy`, `plot`, `csv`, `statistics`
- `core/scientist.ts`: generates Python scripts for data tasks, delegates execution to MCP `run_python` (via `AgentRegistryPort.callMcpTool`)
- Add port `McpToolPort` interface: `callTool(name, args): Promise<string>`
- Adapter: `adapters/mcp-client.ts` — MCP client that connects to `jabr-tools` stdio server
- Add `scientist` to `dev` script: `bun run --parallel ... scientist`
- Add Scientist routing keywords to `DynamicRegistry` seed

---

## GAP-6 · Sampling → provider-agnostic LLM port (SEP-2577 migration)
**Files**: `agents/core/cognitive-loop.ts`, `agents/core/orchestrator.ts`, new `agents/ports/llm-port.ts`, new `agents/adapters/llm/`
**Problem**: ADR flags `sampling/createMessage` deprecated (SEP-2577, 12-month grace from 2026-07-28). Cognitive loop uses simulated scoring — no real LLM call for consensus synthesis. Must be fully provider-agnostic — no vendor lock-in.

**Design — `LlmPort` (Vercel AI SDK compatible)**:
```ts
// agents/ports/llm-port.ts
export interface LlmMessage { role: "user" | "assistant"; content: string }
export interface LlmUsage { inputTokens: number; outputTokens: number }
export interface LlmResult { text: string; usage: LlmUsage }

export interface LlmPort {
  complete(messages: LlmMessage[], opts?: { maxTokens?: number; system?: string }): Promise<LlmResult>
  readonly providerName: string  // "openai" | "google" | "ollama" | "openrouter" | ...
}
```

**Adapters** — one file per provider, all implement `LlmPort`:
- `agents/adapters/llm/openai.ts` — `JABR_OPENAI_BASE_URL` + `JABR_OPENAI_API_KEY` + `JABR_OPENAI_MODEL` (covers OpenAI, OpenRouter, any OpenAI-compatible endpoint)
- `agents/adapters/llm/google.ts` — `JABR_GOOGLE_API_KEY` + `JABR_GOOGLE_MODEL` (Gemini via `@google/generative-ai`)
- `agents/adapters/llm/ollama.ts` — `JABR_OLLAMA_URL` (default `http://localhost:11434`) + `JABR_OLLAMA_MODEL` — fully local, zero API key
- `agents/adapters/llm/openrouter.ts` — thin wrapper over `openai.ts` with `JABR_OPENROUTER_API_KEY`, base URL `https://openrouter.ai/api/v1`

**Factory** `agents/adapters/llm/factory.ts`:
```ts
// JABR_LLM_PROVIDER=ollama|openai|google|openrouter  (default: ollama)
export function createLlmAdapter(): LlmPort { ... }
```

**Wire**:
- `CognitiveLoop` constructor accepts `llm?: LlmPort` — when present, uses it for Judge synthesis step
- `executeConsensus()` passes `llm` from composition root (`run/orchestrator.ts`)
- Gate behind `JABR_CONSENSUS_LLM=true` — default off (weighted scoring still works without LLM)
- Remove all `sampling/createMessage` references

**Default recommended**: `ollama` adapter + `qwen2.5-coder:7b` — zero cost, works offline, runs on same machine as Bun agents

---

## GAP-7 · Mem-Palace integration
**What it is**: Mem-Palace is a structured long-term memory layer — hierarchical knowledge graph stored as markdown + JSON, queryable by embedding similarity or tag intersection. Distinct from Hermes `memory.md` (append-only log).
**Files**: new `agents/adapters/mem-palace.ts`, `agents/ports/knowledge-port.ts`
**Task**:
- `KnowledgePort` interface: `store(key, content, tags): Promise<void>`, `query(text, topK?): Promise<KnowledgeEntry[]>`, `relate(keyA, keyB, relation): Promise<void>`
- `MemPalaceAdapter`: stores entries as `memory/palace/<slug>.json` with `{ content, tags, embedding?: number[], createdAt, relations: string[] }`
- Embedding: call `run_python` MCP tool with `sentence-transformers` (uv inline) to compute cosine-similar retrieval — or stub with BM25 tag overlap until embeddings land
- Wire into `OrchestratorAgent`: before routing, `query(userText, 3)` → prepend top results as context to the delegated task
- Wire into Librarian: after research task, `store(slug, summary, tags)` → persistent knowledge node
- Expose as MCP resource: `jabr://palace/{slug}` and `jabr://palace/query?q={text}`
- CLI tool `scripts/palace.ts`: `bun scripts/palace.ts query "A2A handover"` for manual inspection

---

## GAP-8 · Headroom integration ✅
**What it is**: Headroom is a rate-limit + budget-awareness layer for LLM calls — tracks token usage per agent, enforces per-session caps, emits warnings before hitting provider limits. Prevents runaway consensus loops from burning quota.
**Files**: new `agents/adapters/headroom.ts`, `agents/ports/budget-port.ts`
**Task**:
- `BudgetPort` interface: `consume(agentName, tokens): Promise<void>`, `remaining(agentName): Promise<number>`, `isExhausted(agentName): boolean`, `reset(): void`
- `HeadroomAdapter`: in-memory per-agent token counters, configurable caps via `JABR_TOKEN_CAP_<AGENT>=<n>` env vars (default 100k/session)
- Integrate into `LlmPort` adapters (GAP-6): each adapter returns `LlmUsage` with `inputTokens + outputTokens` → call `budget.consume()` after every `complete()` call
- Integrate into `AgentRegistryPort.delegateTask()`: check `budget.isExhausted()` before HTTP call → throw `BudgetExhaustedError` with agent name + remaining
- Orchestrator catches `BudgetExhaustedError`: reroutes to next best agent via `DynamicRegistry` tag match (skip exhausted agent)
- Expose budget state in `jabr://world-state` resource: add `budget: { [agentName]: { used, cap, pct } }`
- Add `GET /budget` endpoint on Orchestrator for live inspection

---

## GAP-9 · `ROUTING_TABLE` removal cleanup sweep
**Depends on**: GAP-1
**Files**: `AGENTS.md`, `README.md`, `opencode.json`, `agents/run/orchestrator.ts`
**Task**:
- After GAP-1 lands, grep for any remaining `ROUTING_TABLE` references
- Update `AGENTS.md` notes section (currently documents keyword routing)
- Update `README.md` routing description
- Ensure `run/orchestrator.ts` seeds `DynamicRegistry` with all 6 specialist ports on startup

---

## Priority order

| # | Task | Effort | Blocks |
|---|------|--------|--------|
| GAP-1 | Kill ROUTING_TABLE | S | GAP-9 |
| GAP-3 | Fix demo script | S | — |
| GAP-2 | Live world-state | M | — |
| GAP-4 | uv packages support | M | GAP-5 |
| GAP-5 | Scientist agent | M | GAP-4 |
| GAP-6 | Provider-agnostic LlmPort + consensus | M | GAP-8 |
| GAP-7 | Mem-Palace | L | — |
| GAP-8 | Headroom | M | GAP-6 |
| GAP-9 | Cleanup sweep | S | GAP-1 |
