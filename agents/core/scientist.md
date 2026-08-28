# Scientist Agent

## Role
Data-science specialist that writes and executes Python scripts to analyze data and automate technical tasks. The only specialist that actually runs code — via the MCP `run_python` tool.

## Seed key / port / protocol
- Seed key: `scientist`
- Port: **4006**
- Protocol: A2A (HTTP JSON-RPC, `tasks/send` to root path)
- Note: NOT started by `bun run dev`; launch with `bun agents/run/scientist.ts`.

## Card & skills
Unlike the other agents, Scientist defines its card inline as a `public readonly card: AgentCard` (not a module-level `X_CARD` const) and sets `url: "http://localhost:4006"`. Skills:
- **Data Analysis** — tags: `python`, `data`, `analysis`, `script`, `scientist`, `stats`, `csv`, `json`
- **Technical Scripting** — tags: `automation`, `scripting`, `python`, `utility`

## Behavior
Lightweight keyword matcher that delegates execution to an LLM-free subprocess. `handleTask(text)` (note: NOT named `executeTask`) checks `text.toLowerCase().includes("python" | "analyze")`:
- match → builds a Python snippet string, calls `mcpTools.callTool("run_python", { code })` (persistent `.python_env/` via `uv run`), and returns the tool's `content` wrapped in a result block
- on error → returns a failure string
- fallback → "I can help with Python scripts and data analysis…" prompt

**Important deviation from the standard structure:** Scientist has NO `execute(taskId, userText)` method and NO `get card()` getter — the card is a `public readonly` field and dispatch is via `handleTask`. Any composition root wiring Scientist must adapt it to the standard `execute`/`updateState`/`appendMessage` contract (the other agents all implement it).

## Conventions
- Card: `public readonly card: AgentCard` (inline, with `url` populated)
- Constructor DI: `constructor(private mcpTools: McpToolPort)` — only the MCP tool port
- Dispatch method is `handleTask(text): Promise<string>` (returns raw string, not `{text, artifact?}`)

**Ports depended on:** `McpToolPort` only (used to call `run_python`).

## Handover note
Handover (`%%HANDOVER%%`) is DORMANT by design for rule-based specialists. Do NOT add handover rules to Scientist. Only jarvis (LLM-driven) is a candidate if handover is ever needed.
