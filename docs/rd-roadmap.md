# Jabr R&D Roadmap — Dependency Stack & Source Exploration

**Date:** 2026-08-30
**Status:** Research & Development
**Related:** `package.json` (dependency stack), [opensrc](https://opensrc.sh/) (source exploration), `CANONICAL.md`, `JABR-GROWTH.md`, `docs/adr/agent-enhancement-roadmap.md`

---

## 1. Purpose

This document captures the **research & development opportunities** unlocked by Jabr's current dependency stack (`package.json`) and the newly-available **opensrc** source-exploration tool. It is a living TODO-backed roadmap: each section identifies an R&D area, the dependency/tool that enables it, and concrete future tasks.

The goal is not to plan features for today — it is to map **what we could research, prototype, and build** next, prioritized by leverage.

---

## 2. Current Dependency Stack (package.json)

| Package | Version | Role | R&D Leverage |
|---------|---------|------|--------------|
| `ai` | ^7.0.85 | Vercel AI SDK — `generateText`/`streamText`/`createGateway` | Provider-agnostic LLM abstraction, streaming, gateway routing (already wired via `VercelLlmAdapter`) |
| `@a2a-js/sdk` | ^1.1.0 | A2A protocol (JSON-RPC, agent cards, task lifecycle) | Multi-agent interop, handover, dynamic registry |
| `@modelcontextprotocol/sdk` | ^1.30.0 | MCP protocol (server/client) | Tool/resource/sampling/prompt/roots compliance |
| `@huggingface/transformers` | ^4.2.0 | Local ML inference (transformers.js) | On-device embeddings, classification, summarization |
| `@tensorflow/tfjs-node` | ^4.22.0 | TensorFlow in Node | Local neural nets, custom models (scientist agent) |
| `brain.js` | ^2.0.0-beta.24 | Lightweight neural networks | Small trained models, pattern learning |
| `headroom-ai` | ^0.37.0 | Context compression | Token-budget management, memory distillation |
| `zod` | ^4.4.3 | Schema validation | Runtime validation, tool schemas, plugin manifests |
| `moment` | ^2.30.1 | Date/time | Scheduling, TTL, time-windowed memory |
| `@faker-js/faker` | ^10.6.0 | Fake data | Test fixtures, synthetic data generation |

**Native/trusted deps** (`trustedDependencies`): `@tensorflow/tfjs-node`, `core-js`, `gl`, `onnxruntime-node`, `protobufjs`, `sharp` — these power the **scientist** agent's heavy ML path.

---

## 3. opensrc — Source Exploration Capability

**opensrc** (v0.7.3, installed at `~/.bun/bin/opensrc`) fetches and caches package **source code** locally so agents can inspect implementations directly.

### Capabilities

- `opensrc path <pkg>` → absolute path to cached source (subshell-friendly: progress→stderr, path→stdout)
- `opensrc fetch <pkg>` → pre-fetch without printing path
- `opensrc clean` / `opensrc list` → cache management
- `OPENSRC_HOME` env var → override cache location (default `~/.opensrc/`)

### Registries

| Registry | Format |
|----------|--------|
| npm | `zod` (default) / `npm:zod` |
| PyPI | `pypi:requests` |
| crates.io | `crates:serde` |
| GitHub | `vercel/ai` / full URL |
| GitLab | `gitlab:owner/repo` |
| Bitbucket | `bitbucket:owner/repo` |

### Key facts

- **Owner:** Vercel Labs (`vercel-labs/opensrc`), Apache 2.0, free, no API keys for public registries
- **Version detection:** npm auto-detects from `node_modules`/lockfiles; others use latest
- **Private repos:** `GITHUB_TOKEN`/`GITLAB_TOKEN`/`BITBUCKET_TOKEN` env vars (never persisted)
- **Design:** shallow-clone at version tag → cache → print path. Built for AI coding agents.

---

## 4. R&D Opportunity Areas

### 4.1 Source-Aware Agents (opensrc)

**Thesis:** Give the librarian/explorer agents first-class access to dependency source so they can answer "how does X actually work?" from real code, not docs.

- [ ] **TODO 4.1.1** — Wire `opensrc` into the agent tooling: add a `source_path` MCP tool or shell wrapper so agents can call `opensrc path <pkg>` and read cached source.
- [ ] **TODO 4.1.2** — Add an `opensrc` section to `AGENTS.md` so agents know source is cached at `~/.opensrc/` (opensrc's own AGENTS.md integration pattern).
- [ ] **TODO 4.1.3** — Evaluate replacing/augmenting the `clonedeps` skill with opensrc (multi-registry, version-aware, already installed).
- [ ] **TODO 4.1.4** — Research: cache warm-up strategy — pre-fetch the full Jabr dependency tree (`opensrc fetch` for all `package.json` deps) so agent source lookups are instant.
- [ ] **TODO 4.1.5** — Research: version-pinning correctness — verify opensrc resolves the exact installed version for each dep (lockfile detection) vs latest.

### 4.2 LLM Provider Abstraction (ai SDK)

**Thesis:** The `ai` SDK + `createGateway` unlocks a provider-agnostic, resilient LLM layer (already partially wired via `VercelLlmAdapter`).

- [ ] **TODO 4.2.1** — Research: add more providers to `createLlmAdapter` (OpenAI-compatible done; add Anthropic, local Ollama, etc.) via the `ai` SDK's multi-provider support.
- [ ] **TODO 4.2.2** — Research: `providerOptions.gateway.order` fallback chains — build a resilient multi-provider failover so a provider outage doesn't kill agents.
- [ ] **TODO 4.2.3** — Research: streaming telemetry — surface `streamText` token/usage data into the budget system for all providers, not just Vercel.
- [ ] **TODO 4.2.4** — Research: structured output — use `ai` SDK's structured generation (zod schemas) for reliable agent JSON responses.

### 4.3 Local ML & Scientist (transformers / tfjs / brain.js)

**Thesis:** The heavy ML deps (scientist agent) enable on-device intelligence without external API calls.

- [ ] **TODO 4.3.1** — Research: local embeddings via `@huggingface/transformers` for semantic memory search (replace/augment current memory store).
- [ ] **TODO 4.3.2** — Research: local text classification/summarization for memory distillation (currently LLM-driven).
- [ ] **TODO 4.3.3** — Research: `brain.js` for lightweight pattern learning (e.g., routing heuristics, task-duration prediction).
- [ ] **TODO 4.3.4** — Research: `onnxruntime-node`/`tfjs-node` cross-compat — which models can run where, and whether the scientist agent's heavy native path can be slimmed.

### 4.4 Context & Memory (headroom-ai)

**Thesis:** `headroom-ai` (already an MCP server here) is the context-compression backbone — R&D should extend it.

- [ ] **TODO 4.4.1** — Research: integrate `headroom-ai` compression into agent memory distillation (currently `SqliteMemoryStore` + hierarchical distillation).
- [ ] **TODO 4.4.2** — Research: token-budget-aware auto-compression — compress agent context when approaching `JABR_TOKEN_CAP_<AGENT>`.

### 4.5 Protocol Compliance (A2A / MCP)

**Thesis:** The `@a2a-js/sdk` and `@modelcontextprotocol/sdk` underpin protocol evolution (see `docs/adr/agent-enhancement-roadmap.md`).

- [ ] **TODO 4.5.1** — Research: MCP sampling/prompts/roots compliance (2026-07-28 spec) — see `docs/mcp-gap-analysis.md`.
- [ ] **TODO 4.5.2** — Research: A2A dynamic agent registry + handover via `@a2a-js/sdk` — see `docs/adr/agent-enhancement-roadmap.md` §4.
- [ ] **TODO 4.5.3** — Research: use opensrc to inspect `@a2a-js/sdk` and `@modelcontextprotocol/sdk` internals for exact protocol behavior.

### 4.6 Schema & Validation (zod)

- [ ] **TODO 4.6.1** — Research: zod schemas for all task/agent/plugin manifests (currently ad-hoc types).
- [ ] **TODO 4.6.2** — Research: zod for plugin manifest validation (ties into plugin system — `JABR-GROWTH.md`).

### 4.7 Utilities (moment / faker)

- [x] **TODO 4.7.1** — **Remove `moment`** ✅ (done 2026-08-30) — it was declared in `package.json` but **never imported anywhere** in the codebase (only hits were comments like "Give Gun a moment to connect"). Removed from `dependencies` + lockfile (1 package removed). For any future date/time needs, use native modern APIs instead of re-adding a library:
  - **Intl API** (current native standard, no deps): `Intl.DateTimeFormat` for formatting/localization (replaces `moment().format()`), `Intl.RelativeTimeFormat` for relative time (replaces `moment().fromNow()`), `Intl.DisplayNames` for localized names.
  - **Temporal API** (TC39 long-term standard): `Temporal.Now.zonedDateTimeISO()`, `Temporal.PlainDate.from(...)`, `.add({ days: 7 })`, `.since(...)` — immutable, timezone-aware, supported natively or via lightweight polyfill.
  - **Cheat sheet:** `moment()` → `new Date()`; `.add(7,'days')` → `date.setDate(date.getDate()+7)` or `Temporal`; `.isAfter(other)` → `date > other`; `.format('YYYY-MM-DD')` → `date.toISOString().split('T')[0]`; `moment.tz.guess()` → `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- [ ] **TODO 4.7.2** — Research: `@faker-js/faker` for synthetic agent-task fixtures in tests and demos.

---

## 5. Prioritized TODO Backlog

> Ordered by leverage (impact × ease). Check off as completed; link commit refs.

### P0 — Quick Wins (low effort, high value)
- [ ] **4.1.2** — Add `opensrc` section to `AGENTS.md`
- [ ] **4.1.4** — Pre-fetch Jabr dependency tree into opensrc cache
- [ ] **4.2.2** — Multi-provider failover via `gateway.order` (resilience)

### P1 — Core R&D (medium effort, high value)
- [ ] **4.1.1** — Wire `opensrc` into agent tooling (`source_path` MCP tool)
- [ ] **4.2.1** — Add more LLM providers to `createLlmAdapter`
- [ ] **4.3.1** — Local embeddings for semantic memory
- [ ] **4.4.1** — Integrate `headroom-ai` into memory distillation

### P2 — Advanced (higher effort, exploratory)
- [ ] **4.3.3** — `brain.js` pattern learning
- [ ] **4.5.1** — MCP sampling/prompts/roots compliance
- [ ] **4.5.2** — A2A dynamic registry + handover
- [ ] **4.6.1** — zod schemas for manifests

### P3 — Backlog / Future
- [ ] **4.1.3** — `clonedeps` → opensrc migration
- [ ] **4.2.3** — Streaming telemetry for all providers
- [ ] **4.3.4** — Scientist native-path slimming
- [x] **4.7.1** — Remove unused `moment` dep ✅ (native Intl/Temporal for any future date needs)
- [ ] **4.7.2** — faker-based fixtures

---

## 6. Open Research Questions

1. **opensrc cache freshness** — how to invalidate/refresh cached source when a package updates? (`opensrc clean` is manual.)
2. **Local ML vs API** — for which tasks do local models (`transformers`/`tfjs`) beat the LLM gateway on cost/latency?
3. **Provider failover semantics** — what's the correct fallback order and how do we surface per-provider cost?
4. **Context compression quality** — does `headroom-ai` compression preserve enough fidelity for memory distillation vs the existing hierarchical approach?
5. **opensrc security** — is shallow-cloning arbitrary package source a supply-chain risk we need to gate?

---

## 7. Related Documents

| Document | Purpose |
|----------|---------|
| `CANONICAL.md` | Full architecture, gaps, roadmap |
| `JABR-GROWTH.md` | Growth strategy + plugin system |
| `docs/adr/agent-enhancement-roadmap.md` | Protocol evolution kits (PnP, Live Context, IDE-Native, Cognitive Loop) |
| `docs/mcp-gap-analysis.md` | MCP 2026-07-28 compliance gaps |
| `docs/plugin-system-research.md` | Plugin system detailed research |
| `TODO.md` | Task tracker — completed work + future phases |
| `AGENTS.md` | Agent-specific notes (internal) |
