---
name: reflect
description: Review repeated work and suggest reusable skills, agents, or workflow improvements
version: 1.0.0
metadata:
  tags: [orchestrator, meta, self-improvement]
  assigned_to: orchestrator
---

# Reflect

## When to Use

- After completing a batch of similar tasks
- When a workflow pattern repeats 3+ times
- When manual steps could be automated
- During periodic project retrospectives

## Procedure

1. Review recent work — what tasks were completed?
2. Identify patterns — same steps, same file edits, same decisions
3. Name the pattern — give it a clear, memorable slug
4. Write the skill — steps, pitfalls, verification criteria
5. Assign the skill — which agent should own it?
6. Save to `skills/` directory

## Pitfalls

- Don't create skills for one-off tasks — only patterns that repeat
- Don't over-abstract — a skill should be actionable, not philosophical
- Don't create skills that duplicate existing ones

## Verification

- Skill has clear "When to Use" section
- Steps are concrete and executable
- At least one pitfall documented
- Verification criteria are testable
