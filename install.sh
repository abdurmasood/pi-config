#!/usr/bin/env bash
# pi-config installer
#
# Install or update (run again any time to update):
#   curl -fsSL https://raw.githubusercontent.com/abdurmasood/pi-config/main/install.sh | bash
#
# Dev install (run inside your clone; pi loads the clone directly):
#   ./install.sh --dev
#
# Forks: set PI_CONFIG_REPO=<user>/<repo> (or edit the default below).

set -euo pipefail

REPO_SLUG="${PI_CONFIG_REPO:-abdurmasood/pi-config}"
BRANCH="${PI_CONFIG_BRANCH:-main}"
GIT_SOURCE="git:github.com/${REPO_SLUG}"
RAW_BASE="https://raw.githubusercontent.com/${REPO_SLUG}/${BRANCH}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SETTINGS="$AGENT_DIR/settings.json"
KEYBINDINGS="$AGENT_DIR/keybindings.json"
AGENTS_MD="$AGENT_DIR/AGENTS.md"
PACKAGE_NAME="pi-config"

MODE="user"
case "${1:-}" in
	--dev) MODE="dev" ;;
	"" ) ;;
	-h|--help)
		sed -n '2,10p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
		exit 0 ;;
	*) echo "Unknown option: $1 (use --dev or no arguments)" >&2; exit 1 ;;
esac

# ---------- helpers ----------

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

find_pi() {
	if command -v pi >/dev/null 2>&1; then command -v pi
	elif [ -x "$HOME/.pi/agent/bin/pi" ]; then echo "$HOME/.pi/agent/bin/pi"
	else return 1; fi
}

find_node() {
	if command -v node >/dev/null 2>&1; then command -v node
	elif [ -x "${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin/node" ]; then
		echo "${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin/node"
	else return 1; fi
}

PI="$(find_pi)" || die "pi is not installed. Install it first (https://pi.dev), then re-run this script."
NODE="$(find_node)" || die "Node.js not found (pi needs it). Install Node.js, then re-run this script."

# Prints the existing pi-config install as "dev <path>", "git <source>", or nothing.
# Detects any local package whose package.json name is pi-config, and the git source.
detect_install() {
	[ -f "$SETTINGS" ] || return 0
	"$NODE" - "$SETTINGS" "$AGENT_DIR" "$PACKAGE_NAME" "$REPO_SLUG" <<'JS'
const fs = require("fs"), path = require("path");
const [settingsPath, agentDir, pkgName, slug] = process.argv.slice(2);
let s; try { s = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { process.exit(0); }
for (const p of s.packages ?? []) {
  const src = typeof p === "string" ? p : p?.source;
  if (typeof src !== "string") continue;
  if (src.includes(`github.com/${slug}`)) { console.log(`git ${src}`); continue; }
  if (/^(npm:|git:|https?:|ssh:)/.test(src)) continue;
  const dir = path.resolve(agentDir, src.replace(/^~(?=\/)/, process.env.HOME));
  try {
    const name = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name;
    if (name === pkgName) console.log(`dev ${dir}`);
  } catch {}
}
JS
}

# Adds keys from $1 (JSON file) into $2 (JSON file) only where $2 doesn't have them.
# Never overwrites existing values. Prints the keys it added.
merge_missing_keys() {
	"$NODE" - "$1" "$2" <<'JS'
const fs = require("fs");
const [srcPath, dstPath] = process.argv.slice(2);
const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
let dst = {};
if (fs.existsSync(dstPath)) {
  try { dst = JSON.parse(fs.readFileSync(dstPath, "utf8")); }
  catch { console.error(`Could not parse ${dstPath}; leaving it unchanged.`); process.exit(2); }
}
const added = [];
for (const [k, v] of Object.entries(src)) {
  if (k === "$schema" && dst[k] === undefined) { dst[k] = v; continue; }
  if (!(k in dst)) { dst[k] = v; added.push(k); }
}
if (added.length) {
  if (fs.existsSync(dstPath)) fs.copyFileSync(dstPath, `${dstPath}.bak`);
  fs.writeFileSync(dstPath, JSON.stringify(dst, null, 2) + "\n");
}
for (const k of added) console.log(k);
JS
}

apply_defaults() { # $1 = dir or URL base containing keybindings.json + settings.defaults.json
	local base="$1" tmp
	tmp="$(mktemp -d)"
	for f in keybindings.json settings.defaults.json; do
		if [ -f "$base/$f" ]; then cp "$base/$f" "$tmp/$f"
		elif [[ "$base" == http* ]]; then curl -fsSL "$base/$f" -o "$tmp/$f" || true
		fi
	done

	if [ "$MODE" = "user" ] && [ -f "$tmp/keybindings.json" ]; then
		if [ -L "$KEYBINDINGS" ]; then
			info "keybindings.json is a symlink; leaving it alone"
		else
			local added
			added="$(merge_missing_keys "$tmp/keybindings.json" "$KEYBINDINGS")" || true
			if [ -n "$added" ]; then info "Keybindings added: $(echo "$added" | paste -sd ',' - | sed 's/,/, /g')"
			else info "Keybindings: nothing to add (your existing ones are kept)"; fi
		fi
	fi

	if [ -f "$tmp/settings.defaults.json" ]; then
		local added
		added="$(merge_missing_keys "$tmp/settings.defaults.json" "$SETTINGS")" || true
		if [ -n "$added" ]; then info "Settings added: $(echo "$added" | paste -sd ',' - | sed 's/,/, /g')"
		else info "Settings: nothing to add (your existing ones are kept)"; fi
	fi
	rm -rf "$tmp"
}

mkdir -p "$AGENT_DIR"
EXISTING="$(detect_install || true)"
EXISTING_DEV="$(echo "$EXISTING" | sed -n 's/^dev //p' | head -1)"
EXISTING_GIT="$(echo "$EXISTING" | sed -n 's/^git //p' | head -1)"

# ---------- user mode ----------

if [ "$MODE" = "user" ]; then
	bold "pi-config: installing from github.com/${REPO_SLUG}"

	if [ -n "$EXISTING_DEV" ]; then
		die "This machine has a dev install ($EXISTING_DEV). Update it with 'git pull' in that folder instead."
	fi

	if [ -n "$EXISTING_GIT" ]; then
		info "Already installed, updating…"
		"$PI" update "$EXISTING_GIT"
	else
		"$PI" install "$GIT_SOURCE"
	fi

	CLONE="$AGENT_DIR/git/github.com/${REPO_SLUG}"
	if [ -d "$CLONE" ]; then apply_defaults "$CLONE"; else apply_defaults "$RAW_BASE"; fi

	echo
	bold "Done. Restart pi (or run /reload) to load the changes."
	info "Re-run the same command any time to update."
	exit 0
fi

# ---------- dev mode ----------

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
[ -f "$SCRIPT_PATH" ] || die "--dev must be run from a clone: git clone https://github.com/${REPO_SLUG} && cd pi-config && ./install.sh --dev"
REPO="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"

bold "pi-config: dev install from $REPO"

if [ -n "$EXISTING_GIT" ]; then
	info "Removing the GitHub install ($EXISTING_GIT) so nothing loads twice…"
	"$PI" remove "$EXISTING_GIT"
fi

if [ -n "$EXISTING_DEV" ] && [ "$EXISTING_DEV" != "$REPO" ]; then
	die "Another dev install is configured at $EXISTING_DEV. Remove it first: pi remove $EXISTING_DEV"
fi

if [ "$EXISTING_DEV" = "$REPO" ]; then
	info "pi already loads this folder"
else
	"$PI" install "$REPO"
fi

# keybindings.json -> symlink into the repo
if [ -L "$KEYBINDINGS" ] && [ "$(readlink "$KEYBINDINGS")" = "$REPO/keybindings.json" ]; then
	info "keybindings.json already linked"
else
	if [ -e "$KEYBINDINGS" ] || [ -L "$KEYBINDINGS" ]; then
		BACKUP="$KEYBINDINGS.bak.$(date +%Y%m%d%H%M%S)"
		mv "$KEYBINDINGS" "$BACKUP"
		warn "Existing keybindings.json moved to $BACKUP (the repo copy is now used)"
	fi
	ln -s "$REPO/keybindings.json" "$KEYBINDINGS"
	info "keybindings.json linked to the repo"
fi

apply_defaults "$REPO"

# Pointer in the global AGENTS.md so every session knows where pi changes go
MARK_START="<!-- pi-config:start -->"
MARK_END="<!-- pi-config:end -->"
POINTER="My pi customizations (extensions, keybindings, themes, skills, prompts) live in the pi-config repo at $REPO. Load the pi-config skill before changing anything about pi. Never edit ~/.pi/agent/extensions directly."
if [ -f "$AGENTS_MD" ] && grep -qF "$MARK_START" "$AGENTS_MD"; then
	"$NODE" - "$AGENTS_MD" "$MARK_START" "$MARK_END" "$POINTER" <<'JS'
const fs = require("fs");
const [file, start, end, pointer] = process.argv.slice(2);
const s = fs.readFileSync(file, "utf8");
const re = new RegExp(`${start}[\\s\\S]*?${end}`);
fs.writeFileSync(file, s.replace(re, `${start}\n${pointer}\n${end}`));
JS
	info "AGENTS.md pointer up to date"
else
	{ [ -s "$AGENTS_MD" ] && echo; echo "$MARK_START"; echo "$POINTER"; echo "$MARK_END"; } >> "$AGENTS_MD"
	info "Added pi-config pointer to $AGENTS_MD"
fi

echo
bold "Done. Run /reload in pi (or restart it)."
info "Workflow: edit files in $REPO → /reload → git commit && git push"
