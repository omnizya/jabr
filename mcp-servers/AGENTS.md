# mcp-servers — MCP Tool Server

The single MCP tool server (`tools.ts`) exposing filesystem, Python, and skill tools
to agents over stdio. Built with the `@modelcontextprotocol/sdk` `McpServer` and run
by Bun. This is a standalone composition root, not part of the hexagonal `agents/`
layers.

## Hard rules

- **Use the MCP SDK `McpServer`** and `StdioServerTransport`. Register tools with
  `server.registerTool(name, { description, inputSchema }, handler)`.
- **Validate inputs with `zod`** in the `inputSchema` (e.g. `z.string()`,
  `z.array(z.string())`).
- **All paths resolve relative to `process.cwd()`** — never hardcode absolute paths.
- **Aliased imports are the standard**: `@adapters/*` for shared adapters (e.g.
  `mcp-resources`, `subscription-manager`).
- **Node builtins use the `node:` prefix** — `node:fs`, `node:path`. Do not use bare
  `fs`/`path` (see inconsistencies).
- **Use `Bun.spawnSync` / `Bun.file`** for subprocess and file I/O where Bun-native
  APIs fit (e.g. `uv` for Python).

## De-facto tool shape

```ts
server.registerTool("read_file", {
  description: "Read a file from the project workspace",
  inputSchema: { path: z.string().describe("Relative file path") },
}, ({ path }) => {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) throw new Error(`File not found: ${path}`);
  return { content: [{ type: "text", text: `File: ${path}\n\n${readFileSync(full, "utf-8")}` }] };
});
```

- Tools return `{ content: [{ type: "text", text }] }`.
- Throw `Error` with a descriptive message on failure (the SDK surfaces it to the
  caller).
- Current tools: `read_file`, `write_file`, `run_python`, `calculate`,
  `save_skill`, `list_skills`, `install_python_dependency`.
- Resources are registered via `registerResources(server, ctx)` from
  `@adapters/mcp-resources` (jabr://world-state, tasks/{id}, skills, memory).

## Known inconsistencies to avoid

- `calculate` uses a tokenizer + recursive-descent parser (`safeCalculate` →
  `new Parser(tokenize(expression)).parse()`, ~line 369) — no `eval`. Extend the
  parser, not a regex guard, if you add operators.
- Keep the server single-file; don't split tools across files unless the count grows
  significantly.

## See also

- Root `AGENTS.md` — MCP tools/resources list and the `.python_env` convention.
- `agents/adapters/AGENTS.md` — `mcp-resources.ts` and `subscription-manager.ts`
  that this server composes.
