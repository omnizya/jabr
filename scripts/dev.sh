#!/usr/bin/env bash
# Dev launcher: orchestrator owns the realtime websocket server; every other
# runner bridges lifecycle events to it via JABR_REALTIME_PORT.
set -u

# Canonical ports — single source of truth: src/constants/ecosystem.ts.
declare -A JABR_PORT
while IFS='|' read -r key val; do
  JABR_PORT[$key]="$val"
done < <(cd "$(dirname "${BASH_SOURCE[0]}")/.." && bun -e 'import("./src/constants/ecosystem.ts").then((m) => { for (const [k, v] of Object.entries(m.JABR_PORTS)) console.log(`${k}|${v}`); })')

pids=()
cleanup() {
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

start() {
  local name="$1"; shift
  JABR_REALTIME_PORT="${JABR_PORT[realtime]}" bun "$@" &
  pids+=($!)
  echo "[dev] started $name (pid ${pids[-1]})"
}

# Orchestrator owns the realtime server — no JABR_REALTIME_PORT for it.
bun src/runtime/orchestrator.ts &
pids+=($!)
echo "[dev] started orchestrator (pid ${pids[-1]})"

start oracle src/runtime/agents/oracle.ts
start librarian src/runtime/agents/librarian.ts
start explorer src/runtime/agents/explorer.ts
start designer src/runtime/agents/designer.ts
start fixer src/runtime/agents/fixer.ts
start jarvis src/runtime/agents/jarvis.ts
start scientist src/runtime/agents/scientist.ts
start mcp src/protocols/mcp/server/tools.ts
start acp-bridge src/runtime/acp-bridge.ts

wait