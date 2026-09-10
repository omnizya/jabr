#!/usr/bin/env bash
#
# run-agents-tmux.sh — run every Jabr agent in its own tmux pane so you can
# watch each agent's logs live during a smoke test.
#
# Creates a tmux session named "jabr" (override with JABR_TMUX_SESSION) with one
# pane per agent. Each pane runs the agent and streams its stdout/stderr.
#
# Usage:
#   scripts/run-agents-tmux.sh          # start all agents in tmux panes
#   scripts/run-agents-tmux.sh stop     # kill the tmux session + agent processes
#   scripts/run-agents-tmux.sh attach   # attach to the running session
#   scripts/run-agents-tmux.sh status   # show session + per-agent port health
#
# Requires: tmux, bun, curl. Run from the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${JABR_TMUX_SESSION:-jabr}"

# Canonical ports — single source of truth: src/constants/ecosystem.ts.
declare -A JABR_PORT
while IFS='|' read -r key val; do
  JABR_PORT[$key]="$val"
done < <(cd "$ROOT" && bun -e 'import("./src/constants/ecosystem.ts").then((m) => { for (const [k, v] of Object.entries(m.JABR_PORTS)) console.log(`${k}|${v}`); })')

# name:entry-path:port
AGENTS=(
  "orchestrator:src/runtime/orchestrator.ts:${JABR_PORT[orchestrator]}"
  "oracle:src/runtime/agents/oracle.ts:${JABR_PORT[oracle]}"
  "librarian:src/runtime/agents/librarian.ts:${JABR_PORT[librarian]}"
  "explorer:src/runtime/agents/explorer.ts:${JABR_PORT[explorer]}"
  "designer:src/runtime/agents/designer.ts:${JABR_PORT[designer]}"
  "fixer:src/runtime/agents/fixer.ts:${JABR_PORT[fixer]}"
  "scientist:src/runtime/agents/scientist.ts:${JABR_PORT[scientist]}"
  "jarvis:src/runtime/agents/jarvis.ts:${JABR_PORT[jarvis]}"
)

stop() {
  echo "Stopping tmux session '$SESSION' and agent processes..."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # Kill any lingering agent run processes (safest: match the run scripts).
  pkill -f "src/runtime/.*\.ts" 2>/dev/null || true
  echo "Stopped."
}

attach() {
  tmux attach-session -t "$SESSION"
}

# Poll each agent's agent-card endpoint until every one responds (or timeout).
wait_ready() {
  local deadline=$((SECONDS + 30))
  local all_ready=0
  while (( SECONDS < deadline )); do
    all_ready=1
    for entry in "${AGENTS[@]}"; do
      local name port
      IFS=':' read -r name _ port <<< "$entry"
      if ! curl -sf --max-time 1 "http://localhost:$port/.well-known/agent-card.json" >/dev/null 2>&1; then
        all_ready=0
        break
      fi
    done
    if (( all_ready )); then break; fi
    sleep 1
  done
  if (( all_ready )); then
    echo "All ${#AGENTS[@]} agents ready."
  else
    echo "Warning: not all agents became ready within 30s — check /tmp/jabr-*.log"
  fi
}

status() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' is not running."
    exit 1
  fi
  echo "Session '$SESSION' is running (${#AGENTS[@]} agent panes)."
  for entry in "${AGENTS[@]}"; do
    local name port
    IFS=':' read -r name _ port <<< "$entry"
    if curl -sf --max-time 1 "http://localhost:$port/.well-known/agent-card.json" >/dev/null 2>&1; then
      echo "  ✓ $name (:$port)"
    else
      echo "  ✗ $name (:$port)"
    fi
  done
}

start() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' already exists. Use 'stop' first, or 'attach' to view it."
    exit 1
  fi

  # Kill any lingering agent processes so ports are free.
  pkill -f "src/runtime/.*\.ts" 2>/dev/null || true
  sleep 1

  # Create the session with the first agent in the first pane.
  local first_name first_script
  IFS=':' read -r first_name first_script _port <<< "${AGENTS[0]}"
  tmux new-session -d -s "$SESSION" -n "$first_name" \
    "cd '$ROOT' && bun $first_script 2>&1 | tee /tmp/jabr-$first_name.log"

  # Add a pane for each remaining agent — bridge realtime events to the
  # orchestrator's websocket (JABR_REALTIME_PORT convention, same as dev.sh).
  for entry in "${AGENTS[@]:1}"; do
    local name script
    IFS=':' read -r name script _port <<< "$entry"
    tmux split-window -t "$SESSION" \
      "cd '$ROOT' && JABR_REALTIME_PORT=${JABR_PORT[realtime]} bun $script 2>&1 | tee /tmp/jabr-$name.log"
    tmux select-layout -t "$SESSION" tiled 2>/dev/null || true
  done

  # Wait for every agent to serve its agent card, then show the layout.
  wait_ready
  tmux select-layout -t "$SESSION" tiled 2>/dev/null || true
  echo "Started session '$SESSION' with ${#AGENTS[@]} agent panes."
  echo "  attach:  scripts/run-agents-tmux.sh attach"
  echo "  status:  scripts/run-agents-tmux.sh status"
  echo "  stop:    scripts/run-agents-tmux.sh stop"
  echo "  logs:    tail -f /tmp/jabr-<agent>.log"
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  attach) attach ;;
  status) status ;;
  *)
    echo "Usage: $0 {start|stop|attach|status}" >&2
    exit 1
    ;;
esac
