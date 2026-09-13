# A2A v1 Reconciliation — Audit Log (Checkpoint Commit)

Date: 2026-09-13
Branch: `develop` (HEAD before commit: `44f614d`)
Plan: `.omo/plans/a2a-v1-reconciliation.md`
Commit type: **checkpoint** — partial wave. Items 3, 4, 7 (bridge), 9 are NOT implemented.

---

## Items 1-9 — Honest State

| # | Item | State | Evidence |
|---|------|-------|----------|
| 1 | Vendor `spec/a2a.proto` | ✅ DONE | `spec/a2a.proto` (36,185 B, vendored header) |
| 2 | v1 wire types + serializer + golden tests | ✅ DONE | `src/types/a2a-v1.ts`, `src/adapters/a2a/serialize.ts`, `src/constants/a2a-v1.ts`, `tests/adapters/a2a-serialize.test.ts` |
| 3 | Server JSON-RPC v1.0 dispatch (SendMessage/GetTask/ListTasks/CancelTask/SubscribeToTask/GetExtendedAgentCard) | ❌ NOT DONE | `src/adapters/http/a2a-server.ts` change is a **no-op rename**: legacy string literals (`tasks/send`, …) swapped for `A2A_METHODS.*` constants, and `A2A_METHODS` in `src/constants/ecosystem.ts` still holds the **legacy** values (`tasks/send`, `tasks/sendSubscribe`, `tasks/cancel`, `tasks/get`). No v1 dispatch exists. |
| 4 | HTTP+JSON REST binding + v1 SSE | ❌ NOT DONE | No REST routes, no `A2A-Version: 1.0` header, no v1 SSE. `tests/a2a-server-rest.test.ts` NOT created. |
| 5 | Agent card `supportedInterfaces: AgentInterface[]` + well-known agent.json | 🔶 PARTIAL | `src/core/verification.ts` card uses `supportedInterfaces: []`; `a2a-server.ts` accepts `/.well-known/agent.json` (serves the same card). Agent literals across the fleet not fully migrated. |
| 6 | TaskStore port list/subscribe | 🔶 PARTIAL | `src/ports/task-store.ts`, `src/adapters/sqlite-task-store.ts`, `src/adapters/task-memory.ts` modified; `tests/a2a-server-push.test.ts` present. |
| 7 | Client adapters → v1 SendMessage | 🔶 PARTIAL | `src/adapters/a2a/client.ts`, `http/a2a-client-adapter.ts`, `x402/x402-client.ts`, `http/stdio-bridge.ts`, webhooks (github/telegram/whatsapp), `core/explorer.ts` migrated. **`src/core/webhook-to-a2a-bridge.ts` NOT migrated** (0 v1 refs). `tests/adapters/a2a-client-*.test.ts`, `tests/adapters/x402.test.ts` present. |
| 8 | Standalone generic LLM agent | ✅ DONE (with known gap) | `src/core/llm-agent.ts` (no `as any` on disk), `src/runtime/agents/llm.ts`, `"llm"` script in `package.json`, `llm` port in `JABR_PORTS`. ⚠️ **KNOWN GAP: `llm` and `githubWebhook` both default to port 4007** in `src/constants/ecosystem.ts` — not fixed without user decision. |
| 9 | Docs/spec updated | ❌ NOT DONE | README/CANONICAL untouched. |

## Extra wave (committed alongside)
- Plugin system: `src/adapters/plugin-loader.ts`, `src/core/plugin-registry.ts`, `plugins/analytics-plugin/`, `plugins/notification-plugin/`, tests `plugin-loader` / `plugin-registry` / `plugin-runtime-proof`.

---

## Gates (measured on working tree before this commit)

- **Typecheck**: normalized diff vs 193-line HEAD baseline (54 unique pairs) → **0 NEW / 3 FIXED**. 5 pre-existing count increases (orchestrator.test TS2741/TS2322/TS2352, security/a2a-client-tls TS18046, tool-router.test TS18046).
- **Tests**: `bun test` full suite → **664 pass / 85 skip / 0 fail** (749 tests, 60 files, exit 0). Solo 14-file wave run → 172 pass / 0 fail / 476 expects.

## Known gaps carried forward (post-commit work)
1. Server core (items 3+4): v1 dispatch, REST binding, v1 SSE — next wave.
2. `webhook-to-a2a-bridge.ts` still legacy (item 7 remainder).
3. Port conflict: `llm` vs `githubWebhook` both default 4007.
4. `A2A_METHODS` in `ecosystem.ts` still legacy values — must be retired after all callers migrate.
5. Item 9 docs not updated.

## Excluded from this commit (drift — NOT staged)

- **Lean drift (working-tree only)**: `src/adapters/mcp/mcp-client.ts`, `tests/e2e-ipfs.test.ts`, `tests/e2e-live.test.ts`, `tests/e2e-mcp-subscription-notify.ts`, `tests/fixer-login-llm.test.ts`, `tests/orchestrator-hmac-secret.test.ts`, `tsconfig.json`, `bunfig.toml`, `.omo/plans/`, `.omo/handoff/`, `src/runtime/agents/A2A-V1-HANDOFF.md`.
- **Hard drift (never stage)**: 54 deleted files (docs/, souls/, skills/builtin/, mcp-servers/, memory/, transcripts, repomix-output.txt, opencode.json.need_fix), README.md, TODO.md, bun.lock, package-lock.json, opencode.json, `docs/FIXME.md`, `docs/JABR-GROWTH.md`, `scripts/*` (M + untracked debug), root `a2a.proto` (scratch), `labs/`, `.claude/`, `.cursor/`, `.gemini/`, `.github/`, `.graph/`, `.grok/`, `.opencode/`, `.mcp.json`, `.ignore`, `graph.html`, `docs/JABR-FRONTEND-PLAN.md`, `docs/r-and-d/`.

## Next wave
- Implement items 3-4 (server v1 dispatch + REST + SSE) in `src/adapters/http/a2a-server.ts` per plan, add `tests/a2a-server-rest.test.ts`, migrate `webhook-to-a2a-bridge.ts`, resolve port 4007 conflict, update docs (item 9).