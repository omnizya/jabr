# Jabr — Agent Context Index

Generated: 2026-09-05T23:46:32Z

This directory contains domain-split context packs for coding agents.
Load only the slice relevant to your task — don't stuff everything into context.

## Domain Packs

| Pack | Scope | Files | Size |
|------|-------|-------|------|
| `adapters.txt` | Infrastructure adapters + security | 41 | 256K |
| `composition.txt` | Composition roots + MCP server | 15 | 64K |
| `config.txt` | Config files + documentation | 21 | 1.7M |
| `core.txt` | Domain logic + ports (hexagonal core) | 42 | 196K |
| `scripts.txt` | CLI scripts + shared utils | 14 | 116K |
| `tests.txt` | Unit + e2e tests | 46 | 392K |

## How to Use

```bash
# Load a single domain into an agent:
cat docs/agent-context/core.txt

# Search across all packs:
rg 'MyPort' docs/agent-context/

# Regenerate after significant changes:
./scripts/regen-agent-context.sh
```

## opensrc Cache

Pre-fetched dependency sources (read-only, cached at `~/.opensrc/`):

```
  - hono@4.13.7  →  repos/github.com/honojs/hono/4.13.7
  - better-auth@1.7.2  →  repos/github.com/better-auth/better-auth/1.7.2/packages/better-auth
  - drizzle-orm@0.45.2  →  repos/github.com/drizzle-team/drizzle-orm/0.45.2
  - zod@4.5.4  →  repos/github.com/colinhacks/zod/4.5.4
  - @hono/zod-openapi@1.6.3  →  repos/github.com/honojs/middleware/1.6.3/packages/zod-openapi
```

## Architecture Cheat Sheet

```
agents/
├── core/          # Domain logic — ZERO infrastructure imports
├── ports/         # Interfaces (import type only)
├── adapters/      # Concrete implementations
├── types.ts       # Shared types
├── utils/         # JSON-RPC, CORS helpers
└── run/           # Composition roots (wire ports → core)
mcp-servers/       # MCP tool server (stdio)
scripts/           # CLI, build, maintenance
src/               # Shared config + constants
```
