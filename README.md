# click-to-edit-ui

A plugin for [Claude Code](https://claude.com/claude-code) and [Codex](https://developers.openai.com/codex/) that lets you **point at web UI components instead of describing them**.

![Demo: Alt-clicking three components on a steampunk shop page, then requesting edits by number](assets/demo.gif)

Editing a rendered UI with an agent is slow when you have to explain what you mean in words — *"the third dot in the second row of the sidebar…"*. With this skill, the agent injects a small probe into the page open in your browser; you **Alt-click** the components you want changed, each click gets a numbered badge (1, 2, 3…), and you request edits by number:

> "Make **1** bigger, change **2** to copper, and add gear emojis to **3**."

The agent reads the ordered selection back from the page (`window.__probe.list()`), maps each element to its source, edits the code, reloads the page, and re-arms the probe — so the click → edit → verify loop never breaks.

## How it works

- **Alt/Option + click** — queue a component (badge pinned on it + listed in a top-right HUD)
- **Alt + hover** — dashed outline preview of what would be selected
- **Alt + Shift + click** — clear the queue
- **Drag the ⠿ grip** — move the HUD anywhere it's out of your way (double-click the grip to reset it, **−** to collapse it to its title bar)
- Normal clicks are untouched, so the page stays fully usable

The probe is registered as a navigation init-script, so it survives page reloads — including your own Cmd+R. The HUD's position and collapsed state persist across those reloads too, for as long as the tab stays open.

## Requirements

A [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) connection (the skill uses its `navigate_page` and `evaluate_script` tools), plus Node.js (LTS), npm, and current stable Chrome.

Add the MCP server for your client:

**Claude Code**

```sh
claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest
```

`--scope user` makes the server available in every project. Omit it to add it only to the current one — local is the default scope. Confirm it connected with `claude mcp list`, or the `/mcp` panel inside a session.

**Codex**

```sh
codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
```

The commands above follow the upstream recommendation and always select the current `latest` release. If your npm supports [`min-release-age`](https://docs.npmjs.com/cli/using-npm/config/#min-release-age), you can add a two-day observation window without pinning and maintaining a version yourself:

```sh
# Claude Code
claude mcp add chrome-devtools --scope user -- npx --min-release-age=2 chrome-devtools-mcp@latest

# Codex
codex mcp add chrome-devtools -- npx --min-release-age=2 chrome-devtools-mcp@latest
```

This still updates automatically, but npm will not select a version during its first two days after publication. It reduces exposure to newly published malicious or broken releases; it does not make the package inherently trusted. Older npm releases may reject the option, in which case use the standard upstream command above.

Restart the client after adding the MCP server.

## Install

### Claude Code

Add this repository as a marketplace, then install the plugin — both run inside a Claude Code session:

```text
/plugin marketplace add hyemin-ht-kang/click-to-edit-ui
/plugin install click-to-edit-ui@click-to-edit-ui
```

### Codex

Add this repository as a Git marketplace, then install the plugin:

```sh
codex plugin marketplace add hyemin-ht-kang/click-to-edit-ui
codex plugin add click-to-edit-ui@click-to-edit-ui
```

Start a new Codex thread after installation so the skill and MCP tools are loaded.

## Usage

Ask your agent to *"set up the click probe"* — or just run `/click-to-edit-ui` (in Claude Code) or `$click-to-edit-ui` (in Codex).

That's the whole setup. The agent opens your dev server or local HTML file in the chrome-devtools browser and injects the probe for you. Alt-click the components you want changed, ask for edits by number, and the agent reloads and re-arms the probe after each batch so you can keep clicking.

## Security

Use the probe only on pages and origins you intend the agent to inspect. Element text, ids, classes, selectors, console output, and optional label/source hints all come from the rendered page and are treated as untrusted data—not as instructions to the agent. Source hints must be verified against the current workspace before any edit.

The probe runs in the page's JavaScript environment, not a separate security sandbox. Use it with local development pages you control; page scripts can inspect, clear, or interfere with the probe.

For sensitive applications, use a dedicated browser profile without personal sessions. The probe does not read cookies or input values, but the text of elements you select is returned to the agent when it reads the live selection.

## Plugin layout

Both clients install the same directory — only the manifests differ.

```
.claude-plugin/marketplace.json     Claude Code marketplace entry ─┐
.agents/plugins/marketplace.json    Codex marketplace entry ───────┤
                                                                   │
plugins/click-to-edit-ui/           ← both point here ─────────────┘
├── .claude-plugin/plugin.json      Claude Code plugin manifest
├── .codex-plugin/plugin.json       Codex plugin manifest
├── LICENSE
└── skills/click-to-edit-ui/
    ├── SKILL.md                    the agent workflow
    └── scripts/probe.js            the browser probe
```

`SKILL.md` and `probe.js` are the entire implementation and are shared by both clients; everything else is packaging. `README.md`, `assets/`, and `examples/` stay at the repo root and are not part of the installed plugin.

The plugin does not bundle Chrome DevTools MCP. Keeping it as an external requirement avoids starting a second browser server when one is already configured.

## Regenerating the demo GIF

The GIF is rendered from `demo/page.html` plus the **current** `probe.js` by a scripted Playwright storyboard, so it always demonstrates the shipped behavior:

```bash
cd demo
npm install
npx playwright install chromium   # first time only
npm run record                    # rewrites assets/demo.gif
```

To change what the demo shows (new features, different edits), edit `demo/page.html` and/or the `FRAMES` storyboard at the top of `demo/record.mjs`, then re-run.

## License

[MIT](LICENSE)
