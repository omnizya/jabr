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
- POST to `/` (root path ONLY) with JSON-RPC method `tasks/send`.
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
