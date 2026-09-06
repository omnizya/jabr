# AGENTS.md — TARIQ (FIXER)

---

## Role

Fixer — bug fixes, code generation, mechanical implementation

---

## Protocol

A2A HTTP JSON-RPC.

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `LlmPort` (optional) — LLM-first architecture with keyword fallback
- `TaskStorePort` for state management
- `SkillStorePort` for skill persistence

---

## Error Behavior

- LLM generation failure → logs error, falls back to keyword matcher
- Empty LLM response → falls back to keyword matcher
- No LLM configured → keyword matcher only

---

## Known Quirks & Edge Cases

- LLM-first, deterministic-fallback architecture
- Fix protocol: Reproduce → Locate → Fix → Verify
- Includes artifact generation (e.g., fibonacci.ts code artifact)
- Most expensive non-steward agent (20 tokens)
- Code-first communication: code blocks lead, explanations follow

---

## Port & Pricing

- **Port:** 4005
- **Cost:** 20 tokens/task

---

*Auto-generated from `agents/core/fixer.ts` — do not edit manually.*
