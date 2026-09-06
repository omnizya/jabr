#!/usr/bin/env bash
# Regenerate domain-specific context packs for coding agents.
# Usage: ./scripts/regen-agent-context.sh
#
# Output: docs/agent-context/*.txt (one per domain) + INDEX.md
#
# Why split? The full repo is ~1.87M tokens — too big for any single context window.
# Splitting by domain lets agents load only the slice they need.

set -euo pipefail

cd "$(dirname "$0")/.."

REPO="./node_modules/.bin/repomix"
OUT="docs/agent-context"
HEADER_PREFIX="Jabr — regenerated $(date -u +%Y-%m-%dT%H:%M:%SZ). Do NOT edit by hand."

rm -f "$OUT"/*.txt "$OUT"/INDEX.md

echo "📦 Packing core (domain logic + ports)..."
"$REPO" --style plain --output-file-path-style target-relative \
  --include "agents/core/**/*.ts,agents/ports/**/*.ts,agents/types.ts" \
  --header-text "$HEADER_PREFIX\nCore Domain Logic — hexagonal ports & adapters. ZERO infrastructure imports in core." \
  --output "$OUT/core.txt" --quiet

echo "📦 Packing adapters (infrastructure implementations)..."
"$REPO" --style plain --output-file-path-style target-relative \
  --include "agents/adapters/**/*.ts,agents/security/**/*.ts,agents/data/**/*.ts" \
  --header-text "$HEADER_PREFIX\nAdapters & Security — concrete port implementations. All I/O lives here." \
  --output "$OUT/adapters.txt" --quiet

echo "📦 Packing composition roots + MCP server..."
"$REPO" --style plain --output-file-path-style target-relative \
  --include "agents/run/**/*.ts,mcp-servers/**/*.ts" \
  --header-text "$HEADER_PREFIX\nComposition Roots & MCP Server — wiring layer. No business logic." \
  --output "$OUT/composition.txt" --quiet

echo "📦 Packing scripts + shared utils..."
"$REPO" --style plain --output-file-path-style target-relative \
  --include "scripts/**/*.ts,src/**/*.ts" \
  --header-text "$HEADER_PREFIX\nScripts & Shared Utils — CLI, build, config." \
  --output "$OUT/scripts.txt" --quiet

echo "📦 Packing tests..."
"$REPO" --style plain --output-file-path-style target-relative \
  --include "tests/**/*.ts" \
  --header-text "$HEADER_PREFIX\nTests — unit + e2e. Run with: bun test" \
  --output "$OUT/tests.txt" --quiet

echo "📦 Packing config + docs..."
"$REPO" --style plain --output-file-path-style target-relative \
  --include "package.json,tsconfig.json,biome.json,bunfig.toml,AGENTS.md,CANONICAL.md,CHANGELOG.md,TODO.md,README.md,docs/**/*.md" \
  --header-text "$HEADER_PREFIX\nConfig + Docs — project manifest, architecture, changelog." \
  --output "$OUT/config.txt" --quiet

# ── Build INDEX.md ──
echo "📝 Building INDEX.md..."

{
  echo "# Jabr — Agent Context Index"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "This directory contains domain-split context packs for coding agents."
  echo "Load only the slice relevant to your task — don't stuff everything into context."
  echo ""
  echo "## Domain Packs"
  echo ""
  echo "| Pack | Scope | Files | Size |"
  echo "|------|-------|-------|------|"

  for f in "$OUT"/*.txt; do
    name="$(basename "$f" .txt)"
    files="$(grep -c '^File:' "$f" 2>/dev/null || echo "?")"
    size="$(du -h "$f" | cut -f1)"
    case "$name" in
      core)        scope="Domain logic + ports (hexagonal core)" ;;
      adapters)    scope="Infrastructure adapters + security" ;;
      composition) scope="Composition roots + MCP server" ;;
      scripts)     scope="CLI scripts + shared utils" ;;
      tests)       scope="Unit + e2e tests" ;;
      config)      scope="Config files + documentation" ;;
      *)           scope="—" ;;
    esac
    echo "| \`$name.txt\` | $scope | $files | $size |"
  done

  echo ""
  echo "## How to Use"
  echo ""
  echo '```bash'
  echo "# Load a single domain into an agent:"
  echo "cat docs/agent-context/core.txt"
  echo ""
  echo "# Search across all packs:"
  echo "rg 'MyPort' docs/agent-context/"
  echo ""
  echo "# Regenerate after significant changes:"
  echo "./scripts/regen-agent-context.sh"
  echo '```'
  echo ""
  echo "## opensrc Cache"
  echo ""
  echo "Pre-fetched dependency sources (read-only, cached at \`~/.opensrc/\`):"
  echo ""
  echo '```'
  opensrc list --json 2>/dev/null | jq -r '.packages[] | "  - \(.name)@\(.version)  →  \(.path)"' 2>/dev/null || echo "  (opensrc not available)"
  echo '```'
  echo ""
  echo "## Architecture Cheat Sheet"
  echo ""
  echo '```'
  echo "agents/"
  echo "├── core/          # Domain logic — ZERO infrastructure imports"
  echo "├── ports/         # Interfaces (import type only)"
  echo "├── adapters/      # Concrete implementations"
  echo "├── types.ts       # Shared types"
  echo "├── utils/         # JSON-RPC, CORS helpers"
  echo "└── run/           # Composition roots (wire ports → core)"
  echo "mcp-servers/       # MCP tool server (stdio)"
  echo "scripts/           # CLI, build, maintenance"
  echo "src/               # Shared config + constants"
  echo '```'
} > "$OUT/INDEX.md"

echo ""
echo "✅ Done. Packs:"
ls -lh "$OUT"/*.txt | awk '{print "   " $5 "  " $9}'
echo ""
echo "📇 Index: $OUT/index.md"
