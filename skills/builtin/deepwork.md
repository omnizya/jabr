---
name: deepwork
description: Heavy complex coding sessions with risk-based review gates
version: 1.0.0
metadata:
  tags: [orchestrator, workflow, multi-step]
  assigned_to: orchestrator
---

# Deepwork

## When to Use

- Task touches 5+ files
- Changes span multiple modules or layers
- Risk of breaking existing behavior is high
- Task requires sustained focus (30+ min)

## Procedure

1. **Plan** — Write a short task graph (what changes, in what order, what depends on what)
2. **Slice** — Break into independently verifiable units (each unit = 1 commit)
3. **Execute** — Implement one slice at a time
4. **Verify** — Run typecheck + tests after each slice
5. **Review** — At each gate, ask: "Does this still match the original intent?"
6. **Commit** — One clean commit per slice

## Pitfalls

- Don't skip the plan — it prevents scope creep
- Don't batch verification — catch issues early
- Don't mix unrelated changes in one slice

## Verification

- Each slice compiles and passes tests
- Total change matches the original task graph
- No unrelated changes leaked in
- Commit messages describe what changed, not what was done
