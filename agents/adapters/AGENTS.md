# agents/adapters — Concrete Implementations

The infrastructure layer: concrete implementations of the port interfaces. Adapters
own all I/O — HTTP, filesystem, subprocesses, external APIs. They are thin and
transport-specific (one per transport/backend).

## Hard rules

- **Every adapter implements a port**: `export class <Name> implements <Name>Port`.
  If it doesn't implement a port, it's either a helper or misplaced.
- **Never import from `agents/core`.** Adapters depend on ports (for types) and
  shared types only — no domain logic.
- **`import type` for port/types imports** (`verbatimModuleSyntax`).
- **Aliased imports are the standard**: `@ports/<name>`, `@agents/types`,
  `@utils/rpc`. Do NOT use `@agents/ports/...` or `@agents/utils/...`.
- **Node builtins use the `node:` prefix** — `node:fs`, `node:path`,
  `node:child_process`. Do not use bare `fs`/`path`.
- **No hardcoded absolute paths.** Config comes from constructor options or
  `process.env` with `??` defaults; paths resolve via `process.cwd()`.

## De-facto adapter shape

```ts
export class Search9Router implements SearchPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  constructor(opts?: { baseUrl?: string; apiKey?: string; model?: string }) {
    this.baseUrl = (opts?.baseUrl ?? process.env.NINEROUTER_URL ?? "").replace(/\/$/, "");
    this.apiKey = opts?.apiKey ?? process.env.NINEROUTER_KEY ?? "";
  }
  async search(query: string): Promise<SearchResult[]> {
    // fetch `${this.baseUrl}/v1/search`, throw on !res.ok, map/return typed result
  }
}
```

- External-service adapters share a near-identical shape: `baseUrl`/`apiKey`/`model`
  fields, `fetch` to `${baseUrl}/v1/...`, `console.error("[Prefix] ...")` on failure.
- Filesystem adapters (`MemoryFS`, `SkillFS`, `MemPalaceAdapter`) take a default path
  in the constructor (e.g. `constructor(private dir = "skills")`) and use `node:fs`.

## Error handling (two-tier)

Adapters **throw** `Error` with a descriptive message on external failure
(`throw new Error("[Search9Router] ...")`); core agents catch and fall back. Log
failures with `console.error("[Component] ...")` before throwing.

## Known inconsistencies to avoid

- `http/a2a-server.ts:28,35` casts config `as any` — extend `A2AServerConfig`
  instead of casting around it.
- `llm/openai.ts:51` reads `data.choices[0]` off an `as any` — guard empty arrays.
- `subscription-manager.ts:24` uses `get(uri)!` — prefer a local variable over a
  non-null assertion.

> Note: earlier import-alias issues (`@agents/ports/...`, bare `fs`/`path`) have been
> fixed in code — `mcp-client.ts`, `a2a-client.ts`, `llm/openai.ts` use `@ports/*` /
> `@utils/*`, and `mcp-resources.ts` / `mem-palace.ts` use `node:fs` / `node:path`.
> Keep it that way; don't reintroduce the old aliases.

## See also

- Root `AGENTS.md` — the adapter list and which port each implements.
- `agents/ports/AGENTS.md` — the interfaces adapters satisfy.
- `agents/run/AGENTS.md` — where adapters get instantiated and wired.
