# agents/utils — Shared Helpers

Small, pure, dependency-free helpers shared across layers. Currently a single file
(`rpc.ts`) with JSON-RPC 2.0 types and response builders used by the A2A server and
ACP bridge.

## Hard rules

- **Pure and dependency-free.** No I/O, no `fetch`, no `node:*`, no side effects.
  Functions take inputs and return values.
- **No imports from adapters or core.** Utils may import only other utils or shared
  types.
- **`import type` for type-only imports** (`verbatimModuleSyntax`).
- **Export everything you define** — utils are meant to be consumed; don't leave
  private helpers here.

## De-facto patterns (`rpc.ts`)

```ts
export interface JSONRPCRequest extends JSONRPCDefaults { method: string; params?: unknown; }

export function ok(id: SomeId, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

export function err(id: SomeId, code: number, message: string): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export const corsHeaders = { "Access-Control-Allow-Origin": "*" } as const;
```

- JSON-RPC helpers: `ok` / `err` / `notification` builders, `corsHeaders` /
  `corsPreflightHeaders` constants.
- Consumers import via `@utils/rpc` (the alias). Prefer `@utils/...` over
  `@agents/utils/...` (see inconsistencies).

## Known inconsistencies to avoid

- `a2a-client.ts` imports `@agents/utils/rpc` — use `@utils/rpc` for consistency.
- Keep the file focused on JSON-RPC; add new pure helpers here only if they are
  genuinely shared across layers. Prefer co-locating single-use helpers in the file
  that uses them.

## See also

- Root `AGENTS.md` — protocol layers (ACP/A2A/MCP) that consume these helpers.
- `agents/adapters/AGENTS.md` — the A2A server and ACP bridge that use `@utils/rpc`.
