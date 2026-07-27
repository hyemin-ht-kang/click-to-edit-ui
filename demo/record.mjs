/*
 * Re-records assets/demo.gif from demo/page.html + the CURRENT probe script.
 *
 *   cd demo && npm install
 *   npx playwright install chromium   # first time only
 *   npm run record
 *
 * The probe is read from ../plugins/click-to-edit-ui/skills/click-to-edit-ui/
 * scripts/probe.js at run time, so the GIF always demonstrates the shipped
 * probe behavior. To change
 * what the GIF shows, edit page.html and/or the FRAMES storyboard below.
 *
 * Note: the page uses macOS system fonts (Copperplate); recording on another
 * OS falls back to a generic serif and will look slightly different.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const demoDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(demoDir, '..');
const probeSource = readFileSync(join(repoRoot, 'plugins/click-to-edit-ui/skills/click-to-edit-ui/scripts/probe.js'), 'utf8');
const pageUrl = pathToFileURL(join(demoDir, 'page.html')).href;
const outPath = join(repoRoot, 'assets', 'demo.gif');

const W = 800;
const H = 520;
const COLORS = 128; // GIF palette size per frame

// --- storyboard: one entry per GIF frame -----------------------------------
// `ms` is how long the frame is shown; `do` is a list of __demo calls
// (see the helper below) executed in the page before the screenshot.
const PROMPT_FULL = 'make [1] bigger · [2] copper · [3] gears ⚙️';
const FRAMES = [
  { ms: 900, do: [] }, // probe armed, cursor idle
  { ms: 140, do: [['tween', '#curio-compass', -80, -70]] },
  { ms: 500, do: [['at', '#curio-compass', -80, -70], ['altHover', '#curio-compass']] },
  { ms: 750, do: [['altClick', '#curio-compass']] }, // badge 1
  { ms: 140, do: [['tween', '#curio-chrono .add', 0, 0]] },
  { ms: 500, do: [['at', '#curio-chrono .add', 0, 0], ['altHover', '#curio-chrono .add']] },
  { ms: 750, do: [['altClick', '#curio-chrono .add']] }, // badge 2
  { ms: 140, do: [['tween', '#shop-sign', 40, 5]] },
  { ms: 500, do: [['at', '#shop-sign', 40, 5], ['altHover', '#shop-sign']] },
  { ms: 900, do: [['altClick', '#shop-sign']] }, // badge 3
  { ms: 700, do: [['prompt', 'make [1] bigger', false]] }, // typing…
  { ms: 1600, do: [['prompt', PROMPT_FULL, false]] },
  { ms: 1300, do: [['prompt', PROMPT_FULL, true], ['edits'], ['at', '#curio-tonic', 90, 80]] },
  { ms: 2000, do: [['probeClear'], ['hideCaption']] }, // clean result
];

// Page-side driver: fake cursor, synthetic Alt events, TUI prompt bar, and
// the "edits" the GIF pretends the agent made.
function installDemoHelpers() {
  const cur = document.createElement('div');
  cur.id = '__demo-cursor';
  cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 2 L5 19 L9.5 15.5 L12.5 21.5 L15 20 L12 14.5 L18 14 Z" fill="#1b1a17" stroke="#fff" stroke-width="1.6"/></svg>';
  cur.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:620px;top:460px;';
  document.body.appendChild(cur);
  const pos = { x: 620, y: 460 };
  function target(sel, dx, dy) {
    const r = document.querySelector(sel).getBoundingClientRect();
    return [r.left + r.width / 2 + (dx || 0), r.top + r.height / 2 + (dy || 0)];
  }
  function place(x, y) { pos.x = x; pos.y = y; cur.style.left = x + 'px'; cur.style.top = y + 'px'; }
  const BADGE = (n) => '<b style="background:#d94a2a;color:#fff;border-radius:8px;padding:0 5px;font:700 12px ui-monospace,monospace;">' + n + '</b>';
  window.__demo = {
    tween(sel, dx, dy) {
      const [tx, ty] = target(sel, dx, dy);
      place(pos.x + (tx - pos.x) * 0.55, pos.y + (ty - pos.y) * 0.55);
    },
    at(sel, dx, dy) { const [tx, ty] = target(sel, dx, dy); place(tx, ty); },
    altHover(sel) {
      document.querySelector(sel).dispatchEvent(new MouseEvent('mousemove', { altKey: true, bubbles: true }));
    },
    altClick(sel) {
      document.querySelector(sel).dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true }));
    },
    prompt(text, done) {
      let c = document.getElementById('__demo-caption');
      if (!c) {
        c = document.createElement('div');
        c.id = '__demo-caption';
        c.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:2147483646;background:#1b1a17;color:#faf7ef;font:500 14px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:10px 16px;border-radius:6px;border:1px solid #e8b53a;box-shadow:0 6px 18px rgba(0,0,0,.5);white-space:nowrap;min-width:560px;';
        document.body.appendChild(c);
      }
      const body = text.replace(/\[(\d)\]/g, (_, n) => BADGE(n));
      c.innerHTML = '<span style="color:#8ce99a;font-weight:700;">❯</span> <span style="color:#e8b53a;">prompt:</span> ' + body +
        (done ? '' : '<span style="display:inline-block;width:8px;height:15px;background:#faf7ef;margin-left:3px;vertical-align:text-bottom;"></span>');
      c.style.display = 'block';
    },
    hideCaption() { const c = document.getElementById('__demo-caption'); if (c) c.style.display = 'none'; },
    edits() {
      document.querySelector('#curio-compass').style.transform = 'scale(1.1)';
      const btn = document.querySelector('#curio-chrono .add');
      btn.style.background = 'linear-gradient(180deg, #d08a4a, #B87333 55%, #8a5626)';
      btn.style.borderColor = '#6b3f1d';
      document.querySelector('#shop-sign').textContent = '⚙️ Cog & Kettle ⚙️';
    },
    probeClear() { window.__probe.clear(); },
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript(probeSource);
await page.goto(pageUrl);
await page.evaluate(installDemoHelpers);

const gif = GIFEncoder();
for (const [i, frame] of FRAMES.entries()) {
  await page.evaluate((cmds) => {
    for (const [fn, ...args] of cmds) window.__demo[fn](...args);
  }, frame.do);
  await page.waitForTimeout(250); // let CSS transitions and the badge rAF settle
  const png = PNG.sync.read(await page.screenshot());
  const palette = quantize(png.data, COLORS);
  gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: frame.ms });
  console.log(`frame ${i + 1}/${FRAMES.length}`);
}
gif.finish();
await browser.close();

writeFileSync(outPath, gif.bytes());
console.log(`wrote ${outPath} (${Math.round(gif.bytes().length / 1024)} KB, ${FRAMES.length} frames)`);
