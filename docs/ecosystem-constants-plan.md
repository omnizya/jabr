# Plan: Canonical Ecosystem Constants + Phase 1 Critical Fixes

**Date:** 2026-09-04
**Status:** Approved — ready to implement
**Scope:** Ecosystem constants file + Phase 1 critical fixes (merged effort)

---

## Background / Motivation

Repomix-based analysis surfaced 4 critical anti-patterns/DRY violations (see
_Codebase Anti-Patterns & DRY Candidates_ below). Additionally, ecosystem
parameters (ports, endpoints, defaults) are scattered across the codebase and
several occurrences are **wrong**:

| Gap | Evidence |
|-----|----------|
| `jabr-constants.ts` uses `\|` (bitwise OR) for defaults | `process.env.JARVIS_PORT \| 1337` — wrong operator; numeric-by-accident |
| Wrong default: verification | Constants say `4007`, actual agent runs on **4009** (`run/verification.ts:48`); 4007 is the GitHub webhook port |
| Broken import | `designer.ts:11` imports `JABR_WORLD_PORTS` from `@agents/constants.ts` — file does not exist (masked by the 9router parse error) |
| Key-style mismatch | `tests/adapters/a2a-client-adapter.test.ts:13` uses `JABR_WORLD_PORTS.ORCHESTRATOR_PORT` (uppercase); `designer.ts` uses `.designer` (lowercase) |
| Hardcoded ports everywhere | `run/*.ts` ports, `initLifecycle(..., 4004)`, `startBunWebSocketAdapter({port:4008})`, scripts |

---

## A. Ecosystem constants (new canonical source)

### A1. NEW `src/constants/ecosystem.ts`

Single source of truth for all ecosystem parameters.

- `portFromEnv(name, fallback): number` — private helper; guards
  `Number()` output (`isInteger && > 0`, else fallback). Replaces the broken
  `|` operator.
- `JABR_PORTS` (env-overridable, correct numeric defaults):

  | Key | Env var | Default |
  |-----|---------|---------|
  | `orchestrator` | `ORCHESTRATOR_PORT` | 4000 |
  | `oracle` | `ORACLE_PORT` | 4001 |
  | `librarian` | `LIBRARIAN_PORT` | 4002 |
  | `explorer` | `EXPLORER_PORT` | 4003 |
  | `designer` | `DESIGNER_PORT` | 4004 |
  | `fixer` | `FIXER_PORT` | 4005 |
  | `scientist` | `SCIENTIST_PORT` | 4006 |
  | `githubWebhook` | `GITHUB_WEBHOOK_PORT` | 4007 |
  | `realtime` | `JABR_REALTIME_PORT` | 4008 |
  | `verification` | `VERIFICATION_PORT` | 4009 |
  | `jarvis` | `JARVIS_PORT` | 1337 |

- `JABR_ENDPOINTS` — `agentCard: "/.well-known/agent-card.json"`,
  `worldState: "/.well-known/world-state"`, `health: "/health"`,
  `ready: "/ready"`, `emit: "/emit"`, `webhook: "/webhook"`, `root: "/"`.
- `A2A_METHODS` — `tasksSend`, `tasksSendSubscribe`, `tasksCancel`,
  `tasksGet`.
- URL defaults — `NINEROUTER_URL_DEFAULT = "http://127.0.0.1:20128"`,
  `NINEROUTER_MODEL_DEFAULT = "openrouter/minimax/minimax-m3:free"`,
  `JABR_URL_DEFAULT = "http://localhost:4000"`.
- `DEV_ALLOWED_ORIGINS` — consolidated from `agents/utils/rpc.ts`
  `DEFAULT_ALLOWED_ORIGINS` (localhost 5173/8080/4000–4006/1337).

### A2. REWRITE `src/constants/jabr-constants.ts`

Re-export `JABR_PORTS`; keep `export const JABR_WORLD_PORTS = JABR_PORTS`
marked `@deprecated` for backward compat.

### A3. EDIT `src/constants/app.ts`

Re-export `JABR_PORTS`, `JABR_ENDPOINTS`, `A2A_METHODS`, URL defaults, and
`DEV_ALLOWED_ORIGINS` alongside existing app constants.

---

## B. Phase 1 critical fixes (merged)

### C1 — Remove hardcoded API key secrets

| File | Change |
|------|--------|
| `agents/adapters/search-9router.ts` | baseUrl → `NINEROUTER_URL_DEFAULT`; **remove** `"sk-ac4453…"` key fallback → `?? ""`. Existing missing-key guard (returns `[]`) now fires |
| `agents/adapters/image-gen-9router.ts` | baseUrl → `NINEROUTER_URL_DEFAULT`; **remove** hardcoded key → `?? ""`; **add** missing-key guard in `generate()` that throws |
| `agents/adapters/llm/9router.ts` | **Fix pre-existing syntax error** `(process.env.NINEROUTER_URL ??)` → `(process.env.NINEROUTER_URL ?? NINEROUTER_URL_DEFAULT)`; `apiKey` → `?? ""`; `model` → `?? NINEROUTER_MODEL_DEFAULT` |

### C2 — Extract duplicated realtime-emit block

- NEW `agents/run/realtime.ts` (sibling of `lifecycle.ts`/`serve.ts`):
  `createRealtimePort(name, fallbackPort = JABR_PORTS.realtime): RealtimePort`
  — consolidates the identical `JABR_REALTIME_PORT` if/else + fetch-emit +
  `startBunWebSocketAdapter` block duplicated in 8 run files.
- Update `agents/run/{designer,scientist,librarian,explorer,fixer,oracle,verification,jarvis}.ts`:
  replace ~16-line block with `const realtime = createRealtimePort("<Agent>")`.
  Remove now-unused `jabrUrlForPort` / `startBunWebSocketAdapter` /
  `RealtimePort` imports where applicable.

### C3 — Remove module-scope logs from port files

Delete `console.log("[X] port interface loaded")` from 17 port files:
`a2a-client-port`, `telegram-bot-port`, `task-store`, `skill-store`,
`search-port`, `resource-port`, `realtime-port`, `memory-store`,
`mcp-tool-port`, `llm-port`, `knowledge-port`, `kanban-port`,
`image-gen-port`, `graph-memory-port`, `agent-registry`, `discovery-port`,
`artifact-port`. (No tests assert on these logs — verified.)

### C4 — Fix env typo + seed via constants

- `agents/run/orchestrator.ts` seedUrls → `jabrUrlForPort(JABR_PORTS.x)`,
  which also fixes `process.env.scientistPORT` → `JABR_PORTS.scientist`.

---

## C. Run-file migration to constants

- `agents/run/{oracle,librarian,explorer,fixer,verification}.ts`:
  `runAgent({ port: JABR_PORTS.<name>, ... })` +
  `initLifecycle(realtime, "<name>", JABR_PORTS.<name>)`.
- `agents/run/designer.ts`: fix broken import
  `@agents/constants.ts` → `@constants/app`; use `JABR_PORTS.designer`.
- `agents/run/scientist.ts`: `const port = JABR_PORTS.scientist` (number) →
  A2AServer.
- `agents/run/jarvis.ts`: `const port = JABR_PORTS.jarvis` (1337).
- `agents/run/orchestrator.ts`: `PORT = JABR_PORTS.orchestrator`, realtime
  `JABR_PORTS.realtime`, GitHub webhook `JABR_PORTS.githubWebhook`.
- `tests/adapters/a2a-client-adapter.test.ts:10,13`:
  `JABR_WORLD_PORTS.ORCHESTRATOR_PORT` (undefined key) →
  `JABR_PORTS.orchestrator`.

---

## Verification

Status: done. All items in A, B (C1-C4), and C are implemented and verified:

1. `bun run typecheck` — 9router parse error gone; remaining errors are all
   pre-existing in `tests/*`, `agents/adapters/llm/vercel.ts`, and
   `agents/adapters/http/webhook-server.ts`. Zero errors in migrated files.
2. `bun run lint` — biome clean (166 files, 0 warnings).
3. `bun test` (script `bun test --path-ignore-patterns="tests/e2e-live.test.ts"`) —
   only failures are the 9 pre-existing IPFS E2E tests (needs a running IPFS
   daemon). `tests/fixer-login-llm.test.ts` now SKIPs when `NINEROUTER_KEY` lacks
   an `sk-` prefix (C1 removed the hardcoded key; `bun` may load a non-key
   placeholder from `.env`).

## Later migrations (was "Out of scope", now done)

- `scripts/jabr-cli.ts` — ports → `JABR_PORTS.*`, env defaults →
  `JABR_URL_DEFAULT` / `NINEROUTER_URL_DEFAULT` / template-literal realtime port,
  memory dir → `join(ROOT, "memory")`.
- `scripts/demo.ts`, `route-test.ts`, `consensus-verify.ts` — seed URLs →
  `jabrUrlForPort(JABR_PORTS.*)`.
- `scripts/dev.sh`, `scripts/run-agents-tmux.sh` — ports bridged from
  `src/constants/ecosystem.ts` via a `bun -e` loader (honors env overrides).
- `agents/utils/rpc.ts` + `agents/adapters/bun-websocket-adapter.ts` —
  `DEFAULT_ALLOWED_ORIGINS` now aliases `DEV_ALLOWED_ORIGINS` (single source).
- `agents/adapters/http/{github-webhook,telegram-webhook,whatsapp-webhook}.ts` —
  default ports → `JABR_PORTS.githubWebhook` / `JABR_PORTS.realtime` /
  `JABR_PORTS.verification`.
- `agents/core/scientist.ts` — `jabrUrlForPort(JABR_PORTS.scientist)`.
- `src/config/jabr-config.ts` — error messages interpolate `JABR_URL_DEFAULT`.
- `.env.example` — empty `NINEROUTER_KEY`.

Still deferred: `scripts/create-triage.ts` (historical issue text), `opencode.json`
(local provider `apiKey`, same leaked key — rotate it), test-local port fixtures
(`tests/*` mock topologies), and doc comments that name a port number.

---

## Appendix: Codebase Anti-Patterns & DRY Candidates (Repomix analysis)

### Critical
| # | Finding | Files |
|---|---------|-------|
| C1 | Hardcoded API key secret duplicated | `search-9router.ts:45`, `image-gen-9router.ts:26` |
| C2 | Realtime adapter fallback duplicated 8× | `run/{scientist,explorer,fixer,designer,librarian,oracle,verification,jarvis}.ts` |
| C3 | Impure port files (`console.log` at module scope) | 17 `ports/*.ts` files |
| C4 | Env var typo `scientistPORT` | `run/orchestrator.ts:106` |

### Important (not in this plan — follow-up)
| # | Finding | Files |
|---|---------|-------|
| I1 | `A2AClient` defined twice | `adapters/a2a-client.ts`, `adapters/http/a2a-client-adapter.ts` |
| I2 | `extractJson`/keyword helpers duplicated 4× | `core/oracle.ts`, `core/jarvis.ts`, `core/tool-router.ts`, `adapters/dynamic-registry.ts` |
| I3 | `STOP_WORDS` duplicated | `core/cognitive-loop.ts:32`, `data/stopwords.ts:1` |
| I4 | Webhook servers share duplicated patterns | `github-webhook.ts`, `telegram-webhook.ts`, `whatsapp-webhook.ts`, `webhook-server.ts` |
| I5 | `delegateToAgent` duplicated 3× | `github-webhook.ts:286`, `telegram-webhook.ts:439`, `whatsapp-webhook.ts:490` |
| I6 | MCP tool contract not single source of truth | `mcp-servers/tools.ts`, `core/tool-router.ts`, `core/scientist.ts` |
| I7 | Hardcoded fallback `"change-me"` webhook secret | `run/orchestrator.ts:203` |

### Architecture gaps (follow-up)
| # | Finding |
|---|---------|
| G1 | Scientist bypasses `runAgent()`; `core/scientist.ts` imports `@config/` |
| G2 | Competing discovery mechanisms (DynamicRegistry vs static seedUrls) |
| G3 | Inconsistent formatting (some run files 4-space vs tabs) |