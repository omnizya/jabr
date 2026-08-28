# agents/ports — Interfaces (Ports)

The boundary definitions of the hexagonal architecture. Ports are pure TypeScript
interfaces describing what the domain needs — they contain NO implementation, NO
infrastructure imports, and NO logic.

## Hard rules

- **Interface-only by default.** Export `export interface <Name>Port` with method
  signatures. No implementations, no `fetch`, no `node:*`, no filesystem access.
- **`import type` only** for shared types (e.g. `import type { AgentCard } from "@agents/types"`).
- **Co-locate supporting types** in the same file: request/response shapes, enums,
  and unions that the port's methods reference (e.g. `KanbanTask`, `LlmRequest`,
  `SearchResult`, `SessionData`).
- **Aliased imports are the standard**: `@agents/types` for shared types. No relative
  imports needed — ports depend only on shared types.
- **Keep it minimal.** A port should expose only what core actually consumes. Do not
  add speculative methods.

## De-facto patterns

```ts
import type { AgentCard } from "@agents/types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export interface SearchPort {
  search(query: string): Promise<SearchResult[]>;
}
```

- Method names are plain and action-oriented (`search`, `store`, `get`, `save`,
  `delegateTask`).
- Optional/error semantics are expressed in the return type (`Promise<T | null>`,
  `Promise<boolean>`, `Promise<T[]>`), not via exceptions.
- A port may export a value class when it is part of the contract — e.g.
  `budget-port.ts` exports `BudgetExhaustedError extends Error`. This is the
  exception, not the rule.

## Forward-looking stubs (not dead code)

Jabr is not 100% implemented. Some interfaces/methods are declared ahead of the
features that will consume them — treat these as **planned contracts**, not cruft:

- `resource-port.ts` (`ResourcePort`) — declared but not yet implemented or
  consumed. It is the intended contract for resource exposure; keep it until the
  resource feature lands.
- `discovery-port.ts` `getAgentNames()` and `toUrlMap()` — implemented in
  `DynamicRegistry` but not yet called. They are the planned discovery surface;
  keep them for the feature that will use them.

Rule: don't delete a stub just because it's unused today — but do not add *new*
speculative methods either. If you implement the consuming feature, wire these up;
only remove a stub if it is genuinely obsolete.

## Other port conventions

- Keep value exports rare; if a port needs an error type, follow the
  `BudgetExhaustedError` pattern (a small `extends Error` class).

## See also

- Root `AGENTS.md` — the full port list and which agent consumes each.
- `agents/core/AGENTS.md` — the domain that consumes these interfaces.
- `agents/adapters/AGENTS.md` — the implementations that satisfy these interfaces.
