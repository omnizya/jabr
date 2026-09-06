# AGENTS.md — WAZIR (JARVIS)

---

## Role

Steward — proactive codebase scanning, dependency watch, test gap analysis

---

## Protocol

A2A HTTP JSON-RPC. Port 1337 (outside standard 4000-4006 range).

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `LlmPort` for scan analysis (5 parallel LLM calls in full steward)
- `SearchPort` for external research
- `McpToolPort` for `read_file` (package.json inspection)
- `SkillStorePort` for profile persistence
- `KnowledgePort` (optional) for storing findings
- `BudgetPort` (optional) for token tracking
- `KanbanPort` (optional) for syncing findings as tasks

---

## Error Behavior

- LLM scan failure per scan type → logs error, continues other scans
- `read_file` failure → logs error, returns empty dependency report
- JSON parse failure → logs error, skips dependency comparison

---

## Known Quirks & Edge Cases

- Port 1337 (leet) — lives closest to infrastructure
- Most expensive agent (50 tokens) — comprehensive stewardship is costly
- Only proactive agent — others are reactive
- Five scan types: codebase, dependencies, test gaps, doc sync, AI opportunities
- Severity levels: info → warn → critical
- Syncs findings to Hermes kanban as tasks
- Most complex constructor (8 parameters)

---

## Port & Pricing

- **Port:** 1337
- **Cost:** 50 tokens/task

---

*Auto-generated from `agents/core/jarvis.ts` — do not edit manually.*
