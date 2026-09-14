# Souls — Agent Personality System

Each agent in the Kasbah ecosystem has a "soul" — a set of markdown files that define its identity, capabilities, and operational rules.

## Structure

Each agent lives in its own directory under `souls/`:

```
souls/
├── jabir/           # The operator and orchestrator
│   ├── SOUL.md      # Personality, values, communication style
│   ├── IDENTITY.md  # Metadata: name, skills, capabilities, tags
│   └── AGENTS.md    # Operational interface: handoff rules, tools, errors
├── rushd/           # Code review and simplification
├── fihriya/         # Research and documentation
├── battuta/         # Codebase exploration
├── firnas/          # Design and architecture
├── tariq/           # Bug fixes and implementation
├── khwarizmi/       # Data analysis and science
├── verification/    # SHURA — consensus and verification
└── README.md        # This file
```

## The Mirror Approach

Agent metadata is extracted from TypeScript agent cards into human-readable markdown files. The code is the source of truth; the markdown is the human/agent-readable mirror. A generation script (`scripts/generate-agent-souls.py`) keeps them in sync.

## File Purposes

| File | Purpose | Audience |
|------|---------|----------|
| **SOUL.md** | The being — personality, values, communication style, namesake lore | Humans, other agents |
| **IDENTITY.md** | The metadata — name, skills, capabilities, input/output modes, tags | Orchestrators, discovery |
| **AGENTS.md** | The operational interface — handoff rules, tool usage, error behavior | Parent agents, developers |

## Agent Roster

| Agent | Domain | Namesake | Status |
|-------|--------|----------|--------|
| **JABIR** | Orchestration, routing | *Jabr* (restoration) | ✅ Complete |
| **RUSHD** | Code review, simplification | Ibn Rushd (Averroes) | ✅ Soul written |
| **FIHRIYA** | Research, documentation | Fatima al-Fihriya | ✅ Soul written |
| **BATTUTA** | Codebase exploration | Ibn Battuta | ✅ Soul written |
| **FIRNAS** | Design, architecture | Abbas ibn Firnas | ✅ Soul written |
| **TARIQ** | Bug fixes, implementation | Tariq ibn Ziyad | ✅ Soul written |
| **KHWARIZMI** | Data analysis, science | Al-Khwarizmi | ✅ Soul written |
| **SHURA** | Verification, consensus | *Shura* (consultation) | ✅ Complete |

## Adding a New Agent

1. Create `souls/<name>/` directory
2. Write `SOUL.md` — personality, values, communication style
3. Run `python3 scripts/generate-agent-souls.py` to auto-generate `IDENTITY.md` and `AGENTS.md`
4. Hand-author `AGENTS.md` with specific operational rules
5. Register the agent in the orchestrator's agent registry
