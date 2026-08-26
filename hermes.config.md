# Hermes Agent Integration

## Add to your Hermes `.env` or config

```bash
# MCP server (Bun) — add to your Hermes MCP list
MCP_SERVERS='[
  {
    "name": "agent-lab-tools",
    "command": "bun",
    "args": ["/path/to/agent-lab/mcp-servers/tools.ts"],
    "type": "stdio"
  }
]'
```

## Hermes → A2A Orchestrator

Hermes can delegate to the A2A orchestrator directly via HTTP:

```bash
# In a Hermes skill or cron job:
curl -X POST http://localhost:4000/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "msg-1",
        "role": "user",
        "kind": "message",
        "parts": [{ "kind": "text", "text": "Implement a rate limiter" }],
        "contextId": "ctx-1"
      }
    }
  }'
```

## Memory bridge

Hermes writes to `memory/user.md` + `memory/memory.md`.
The orchestrator writes to `memory/orchestrator.md`.
Both use append-only markdown — compatible formats.

## Skill interop

Hermes skills live in `~/.hermes/skills/`.
This project writes to `./skills/`.
Copy compatible: both are JSON with `name`, `description`, `steps`.

## Kilo / Codex delegation

Configure in Hermes as A2A sub-agents:

```
Kilo  → http://kilo-agent-endpoint/a2a   (kilocode provider)
Codex → http://codex-agent-endpoint/a2a  (openai-codex provider)
```

Orchestrator discovers them via Agent Cards automatically.
