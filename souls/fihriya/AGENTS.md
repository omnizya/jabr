# AGENTS.md — FIHRIYA (LIBRARIAN)

---

## Role

Librarian — web search, docs, skill synthesis

---

## Protocol

A2A HTTP JSON-RPC.

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `SearchPort` for external research
- `KnowledgePort` for storing findings in palace
- `SkillStorePort` for idempotent skill persistence

---

## Error Behavior

- Search failure → logs error, returns empty results
- Knowledge store failure → logs error, continues
- Duplicate skill slug → skip (idempotent)

---

## Known Quirks & Edge Cases

- Self-improvement loop: after novel tasks, writes `skills/<slug>.json`
- Skills track `usageCount` and `successRate`
- Same slug = skip (no duplicate skills)
- Knowledge stored with tags for semantic retrieval

---

## Port & Pricing

- **Port:** 4002
- **Cost:** 8 tokens/task

---

*Auto-generated from `agents/core/librarian.ts` — do not edit manually.*
