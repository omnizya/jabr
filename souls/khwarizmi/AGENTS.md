# AGENTS.md — KHWARIZMI (SCIENTIST)

---

## Role

Scientist — Python data analysis, technical scripting

---

## Protocol

A2A HTTP JSON-RPC. `streaming: false`.

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `McpToolPort` for `run_python` execution via `uv run`
- Scripts written to `.python_env/main.py`, 10s timeout

---

## Error Behavior

- Python execution failure → returns error message
- MCP tool unavailable → provides script for manual execution

---

## Known Quirks & Edge Cases

- Not in `bun run dev` — start with `bun agents/run/scientist.ts`
- Uses `["a2a" as any]` cast (known TODO in core/AGENTS.md)
- Most expensive agent (30 tokens) — computation is costly
- Data-first communication: numbers lead, interpretation follows
- Reproducibility principle: same data + same script = same result

---

## Port & Pricing

- **Port:** 4006
- **Cost:** 30 tokens/task

---

*Auto-generated from `agents/core/scientist.ts` — do not edit manually.*
