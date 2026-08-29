# TODO: Jabr Enhancement Roadmap

## 🚀 Priority 1: Plug-and-Play (PnP) Kit ✅
- [x] **Type System Migration** (720c1dd)
  - [x] Updated `agents/types.ts` to A2A v1.0 `AgentCard` schema (`supportedInterfaces`, `tags`, `extensions`, `HandoverRequest`, etc.)
- [x] **Dynamic Agent Registry** (720c1dd)
  - [x] Implemented `DynamicRegistry` class in `agents/adapters/dynamic-registry.ts`
  - [x] Seed URL scanning and `/.well-known/agent-card.json` fetching via `AgentRegistryPort`
  - [x] Tag-based routing in Orchestrator matching tasks against `AgentSkill.tags`
- [x] **A2A Handover Protocol** (720c1dd)
  - [x] `HandoverRequest` type + `encodeHandover`/`decodeHandover` helpers in types.ts
  - [x] `%%HANDOVER%%` sentinel marker for specialist→orchestrator transfer signals
  - [x] Recursive routing in Orchestrator (`MAX_HANDOVER_DEPTH = 3`)

## 📡 Priority 2: Live Context Kit (MCP Evolution) ✅
- [x] **MCP Resource Infrastructure** (a671161)
  - [x] Resource types in `agents/types.ts` (`McpResource`, `McpResourceContent`, `ResourceSubscription`, `WorldState`)
  - [x] `ResourcePort` interface in `agents/ports/resource-port.ts`
  - [x] Resource adapter in `agents/adapters/mcp-resources.ts` — registers 4 resources on McpServer
  - [x] Resources wired in `mcp-servers/tools.ts` with default context
  - [x] Declare `subscribe` and `listChanged` capabilities in the MCP server
- [x] **Subscription Management**
  - [x] `SubscriptionManager` class in `agents/adapters/subscription-manager.ts`
  - [x] `subscribe()`/`unsubscribe()`/`hasSubscribers()`/`getSubscriberIds()` methods
  - [x] Integrate `subscriptions/listen` flow and handle `notifications/resources/updated`
- [x] **World-State Resource**
  - [x] `jabr://world-state` — JSON system snapshot (agents, tasks, memory, skills)
  - [x] `jabr://tasks/{taskId}` — individual task state (URI template)
  - [x] `jabr://skills` — saved skill catalog
  - [x] `jabr://memory` — session memory markdown
  - [x] Wire live data callbacks from Orchestrator's task store and agent registry
- [x] **DRY Specialist Runners** (dc0a798) — `runAgent()` factory in `agents/run/serve.ts`

## 🧹 Maintenance: Coherence & Hexagonal ✅
- [x] Aliased imports sweep — all cross-module imports use `@agents/*`, `@ports/*`, `@adapters/*` (fix-6, 3f15a81)
- [x] Deslop — removed decorative headers, restating JSDoc, inline narration (fix-8/9, 3f15a81)
- [x] Hexagonal boundary — `DiscoveryPort` isolates core from adapter (`agents/ports/discovery-port.ts`, e1981b5) — tsc clean

## 🧠 Priority 4: Cognitive Loop Kit (Reasoning Evolution) ✅
- [x] **Consensus Engine** (26f9e0a)
  - [x] `CognitiveLoop` class with weighted scoring (successRate, relevance, tag hits)
  - [x] `DynamicRegistry.getAllCards()` + `Orchestrator.delegateToMultiple()` / `executeConsensus()`
  - [x] Judge pattern via `cognitiveConfig` (oracle)
- [x] **Recursive Reasoning** — `TaskStorePort` + `MemoryStorePort` persistence supports loop recovery

## 🖥️ Priority 3: IDE-Native Kit (ACP Evolution) ✅
- [x] **Diff Streaming** (fix-10)
  - [x] Extend `stdio-bridge.ts` to support native ACP `diff` content type (`path`/`oldText`/`newText` + `unified` fallback)
  - [x] Implement `tool_call_update` notification stream via `notification()` helper in `utils/rpc.ts`
- [x] **Stateful Session Management** (fix-10)
  - [x] Implement `session/list` and `session/delete` in ACP adapter
  - [x] Implement session migration via `session/resume` with `replayFrom: {type:"start"}`
  - [x] Persist session metadata via extended `MemoryStorePort` (`SessionData`, `SessionEntry`) + `memory-fs` (`memory/sessions/session-<id>.json`)

## 🛠️ Gap Filling (v0.3.0 → v0.4.0)
- [x] **GAP-1: Kill ROUTING_TABLE** — pure tag routing
- [x] **GAP-3: Fix demo script** — reflect 6-agent topology
- [x] **GAP-2: Live-wire jabr://world-state** — real agent health
- [x] **GAP-4: run_python** — persistent uv venv + dependency support
- [x] **GAP-5: Python agent layer** — Scientist agent
- [x] **GAP-6: Provider-agnostic LlmPort** + consensus synthesis
- [x] **GAP-7: Mem-Palace integration**
- [x] **GAP-8: Headroom integration** (budget awareness)
- [x] **GAP-9: ROUTING_TABLE removal cleanup sweep** — no code refs remain; only historical docs (TODO, ADR, AGENTS.md) reference the removal

## 🔌 9router LLM Default (v0.3.0 → v0.4.0) ✅
- [x] **NineRouterLlmAdapter** (4a1dae4) — `agents/adapters/llm/9router.ts` extends `OpenAiLlmAdapter`; env `NINEROUTER_URL` (default `http://127.0.0.1:20128`), `NINEROUTER_KEY`, `NINEROUTER_MODEL` (default `openrouter/minimax/minimax-m3:free`)
- [x] **Gateway hardening** (4a1dae4) — `openai.ts` tolerant of leading whitespace + trailing `data: [DONE]` sentinel (Bun `res.json()` quirk)
- [x] **Default wiring** (4a1dae4) — orchestrator consensus synthesis uses 9router by default; no OpenAI key required
- [x] **route-test.ts import fix** (4a1dae4) — `AgentRegistryPort` from `@ports/agent-registry` (unblocked `bun run typecheck`)

## 🤖 Jarvis — Proactive Codebase Steward (v0.4.0)
- [x] **Jarvis Agent** — `agents/core/jarvis.ts` + `agents/run/jarvis.ts` on port 1337
- [x] **Scan capabilities** — codebase scan, dependency watch, test gap analysis, doc sync, AI enhancement identification
- [x] **Profile generation** — auto-creates idempotent skills for recurring patterns
- [x] **Integration** — [ADDRESS] (9router), SearchPort, McpToolPort, SkillStorePort, [ADDRESS] (MemPalace), [PERSON_NAME] (Headroom)
- [x] **Script + dev** — `jarvis` script added, included in `bun run dev`

## 🔬 Post-v0.4.0 Audit (repomix analysis, 2026-08-29)

### Critical issues / smells (from `repomix-output.xml` review)
- [x] **`scripts/demo.ts` out of sync** — posts to `/a2a` with `message/send`, polls `tasks/get`; current `a2a-server.ts` accepts only root `/` + `tasks/send` sync — **DONE (2026-08-29, `5d3abd5`):** rewritten to POST root `/` with `tasks/send`, read `result.text` inline, drop `waitForTask` polling + nonexistent `discover` call
- [x] **Scientist diverges from `execute` contract** — `agents/run/scientist.ts` returns inline readonly card and `handleTask` not `execute`; not on `bun run dev` — **DONE (2026-08-29, `4add823`):** `handleTask` → `execute(taskId, text)`; already in `bun run dev`
- [x] **Jarvis `execute` doesn't write to `taskStore`** — bypasses `TaskStorePort`, breaks world-state subscribers — **DONE (2026-08-29, `c0b90cc`):** added `TaskStorePort` to constructor; `execute()` now `updateState` + `appendMessage`
- [x] **Handover is dead code** — `encodeHandover` defined, no specialist emits `%%HANDOVER%%`; specialists are deterministic keyword matchers — **RESOLVED**: oracle is now LLM-driven and emits `%%HANDOVER%%` on mis-routing; orchestrator honors `transferTo` (see line 100)
- [x] **Naive `extractJson`** — slices first `{...}` regardless of nesting; breaks on nested objects in LLM output — **DONE (2026-08-29, `c0b90cc`):** depth-counter scanner respecting strings/escapes
- [x] **Regex version-parse** — `/v?(\d+)\.(\d+)/` fragile; semver pre-release/build metadata dropped — **DONE (2026-08-29, `c0b90cc`):** hardened `fetchLatestVersion` with stricter semver regex + `results[0]?.snippet` guard
- [x] **5 run files import `./serve` without `.ts`** — already resolved in code: all 5 (`designer`, `explorer`, `fixer`, `librarian`, `oracle`) import `./serve.ts` with extension; `bun run typecheck` clean. Only stale doc references remain (TODO + `agents/run/AGENTS.md`)
- [x] **No lint / test scripts** — `bun run typecheck` only; no eslint, no test files. Add `bun test` using built-in `bun:test` (no vitest). — **DONE (2026-08-29, `66a99f2`):** `"test": "bun test"` + `tests/dynamic-registry.test.ts`; now 20+ tests across 3 files
- [x] **`calculate` MCP tool uses `eval`** — security smell, sandbox-evading — **DONE (2026-08-29, `513ad16`):** replaced with tokenizer + recursive-descent Parser (precedence, right-assoc `^`, unary `+/-`); rejects `process.exit()` etc.
- [x] **`AgentCard.name` mismatch** — runtime cards still say "Oracle"/"Librarian" while lore uses polymaths (JABIR/RUSHD/...); rebrand is skin-deep — **DONE (2026-08-29, `fb120ed`):** skin-deep rebrand to JABIR/RUSHD/FIHRIYA/BATTUTA/FIRNAS/TARIQ/KHWARIZMI/WAZIR (display strings only; routing keys by seed key, not card.name)
- [x] **`memory-fs` resolves `process.cwd()`** — fragile for non-repo-root invocations — **DONE (2026-08-29, `e45d9e0`):** resolves from module location via `DEFAULT_MEMORY_DIR`; constructor takes `MemoryFSOptions { baseDir?, file? }`
- [x] **`mcp-resources.ts` resource templates** — `listChanged` declared but not all resources emit `notifications/resources/updated` — **DONE (2026-08-29, `52e7948`):** wired subscribe/unsubscribe + per-resource `notifications/resources/updated` + `list_changed`
- [x] **Jarvis LLM prompt `[ADDRESS]` placeholders** — threaded `agentEndpoint` (ORCHESTRATOR_URL, default http://localhost:4000) into scan + AI-enhancement prompts; no bare `[ADDRESS]` literals remain
- [x] **`route-test.ts` MockRegistry diverges from real `DynamicRegistry`** — replaced MockRegistry with an offline `AgentRegistryPort` feeding the real `DynamicRegistry`; routing test now exercises the actual `matchAgent` algorithm (typecheck clean, self-check asserts explorer hit)
- [x] **Consensus always queries ALL agents** — no opt-out; wasteful for narrow tasks — **DONE (2026-08-29, `27c1fe5`):** `executeConsensus(taskId, userText, agentNames?)` filters participants

### Top leverage fixes
- [x] **Scientist: adopt `runAgent()` + standard contract** — `agents/run/scientist.ts` uses `runAgent` factory; `handleTask` → `execute`; add to `bun run dev`; return readonly card via standard channel — **DONE (2026-08-29, `4add823`)**
- [x] **Handover: wire into [PERSON_NAME] OR delete** — pick one; if delete, drop `HandoverRequest`/`encodeHandover`/`MAX_HANDOVER_DEPTH`; if wire, add to [PERSON_NAME] (only LLM-driven specialist can reason about mis-routing)
  - **DECISION (2026-08-29): WIRE it.** Handover stays; do NOT delete. Plan: make a specialist LLM-driven (start with oracle or a dedicated reasoning lane), then wire `encodeHandover` so it can genuinely reason about mis-routing before emitting `%%HANDOVER%%`. Prerequisite: an LLM-driven specialist must exist first (see Future Enhancements).
  - **DONE (2026-08-29):** Oracle is now LLM-driven (`LlmPort` routing judge, `ROUTING_SYSTEM_PROMPT`, `VALID_TRANSFER_TARGETS`) and emits `%%HANDOVER%%` on mis-routing; orchestrator honors `transferTo` via `forcedAgentName` (falls back to registry re-routing when unresolvable). Committed `70a2e4f`.
- [x] **Rebrand decision** — either update `AgentCard.name` to polymaths end-to-end (oracle→JABIR, etc.) or stop pretending; rename `agents/core/oracle.ts` → `agents/core/jabir.ts` to match lore — **DONE (2026-08-29, `fb120ed`):** skin-deep rebrand (display strings only). File renames (oracle.ts→jabir.ts) deferred — routing keys by seed key, so renaming is cosmetic.

### What genuinely needs LLM
- [ ] **Orchestrator route-decision LLM** — invoke when `DynamicRegistry.matchAgent` returns low-confidence (score < threshold or tie); currently always keyword
- [ ] **Consensus synthesis** — already LLM-backed (oracle judge, temp 0.3); keep
- [ ] **Jarvis proactive scans** — already LLM-driven; keep
- [ ] **Scientist interpretation** — when `run_python` returns non-trivial data needing narrative; add to MCP layer

### What should stay rule-based
- `oracle` / `librarian` / `explorer` / `designer` / `fixer` — keyword routing already works; deterministic + cheap; LLM adds latency + cost for no gain on narrow lanes
- `DynamicRegistry.matchAgent` — tag-substring + keyword overlap scoring; deterministic; only escalate to LLM on low-confidence (see above)

## 🚀 Future Enhancements (2026-08-29)

- [x] **TDD with DDD** — adopt test-driven development + domain-driven design using Bun's built-in `bun:test` (no vitest needed — runtime is Bun 1.4). Add test files + `bun test` script. Ties into the "No lint / test scripts" audit item. — **DONE (2026-08-29, `66a99f2`):** `bun test` script + `tests/dynamic-registry.test.ts`; suite now 20+ tests (dynamic-registry, sqlite-stores, oracle-handover)
- [x] **Persistent database with bun sqlite** — replace/augment in-memory `TaskMemory` (and possibly `memory-fs`) with `bun:sqlite` for durable task/session/memory persistence. Enables loop recovery across restarts. — **DONE (2026-08-29, `14a05d2`/`609ba5a`/`8c26935`/`2505a21`):** `SqliteTaskStore` + `SqliteMemoryStore` + `openJabrDb()`; wired orchestrator (memory/jabr.db) + ACP bridge (memory/jabr-bridge.db); specialists keep request-scoped `TaskMemory`; `listByState` added to port for loop recovery
- [x] **LLM-driven specialist (prerequisite for handover wiring)** — make at least one specialist genuinely LLM-driven so it can reason about mis-routing; this unblocks the handover wiring decision above. — **DONE (2026-08-29):** oracle is LLM-driven (committed `70a2e4f`).

## 🧪 Post-audit Discoveries (live smoke test + e2e, 2026-08-29)

Findings from running the A2A ecosystem live and building `tests/e2e-live.test.ts` (73 tests, currently 72 pass / 1 fail — file untracked, pending commit).

### Fixed (committed)
- [x] **Discovery timing race** — `discoverWithRetry` returned on ANY partial success, so parallel-booting agents were missed (orchestrator saw 4/2 agents, routing fell back to oracle). — **DONE (`7a70554`):** retry until ALL seed agents present or maxAttempts; logs "Agents ready" only on full discovery
- [x] **BUG 1: Orchestrator→specialist delegation sends EMPTY text** — `a2a-client.ts:59` sent `parts: [{ type: "text", text }]` but `a2a-server.ts:85` reads `p.kind === "text"` → every delegated task arrived empty, specialists returned empty-text fallbacks. System looked healthy point-to-point but broken under orchestration. — **DONE (`f80dc5e`):** `type` → `kind`
- [x] **BUG 2: jarvis always returns "No response"** — `run/jarvis.ts` onTask never called `taskStore.create(taskId)`, so `TaskMemory` silently no-op'd and `extractLastResponse` returned literal "No response" (steward actually ran). — **DONE (`0b29eaf`):** added `taskStore.create(taskId)` before `execute`
- [x] **memory/orchestrator.md redundancy** — .md mirror is redundant (sqlite is source of truth), holds duplicates, grows unboundedly. — **DONE (`ebebd11`):** mirror disabled for orchestrator (`mirrorFile: null`); `SqliteMemoryStore` now dedups exact entries + caps to most recent `maxEntries` (default 500)
- [x] **getWorldState task counts always 0** — counted nonexistent `task-*.json` files; tasks now in sqlite. — **DONE (`423f99b`):** uses `taskStore.listByState()` for real active/completed/failed/canceled counts
- [x] **Verbose logging** — all endpoints had near-zero request logging. — **DONE (`c99eeaa`/`8b7fe28`/`fb14128`):** A2A server+client, ACP bridge+DynamicRegistry (incl. matchAgent scoring table), MCP tools (withLogging HOF)

### Open / needs decision
- [ ] **BUG 3: routing tie-break** — "scan the codebase for improvements" matches jarvis `scan` tag (+2) AND fixer `code` tag (+2) → tie → fixer wins (first in iteration order). Needs design decision: tag specificity/priority vs first-match-on-tie. Only remaining e2e failure.
- [ ] **Handover path not actually exercised** — §4 handover e2e test passes only because "review this code and fix the bug in it" routes DIRECTLY to fixer (score 4 > oracle 2); oracle `%%HANDOVER%%` chain never triggers through current routing+judge design. Worth design review.
- [ ] **NINEROUTER env inconsistency** — `NINEROUTER_URL`/`NINEROUTER_KEY` set nowhere (no .env, not in shell, not in tmux runner). LLM 9router has hardcoded defaults (works); Search9Router degrades to `[]` (silently disabled); ImageGen9Router throws (crashes if invoked). **DECISION (2026-08-29): fix BOTH** — add `.env` (+ gitignored, `.env.example`) AND default fallbacks to Search/ImageGen mirroring llm/9router.ts.
- [ ] **Capability finding** — live specialists are deterministic keyword matchers returning canned markdown; they cannot actually implement a new MCP tool end-to-end (the eval task "add a word_count tool" returned canned text, not a real implementation). Only jarvis (LLM) and oracle (LLM routing) are genuinely LLM-driven.
