# agent-lab — Project Memory

## What this is

Experimental multi-agent system testing ACP + A2A + MCP together.
Runtime: **Bun 1.4** (TypeScript) + **uv** (Python tools).

## Agents

| Agent            | Port  | Protocol   | Role                                         |
| ---------------- | ----- | ---------- | -------------------------------------------- |
| Orchestrator     | 4000  | A2A server | Routes tasks, persists memory, self-improves |
| Coder Agent      | 4001  | A2A server | Code generation, review, Python execution    |
| Researcher Agent | 4002  | A2A server | Research, summarization, skill creation      |
| ACP Bridge       | stdio | ACP server | IDE bridge → Orchestrator                    |
| MCP Tool Server  | stdio | MCP server | fs, uv-python, calculate, skill store        |

## Protocol layers

- **ACP** (stdio nd-JSON) — IDE ↔ ACP bridge — JSON-RPC 2.0
- **A2A** (HTTP JSON-RPC) — Orchestrator ↔ Specialists — Agent Cards at `/.well-known/agent-card.json`
- **MCP** (stdio) — Agents ↔ Tools — `bun mcp-servers/tools.ts`

## Self-improvement loop

After each novel task, Researcher Agent writes `skills/<slug>.json`.
These are Hermes-style skill documents with steps + success tracking.

## Key files

- `agents/orchestrator.ts` — Hermes-style brain
- `agents/coder-agent.ts` — A2A specialist (port 4001)
- `agents/researcher-agent.ts` — A2A specialist (port 4002)
- `agents/acp-bridge.ts` — ACP stdio bridge for IDEs
- `mcp-servers/tools.ts` — MCP tool server (Bun)
- `scripts/demo.ts` — Full end-to-end test
- `skills/` — Auto-generated skill documents
- `memory/orchestrator.md` — Session memory

## Quick start

```bash
bun install
# Terminal 1
bun run coder
# Terminal 2
bun run researcher
# Terminal 3
bun run orchestrator
# Terminal 4 — run full demo
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

## Notes

- A2A task polling: 250ms interval, 5s timeout (use SSE streaming in production)
- MCP run_python: executes via `uv run` — no venv needed, isolated per call
- Memory: append-only markdown — matches Hermes `memory.md` pattern
- Skills: JSON files in `skills/` — loaded by orchestrator on warm paths
