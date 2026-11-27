<p align="center">
  <img src="docs/banner.svg" alt="π pi-config: my setup for the pi coding agent" width="100%">
</p>

## Install

Needs [pi](https://pi.dev). Then run:

```bash
curl -fsSL https://raw.githubusercontent.com/abdurmasood/pi-config/main/install.sh | bash
```

Run the same command again to update. Your existing settings and keybindings are never overwritten.

## Ask mode · `⇧Tab`

The agent can investigate but not change anything. Risky commands ask first.

![Ask mode](docs/ask-mode.svg)

## Context footer · `⌥C`

Folder, branch, model, and how full the context is.

![Context footer](docs/footer.svg)

`⌥C` shows what's filling it.

![Context breakdown](docs/context.svg)

## Also

- `⌥T` cycles thinking level (moved from `⇧Tab`)
- `black-mono` theme

`⌥` keys need *Option as Alt* enabled in your terminal.

## Develop

```bash
git clone https://github.com/abdurmasood/pi-config && cd pi-config && ./install.sh --dev
```

Edit → `./scripts/check.sh` → `/reload` → commit. `./scripts/previews.sh` regenerates the images.
