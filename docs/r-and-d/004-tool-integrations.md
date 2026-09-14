# R&D-004: Tool Integrations — opensrc / Graft / Headroom / RTK

> **Status:** APPROVED
> **Review:** 2026-09-12 — architecture sound, four factual corrections applied (see [§10 Review](#10-review))
> **Created:** 2026-09-12
> **Author:** Jabr R&D
> **Scope:** Integrate four external tools into the Jabr ecosystem so specialized agents can use them natively via MCP or CLI.

---

## 1. Executive Summary

Jabr currently has one MCP-backed toolset (repomix: `pack_repository`, `grep_repomix_output`, `read_repomix_output`) consumed by Explorer and Jarvis agents. Four external tools are already installed on the host machine and proven in the wild:

| Tool | Version | What it does | Current Jabr usage |
|------|---------|-------------|-------------------|
| **opensrc** | 0.7.3 | Fetch dependency source code for AI agents | ❌ None |
| **Graft** | 0.16.0 | Codebase graph for coding agents (MCP + CLI) | ⚠️ Installed + graph live in repo; not yet exposed to Jabr agents |
| **Headroom** | 0.37.0 | Context optimization proxy (60–95% token reduction on tool outputs) | ⚠️ `HeadroomAdapter` exists but is budget-tracking only, not the proxy |
| **RTK** | 0.48.0 | CLI proxy that filters/summarizes system outputs before LLM context | ❌ None |

This document researches each tool, brainstorms integration patterns, proposes a unified architecture, and writes an implementation plan.

---

## 2. Tool Deep-Dives

### 2.1 opensrc

**Source:** `opensrc` (npm/bun package, v0.7.3)
**Binary:** `~/.cache/.bun/bin/opensrc`
**Cache:** `~/.opensrc/` (36 packages pre-cached)

**Core mechanic:** Resolves any npm/PyPI/crates.io/GitHub package to a shallow-cloned git repo at the correct version tag. Returns a local filesystem path. Agents `cat`/`rg`/`find` the source directly.

**Key commands:**
```
opensrc path zod                          # → /home/m7r/.opensrc/repos/github.com/colinhacks/zod/4.6.0/
opensrc path pypi:requests                # → .../pypi/requests/...
opensrc path @modelcontextprotocol/sdk    # → .../npm/@modelcontextprotocol/sdk/1.30.0/
opensrc fetch zod react next              # pre-warm cache
opensrc list                              # show cached
```

**Version resolution:** Auto-detects from lockfiles (npm only). PyPI/crates use latest unless pinned.

**Registries:** npm, PyPI (`pypi:`), crates.io (`crates:`), GitHub (`owner/repo`), GitLab, Bitbucket.

**Strengths:**
- Zero-config for public packages
- Cache is just files — agents read with normal file tools
- Works with any agent that can run shell commands
- Already has 36 packages cached (Jabr-relevant: zod, hono, drizzle-orm, @a2a-js/sdk, @modelcontextprotocol/sdk, express, jose, bcryptjs, etc.)

**Limitations:**
- No MCP server (CLI only)
- PyPI/crates don't auto-detect version from lockfiles
- First fetch is slow (full clone)

### 2.2 Graft

**Source:** `github.com/trailhq/Graft` (MIT, 7.2k ★)
**Package:** `@nanonets/graft` (npm)
**Binary:** `~/.cache/.bun/bin/graft` (v0.16.0, installed)

**Core mechanic:** Parses a repo with tree-sitter into a code graph (markdown nodes + `wiring.json`). Serves retrieval over MCP. The graph is a local cache (gitignored `graft/` folder).

**Two-tier architecture:**
- **Tier 1 (free, no key):** Pure tree-sitter — every function, class, call edge. Deterministic, ~3ms staleness check.
- **Tier 2 (`--deep`, paid):** LLM summarizes each file, groups into concept nodes. Cached by content hash.

**MCP tools (6):**
| Tool | Purpose |
|------|---------|
| `graft_find_code` | Ranked nodes with file:line + source inlined |
| `graft_file_api` | Every signature in a file, no bodies |
| `graft_trace_calls` | Who depends on it / what it depends on (blast radius) |
| `graft_find_all` | Regex hits grouped by enclosing symbol |
| `graft_repo_map` | Directory clusters, hubs, hotspots |
| `graft_check_freshness` | Drift detection |

**Benchmark (162 runs, Claude Sonnet 5):**
- 46% fewer tool calls
- 42% fewer tokens
- 60% less latency
- Correctness equal or better (SWE-bench: 33/50 vs 27/50 cold)

**Agent wiring:** `graft init` writes skill/rule files for Claude Code, Cursor, Codex, Gemini, Copilot, Kiro, Windsurf, Grok, AdaL. Also registers MCP server in `.mcp.json`.

**Strengths:**
- No daemon, no server — graph is just files
- Auto-syncs on query (~3ms check)
- Works with uncommitted edits
- Receiver-type call resolution (not just name matching)
- Monorepo-aware

**Limitations:**
- Tier 2 needs LLM API key (cost)
- Primarily designed for single-repo (monorepo support exists but newer)

**Jabr status:** Installed (v0.16.0) and this repo's graph is already built (`graft/` folder, 636 cards, `graft check: OK`). The remaining work is agent exposure — not installation.

### 2.3 Headroom

**Source:** `headroom` (v0.37.0, installed via mise/uv)
**Binary:** `~/.local/share/mise/shims/headroom`

**Core mechanic:** Two complementary subsystems:

1. **Proxy** (`headroom proxy`): Local HTTP proxy on :8787 that intercepts agent→LLM traffic and compresses large tool outputs by 60–95%. Uses hash markers so LLM can call `headroom_retrieve` for full content on demand.

2. **MCP Server** (`headroom mcp serve`): Exposes `headroom_retrieve`, `headroom_compress`, `headroom_stats` tools.

**Current Jabr status:** `HeadroomAdapter` in `src/adapters/headroom/headroom.ts` implements `BudgetPort` — it only does token counting/caps. It does NOT integrate the proxy or MCP tools. The actual Headroom proxy has never been started for Jabr.

**Strengths:**
- 60–95% token reduction on tool outputs
- Transparent to agents (proxy mode)
- Budget-aware (built-in spending cap)
- MCP tools for explicit retrieval

**Limitations:**
- Proxy mode requires routing LLM traffic through :8787 (changes `ANTHROPIC_BASE_URL` etc.)
- Conflicts with prompt caching (compaction invalidates cached prefixes)
- The `HeadroomAdapter` name is misleading — it's a budget counter, not the Headroom proxy

### 2.4 RTK (Red Toolkit)

**Source:** `rtk` (v0.48.0, Rust CLI, installed via cargo/mise)
**Binary:** `~/.local/bin/rtk`

**Core mechanic:** CLI proxy/wrapper that intercepts common commands and produces token-optimized output. NOT a proxy server — it's a command wrapper.

**Key subcommands:**
```
rtk ls          # Compact directory listing
rtk tree        # Token-optimized tree
rtk read        # Read file with intelligent filtering
rtk grep        # Compact grep (strip whitespace, truncate, group by file)
rtk rg          # Compact ripgrep
rtk git         # Compact git output
rtk gh          # Compact GitHub CLI
rtk test        # Show only failures
rtk diff        # Ultra-condensed diff
rtk find        # Find with compact tree
rtk log         # Filter/deduplicate logs
rtk deps        # Summarize dependencies
rtk summary     # Heuristic 2-line summary of any command
rtk err         # Show only errors/warnings
```

**Config:** `~/.config/rtk/config.toml` — tracking, filters, tee mode, limits.

**Token savings:** Tracked via `rtk gain` — shows history of savings.

**Strengths:**
- Drop-in replacement for common CLI commands
- No daemon, no server, no config needed
- Works with any agent that can run shell commands
- 30+ command wrappers
- Token savings tracking built-in

**Limitations:**
- CLI-only (no MCP server)
- Agent must choose to use `rtk <cmd>` instead of `<cmd>`
- Heuristic-based (not LLM-powered)

---

## 3. Integration Architecture Brainstorm

### 3.1 Pattern Analysis

| Pattern | Tools | Pros | Cons |
|---------|-------|------|------|
| **A. MCP Server** | Graft, Headroom | Native tool discovery, schema-validated, works with `McpToolPort` | Only Graft and Headroom have MCP servers |
| **B. CLI via shell** | opensrc, RTK, Graft CLI | Universal — any agent with terminal access can use | No schema validation, agent must know CLI flags |
| **C. Hybrid** (MCP + CLI) | All four | Best of both — MCP for discovery, CLI for flexibility | More code to maintain |

### 3.2 Proposed Architecture: Layered Tool Bus

```
┌─────────────────────────────────────────────────────┐
│                   Jabr Agents                        │
│  Explorer  Fixer  Oracle  Librarian  Jarvis  ...    │
└──────────────┬──────────────────────┬────────────────┘
               │                      │
       ┌───────▼───────┐      ┌───────▼───────┐
       │  McpToolPort  │      │  ShellPort    │
       │  (existing)   │      │  (new)        │
       └───────┬───────┘      └───────┬───────┘
               │                      │
    ┌──────────┼──────────┐           │
    │          │          │     ┌─────▼──────────────┐
    ▼          ▼          ▼     │  CLI Tool Adapters  │
 Graft MCP  Headroom MCP  repomix  │  (opensrc, RTK,   │
                                  │   graft CLI)       │
                                  └────────────────────┘
```

**Key insight:** Jabr already has `McpToolPort` for MCP tools. We add a `ShellPort` for CLI-based tools. Both ports are injected into agents that need them.

### 3.3 Agent-to-Tool Mapping

| Agent | Role | Tools | Rationale |
|-------|------|-------|-----------|
| **BATTUTA** (Explorer) | Codebase reconnaissance | Graft MCP, RTK, opensrc | Needs code graph, compact output, and dependency source |
| **TARIQ** (Fixer) | Implementation | Graft MCP, opensrc, RTK | Needs call-trace, dependency source, compact test/build output |
| **RUSHD** (Oracle) | Architecture review | Graft MCP, opensrc | Needs blast-radius analysis, dependency internals |
| **FIHRIYA** (Librarian) | Knowledge/research | opensrc, RTK | Needs dependency source, compact doc lookup |
| **Wazir** (Jarvis) | Codebase steward | Graft MCP, RTK, opensrc | Needs repo map, compact scan output, dependency tracking |
| **KHWARIZMI** (Scientist) | Data/scripting | RTK | Needs compact test/script output |
| **FIRNAS** (Designer) | UI/UX | — | No direct need for these tools |
| **JABIR** (Orchestrator) | Routing | Headroom MCP | Needs token savings stats for routing decisions |

### 3.4 Integration Approaches per Tool

#### opensrc → ShellPort (CLI-only)

```
opensrc path <pkg>  →  /home/m7r/.opensrc/repos/...
```

- New `opensrc.ts` adapter in `src/adapters/cli/`
- Wraps `opensrc path` and `opensrc fetch`
- Agents call: `shellExec("opensrc path zod")` → read files from returned path
- Pre-warm cache for Jabr's own dependencies at init time

#### Graft → McpToolPort (MCP) + ShellPort (CLI fallback)

```
graft_find_code, graft_trace_calls, ...  (via MCP)
graft build, graft ask, graft map         (via CLI)
```

- Register Graft's MCP server in `src/protocols/mcp/server/tools.ts` config
- OR spawn `graft mcp` as a subprocess (like repomix)
- CLI fallback for `graft build` (graph construction)
- Graph already exists in this repo — skip `graft init`; verify freshness with `graft check`

#### Headroom → Proxy + McpToolPort

```
Proxy:         JABR_OPENAI_BASE_URL / NINEROUTER_URL → http://127.0.0.1:8787 (per provider)
MCP tools:     headroom_retrieve, headroom_compress, headroom_stats
Budget:        Existing HeadroomAdapter (keep for token counting)
```

- Start `headroom proxy` as background process at Jabr startup
- Register Headroom MCP server
- Rename `HeadroomAdapter` → `BudgetAdapter` (it's not the Headroom proxy)
- Wire proxy URL into LLM provider config when `JABR_HEADROOM_PROXY=1`

#### RTK → ShellPort (CLI wrapper)

```
rtk <cmd>  →  compact output
```

- New `rtk.ts` adapter in `src/adapters/cli/`
- Wraps common commands: `rtk ls`, `rtk grep`, `rtk git`, `rtk test`, etc.
- Agents prepend `rtk` to shell commands when output size matters
- Config: respect `~/.config/rtk/config.toml` limits

---

## 4. Detailed Design

### 4.1 New Port: ShellPort

```typescript
// src/ports/shell-port.ts
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellPort {
  exec(command: string, args: string[], opts?: {
    cwd?: string;
    timeout?: number;
    maxOutput?: number;  // truncate to N chars
  }): Promise<ShellResult>;
}
```

**Why a port?** Core agents shouldn't depend on child_process directly. The port enables:
- Testing with mock shell
- Sandboxing in production
- Future: remote shell execution

### 4.2 CLI Adapters

```
src/adapters/cli/
├── opensrc.ts      // opensrc path, opensrc fetch, opensrc list
├── rtk.ts          // rtk ls, rtk grep, rtk git, rtk test, ...
└── index.ts        // re-exports
```

Each adapter wraps the CLI with typed methods:

```typescript
// src/adapters/cli/opensrc.ts
export class OpensrcAdapter {
  async path(pkg: string, version?: string): Promise<string> {
    // returns local path to cached source
  }
  async fetch(pkgs: string[]): Promise<void> {
    // pre-warm cache
  }
  async list(): Promise<Array<{name, version, path}>> {
    // list cached packages
  }
}
```

### 4.3 Graft Integration via MCP

Two options:

**Option A: External MCP server (preferred)**
- User runs `graft init --no-agents` in their repo
- Graft spawns its own MCP server
- Jabr connects as MCP client (like it does for repomix)

**Option B: Embedded in Jabr's MCP server**
- Add Graft tools directly to `src/protocols/mcp/server/tools.ts`
- Call `graft` CLI under the hood
- More control, but duplicates Graft's server logic

**Recommendation:** Option A — let Graft own its server. Jabr connects as a client.

### 4.4 Headroom Integration

```
src/adapters/headroom/
├── headroom-proxy.ts    // manages `headroom proxy` lifecycle
├── headroom-mcp.ts      // connects to Headroom's MCP server
└── budget-adapter.ts    // renamed from HeadroomAdapter
```

**Startup flow:**
1. Jabr checks `JABR_HEADROOM_PROXY` env
2. If enabled: start `headroom proxy` as background process
3. Set the active provider's base URL to the proxy (`JABR_OPENAI_BASE_URL` for OpenAI-compatible, `NINEROUTER_URL` for 9Router)
4. Register Headroom MCP tools
5. Budget tracking continues via `BudgetAdapter`

### 4.5 Agent Card Updates

Each agent's `AgentCard.skills` should advertise the new capabilities:

```typescript
// Explorer (BATTUTA) — add:
{ name: "Dependency source lookup", tags: ["opensrc", "dependency", "source"] },
{ name: "Code graph query", tags: ["graft", "code-graph", "call-graph"] },
{ name: "Compact output", tags: ["rtk", "filter", "compact"] },

// Fixer (TARIQ) — add:
{ name: "Dependency source lookup", tags: ["opensrc", "dependency", "source"] },
{ name: "Call trace", tags: ["graft", "trace", "blast-radius"] },

// Oracle (RUSHD) — add:
{ name: "Dependency deep-dive", tags: ["opensrc", "dependency", "internals"] },
{ name: "Impact analysis", tags: ["graft", "impact", "callers"] },
```

### 4.6 SOUL.md Updates

Each agent's SOUL.md should include tool usage guidelines. Note: SOUL.md files are
**hand-authored** and don't exist yet — `scripts/generate-agent-souls.py` generates
`souls/<slug>/IDENTITY.md` + `AGENTS.md` (SOUL.md is explicitly not generated).
Phase 4 must create or update souls via that established system:

```markdown
## Tool Usage

### opensrc
Use `opensrc path <pkg>` when you need to read a dependency's implementation,
not just its types. Always check if source is already cached before fetching.

### Graft
Use `graft_find_code` for "where is X implemented" questions.
Use `graft_trace_calls` for blast-radius analysis before refactoring.
Use `graft_repo_map` for first-look orientation in unfamiliar repos.

### RTK
Prepend `rtk` to commands where output size matters:
- `rtk ls` instead of `ls` for large directories
- `rtk grep` instead of `grep` for broad searches
- `rtk test` to see only failures
- `rtk diff` for compact change summaries
```

---

## 5. Implementation Plan

### Phase 1: ShellPort + CLI Adapters (low risk, high value)

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 1.1 | Create `ShellPort` interface | `src/ports/shell-port.ts` | 30 min |
| 1.2 | Create `ShellPortAdapter` (child_process impl) | `src/adapters/cli/shell-adapter.ts` | 1 hr |
| 1.3 | Create `OpensrcAdapter` | `src/adapters/cli/opensrc.ts` | 45 min |
| 1.4 | Create `RtkAdapter` | `src/adapters/cli/rtk.ts` | 45 min |
| 1.5 | Wire adapters into Explorer agent | `src/core/explorer.ts`, `src/runtime/agents/explorer.ts` | 1 hr |
| 1.6 | Wire adapters into Fixer agent | `src/core/fixer.ts`, `src/runtime/agents/fixer.ts` | 1 hr |
| 1.7 | Wire adapters into Oracle agent | `src/core/oracle.ts`, `src/runtime/agents/oracle.ts` | 45 min |
| 1.8 | Wire adapters into Jarvis agent | `src/core/jarvis.ts`, `src/runtime/agents/jarvis.ts` | 45 min |
| 1.9 | Update AgentCard skills | All `*_CARD` in `src/core/*.ts` | 30 min |
| 1.10 | Tests | `tests/` | 2 hr |

**Phase 1 total:** ~9 hours

### Phase 2: Graft Integration (medium risk, high value)

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 2.1 | Verify Graft installed + graph current (`graft check`; `graft upgrade` if stale) | — | 5 min |
| 2.2 | Skip `graft init` — graph already exists in this repo | — | 0 min |
| 2.3 | Create `GraftMcpAdapter` (connect to Graft's MCP server) | `src/adapters/mcp/graft-client.ts` | 1 hr |
| 2.4 | Wire into Explorer, Fixer, Oracle, Jarvis | Core files | 2 hr |
| 2.5 | Update AgentCard skills | All `*_CARD` | 30 min |
| 2.6 | Tests | `tests/` | 1 hr |

**Phase 2 total:** ~5 hours

### Phase 3: Headroom Proxy Integration (medium risk, medium value)

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 3.1 | Rename `HeadroomAdapter` → `BudgetAdapter` | `src/adapters/headroom/budget.ts` | 30 min |
| 3.2 | Create `HeadroomProxyAdapter` (process lifecycle) | `src/adapters/headroom/proxy.ts` | 1 hr |
| 3.3 | Create `HeadroomMcpAdapter` | `src/adapters/headroom/mcp.ts` | 1 hr |
| 3.4 | Wire proxy startup into runtime composition | `src/runtime/*.ts` | 1 hr |
| 3.5 | Add env config (`JABR_HEADROOM_PROXY`) | `src/config/env-manager.ts` | 30 min |
| 3.6 | Tests | `tests/` | 1 hr |

**Phase 3 total:** ~5 hours

### Phase 4: SOUL.md Updates + Documentation

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 4.1 | Create/extend BATTUTA soul + tool guidance | `souls/battuta/` (generator, then hand-author SOUL.md) | 30 min |
| 4.2 | Create/extend TARIQ soul + tool guidance | `souls/tariq/` (generator, then hand-author SOUL.md) | 30 min |
| 4.3 | Create/extend RUSHD soul + tool guidance | `souls/rushd/` (generator, then hand-author SOUL.md) | 30 min |
| 4.4 | Create/extend WAZIR soul + tool guidance | `souls/wazir/` (generator, then hand-author SOUL.md) | 30 min |
| 4.5 | Create/extend FIHRIYA soul + tool guidance | `souls/fihriya/` (generator, then hand-author SOUL.md) | 30 min |
| 4.6 | Create/extend KHWARIZMI soul + tool guidance | `souls/khwarizmi/` (generator, then hand-author SOUL.md) | 30 min |
| 4.7 | Write integration guide | `docs/integrations.md` | 1 hr |

**Phase 4 total:** ~4 hours

### Total Estimated Effort: ~23 hours

---

## 6. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Headroom proxy conflicts with prompt caching | High | Disable proxy when `JABR_LLM_PROVIDER` uses caching; document the conflict |
| Graft Tier 2 costs money | Medium | Default to Tier 1 only; make Tier 2 opt-in via `JABR_GRAFT_DEEP=1` |
| RTK not available on agent's machine | Low | Graceful fallback to raw commands if `rtk` not found |
| opensrc cache grows unbounded | Low | `opensrc clean --npm` weekly; cache is gitignored |
| Too many tools per agent → decision paralysis | Medium | Each agent gets 2–3 tools max; tools match agent's core responsibility |
| Shell injection via CLI tools | High | Sanitize all inputs; use `shell_quote`; never pass raw user text to shell |

---

## 7. Open Questions

1. **Should Graft be embedded or external?** External MCP server is cleaner but requires the user to have Graft installed. Should Jabr auto-install it?

2. **Headroom proxy vs Budget tracking:** Should the proxy be default-on or opt-in? The 60–95% token savings are significant, but the caching conflict is real.

3. **RTK enforcement:** Should agents be forced to use `rtk` for certain commands, or is it a soft suggestion in SOUL.md? Forcing is more effective but less flexible.

4. **opensrc pre-warming:** Should Jabr pre-fetch source for all dependencies in `package-lock.json` at startup? This would eliminate first-query latency but adds startup time.

5. **Tool discovery:** Should Jabr auto-detect which tools are installed and only wire available ones? Or should it fail fast if a configured tool is missing?

---

## 8. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-12 | Use ShellPort pattern for CLI tools | Consistent with existing McpToolPort; testable; swappable |
| 2026-09-12 | Graft via external MCP server (Option A) | Don't duplicate Graft's logic; let it own its server |
| 2026-09-12 | Rename HeadroomAdapter → BudgetAdapter | Current name is misleading; it's not the Headroom proxy |
| 2026-09-12 | Phase 1 first (lowest risk, highest immediate value) | ShellPort + opensrc + RTK are pure additions, no behavior change |

---

## 9. See Also

- [R&D-001: Agent Architecture](../r-and-d/001-agent-architecture.md)
- [R&D-002: MCP Protocol](../r-and-d/002-mcp-protocol.md)
- [R&D-003: Memory & Knowledge](../r-and-d/003-memory-knowledge.md)
- [Graft README](https://github.com/trailhq/Graft)
- [opensrc skill](../../.hermes/skills/productivity/opensrc/SKILL.md)
- [Headroom skill](../../.hermes/skills/productivity/headroom/SKILL.md)

---

## 10. Review

> **Verdict:** APPROVED — 2026-09-12 R&D review. Architecture is sound; four
> factual/stale claims corrected in this revision (below). Non-blocking
> follow-ups recorded for implementation.

### 10.1 Blocking corrections applied

1. **Graft status** — §1/§2.2 claimed "not installed". Actual: `graft` v0.16.0
   installed, and this repo's graph is already built (`graft/` folder, 636 cards,
   `graft check: OK`). Phase 2 re-scoped from "install + init" to "verify + wire".
2. **Wrong file path** — `mcp-servers/tools.ts` (×2) → `src/protocols/mcp/server/tools.ts`.
3. **Phase 4 soul paths** — `souls/*/SOUL.md` don't exist. Repo generates
   `souls/<slug>/IDENTITY.md` + `AGENTS.md` via `scripts/generate-agent-souls.py`;
   SOUL.md is hand-authored only. Phase 4 rewritten around the generator.
4. **Proxy env vars** — `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` → actual surface:
   `JABR_OPENAI_BASE_URL` (OpenAI-compatible) / `NINEROUTER_URL` (9Router).

### 10.2 Verified correct

- §3.3/§4.5 agent names match source cards (BATTUTA, TARIQ, RUSHD, FIHRIYA/WAZIR,
  KHWARIZMI, FIRNAS, JABIR).
- "`HeadroomAdapter` is budget-tracking only" ✓ (implements `BudgetPort`, char/4 proxy).
- `McpToolPort` exists; `ShellPort` + `src/adapters/cli/` are true gaps.
- Tool versions (opensrc 0.7.3, headroom 0.37.0, rtk 0.48.0) and repomix tools.
- Risk table incl. shell-injection high severity; phase ordering.

### 10.3 Non-blocking follow-ups (from Divergent lens)

- `tools.ts` already spawns `repomix` via `Bun.spawnSync` — ShellPort should absorb
  that precedent (timeout, stderr parse).
- Tier-2 graph never deep-built ("meaning tier 1% complete — 5289/5324 pending");
  one `graft build --deep` improves agent-facing retrieval after Phase 2.
- RTK is already the ecosystem default (CLAUDE.md golden rule) — §4.6 SOUL guidance
  should align with `rtk`-prefix norm.
- `verification.ts` agent missing from Phase 1 wiring table — add if it needs these tools.
