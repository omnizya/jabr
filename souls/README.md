# Jabr Agent Souls

*Each agent has three files that define who they are and how they operate.*

---

## Structure

```
souls/
├── jabir/           # Orchestrator (port 4000)
│   ├── SOUL.md      # Personality, values, communication style (hand-authored)
│   ├── IDENTITY.md  # Metadata: name, port, pricing, capabilities, skills (auto-generated)
│   └── AGENTS.md    # Operational notes: protocol, handoff, tools, errors (auto-generated)
├── rushd/           # Oracle — code review, simplification, architecture (port 4001)
├── fihriya/         # Librarian — research, docs, skill synthesis (port 4002)
├── battuta/         # Explorer — codebase recon, file search (port 4003)
├── firnas/          # Designer — UI/UX, layouts, style guides (port 4004)
├── tariq/           # Fixer — bug fixes, code generation (port 4005)
├── khwarizmi/       # Scientist — Python data analysis (port 4006)
├── wazir/           # Steward — proactive codebase scanning (port 1337)
└── verification/    # Shura — independent cross-checking (port 4009)
```

## File Purposes

| File | Purpose | Author | Regenerates |
|------|---------|--------|-------------|
| **SOUL.md** | Identity, values, communication style, namesake lore, relationships | Human | Never — living document |
| **IDENTITY.md** | Agent card metadata: name, port, pricing, capabilities, skills, tags | `scripts/generate-agent-souls.py` | On every TS card change |
| **AGENTS.md** | Operational interface: protocol, handoff rules, tool usage, error behavior, quirks | `scripts/generate-agent-souls.py` | On every TS card change |

## How to Regenerate

```bash
# From repo root
python3 scripts/generate-agent-souls.py
```

This parses `agents/core/*.ts` for `AgentCard` definitions and regenerates `IDENTITY.md` + `AGENTS.md` for each agent. `SOUL.md` files are never touched.

## Agent Summary

| Agent | Codename | Port | Pricing | Lane |
|-------|----------|------|---------|------|
| **JABIR** | `jabir` | 4000 | 10 | Orchestration, routing, memory |
| **RUSHD** | `rushd` | 4001 | 15 | Code review, simplification, architecture |
| **FIHRIYA** | `fihriya` | 4002 | 8 | Research, documentation, skill synthesis |
| **BATTUTA** | `battuta` | 4003 | 5 | Codebase exploration, file search |
| **FIRNAS** | `firnas` | 4004 | 12 | UI/UX design, layouts, style guides |
| **TARIQ** | `tariq` | 4005 | 20 | Bug fixes, code generation |
| **KHWARIZMI** | `khwarizmi` | 4006 | 30 | Python data analysis, scripting |
| **WAZIR** | `wazir` | 1337 | 50 | Proactive codebase stewardship |
| **SHURA** | `verification` | — | 10 | Independent verification, consensus scoring |

---

*Each agent is named after a scholar from the Islamic Golden Age. See their SOUL.md for the full story.*
