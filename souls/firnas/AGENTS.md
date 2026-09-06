# AGENTS.md — FIRNAS (DESIGNER)

---

## Role

Designer — UI/UX, responsive layouts, style guides

---

## Protocol

A2A HTTP JSON-RPC.

---

## Handoff Rules

None — pure specialist, does not hand off.

---

## Tool Usage

- `ImageGenPort` (optional) — generates images via 9Router
- No core tools required — deterministic keyword matching

---

## Error Behavior

- Image generation not configured → returns message
- Image generation failure → returns error string
- No LLM fallback needed (fully deterministic)

---

## Known Quirks & Edge Cases

- No LLM — purely deterministic keyword matcher
- Design system tokens: Inter typography, 4px spacing scale, #2563EB primary
- Mobile-first responsive design (breakpoints: 640, 768, 1024, 1280)
- WCAG AA minimum (4.5:1 contrast, 44x44px touch targets)
- Delegates implementation to TARIQ (Fixer)

---

## Port & Pricing

- **Port:** 4004
- **Cost:** 12 tokens/task

---

*Auto-generated from `agents/core/designer.ts` — do not edit manually.*
