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
#
# Requires: tmux, bun. Run from the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${JABR_TMUX_SESSION:-jabr}"

# name:run-script
AGENTS=(
  "orchestrator:orchestrator"
  "oracle:oracle"
  "librarian:librarian"
  "explorer:explorer"
  "designer:designer"
  "fixer:fixer"
  "scientist:scientist"
  "jarvis:jarvis"
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
    tmux split-window -t "$SESSION" -h -l 50% \
      "cd '$ROOT' && bun agents/run/$script.ts 2>&1 | tee /tmp/jabr-$name.log"
    tmux select-layout -t "$SESSION" tiled 2>/dev/null || true
  done

  # Give agents a moment to boot, then show the layout.
  sleep 2
  tmux select-layout -t "$SESSION" tiled 2>/dev/null || true
  echo "Started session '$SESSION' with ${#AGENTS[@]} agent panes."
  echo "  attach:  scripts/run-agents-tmux.sh attach"
  echo "  stop:    scripts/run-agents-tmux.sh stop"
  echo "  logs:    tail -f /tmp/jabr-<agent>.log"
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  attach) attach ;;
  *)
    echo "Usage: $0 {start|stop|attach}" >&2
    exit 1
    ;;
esac
