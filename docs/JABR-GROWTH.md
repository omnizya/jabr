# JABR-GROWTH.md — Jabr Growth Strategy & Plugin System

**Version:** 0.4.0
**Last Updated:** 2026-08-29
**Status:** Active Development

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State](#current-state)
3. [Growth Dimensions](#growth-dimensions)
4. [Plugin System Architecture](#plugin-system-architecture)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Open Questions](#open-questions)
7. [Related Documents](#related-documents)

---

## Executive Summary

Jabr has evolved from a simple multi-agent experiment into a production-grade A2A-compliant multi-agent system. This document tracks:

- **Current capabilities** — what Jabr can do today
- **Growth dimensions** — where Jabr needs to grow next
- **Plugin system** — the architecture for third-party extensions
- **Roadmap** — prioritized implementation plan

**Key insight:** Jabr's hexagonal architecture (Ports & Adapters) makes it naturally extensible. The plugin system is the next logical growth dimension — enabling third-party developers to extend Jabr without modifying core code.

---

## Current State

### Capabilities (v0.4.0)

| Layer | Status | Details |
|-------|--------|---------|
| **A2A Protocol** | ✅ Complete | 9-state lifecycle, SSE streaming, push notifications, Agent Card capabilities |
| **Production** | ✅ Complete | API key auth, circular handoff detection, dead letter queue, OpenTelemetry, rate limiting |
| **Memory** | ✅ Complete | Hierarchical distillation, shared knowledge graph, TTL/decay, conflict resolution |
| **x402** | ✅ Complete | Payment middleware, agent pricing, cross-agent settlement |
| **Webhooks** | 🔄 In Progress | Generic server, GitHub bot, Telegram, WhatsApp |
| **MCP** | 📋 Planned | Elicitation, sampling, structured output, prompts, roots |
| **Real-time** | 📋 Planned | Bun WebSocket, live dashboards, event streaming |
| **IPFS** | 📋 Planned | Artifact storage, immutable logs, content addressing |
| **Plugin System** | 📋 Planned | PnP architecture, event-driven, Bun bundles |

### Agent Ecosystem

| Agent | Port | Role | Protocol |
|-------|------|------|----------|
| Orchestrator | 4000 | Routes, persists memory, self-improves | A2A |
| Oracle | 4001 | Code review, simplification, architecture | A2A |
| Librarian | 4002 | Web search, docs, skill synthesis | A2A |
| Explorer | 4003 | Fast codebase recon, file search | A2A |
| Designer | 4004 | UI/UX, image generation | A2A |
| Fixer | 4005 | Bug fixes, mechanical implementation | A2A |
| Scientist | 4006 | Python data analysis via MCP | A2A |
| Jarvis | 1337 | Proactive codebase steward | A2A |
| ACP Bridge | stdio | IDE ↔ Orchestrator | ACP |
| MCP Tool Server | stdio | Tools + resources | MCP |

### Architecture Health

```
agents/
├── core/              # 12 domain modules (zero infra imports)
├── ports/             # 14 port interfaces (contracts)
├── adapters/          # 20+ concrete implementations
├── run/               # 10 composition roots
└── types.ts           # Shared A2A/ACP/MCP types
```

**Hexagonal compliance:** ✅ Core never imports adapters
**Test coverage:** 20+ unit tests, 73 e2e tests
**Kanban:** 59 tasks (16 done, 12 running, 31 ready)

---

## Growth Dimensions

### Dimension 1: Protocol Compliance

| Protocol | Current | Target | Gap |
|----------|---------|--------|-----|
| **A2A** | v0.3 | v1.0 | ✅ Closed |
| **MCP** | Tools + Resources | +Elicitation, Sampling, Prompts, Roots, Structured Output | 7 tasks |
| **ACP** | Full | Full | ✅ Complete |
| **x402** | Middleware | +Wallet, Settlement | 2 tasks |

### Dimension 2: External Integration

| Integration | Status | Priority |
|-------------|--------|----------|
| **GitHub Bot** | 🔄 In Progress | High |
| **Telegram Bot** | 🔄 In Progress | High |
| **WhatsApp Bot** | 📋 Planned | Medium |
| **Discord Bot** | 📋 Planned | Low |
| **Slack Bot** | 📋 Planned | Low |

### Dimension 3: Infrastructure

| Component | Status | Priority |
|-----------|--------|----------|
| **Webhook Server** | 🔄 In Progress | High |
| **Real-time (WebSocket)** | 📋 Planned | High |
| **IPFS Artifact Storage** | 📋 Planned | Medium |
| **GunJS Graph Memory** | 📋 Planned | Experimental |
| **Docker Containerization** | 📋 Planned | Medium |
| **Monitoring Dashboard** | 📋 Planned | Medium |

### Dimension 4: Extensibility

| Feature | Status | Priority |
|---------|--------|----------|
| **Plugin System (PnP)** | 📋 Planned | Medium |
| **Plugin Marketplace** | 📋 Planned | Future |
| **Plugin SDK** | 📋 Planned | Future |
| **Plugin Security Model** | 📋 Planned | Medium |

---

## Plugin System Architecture

### Design Principles

1. **Hexagonal Safety** — Plugins interact only via Outbound Ports (Repositories), never direct DB access
2. **Bun Native** — Use `Bun.build` for single-file plugin bundles, `import()` for dynamic loading
3. **Event-Driven** — Core emits Domain Events, plugins subscribe and return side-effects
4. **Error Isolation** — One crashing plugin never takes down the core

### Architecture Layers

```
[Bun Runtime System]
       │ (Scans & imports bun.build files)
       ▼
┌────────────────────────────────────────────────────────┐
│ INFRASTRUCTURE LAYER (Driving Adapter)                 │
│ ▸ BunDynamicPluginLoaderAdapter                        │
└──────┬─────────────────────────────────────────────────┘
       │
       ▼ (Registers plugin handlers)
┌────────────────────────────────────────────────────────┐
│ APPLICATION / USE-CASE LAYER                          │
│ ▸ PluginRegistryUseCase & EventBus                     │
└──────┬─────────────────────────────────────────────────┘
       │
       ▼ (Passes controlled access via Context)
┌────────────────────────────────────────────────────────┐
│ DOMAIN / CORE LAYER (Inbound & Outbound Ports)         │
│ ✉️  Domain Events                                      │
│ 🔌 IPlugin Interface                                   │
│ 🛡️ PluginContext ───► References Outbound Ports       │
└───────────────────────────────────┬────────────────────┘
                                    │
                                    ▼ (Safe, isolated execution)
                       ┌───────────────────────────┐
                       │   ISOLATED BUN BUNDLE     │
                       │   ▸ Third-Party Plugin    │
                       └───────────────────────────┘
```

### Plugin Interface Contract

```typescript
// ports/plugin-port.ts
export interface PluginContext {
  logger: { 
    info: (msg: string) => void; 
    error: (msg: string) => void;
    warn: (msg: string) => void;
  };
  // Outbound Ports (safe, controlled access)
  taskStore: TaskStorePort;
  memoryStore: MemoryStorePort;
  agentRegistry: AgentRegistryPort;
  skillStore: SkillStorePort;
}

export interface IPlugin {
  readonly metadata: {
    name: string;
    version: string;
    author: string;
    description: string;
    events: string[];  // Events this plugin subscribes to
  };
  
  // Lifecycle hooks
  onInitialize(context: PluginContext): Promise<void>;
  onEvent(event: DomainEvent, payload: unknown): Promise<void>;
  onShutdown(): Promise<void>;
}

export interface DomainEvent {
  type: string;
  payload: unknown;
  timestamp: Date;
  source: string;
}
```

### Domain Events

```typescript
// Agent lifecycle
type AgentCreatedEvent = { type: "agent:created"; payload: { name: string; port: number } }
type AgentShutdownEvent = { type: "agent:shutdown"; payload: { name: string } }

// Task lifecycle
type TaskCreatedEvent = { type: "task:created"; payload: { taskId: string; agent: string } }
type TaskCompletedEvent = { type: "task:completed"; payload: { taskId: string; result: unknown } }
type TaskFailedEvent = { type: "task:failed"; payload: { taskId: string; error: string } }

// System
type SystemAlertEvent = { type: "system:alert"; payload: { level: string; message: string } }
```

### Plugin Lifecycle

```
[Discovered] → [Validated] → [Loaded] → [Initialized] → [Running] → [Shutdown]
     ↑              ↑            ↑            ↑              ↑           ↓
     └──────────────┴────────────┴────────────┴──────────────┴───────────┘
                    (error at any stage → plugin disabled, logged)
```

### Plugin Discovery

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Filesystem scan** | Simple, no network | Manual install | ✅ Start here |
| **NPM registry** | Versioning, discovery | Network dependency | Phase 2 |
| **Git repository** | Easy updates | Security concerns | Phase 3 |
| **IPFS CID** | Decentralized | Complex resolution | Future |

### Plugin Security

| Threat | Mitigation |
|--------|------------|
| **Malicious code** | Sandbox via subprocess or VM |
| **Infinite loops** | Timeout on event handlers (5s default) |
| **Memory leaks** | Per-plugin memory limits (128MB default) |
| **Data exfiltration** | No network access by default |
| **Privilege escalation** | Strict PluginContext boundary |
| **Plugin conflict** | Unique name enforcement, version checking |

### Plugin Communication Patterns

| Pattern | Use Case | Implementation |
|---------|----------|----------------|
| **Event-driven** | Reactive side-effects (logging, notifications) | Core emits, plugins subscribe |
| **Pipeline** | Data transformation (formatters, validators) | Sequential processing |
| **Middleware** | Request/response interception | Pre/post hooks |
| **Registry UI** | Adding UI components | Component registry |

---

## Implementation Roadmap

### Phase 1: Core Plugin Infrastructure (3-5 days)

- [ ] Define `IPlugin` interface and `PluginContext`
- [ ] Create `PluginEventBus` for event emission/subscription
- [ ] Implement `PluginRegistryUseCase` for plugin management
- [ ] Add domain events to existing agent/task lifecycle

### Phase 2: Dynamic Loader (2-3 days)

- [ ] Implement `BunDynamicPluginLoaderAdapter`
- [ ] Scan `plugins/` directory for `.js` bundles
- [ ] Validate plugin structure (metadata, interface conformance)
- [ ] Error isolation (try/catch per plugin)

### Phase 3: Sample Plugins (1-2 days)

- [ ] Create `AnalyticsPlugin` (logs all events)
- [ ] Create `NotificationPlugin` (sends alerts on task failure)
- [ ] Document plugin development guide
- [ ] Provide `Bun.build` config template

### Phase 4: Security Hardening (2-3 days)

- [ ] Subprocess isolation for plugins
- [ ] Timeout on event handlers
- [ ] Memory limits per plugin
- [ ] Schema validation for plugin manifests

---

## Open Questions

### 1. Plugin Capabilities

| Question | Options | Recommendation |
|----------|---------|----------------|
| **Can plugins create agents?** | Yes / No | No (security risk) |
| **Can plugins persist state?** | Yes / No | Yes (via Outbound Ports) |
| **Can plugins access network?** | Yes / No / Opt-in | Opt-in (manifest flag) |
| **Can plugins have UI?** | Yes / No | Future (Registry UI pattern) |

### 2. Plugin Distribution

| Question | Options | Recommendation |
|----------|---------|----------------|
| **Where to host?** | Filesystem / NPM / Git / IPFS | Filesystem first, NPM later |
| **Versioning?** | Semver / Timestamp | Semver |
| **Discovery?** | Manual / Registry / Auto | Manual first, registry later |
| **Trust model?** | Signed / Unsigned / Web of Trust | Unsigned (internal use) |

### 3. Plugin API Versioning

| Question | Options | Recommendation |
|----------|---------|----------------|
| **API stability?** | Stable / Unstable | Stable (v1.0 freeze) |
| **Backward compat?** | Yes / No | Yes (deprecation cycle) |
| **Breaking changes?** | Major version / Fork | Major version bump |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `CANONICAL.md` | Full architecture, gap analysis, production readiness |
| `TODO.md` | Task tracker — completed work + future phases |
| `AGENTS.md` | Agent-specific notes (internal) |
| `docs/mcp-gap-analysis.md` | MCP 2026-07-28 compliance gaps |
| `docs/webhook-bot-research.md` | Webhook, GitHub, Telegram, WhatsApp research |
| `docs/realtime-graph-storage-research.md` | Real-time, GunJS, IPFS research |
| `docs/plugin-system-research.md` | Plugin system detailed research |

---

## Metrics & KPIs

### Current Metrics

| Metric | Value |
|--------|-------|
| **Agents** | 8 (7 specialists + 1 steward) |
| **Ports** | 14 interfaces |
| **Adapters** | 20+ implementations |
| **Kanban Tasks** | 59 (16 done, 12 running, 31 ready) |
| **Test Coverage** | 20+ unit, 73 e2e |
| **Lines of Code** | ~5000+ |
| **Protocol Compliance** | A2A v1.0 ✅, MCP partial, ACP ✅ |

### Growth Targets (v0.5.0)

| Metric | Target |
|--------|--------|
| **Plugins** | 3+ (Analytics, Notification, Custom) |
| **MCP Compliance** | Full (elicitation, sampling, prompts, roots) |
| **External Integrations** | GitHub, Telegram, WhatsApp |
| **Real-time** | WebSocket server + dashboard |
| **Test Coverage** | 50+ unit, 100+ e2e |

---

## Conclusion

Jabr is at an inflection point. The core architecture is solid (hexagonal, A2A-compliant, production-hardened). The next growth phase focuses on:

1. **External integrations** — webhooks, bots, real-time
2. **Protocol compliance** — MCP 2026-07-28
3. **Extensibility** — plugin system for third-party developers
4. **Infrastructure** — Docker, monitoring, IPFS

The plugin system is the key enabler for long-term growth — it allows Jabr to become a platform, not just a product.

---

**Next step:** Implement Phase 1 of the plugin system (core infrastructure).
