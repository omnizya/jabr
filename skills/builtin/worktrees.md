---
name: worktrees
description: Manage Git worktrees for isolated parallel coding lanes
version: 1.0.0
metadata:
  tags: [orchestrator, git, isolation]
  assigned_to: orchestrator
---

# Worktrees

## When to Use

- Parallel work on unrelated features
- Risky experiments that shouldn't pollute the main tree
- Long-running tasks that block other work
- Need to switch context without stashing

## Procedure

1. Create a worktree: `git worktree add .worktrees/branch-name branch-name`
2. Work in the new worktree directory
3. Run tests and typecheck from within the worktree
4. Commit in the worktree
5. Merge back to main: `git merge branch-name`
6. Clean up: `git worktree remove .worktrees/branch-name`

## Pitfalls

- Don't forget to clean up worktrees — they accumulate
- Don't run `bun run dev` in multiple worktrees simultaneously (port conflicts)
- Don't create worktrees for tasks under 10 minutes

## Verification

- `git worktree list` shows only expected worktrees
- Each worktree has its own branch
- No uncommitted changes left in removed worktrees
