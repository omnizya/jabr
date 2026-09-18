# Jabr — Agent Notes (Internal & Architecture Reference)

**Superseded by:** [CANONICAL.md](./docs/CANONICAL.md) for architecture, gaps, roadmap.
This file contains updated agent notes, command references, patterns, conventions, and operational gotchas.

---

## Essential Commands

| Command | Action |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Start all agents and servers concurrently |
| `bun run orchestrator` | Run Orchestrator agent standalone (port 4000) |
| `bun run oracle` | Run Oracle agent standalone (port 4001) |
| `bun run librarian` | Run Librarian agent standalone (port 4002) |
| `bun run explorer` | Run Explorer agent standalone (port 4003) |
| `bun run designer` | Run Designer agent standalone (port 4004) |
| `bun run fixer` | Run Fixer agent standalone (port 4005) |
| `bun run jarvis` | Run Jarvis agent standalone (port 1337) |
| `bun run scientist` | Run Scientist agent standalone (port 4006) |
| `bun run mcp` | Run MCP tools server over stdio |
| `bun run demo` | Run full E2E validation script (requires running services) |
| `bun run build` | Compile standalone bytecode binaries into `dist/bin/` |
| `bun test` | Run test suite via Bun test runner |
| `bun run typecheck` | Run TypeScript type checking (`tsc --noEmit`) |
| `bun run lint` | Run Biome linter |
| `bun run format` | Format codebase via Biome |

---

## Architecture & Code Organization

Jabr uses a strict **Hexagonal Architecture (Ports & Adapters)**:
- **`src/core/`**: Domain logic with **zero** infrastructure dependencies.
- **`src/ports/`**: TypeScript interfaces (type-only imports).
- **`src/adapters/`**: Concrete implementations (HTTP, SQLite, MCP, LLM providers).
- **`src/runtime/`**: Composition roots wiring ports to core.
- **`src/constants/ecosystem.ts`**: Single source of truth for ports and well-known paths.

### Invariants
1. **Core never imports adapters** — only ports/types.
2. **Adapters implement ports** — never import core.
3. **Run modules** act strictly as composition roots.
4. **Memory is SQLite-backed** (`memory/jabr.db` in WAL mode).

---

## Protocol Quick Reference

### A2A Server (`src/adapters/http/a2a-server.ts`)
- POST to `/` (root path ONLY) with JSON-RPC method `SendMessage`.
- Synchronous design: server awaits handlers and returns results inline.
- Authentication supported via `X-API-Key` headers (via `ApiKeyRegistry`) and OAuth 2.1 JWT Bearer tokens.

### Task Lifecycle
```
SUBMITTED → WORKING → INPUT-REQUIRED → COMPLETED
                ↘ FAILED / CANCELED / REJECTED / AUTH-REQUIRED / UNKNOWN
```

---

## Environment & Server Options

- **Verbose Logs**: Set log levels or inspect internal states via SQLite DB/logs; scripts such as `kb-maintenance.ts` support `--verbose`.
- **Environment Management**: Typed accessors via `src/config/env-manager.ts` validate and coerce env configurations at startup.
- **LLM Backends**: Supports 9Router (default openrouter free tier), Vercel AI Gateway (`JABR_LLM_PROVIDER=vercel`), and OpenAI-compatible endpoints (`JABR_LLM_PROVIDER=openai`).

---

## Non-Obvious Gotchas & Conventions
- **Explicit Extensions**: TypeScript configurations use `allowImportingTsExtensions` and `verbatimModuleSyntax`. Relative imports require explicit `.ts` extensions.
- **x402 HMAC Secret**: The orchestrator will refuse to start without `JABR_X402_HMAC_SECRET` configured (generate via `openssl rand -hex 32`).
- **Demo verification**: Run `bun run demo` only after `bun run dev` has booted all agents.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
