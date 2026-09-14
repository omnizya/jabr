# TODO: Jabr Roadmap

**Current version:** 0.4.0
Date:** 2026-09-09 (consolidated JABR board, 1-at-a-time sequential)
**See also:** [CANONICAL.md](./CANONICAL.md) for full architecture, gap analysis, and production readiness assessment.
**Board:** `hermes kanban --board jabr list` (source of truth for active work)

---

## Completed (v0.1.0 → v0.4.0)

### PnP Kit (v0.1.0) ✅
- [x] A2A v1.0 `AgentCard` types (`supportedInterfaces`, `tags`, `extensions`, `HandoverRequest`)
- [x] `DynamicRegistry` with tag-scored routing
- [x] `%%HANDOVER%%` recursive routing (max depth 3)

### Live Context Kit (v0.2.0) ✅
- [x] MCP resources: `jabr://world-state`, `jabr://tasks/{id}`, `jabr://skills`, `jabr://memory`
- [x] `SubscriptionManager` (`resources/subscribe` → `subscriptions/listen`)
- [x] `runAgent()` DRY factory in `agents/run/serve.ts`

### Cognitive Loop Kit (v0.2.0) ✅
- [x] `CognitiveLoop` weighted voting (`successRate`, relevance, tag hits)
- [x] `delegateToMultiple` / `executeConsensus`

### IDE-Native Kit (v0.3.0) ✅
- [x] ACP `diff` content type + `tool_call_update` stream
- [x] `session/list|delete|resume` with `replayFrom`
- [x] `MemoryStorePort` `SessionData` → `memory/sessions/session-<id>.json`

### Coherence (v0.3.0) ✅
- [x] Aliased imports (`@agents/*`, `@ports/*`, `@adapters/*`, `@utils/*`, `@run/*`)
- [x] Hexagonal `DiscoveryPort` isolation
- [x] Zero `//` slop, zero decorative headers

### 9router LLM Default (v0.3.0) ✅
- [x] `NineRouterLlmAdapter` (default: `openrouter/minimax/minimax-m3:free`)
- [x] Gateway hardening (whitespace + `data: [DONE]` tolerance)

### Jarvis — Proactive Codebase Steward (v0.4.0) ✅
- [x] `agents/core/jarvis.ts` + `agents/run/jarvis.ts` on port 1337
- [x] Scan capabilities (codebase, dependency watch, test gap, doc sync, AI enhancement)
- [x] Profile generation (idempotent skills for recurring patterns)

### Post-v0.4.0 Audit (2026-08-29) ✅
- [x] `scripts/demo.ts` rewritten (root `/`, `tasks/send`, sync)
- [x] Scientist adopts `runAgent()` + standard `execute` contract
- [x] Jarvis writes to `taskStore` (fixes world-state subscribers)
- [x] Oracle LLM-driven (emits `%%HANDOVER%%` on mis-routing)
- [x] Naive `extractJson` → depth-counter scanner
- [x] `memory-fs` resolves from module location (not `process.cwd()`)
- [x] `mcp-resources.ts` wired for `notifications/resources/updated`
- [x] `route-test.ts` uses real `DynamicRegistry`
- [x] Consensus filters participants (no longer queries ALL agents)
- [x] `bun test` script + 20+ tests (dynamic-registry, sqlite-stores, oracle-handover)
- [x] `calculate` MCP tool: tokenizer + recursive-descent parser (no `eval`)
- [x] Skin-deep rebrand to polymaths (JABIR/RUSHD/FIHRIYA/BATTUTA/FIRNAS/TARIQ/KHWARIZMI/WAZIR)
- [x] Discovery timing race fixed (retry until ALL seed agents present)
- [x] BUG: Orchestrator→specialist delegation `type` → `kind` (empty text fix)
- [x] BUG: jarvis `taskStore.create(taskId)` before `execute`
- [x] `memory/orchestrator.md` mirror disabled; sqlite dedup + cap (maxEntries 500)
- [x] `getWorldState` uses `taskStore.listByState()` for real counts
- [x] Verbose logging (A2A server+client, ACP bridge, DynamicRegistry, MCP tools)

### Standalone Binary Build (2026-08-30) ✅
- [x] `scripts/build.ts` compiles all 12 entry points into standalone executables (`bun run build`)
- [x] Output to `dist/bin/` (gitignored); `--compile` + `--bytecode` for faster cold starts
- [x] `bun run build -- <name>` builds a single target; `--list` shows targets
- [x] `format: "esm"` required so bytecode (CommonJS default) doesn't reject top-level `await` in orchestrator/mcp
- [x] Verified binaries boot: explorer/orchestrator A2A servers, mcp stdio server, cli help

### Vercel AI Gateway LLM Adapter (2026-08-30) ✅
- [x] `agents/adapters/llm/vercel.ts` — `VercelLlmAdapter implements LlmPort` via `ai` SDK `generateText`/`streamText` + `createGateway`
- [x] Resilient model form: default `minimax/minimax-m3` + `providerOptions.gateway.order=['gmicloud']` (survives Sept 6 free-period end)
- [x] `agents/adapters/llm/factory.ts` — `createLlmAdapter(budget?)` selects Vercel when `JABR_LLM_PROVIDER=vercel` or `VERCEL_AI_GATEWAY_KEY` set, else 9Router
- [x] 5 run modules (orchestrator, oracle, fixer, jarvis, librarian) wired through the factory
- [x] Budget consumed under `'vercel'` key; `LanguageModelUsage` mapped to LlmResponse usage
- [x] `.env.example` + env tables updated (JABR_LLM_PROVIDER, VERCEL_AI_GATEWAY_KEY/MODEL/BASE_URL)

---

## Active Workstream (JABR board)

Source of truth: `hermes kanban --board jabr list`
Rule: **strictly 1 task at a time, sequential dependencies enforced via task_links.**

```
t_b90a793f  Security: OAuth 2.1 / JWT auth on all endpoints           ← READY
t_b73931a9  Security: mTLS for agent-to-agent communication          ← blocked (after OAuth)
t_67de84cd  Reliability: circular handoff detection                  ← blocked
t_8c97707b  Reliability: dead letter queue (DLQ)                     ← blocked
t_75d4aef1  Quality: SHURA verification in routing loop              ← blocked
t_28f66deb  Observability: OpenTelemetry tracing + metrics           ← blocked
t_ad12995c  Memory: context window compression + TTL decay           ← blocked
t_0c4e01c7  Routing: deterministic tie-break scoring                 ← blocked
t_7e3caa37  Config: .env setup + startup validation                  ← blocked
t_c134b0b9  Push notifications: retry + error handling               ← blocked
```

---

## Phase 1 — A2A v1.0 Compliance (2-3 weeks)

**Goal:** Pass A2A v1.0 conformance tests.
**Priority:** 🔴 Critical

### Task Lifecycle
- [x] Implement full 9-state task lifecycle (`SUBMITTED`, `WORKING`, `INPUT_REQUIRED`, `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`, `AUTH_REQUIRED`, `UNKNOWN`)
- [x] Add `INPUT_REQUIRED` state (agent requests more info from caller)
- [x] Add `REJECTED` state (agent refuses the task)
- [x] Add `AUTH_REQUIRED` state (agent needs authentication)
- [x] Add `UNKNOWN` state (state cannot be determined)
- [x] Add state transition history tracking (audit trail)

### Streaming & Push
- [x] Add SSE streaming to `a2a-server.ts` (for long-running tasks) — done `t_71ad0c40`
- [x] Add push notification endpoint (`tasks/sendSubscribe`) — done `t_87da6285`
- [x] Implement `TaskStatusUpdateEvent` stream — done `t_87da6285`
- [x] Implement `TaskArtifactUpdateEvent` stream — done `t_87da6285`

### Agent Card
- [x] Add `capabilities.streaming: true/false` flag
- [x] Add `capabilities.pushNotifications: true/false` flag
- [x] Add `capabilities.stateTransitionHistory: true/false` flag
- [x] Add `securityRequirements` array (`[oauth2, apiKey, mTLS, openid]`)
- [x] Add `securitySchemes` map (`SecurityScheme` union type)

### Typed Artifacts
- [ ] Define typed `Artifact` types (not just text)
- [ ] Support structured data artifacts (JSON, binary)
- [ ] Support multi-part artifacts

### Auth (minimum viable)
- [x] Add API key auth middleware
- [x] Validate `X-API-Key` header on all agent endpoints
- [x] Return `401 Unauthorized` for missing/invalid keys
- [x] Return `403 Forbidden` for insufficient permissions
- [x] Add OAuth 2.1 JWT bearer tokens (HS256, short-lived, scoped, refreshable)
- [x] Add client_credentials + refresh_token grants at `/oauth/token`
- [x] Add token revocation at `/oauth/revoke` (RFC 7009)
- [x] Add OAuth metadata at `/.well-known/oauth-authorization-server` (RFC 8414)
- [x] Add per-method scope enforcement (read/write/stream/admin)

---

## Phase 2 — Production Hardening (2-3 weeks)

**Goal:** Safe for internal deployment.
**Priority:** 🔴 Critical

### Reliability
- [ ] Circular handoff detection (graph cycle detection) — JABR `t_67de84cd` (blocked)
- [ ] Dead letter queue for failed tasks — JABR `t_8c97707b` (blocked)
- [ ] Task retry with exponential backoff
- [ ] Graceful shutdown handling (drain in-flight tasks)
- [ ] Health check endpoints (`/health`, `/ready`)

### Observability
- [ ] Span-level tracing (OpenTelemetry) — JABR `t_28f66deb` (blocked)
- [ ] Trace context propagation across A2A boundaries
- [ ] Task duration metrics (p50, p95, p99)
- [ ] Error rate tracking per agent
- [ ] Cost attribution per task/agent
- [ ] Structured logging (pino or similar)

### Verification
- [ ] Independent verification agent (cross-check outputs) — JABR `t_75d4aef1` (SHURA)
- [ ] Consensus threshold for contested results
- [ ] Audit trail for all agent decisions
- [ ] Output validation (schema check on artifacts)

### Security
- [x] Rate limiting per agent/caller
- [x] CORS configuration (replace `*` with allowlist)
- [ ] Input validation on all endpoints
- [ ] Secret management (API keys in env, not code)

---

## Phase 3 — Memory & Knowledge (3-4 weeks)

**Goal:** Production-quality memory management.
**Priority:** 🟡 High

### Memory Infrastructure
- [ ] Hierarchical memory distillation (summarize → compress → prune)
- [ ] Memory compression (context window management) — JABR `t_ad12995c` (blocked)
- [ ] Memory TTL/decay (auto-stale old entries) — JABR `t_ad12995c` (blocked)
- [ ] Cross-agent shared knowledge graph (not just per-agent)
- [ ] Conflict resolution (consensus for contradictory memories)

### Knowledge Graph
- [ ] Entity extraction + relationship typing
- [ ] Graph traversal queries (relationship-aware retrieval)
- [ ] Temporal versioning ("what did we know when?")
- [ ] Knowledge validation (source attribution, confidence scoring)

### Retrieval
- [ ] Multi-signal retrieval (semantic + temporal + social)
- [ ] Relevance scoring (recency, frequency, agent reputation)
- [ ] Context injection optimization (top-K selection)

---

## Phase 4 — x402 Integration (1 week)

**Goal:** Agent-to-agent payments working.
**Priority:** 🟡 High

### Payment Infrastructure
- [ ] x402 server middleware (return 402 + payment requirements, verify on-chain)
- [ ] Agent wallet infrastructure (smart contract or EOA per agent)
- [ ] Payment client (sign and attach payment headers to A2A requests)
- [ ] Agent Card pricing declarations
- [ ] On-chain budget manager (balance tracking, auto-refill)

### Economic Model
- [ ] Define pricing per agent (Oracle: 0.02 USDC/review, etc.)
- [ ] Orchestrator pays specialists on task delegation
- [ ] Cross-agent hiring (pay external agents)
- [ ] Resource markets (pay for GPU compute)

---

## Phase 5 — Decentralization (Research)

**Goal:** Explore P2P agent coordination.
**Priority:** 🟢 Future

### P2P Coordination
- [ ] Gossip protocol for ambient state diffusion (GEACL paper)
- [ ] Raft consensus for decentralized coordination
- [ ] Agent reputation system (track record influences routing)
- [ ] Economic autonomy (agent wallets, payment channels)

### Governance
- [ ] Voting mechanism (agents vote on decisions)
- [ ] Dispute resolution (independent arbitration agent)
- [ ] Framework for adding/removing agents
- [ ] DAO integration (on-chain governance)

---

## Open Issues (from v0.4.0 audit)

### Active on JABR board
- [ ] **Routing tie-break** — tag tie → first in iteration order wins. JABR `t_0c4e01c7` (blocked). Design decision: tag specificity/priority vs first-match-on-tie.
- [ ] **Config: .env setup + startup validation** — JABR `t_7e3caa37` (blocked).
- [ ] **Push notifications: retry + error handling** — JABR `t_c134b0b9` (blocked).

### Needs Decision
- [ ] **Handover path not exercised** — §4 handover e2e test passes only because "review this code and fix the bug in it" routes DIRECTLY to fixer (score 4 > oracle 2); oracle `%%HANDOVER%%` chain never triggers through current routing+judge design. Worth design review.

### Resolved
- [x] **NINEROUTER env inconsistency** — `NINEROUTER_URL`/`NINEROUTER_KEY` set nowhere (no .env, not in shell, not in tmux runner). Add `.env` (+ gitignored, `.env.example`) AND default fallbacks to Search/ImageGen mirroring llm/9router.ts — **FIXED (2026-08-29, `d5f4a0c`):** defaults added to Search9Router + ImageGen9Router, `.env.example` created, typecheck clean.

### Capability Gap
- [ ] **Specialists are deterministic keyword matchers** — cannot actually implement a new MCP tool end-to-end. Only jarvis (LLM) and oracle (LLM routing) are genuinely LLM-driven. Decide: which specialists need LLM?

### Migrated from `docs/jabr-TODO.md` (deduped 2026-09-14)
- [ ] **Test-file typecheck debt** — 149 errors in `tests/*`, pre-existing, not blocking.
- [ ] **Leaked API key** — `~/.config/opencode/opencode.json` needs rotation (blocked on user).
- [ ] **JABR security chain (8 tasks)** — archived, superseded by new sequential chain.

---

## What Genuinely Needs LLM

- [ ] Orchestrator route-decision LLM (invoke when `DynamicRegistry.matchAgent` returns low-confidence)
- [ ] Consensus synthesis (already LLM-backed — keep)
- [ ] Jarvis proactive scans (already LLM-driven — keep)
- [ ] Scientist interpretation (when `run_python` returns non-trivial data needing narrative)

## What Should Stay Rule-based

- `oracle` / `librarian` / `explorer` / `designer` / `fixer` — keyword routing already works; deterministic + cheap
- `DynamicRegistry.matchAgent` — tag-substring + keyword overlap scoring; only escalate to LLM on low-confidence
