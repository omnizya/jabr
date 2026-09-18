# Jabr — Persistent Roadmap (canonical plan of record)

> **Status**: LIVE. Supersedes the earlier stale readiness report and the stale
> "Production Readiness Assessment" table in `docs/CANONICAL.md:393-429` (both
> predate the fixes listed below). Execution state is tracked in SQLite:
> `bun run planner status` (DB at `memory/planner.db`, override with
> `JABR_PLANNER_DB`). This file is the durable, committed copy of the plan.

---

## 1. Verified current state (2026-09-18, branch `feature/bereal`)

Gates — re-measure with these exact commands, never trust stale numbers:

| Gate | Command | Current result |
|---|---|---|
| Typecheck | `bun run typecheck` | **0 errors in `src/` + `scripts/`**. 178 errors remain, ALL in `tests/` (pre-existing debt: `tests/` has no tsconfig isolation yet) |
| Lint | `bunx biome check <changed files>` | 9 changed files clean ("No fixes applied"). Repo baseline 550 errors / 200 warnings / 5 infos across 543 files (pre-existing) |
| Tests | `bun test` | New suites green: `tests/a2a-server-push-retry.test.ts`, `tests/preflight.test.ts`, `tests/config/env-manager.test.ts` |

Recent commits (all pushed to `origin/feature/bereal`):

- `04ea266` feat(a2a): push callback retry with exponential backoff + DLQ
- `0455ce4` feat(delegate): preflight health checks + delegation options
- `11fab8b` feat(config): EnvManager.warnIfUnset for optional vars
- `f4cdf4d` refactor(orchestrator): EnvManager-validated startup with defaults
- `03a7ffe` docs: graft context in AGENTS.md + copilot instructions, move GEMINI.md to root

## 2. Corrections to the stale report

What the old report claimed missing vs. what is verified present:

| Stale claim | Verified reality | Evidence |
|---|---|---|
| A2A push notifications ❌ Missing | Push callback with retry/backoff + DLQ | `04ea266`, `src/adapters/http/a2a-server.ts` (`_postCallback`), `src/constants/app-constants.ts` |
| Dead letter queue ❌ Missing | DLQ implemented (same commit) | `04ea266`, `tests/a2a-server-push-retry.test.ts` |
| CORS wildcard ❌ | Origin-restricted via config | `a2a-server.ts` CORS handling (fixed before this wave) |
| Delegation runtime hardcoded ❌ | Preflight health checks + delegation options | `0455ce4`, `src/core/tool-router.ts`, `tests/preflight.test.ts` |
| Optional env vars noisy ❌ | `EnvManager.warnIfUnset` for optional vars | `11fab8b`, `src/config/env-manager.ts` |
| Orchestrator startup unvalidated ❌ | EnvManager-validated startup with defaults | `f4cdf4d`, `src/runtime/orchestrator.ts` |
| Memory compression ❌ Missing | Still genuinely open — see Phase 2 T-M5 below | gap |

## 3. Roadmap (aligned to `REBUILD_HANDOFF.md` phases)

Execution contract: each item lands as its own conventional commit with
scoped gate green (`bun run typecheck` with 0 `src/`+`scripts/` errors, biome
clean on changed files). Track status via the planner CLI; link tasks by ID
(`bun run planner task set <id> in_progress|done|blocked`).

### Phase 1 — Delete & delegate (shrink hand-rolled surface) — NEXT

| ID | Action | Acceptance | Verify |
|---|---|---|---|
| T-1 | Remove `src/adapters/http/a2a-server.ts` in favor of `@a2a-js/sdk` | No hand-rolled A2A server; SDK-backed only | `graft ask "a2a server implementation" --source` |
| T-2 | Remove `src/security/oauth-server.ts` in favor of managed OIDC | OAuth delegation via provider SDK | typecheck + lint clean |
| T-3 | Typecheck debt: clear 178 test-only errors | `bun run typecheck` fully green | `bun run typecheck` |

### Phase 2 — Rebuild core (lean kernel, keep verified adapters)

| ID | Action | Acceptance | Verify |
|---|---|---|---|
| T-4 | Split differential: `graft callers` on removal candidates before deleting | No caller left behind | `graft callers <symbol> --depth all` |
| T-5 | Memory compression / compaction strategy (real gap) | Defines memory budget; documented | design note in `docs/plans/` |

### Phase 3 — Verification backlog (folded from earlier sessions)

| ID | Action | Acceptance |
|---|---|---|
| T-6 | DLQ runtime wiring e2e check | `bun run demo` exercises retry → DLQ path |
| T-7 | Observability attach points audited | Log lines trace task lifecycle on failure |

## 4. Exit criteria (re-measured, per REBUILD_HANDOFF.md)

Re-measure with commands — do NOT trust hardcoded numbers:

- Protocol reimplementations < 30 files → `graft grep "a2a|oauth|acp" --in src/`
- Typecheck fully green → `bun run typecheck`
- Lint delta on changed files = zero → `bunx biome check $(git diff --name-only ...)`
- `bun run dev` boots all agents → manual smoke

## 5. Conventions (hard rules)

- **No hardcoded values** (user rule): paths/ports/URLs come from
  `src/constants/ecosystem.ts` + env (see `.env.example`, `JABR_` prefix).
- **Plan state in files + SQLite**, not memory: `docs/plans/ROADMAP.md`
  (committed) + `memory/planner.db` (execution state, gitignored).
- Commit per item; push as you go (`git push -u origin feature/bereal`).
- Bun ecosystem for TS tooling; `uv` over pip for Python.
- When unsure whether a change is in scope: consult `AGENTS.md` graft graph
  (`.graph/` context) before editing.