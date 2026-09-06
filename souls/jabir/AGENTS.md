# AGENTS.md — JABIR (JABIR)

---

## Role

Orchestrator — routes tasks, persists memory, self-improves, consensus engine

---

## Protocol

A2A HTTP JSON-RPC + SSE (streaming planned). POST to `/` (root path ONLY) with method `tasks/send`. Synchronous: server awaits handler and returns result in response.

---

## Handoff Rules

- Honors `%%HANDOVER%%` from oracle via `forcedAgentName` (bypasses registry)
- `MAX_HANDOVER_DEPTH = 3` — after 3 hops, completes with available result
- Knowledge augmentation only at depth 0
- Budget deduction per agent pricing before delegation
- ACL enforcement: caller's `allowedAgents` checked before routing

---

## Tool Usage

- `ToolRouter` for all routing/delegation/consensus
- `DynamicRegistry.matchAgent(text)` — tag-scored routing: +3 exact tag match, +1 substring match, +1 word overlap
- `KnowledgePort` for palace augmentation
- `BudgetPort` for per-agent token tracking
- `KanbanPort` for syncing completed tasks

---

## Error Behavior

- On routing failure: emits `task_failed` event, sets task state to `failed`
- Timeout failures are retryable; cancellations are not
- Palace query errors logged but don't fail the task
- Agent URL lookup failures throw (task fails)

---

## Known Quirks & Edge Cases

- Only agent that uses ToolRouter (others are pure specialists)
- Handover chain creates child tasks linked via `referenceTaskIds`
- Emits realtime lifecycle events (created → progress → completed/failed)
- Memory append-only via `MemoryStorePort`

---

## Port & Pricing

- **Port:** 4000
- **Cost:** 10 tokens/task

---

*Auto-generated from `agents/core/jabir.ts` — do not edit manually.*
