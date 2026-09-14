#!/usr/bin/env python3
"""
generate-agent-souls.py — Generate IDENTITY.md and AGENTS.md for each Jabr agent
by parsing their TypeScript AgentCard definitions from agents/core/.

Outputs:
  souls/<slug>/IDENTITY.md  — metadata: name, port, pricing, capabilities, skills, tags
  souls/<slug>/AGENTS.md    — operational notes: protocol, handoff, tools, errors, quirks

SOUL.md is NOT generated (hand-authored). Run from repo root.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path.cwd()
CORE_DIR = REPO / "agents" / "core"
SOULS_DIR = REPO / "souls"

# Port mapping: codename -> port
PORT_MAP = {
    "jabir": 4000,
    "orchestrator": 4000,
    "rushd": 4001,
    "oracle": 4001,
    "fihriya": 4002,
    "librarian": 4002,
    "battuta": 4003,
    "explorer": 4003,
    "firnas": 4004,
    "designer": 4004,
    "tariq": 4005,
    "fixer": 4005,
    "khwarizmi": 4006,
    "scientist": 4006,
    "wazir": 1337,
    "jarvis": 1337,
    "shura": 4009,
    "verification": 4009,
}

# Codename -> slug (directory name). The TS const name often differs from the agent's
# canonical slug (e.g., DESIGNER_CARD defines FIRNAS, whose slug is "firnas").
# This maps the parsed codename to the correct souls/<slug>/ directory.
# Also handles inline class cards (scientist.ts has no X_CARD const).
CODENAME_TO_SLUG = {
    "jabir": "jabir",
    "orchestrator": "jabir",
    "rushd": "rushd",
    "oracle": "rushd",
    "fihriya": "fihriya",
    "librarian": "fihriya",
    "battuta": "battuta",
    "explorer": "battuta",
    "firnas": "firnas",
    "designer": "firnas",
    "tariq": "tariq",
    "fixer": "tariq",
    "khwarizmi": "khwarizmi",
    "scientist": "khwarizmi",
    "wazir": "wazir",
    "jarvis": "wazir",
    "shura": "verification",
    "verification": "verification",
}

# Operational notes per agent (not derivable from the card alone)
OPERATIONAL: dict[str, dict] = {
    "jabir": {
        "role": "Orchestrator — routes tasks, persists memory, self-improves, consensus engine",
        "protocol": "A2A v1.0 HTTP JSON-RPC + SSE. POST to `/` (root path ONLY) with method `SendMessage` (or `SendStreamingMessage` over SSE). Synchronous: server awaits handler and returns result in response. Agent card served at `/.well-known/agent-card.json`.",
        "handoff": (
            "- Honors `%%HANDOVER%%` from oracle via `forcedAgentName` (bypasses registry)\n"
            "- `MAX_HANDOVER_DEPTH = 3` — after 3 hops, completes with available result\n"
            "- Knowledge augmentation only at depth 0\n"
            "- Budget deduction per agent pricing before delegation\n"
            "- ACL enforcement: caller's `allowedAgents` checked before routing"
        ),
        "tools": (
            "- `ToolRouter` for all routing/delegation/consensus\n"
            "- `DynamicRegistry.matchAgent(text)` — tag-scored routing: +3 exact tag match, +1 substring match, +1 word overlap\n"
            "- `KnowledgePort` for palace augmentation\n"
            "- `BudgetPort` for per-agent token tracking\n"
            "- `KanbanPort` for syncing completed tasks"
        ),
        "errors": (
            "- On routing failure: emits `task_failed` event, sets task state to `failed`\n"
            "- Timeout failures are retryable; cancellations are not\n"
            "- Palace query errors logged but don't fail the task\n"
            "- Agent URL lookup failures throw (task fails)"
        ),
        "quirks": (
            "- Only agent that uses ToolRouter (others are pure specialists)\n"
            "- Handover chain creates child tasks linked via `referenceTaskIds`\n"
            "- Emits realtime lifecycle events (created → progress → completed/failed)\n"
            "- Memory append-only via `MemoryStorePort`"
        ),
    },
    "rushd": {
        "role": "Oracle — code review, simplification, architecture",
        "protocol": "A2A HTTP JSON-RPC. Agent card served at `/.well-known/agent-card.json`.",
        "handoff": (
            "- Only agent authorized to emit `%%HANDOVER%%`\n"
            "- `VALID_TRANSFER_TARGETS`: fixer, librarian, explorer, designer, scientist, jarvis\n"
            "- Cannot hand over to itself\n"
            "- Uses `LlmPort` for routing judge (LLM-assisted)\n"
            "- Falls back to keyword matcher if LLM unavailable"
        ),
        "tools": (
            "- `LlmPort` for routing decision (temperature: `RESEARCH_TEMPERATURE`)\n"
            "- `TaskStorePort` for state management\n"
            "- `SkillStorePort` for skill persistence"
        ),
        "errors": (
            "- Routing decision failure → answers directly (no throw)\n"
            "- Invalid handover target from LLM → warns and answers directly\n"
            "- No LLM configured → keyword matcher only"
        ),
        "quirks": (
            "- Socratic communication style — asks questions before answering\n"
            "- Reviews: Correctness → Patterns → Maintainability → Testing → Suggestions\n"
            "- `securitySchemes` and `securityRequirements` present but empty (not yet implemented)"
        ),
    },
    "fihriya": {
        "role": "Librarian — web search, docs, skill synthesis",
        "protocol": "A2A HTTP JSON-RPC.",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `SearchPort` for external research\n"
            "- `KnowledgePort` for storing findings in palace\n"
            "- `SkillStorePort` for idempotent skill persistence"
        ),
        "errors": (
            "- Search failure → logs error, returns empty results\n"
            "- Knowledge store failure → logs error, continues\n"
            "- Duplicate skill slug → skip (idempotent)"
        ),
        "quirks": (
            "- Self-improvement loop: after novel tasks, writes `skills/<slug>.json`\n"
            "- Skills track `usageCount` and `successRate`\n"
            "- Same slug = skip (no duplicate skills)\n"
            "- Knowledge stored with tags for semantic retrieval"
        ),
    },
    "battuta": {
        "role": "Explorer — codebase recon, file search, structure mapping",
        "protocol": "A2A HTTP JSON-RPC.",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `McpToolPort` for:\n"
            "  - `pack_repository` — generates AI-friendly repomix output\n"
            "  - `grep_repomix_output` — regex search on packed code\n"
            "  - `read_repomix_output` — read packed code (truncated at 50k chars)\n"
            "- Falls back to keyword matching when MCP tools unavailable"
        ),
        "errors": (
            "- MCP tool failure → returns error message with tip to run prerequisite\n"
            "- Empty search pattern → returns example usage\n"
            "- Missing packed output → suggests running 'pack codebase' first"
        ),
        "quirks": (
            "- Cheapest agent (5 tokens) — exploration should be cheap\n"
            "- Visual-first communication (ASCII trees, directory maps)\n"
            "- Repomix pipeline is the standard way to give AI full codebase context\n"
            "- No LLM — purely deterministic keyword matching + MCP tools"
        ),
    },
    "firnas": {
        "role": "Designer — UI/UX, responsive layouts, style guides",
        "protocol": "A2A HTTP JSON-RPC.",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `ImageGenPort` (optional) — generates images via 9Router\n"
            "- No core tools required — deterministic keyword matching"
        ),
        "errors": (
            "- Image generation not configured → returns message\n"
            "- Image generation failure → returns error string\n"
            "- No LLM fallback needed (fully deterministic)"
        ),
        "quirks": (
            "- No LLM — purely deterministic keyword matcher\n"
            "- Design system tokens: Inter typography, 4px spacing scale, #2563EB primary\n"
            "- Mobile-first responsive design (breakpoints: 640, 768, 1024, 1280)\n"
            "- WCAG AA minimum (4.5:1 contrast, 44x44px touch targets)\n"
            "- Delegates implementation to TARIQ (Fixer)"
        ),
    },
    "tariq": {
        "role": "Fixer — bug fixes, code generation, mechanical implementation",
        "protocol": "A2A HTTP JSON-RPC.",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `LlmPort` (optional) — LLM-first architecture with keyword fallback\n"
            "- `TaskStorePort` for state management\n"
            "- `SkillStorePort` for skill persistence"
        ),
        "errors": (
            "- LLM generation failure → logs error, falls back to keyword matcher\n"
            "- Empty LLM response → falls back to keyword matcher\n"
            "- No LLM configured → keyword matcher only"
        ),
        "quirks": (
            "- LLM-first, deterministic-fallback architecture\n"
            "- Fix protocol: Reproduce → Locate → Fix → Verify\n"
            "- Includes artifact generation (e.g., fibonacci.ts code artifact)\n"
            "- Most expensive non-steward agent (20 tokens)\n"
            "- Code-first communication: code blocks lead, explanations follow"
        ),
    },
    "khwarizmi": {
        "role": "Scientist — Python data analysis, technical scripting",
        "protocol": "A2A HTTP JSON-RPC. `streaming: false`.",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `McpToolPort` for `run_python` execution via `uv run`\n"
            "- Scripts written to `.python_env/main.py`, 10s timeout"
        ),
        "errors": (
            "- Python execution failure → returns error message\n"
            "- MCP tool unavailable → provides script for manual execution"
        ),
        "quirks": (
            "- Not in `bun run dev` — start with `bun agents/run/scientist.ts`\n"
            "- Uses `[\"a2a\" as any]` cast (known TODO in core/AGENTS.md)\n"
            "- Most expensive agent (30 tokens) — computation is costly\n"
            "- Data-first communication: numbers lead, interpretation follows\n"
            "- Reproducibility principle: same data + same script = same result"
        ),
    },
    "wazir": {
        "role": "Steward — proactive codebase scanning, dependency watch, test gap analysis",
        "protocol": "A2A HTTP JSON-RPC. Port 1337 (outside standard 4000-4006 range).",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `LlmPort` for scan analysis (5 parallel LLM calls in full steward)\n"
            "- `SearchPort` for external research\n"
            "- `McpToolPort` for `read_file` (package.json inspection)\n"
            "- `SkillStorePort` for profile persistence\n"
            "- `KnowledgePort` (optional) for storing findings\n"
            "- `BudgetPort` (optional) for token tracking\n"
            "- `KanbanPort` (optional) for syncing findings as tasks"
        ),
        "errors": (
            "- LLM scan failure per scan type → logs error, continues other scans\n"
            "- `read_file` failure → logs error, returns empty dependency report\n"
            "- JSON parse failure → logs error, skips dependency comparison"
        ),
        "quirks": (
            "- Port 1337 (leet) — lives closest to infrastructure\n"
            "- Most expensive agent (50 tokens) — comprehensive stewardship is costly\n"
            "- Only proactive agent — others are reactive\n"
            "- Five scan types: codebase, dependencies, test gaps, doc sync, AI opportunities\n"
            "- Severity levels: info → warn → critical\n"
            "- Syncs findings to Hermes kanban as tasks\n"
            "- Most complex constructor (8 parameters)"
        ),
    },
    "verification": {
        "role": "Verification — independent cross-checking, consensus scoring, contested result detection",
        "protocol": "A2A HTTP JSON-RPC.",
        "handoff": "None — pure specialist, does not hand off.",
        "tools": (
            "- `LlmPort` (optional) for consensus scoring via `CognitiveLoop`\n"
            "- `TaskStorePort` for state management\n"
            "- `SkillStorePort` for saving verification results"
        ),
        "errors": (
            "- Insufficient agents (< minAgents) → returns contested result with explanation\n"
            "- LLM evaluation failure → sets task state to `failed`\n"
            "- Invalid JSON input → returns help message with expected payload format"
        ),
        "quirks": (
            "- Wraps `CognitiveLoop` with configurable consensus threshold\n"
            "- Default threshold: 0.7, minimum agents: 2\n"
            "- Saves skill record for high-confidence verifications\n"
            "- Port 4009 assigned but not started in dev.sh\n"
            "- Inputs are JSON payload with `task` and `inputs[]` (agentName, card, response)\n"
            "- `contested: true` when no agent meets consensus threshold"
        ),
    },
}

# ---------------------------------------------------------------------------
# TypeScript card parser (brace-matching for nested objects)
# ---------------------------------------------------------------------------

CARD_START_RE = re.compile(
    r"export\s+const\s+(\w+)_CARD\s*:\s*AgentCard\s*=\s*\{",
    re.MULTILINE,
)

INLINE_CARD_RE = re.compile(
    r"public\s+readonly\s+card\s*:\s*AgentCard\s*=\s*\{",
    re.MULTILINE,
)


def find_cards(content: str) -> list[tuple[str, str]]:
    """Find all AgentCard definitions using brace matching."""
    cards = []
    for m in CARD_START_RE.finditer(content):
        const_name = m.group(1)
        start = m.end() - 1  # position of the opening {
        depth = 0
        for i in range(start, len(content)):
            if content[i] == "{":
                depth += 1
            elif content[i] == "}":
                depth -= 1
                if depth == 0:
                    card_text = content[start:i + 1]
                    cards.append((const_name, card_text))
                    break

    # Also find inline card definitions (e.g., scientist.ts)
    for m in INLINE_CARD_RE.finditer(content):
        start = m.end() - 1  # position of the opening {
        depth = 0
        for i in range(start, len(content)):
            if content[i] == "{":
                depth += 1
            elif content[i] == "}":
                depth -= 1
                if depth == 0:
                    card_text = content[start:i + 1]
                    # Extract class name — look backwards from the card for "class XxxAgent"
                    preceding = content[:m.start()]
                    class_match = re.search(r"class\s+(\w+Agent)\s*{", preceding)
                    if class_match:
                        class_name = class_match.group(1)
                        codename = class_name.lower().replace("agent", "")
                    else:
                        codename = "inline"
                    codename = codename.upper()
                    cards.append((codename, card_text))
                    break

    return cards


def extract_string(text: str, key: str) -> str:
    """Extract a string value for a given key from a TS object."""
    pattern = rf'{key}\s*:\s*["\']([^"\']+)["\']'
    m = re.search(pattern, text)
    return m.group(1) if m else ""


def extract_bool(text: str, key: str) -> bool | None:
    pattern = rf"{key}\s*:\s*(true|false)"
    m = re.search(pattern, text)
    return m.group(1) == "true" if m else None


def extract_number(text: str, key: str) -> int | None:
    pattern = rf"{key}\s*:\s*(\d+)"
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


def extract_capabilities(text: str) -> dict:
    """Extract the capabilities object."""
    match = re.search(r"capabilities\s*:\s*\{([^}]+)\}", text)
    if not match:
        return {}
    cap_text = match.group(1)
    result = {}
    for key in ("streaming", "pushNotifications", "stateTransitionHistory"):
        val = extract_bool(cap_text, key)
        if val is not None:
            result[key] = val
    return result


def extract_skills(text: str) -> list[dict]:
    """Extract the skills array — handles nested objects with tags arrays."""
    skills = []
    match = re.search(r"skills\s*:\s*\[([\s\S]*?)\]\s*,?\s*(?:pricing|$)", text)
    if not match:
        return skills

    skills_text = match.group(1)

    # Find each skill object by brace matching
    i = 0
    while i < len(skills_text):
        # Find next opening brace
        brace_pos = skills_text.find("{", i)
        if brace_pos == -1:
            break
        # Find matching closing brace
        depth = 0
        end_pos = brace_pos
        for j in range(brace_pos, len(skills_text)):
            if skills_text[j] == "{":
                depth += 1
            elif skills_text[j] == "}":
                depth -= 1
                if depth == 0:
                    end_pos = j
                    break

        skill_text = skills_text[brace_pos:end_pos + 1]

        name = extract_string(skill_text, "name")
        desc = extract_string(skill_text, "description")

        # Extract tags array
        tags = []
        tags_match = re.search(r"tags\s*:\s*\[([^\]]+)\]", skill_text)
        if tags_match:
            tags = [t.strip().strip('"').strip("'") for t in tags_match.group(1).split(",") if t.strip()]

        # Extract inputModes
        input_modes = []
        im_match = re.search(r"inputModes\s*:\s*\[([^\]]+)\]", skill_text)
        if im_match:
            input_modes = [m.strip().strip('"').strip("'") for m in im_match.group(1).split(",") if m.strip()]

        # Extract outputModes
        output_modes = []
        om_match = re.search(r"outputModes\s*:\s*\[([^\]]+)\]", skill_text)
        if om_match:
            output_modes = [m.strip().strip('"').strip("'") for m in om_match.group(1).split(",") if m.strip()]

        if name:
            skills.append({
                "name": name,
                "description": desc,
                "tags": tags,
                "inputModes": input_modes,
                "outputModes": output_modes,
            })

        i = end_pos + 1

    return skills


def extract_card_fields(card_text: str, const_name: str) -> dict:
    """Extract all relevant fields from an AgentCard definition."""
    name = extract_string(card_text, "name")
    description = extract_string(card_text, "description")
    url = extract_string(card_text, "url")
    version = extract_string(card_text, "version")
    capabilities = extract_capabilities(card_text)
    skills = extract_skills(card_text)
    cost_per_task = extract_number(card_text, "costPerTask")

    # Infer codename from const name (e.g., ORACLE_CARD -> oracle)
    codename = const_name.replace("_CARD", "").lower()

    # Get port from mapping
    port = PORT_MAP.get(codename, 0)

    # Collect all tags from skills
    all_tags = []
    for skill in skills:
        for tag in skill.get("tags", []):
            if tag not in all_tags:
                all_tags.append(tag)

    return {
        "codename": codename,
        "display_name": name,
        "description": description,
        "url": url,
        "version": version,
        "port": port,
        "capabilities": capabilities,
        "skills": skills,
        "pricing": {"costPerTask": cost_per_task},
        "tags": all_tags,
    }


# ---------------------------------------------------------------------------
# Markdown generators
# ---------------------------------------------------------------------------

def generate_identity(data: dict) -> str:
    caps = data["capabilities"]
    skills_md = ""
    for skill in data["skills"]:
        tags_str = ", ".join(f"`{t}`" for t in skill["tags"])
        in_modes = ", ".join(skill.get("inputModes", []))
        out_modes = ", ".join(skill.get("outputModes", []))
        skills_md += (
            f"### {skill['name']}\n\n"
            f"{skill['description']}\n\n"
            f"- **Tags:** {tags_str}\n"
            f"- **Input:** {in_modes}\n"
            f"- **Output:** {out_modes}\n\n"
        )

    if not skills_md:
        skills_md = "_No skills defined._\n"

    caps_md = "\n".join(
        f"- **{k}:** {'✅' if v else '❌'}"
        for k, v in caps.items()
    )

    tags_str = ", ".join(f'`{t}`' for t in data["tags"]) if data["tags"] else "_No tags._"

    return f"""# IDENTITY.md — {data['display_name']} ({data['codename'].upper()})

---

## Metadata

| Field | Value |
|-------|-------|
| **Codename** | `{data['codename']}` |
| **Display Name** | {data['display_name']} |
| **Port** | {data['port']} |
| **Version** | {data['version']} |
| **Pricing** | {data['pricing']['costPerTask']} tokens/task |

---

## Description

{data['description']}

---

## Capabilities

{caps_md}

---

## Skills

{skills_md}---

## Tags

{tags_str}

---

*Auto-generated from `agents/core/{data['codename']}.ts` — do not edit manually.*
"""


def generate_agents(data: dict, op: dict) -> str:
    display = data['display_name']
    codename = data['codename'].upper()

    return f"""# AGENTS.md — {display} ({codename})

---

## Role

{op['role']}

---

## Protocol

{op['protocol']}

---

## Handoff Rules

{op['handoff']}

---

## Tool Usage

{op['tools']}

---

## Error Behavior

{op['errors']}

---

## Known Quirks & Edge Cases

{op['quirks']}

---

## Port & Pricing

- **Port:** {data['port']}
- **Cost:** {data['pricing']['costPerTask']} tokens/task

---

*Auto-generated from `agents/core/{data['codename']}.ts` — do not edit manually.*
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not CORE_DIR.exists():
        print(f"ERROR: {CORE_DIR} not found. Run from repo root.", file=sys.stderr)
        sys.exit(1)

    SOULS_DIR.mkdir(exist_ok=True)

    # Scan all core TS files for agent card definitions
    agents_found: dict[str, dict] = {}

    for ts_file in sorted(CORE_DIR.glob("*.ts")):
        # Skip dead code: rushd.ts is not imported anywhere (oracle.ts is the active oracle)
        if ts_file.stem == "rushd":
            continue
        content = ts_file.read_text()
        cards = find_cards(content)
        for const_name, card_text in cards:
            data = extract_card_fields(card_text, const_name)

            # Skip aliases: ORCHESTRATOR_CARD = JABIR_CARD in jabir.ts
            # ORACLE_CARD in oracle.ts is the canonical definition (rushd.ts is dead code, skipped above)
            if const_name == "ORCHESTRATOR":
                continue

            # Deduplicate by codename
            if data["codename"] in agents_found:
                continue

            agents_found[data["codename"]] = data
            print(f"  Parsed: {data['codename']} ({data['display_name']}) from {ts_file.name}")

    # Generate IDENTITY.md and AGENTS.md for each agent
    generated = 0
    slugs_found: set[str] = set()

    for codename, data in agents_found.items():
        # Map codename to canonical slug (e.g., "designer" -> "firnas")
        slug = CODENAME_TO_SLUG.get(codename, codename)
        slugs_found.add(slug)

        agent_dir = SOULS_DIR / slug
        agent_dir.mkdir(exist_ok=True)

        identity_path = agent_dir / "IDENTITY.md"
        identity_md = generate_identity(data)
        identity_path.write_text(identity_md)
        print(f"  Generated: {identity_path}")

        # Get operational notes (fallback to empty if not defined)
        op = OPERATIONAL.get(slug, {
            "role": f"Specialist agent — {data['display_name']}",
            "protocol": "A2A HTTP JSON-RPC.",
            "handoff": "None — pure specialist.",
            "tools": "No external tools required.",
            "errors": "Catches errors and returns graceful fallbacks.",
            "quirks": "No special notes.",
        })

        agents_path = agent_dir / "AGENTS.md"
        agents_md = generate_agents(data, op)
        agents_path.write_text(agents_md)
        print(f"  Generated: {agents_path}")

        generated += 1

    # Clean up stale directories (slugs that no longer have a corresponding agent)
    for stale_dir in SOULS_DIR.iterdir():
        if stale_dir.is_dir() and stale_dir.name not in slugs_found:
            # Don't delete if it has a hand-authored SOUL.md — warn instead
            soul_path = stale_dir / "SOUL.md"
            if soul_path.exists():
                print(f"  WARNING: Stale dir '{stale_dir.name}' has SOUL.md — manual review needed")
            else:
                import shutil
                shutil.rmtree(stale_dir)
                print(f"  Removed stale dir: {stale_dir.name}")

    print(f"\nDone. Generated IDENTITY.md + AGENTS.md for {generated} agents.")
    print("SOUL.md files are hand-authored — edit them manually.")


if __name__ == "__main__":
    main()
