# 🏗️ Jabr/Kasbah Ecosystem Rebuild — Production-Grade Handoff

**Target branch:** `feature/bereal` (create from `develop`)
**Agent:** OpenCode / Coding Agent
**Priority:** Critical — architectural transformation

---

## 🎯 Vision

Transform JABR from a research prototype into a **production-grade, transverse-ready agent ecosystem** that can be used by real companies (pro users) and casuals alike.

**Core principles:**
1. **Don't reinvent** — use battle-tested OSS tools for plumbing
2. **Each agent is independently deployable** — microservice-style
3. **Kasbah is the central hub** — where all agents meet, delegate, and do SHURA (consensus)
4. **Open source** — MIT license, community-friendly
5. **Token-efficient** — every line of code must justify its existence
6. **Production-grade** — auth, observability, security, multi-tenancy

---

## 🏛️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          KASBAH (Central Hub)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │  Router   │  │  Auth    │  │  SHURA   │  │  Observability   │    │
│  │ (A2A)    │  │ (OIDC)   │  │(Consensus│  │  (OTel/Langfuse) │    │
│  └────┬─────┘  └──────────┘  └────┬─────┘  └──────────────────┘    │
│       │                           │                                  │
│  ┌────┴───────────────────────────┴─────────────────────────────┐   │
│  │              Message Bus (Redis / NATS)                       │   │
│  └────┬──────────┬──────────┬──────────┬───────────┬────────────┘   │
└───────┼──────────┼──────────┼──────────┼───────────┼────────────────┘
        │          │          │          │           │
   ┌────┴───┐ ┌────┴───┐ ┌───┴────┐ ┌──┴─────┐ ┌───┴─────┐
   │ JABIR  │ │ RUSHD  │ │FIHRIYA │ │BATTUTA │ │ FIRNAS  │
   │(Router)│ │(Review)│ │(Research│ │(Explore)│ │(Design) │
   │        │ │        │ │/Docs)  │ │         │ │         │
   └────────┘ └────────┘ └────────┘ └─────────┘ └─────────┘
   ┌────────┐ ┌────────┐
   │ TARIQ  │ │KHWARIZM│
   │(Fixer) │ │(Science│
   │        │ │/Data)  │
   └────────┘ └────────┘

Each agent:
- Has its own SOUL.md, IDENTITY.md, AGENTS.md
- Can run standalone (single agent mode)
- Connects to Kasbah for orchestration
- Speaks A2A protocol for agent-to-agent communication
```

---

## Phase 0: Project Identity & Documentation

### 0A. Rename & Rebrand
- Project name: **Kasbah** (hub) + **Jabr** (agent ecosystem)
- Package scope: `@kasbah/core`, `@kasbah/agent-*`
- Repo stays `agent-lab` or rename to `kasbah`

### 0B. README.md (root)
Write a production-grade README that includes:

```markdown
# Kasbah — Multi-Agent Orchestration Hub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![A2A Protocol](https://img.shields.io/badge/A2A-v1.0-blue)](https://a2a-protocol.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

Kasbah is a production-grade, open-source multi-agent orchestration system.
Each agent is independently deployable. The Kasbah is where agents meet,
delegate work, and reach consensus through SHURA.

## Quick Start
## Architecture
## Deploying Individual Agents
## Kasbah Hub Setup
## Agent Catalog
## Configuration
## Production Deployment
## License (MIT)
```

### 0C. LICENSE
- Add MIT `LICENSE` file at repo root

### 0D. souls/README.md
- Index of all agents with descriptions
- Link to each agent's SOUL.md, IDENTITY.md, AGENTS.md
- Explain the Mirror approach (code → markdown sync)

### 0E. Complete Remaining Soul Files
1. Move root `SOUL.md` → `souls/jabir/SOUL.md`
2. Write `souls/verification/SOUL.md` (SHURA — the council, consensus, cross-checking)
3. Wire `scripts/generate-agent-souls.py` into `package.json` scripts

---

## Phase 1: Delete & Delegate (Stop Reinventing)

### 1A. Delete Custom Protocol Implementations
Files to REMOVE:
- `src/adapters/http/a2a-server.ts` — use `@a2a-js/sdk` directly
- `src/adapters/a2a/client.ts` — use `@a2a-js/sdk` client
- `src/adapters/a2a/serialize.ts` — SDK handles this
- `src/adapters/http/a2a-client-adapter.ts` — redundant
- `src/protocols/mcp/server/tools.ts` — use `@modelcontextprotocol/sdk` directly
- `src/protocols/mcp/server/validation.ts` — SDK handles this
- `src/protocols/mcp/server/index.ts` — SDK handles this
- `src/adapters/mcp/mcp-resources.ts` — SDK handles this
- `src/adapters/mcp/mcp-client.ts` — SDK handles this

### 1B. Delete Custom Security/Auth
Files to REMOVE:
- `src/security/jwt.ts` — use `jose` or Auth0
- `src/security/tls-config.ts` — Bun native TLS
- `src/security/auth-middleware.ts` — SDK handles this
- `src/security/oauth-server.ts` — use Auth0/Keycloak
- `src/security/token-store.ts` — use Redis
- `src/security/api-key-registry.ts` — SDK handles this
- `src/security/handover-chain.ts` — A2A SDK handles delegation

### 1C. Delete Custom Infrastructure
Files to REMOVE:
- `src/adapters/rate-limit.ts` — use `rate-limiter-flexible` or Upstash
- `src/adapters/idempotency-lock.ts` — use Redis
- `src/adapters/subscription-manager.ts` — use Redis pub/sub
- `src/adapters/websocket/bun-websocket-adapter.ts` — Bun native WS
- `src/adapters/gunjs/gunjs-memory-adapter.ts` — experimental, unused
- `src/adapters/ipfs/ipfs-artifact-adapter.ts` — premature
- `src/core/plugin-registry.ts` — Hermes has plugins
- `src/core/webhook-to-a2a-bridge.ts` — over-engineered

### 1D. Delete Redundant Memory/Knowledge
Files to REMOVE:
- `src/adapters/memory-fs.ts` — redundant with SQLite
- `src/adapters/task-memory.ts` — in-memory is test-only
- `src/ports/knowledge-port.ts` — use OpenViking
- `src/ports/graph-memory-port.ts` — no graph DB backend

### 1E. Delete Redundant LLM Adapters
Files to REMOVE:
- `src/adapters/llm/9router.ts` — use Vercel AI SDK
- `src/adapters/llm/vercel.ts` — use Vercel AI SDK directly
- `src/adapters/llm/openai.ts` — use Vercel AI SDK directly
- `src/adapters/llm/factory.ts` — AI SDK has provider selection

### 1F. Delete Redundant Comms Channels (keep only active ones)
KEEP if actively used:
- `src/adapters/http/telegram-webhook.ts` (if Telegram active)
- `src/adapters/http/github-webhook.ts` (if GitHub active)

REMOVE if speculative:
- `src/adapters/http/whatsapp-webhook.ts` (handled by Hermes bridge)
- `src/adapters/http/webhook-server.ts` (generic, unused)

### 1G. Delete Redundant Port Interfaces
After all deletions, audit `src/ports/`:
- Remove any port with zero callers
- Merge ports with exactly one implementation
- Keep only: `agent-registry`, `a2a-client`, `llm`, `memory`, `budget`, `skill`

---

## Phase 2: Rebuild Core (What We Keep, Polished)

### 2A. Kasbah Core (`src/core/`)
KEEP and POLISH:
- `orchestrator.ts` — Router using tag-scored matching (our differentiator)
- `cognitive-loop.ts` — SHURA consensus engine (our differentiator)
- `jabir.ts` — Main entry point

REFACTOR to use:
- `@a2a-js/sdk` for all A2A communication
- Vercel AI SDK (`ai` package) for LLM calls
- OpenViking adapter for memory (instead of custom SQLite)

### 2B. Agent System — Configurable Agents
REPLACE 9 hardcoded specialist agents with:
- **1 configurable agent** that loads role from `souls/<name>/` files
- Agent behavior defined by: SOUL.md (personality) + AGENTS.md (operational rules)
- Runtime reads markdown files to configure LLM prompts

Files:
- `src/core/configurable-agent.ts` — reads souls/ at startup
- `src/core/verification.ts` — SHURA cross-checker (keeps its own file)

### 2C. Kasbah Hub (`src/kasbah/`)
NEW module — the central coordination point:
- `src/kasbah/hub.ts` — Agent registry, routing, delegation
- `src/kasbah/shura.ts` — Consensus/voting orchestration
- `src/kasbah/discovery.ts` — A2A Agent Card discovery

### 2D. Adapter Layer — Thin Wrappers Only
KEEP only thin adapters over existing tools:
- `src/adapters/a2a/client.ts` — thin `@a2a-js/sdk` wrapper
- `src/adapters/llm.ts` — thin Vercel AI SDK wrapper
- `src/adapters/memory.ts` — OpenViking adapter
- `src/adapters/x402/` — payment module (our novel work, keep isolated)

### 2E. Package.json Cleanup
Update dependencies — REMOVE unused:
- `gun` — P2P memory (deleted)
- `brain.js` — neural net (unused)
- `@tensorflow/tfjs-node` — ML (unused)
- `@huggingface/transformers` — local inference (unused)

KEEP:
- `@a2a-js/sdk`
- `@modelcontextprotocol/sdk`
- `ai` (Vercel AI SDK)
- `zod`

ADD:
- `@anthropic-ai/claude-agent-sdk` (for Claude Code bridge)
- `rate-limiter-flexible`

---

## Phase 3: Production Hardening

### 3A. Authentication & Authorization
- OIDC/OAuth2 via Auth0 or Keycloak (don't roll our own)
- Per-tenant API keys
- Agent-level permission scopes

### 3B. Observability
- OpenTelemetry spans for each agent call
- Langfuse integration for trace visualization
- Per-agent token usage + cost attribution
- Health check endpoints (`/healthz`, `/readyz`)

### 3C. Multi-Tenancy
- Per-tenant SQLite namespaces
- Tenant isolation in A2A routing
- Configurable per-tenant model providers

### 3D. Deployment
- `docker-compose.yml` for self-hosted (Kasbah + Redis + OpenViking + Langfuse)
- Individual agent Dockerfiles (each agent deployable alone)
- Helm chart for Kubernetes (stretch goal)

### 3E. CLI
- `kasbah start` — start the hub
- `kasbah agent add <name>` — add an agent
- `kasbah agent list` — list registered agents
- `kasbah task submit <agent> <task>` — submit a task
- `kasbah shura <task-id>` — trigger consensus review

---

## Phase 4: Documentation & Community

### 4A. README.md (root) — Production Grade
Sections:
1. **Tagline & Badges** — MIT, A2A, MCP
2. **What is Kasbah?** — One paragraph, clear value prop
3. **Quick Start** — 5-minute setup
4. **Architecture Diagram** — ASCII art or link to docs
5. **Agent Catalog** — Table of all agents with capabilities
6. **Deploying Individual Agents** — Standalone mode
7. **Kasbah Hub Setup** — Full orchestration mode
8. **Configuration** — Env vars, config files
9. **Production Deployment** — Docker, K8s, security
10. **Contributing** — How to add new agents
11. **License** — MIT

### 4B. docs/ Folder
- `docs/architecture.md` — Full system design
- `docs/agents.md` — Agent catalog + how to create new agents
- `docs/deployment.md` — Production deployment guide
- `docs/shura.md` — Consensus engine documentation
- `docs/a2a-bridge.md` — How agents communicate

### 4C. Agent Documentation
Each agent in `souls/` should have:
- `SOUL.md` — Personality, values, communication style
- `IDENTITY.md` — Metadata (name, skills, capabilities, tags)
- `AGENTS.md` — Operational interface (handoff rules, tool usage, error behavior)

---

## Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| Total TS files | 127 | < 30 |
| Total LOC | ~25,800 | < 5,000 |
| Protocol reimplementations | 3 | 0 (use SDKs) |
| Memory implementations | 5 | 1 |
| Specialist agents (files) | 9 | 1 configurable |
| Security hand-rolled | 7 files | 0 (use Auth0) |
| Port interfaces | 18 | < 6 |
| Dependencies | 12 (4 unused) | 6 (all used) |
| Individually deployable agents | ❌ | ✅ |
| Production auth | ❌ | ✅ (OIDC) |
| Observability | ❌ | ✅ (OTel + Langfuse) |
| License | MIT (file missing) | MIT (file present) |

---

## What NOT to Touch

- `labs/` directory — explicitly out of scope (experimental scratch)
- `src/souls/` — agent personality system (Phase 0E completes it)
- `src/adapters/x402/` — novel work, keep isolated
- `src/adapters/headroom/` — context compression, actively used
- `src/adapters/hermes-kanban.ts` — Hermes integration
- `spec/a2a.proto` — reference protobuf definition
- `scripts/generate-agent-souls.py` — soul generation tooling

---

## Execution Order

```
Phase 0 (Docs & Identity)     → Phase 1 (Delete & Delegate)
→ Phase 2 (Rebuild Core)      → Phase 3 (Production Hardening)
→ Phase 4 (Docs & Community)
```

**Commit after each phase.** Run `bun run typecheck && bun run lint` before each commit.

---

*Vision: Kasbah is where agents meet. Each agent is a sovereign worker. SHURA is how they agree. Production-grade from day one.*
