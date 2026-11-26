# pi-config

My setup for the [pi](https://pi.dev) coding agent: extensions, keybindings, themes, skills, and prompts, installable on any machine with one command.

## Install / update

```bash
curl -fsSL https://raw.githubusercontent.com/abdurmasood/pi-config/main/install.sh | bash
```

Run the same command again any time to update. Then restart pi or run `/reload`.

The installer:
- installs this repo as a pi package (`pi install git:github.com/abdurmasood/pi-config`), or updates it if already installed
- adds the keybindings from `keybindings.json` to `~/.pi/agent/keybindings.json`
- adds the defaults from `settings.defaults.json` to `~/.pi/agent/settings.json`

It only ever **adds missing** keybindings and settings. Values you've already set are never overwritten, so your own tweaks survive updates.

## Features

| Feature | Keys | What it does |
|---|---|---|
| **Ask mode** | `⇧Tab` (also `⌥R`, `/ask`) | Agent can read and investigate but not change anything. `edit`/`write` blocked, destructive shell commands blocked, uncertain commands and unknown tools ask you first. Badge `◉ ask` in the footer. |
| **Context footer** | `⌥C` (also `/ctx`) | Minimal footer: `folder · branch    model · thinking   ◑ 48%`. The pie turns yellow at 50% and red at 80%. `⌥C` switches to a breakdown of what fills the context (system, chat, tools, files, summaries). |
| Thinking level | `⌥T` | Pi's built-in thinking cycle, moved from `⇧Tab`. |
| Theme | | `black-mono` |
| `pi-config` skill | | Tells the agent where pi changes belong, so asking pi to customize itself edits the right place. |

`⌥` shortcuts need Option to act as Alt in your terminal (Orca: Settings → Terminal → *Option as Alt*; iTerm2: Profiles → Keys → Left Option = Esc+; Terminal.app: Profiles → Keyboard → *Use Option as Meta key*).

## Customizing on your own machine

- **Add your own stuff** (extensions, skills, prompts, keybindings) in the usual `~/.pi/agent/` folders. It lives alongside this package.
- **Turn off one piece**, e.g. to use your own footer instead:
  ```json
  "packages": [
    { "source": "git:github.com/abdurmasood/pi-config",
      "extensions": ["!extensions/context-footer.ts"] }
  ]
  ```
- **Make it your own**: fork this repo and use a dev install of your fork (below) with `PI_CONFIG_REPO=<you>/pi-config`.

Don't edit pi's copy in `~/.pi/agent/git/`. Updates reset it.

## Developing

```bash
git clone https://github.com/abdurmasood/pi-config ~/Development/Rafey/pi-config
cd ~/Development/Rafey/pi-config
./install.sh --dev
```

A dev install points pi straight at the clone (no copy), symlinks `keybindings.json`, and adds a pointer to `~/.pi/agent/AGENTS.md` so every session knows where pi changes go. If the machine had the GitHub install, it is removed so nothing loads twice.

Workflow: edit → `./scripts/check.sh` → `/reload` in pi → commit and push. Other machines pick it up by re-running the install command.

```
extensions/   pi extensions (*.ts, or <name>/index.ts)
skills/       skills (<name>/SKILL.md)
prompts/      prompt templates (<name>.md → /<name>)
themes/       themes (*.json)
tests/        tests run by scripts/check.sh
keybindings.json        keybindings merged/linked into ~/.pi/agent
settings.defaults.json  settings added to ~/.pi/agent/settings.json if missing
install.sh              installer (user and --dev modes)
scripts/check.sh        type-check against the installed pi + run tests
```
