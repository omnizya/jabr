# Jabr

Experimental multi-agent system testing [ACP](https://github.com/anthropics/agent-communication-protocol) + [A2A](https://github.com/google/A2A) + [MCP](https://modelcontextprotocol.io/) together.

*Jabr (جبر) — Arabic for "restoration of broken parts," the root of algebra.*

Runtime: **Bun 1.4** (TypeScript) + **uv** (Python). No build step — run `.ts` files directly.

## Agents

| Agent | Port | Protocol | Role |
|---|---|---|---|
| Orchestrator | 4000 | A2A server | Routes tasks, persists memory, self-improves |
| Coder Agent | 4001 | A2A server | Code generation, review, Python execution |
| Researcher Agent | 4002 | A2A server | Research, summarization, skill creation |
| ACP Bridge | stdio | ACP server | IDE → Orchestrator |
| MCP Tool Server | stdio | MCP server | fs, uv-python, calculate, skill store |

## Quick Start

```bash
bun install

# Start all agents
bun run dev

# Or individually
bun run orchestrator
bun run coder
bun run researcher

# Run integration test (requires all agents running)
bun run demo
```

## Protocol Layers

- **ACP** (stdio) — IDE ↔ ACP bridge — JSON-RPC 2.0
- **A2A** (HTTP) — Orchestrator ↔ Specialists — JSON-RPC over HTTP
- **MCP** (stdio) — Agents ↔ Tools — `bun mcp-servers/tools.ts`

## IDE Integration

### Zed

Add to `~/.config/zed/settings.json` or project `.zed/settings.json`:

```json
{
  "agent_servers": {
    "jabr": {
      "type": "custom",
      "command": "bun",
      "args": ["agents/acp-bridge.ts"],
      "default_mode": "base"
    }
  }
}
```

### JetBrains

Create `acp.json` in project root:

```json
{
  "jabr": {
    "command": "bun",
    "args": ["agents/acp-bridge.ts"]
  }
}
```

## MCP Tools

| Tool | Description |
|---|---|
| `read_file` | Read a file from the workspace |
| `write_file` | Write content to a file |
| `run_python` | Execute Python via `uv run` (10s timeout) |
| `calculate` | Safe arithmetic evaluator |
| `save_skill` | Persist a Hermes-style skill document |
| `list_skills` | List all saved skills |

## Self-Improvement

After each novel task, the Researcher Agent writes `skills/<slug>.json` — Hermes-style skill documents with steps and success tracking. Skills are idempotent: same task type reuses the existing skill file.
