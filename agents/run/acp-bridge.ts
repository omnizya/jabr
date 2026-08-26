/**
 * Composition root — ACP stdio bridge
 *
 * Starts the StdioBridge adapter, which reads ACP JSON-RPC lines from stdin
 * and proxies tasks to the orchestrator via A2A HTTP.
 *
 * The orchestrator URL is read from ORCHESTRATOR_URL (resolves the hardcoded
 * URL FIXME in the original acp-bridge.ts), defaulting to localhost:4000.
 */

import { StdioBridge } from "../adapters/http/stdio-bridge.ts";

// @ts-ignore - Bun provides import.meta.main
if (import.meta.main) {
  const bridge = new StdioBridge({
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000",
  });
  bridge.start();
  process.stderr.write(
    "ACP stdio bridge ready — awaiting IDE connection on stdin\n",
  );
}
