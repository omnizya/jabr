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

# name:run-script:port
AGENTS=(
  "orchestrator:orchestrator:4000"
  "oracle:oracle:4001"
  "librarian:librarian:4002"
  "explorer:explorer:4003"
  "designer:designer:4004"
  "fixer:fixer:4005"
  "scientist:scientist:4006"
  "jarvis:jarvis:1337"
)

stop() {
  echo "Stopping tmux session '$SESSION' and agent processes..."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # Kill any lingering agent run processes (safest: match the run scripts).
  pkill -f "agents/run/.*\.ts" 2>/dev/null || true
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
  pkill -f "agents/run/.*\.ts" 2>/dev/null || true
  sleep 1

  # Create the session with the first agent in the first pane.
  local first_name first_script
  IFS=':' read -r first_name first_script <<< "${AGENTS[0]}"
  tmux new-session -d -s "$SESSION" -n "$first_name" \
    "cd '$ROOT' && bun agents/run/$first_script.ts 2>&1 | tee /tmp/jabr-$first_name.log"

  # Add a pane for each remaining agent.
  for entry in "${AGENTS[@]:1}"; do
    local name script
    IFS=':' read -r name script <<< "$entry"
    tmux split-window -t "$SESSION" \
      "cd '$ROOT' && bun agents/run/$script.ts 2>&1 | tee /tmp/jabr-$name.log"
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
