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
- [x] **Integration** — LlmPort (9router), SearchPort, McpToolPort, SkillStorePort, KnowledgePort (MemPalace), BudgetPort (Headroom)
- [x] **Script + dev** — `jarvis` script added, included in `bun run dev`
