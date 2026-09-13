- [x] cli `send` had no `all` guard — `send all` fell through to `Unknown agent: all`.
    Fixed (scripts/jabr-cli.ts `cmdSend`): `send` targets one agent by name; `all` now
    prints a clear error listing known agents and exit code 1. Verified live:
    `bun scripts/jabr-cli.ts send all "hello"` → "Cannot send to 'all' — send targets one
    agent by name." `status/start/stop/restart/logs all` already worked.
    Note: FIXME's "cli still uses old names" was stale — agent list is current
    (orchestrator, oracle, librarian, explorer, designer, fixer, scientist, verification,
    jarvis, mcp, acp-bridge). `verification` was missing from this FIXME's list.

- [x] bun test failures are service-dependent, not code defects. Verified:
    `bun test` unit suites (security/, config/, adapter units) → 178 pass, 0 fail.
    Failing suites need live services: `fixer-login-llm` / `fixer-login-disabled-full`
    require the 9Router LLM gateway (ConnectionRefused: localhost:20127), e2e suites need
    running agents. Run `bun run dev` first, then `bun test` for full pass.