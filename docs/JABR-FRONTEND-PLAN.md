# Jabr Frontend Plan

**Status:** Planned  
**Scope:** Operator console for the Jabr multi-agent system  
**Last updated:** 2026-09-12

## Product direction

Build a **Jabr Control Plane**: a web interface for operating, observing, and
debugging Jabr as a live multi-agent system. The frontend should make routing,
delegation, task progress, agent health, memory, and protocol traffic
understandable and controllable.

This is an operator console, not a generic chat UI.

## Primary capabilities

- Submit tasks to the orchestrator.
- Follow delegation and handover in real time.
- Inspect agent health, capabilities, models, and current load.
- Browse task history, artifacts, memory, and generated skills.
- Inspect A2A, ACP, MCP, realtime, and LLM activity.
- Intervene when a task needs input.
- Retry or cancel tasks where the backend supports those actions.

## Information architecture

### Overview

The default screen should answer: **Is Jabr healthy, and what is happening
now?**

- System health summary.
- Online agents and current load.
- Active tasks.
- Recent failures and alerts.
- Throughput and latency summaries.
- Memory and skill counts.
- Live event timeline.
- Task submission command bar.

### Task workspace

The task view is the core operator workflow:

- Task prompt, ID, timestamps, and lifecycle state.
- Root task and parent/child relationships.
- Assigned agent and per-agent progress.
- Delegation graph and handover history.
- Token and budget consumption.
- Event and protocol logs.
- Artifacts and final result.
- Retry, cancel, or continue actions.

The delegation graph should be a signature feature. For example,
`Orchestrator -> Oracle -> Fixer` should be visible as a causal execution tree,
not only as a flat activity list.

### Agent catalog

Each agent should expose:

- Online, offline, degraded, or error state.
- Endpoint and protocol.
- Capabilities and tags.
- Current tasks.
- Recent success/failure rate and average latency.
- Configured model/provider.
- Token budget usage.
- Agent card and supported operations.

### Memory and knowledge

Provide searchable views for:

- Orchestrator memory.
- MemPalace entries.
- Generated skills.
- Recent recalls.
- Task-to-memory relationships.
- Agent, tag, and time filters.
- Inspect, expire, or invalidate actions where supported.

### Protocol inspector

Provide a developer-oriented inspector for:

- A2A JSON-RPC requests and responses.
- MCP tool calls.
- ACP session events.
- Realtime events.
- Request duration, correlation IDs, errors, and retries.
- Raw payload and structured representations.

The inspector should support following a task across all protocol events.

### Operations and settings

- Connected services and ports.
- LLM provider and model configuration.
- Budget limits.
- Realtime connection status.
- Auth/session information.
- Feature flags and environment diagnostics.

Secrets must never be returned to or rendered by the browser.

## Frontend architecture

Use a separate `frontend/` application:

```text
frontend/
├── src/
│   ├── app/
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── layout/
│   ├── features/
│   │   ├── overview/
│   │   ├── tasks/
│   │   ├── agents/
│   │   ├── memory/
│   │   ├── protocols/
│   │   └── settings/
│   ├── components/
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── realtime-client.ts
│   │   └── query-client.ts
│   └── types/
```

Recommended technology:

- React and TypeScript.
- Vite.
- TanStack Query for server state.
- A small event store for realtime projections.
- React Router.
- CSS variables and design tokens.
- A graph library only for task delegation visualization.

Keep domain logic out of components. The frontend should consume typed API and
event contracts and maintain a projection of backend state.

## Backend contracts required

The current realtime and world-state foundations are useful, but the frontend
needs stable read models before most screens are built.

### World state

Expand `getWorldState()` to provide:

```ts
interface JabrWorldState {
  timestamp: string;
  agents: AgentSnapshot[];
  tasks: TaskSummary[];
  memory: MemorySummary;
  skills: SkillSummary;
  system: SystemHealth;
}
```

The current `agents` and `tasks` fields are incomplete and should become
actual operational snapshots.

### Task detail

Expose a task read model containing:

- Task ID, root task ID, and parent task ID.
- Prompt, state, assigned agent, and child tasks.
- Timestamps and progress.
- Events and protocol messages.
- Artifacts and result.
- Token usage and budget data.
- Error and retry information.

### Realtime semantics

Extend the existing realtime event union with:

- Monotonically increasing event sequence.
- Event timestamp.
- Correlation and root task IDs.
- Schema version.
- Replay or snapshot support after reconnect.

The frontend should:

1. Fetch an initial snapshot.
2. Connect to realtime.
3. Apply events in sequence.
4. Refetch when a sequence gap is detected.
5. Reconnect with backoff.
6. Show stale/degraded state instead of silently freezing.

## Visual and interaction direction

Use a calm technical control-room aesthetic:

- Dark-first, high-contrast interface.
- Restrained accent colors per agent.
- Explicit labels and icons for task states.
- Dense but readable operational tables.
- Detail panels for task inspection.
- Timeline and graph views for causality.
- Keyboard-first command interaction.
- Desktop-first operator workflows with responsive behavior.

Accessibility requirements:

- Never rely on color alone for status.
- Keyboard navigation for every action.
- Reduced-motion mode.
- Visible focus states.
- Live-region announcements for critical task changes.
- Sufficient contrast in dark mode.

## Delivery phases

### Phase 0: Contracts and UX foundation

- Define frontend types and API contracts.
- Define world-state and task-detail endpoints.
- Specify realtime event ordering and recovery.
- Wireframe Overview, Task Workspace, and Agent Catalog.
- Decide the authentication boundary.

**Exit condition:** frontend and backend agree on data models.

### Phase 1: Functional control plane

- Application shell and navigation.
- Overview screen.
- Task submission.
- Active task list.
- Realtime connection.
- Task detail page.
- Basic agent status cards.
- Alerts and failure states.

**Exit condition:** an operator can submit a task and follow it end to end.

### Phase 2: Observability

- Delegation graph.
- Event timeline.
- Protocol inspector.
- Task reload and replay.
- Retry and cancel controls.
- Latency and token metrics.
- Reconnect and stale-state UX.

**Exit condition:** an operator can diagnose why a task behaved as it did.

### Phase 3: Knowledge and agent operations

- Agent catalog and capability inspection.
- Memory browser and search.
- Skills browser.
- Task-to-memory links.
- Model/provider and budget views.
- Operational diagnostics.

**Exit condition:** Jabr is inspectable as a platform, not only as a task
runner.

### Phase 4: Hardening

- Authentication and authorization.
- Audit trail for operator actions.
- URL-deep-linkable task and event views.
- Frontend error monitoring.
- End-to-end tests for task submission and realtime recovery.
- Performance testing with concurrent tasks and events.
- Production deployment packaging.

## First milestone acceptance criteria

- A user can submit a task from the browser.
- The task appears immediately in the active-task list.
- The selected agent and lifecycle transitions are visible.
- Delegated child tasks are visible.
- Progress and completion update without refresh.
- Realtime disconnection is clearly indicated.
- Reconnection does not duplicate events or lose task state.
- Failed tasks expose the error and recovery action.
- Tasks can be reopened directly by URL.
- The interface remains usable when no agents are online.

## Architectural decision

Build the frontend around **event-sourced operational views with snapshot
recovery**, rather than polling isolated endpoints. This matches Jabr's
realtime direction and keeps the UI coherent as the agent graph grows.

