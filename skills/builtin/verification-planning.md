---
name: verification-planning
description: Design project-specific evidence paths before non-trivial implementation
version: 1.0.0
metadata:
  tags: [orchestrator, planning, quality]
  assigned_to: orchestrator
---

# Verification Planning

## When to Use

- Before implementing a feature, bug fix, or refactor
- When the correct test strategy is unclear
- When integration scope crosses module boundaries

## Procedure

1. Identify the observable success criteria from the request
2. Choose the minimum verification that produces meaningful evidence
3. Start with the narrowest relevant validation
4. Broaden only when integration scope or risk justifies it
5. Define verification as concrete commands (e.g., `bun run tsc --noEmit`)

## Pitfalls

- Don't run project-wide checks by habit — verify what changed
- Don't treat verification as a fixed checklist — match it to the risk
- Don't verify too late — plan verification before implementation

## Verification

- Each planned verification step has a concrete command
- Verification scope matches change scope (not bigger, not smaller)
- At least one integration-level check if the change crosses boundaries
