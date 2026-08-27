# Jabr — Project Memory

*Jabr (جبر) — Arabic for "restoration of broken parts," the root of algebra.*

## What this is

Experimental multi-agent system testing ACP + A2A + MCP together.
Runtime: **Bun 1.4** (TypeScript) + **uv** (Python tools). No build step — run `.ts` files directly.

## Architecture — Hexagonal (Ports & Adapters)

```
agents/
├── core/              # Domain logic — ZERO infrastructure imports
│   ├── orchestrator.ts   # Keyword routing, delegation
│   ├── oracle.ts         # Code review, simplification, architecture
│   ├── fixer.ts          # Bug fixes, code generation, mechanical impl
│   ├── librarian.ts      # Docs, web research, code search
│   ├── explorer.ts       # Fast codebase recon, file search
│   └── designer.ts       # UI/UX design, responsive layouts
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
    ├── oracle.ts           # Port 4001
    ├── librarian.ts        # Port 4002
    ├── explorer.ts         # Port 4003
    ├── designer.ts         # Port 4004
    ├── fixer.ts            # Port 4005
    └── acp-bridge.ts       # stdio, reads ORCHESTRATOR_URL env
```

**Rule:** Core modules never import adapters. Adapters implement port interfaces. Run modules do all wiring.

## Agents

| Agent            | Port  | Protocol   | Role                                          |
| ---------------- | ----- | ---------- | --------------------------------------------- |
| Orchestrator     | 4000  | A2A server | Routes tasks, persists memory, self-improves  |
| Oracle           | 4001  | A2A server | Code review, simplification, architecture     |
| Librarian        | 4002  | A2A server | Docs, web research, code search               |
| Explorer         | 4003  | A2A server | Fast codebase recon, file search              |
| Designer         | 4004  | A2A server | UI/UX design, responsive layouts              |
| Fixer            | 4005  | A2A server | Bug fixes, code generation, mechanical impl   |
| ACP Bridge       | stdio | ACP server | IDE bridge → Orchestrator                     |
| MCP Tool Server  | stdio | MCP server | fs, uv-python, calculate, skill store         |

## Protocol layers

- **ACP** (stdio nd-JSON) — IDE ↔ ACP bridge — JSON-RPC 2.0, one JSON object per line
- **A2A** (HTTP JSON-RPC) — Orchestrator ↔ Specialists — Agent Cards at `/.well-known/agent-card.json`
- **MCP** (stdio) — Agents ↔ Tools — `bun mcp-servers/tools.ts`

## Skills system

### Builtin skills (`skills/builtin/`)

Static Hermes-style SKILL.md files with YAML frontmatter + markdown body.
Each skill is assigned to an agent and loaded at task time.

| Skill                 | Assigned To   | Description                                      |
| --------------------- | ------------- | ------------------------------------------------ |
| `simplify`            | Oracle        | Behavior-preserving code simplification          |
| `codemap`             | Explorer      | Hierarchical repository mapping                  |
| `deepwork`            | Orchestrator  | Complex coding sessions with review gates        |
| `verification-planning` | Orchestrator | Evidence planning before implementation          |
| `reflect`             | Orchestrator  | Review repeated work, suggest reusable skills    |
| `worktrees`           | Orchestrator  | Git worktree management for isolated work        |

### Auto-generated skills (`skills/*.json`)

JSON files created by agents during the self-improvement loop.
Librarian Agent writes `skills/<slug>.json` after each novel task.
Skills are idempotent: same task type → slug match → skipped if file exists.

### Skill assignment (opencode.json)

```json
"agents": {
  "orchestrator": { "skills": ["deepwork", "verification-planning", "reflect", "worktrees", "codemap"] },
  "oracle": { "skills": ["simplify"] },
  "explorer": { "skills": ["codemap"] },
  "librarian": { "skills": [] },
  "designer": { "skills": [] },
  "fixer": { "skills": [] }
}
```

## Self-improvement loop

After each novel task, Librarian Agent writes `skills/<slug>.json`.
These are Hermes-style skill documents with steps + success tracking.
Skills are idempotent: same task type → slug match → skipped if file exists.

## Key files

- `agents/core/` — Domain logic (orchestrator, oracle, fixer, librarian, explorer, designer)
- `agents/ports/` — Port interfaces (agent-registry, task-store, memory-store, skill-store)
- `agents/adapters/` — HTTP servers, A2A client, filesystem stores
- `agents/run/` — Composition roots that wire everything together
- `agents/types.ts` — Shared TypeScript types (A2A, ACP, Skill, MCP, AgentCard)
- `mcp-servers/tools.ts` — MCP tool server (Bun, uses McpServer from SDK)
- `scripts/demo.ts` — End-to-end integration test (requires all agents running)
- `skills/` — Auto-generated skill documents (JSON)
- `skills/builtin/` — Static Hermes-style SKILL.md files
- `memory/orchestrator.md` — Session memory (append-only markdown)

## Quick start

```bash
bun install

# Start all agents in parallel (dev mode)
bun run dev

# Or individually:
bun run orchestrator # port 4000
bun run oracle       # port 4001
bun run librarian    # port 4002
bun run explorer     # port 4003
bun run designer     # port 4004
bun run fixer        # port 4005

# Run integration test (agents must be running first)
bun run demo
```

## IDE integration (ACP)

**Zed** `~/.config/zed/settings.json` or project `settings.json`:

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

**JetBrains** `acp.json`:

```json
{ "jabr": { "command": "bun", "args": ["agents/run/acp-bridge.ts"] } }
```

## Aliased imports

`tsconfig.json` configures `@agents/*` → `./agents/*` path mapping.
Core modules use relative imports for ports/types only.

## Architecture notes

- **Routing**: Orchestrator iterates `ROUTING_TABLE` in priority order — fixer (fix/bug/error/patch/repair/debug) → oracle (review/simplify/refactor/architecture/audit) → explorer (find/files/map/structure/grep/search) → designer (layout/responsive/component/button/color/palette/ui/ux) → librarian (research/doc/api/library/how-to/summarize) → fixer fallback (code/function/implement/algorithm/python/typescript/write). Unmatched → Librarian.
- **Task polling**: A2A uses simple polling (200ms interval, 20 retries = ~4s max). Use SSE streaming in production.
- **ACP bridge**: Reads `ORCHESTRATOR_URL` env var (default `http://localhost:4000`).
- **MCP run_python**: Writes temp `.py` to `/tmp`, runs via `uv run --quiet`, 10s timeout. No persistent venv — each call is isolated.
- **MCP tools**: `read_file`, `write_file`, `run_python`, `calculate`, `save_skill`, `list_skills`. All paths relative to `process.cwd()`.
- **Memory**: Append-only markdown. Orchestrator writes to `memory/orchestrator.md`. Compatible with Hermes `memory.md` pattern.
- **Skills**: JSON files in `skills/` with `name`, `description`, `tags`, `steps`, `createdAt`, `usageCount`, `successRate`.

## Notes

- No typecheck, lint, or test scripts configured — `bun run tsc --noEmit` for type checking if needed
- All A2A endpoints return CORS `Access-Control-Allow-Origin: *`
- Agent routing defaults to Librarian for unrecognized task types
