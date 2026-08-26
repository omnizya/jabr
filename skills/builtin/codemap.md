---
name: codemap
description: Generate hierarchical codemaps for unfamiliar repositories
version: 1.0.0
metadata:
  tags: [explorer, onboarding, documentation]
  assigned_to: explorer
---

# Codemap

## When to Use

- First encounter with an unfamiliar codebase
- Need to understand module boundaries and dependencies
- Onboarding a new team member
- Planning a refactor and need the full picture

## Procedure

1. Start at the root — read package.json, README, entry points
2. Map the directory tree — note conventions (feature folders, layers, etc.)
3. Identify dependency flow — which modules import which
4. Find the composition roots — where wiring happens
5. Note port/adapter boundaries — interfaces vs implementations
6. Produce a hierarchical map with annotations

## Pitfalls

- Don't read every file — focus on exports, imports, and public APIs
- Ignore test files for the map (note their location but don't trace internals)
- Skip generated code and node_modules

## Verification

- Map covers all top-level directories
- Dependency arrows are directional (who imports whom)
- Composition roots are clearly marked
- Port/adapter boundaries are annotated
