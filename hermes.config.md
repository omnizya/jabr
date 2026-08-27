# Hermes Configuration

Reference config for running Jabr with Hermes.

## `~/.hermes/config.yaml`

```yaml
# MCP Tool Server — stdio, launched per session
mcp_servers:
  jabr-tools:
    command: "bun"
    args: ["mcp-servers/tools.ts"]
    timeout: 120
    tools:
      resources: false
      prompts: false

# A2A specialist agents — HTTP JSON-RPC on localhost
a2a_agents:
  orchestrator:
    url: "http://localhost:4000"
    timeout: 30
    capabilities: ["routing", "memory", "skills"]
  coder:
    url: "http://localhost:4001"
    timeout: 30
    capabilities: ["code-generation", "review", "python-execution"]
  researcher:
    url: "http://localhost:4002"
    timeout: 30
    capabilities: ["research", "summarization", "skill-creation"]

# Gateway — enables A2A platform routing
gateway:
  platforms:
    a2a:
      enabled: true
  extra:
    port: 9900
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `A2A_HOST` | `localhost` | Bind host for A2A gateway |
| `A2A_PORT` | `9900` | Bind port for A2A gateway |
| `A2A_AUTH_TOKEN` | — | Shared secret for A2A auth |
| `A2A_REQUIRE_AUTH` | `false` | Require auth on A2A endpoints |
| `A2A_REPLY_TIMEOUT` | `30` | Seconds to wait for agent reply |

## Skills

Skills live in `~/.hermes/skills/<category>/SKILL.md` with YAML frontmatter:

```yaml
---
name: jabr-example
description: Example skill
version: "1.0"
metadata:
  hermes:
    tags: ["example", "jabr"]
---

# When to Use
Describe trigger conditions.

# Procedure
Step-by-step instructions.

# Pitfalls
Common mistakes.

# Verification
How to confirm success.

# Quick Reference
Cheat sheet.
```

Plus a `skill.json` for machine-readable metadata.

## Memory

- `~/.hermes/memories/MEMORY.md` — 2200 char limit, `§`-delimited entries
- `~/.hermes/memories/USER.md` — 1375 char limit
- Frozen snapshot at session start
