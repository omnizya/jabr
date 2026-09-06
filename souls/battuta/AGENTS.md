# AGENTS.md — BATTUTA (EXPLORER)

---

## Role

Explorer — codebase recon, file search, structure mapping

---

## Protocol

A2A HTTP JSON-RPC.

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `McpToolPort` for:
  - `pack_repository` — generates AI-friendly repomix output
  - `grep_repomix_output` — regex search on packed code
  - `read_repomix_output` — read packed code (truncated at 50k chars)
- Falls back to keyword matching when MCP tools unavailable

---

## Error Behavior

- MCP tool failure → returns error message with tip to run prerequisite
- Empty search pattern → returns example usage
- Missing packed output → suggests running 'pack codebase' first

---

## Known Quirks & Edge Cases

- Cheapest agent (5 tokens) — exploration should be cheap
- Visual-first communication (ASCII trees, directory maps)
- Repomix pipeline is the standard way to give AI full codebase context
- No LLM — purely deterministic keyword matching + MCP tools

---

## Port & Pricing

- **Port:** 4003
- **Cost:** 5 tokens/task

---

*Auto-generated from `agents/core/explorer.ts` — do not edit manually.*
