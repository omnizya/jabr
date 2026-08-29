# Jabr — Project Memory

*Jabr (جبر) — Arabic for "restoration of broken parts," the root of algebra.*

## What this is

Experimental multi-agent system testing ACP + A2A + MCP together.
Runtime: **Bun 1.4** (TypeScript) + **uv** (Python tools). No build step — run `.ts` files directly.

## Architecture — Hexagonal (Ports & Adapters)

```
agents/
├── core/              # Domain logic — ZERO infrastructure imports
│   ├── orchestrator.ts   # Routing, delegation, handover, memory
│   ├── cognitive-loop.ts # Consensus scoring + synthesis
│   ├── oracle.ts         # Code review, simplification, architecture
│   ├── fixer.ts          # Bug fixes, code generation, mechanical impl
│   ├── librarian.ts      # Docs, web research, code search
│   ├── explorer.ts       # Fast codebase recon, file search
│   ├── designer.ts       # UI/UX design, responsive layouts
│   └── scientist.ts      # Python data analysis via MCP tools
├── ports/             # Interfaces (import type only)
│   ├── agent-registry.ts
│   ├── task-store.ts
│   ├── memory-store.ts
│   ├── skill-store.ts
│   ├── discovery-port.ts
│   ├── budget-port.ts
│   ├── llm-port.ts
│   ├── search-port.ts
│   ├── knowledge-port.ts
│   ├── image-gen-port.ts
│   ├── mcp-tool-port.ts
│   └── resource-port.ts
├── adapters/          # Concrete implementations
│   ├── http/
│   │   ├── a2a-server.ts   # Bun.serve A2A HTTP server
│   │   └── stdio-bridge.ts # ACP stdio → A2A HTTP proxy
│   ├── a2a-client.ts       # HTTP client implementing AgentRegistryPort
│   ├── dynamic-registry.ts # Tag-scored agent matching
│   ├── headroom.ts         # Per-agent token budget (BudgetPort)
│   ├── llm/openai.ts       # OpenAiLlmAdapter (LlmPort)
│   ├── mem-palace.ts       # KnowledgePort (memory/palace/*.json)
│   ├── memory-fs.ts        # Filesystem MemoryStorePort
│   ├── mcp-client.ts       # Spawns MCP server, raw JSON-RPC over stdio
│   ├── mcp-resources.ts    # jabr:// resources + subscriptions
│   ├── search-9router.ts   # SearchPort via NINEROUTER
│   ├── image-gen-9router.ts# ImageGenPort via NINEROUTER
│   ├── skill-fs.ts         # Filesystem SkillStorePort
│   ├── subscription-manager.ts
│   └── task-memory.ts      # In-memory TaskStorePort
├── types.ts           # Shared TypeScript types
├── utils/
│   └── rpc.ts             # ok/err/corsHeaders JSON-RPC helpers
└── run/               # Composition roots (wire ports → core)
    ├── serve.ts           # runAgent() factory shared by all specialists
    ├── orchestrator.ts     # Port 4000
    ├── oracle.ts           # Port 4001
    ├── librarian.ts        # Port 4002
    ├── explorer.ts         # Port 4003
    ├── designer.ts         # Port 4004
    ├── fixer.ts            # Port 4005
    ├── scientist.ts        # Port 4006
    └── acp-bridge.ts       # stdio, reads ORCHESTRATOR_URL env
```

**Rule:** Core modules never import adapters. Adapters implement port interfaces. Run modules do all wiring.

## Agents

| Agent            | Port  | Protocol   | Role                                          |
| ---------------- | ----- | ---------- | --------------------------------------------- |
| Orchestrator     | 4000  | A2A server | Routes tasks, persists memory, self-improves  |
| Oracle           | 4001  | A2A server | Code review, simplification, architecture     |
| Librarian        | 4002  | A2A server | Docs, web research, code search               |
| Explorer         | 4003  | A2A server | Fast codebase recon, file search              |
| Designer         | 4004  | A2A server | UI/UX design, responsive layouts              |
| Fixer            | 4005  | A2A server | Bug fixes, code generation, mechanical impl   |
| Scientist        | 4006  | A2A server | Python data analysis via MCP tools (uv)       |
| ACP Bridge       | stdio | ACP server | IDE bridge → Orchestrator                     |
| MCP Tool Server  | stdio | MCP server | fs, uv-python, calculate, skill store         |

**Scientist has no `package.json` script and is NOT in `bun run dev`** — start it with `bun agents/run/scientist.ts` if needed.

## Protocol layers

- **ACP** (stdio nd-JSON) — IDE ↔ ACP bridge — JSON-RPC 2.0, one JSON object per line
- **A2A** (HTTP JSON-RPC) — Orchestrator ↔ Specialists — synchronous `tasks/send` to agent URL root; Agent Cards at `/.well-known/agent-card.json`
- **MCP** (stdio) — Agents ↔ Tools — `bun mcp-servers/tools.ts`

### A2A wire protocol (a2a-server.ts)

- POST to `/` (root path ONLY) with JSON-RPC method `tasks/send`, params `{message:{parts:[{kind:"text",text}]}}`
- Any other method → `-32601 Method not found`; any other path → 404
- Synchronous: server awaits the handler and returns the result in the response — no polling
- `scripts/demo.ts` is OUT OF SYNC: it posts to `/a2a` with `message/send` and polls `tasks/get`. Current server rejects both. Trust `a2a-server.ts`, not `demo.ts`.

## Skills system

### Builtin skills (`skills/builtin/`)

Static Hermes-style SKILL.md files with YAML frontmatter + markdown body.
Each skill is assigned to an agent and loaded at task time.

| Skill                 | Assigned To   | Description                                      |
| --------------------- | ------------- | ------------------------------------------------ |
| `simplify`            | Oracle        | Behavior-preserving code simplification          |
| `codemap`             | Explorer      | Hierarchical repository mapping                  |
| `deepwork`            | Orchestrator  | Complex coding sessions with review gates        |
| `verification-planning` | Orchestrator | Evidence planning before implementation          |
| `reflect`             | Orchestrator  | Review repeated work, suggest reusable skills    |
| `worktrees`           | Orchestrator  | Git worktree management for isolated work        |

### Auto-generated skills (`skills/*.json`)

JSON files created by agents during the self-improvement loop.
Librarian Agent writes `skills/<slug>.json` after each novel task.
Skills are idempotent: same task type → slug match → skipped if file exists.

### Skill assignment

The active `opencode.json` has NO `agents.skills` config (it only sets the 9router provider + explorer subagent). The old assignment block lives in the leftover `opencode.json.need_fix` — do not treat it as live config.

## Self-improvement loop

After each novel task, Librarian Agent writes `skills/<slug>.json`.
These are Hermes-style skill documents with steps + success tracking.
Skills are idempotent: same task type → slug match → skipped if file exists.

## Key files

- `agents/core/` — Domain logic (orchestrator, cognitive-loop, oracle, fixer, librarian, explorer, designer, scientist)
- `agents/ports/` — Port interfaces (agent-registry, task-store, memory-store, skill-store, discovery, budget, llm, search, knowledge, image-gen, mcp-tool, resource)
- `agents/adapters/` — HTTP servers, A2A client, filesystem stores, 9router clients
- `agents/run/` — Composition roots that wire everything together (`serve.ts` = shared factory)
- `agents/types.ts` — Shared TypeScript types (A2A, ACP, Skill, MCP, AgentCard, handover)
- `mcp-servers/tools.ts` — MCP tool server (Bun, uses McpServer from SDK)
- `scripts/demo.ts` — End-to-end integration test (⚠ OUT OF SYNC with current A2A protocol)
- `route-test.ts` — Standalone routing test with MockRegistry (`bun route-test.ts`)
- `skills/` — Auto-generated skill documents (JSON)
- `skills/builtin/` — Static Hermes-style SKILL.md files
- `memory/orchestrator.md` — Session memory (append-only markdown)
- `settings.json` — Zed config (⚠ stale path `agents/acp-bridge.ts`; real file is `agents/run/acp-bridge.ts`)

## Quick start

```bash
bun install

# Start all agents in parallel (dev mode) — NOTE: does NOT include Scientist
bun run dev

# Or individually:
bun run orchestrator # port 4000
bun run oracle       # port 4001
bun run librarian    # port 4002
bun run explorer     # port 4003
bun run designer     # port 4004
bun run fixer        # port 4005
bun agents/run/scientist.ts # port 4006 (no script)

# Type check
bun run typecheck

# Run integration test (agents must be running first)
bun run demo
```

## IDE integration (ACP)

**Zed** `~/.config/zed/settings.json` or project `settings.json`:

```json
{
  "agent_servers": {
    "jabr": {
      "type": "custom",
      "command": "bun",
      "args": ["agents/run/acp-bridge.ts"],
      "default_mode": "base"
    }
  }
}
```

**JetBrains** `acp.json`:

```json
{ "jabr": { "command": "bun", "args": ["agents/run/acp-bridge.ts"] } }
```

## Aliased imports

`tsconfig.json` path aliases: `@agents/*` → `./agents/*`, `@core/*` → `./agents/core/*`, `@ports/*` → `./agents/ports/*`, `@adapters/*` → `./agents/adapters/*`, `@run/*` → `./agents/run/*`, `@mcp/*` → `./mcp-servers/*`, `@utils/*` → `./agents/utils/*`.
Core modules use relative imports for ports/types only.

## TypeScript conventions

- `verbatimModuleSyntax` — use `import type { ... }` for type-only imports or tsc fails
- `allowImportingTsExtensions` — relative imports use explicit `.ts` extension (`./cognitive-loop.ts`)
- `noUncheckedIndexedAccess` — array/object index access returns `T | undefined`
- `noImplicitOverride` — override methods need the `override` keyword

## Architecture notes

- **Routing**: Pure tag-based routing. `OrchestratorAgent.routeTask()` delegates entirely to `DynamicRegistry.matchAgent(text)`, which scores each registered agent's `AgentSkill.tags` (seeded from every specialist's `AgentCard`) against the task text and returns the best match. No keyword table — `ROUTING_TABLE` was removed (GAP-1). Scoring: +2 per tag substring in task text, +1 per keyword overlap (stopwords filtered, len>2). `matchAgent` falls back to the FIRST registered agent (oracle) when no tag matches. `routeTask` returns `null` when the registry is EMPTY — the caller (`executeWithDepth`) then throws `"No agents discovered — cannot route task"`. Do NOT return a hardcoded agent name from `routeTask` on empty registry: `getAgentUrl` returns `undefined` for it and the old `"librarian"` fallback crashed with `No URL configured for agent`.
- **Handover**: Any specialist can return `%%HANDOVER%%` + JSON `{transferTo, reason, context}`; orchestrator recurses with a child task (referenceTaskIds chain), max depth 3 (`MAX_HANDOVER_DEPTH`). `transferTo` must be a **seed key** (oracle, fixer, ...) resolvable by `getAgentUrl`. **Currently DORMANT by design**: `encodeHandover` is defined but no specialist calls it. Specialists are deterministic keyword matchers (not LLM-driven), so they have no reasoning step to "decide" it's the wrong lane — and hardcoding handover rules would just duplicate the router. Only `jarvis` and the orchestrator's consensus loop use an LLM. Wire handover into a specialist only when it becomes LLM-driven (then it can genuinely reason about mis-routing). `decodeHandover` does `JSON.parse` on everything after the marker with no trailing-text tolerance — the marker must be the LAST thing in the result.
- **Consensus**: `executeConsensus` delegates to ALL agents, scores via `CognitiveLoop` (successRate×0.4, length>100 chars +0.2, word-overlap×0.3, tag hits×0.1, cap 1.0; defaults: judge=oracle, minAgents=2, confidence 0.7), synthesizes via LLM (temp 0.3) or markdown ranking.
- **Budget**: `HeadroomAdapter` tracks per-agent token usage; env caps `JABR_TOKEN_CAP_<AGENT>` (default 100000). Exhausted budget throws `BudgetExhaustedError` before delegation. Budget name comes from the explicit seed-key `agentName` passed to `delegateTask(agentUrl, text, agentName?)`; `A2AClient.deriveAgentName()` (URL substring scan over scientist/fixer/oracle/designer/librarian/explorer/jarvis) is only a last-resort fallback.
- **Discovery**: `DynamicRegistry.discover()` iterates `seedUrls` (keyed by seed keys: oracle, librarian, ...) and calls `registry.fetchCard(url)` per URL, registering each agent under its **seed key** (not its self-declared `card.name`). `A2AClient.fetchCard` caches cards by URL. The old `discoverAgents()` (map keyed by `card.name`) was removed — it silently dropped every entry because `seedUrls[card.name]` was undefined, leaving the registry empty.
- **LLM**: Default is `NineRouterLlmAdapter` (`agents/adapters/llm/9router.ts`) — OpenAI-compatible 9router gateway. Env `NINEROUTER_URL` (default http://127.0.0.1:20128), `NINEROUTER_KEY`, `NINEROUTER_MODEL` (default `openrouter/minimax/minimax-m3:free`). Consumes "openai" budget. `OpenAiLlmAdapter` (`JABR_OPENAI_API_KEY`/`JABR_OPENAI_BASE_URL`/`JABR_OPENAI_MODEL`) still exists but is only used if constructed directly.
- **Knowledge**: `MemPalaceAdapter` stores `memory/palace/<slug>.json`; orchestrator augments depth-0 tasks with top-3 entries (tags +5, slug +3, content word +1).
- **ACP bridge**: Reads `ORCHESTRATOR_URL` env var (default `http://localhost:4000`).
- **MCP run_python**: Writes `.python_env/main.py`, runs `uv run --project .python_env python main.py`, 10s timeout. **Persistent `.python_env/`** (auto-created via `uv init --lib`) — NOT /tmp, NOT ephemeral. `install_python_dependency` = `uv add` into it.
- **MCP tools**: `read_file`, `write_file`, `run_python`, `calculate`, `save_skill`, `list_skills`, `install_python_dependency`. All paths relative to `process.cwd()`.
- **MCP resources**: `jabr://world-state`, `jabr://tasks/{taskId}`, `jabr://skills`, `jabr://memory`; subscriptions via `SubscriptionManager`.
- **Memory**: Append-only markdown. Orchestrator writes to `memory/orchestrator.md`. Compatible with Hermes `memory.md` pattern.
- **Skills**: JSON files in `skills/` with `name`, `description`, `tags`, `steps`, `createdAt`, `usageCount`, `successRate`.

## Git conventions

- **Always stage and commit changes by topic and domain.** Group related changes into one commit per concern (e.g. one commit for a routing fix, one for an adapter fix, one for docs). Do not bundle unrelated changes into a single commit, and do not leave deliberate source changes uncommitted.
- Use conventional-commit prefixes: `feat`, `fix`, `test`, `docs`, `tooling`, `refactor`, `chore`.
- Runtime/generated artifacts (`memory/orchestrator.md` append-only log, `repomix-output.xml`) are not deliberate source changes — leave them out of topic commits unless explicitly requested.

## Notes

- `bun run typecheck` runs `tsc --noEmit`; no lint or test scripts configured
- `getWorldState()` in `core/orchestrator.ts` resolves `memory/` and `skills/` relative to `process.cwd()` — do NOT hardcode absolute paths (the old `/home/m7r/...` paths broke on other checkouts).
- All A2A endpoints return CORS `Access-Control-Allow-Origin: *`
- `index.ts` is a stub, NOT the entrypoint (stale comment mentions coder/researcher)
- Scientist's MCP client speaks raw JSON-RPC over stdio with a single-response listener — fragile by design