# Jabr — Gap Tasks (v0.3.0 → v0.4.0)

## GAP-1 · Kill `ROUTING_TABLE` — pure tag routing
**File**: `agents/core/orchestrator.ts`
**Problem**: `routeTask()` checks `ROUTING_TABLE` first, only falls through to `DynamicRegistry.matchAgent()` on miss. Keyword table is dead weight — `DynamicRegistry` already has tag-matching.
**Task**:
- Delete `ROUTING_TABLE` export and the `for` loop in `routeTask()`
- `routeTask()` becomes: `dynamicRegistry.matchAgent(text) ?? { agentName: "librarian", label: "Librarian Agent" }`
- Add `tags` to every `AgentSkill` in each specialist `run/*.ts` entry point
- Confirm `bun run typecheck` passes
- Update `AGENTS.md` routing section

---

## GAP-2 · Live-wire `jabr://world-state` — real agent health
**File**: `mcp-servers/tools.ts`
**Problem**: `getWorldState` callback returns `agents: []` — no live data. Tasks count from stale disk files, not in-memory `TaskStorePort`.
**Task**:
- Expose `GET /state` on Orchestrator returning `{ agents, tasks }` from live stores
- `getWorldState` fetches `ORCHESTRATOR_URL/state` (with timeout + fallback)
- `agents[]` shape: `{ name, port, status: "up"|"down", lastSeen: ISO }`
- Wire health-check pings in `DynamicRegistry` → update `lastSeen`
- `tasks` counts from live `TaskStorePort` snapshot

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

## GAP-4 · `run_python` — persistent uv venv + dependency support
**File**: `mcp-servers/tools.ts`
**Problem**: Each `run_python` call writes a temp `.py` and runs `uv run --quiet`. No way to install packages — `import numpy` fails silently.
**Task**:
- Add `packages` param: `{ code: string, packages?: string[] }`
- When `packages` present: `uv run --with numpy,pandas --quiet tmpPath`
- Add `run_python_file` tool: `{ path: string, packages?: string[] }` — runs a workspace `.py` file directly
- Add `python_repl` tool: persists a `uv` venv at `./tmp/jabr-venv/`, shares state across calls
- 30s timeout for package installs, 10s for plain code
- Sanitize `packages` list: alphanumeric + `-_.` only

---

## GAP-5 · Python agent layer — `agents/run/scientist.ts`
**File**: new `agents/run/scientist.ts` + `agents/core/scientist.ts`
**Problem**: Python capability exists only as an MCP tool (`run_python`). No dedicated A2A agent for data science. Fixer handles Python requests via keyword match — wrong specialist.
**Task**:
- New Scientist Agent on port 4006
- Skills: `data-analysis`, `script-generation`, `statistical-modeling`, `visualization`
- Tags: `python`, `data`, `analysis`, `pandas`, `numpy`, `plot`, `csv`, `statistics`
- `core/scientist.ts`: generates Python scripts, delegates to MCP `run_python`
- Add port `McpToolPort` interface: `callTool(name, args): Promise<string>`
- Adapter: `adapters/mcp-client.ts` — MCP client connecting to `jabr-tools` stdio server
- Add `scientist` to `dev` script
- Add Scientist routing keywords to `DynamicRegistry` seed

---

## GAP-6 · Sampling → provider-agnostic LLM port (SEP-2577 migration)
**Files**: `agents/core/cognitive-loop.ts`, `agents/core/orchestrator.ts`, new `agents/ports/llm-port.ts`, new `agents/adapters/llm/`
**Problem**: ADR flags `sampling/createMessage` deprecated (SEP-2577, 12-month grace from 2026-07-28). Must be fully provider-agnostic — no vendor lock-in.

**Design — `LlmPort` (Vercel AI SDK compatible)**:
```ts
export interface LlmMessage { role: "user" | "assistant"; content: string }
export interface LlmUsage { inputTokens: number; outputTokens: number }
export interface LlmResult { text: string; usage: LlmUsage }
export interface LlmPort {
  complete(messages: LlmMessage[], opts?: { maxTokens?: number; system?: string }): Promise<LlmResult>
  readonly providerName: string
}
```

**Adapters** — one file per provider, all implement `LlmPort`:
- `agents/adapters/llm/openai.ts` — `JABR_OPENAI_BASE_URL` + `JABR_OPENAI_API_KEY` + `JABR_OPENAI_MODEL`
- `agents/adapters/llm/google.ts` — `JABR_GOOGLE_API_KEY` + `JABR_GOOGLE_MODEL`
- `agents/adapters/llm/ollama.ts` — `JABR_OLLAMA_URL` + `JABR_OLLAMA_MODEL` — fully local
- `agents/adapters/llm/openrouter.ts` — thin wrapper over `openai.ts`

**Factory** `agents/adapters/llm/factory.ts`:
```ts
// JABR_LLM_PROVIDER=ollama|openai|google|openrouter  (default: ollama)
export function createLlmAdapter(): LlmPort { ... }
```

**Wire**:
- `CognitiveLoop` constructor accepts `llm?: LlmPort` — when present, uses it for Judge synthesis
- `executeConsensus()` passes `llm` from composition root
- Gate behind `JABR_CONSENSUS_LLM=true` — default off (weighted scoring still works)
- Remove all `sampling/createMessage` references

---

## GAP-7 · Mem-Palace integration
**Files**: new `agents/adapters/mem-palace.ts`, `agents/ports/knowledge-port.ts`
**Task**:
- `KnowledgePort` interface: `store(key, content, tags)`, `query(text, topK?)`, `relate(keyA, keyB, relation)`
- `MemPalaceAdapter`: stores entries as `memory/palace/<slug>.json`
- Embedding: call `run_python` MCP tool with `sentence-transformers` (uv inline) — or stub with BM25 tag overlap
- Wire into `OrchestratorAgent`: before routing, `query(userText, 3)` → prepend top results as context
- Wire into Librarian: after research task, `store(slug, summary, tags)`
- Expose as MCP resource: `jabr://palace/{slug}` and `jabr://palace/query?q={text}`
- CLI tool `scripts/palace.ts`: `bun scripts/palace.ts query "A2A handover"`

---

## GAP-8 · Headroom integration
**Files**: new `agents/adapters/headroom.ts`, `agents/ports/budget-port.ts`
**Task**:
- `BudgetPort` interface: `consume(agentName, tokens)`, `remaining(agentName)`, `isExhausted(agentName)`, `reset()`
- `HeadroomAdapter`: in-memory per-agent token counters, caps via `JABR_TOKEN_CAP_<AGENT>` env vars (default 100k/session)
- Integrate into `LlmPort` adapters: each call returns `LlmUsage` → call `budget.consume()` after every `complete()`
- Integrate into `AgentRegistryPort.delegateTask()`: check `budget.isExhausted()` → throw `BudgetExhaustedError`
- Orchestrator catches `BudgetExhaustedError`: reroutes to next best agent
- Expose budget state in `jabr://world-state`: add `budget: { [agentName]: { used, cap, pct } }`
- Add `GET /budget` endpoint on Orchestrator

---

## GAP-9 · `ROUTING_TABLE` removal cleanup sweep
**Depends on**: GAP-1
**Files**: `AGENTS.md`, `README.md`, `opencode.json`, `agents/run/orchestrator.ts`
**Task**:
- After GAP-1 lands, grep for any remaining `ROUTING_TABLE` references
- Update `AGENTS.md` notes section
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

---

## DONE · v0.4.x

### [x] GAP-4 · `run_python` — persistent uv venv + dependency support (2026-08-27)
- Added `packages` param to `run_python`, `run_python_file` tool, and `python_repl` with persistent `./.python_env/` venv. 30s/10s timeouts.

### [x] GAP-5 · Scientist agent (2026-08-27)
- New Scientist Agent on port 4006. Skills: `data-analysis`, `script-generation`, `statistical-modeling`, `visualization`.

### [x] GAP-1 · Kill `ROUTING_TABLE` — pure tag routing (2026-08-28)
- Removed `ROUTING_TABLE` from `agents/core/orchestrator.ts`. `routeTask()` now delegates entirely to `DynamicRegistry.matchAgent()`.

### [x] GAP-2 · Live-wire `jabr://world-state` (2026-08-28)
- `getWorldState` fetches live data from `DynamicRegistry`. Agents have `status: "up"|"down"` and `lastSeen`.

### [x] GAP-8 · Headroom integration (2026-08-28)
- `HeadroomAdapter` in `agents/adapters/headroom.ts`. `BudgetPort` interface. Budget state in `jabr://world-state`.

### [x] GAP-3 · Demo script — 6-agent topology (2026-08-29)
- `scripts/demo.ts` rewritten with all 6 agents, consensus, handover, discovery tests.

### [x] GAP-6 · Sampling → provider-agnostic LlmPort (2026-08-29)
- `LlmPort` interface + `NineRouterLlmAdapter`. `CognitiveLoop` accepts optional `LlmPort`.

### [x] GAP-9 · `ROUTING_TABLE` cleanup sweep (2026-08-29)
- Removed remaining `ROUTING_TABLE` references from docs.

### [x] CLI · Agent management CLI (scripts/jabr-cli.ts)
- `bun scripts/jabr-cli.ts` / `bun run cli`: start, stop, restart, status, logs, send, config.

---

## Known Issues (updated)

- [ ] Routing tie-break: tag tie → first in iteration order wins (design decision needed)
- [ ] Handover path not exercised: oracle `%%HANDOVER%%` chain never triggers through current routing
- [ ] Specialists are deterministic keyword matchers — cannot implement new MCP tools end-to-end
- [ ] NINEROUTER env vars set nowhere (no `.env`) — search/image-gen silently disabled or crash
- [ ] scientist (4006) crashes on startup — `mcp-client.ts:138` syntax error blocks `scientist.ts`; investigate separately
- [ ] jarvis (1337) crashes on startup — separate investigation needed
- [ ] `mcp` and `acp-bridge` are stdio-based — CLI reports them as "launched" but they have no HTTP health check; MCP log shows regex error after startup
