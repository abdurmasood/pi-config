# pi-config

My [pi](https://pi.dev) setup.

```bash
curl -fsSL https://raw.githubusercontent.com/abdurmasood/pi-config/main/install.sh | bash
```

Run again to update. Your existing settings and keybindings are never overwritten.

## Features

| | Keys | |
|---|---|---|
| Ask mode | `⇧Tab` `/ask` | Read-only: edits blocked, risky commands ask first |
| Context footer | `⌥C` `/ctx` | Minimal footer, `⌥C` for a context breakdown |
| Thinking level | `⌥T` | Moved from `⇧Tab` |
| Theme | | `black-mono` |

`⌥` keys need *Option as Alt* enabled in your terminal.

## Develop

```bash
git clone https://github.com/abdurmasood/pi-config && cd pi-config && ./install.sh --dev
```

Edit → `./scripts/check.sh` → `/reload` → commit.
