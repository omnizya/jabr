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

## Known inconsistencies to avoid

- `resource-port.ts` (`ResourcePort`) is **dead** — never implemented or consumed.
  Do not add to it; prefer removing it.
- `discovery-port.ts` `getAgentNames()` and `toUrlMap()` are **dead** — implemented
  in `DynamicRegistry` but never called. Don't add unused methods.
- Keep value exports rare; if a port needs an error type, follow the
  `BudgetExhaustedError` pattern (a small `extends Error` class).

## See also

- Root `AGENTS.md` — the full port list and which agent consumes each.
- `agents/core/AGENTS.md` — the domain that consumes these interfaces.
- `agents/adapters/AGENTS.md` — the implementations that satisfy these interfaces.
