# Jabr — Agent Context Index

Generated: 2026-09-09T23:01:19Z

This directory contains domain-split context packs for coding agents.
Load only the slice relevant to your task — don't stuff everything into context.

## Domain Packs

| Pack | Scope | Files | Size |
|------|-------|-------|------|
| `adapters.txt` | Infrastructure adapters + security | 46 | 56K |
| `composition.txt` | Composition roots + MCP server | 17 | 16K |
| `config.txt` | Config files + documentation | 18 | 172K |
| `core.txt` | Domain logic + ports (hexagonal core) | 42 | 68K |
| `scripts.txt` | CLI scripts + shared utils | 143 | 148K |
| `tests.txt` | Unit + e2e tests | 56 | 40K |

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
  - hono@4.13.5  →  repos/github.com/honojs/hono/4.13.5
  - better-auth@1.7.3  →  repos/github.com/better-auth/better-auth/1.7.3/packages/better-auth
  - drizzle-orm@0.45.2  →  repos/github.com/drizzle-team/drizzle-orm/0.45.2
  - zod@4.6.0  →  repos/github.com/colinhacks/zod/4.6.0
  - @hono/zod-openapi@1.6.3  →  repos/github.com/honojs/middleware/1.6.3/packages/zod-openapi
  - @a2a-js/sdk@1.1.0  →  repos/github.com/a2aproject/a2a-js/1.1.0
  - @modelcontextprotocol/sdk@1.30.0  →  repos/github.com/modelcontextprotocol/typescript-sdk/1.30.0
  - express@5.2.1  →  repos/github.com/expressjs/express/5.2.1
  - jose@6.2.10  →  repos/github.com/panva/jose/6.2.10
  - bcryptjs@3.0.3  →  repos/github.com/dcodeIO/bcrypt.js/3.0.3
  - http-proxy-middleware@3.0.7  →  repos/github.com/chimurai/http-proxy-middleware/3.0.7
  - marked@18.0.11  →  repos/github.com/markedjs/marked/18.0.11
  - @node-saml/node-saml@5.1.0  →  repos/github.com/node-saml/node-saml/5.1.0
  - brain.js@2.0.0-beta.24  →  repos/github.com/brainjs/brain.js/2.0.0-beta.24
  - @huggingface/transformers@4.2.0  →  repos/github.com/huggingface/transformers.js/4.2.0
  - ai@7.0.85  →  repos/github.com/vercel/ai/7.0.85/packages/ai
  - next@16.3.4  →  repos/github.com/vercel/next.js/16.3.4
  - vitest@5.0.0  →  repos/github.com/vitest-dev/vitest/5.0.0/packages/vitest
  - Pillow@12.3.0  →  repos/github.com/python-pillow/Pillow/12.3.0
  - matplotlib@3.11.1  →  repos/github.com/matplotlib/matplotlib/3.11.1
  - numpy@2.5.3  →  repos/github.com/numpy/numpy/2.5.3
  - graphviz@0.21  →  repos/github.com/xflr6/graphviz/0.21
  - drawsvg@2.4.2  →  repos/github.com/cduck/drawsvg/2.4.2
  - leaflet@1.9.4  →  repos/github.com/Leaflet/Leaflet/1.9.4
  - pannellum@2.5.7  →  repos/github.com/mpetroff/pannellum/2.5.7
  - tar@7.5.22  →  repos/github.com/isaacs/node-tar/7.5.22
  - @faker-js/faker@10.6.0  →  repos/github.com/faker-js/faker/10.6.0
  - @biomejs/biome@2.5.12  →  repos/github.com/biomejs/biome/2.5.12/packages/@biomejs/biome
  - @tensorflow/tfjs-node@4.22.0  →  repos/github.com/tensorflow/tfjs/4.22.0/tfjs-node
  - @types/bun@1.4.2  →  repos/github.com/DefinitelyTyped/DefinitelyTyped/1.4.2/types/bun
  - gun@0.2020.1241  →  repos/github.com/amark/gun/0.2020.1241
  - husky@9.1.7  →  repos/github.com/typicode/husky/9.1.7
  - lint-staged@17.5.0  →  repos/github.com/lint-staged/lint-staged/17.5.0
  - repomix@1.18.0  →  repos/github.com/yamadashy/repomix/1.18.0
  - typescript@7.0.2  →  repos/github.com/microsoft/TypeScript/7.0.2
```

## Architecture Cheat Sheet

```
src/
├── core/          # Domain logic — ZERO infrastructure imports
├── ports/         # Interfaces (import type only)
├── adapters/      # Concrete implementations
├── types/         # Shared types
├── utils/         # JSON-RPC, CORS helpers
├── constants/     # Canonical ports and paths
├── config/        # Env manager
├── security/      # x402, JWT, auth
├── protocols/     # A2A + MCP servers
└── runtime/       # Composition roots (wire ports → core)
scripts/           # CLI, build, maintenance
```
