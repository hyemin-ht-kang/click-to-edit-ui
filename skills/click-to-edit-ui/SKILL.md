---
name: click-to-edit-ui
description: Set up a "click-to-identify" probe in a live browser (via the chrome-devtools MCP) so the user can point at UI components by Alt-clicking them instead of describing them in words, then request edits by referring to numbered selections ("make ① bigger, hide ②, recolor ③"). Use this whenever the user is iteratively editing a rendered web UI / HTML page / app open in Chrome and would rather click on elements than describe them — triggers include "set up the click probe", "let me click to show you what to change", "I'll point at the components", "click-to-identify", "let me just click the things I want edited", "point-and-edit this UI", or the start of any visual front-end tweaking session against a page in the browser. Also use it to RE-ARM the probe after a reload, and to READ which components the user clicked (window.__probe.list()) before making edits. Prefer this over asking the user to describe DOM elements in prose.
---

# Click-to-edit UI

Editing a rendered UI is much faster when the user can **point** at a component than when they have to describe it ("the third dot in the second row of the sidebar…"). This skill injects a small probe into a page open in the **chrome-devtools MCP** browser so the user Alt-clicks the components they want changed; each click is **numbered and pinned with a badge**, and you read the ordered selection back from page state to know exactly which code to edit.

## When to use

- The user wants to change something visual in a page that's open (or that you can open) in the chrome-devtools browser, and pointing is easier than describing.
- The user says things like "let me click the parts I want edited," "set up the probe," or starts referring to components by number (① ② ③).
- After a reload, to confirm the probe re-armed (it should, automatically).

This needs the **chrome-devtools MCP** (`navigate_page`, `evaluate_script`, optionally `list_console_messages`). If it isn't available, say so — there's no fallback that gives the click-to-point experience.

## The loop, at a glance

```
open/locate page → inject probe → user Alt-clicks components (numbered)
   → you read window.__probe.list() → map each to source → edit
   → (regenerate if generated) → YOU reload via navigate_page + initScript
   → probe auto re-arms → user keeps Alt-clicking → repeat
```

The closing **agent-driven reload + re-arm** is part of the cycle, not an optional verification step. See Step 5.

## Step 1 — Make sure the page is open

The probe attaches to whatever page is selected in the chrome-devtools browser. If nothing is open, `navigate_page` to the target (a `file://` path for a local HTML artifact, or an `http://localhost:…` dev server). If a previous browser is "already running" and `navigate_page` errors, the page is usually still there — `list_pages` / `select_page`, or just proceed.

## Step 2 — Inject the probe (persistently)

Read the probe source and pass its **entire contents** as the `initScript` of a `navigate_page` call. Registering it as an init-script (rather than a one-shot `evaluate_script`) is what makes it survive the user's own Cmd+R — it re-runs on every new document.

1. Read `scripts/probe.js` (in this skill directory).
2. Call `navigate_page` with `type: "reload"` (or `type: "url"` if you're also navigating) and `initScript: <contents of probe.js>`.
3. Verify it armed: `evaluate_script` returning `!!window.__probe` (and the top-right HUD should read "probe armed").

The probe guards everything behind the **Alt** key, so the page stays fully interactive — only Alt-clicks are intercepted.

**Optional per-app labels.** The probe identifies elements generically (see Step 4), which is usually enough. For a complex app you can give clicks friendly names + source pointers by prepending a `window.__PROBE_LABELS` assignment to the init-script before the probe body:

```js
window.__PROBE_LABELS = [
  ['#trace-slot .step', 'Agent trace step', 'renderStepCard() in app.js'],
  ['table.matrix th.run-col', 'Matrix run header', 'renderMatrix()'],
  // [cssSelector, "Friendly name", "source hint"] — deepest match wins
];
/* …probe.js contents… */
```

## Step 3 — Hand the controls to the user

Tell them, briefly:

- **Alt/Option + click** each component to queue it (badge ①②③ appears on it + a line in the top-right HUD).
- Reference them **by number** in any order — *"make ① 2px bigger, hide ②, color ③ by its score."*
- **Alt+Shift+click** (or the HUD's **✕ clear**) resets the queue.
- Normal clicks still work; re-clicking the same element is ignored.

## Step 4 — Read what they clicked (don't guess)

When the user refers to their selections, read the live, ordered queue:

```
evaluate_script:  () => window.__probe ? window.__probe.list() : 'PROBE NOT INSTALLED'
```

Each entry looks like:

```json
{
  "n": 1,
  "tag": "th", "id": "", "classes": ["run-col", "focused"],
  "landmark": "#matrix-slot",
  "selector": "table.matrix > thead > tr > th.run-col.focused",
  "text": "Run 1 ✓ PASS r01",
  "label": "", "source": ""
}
```

Read `list()` **fresh each time** rather than scraping console history — re-selecting restarts numbering at ①, and the live list is the unambiguous source of truth. The `landmark` (nearest ancestor id) plus `selector`/`text` make the source easy to locate: grep the codebase for the id, class, or visible text. If `label`/`source` are set (from `__PROBE_LABELS`), use them directly.

## Step 5 — Edit, then YOU reload and re-arm (every cycle)

This is part of the loop, not an optional verification step. After each batch of edits, **you** trigger the reload and re-arm — don't ask the user, don't wait for Cmd+R, don't end your turn assuming they'll refresh.

1. Make the edits at the mapped source location.
2. If the page is **generated** (template, framework component, Python/JS generator), regenerate/rebuild so the served file reflects your change.
3. **Reload the browser yourself**, re-passing the probe so it survives:
   - Call `navigate_page` with `type: "reload"` and `initScript: <contents of probe.js>` (same call as Step 2). Re-passing `initScript` is what keeps the probe armed across an agent-triggered reload — drop it and you silently un-arm.
   - Verify the HUD re-appeared in the top-right.
4. Verify the change rendered (visible in the page, or via `evaluate_script`).
5. Hand the controls back: queue reset, badges gone, user can immediately Alt-click the next batch.

**Don't bail out of this loop:**

| Rationalization | Reality |
|---|---|
| "The user can just hit Cmd+R themselves" | They asked for a click-and-edit loop. Making them refresh between every batch breaks the loop. |
| "I should ask before reloading their browser" | The reload IS the cycle. Ask once at session start if at all, never per batch. |
| "What if they're still mid-click?" | They asked you to implement and you finished. The reload signals "done, your turn." |
| "Headless verify is enough" | A headless check doesn't re-arm the user's browser. Reload the actual page. |
| "I'll verify and let them reload" | That's the old flow this skill replaces. The cycle ends with **your** reload + re-arm. |

## Gotchas worth knowing

- **Selections are a snapshot of the current view.** If the user navigates (different route / re-rendered panel), earlier elements are detached, so their badges hide — though the descriptions you already read still stand. Smoothest flow: batch clicks within one view, act, then move on.
- **`navigate_page` reload vs the user's reload.** The init-script persists across the user's Cmd+R. But if you trigger a reload via `navigate_page` *without* re-passing `initScript`, you may drop it — pass it again when you reload for verification.
- **Don't bake app-specific component maps into `probe.js`.** Keep the bundled probe generic; pass `window.__PROBE_LABELS` per app instead.
