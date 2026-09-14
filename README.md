# Kasbah — Multi-Agent Orchestration Hub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![A2A Protocol](https://img.shields.io/badge/A2A-v1.0-blue)](https://a2a-protocol.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

Kasbah is a production-grade, open-source multi-agent orchestration system where each agent is independently deployable. The Kasbah is where agents meet, delegate work, and reach consensus through **SHURA**.

Built on open standards:
- **[A2A Protocol](https://a2a-protocol.org/)** — agent-to-agent communication
- **[MCP](https://modelcontextprotocol.io/)** — agent-to-tool integration
- **[ACP](https://agentcommunicationprotocol.dev/)** — IDE-to-agent bridge

---

## Quick Start

```bash
# Install
bun install

# Start the Kasbah hub
bun run kasbah

# Or run a single agent standalone
bun run agent --name jabir
```

## What is Kasbah?

```
┌─────────────────────────────────────────────────┐
│                  KASBAH (Hub)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Router   │  │  Auth    │  │  SHURA       │  │
│  │ (A2A)    │  │ (OIDC)   │  │ (Consensus)  │  │
│  └────┬─────┘  └──────────┘  └──────┬───────┘  │
│       └──────────────┬───────────────┘           │
│              Message Bus (Redis)                  │
└──────────────────────┬──────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────┴───┐    ┌────┴───┐    ┌────┴───┐
   │ JABIR  │    │ RUSHD  │    │ TARIQ  │
   │(Router)│    │(Review)│    │ (Fix)  │
   └────────┘    └────────┘    └────────┘
```

## Agent Catalog

| Agent | Domain | Standalone? |
|-------|--------|-------------|
| **JABIR** | Orchestration, routing | ✅ |
| **RUSHD** | Code review, simplification | ✅ |
| **FIHRIYA** | Research, documentation | ✅ |
| **BATTUTA** | Codebase exploration | ✅ |
| **FIRNAS** | Design, architecture | ✅ |
| **TARIQ** | Bug fixes, implementation | ✅ |
| **KHWARIZMI** | Data analysis, science | ✅ |
| **SHURA** | Verification, consensus | ✅ |

## Deploying Individual Agents

Each agent can run standalone or as part of the Kasbah hub:

```bash
# Standalone mode
bun run agent --name tariq --port 4005

# Connected to Kasbah
bun run agent --name tariq --kasbah http://localhost:4000
```

## Kasbah Hub Setup

```bash
# Full stack with Docker Compose
docker-compose up

# Or manual
bun run kasbah
```

## Configuration

Environment variables — see `.env.example`.

## Production Deployment

See `docs/deployment.md` for Docker, Kubernetes, and security hardening.

## License

MIT — see [LICENSE](./LICENSE).
