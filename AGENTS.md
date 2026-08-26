# agent-lab — Project Memory

## What this is

Experimental multi-agent system testing ACP + A2A + MCP together.
Runtime: **Bun 1.4** (TypeScript) + **uv** (Python tools). No build step — run `.ts` files directly.

## Architecture — Hexagonal (Ports & Adapters)

```
agents/
├── core/              # Domain logic — ZERO infrastructure imports
│   ├── orchestrator.ts   # Keyword routing, delegation
│   ├── coder.ts          # Code generation, review, patterns
│   └── researcher.ts     # Research, skill persistence
├── ports/             # Interfaces (import type only)
│   ├── agent-registry.ts
│   ├── task-store.ts
│   ├── memory-store.ts
│   └── skill-store.ts
├── adapters/          # Concrete implementations
│   ├── http/
│   │   ├── a2a-server.ts   # Bun.serve A2A HTTP server
│   │   └── stdio-bridge.ts # ACP stdio → A2A HTTP proxy
│   ├── a2a-client.ts       # HTTP client implementing AgentRegistryPort
│   ├── memory-fs.ts        # Filesystem MemoryStorePort
│   ├── skill-fs.ts         # Filesystem SkillStorePort
│   └── task-memory.ts      # In-memory TaskStorePort
├── types.ts           # Shared TypeScript types
└── run/               # Composition roots (wire ports → core)
    ├── orchestrator.ts     # Port 4000
    ├── coder.ts            # Port 4001
    ├── researcher.ts       # Port 4002
    └── acp-bridge.ts       # stdio, reads ORCHESTRATOR_URL env
```

**Rule:** Core modules never import adapters. Adapters implement port interfaces. Run modules do all wiring.

## Agents

| Agent            | Port  | Protocol   | Role                                         |
| ---------------- | ----- | ---------- | -------------------------------------------- |
| Orchestrator     | 4000  | A2A server | Routes tasks, persists memory, self-improves |
| Coder Agent      | 4001  | A2A server | Code generation, review, Python execution    |
| Researcher Agent | 4002  | A2A server | Research, summarization, skill creation      |
| ACP Bridge       | stdio | ACP server | IDE bridge → Orchestrator                    |
| MCP Tool Server  | stdio | MCP server | fs, uv-python, calculate, skill store        |

## Protocol layers

- **ACP** (stdio nd-JSON) — IDE ↔ ACP bridge — JSON-RPC 2.0, one JSON object per line
- **A2A** (HTTP JSON-RPC) — Orchestrator ↔ Specialists — Agent Cards at `/.well-known/agent-card.json`
- **MCP** (stdio) — Agents ↔ Tools — `bun mcp-servers/tools.ts`

## Self-improvement loop

After each novel task, Researcher Agent writes `skills/<slug>.json`.
These are Hermes-style skill documents with steps + success tracking.
Skills are idempotent: same task type → slug match → skipped if file exists.

## Key files

- `agents/core/` — Domain logic (orchestrator, coder, researcher)
- `agents/ports/` — Port interfaces (agent-registry, task-store, memory-store, skill-store)
- `agents/adapters/` — HTTP servers, A2A client, filesystem stores
- `agents/run/` — Composition roots that wire everything together
- `agents/types.ts` — Shared TypeScript types (A2A, ACP, Skill, MCP, AgentCard)
- `mcp-servers/tools.ts` — MCP tool server (Bun, uses McpServer from SDK)
- `scripts/demo.ts` — End-to-end integration test (requires all agents running)
- `skills/` — Auto-generated skill documents (JSON)
- `memory/orchestrator.md` — Session memory (append-only markdown)

## Quick start

```bash
bun install

# Start all agents in parallel (dev mode)
bun run dev

# Or individually:
bun run coder        # port 4001
bun run researcher   # port 4002
bun run orchestrator # port 4000

# Run integration test (agents must be running first)
bun run demo
```

## IDE integration (ACP)

**Zed** `~/.config/zed/settings.json` or project `settings.json`:

```json
{
  "agent_servers": {
    "agent-lab": {
      "type": "custom",
      "command": "bun",
      "args": ["agents/run/acp-bridge.ts"],
      "default_mode": "base"
    }
  }
}
```

**JetBrains** `acp.json`:

```json
{ "agent-lab": { "command": "bun", "args": ["agents/run/acp-bridge.ts"] } }
```

## Aliased imports

`tsconfig.json` configures `@agents/*` → `./agents/*` path mapping.
Core modules use relative imports for ports/types only.

## Architecture notes

- **Routing**: Orchestrator keyword-matches user text against a list (code, function, implement, algorithm, python, typescript, bug, review, write). Anything without a code keyword → Researcher Agent.
- **Task polling**: A2A uses simple polling (200ms interval, 20 retries = ~4s max). Use SSE streaming in production.
- **ACP bridge**: Reads `ORCHESTRATOR_URL` env var (default `http://localhost:4000`).
- **MCP run_python**: Writes temp `.py` to `/tmp`, runs via `uv run --quiet`, 10s timeout. No persistent venv — each call is isolated.
- **MCP tools**: `read_file`, `write_file`, `run_python`, `calculate`, `save_skill`, `list_skills`. All paths relative to `process.cwd()`.
- **Memory**: Append-only markdown. Orchestrator writes to `memory/orchestrator.md`. Compatible with Hermes `memory.md` pattern.
- **Skills**: JSON files in `skills/` with `name`, `description`, `tags`, `steps`, `createdAt`, `usageCount`, `successRate`.

## Notes

- No typecheck, lint, or test scripts configured — `bun run tsc --noEmit` for type checking if needed
- Agent routing defaults to Researcher for unrecognized task types
- All A2A endpoints return CORS `Access-Control-Allow-Origin: *`
