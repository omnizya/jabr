# Jabr — Canonical Documentation

*Jabr (جبر) — Arabic for "restoration of broken parts," the root of algebra.*

**Version:** 0.4.0 (Draft)
**Status:** Experimental — not production-ready
**License:** MIT
**Runtime:** Bun 1.4 (TypeScript) + uv (Python)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Protocol Layers](#protocol-layers)
4. [Agent Ecosystem](#agent-ecosystem)
5. [Memory & Knowledge](#memory--knowledge)
6. [Skills & Self-Improvement](#skills--self-improvement)
7. [Gap Analysis vs A2A v1.0](#gap-analysis-vs-a2a-v10)
8. [Production Readiness Assessment](#production-readiness-assessment)
9. [x402 & Agentic Payments](#x402--agentic-payments)
10. [Roadmap](#roadmap)

---

## Executive Summary

Jabr is an experimental multi-agent system that tests three open protocols together:
- **ACP** (Agent Communication Protocol) — IDE ↔ Agent bridge via stdio
- **A2A** (Agent-to-Agent Protocol) — Agent ↔ Agent communication via HTTP JSON-RPC
- **MCP** (Model Context Protocol) — Agent ↔ Tool integration via stdio

**What makes Jabr different:**
- **Hexagonal architecture** — core domain logic has zero infrastructure dependencies
- **Self-improvement loop** — Librarian agent auto-generates skills after novel tasks
- **Budget tracking** — per-agent token budgets with automatic throttling
- **Tag-scored routing** — dynamic agent selection by capability tags (not hardcoded)
- **Consensus engine** — weighted voting across agents for contested decisions

**The honest assessment:** Jabr has a stronger architectural foundation than most open-source A2A implementations, but critical gaps (streaming, auth, verification, observability) prevent production deployment. This document maps exactly where we are, what's missing, and how to close the gaps.

---

## Architecture Overview

### Hexagonal Design (Ports & Adapters)

```
agents/
├── core/              # Domain logic — ZERO infrastructure imports
│   ├── orchestrator.ts   # Routing, delegation, handover, memory
│   ├── cognitive-loop.ts # Consensus scoring + synthesis
│   ├── oracle.ts         # Code review, simplification, architecture
│   ├── fixer.ts          # Bug fixes, code generation, mechanical impl
│   ├── librarian.ts      # Docs, web research, code search
│   ├── explorer.ts       # Fast codebase recon, file search
│   ├── designer.ts       # UI/UX design, responsive layouts
│   └── scientist.ts      # Python data analysis via MCP tools
├── ports/             # Interfaces (import type only)
├── adapters/          # Concrete implementations
├── types.ts           # Shared TypeScript types
├── utils/             # JSON-RPC helpers, CORS
└── run/               # Composition roots (wire ports → core)
```

**Golden rule:** `core` never imports `adapters`. `adapters` implement `ports`. `run` wires everything.

### Why Hexagonal?

- **Testability** — swap adapters without touching core logic
- **Protocol agility** — A2A → ANP → future protocol = new adapter, same core
- **Vendor independence** — LLM provider = adapter (9router, OpenAI, Anthropic, local)
- **Deployment flexibility** — local stdio, HTTP, or P2P = different adapters

---

## Protocol Layers

### ACP (Agent Communication Protocol)

**Purpose:** IDE ↔ Agent bridge
**Transport:** stdio, newline-delimited JSON (nd-JSON)
**Format:** JSON-RPC 2.0, one object per line

```jsonc
// Request
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"model":"base"}}

// Response
{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess_abc"}}
```

**Features:**
- `diff` content type for code changes
- `tool_call_update` stream for progress
- `session/list|delete|resume` with `replayFrom`

**Supported IDEs:** Zed (native), JetBrains (via acp.json)

---

### A2A (Agent-to-Agent Protocol)

**Purpose:** Agent ↔ Agent delegation
**Transport:** HTTP JSON-RPC + SSE (streaming in v1.0)
**Agent Cards:** `/.well-known/agent-card.json`

**Current wire protocol (v0.3-compatible):**
```bash
# POST to root path ONLY
curl -X POST http://localhost:4000/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tasks/send",
    "params": {
      "message": {
        "parts": [{"kind": "text", "text": "Review this code..."}]
      }
    }
  }'
```

**Response:**
```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "task_123",
      "state": "working",
      "artifacts": [...]
    }
  }
}
```

**Jabr's A2A implementation:**
- Synchronous (no SSE streaming yet)
- Agent Card at `/.well-known/agent-card.json`
- `%%HANDOVER%%` protocol for recursive delegation
- Tag-scored routing via `DynamicRegistry`
- Max handover depth: 3

---

### MCP (Model Context Protocol)

**Purpose:** Agent ↔ Tool integration
**Transport:** stdio, JSON-RPC 2.0

**Tools exposed:**
| Tool | Description |
|------|-------------|
| `read_file` | Read workspace file |
| `write_file` | Write workspace file |
| `run_python` | Execute Python via `uv run` (10s timeout) |
| `calculate` | Safe arithmetic evaluation |
| `save_skill` | Persist skill JSON (idempotent by slug) |
| `list_skills` | List saved skills |
| `install_python_dependency` | `uv add` into `.python_env/` |

**Resources exposed:**
| Resource | URI |
|----------|-----|
| World-state | `jabr://world-state` |
| Task | `jabr://tasks/{taskId}` |
| Skills | `jabr://skills` |
| Memory | `jabr://memory` |

---

## Agent Ecosystem

### Specialist Agents

| Agent | Port | LLM | Role | Key Capability |
|-------|------|-----|------|----------------|
| **Orchestrator** | 4000 | Yes | Routes tasks, persists memory, self-improves | Consensus engine, handover |
| **Oracle** | 4001 | Yes | Code review, simplification, architecture | `%%HANDOVER%%` emission when misrouted |
| **Librarian** | 4002 | Yes | Web search, docs, skill synthesis | Skill auto-generation |
| **Explorer** | 4003 | No | Fast codebase recon, file search | `codemap` skill |
| **Designer** | 4004 | Yes | UI/UX, image generation (9Router) | Responsive layouts |
| **Fixer** | 4005 | No | Bug fixes, mechanical implementation | Deterministic code changes |
| **Scientist** | 4006 | No | Python data analysis via MCP tools | `run_python` integration |
| **ACP Bridge** | stdio | No | IDE ↔ Orchestrator | Zed/JetBrains integration |

### Agent Card Format

```jsonc
{
  "name": "oracle",
  "description": "Code review, simplification, architecture",
  "url": "http://localhost:4001",
  "version": "0.1.0",
  "capabilities": {
    "streaming": false,           // ❌ Not yet implemented
    "pushNotifications": false,    // ❌ Not yet implemented
    "stateTransitionHistory": false // ❌ Not yet implemented
  },
  "tags": ["review", "simplify", "architecture", "code-quality"],
  "inputModes": ["text"],
  "outputModes": ["text"]
}
```

### Routing Algorithm

`DynamicRegistry.matchAgent(text)` scores each agent:
- +2 per tag substring match in task text
- +1 per keyword overlap (stopwords filtered, len > 2)
- Falls back to first registered agent (oracle) when no matches

---

## Memory & Knowledge

### Storage Architecture

```
memory/
├── jabr.db              # SQLite (WAL) — orchestrator + bridge
├── jabr-bridge.db       # SQLite (WAL) — ACP bridge only
├── palace/              # MemPalace adapter
│   └── <slug>.json
├── sessions/            # Session snapshots
│   └── session-<id>.json
└── orchestrator.md      # Append-only mirror of memory log
```

### Memory Port Interface

```typescript
interface MemoryStorePort {
  append(entry: MemoryEntry): Promise<void>;
  query(filter: MemoryFilter): Promise<MemoryEntry[]>;
  getContext(limit: number): Promise<string>;  // For LLM context injection
}
```

### Knowledge Port (MemPalace)

```typescript
interface KnowledgePort {
  search(query: string, tags?: string[]): Promise<KnowledgeEntry[]>;
  store(slug: string, content: string, tags: string[]): Promise<void>;
  invalidate(slug: string): Promise<void>;
}
```

### Current Limitations

| Feature | Status | Gap |
|---------|--------|-----|
| Hierarchical distillation | ❌ Missing | Flat storage only |
| Multi-signal retrieval | ❌ Missing | Semantic only, no temporal/social |
| Cross-agent shared memory | ⚠️ Partial | Per-agent isolation, orchestrator has global view |
| Memory compression | ❌ Missing | No context window management |
| Memory TTL/decay | ❌ Missing | Stale data persists forever |
| Conflict resolution | ❌ Missing | No consensus for contradictory memories |
| Graph traversal | ❌ Missing | Key-value only, no relationship queries |
| Temporal versioning | ❌ Missing | No "what did we know when?" |

---

## Skills & Self-Improvement

### Skill Format (JSON)

```jsonc
{
  "name": "simplify",
  "description": "Behavior-preserving code simplification",
  "tags": ["simplify", "refactor", "oracle"],
  "steps": [
    "Analyze the code for complexity hotspots",
    "Apply behavior-preserving transformations",
    "Verify with existing tests"
  ],
  "createdAt": "2026-08-29T03:47:26Z",
  "usageCount": 12,
  "successRate": 0.92
}
```

### Skill Lifecycle

1. **Built-in** — `skills/builtin/*.md` (static, per-agent assignment)
2. **Auto-generated** — Librarian writes `skills/<slug>.json` after novel tasks
3. **Idempotent** — same slug = skip (no duplicate skills)
4. **Scored** — `successRate` used in routing decisions

### Self-Improvement Loop

```
Task completed → Librarian analyzes → Novel? → Write skill JSON
                                            → Known? → Skip
```

---

## Gap Analysis vs A2A v1.0

### A2A v1.0 Specification Requirements

| Requirement | A2A v1.0 Status | Jabr Status | Priority |
|-------------|-----------------|-------------|----------|
| **Agent Card** | Required | ✅ Implemented | — |
|| **9-state task lifecycle** | Required | ✅ Implemented (9 states) | — |
|| **SSE streaming** | Required | ❌ Missing | 🔴 Critical |
|| **Push notifications** | Required | ❌ Missing | 🔴 Critical |
|| **OAuth 2.1 / mTLS auth** | Required | ❌ Missing | 🔴 Critical |
|| **State transition history** | Required | ✅ Implemented | — |
|| **Typed artifacts** | Required | ⚠️ Partial | 🟡 High |
| **AUTH_REQUIRED state** | Required | ❌ Missing | 🡃 High |

### Task Lifecycle Gap

**A2A v1.0 states:**
```
SUBMITTED → WORKING → INPUT_REQUIRED → COMPLETED
                ↘ FAILED / CANCELED / REJECTED / AUTH_REQUIRED / UNKNOWN
```

**Jabr current states:**
```
SUBMITTED → WORKING → COMPLETED
                ↘ FAILED / CANCELED / REJECTED / AUTH_REQUIRED / INPUT_REQUIRED / UNKNOWN
```

**Jabr missing states:** None — all 9 A2A v1.0 states are implemented.

**State transition history:** Every `updateState()` call records a `(from, to, timestamp)` row in the `task_transitions` table. Both `SqliteTaskStore` (SQLite-backed) and `TaskMemory` (in-memory) implement `getTransitionHistory(taskId)` from the `TaskStorePort`.

### Security Gap

**Current:** All endpoints previously returned `Access-Control-Allow-Origin: *` — no allowlist.

**Implemented:**
- CORS headers are now origin-aware: `buildCorsHeaders(origin)` and
  `buildCorsPreflightHeaders(origin)` in `agents/utils/rpc.ts` return headers
  only when the request origin appears in `ALLOWED_ORIGINS` (or the localhost
  dev fallback). Non-matching origins get no CORS headers, so the browser blocks
  the response. Legacy `corsHeaders` / `corsPreflightHeaders` constants (returning
  `*`) are kept only for backward compatibility and should not be used in new code.
- Per-caller request rate limiting via `agents/adapters/rate-limit.ts`:
  sliding-window limiter keyed by `X-API-Key` (when present) or remote IP.
  Configurable via `JABR_RATE_LIMIT_WINDOW_MS` and `JABR_RATE_LIMIT_MAX_REQUESTS`.
  Returns HTTP 429 with JSON-RPC error envelope when exceeded.
- API key validation on all agent endpoints
- OAuth 2.1 for cross-organization delegation
- mTLS for service-to-service communication

### Observability Gap

**Current:** No tracing, no span-level timing, no structured logging.

**Required for production:**
- OpenTelemetry spans for each agent call
- Trace context propagation across A2A boundaries
- Task duration metrics
- Error rate tracking per agent
- Cost attribution per task/agent

### Verification Gap

**Current:** Single-agent execution, no independent review.

**Required for production:**
- Independent verification agent (cross-check outputs)
- Consensus threshold for contested results
- Dead letter queue for failed verifications
- Audit trail for all agent decisions

---

## Production Readiness Assessment

### What's Production-Ready

| Component | Status | Notes |
|-----------|--------|-------|
| Hexagonal architecture | ✅ Clean | Core has zero infra imports |
| Agent registry | ✅ Solid | Tag-scored, dynamic discovery |
| SQLite persistence | ✅ Solid | WAL mode, session tracking |
| Budget tracking | ✅ Solid | Per-agent caps, auto-throttle |
| MCP tool server | ✅ Solid | fs, python, calculate, skills |
| ACP bridge | ✅ Solid | Zed + JetBrains support |
| Skill system | ✅ Solid | Auto-generation, idempotent |

### What's NOT Production-Ready

| Component | Status | Blocker |
|-----------|--------|---------|
| A2A streaming | ❌ Missing | Can't report progress on long tasks |
| A2A push notifications | ❌ Missing | No async event delivery |
| Auth (OAuth2/mTLS) | ❌ Missing | No security on endpoints |
| Task lifecycle (9 states) | ❌ Partial | Missing INPUT_REQUIRED, REJECTED, AUTH_REQUIRED |
| Circular handoff detection | ❌ Missing | Infinite loop risk |
| Dead letter queue | ❌ Missing | Failed tasks lost silently |
| Independent verification | ❌ Missing | Errors propagate unchecked |
| Span-level tracing | ❌ Missing | Can't debug multi-agent latency |
| Memory compression | ❌ Missing | Context window overflow risk |
| Memory TTL/decay | ❌ Missing | Stale data accumulates |

### The Verdict

**Jabr is a strong research prototype, not a production system.**

The architectural foundation (hexagonal, self-improving, budget-aware) is ahead of most open-source A2A implementations. But the gaps above are exactly what industry research identifies as the top blockers for enterprise adoption.

**Estimated effort to production-ready:** 8-12 weeks (1 developer, focused).

---

## x402 & Agentic Payments

### What is x402?

x402 (Coinbase, now Linux Foundation) activates the long-dormant HTTP 402 "Payment Required" status code for AI agent micropayments. Agents pay per API call in USDC, on-chain, with no human in the loop.

**The numbers:** 100M+ agentic payments on Base in ~3 quarters. Zero fees, 2-second settlement.

### How It Works

```
Client → GET /api/resource
Server → 402 Payment Required {
           network: "base",
           token: "USDC",
           amount: "0.001",
           recipient: "0x..."
         }
Client → Signs payment, retries with PAYMENT-SIGNATURE header
Server → Verifies on-chain, serves response
```

### How Jabr Can Benefit

#### 1. Agent-to-Agent Payments

Right now, our agents work for free. With x402:
- **Orchestrator pays specialists** — Oracle charges 0.01 USDC per review
- **Cross-agent hiring** — Librarian pays external research agents
- **Resource markets** — Scientist pays for GPU compute

#### 2. Monetize Our Agents

Expose agents as paid services:
- **Oracle** — code review as a service (0.02 USDC/review)
- **Librarian** — research reports (0.05 USDC/report)
- **Explorer** — codebase audit (0.1 USDC/audit)

#### 3. Budget Enforcement

Replace software token caps with real economic constraints:
- Agents can't spend what they don't have
- Automatic throttling when funds low
- Transparent on-chain accounting

#### 4. Decentralized Discovery

Agents discover and pay for services without central registry:
- Find the cheapest Oracle for a code review
- Hire specialized agents we've never seen before
- Negotiate prices dynamically

### Implementation Plan

| Component | Description | Effort |
|-----------|-------------|--------|
| x402 server middleware | Return 402 + payment requirements, verify on-chain | 1-2 days |
| Agent wallet | Each agent needs a wallet (smart contract or EOA) | 2-3 days |
| Payment client | Sign and attach payment headers to A2A requests | 1 day |
| Agent Card pricing | Declare prices in agent card capabilities | 0.5 day |
| Budget manager | On-chain balance tracking, auto-refill | 1-2 days |

**Total:** ~1 week to MVP

### The Bigger Picture

x402 is part of an emerging stack:
- **A2A** — agents talk to each other
- **MCP** — agents use tools
- **x402** — agents pay for things
- **AP2** (Google) — agent payments with traditional rails

Together, these enable the "agentic economy" — agents that don't just think, but transact. Jabr could be a showcase for this: a multi-agent system where agents pay each other, buy services, and manage their own budgets.

---

## Roadmap

> **R&D opportunities:** See [docs/rd-roadmap.md](./docs/rd-roadmap.md) for research & development ideas unlocked by the dependency stack and opensrc source exploration.

### Phase 1 — A2A v1.0 Compliance (2-3 weeks)

**Goal:** Pass A2A v1.0 conformance tests.

- [ ] Add SSE streaming to `a2a-server.ts`
- [ ] Add push notification endpoint (`tasks/sendSubscribe`)
- [ ] Implement full 9-state task lifecycle
- [ ] Add `INPUT_REQUIRED`, `REJECTED`, `AUTH_REQUIRED` states
- [ ] Add Agent Card capabilities flags (`streaming`, `pushNotifications`, `stateTransitionHistory`)
- [x] Add API key auth middleware
- [ ] Add typed `Artifact` types (not just text)

### Phase 2 — Production Hardening (2-3 weeks)

**Goal:** Safe for internal deployment.

- [ ] Circular handoff detection (graph cycle detection)
- [ ] Dead letter queue for failed tasks
- [ ] Span-level tracing (OpenTelemetry)
- [ ] Independent verification agent (cross-check outputs)
- [x] Rate limiting per agent/caller
- [ ] Structured logging (pino or similar)
- [ ] Health check endpoints
- [ ] Graceful shutdown handling

### Phase 3 — Memory & Knowledge (3-4 weeks)

**Goal:** Production-quality memory management.

- [ ] Hierarchical memory distillation (summarize → compress → prune)
- [ ] Cross-agent shared knowledge graph (not just per-agent)
- [ ] Memory compression (context window management)
- [ ] Memory TTL/decay (auto-stale old entries)
- [ ] Conflict resolution (consensus for contradictory memories)
- [ ] Graph traversal queries (relationship-aware retrieval)
- [ ] Temporal versioning ("what did we know when?")

### Phase 4 — x402 Integration (1 week)

**Goal:** Agent-to-agent payments working.

- [ ] x402 server middleware
- [ ] Agent wallet infrastructure
- [ ] Payment client for A2A requests
- [ ] Agent Card pricing declarations
- [ ] On-chain budget manager

### Phase 5 — Decentralization (Research)

**Goal:** Explore P2P agent coordination.

- [ ] Gossip protocol for ambient state diffusion (GEACL paper)
- [ ] Raft consensus for decentralized coordination
- [ ] Agent reputation system
- [ ] Economic model (agent wallets, payment channels)
- [ ] Governance framework (who can add/remove agents?)

---

## Quick Start

```bash
# Install
bun install

# Start all agents (parallel)
bun run dev

# Or individually
bun run orchestrator # port 4000
bun run oracle       # port 4001
bun run librarian    # port 4002
bun run explorer     # port 4003
bun run designer     # port 4004
bun run fixer        # port 4005
bun agents/run/scientist.ts # port 4006 (no script)

# Type check
bun run typecheck

# Integration test (agents must be running)
bun run demo
```

### IDE Integration (Zed)

```json
{
  "agent_servers": {
    "jabr": {
      "type": "custom",
      "command": "bun",
      "args": ["agents/run/acp-bridge.ts"],
      "default_mode": "base"
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|-----------|---------|-------------|
| `NINEROUTER_URL` | `http://localhost:20127` | LLM gateway URL |
| `NINEROUTER_KEY` | — | LLM API key |
| `NINEROUTER_MODEL` | `openrouter/minimax/minimax-m3:free` | Default model |
| `JABR_LLM_PROVIDER` | — | LLM provider selector: `vercel` (or set `VERCEL_AI_GATEWAY_KEY`) for Vercel AI Gateway, unset for 9Router |
| `VERCEL_AI_GATEWAY_KEY` | — | Vercel AI Gateway API key (also `AI_GATEWAY_API_KEY`) |
| `VERCEL_AI_GATEWAY_MODEL` | `minimax/minimax-m3` | Vercel model ID (resilient form survives Sept 6 free-period end) |
| `VERCEL_AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v4/ai` | Vercel AI Gateway base URL (optional override) |
| `ORCHESTRATOR_URL` | `http://localhost:4000` | ACP bridge target |
| `JABR_TOKEN_CAP_<AGENT>` | `100000` | Per-agent token budget |
| `ALLOWED_ORIGINS` | (empty → localhost dev fallback) | Comma-separated CORS allowlist |
| `JABR_RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window for per-caller rate limiter |
| `JABR_RATE_LIMIT_MAX_REQUESTS` | `60` | Max requests per caller per window |

---

## Contributing

This is an experimental research project. Contributions welcome but expect rapid iteration and breaking changes.

**Before contributing:**
1. Read this document
2. Run `bun run typecheck` — must pass
3. Run `bun run demo` — integration test must pass
4. Follow conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)

---

## License

MIT — see [LICENSE](./LICENSE).

---

## References

- [R&D Roadmap (dependency stack + opensrc)](./docs/rd-roadmap.md)
- [A2A Protocol v1.0](https://a2a-protocol.org/latest/specification/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [ACP Specification](https://agentcommunicationprotocol.dev/)
- [x402 Protocol](https://x402.org/)
- [Agentic AI Survey (arXiv)](https://arxiv.org/html/2510.25445v1)
- [Multi-Agent Orchestration Patterns](https://www.glukhov.org/ai-systems/architecture/multi-agent-orchestration-patterns/)
- [Agent Observability Guide](https://zylos.ai/research/2026-05-29-agent-observability-debugging/)
- [Gossip-Enhanced Agentic Coordination Layer (GEACL)](https://arxiv.org/html/2512.03285v1)
- [Decentralized AI Agents and Blockchain](https://doi.org/10.3390/fi18070352)
