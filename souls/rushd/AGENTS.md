# AGENTS.md — RUSHD (ORACLE)

---

## Role

Oracle — code review, simplification, architecture

---

## Protocol

A2A HTTP JSON-RPC. Agent card served at `/.well-known/agent-card.json`.

---

## Handoff Rules

- Only agent authorized to emit `%%HANDOVER%%`
- `VALID_TRANSFER_TARGETS`: fixer, librarian, explorer, designer, scientist, jarvis
- Cannot hand over to itself
- Uses `LlmPort` for routing judge (LLM-assisted)
- Falls back to keyword matcher if LLM unavailable

---

## Tool Usage

- `LlmPort` for routing decision (temperature: `RESEARCH_TEMPERATURE`)
- `TaskStorePort` for state management
- `SkillStorePort` for skill persistence

---

## Error Behavior

- Routing decision failure → answers directly (no throw)
- Invalid handover target from LLM → warns and answers directly
- No LLM configured → keyword matcher only

---

## Known Quirks & Edge Cases

- Socratic communication style — asks questions before answering
- Reviews: Correctness → Patterns → Maintainability → Testing → Suggestions
- `securitySchemes` and `securityRequirements` present but empty (not yet implemented)

---

## Port & Pricing

- **Port:** 4001
- **Cost:** 15 tokens/task

---

*Auto-generated from `agents/core/oracle.ts` — do not edit manually.*
