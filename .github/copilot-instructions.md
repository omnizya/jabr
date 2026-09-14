# Jabr — Copilot Instructions

## Build & Dev Commands

```bash
bun install                  # Install dependencies
bun run dev                  # Start all agents and servers concurrently
bun test                     # Run full test suite
bun test tests/<file>.test.ts # Run a single test file
bun test tests/<file>.test.ts -t "test name"  # Run a focused test by name
bun run typecheck            # TypeScript type checking (tsc --noEmit)
bun run lint                 # Biome linter
bun run format               # Biome formatter
bun run build                # Build all targets into dist/bin/
bun run build -- orchestrator  # Build a single target binary
bun run build -- --list      # List available build targets
```

### Running Agents Standalone

```bash
bun run orchestrator   # Port 4000
bun run oracle         # Port 4001
bun run librarian      # Port 4002
bun run explorer       # Port 4003
bun run designer       # Port 4004
bun run fixer          # Port 4005
bun run scientist      # Port 4006
bun run jarvis         # Port 1337
bun run verification   # Port 4009
bun run mcp            # MCP tools server over stdio
```

## Architecture

Jabr uses a strict **Hexagonal Architecture (Ports & Adapters)**:

- **`src/runtime/`** — Composition roots wiring everything together (orchestrator, agents, ACP bridge). Entry points for binaries.
- **`src/protocols/`** — Protocol implementations:
  - `mcp/` — MCP (Model Context Protocol) server (`tools.ts`, `index.ts`, `validation.ts`)
  - A2A server logic embedded in agent run modules
- **`src/security/`** — Auth stack: JWT, OAuth 2.1, API key registry, TLS config, auth middleware, token store, handover chain
- **`src/types/`** — Shared TypeScript types (`a2a-v1.ts`, `types.ts`)
- **`src/utils/`** — Cross-cutting utilities (`rpc.ts`, `logger.ts`)
- **`src/constants/ecosystem.ts`** — Single source of truth: ports, endpoints, A2A methods, defaults, CORS allowlist
- **`scripts/`** — Build, CLI, demo, and maintenance scripts

### Invariants
1. Composition roots (runtime) wire the system; they own the dependency graph.
2. Protocol adapters implement interfaces; they never import core domain logic directly.
3. Shared constants live in `ecosystem.ts` — never hardcode ports or paths.

## Protocol Boundaries

### A2A (Agent-to-Agent)
- JSON-RPC over HTTP POST to `/` (root path), A2A v1.0 wire contract.
- Methods: `SendMessage`, `SendStreamingMessage` (SSE), `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, `GetExtendedAgentCard`, push-notification config (Create/Get/List/Delete `TaskPushNotificationConfig`).
- Synchronous `SendMessage` awaits handlers and returns results inline; `SendStreamingMessage` streams `text/event-stream`.
- Legacy `tasks/send`-family methods are removed — unknown methods return `-32601`.
- Auth: `X-API-Key` header (via `ApiKeyRegistry`) or OAuth 2.1 JWT Bearer token.
- Agent card at `/.well-known/agent-card.json`.
- Task lifecycle: `SUBMITTED → WORKING → INPUT-REQUIRED → COMPLETED` (or `FAILED / CANCELED / REJECTED / AUTH-REQUIRED / UNKNOWN`).

### ACP (Agent Communication Protocol)
- Bridge at `src/runtime/acp-bridge.ts`.
- Connects Jabr agents to external ACP-compatible systems.

### MCP (Model Context Protocol)
- Server entry: `src/protocols/mcp/server/tools.ts`.
- Run via `bun run mcp` (stdio transport).
- Provides the repository's own tool server for agent-tool interactions.

## Environment Prerequisites

- **`JABR_X402_HMAC_SECRET`** — Required by orchestrator. Generate with `openssl rand -hex 32`.
- **LLM Provider** — Configured via `JABR_LLM_PROVIDER`:
  - `9Router` (default, free tier via OpenRouter)
  - `vercel` (Vercel AI Gateway)
  - `openai` (OpenAI-compatible endpoint)
- **9Router** — Defaults to `http://localhost:20127`, model `openrouter/minimax/minimax-m3:free`. Override via `NINEROUTER_URL` and `NINEROUTER_MODEL`.

## Code Conventions

- **Explicit `.ts` extensions** on all relative imports (required by `verbatimModuleSyntax` + `allowImportingTsExtensions`).
- **Strict TypeScript** — `tsconfig.json` enables strict mode. Run `bun run typecheck` before committing.
- **Biome** for linting and formatting (not ESLint/Prettier). Config in `biome.json`.
- **Bun** as runtime and test runner. No Node.js-specific APIs unless polyfilled.
- **SQLite/WAL** for agent memory (`memory/jabr.db`).

## Local MCP Servers

Jabr exposes and consumes several MCP servers. Configure them in your editor's MCP config (e.g. `.vscode/mcp.json` or `~/.config/hermes/config.yaml`):

### Jabr's Own MCP (in-repo)
```json
{
  "jabr": {
    "command": "bun",
    "args": ["run", "mcp"],
    "cwd": "/home/m7r/Work/agent-lab"
  }
}
```
Entry: `src/protocols/mcp/server/tools.ts` (stdio transport).

### Filesystem
```json
{
  "filesystem": {
    "command": "bunx",
    "args": ["@modelcontextprotocol/server-filesystem", "/home/m7r/Work/agent-lab"]
  }
}
```
Grants read/write access to the repo directory.

### GitHub
```json
{
  "github": {
    "command": "bunx",
    "args": ["@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token>" }
  }
}
```
PRs, issues, CI runs, code search.

### Obsidian
```json
{
  "obsidian": {
    "command": "bunx",
    "args": ["obsidian-mcp"]
  }
}
```
Headless Obsidian vault access (already installed globally).

### Memory
```json
{
  "memory": {
    "command": "bunx",
    "args": ["@modelcontextprotocol/server-memory"]
  }
}
```
Persistent key-value store across sessions.

## Build Targets

Compile standalone bytecode binaries into `dist/bin/`:

```bash
bun run build              # All targets
bun run build -- <name>    # Single target
```

Available targets: `orchestrator`, `oracle`, `librarian`, `explorer`, `designer`, `fixer`, `jarvis`, `scientist`, `verification`, `acp-bridge`, `mcp`, `cli`.

Binaries are self-contained (bundled JS + bytecode, ESM format, minified).
