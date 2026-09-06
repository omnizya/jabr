# Jabr — Agent Notes (Internal)

**Superseded by:** [CANONICAL.md](./CANONICAL.md) for architecture, gaps, roadmap.
This file is for agent-specific notes only — see CANONICAL.md for everything else.

---

## Protocol Quick Reference

### A2A Server (a2a-server.ts)
- POST to `/` (root path ONLY) with JSON-RPC method `tasks/send`
- Any other method → `-32601 Method not found`; any other path → 404
- Synchronous: server awaits handler and returns result in response — no polling
- `scripts/demo.ts` matches this contract (root `/`, `tasks/send`, sync)

### Agent Cards
- Served at `/.well-known/agent-card.json`
- `supportedInterfaces`: streaming, pushNotifications, stateTransitionHistory (all false — not yet implemented)
- `securityRequirements`: empty array (not yet implemented)

### Task Lifecycle (8 states — `agents/types.ts`)
```
SUBMITTED → WORKING → INPUT-REQUIRED → COMPLETED
                ↘ FAILED / CANCELED / REJECTED / AUTH-REQUIRED
```

**Missing:** only `UNKNOWN` (9th A2A v1.0 state) is not yet in the `TaskState` union.
State transition history is recorded per `updateState()` call.

---

## Agent Behavior Notes

### Orchestrator
- Uses `DynamicRegistry.matchAgent(text)` for routing (tag-scored)
- `executeConsensus` queries ALL agents by default — can filter with `agentNames?`
- `%%HANDOVER%%` from oracle honored via `forcedAgentName` (bypasses registry)
- `MAX_HANDOVER_DEPTH = 3`
- Memory: `SqliteMemoryStore` over `memory/jabr.db` (WAL), no `.md` mirror

### Oracle (JABIR)
- LLM-driven — `ROUTING_SYSTEM_PROMPT`, `VALID_TRANSFER_TARGETS`
- Emits `%%HANDOVER%%` when it judges a task mis-routed
- Uses `LlmPort` for routing judge

### Librarian (RUSHD)
- Writes `skills/<slug>.json` after novel tasks
- Skills are idempotent — same slug = skip
- `successRate` tracked per skill

### Scientist (FIRNAS)
- Not in `bun run dev` — start with `bun agents/run/scientist.ts`
- MCP client speaks raw JSON-RPC over stdio with single-response listener
- Persistent `.python_env/` (auto-created via `uv init --lib`)

### Jarvis (WAZIR)
- Port 1337, proactive codebase steward
- `execute()` writes to `TaskStorePort` (updateState + appendMessage)
- Scan capabilities: codebase, dependency watch, test gap, doc sync, AI enhancement

### ACP Bridge
- Reads `ORCHESTRATOR_URL` env (default `http://localhost:4000`)
- Uses separate `memory/jabr-bridge.db` with `mirrorFile: null`

### MCP Tool Server
- Tools: `read_file`, `write_file`, `run_python`, `calculate`, `save_skill`, `list_skills`, `install_python_dependency`
- `calculate` uses tokenizer + recursive-descent parser (no `eval`)
- `run_python`: writes `.python_env/main.py`, `uv run --project .python_env python main.py`, 10s timeout
- All paths relative to `process.cwd()`

---

## Environment Variables

| Variable | Default | Used By |
|----------|---------|---------|
| `NINEROUTER_URL` | `http://localhost:20127` | LLM gateway |
| `NINEROUTER_KEY` | — | LLM API key |
| `NINEROUTER_MODEL` | `openrouter/minimax/minimax-m3:free` | Default model |
| `JABR_LLM_PROVIDER` | — | LLM provider selector: `vercel` (or set `VERCEL_AI_GATEWAY_KEY`) for Vercel AI Gateway, unset for 9Router |
| `VERCEL_AI_GATEWAY_KEY` | — | Vercel AI Gateway API key (also `AI_GATEWAY_API_KEY`) |
| `VERCEL_AI_GATEWAY_MODEL` | `minimax/minimax-m3` | Vercel model ID (resilient form survives Sept 6 free-period end) |
| `VERCEL_AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v4/ai` | Vercel AI Gateway base URL (optional override) |
| `ORCHESTRATOR_URL` | `http://localhost:4000` | ACP bridge |
| `JABR_TOKEN_CAP_<AGENT>` | `100000` | Per-agent token budget |
| `JABR_X402_HMAC_SECRET` | **required** (no default) | x402 payment signing — generate with `openssl rand -hex 32`; orchestrator refuses to start without it |

---

## TypeScript Conventions

- `verbatimModuleSyntax` — use `import type { ... }` for type-only imports
- `allowImportingTsExtensions` — relative imports use explicit `.ts` extension
- `noUncheckedIndexedAccess` — array/object index access returns `T | undefined`
- `noImplicitOverride` — override methods need `override` keyword

---

## Architecture Invariants

1. **Core never imports adapters** — only ports/types
2. **Adapters implement ports** — never import core
3. **Run modules wire everything** — composition roots only
4. **Agent cards are served at root** — `/.well-known/agent-card.json`
5. **Tasks are stateful** — progress through lifecycle states
6. **Memory is sqlite-backed** — WAL mode, `.md` mirror deprecated

---

## Codebase Intelligence

Jabr ships three tools that give coding agents deep context without bloating their window:

### Repomix Pack

A compressed repo pack generated via `repomix` (config: `repomix.config.json`, output: `agent-lab.context.xml`).

```bash
# Generate pack (after significant changes)
repomix

# Check token count per file
repomix --token-count-tree 50
```

### OpenSrc — Dependency Source

Read dependency implementations, not just types. Cache lives at `~/.opensrc/`.

```bash
# Get source path (auto-fetches on cache miss)
cat $(opensrc path zod)/src/types.ts

# Pre-fetch multiple deps
opensrc fetch zod ai brain.js @huggingface/transformers

# Search inside cached source
rg "parse" $(opensrc path zod)
```

**Currently cached for this project:** zod, ai, brain.js, @huggingface/transformers.

See `opensrc list` for full cache status.

### Post-Commit Hook

The repomix pack regenerates automatically on every successful commit. To wire it up:

```bash
# One-time setup
cat > .git/hooks/post-commit << 'HOOK'
#!/bin/bash
# Regenerate repomix pack on commit
repomix --quiet 2>/dev/null && echo "✅ agent-lab.context.xml regenerated"
HOOK
chmod +x .git/hooks/post-commit
```

### Domain Context Packs (`docs/agent-context/`)

The full repo is ~1.87M tokens — too big for any single context window. We split it by domain so agents load only the slice they need:

| Pack | Scope |
|------|-------|
| `core.txt` | Domain logic + ports (hexagonal core) |
| `adapters.txt` | Infrastructure adapters + security |
| `composition.txt` | Composition roots + MCP server |
| `scripts.txt` | CLI scripts + shared utils |
| `tests.txt` | Unit + e2e tests |
| `config.txt` | Config files + documentation |

```bash
# Load one slice
cat docs/agent-context/core.txt

# Search across all packs
rg 'TaskStorePort' docs/agent-context/

# Rebuild after significant changes
./scripts/regen-agent-context.sh
```

See `docs/agent-context/INDEX.md` for the full manifest and opensrc cache status.

### opensrc — Dependency Source

`opensrc` fetches and caches package source code so agents can read implementations, not just types. Cache lives at `~/.opensrc/`.

```bash
# Get source path (auto-fetches on cache miss)
cat $(opensrc path zod)/src/types.ts

# Pre-fetch multiple packages
opensrc fetch zod hono @hono/zod-openapi

# Search inside cached source
rg "parse" $(opensrc path zod)
```

**Currently cached:** `hono`, `better-auth`, `drizzle-orm`, `zod`, `@hono/zod-openapi`.

**Pending (slow connection):** `@a2a-js/sdk`, `@modelcontextprotocol/sdk`.

Run `opensrc fetch @a2a-js/sdk @modelcontextprotocol/sdk` when bandwidth allows.

### When to Use

| Situation | Tool |
|-----------|------|
| Need full repo context but context window is tight | Domain packs — load only relevant slice |
| Agent asks "how does X library work internally?" | `opensrc path <pkg>` — read the actual implementation |
| Debugging unexpected dependency behavior | `opensrc` — verify edge cases in source |
| After adding/removing/renaming files | `./scripts/regen-agent-context.sh` |

---

## Git Conventions

- Stage and commit by topic/domain — one commit per concern
- Conventional commits: `feat`, `fix`, `test`, `docs`, `tooling`, `refactor`, `chore`
- Runtime artifacts (`memory/orchestrator.md`, `repomix-output.xml`) not committed
- **Keep `TODO.md` current.** When a new TODO/issue/decision arises, record it in `TODO.md` (consume it into the session and track it). When work completes, mark the item `[x]` with its commit ref. Commit TODO.md updates by topic/domain as a `docs:` commit.

---

## Known Issues (from v0.4.0 audit)

- [ ] Routing tie-break: tag tie → first in iteration order wins (design decision needed)
- [ ] Handover path not exercised: oracle `%%HANDOVER%%` chain never triggers through current routing
- [ ] Specialists are deterministic keyword matchers — cannot implement new MCP tools end-to-end
- [ ] No `.env` file (only `.env.example`). `NINEROUTER_URL` has a code default
  (`http://localhost:20127`), but `NINEROUTER_KEY` has none — `search-9router.ts:39-41`
  throws if it's missing, so search/image-gen fail without it.
