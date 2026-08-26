# agent-lab — Project Memory

## What this is

Experimental multi-agent system testing ACP + A2A + MCP together.
Runtime: **Bun 1.4** (TypeScript) + **uv** (Python tools). No build step — run `.ts` files directly.

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

- `agents/orchestrator.ts` — Hermes-style brain, routes via keyword matching
- `agents/coder-agent.ts` — A2A specialist (port 4001)
- `agents/researcher-agent.ts` — A2A specialist (port 4002)
- `agents/acp-bridge.ts` — ACP stdio bridge for IDEs
- `agents/types.ts` — Shared TypeScript types (A2A, ACP, Skill, MCP shapes)
- `mcp-servers/tools.ts` — MCP tool server (Bun)
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

**Zed** `~/.config/zed/settings.json`:

```json
{
  "bindings": {
    "cmd-alt-o": [
      "agent::NewExternalAgentThread",
      {
        "agent": {
          "custom": {
            "name": "agent-lab",
            "command": { "command": "bun", "args": ["agents/acp-bridge.ts"] }
          }
        }
      }
    ]
  }
}
```

**JetBrains** `acp.json`:

```json
{ "agent-lab": { "command": "bun", "args": ["agents/acp-bridge.ts"] } }
```

## Architecture notes

- **Routing**: Orchestrator keyword-matches user text against a hardcoded list (code, function, implement, algorithm, python, typescript, bug, review, write). Anything without a code keyword → Researcher Agent.
- **Task polling**: A2A uses simple polling (200ms interval, 20 retries = ~4s max). Use SSE streaming in production.
- **ACP bridge**: Hardcodes orchestrator URL as `http://localhost:4000` (see FIXME in source). Communicates with orchestrator only, not directly with sub-agents.
- **MCP run_python**: Writes temp `.py` to `/tmp`, runs via `uv run --quiet`, 10s timeout. No persistent venv — each call is isolated.
- **MCP tools**: `read_file`, `write_file`, `run_python`, `calculate`, `save_skill`, `list_skills`. All paths relative to `process.cwd()`.
- **Memory**: Append-only markdown. Orchestrator writes to `memory/orchestrator.md`. Compatible with Hermes `memory.md` pattern.
- **Skills**: JSON files in `skills/` with `name`, `description`, `tags`, `steps`, `createdAt`, `usageCount`, `successRate`.

## Notes

- No typecheck, lint, or test scripts configured — `bun run tsc --noEmit` for type checking if needed
- `index.ts` is a Bun init placeholder, not a real entrypoint
- Agent routing defaults to Researcher for unrecognized task types — add code keywords to Coder routing if needed
- All A2A endpoints return CORS `Access-Control-Allow-Origin: *`
