#!/usr/bin/env bash
# Regenerate the README preview images (docs/*.svg) from the real extension code.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WORK="$("$ROOT/scripts/check.sh" --prepare | tail -1)"
PI_NM="$(dirname "$(readlink "$WORK/node_modules/@earendil-works/pi-coding-agent")")/.."
cd "$WORK"
OUT_DIR="$ROOT/docs" THEME_FILE="$ROOT/themes/black-mono.json" "$PI_NM/.bin/jiti" scripts/previews.ts
