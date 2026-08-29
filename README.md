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
| `NINEROUTER_KEY` | — | LLM API key |
| `NINEROUTER_MODEL` | `openrouter/minimax/minimax-m3:free` | Default model |
| `ORCHESTRATOR_URL` | `http://localhost:4000` | ACP bridge target |
| `JABR_TOKEN_CAP_<AGENT>` | `100000` | Per-agent token budget |

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

## Contributing

This is an experimental research project. Contributions welcome but expect rapid iteration.

**Before contributing:**
1. Read [CANONICAL.md](./CANONICAL.md)
2. Run `bun run typecheck` — must pass
3. Run `bun test` — must pass
4. Follow conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)

---

## License

MIT — see [LICENSE](./LICENSE).
