#!/usr/bin/env bash
# Type-check every extension and run tests/*.test.ts against the installed pi version.
#
#   ./scripts/check.sh
#
# Works in a scratch copy under ~/.cache/pi-config-check so nothing (node_modules etc.)
# is ever created inside the repo; pi must load host packages through its own mapping.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/pi-config-check"
WORK="$CACHE/work"

# Locate pi's node_modules (managed install first, then a global npm install)
PI_NM=""
if [ -f "$AGENT_DIR/install/current-version" ]; then
	PI_NM="$AGENT_DIR/install/releases/$(cat "$AGENT_DIR/install/current-version")/node_modules"
fi
if [ ! -d "$PI_NM/@earendil-works/pi-coding-agent" ]; then
	PI_NM="$(npm root -g 2>/dev/null || true)"
fi
[ -d "$PI_NM/@earendil-works/pi-coding-agent" ] || { echo "Could not find pi's installed packages." >&2; exit 1; }

# One-time toolchain
if [ ! -x "$CACHE/node_modules/.bin/tsc" ]; then
	echo "Setting up type-check toolchain in $CACHE (one time)…"
	mkdir -p "$CACHE"
	[ -f "$CACHE/package.json" ] || echo '{"private":true}' > "$CACHE/package.json"
	(cd "$CACHE" && npm install --silent --no-audit --no-fund typescript@5 @types/node >/dev/null)
fi

# Fresh scratch copy with pi's packages linked in
rm -rf "$WORK"
mkdir -p "$WORK/node_modules/@earendil-works"
for p in "$PI_NM"/@earendil-works/*; do ln -s "$p" "$WORK/node_modules/@earendil-works/$(basename "$p")"; done
ln -s "$CACHE/node_modules/@types" "$WORK/node_modules/@types"
cp -R "$ROOT/extensions" "$WORK/extensions"
[ -d "$ROOT/tests" ] && cp -R "$ROOT/tests" "$WORK/tests"

echo '{"type":"module"}' > "$WORK/package.json"
cat > "$WORK/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "allowImportingTsExtensions": true,
    "preserveSymlinks": true,
    "types": ["node"]
  },
  "include": ["extensions/**/*.ts", "tests/**/*.ts"]
}
EOF

echo "Type-checking (pi $(basename "$(dirname "$PI_NM")"))…"
if ! (cd "$WORK" && "$CACHE/node_modules/.bin/tsc" -p . 2>&1 | sed "s#^#  #"; exit "${PIPESTATUS[0]}"); then
	echo "✗ Type errors (paths are relative to the repo)"; exit 1
fi
echo "✓ Types OK"

shopt -s nullglob
tests=("$WORK"/tests/*.test.ts)
if [ ${#tests[@]} -gt 0 ]; then
	echo "Running tests…"
	for t in "${tests[@]}"; do
		if (cd "$WORK" && "$PI_NM/.bin/jiti" "$t"); then echo "✓ $(basename "$t")"
		else echo "✗ $(basename "$t")"; exit 1; fi
	done
fi
echo "All checks passed."
