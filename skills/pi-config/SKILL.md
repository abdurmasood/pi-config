---
name: pi-config
description: Use whenever the user asks to change, add, remove, or fix anything about their pi setup itself - extensions, keybindings/shortcuts, the footer, ask mode, themes, skills, prompt templates, or pi settings. Explains where each change must be made so it isn't lost or loaded twice.
---

# pi-config

The user's pi customizations are distributed as the **pi-config** package
(github.com/abdurmasood/pi-config). Where a change belongs depends on how this
machine installed it, so always start with step 1.

## 1. Find out what kind of install this machine has

Read `~/.pi/agent/settings.json` (or `$PI_CODING_AGENT_DIR/settings.json`) and look at `"packages"`:

| Entry | Install type | Go to |
|---|---|---|
| A local path whose `package.json` has `"name": "pi-config"` | **Dev install**: that folder is a git clone the user edits | Section 2 |
| `git:github.com/abdurmasood/pi-config` (or a fork) | **User install**: pi manages a hidden clone | Section 3 |
| Neither | Not installed | Tell the user and point them at the README install command |

## 2. Dev install: edit the repo, never ~/.pi/agent

All changes go into the repo folder from the settings entry:

| Change | Where |
|---|---|
| New or changed extension | `extensions/<name>.ts`, or `extensions/<name>/index.ts` for multi-file ones |
| Keybindings | `keybindings.json` (`~/.pi/agent/keybindings.json` is a symlink to it) |
| Skill | `skills/<name>/SKILL.md` |
| Prompt template | `prompts/<name>.md` (every `.md` there becomes a `/<name>` command, so no READMEs in that folder) |
| Theme | `themes/<name>.json` |
| Setting new machines should get | `settings.defaults.json` (the installer only adds keys that are missing, never overwrites) |

Rules:
- Never put pi-config features in `~/.pi/agent/extensions/`. Pi would load them twice next to the package. That folder only holds Orca's own `orca-*.ts` files, so leave those alone.
- Before adding a shortcut, check `keybindings.json` and every `registerShortcut(` in `extensions/` for collisions. Some built-in keys are reserved (pi skips extension shortcuts on them), e.g. `shift+tab` was freed by moving `app.thinking.cycle` to `alt+t` in `keybindings.json`. Check `/hotkeys` or pi's `docs/keybindings.md`.
- Extensions import only host packages (`@earendil-works/pi-coding-agent`, `pi-tui`, `pi-ai`, `pi-agent-core`, `typebox`). Never add them to `dependencies` and never create `node_modules` in the repo.
- Add or update a test in `tests/<name>.test.ts` for non-trivial logic. Tests use plain `node:assert` with mocked `pi`/`ctx` objects; see the existing tests.
- Verify with `./scripts/check.sh` (type-checks against the installed pi version and runs the tests).
- Tell the user to run `/reload` in pi.
- Update the feature list in `README.md` when a user-visible feature or key changes.
- Commit with a clear message. Push only when the user asks.

## 3. User install: never edit pi's hidden clone

The clone lives at `~/.pi/agent/git/github.com/<owner>/pi-config`. `pi update`
resets it to GitHub, so edits there are silently lost. Instead:

- **Personal additions** (new extension, skill, prompt, theme, keybinding): put them in the normal local places, e.g. `~/.pi/agent/extensions/`, `~/.pi/agent/skills/`, `~/.pi/agent/keybindings.json`. Re-running the installer never overwrites keys the user already set.
- **Replace one pi-config piece** (e.g. their own footer): turn that piece off in `settings.json`, then add the local version:
  ```json
  "packages": [
    { "source": "git:github.com/abdurmasood/pi-config",
      "extensions": ["!extensions/context-footer.ts"] }
  ]
  ```
- **Bigger or long-term changes**: suggest forking the repo, cloning the fork, and running `PI_CONFIG_REPO=<user>/pi-config ./install.sh --dev` in it. That switches this machine to a dev install of the fork, and the installer removes the GitHub install automatically.
- If the user owns pi-config and wants the change shipped everywhere, it has to be made on the dev machine (or by cloning and running `./install.sh --dev` here).

## Always

- Never read, print, or commit `~/.pi/agent/auth.json` or anything in `sessions/`.
- Pi's own docs (extension API, keybindings, themes, packages) are in the installed release:
  `~/.pi/agent/install/releases/$(cat ~/.pi/agent/install/current-version)/node_modules/@earendil-works/pi-coding-agent/docs`.
  Read the relevant doc before using an API you haven't checked.
