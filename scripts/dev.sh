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
bun agents/run/orchestrator.ts &
pids+=($!)
echo "[dev] started orchestrator (pid ${pids[-1]})"

start oracle agents/run/oracle.ts
start librarian agents/run/librarian.ts
start explorer agents/run/explorer.ts
start designer agents/run/designer.ts
start fixer agents/run/fixer.ts
start jarvis agents/run/jarvis.ts
start scientist agents/run/scientist.ts
start mcp mcp-servers/tools.ts
start acp-bridge agents/run/acp-bridge.ts

wait