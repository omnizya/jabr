# AGENTS.md — SHURA (VERIFICATION)

---

## Role

Verification — independent cross-checking, consensus scoring, contested result detection

---

## Protocol

A2A HTTP JSON-RPC.

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `LlmPort` (optional) for consensus scoring via `CognitiveLoop`
- `TaskStorePort` for state management
- `SkillStorePort` for saving verification results

---

## Error Behavior

- Insufficient agents (< minAgents) → returns contested result with explanation
- LLM evaluation failure → sets task state to `failed`
- Invalid JSON input → returns help message with expected payload format

---

## Known Quirks & Edge Cases

- Wraps `CognitiveLoop` with configurable consensus threshold
- Default threshold: 0.7, minimum agents: 2
- Saves skill record for high-confidence verifications
- Port 4009 assigned but not started in dev.sh
- Inputs are JSON payload with `task` and `inputs[]` (agentName, card, response)
- `contested: true` when no agent meets consensus threshold

---

## Port & Pricing

- **Port:** 4009
- **Cost:** 10 tokens/task

---

*Auto-generated from `agents/core/verification.ts` — do not edit manually.*
