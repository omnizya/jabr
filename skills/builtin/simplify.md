---
name: simplify
description: Behavior-preserving code simplification for readability and maintainability
version: 1.0.0
metadata:
  tags: [oracle, code-quality, refactoring]
  assigned_to: oracle
---

# Simplify

## When to Use

- Code is correct but hard to read
- Nested conditionals need flattening
- Duplicated logic appears in multiple places
- Variable names obscure intent
- Functions exceed 30 lines

## Procedure

1. Understand the current behavior — read all callers
2. Identify the complexity source (nesting, duplication, naming)
3. Apply one simplification at a time
4. Verify behavior is unchanged after each step
5. Document what changed and why

## Pitfalls

- Never change behavior while simplifying — that's a refactor, not a simplification
- Don't simplify away debuggability — some explicit code is clearer than clever shorthand
- Stop when further simplification reduces readability

## Verification

- All existing tests pass
- No new branches or conditionals introduced
- Cyclomatic complexity decreased (count `if`/`else`/`for`/`while`)
