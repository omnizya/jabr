# agents/run — Composition Roots

The wiring layer: each file instantiates adapters, constructs a core agent with its
ports, and starts an `A2AServer`. No domain logic lives here — run files only glue
ports → adapters → core.

## Hard rules

- **Composition only.** No business logic, no routing rules, no keyword matching.
  Instantiate adapters, build the agent, start the server.
- **Aliased imports are the standard**: `@adapters/*` for adapters, `@core/*` for
  agents, `@agents/types` for types. Do NOT use `@agents/adapters/...` or
  `@agents/core/...` (see inconsistencies).
- **Relative imports MUST carry the `.ts` extension.** `from "./serve"` is WRONG —
  write `from "./serve.ts"`. A known violation in 5 files; do not repeat it.
- **Prefer the `runAgent()` factory** from `./serve.ts` for standard specialists.
  Only wire `A2AServer` directly when the agent needs extra config (orchestrator,
  jarvis, scientist).
- **Guard entrypoints with `if (import.meta.main)`** so files are import-safe.

## De-facto pattern (standard specialist)

```ts
import { TaskMemory } from "@adapters/task-memory";
import { SkillFS } from "@adapters/skill-fs";
import { OracleAgent, ORACLE_CARD } from "@core/oracle";
import { runAgent } from "./serve.ts";

if (import.meta.main) {
  runAgent({
    port: 4001,
    card: ORACLE_CARD,
    execute: async (taskId, text) => new OracleAgent(new TaskMemory(), new SkillFS()).execute(taskId, text),
  });
}
```

- `runAgent` (in `serve.ts`) creates the `TaskMemory`, starts the server, and reads
  the result back via `extractLastResponse`.
- Orchestrator/jarvis/scientist wire `A2AServer` directly (custom `onTask`/
  `onWorldState`, multiple adapters).

## Port conventions

- Orchestrator runs on **4000**, oracle **4001**, librarian **4002**, explorer
  **4003**, designer **4004**, fixer **4005**, scientist **4006**, jarvis **1337**.
- `seedUrls` in `run/orchestrator.ts` must match these ports.

## Known inconsistencies to avoid

- `run/scientist.ts` uses `@agents/adapters/...` and `@agents/core/...` — use
  `@adapters/...` / `@core/...`.
- 5 files (`designer`, `explorer`, `fixer`, `librarian`, `oracle`) import `./serve`
  WITHOUT `.ts` — always add the extension.
- Scientist bypasses `runAgent()`; acceptable, but keep direct-wiring style
  consistent with orchestrator/jarvis if you touch it.

## See also

- Root `AGENTS.md` — the agent/port table and quick-start commands.
- `agents/core/AGENTS.md` — the agents being wired.
- `agents/adapters/AGENTS.md` — the adapters being instantiated.
