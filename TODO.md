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
- [ ] **`scripts/demo.ts` out of sync** — posts to `/a2a` with `message/send`, polls `tasks/get`; current `a2a-server.ts` accepts only root `/` + `tasks/send` sync
- [ ] **Scientist diverges from `execute` contract** — `agents/run/scientist.ts` returns inline readonly card and `handleTask` not `execute`; not on `bun run dev`
- [ ] **Jarvis `execute` doesn't write to `taskStore`** — bypasses `TaskStorePort`, breaks world-state subscribers
- [ ] **Handover is dead code** — `encodeHandover` defined, no specialist emits `%%HANDOVER%%`; specialists are deterministic keyword matchers
- [ ] **Naive `extractJson`** — slices first `{...}` regardless of nesting; breaks on nested objects in LLM output
- [ ] **Regex version-parse** — `/v?(\d+)\.(\d+)/` fragile; semver pre-release/build metadata dropped
- [x] **5 run files import `./serve` without `.ts`** — already resolved in code: all 5 (`designer`, `explorer`, `fixer`, `librarian`, `oracle`) import `./serve.ts` with extension; `bun run typecheck` clean. Only stale doc references remain (TODO + `agents/run/AGENTS.md`)
- [ ] **No lint / test scripts** — `bun run typecheck` only; no eslint, no test files. Add `bun test` using built-in `bun:test` (no vitest).
- [ ] **`calculate` MCP tool uses `eval`** — security smell, sandbox-evading
- [ ] **`AgentCard.name` mismatch** — runtime cards still say "Oracle"/"Librarian" while lore uses polymaths (JABIR/RUSHD/...); rebrand is skin-deep
- [ ] **`memory-fs` resolves `process.cwd()`** — fragile for non-repo-root invocations
- [ ] **`mcp-resources.ts` resource templates** — `listChanged` declared but not all resources emit `notifications/resources/updated`
- [ ] **Jarvis LLM prompt leaves `[ADDRESS]` placeholders unfilled** in 2 call sites
- [x] **`route-test.ts` MockRegistry diverges from real `DynamicRegistry`** — replaced MockRegistry with an offline `AgentRegistryPort` feeding the real `DynamicRegistry`; routing test now exercises the actual `matchAgent` algorithm (typecheck clean, self-check asserts explorer hit)
- [ ] **Consensus always queries ALL agents** — no opt-out; wasteful for narrow tasks

### Top leverage fixes
- [ ] **Scientist: adopt `runAgent()` + standard contract** — `agents/run/scientist.ts` uses `runAgent` factory; `handleTask` → `execute`; add to `bun run dev`; return readonly card via standard channel
- [ ] **Handover: wire into [PERSON_NAME] OR delete** — pick one; if delete, drop `HandoverRequest`/`encodeHandover`/`MAX_HANDOVER_DEPTH`; if wire, add to [PERSON_NAME] (only LLM-driven specialist can reason about mis-routing)
  - **DECISION (2026-08-29): WIRE it.** Handover stays; do NOT delete. Plan: make a specialist LLM-driven (start with oracle or a dedicated reasoning lane), then wire `encodeHandover` so it can genuinely reason about mis-routing before emitting `%%HANDOVER%%`. Prerequisite: an LLM-driven specialist must exist first (see Future Enhancements).
- [ ] **Rebrand decision** — either update `AgentCard.name` to polymaths end-to-end (oracle→JABIR, etc.) or stop pretending; rename `agents/core/oracle.ts` → `agents/core/jabir.ts` to match lore

### What genuinely needs LLM
- [ ] **Orchestrator route-decision LLM** — invoke when `DynamicRegistry.matchAgent` returns low-confidence (score < threshold or tie); currently always keyword
- [ ] **Consensus synthesis** — already LLM-backed (oracle judge, temp 0.3); keep
- [ ] **Jarvis proactive scans** — already LLM-driven; keep
- [ ] **Scientist interpretation** — when `run_python` returns non-trivial data needing narrative; add to MCP layer

### What should stay rule-based
- `oracle` / `librarian` / `explorer` / `designer` / `fixer` — keyword routing already works; deterministic + cheap; LLM adds latency + cost for no gain on narrow lanes
- `DynamicRegistry.matchAgent` — tag-substring + keyword overlap scoring; deterministic; only escalate to LLM on low-confidence (see above)

## 🚀 Future Enhancements (2026-08-29)

- [ ] **TDD with DDD** — adopt test-driven development + domain-driven design using Bun's built-in `bun:test` (no vitest needed — runtime is Bun 1.4). Add test files + `bun test` script. Ties into the "No lint / test scripts" audit item.
- [ ] **Persistent database with bun sqlite** — replace/augment in-memory `TaskMemory` (and possibly `memory-fs`) with `bun:sqlite` for durable task/session/memory persistence. Enables loop recovery across restarts.
- [ ] **LLM-driven specialist (prerequisite for handover wiring)** — make at least one specialist genuinely LLM-driven so it can reason about mis-routing; this unblocks the handover wiring decision above.
