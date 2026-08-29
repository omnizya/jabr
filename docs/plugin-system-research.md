# Jabr Growth & Plugin System Research

**Date:** 2026-08-29
**Status:** Research Phase
**Related:** JABR-GROWTH.md (plugin system guide)

---

## Current State

Jabr has grown from a simple multi-agent experiment to a full A2A-compliant system with:
- 7 specialist agents (ports 4000-4006 + Jarvis on 1337)
- 4 protocol layers (ACP, A2A, MCP, Webhooks)
- 59 kanban tasks across 7 phases
- Hexagonal architecture with 12+ ports and 20+ adapters

**The next growth dimension:** Plugin system (PnP) to allow third-party extensions.

---

## Plugin System Architecture (from JABR-GROWTH.md)

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
export interface PluginContext {
  logger: { info: (msg: string) => void; error: (msg: string) => void };
  // Outbound Ports (safe, controlled access)
  taskStore: TaskStorePort;
  memoryStore: MemoryStorePort;
  agentRegistry: AgentRegistryPort;
}

export interface IPlugin {
  readonly metadata: {
    name: string;
    version: string;
    author: string;
    description: string;
    events: string[];  // Events this plugin subscribes to
  };
  
  onInitialize(context: PluginContext): Promise<void>;
  onEvent(event: DomainEvent, payload: unknown): Promise<void>;
  onShutdown(): Promise<void>;
}
```

### Domain Events

```typescript
// Agent lifecycle
type AgentCreatedEvent = { type: "agent:created"; payload: { name: string; port: number } };
type AgentShutdownEvent = { type: "agent:shutdown"; payload: { name: string } };

// Task lifecycle
type TaskCreatedEvent = { type: "task:created"; payload: { taskId: string; agent: string } };
type TaskCompletedEvent = { type: "task:completed"; payload: { taskId: string; result: unknown } };
type TaskFailedEvent = { type: "task:failed"; payload: { taskId: string; error: string } };

// System
type SystemAlertEvent = { type: "system:alert"; payload: { level: string; message: string } };
```

---

## Research Questions

### 1. Plugin Discovery

| Approach | Pros | Cons |
|----------|------|------|
| **Filesystem scan** | Simple, no network | Manual install |
| **NPM registry** | Versioning, discovery | Network dependency |
| **Git repository** | Easy updates | Security concerns |
| **IPFS CID** | Decentralized | Complex resolution |

**Recommendation:** Start with filesystem scan, add NPM later.

### 2. Plugin Security

| Threat | Mitigation |
|--------|------------|
| **Malicious code** | Sandbox via subprocess or VM |
| **Infinite loops** | Timeout on event handlers |
| **Memory leaks** | Per-plugin memory limits |
| **Data exfiltration** | No network access by default |
| **Privilege escalation** | Strict PluginContext boundary |

**Recommendation:** Run plugins in isolated subprocess with timeout.

### 3. Plugin Communication

| Pattern | Use Case |
|---------|----------|
| **Event-driven** | Reactive side-effects (logging, notifications) |
| **Pipeline** | Data transformation (formatters, validators) |
| **Middleware** | Request/response interception |
| **Registry UI** | Adding UI components |

**Recommendation:** Event-driven (matches existing architecture).

### 4. Plugin Lifecycle

```
[Discovered] → [Validated] → [Loaded] → [Initialized] → [Running] → [Shutdown]
     ↑              ↑            ↑            ↑              ↑           ↓
     └──────────────┴────────────┴────────────┴──────────────┴───────────┘
                    (error at any stage → plugin disabled, logged)
```

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

### Phase 3: Sample Plugin (1-2 days)

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

1. **Should plugins be able to create new agents?**
   - Pro: Extensible agent ecosystem
   - Con: Security risk, resource exhaustion

2. **Should plugins persist state?**
   - Pro: Enable stateful plugins (caches, accumulators)
   - Con: State management complexity

3. **Should plugins have network access?**
   - Pro: Enable API integrations
   - Con: Security risk, data exfiltration

4. **How to version plugin API?**
   - Semantic versioning of `IPlugin` interface
   - Backward compatibility guarantees

---

## Recommendation

**Yes, Jabr should implement a plugin system.** The hexagonal architecture is already in place — adding plugins is the natural next step for growth.

**Priority:** Medium (after webhook/bot integrations and MCP compliance)

**Estimated effort:** 8-13 days for full implementation

---

## Related Documents

- `JABR-GROWTH.md` — Original plugin system guide
- `CANONICAL.md` — Full architecture documentation
- `docs/mcp-gap-analysis.md` — MCP compliance gaps
- `docs/webhook-bot-research.md` — Webhook/bot integrations
- `docs/realtime-graph-storage-research.md` — Real-time and storage
