# Jabr Integration for Kasbah

This directory provides integration between **Kasbah** (Mistral Workflows) and **Jabr** (multi-agent system).

## Overview

The Jabr integration allows Kasbah workflows to:
- Delegate tasks to Jabr agents via A2A (Agent-to-Agent) protocol
- Orchestrate multi-agent workflows
- Check agent health and availability
- Fetch world state from the Jabr orchestrator

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Kasbah Workflows   │────▶│    Jabr Agents       │
│   (Python/Mistral)    │     │   (TypeScript/Bun)    │
├─────────────────────┤     ├─────────────────────┤
│ • jabr_orchestrator  │     │ • orchestrator:4000  │
│ • jabr_code_review   │     │ • oracle:4001        │
│ • jabr_agent_delegate│     │ • librarian:4002     │
└─────────────────────┘     │ • explorer:4003      │
                               │ • designer:4004      │
                               │ • fixer:4005         │
                               │ • scientist:4006    │
                               │ • verification:4009  │
                               │ • jarvis:1337        │
                               └─────────────────────┘
```

## Components

### Connector (`connector.py`)
- `JabrConnector`: Main client for Jabr integration
- `JabrAgentClient`: HTTP client for individual agent communication
- `JabrConfig`: Configuration management (URLs, timeouts, auth tokens)

### Models (`models.py`)
- `AgentType`: Enum of all Jabr agent types
- `JabrTask`: Task payload for Jabr agents
- `JabrTaskResult`: Result from agent tasks
- `JabrAgentCard`: Agent metadata (from `/.well-known/agent-card.json`)
- `JabrWorldState`: Aggregate state from Jabr orchestrator
- `JabrTaskStatus`: Task lifecycle status

### Workflows

#### 1. `jabr_orchestrator.py`
Main integration workflows:
- **`jabr-orchestrator`**: Orchestrate tasks across multiple Jabr agents
- **`jabr-agent-delegate`**: Delegate a task to a specific Jabr agent
- **`jabr-health-check`**: Check health and availability of all Jabr agents

#### 2. `jabr_code_review.py`
Practical example workflows:
- **`jabr-code-review`**: Comprehensive code review using multiple agents
- **`jabr-quick-review`**: Quick code review using only the oracle agent

## Usage

### Environment Configuration

Add to your `.env` file:

```bash
# Jabr orchestrator URL (default: http://localhost:4000)
JABR_URL=http://localhost:4000

# Optional: A2A authentication token
A2A_AUTH_TOKEN=your-dev-token

# Optional: Timeout for agent responses (default: 30 seconds)
JABR_TIMEOUT_SECONDS=60
```

### Starting Jabr Agents

Before running Kasbah workflows, start the Jabr agents:

```bash
# From the agent-lab root directory
cd /home/m7r/Work/agent-lab
bun run dev

# Or start specific agents
bun run orchestrator
bun run oracle
bun run librarian
# etc.
```

### Running Kasbah Workflows

Start the Kasbah worker:

```bash
cd /home/m7r/Work/agent-lab/kasbah
make start-worker
```

Trigger a workflow execution:

```bash
# Jabr orchestration
make execute workflow=jabr-orchestrator input='{"task": "Explain AI agent systems", "target_agents": ["oracle", "librarian"]}'

# Code review
make execute workflow=jabr-code-review input='{"code": "def hello(): return 42", "language": "python"}'

# Health check
make execute workflow=jabr-health-check input='{}'
```

## API Reference

### JabrConnector

```python
from jabr.connector import JabrConnector, JabrConfig

# Create connector with default configuration
connector = JabrConnector()

# Create connector with custom configuration
config = JabrConfig(
    orchestrator_url="http://localhost:4000",
    auth_token="your-token",
    timeout_seconds=60
)
connector = JabrConnector(config)

# Send a task to an agent
from jabr.models import JabrTask, AgentType

task = JabrTask(
    text="Review this code",
    agent=AgentType.ORACLE,
    context={"code": "..."}
)
result = await connector.send_task(task)

# Check agent health
healthy, card = await connector.get_agent_status(AgentType.ORACLE)

# Get world state
world_state = await connector.get_world_state()
```

### Activities

The integration provides pre-built activities for common operations:

```python
# In your workflow
from workflows.jabr_orchestrator import (
    send_to_agent,
    check_agent_health,
    get_world_state_activity,
)

# Send a task
result = await send_to_agent(
    agent="oracle",
    task_text="Analyze this",
    context={"code": "..."},
    timeout_seconds=60
)

# Check health
health_result = await check_agent_health("oracle")

# Get world state
world_state = await get_world_state_activity()
```

## Agent Ports

| Agent | Port | HTTP Endpoint |
|-------|------|---------------|
| orchestrator | 4000 | Yes |
| oracle | 4001 | Yes |
| librarian | 4002 | Yes |
| explorer | 4003 | Yes |
| designer | 4004 | Yes |
| fixer | 4005 | Yes |
| scientist | 4006 | Yes |
| verification | 4009 | Yes |
| jarvis | 1337 | Yes |
| mcp | 0 | No (stdio) |

## A2A Protocol

The integration uses the **JSON-RPC 2.0** protocol over HTTP POST:

```json
{
  "jsonrpc": "2.0",
  "method": "SendMessage",
  "params": {
    "text": "Your task description",
    "context": {},
    "metadata": {}
  },
  "id": 1
}
```

## Error Handling

All operations return structured results:

```python
{
    "status": "COMPLETED" | "FAILED" | "WORKING" | ...,
    "text": "Result or error message",
    "data": {},  # Optional structured data
    "error": "Error description if failed",
    "agent": "oracle",
    "duration_ms": 1234
}
```

## Development

### Testing

```python
# Test agent connectivity
from jabr.connector import JabrConnector

connector = JabrConnector()
result = await connector.get_world_state()
print(result)
```

### Adding New Agent Types

```python
from jabr.models import AgentType

# Add to AgentType enum in models.py
AgentType.MY_AGENT = "my_agent"

# Add to agent ports mapping in connector.py
AgentType.MY_AGENT: 4011,
```

## Troubleshooting

### Connection Errors
- Ensure Jabr agents are running (`bun run dev`)
- Check agent health endpoints (`http://localhost:4001/health`)
- Verify `JABR_URL` environment variable

### Authentication Errors
- Set `A2A_AUTH_TOKEN` environment variable
- Ensure token matches what agents expect (default: `dev-secret-token-for-testing`)

### Timeout Errors
- Increase `timeout_seconds` in JabrConfig
- Check agent response times
- Verify agents are not stuck in long operations

## Related Projects

- [Jabr](https://github.com/omnizya/jabr): The multi-agent system
- [Mistral Workflows](https://docs.mistral.ai/workflows/): Durable execution framework
- [A2A Protocol](https://github.com/actoolkit/alliances): Agent-to-Agent communication standard
