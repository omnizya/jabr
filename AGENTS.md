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
| `NINEROUTER_URL` | `http://127.0.0.1:20128` | LLM gateway |
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
  (`http://127.0.0.1:20128`), but `NINEROUTER_KEY` has none — `search-9router.ts:39-41`
  throws if it's missing, so search/image-gen fail without it.
