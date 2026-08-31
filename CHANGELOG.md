# Changelog

All notable changes to **Jabr** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **R&D roadmap** (`docs/rd-roadmap.md`) — research & development opportunities unlocked by the dependency stack and the opensrc source-exploration tool, with a prioritized TODO backlog (P0–P3).
- **Cross-references** to the R&D roadmap from `README.md` (Documentation table) and `CANONICAL.md` (Roadmap + References).

### Removed
- **`moment` dependency** — it was declared in `package.json` but never imported anywhere in the codebase (dead weight). Removed from `dependencies` and the lockfile. Native `Intl`/`Temporal` APIs are the documented replacement for any future date/time needs.

---

## [0.3.0] — 2026-08-30

### Added
- **Vercel AI Gateway LLM adapter** (`agents/adapters/llm/vercel.ts`) — opt-in, provider-agnostic LLM provider via the Vercel AI SDK (`ai` v7) `createGateway`/`generateText`/`streamText`. Resilient form uses `minimax/minimax-m3` with `providerOptions.gateway.order = ['gmicloud']` so it survives the Sept 6 free-period end.
- **LLM adapter factory** (`agents/adapters/llm/factory.ts`) — `createLlmAdapter()` selects the provider: `openai` → `OpenAiLlmAdapter`, `vercel` (or `VERCEL_AI_GATEWAY_KEY`) → `VercelLlmAdapter`, otherwise → `NineRouterLlmAdapter` (default 9Router/OpenRouter free tier, no billing required).
- **OpenAI-compatible provider** — `JABR_LLM_PROVIDER=openai` routes to `OpenAiLlmAdapter` (any `/chat/completions` provider via `JABR_OPENAI_BASE_URL`/`API_KEY`/`MODEL`).
- **Standalone binary build script** (`scripts/build.ts`) — compiles 12 agent entry points into standalone executables with bytecode (`bun run build`), output to `dist/bin`. Uses `format: "esm"` so bytecode + top-level await coexist.
- **`build` npm script** — `bun scripts/build.ts`.
- **`verification` agent** to the CLI topology (port 4009, A2A).
- **Supported LLM Providers** documentation section in `README.md`.

### Changed
- **`scripts/jabr-cli.ts`** — prefers `dist/bin` standalone binaries (falls back to source); added `verification` agent; added Vercel AI Gateway env vars to the config list.
- **`scripts/demo.ts`** — fixed bare `fs`/`path` imports to use the `node:` prefix.
- **5 run modules** (orchestrator, oracle, fixer, jarvis, librarian) — now construct their LLM via `createLlmAdapter()` instead of `new NineRouterLlmAdapter()` directly.
- **`.env.example`** — added `JABR_LLM_PROVIDER`, `VERCEL_AI_GATEWAY_KEY`, `VERCEL_AI_GATEWAY_MODEL`, `VERCEL_AI_GATEWAY_BASE_URL`.
- **`AGENTS.md` / `CANONICAL.md`** — added Vercel AI Gateway env vars to the environment tables.

### Fixed
- **oh-my-opencode-slim fixer model** — changed from nonexistent `opencode/hy3-free` to `opencode/ling-3.0-flash-fin-free` (root cause of repeated @fixer delegation failures).

---

## [0.2.0] — 2026-08-29

> Reconstructed from git history (v0.4.0 audit era). Covers the post-audit hardening and protocol work.

### Added
- **x402 payment integration** — payment middleware for the A2A server, agent pricing metadata, settlement ledger with chain-proof guard, refill minting, client settlement cache, cost-per-task mirroring.
- **Realtime WebSocket adapter & port** — async `/emit` fetch handler, payload validation, realtime event emission from all agent runners (oracle, librarian, explorer, designer, fixer, jarvis, scientist) via HTTP bridge; orchestrator owns the realtime port.
- **Lifecycle helpers** — `task:created`/`task:completed`/`task:failed` lifecycle events with signal handling.
- **Routing tag scoring** — exact whole-word matches rank higher than substring matches.
- **MCP client SDK rewrite** with elicitation support; `withLogging` wrapper on all MCP tool handlers.
- **Webhook adapters** — Telegram, WhatsApp, GitHub with signing, idempotency, and rate limiting.
- **Jabr CLI** — `status`, `logs`, and `send` commands.
- **Pollinations image generation adapter** and **x402 wallet bridge**.
- **Triage bulk-create script** for deep-investigation findings.

### Changed
- **Dev launcher** — orchestrator owns the realtime port; runners bridge via `JABR_REALTIME_PORT`.
- **A2A server** — hoisted x402 check; delegated routing through the x402 client when configured.
- **`AGENTS.md` files** reconciled with the current codebase.

### Fixed
- Realtime adapter and x402 server type errors.
- x402 dead amount helpers and redundant chain endpoint removed from mint records.

---

## [0.1.0] — 2026-08-27

> Reconstructed from git history. Covers the initial hexagonal refactor through the v0.4.0 audit.

### Added
- **Hexagonal architecture** — ports & adapters refactor; core never imports adapters.
- **6-agent routing** — renamed `coder`→`fixer`, `researcher`→`librarian`, added `oracle`/`explorer`/`designer`.
- **Skills system** — JSON skill format, lifecycle, self-improvement loop.
- **A2A v1.0 compliance** — 9-state task lifecycle, production hardening, memory, x402 groundwork.
- **A2A handover protocol** — specialist transfer signals with recursive orchestrator routing.
- **A2A dynamic discovery** — 9Router web search and image generation integration.
- **Live Context Kit** — MCP resource infrastructure with world-state, subscriptions, and live data.
- **Cognitive Loop Kit** — consensus engine with weighted multi-agent voting.
- **IDE-Native Kit** — ACP diff streaming + stateful sessions.
- **Provider-agnostic `LlmPort`** and consensus synthesis.
- **Scientist agent** with MCP tool integration (Python data analysis).
- **Mem-Palace integration** and Headroom budget awareness.
- **Jarvis proactive codebase steward** — KanbanPort, HermesKanbanAdapter, async DiscoveryPort.
- **9Router LLM default** — `openrouter/minimax/minimax-m3:free` via the 9Router gateway.
- **SQLite persistence** — `bun:sqlite` TaskStore + MemoryStore adapters; orchestrator + ACP bridge wired to them.
- **LLM-driven oracle** with handover routing.
- **`bun:test` infra** and DynamicRegistry routing tests.
- **tmux runner** for all Jabr agents.
- **MIT LICENSE**, `opencode.json` config, concept design spec, rebranding notes.
- **Rebrand** — `agent-lab` → **Jabr** (Arabic for restoration of broken parts, root of algebra); AgentCard name rebrand to polymath identities.

### Changed
- **`runAgent()` factory** — DRY specialist run scripts.
- **`calculate` MCP tool** — replaced `eval` with a safe recursive-descent evaluator.
- **Memory** — dropped redundant `.md` mirror, dedup + cap `memory_log`.
- **`demo.ts`** — conformed to the synchronous `tasks/send` A2A contract.
- **Discovery** — lazy agent discovery with retry in `DynamicRegistry`.

### Fixed
- Hexagonal boundary — `DiscoveryPort` isolates core from adapter.
- Jarvis `onTask` returns real result; writes to `taskStore`; injects agent endpoint into LLM prompts; robust `extractJson`; hardened version parse.
- A2A flat `{text}` result shape handling.
- Memory-fs base dir resolution (from module location, not `process.cwd()`).
- MCP resource change notifications via `SubscriptionManager`.

---

## [0.0.1] — 2026-08-26

### Added
- **Initial project scaffold** — ACP + A2A + MCP multi-agent experiment (Hermes + OpenCode stack).
- Migrated MCP SDK from deprecated `Server` to `McpServer`.
- Project config files and documentation.

---

## Legend

- **Added** — new capabilities.
- **Changed** — changes in existing functionality.
- **Deprecated** — soon-to-be-removed features.
- **Removed** — now-removed features.
- **Fixed** — bug fixes.
- **Security** — vulnerability fixes.

---

## References

- [CANONICAL.md](./CANONICAL.md) — full architecture, gap analysis, production readiness, roadmap.
- [TODO.md](./TODO.md) — task tracker.
- [docs/rd-roadmap.md](./docs/rd-roadmap.md) — R&D opportunities.
