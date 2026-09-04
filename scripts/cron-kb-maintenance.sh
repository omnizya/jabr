#!/usr/bin/env bash
# cron-kb-maintenance.sh — wrapper for kb-maintenance.ts cron runs.
# Runs the knowledge-base maintenance script, logs output, and only emits
# to stdout on failure so the cron job stays silent on success.
#
# Registered as: kb-maintenance (weekly, Sundays 03:00)

set -euo pipefail

PROJECT_ROOT="/home/m7r/Work/agent-lab"
LOG_FILE="${PROJECT_ROOT}/memory/cron-kb-maintenance.log"

cd "$PROJECT_ROOT"

# Run maintenance; capture stdout+stderr to log
if bun scripts/kb-maintenance.ts --quiet >> "$LOG_FILE" 2>&1; then
  exit 0
else
  # On failure, report via stdout so the cron job delivers an alert
  echo "[$LOG_FILE] kb-maintenance failed at $(date -Iseconds)." >&2
  echo "--- Last 20 log lines ---"
  tail -n 20 "$LOG_FILE" 2>/dev/null | sed 's/^/  /'
  exit 1
fi
