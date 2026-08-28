# agents/core — Domain Logic (Ports & Adapters)

The domain layer: pure agent behavior with ZERO infrastructure imports. Agents are
deterministic keyword matchers (only `jarvis` and the orchestrator's consensus loop
use an LLM). Everything an agent needs arrives via port interfaces injected in the
constructor.

## Hard rules

- **ZERO infrastructure imports.** Never import from `@adapters/*`, `node:*`, `fs`,
  `path`, or any concrete implementation. Core talks only to ports and shared types.
  This is the single most important rule in the codebase.
- **`import type` only** for ports and types (`verbatimModuleSyntax`). The only value
  imports allowed: other core modules (e.g. `CognitiveLoop`) and genuine values from
  `@agents/types` (e.g. `decodeHandover`).
- **Relative imports must carry the `.ts` extension** (e.g. `./cognitive-loop.ts`).
  Never write `./cognitive-loop` without it.
- **Aliased imports are the standard**: `@ports/<name>` for ports, `@agents/types`
  for shared types. Do NOT use `@agents/ports/<name>`.
- **No hardcoded absolute paths.** Resolve filesystem locations via `process.cwd()`.

## De-facto agent class structure

```ts
export const ORACLE_CARD: AgentCard = { name, description, url: "", version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false }, skills: [...] };

export class OracleAgent {
  constructor(
    private taskStore: TaskStorePort,
    private skillStore: SkillStorePort,
    private optionalPort?: SomePort,   // optional ports are `private x?: Port`
  ) {}
  get card(): AgentCard { return ORACLE_CARD; }
  async execute(taskId: string, userText: string): Promise<void> {
    // 1. compute result (keyword match on userText.toLowerCase())
    // 2. taskStore.updateState(taskId, "completed")
    // 3. taskStore.appendMessage(taskId, { messageId: crypto.randomUUID(), role: "agent",
    //      kind: "message", parts: [{ kind: "text", text }], contextId: taskId })
  }
}
```

- Module-level `export const <NAME>_CARD: AgentCard` + `get card()` getter.
- Constructor takes ports as `private` params (constructor DI).
- `execute(taskId, userText)` writes results to `taskStore`; never returns text (the
  run layer reads it back via `extractLastResponse`).
- Deterministic routing via `lower.includes(...)` keyword branches returning markdown.

## Error handling (two-tier)

Core agents **catch** and return graceful fallbacks (empty arrays, error-string
markdown); they do NOT throw on expected failures. Use `console.error("[AgentName] ...")`
with a bracketed prefix. Null-check optional ports before use.

## Known inconsistencies to avoid

- `cognitive-loop.ts` and `scientist.ts` use `@agents/ports/...` — use `@ports/...`.
- `scientist.ts:11` uses `["a2a" as any]` — avoid `as any` casts; type the field.
- `cognitive-loop.ts:95` uses `scored[0]!` — prefer a guard over a non-null assertion.
- `jarvis.ts` `ScanReport.tasksCreated` is always `[]` — dead field; don't add new ones.

## See also

- Root `AGENTS.md` — architecture overview, protocol layers, agent/port table.
- `agents/ports/AGENTS.md` — the interfaces core depends on.
- `agents/run/AGENTS.md` — how core agents get wired to adapters.
