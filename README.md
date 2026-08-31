# Jabr

*Jabr (جبر) — Arabic for "restoration of broken parts," the root of algebra.*

**Version:** 0.4.0
**Status:** Experimental — not production-ready
**License:** MIT

Experimental multi-agent system testing **ACP + A2A + MCP** together. Hexagonal architecture (Ports & Adapters).

Runtime: **Bun 1.4** (TypeScript) + **uv** (Python). No build step — run `.ts` directly.

---

## Documentation

| Document | Purpose |
|----------|---------|
| **[CANONICAL.md](./CANONICAL.md)** | Full architecture, gap analysis, production readiness, roadmap |
| **[TODO.md](./TODO.md)** | Task tracker — completed work + future phases |
| **[R&D Roadmap](./docs/rd-roadmap.md)** | R&D opportunities from the dependency stack + opensrc source exploration |
| **[AGENTS.md](./AGENTS.md)** | Agent-specific notes (internal) |

---

## Quick Start

```bash
bun install

# All agents in parallel
bun run dev

# Or individually
bun run orchestrator # 4000
bun run oracle       # 4001
bun run librarian    # 4002
bun run explorer     # 4003
bun run designer     # 4004
bun run fixer        # 4005
bun run jarvis       # 1337
bun agents/run/scientist.ts # 4006 (no script)

# Type check
bun run typecheck

# Test
bun test

# Integration test (agents must be running)
bun run demo
```

---

## Architecture

```
agents/
├── core/              # Domain logic — zero infrastructure imports
├── ports/             # Interfaces (type-only)
├── adapters/          # Concrete implementations
├── run/               # Composition roots (wire ports → core)
└── types.ts           # A2A v1.0 types

mcp-servers/tools.ts   # MCP server (world-state, tasks, skills, memory)
```

**Rule:** `core` never imports `adapters`. `adapters` implement `ports`. `run` wires everything.

---

## Agents

| Agent | Port | Protocol | Role |
|-------|------|----------|------|
| Orchestrator | 4000 | A2A | Routes, persists memory, self-improves, consensus |
| Oracle | 4001 | A2A | Code review, simplification, architecture |
| Librarian | 4002 | A2A | Web search, docs, skill synthesis |
| Explorer | 4003 | A2A | Fast codebase recon, file search |
| Designer | 4004 | A2A | UI/UX, image generation |
| Fixer | 4005 | A2A | Bug fixes, mechanical implementation |
| Scientist | 4006 | A2A | Python data analysis via MCP tools |
| Jarvis | 1337 | A2A | Proactive codebase steward |
| ACP Bridge | stdio | ACP | IDE ↔ Orchestrator |
| MCP Tool Server | stdio | MCP | Tools + resources |

---

## Protocol Layers

- **ACP** (stdio nd-JSON) — IDE ↔ Agent bridge
- **A2A** (HTTP JSON-RPC) — Agent ↔ Agent delegation
- **MCP** (stdio) — Agent ↔ Tool integration

See [CANONICAL.md](./CANONICAL.md) for full protocol details.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NINEROUTER_URL` | `http://127.0.0.1:20128` | LLM gateway URL |
|| `NINEROUTER_KEY` | — | LLM API key |
|| `NINEROUTER_MODEL` | `openrouter/minimax/minimax-m3:free` | Default model |
|| `JABR_LLM_PROVIDER` | — | LLM provider selector: `vercel` (or set `VERCEL_AI_GATEWAY_KEY`) for Vercel AI Gateway, unset for 9Router |
|| `VERCEL_AI_GATEWAY_KEY` | — | Vercel AI Gateway API key (also `AI_GATEWAY_API_KEY`) |
|| `VERCEL_AI_GATEWAY_MODEL` | `minimax/minimax-m3` | Vercel model ID (resilient form survives Sept 6 free-period end) |
|| `VERCEL_AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v4/ai` | Vercel AI Gateway base URL (optional override) |
|| `JABR_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL (any provider exposing `/chat/completions`) |
|| `JABR_OPENAI_API_KEY` | — | OpenAI-compatible API key |
|| `JABR_OPENAI_MODEL` | `gpt-4o` | OpenAI-compatible model |
|| `JABR_URL` | `http://localhost:4000` | **Orchestrator endpoint (required)**. All agents read this. Legacy `ORCHESTRATOR_URL` still accepted. |
|| `JABR_TOKEN_CAP_<AGENT>` | `100000` | Per-agent token budget |

---

## Supported LLM Providers

The agent system is **provider-agnostic**. LLM adapters are selected through
`createLlmAdapter()` in `agents/adapters/llm/factory.ts`; the default requires
no billing. Each provider is opt-in via environment variables.

| Provider | Adapter | Select with | Default model | Notes |
|----------|---------|-------------|---------------|-------|
| **9Router (OpenRouter)** | `NineRouterLlmAdapter` | *(default — no selection needed)* | `openrouter/minimax/minimax-m3:free` | Ongoing free tier via `NINEROUTER_URL`/`NINEROUTER_KEY`/`NINEROUTER_MODEL`. |
| **OpenAI-compatible** | `OpenAiLlmAdapter` | `JABR_LLM_PROVIDER=openai` | `gpt-4o` | Generic adapter for any provider exposing `/chat/completions` (OpenAI, Together, Groq, local Ollama, etc.). Configure via `JABR_OPENAI_BASE_URL`/`JABR_OPENAI_API_KEY`/`JABR_OPENAI_MODEL`. |
| **Vercel AI Gateway** | `VercelLlmAdapter` | `JABR_LLM_PROVIDER=vercel` **or** set `VERCEL_AI_GATEWAY_KEY` | `minimax/minimax-m3` | Uses the `ai` SDK (`generateText`/`streamText` + `createGateway`). Requires a Vercel AI Gateway key (billing applies). Resilient model form (`gateway.order=['gmicloud']`) survives free-period ends. |

Selection logic (in `createLlmAdapter`):
1. If `JABR_LLM_PROVIDER=openai` → **OpenAI-compatible** (`OpenAiLlmAdapter`).
2. If `JABR_LLM_PROVIDER=vercel` **or** `VERCEL_AI_GATEWAY_KEY` (or `AI_GATEWAY_API_KEY`) is set → **Vercel AI Gateway**.
3. Otherwise → **9Router (OpenRouter)**.

To add a new provider, implement the `LlmPort` interface
(`agents/ports/llm-port.ts`) as an adapter under `agents/adapters/llm/`, then
extend the selection logic in `factory.ts`.

---

## IDE Integration (Zed)

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

---

## Scheduled Tasks

| Task | Schedule | Purpose |
|------|----------|---------|
| `kb-maintenance` | Weekly, Sundays 03:00 | Deduplicates MemPalace entries (SHA-256, oldest wins), removes stale entries >90 days, validates JSON integrity, trims SQLite memory_log with VACUUM. Logs to `memory/cron-kb-maintenance.log`. Wrapper: `scripts/cron-kb-maintenance.sh`. |

---

## Contributing

**Before contributing:**
1. Read [CANONICAL.md](./CANONICAL.md)
2. Run `bun run typecheck` — must pass
3. Run `bun test` — must pass
4. Follow conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)

---

## License

MIT — see [LICENSE](./LICENSE).
