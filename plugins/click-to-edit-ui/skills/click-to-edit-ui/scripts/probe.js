/*
 * click-to-edit-ui — injectable "click-to-identify" probe.
 *
 * Inject the ENTIRE contents of this file as the `initScript` of a
 * chrome-devtools `navigate_page` call (type=reload or type=url). Registered
 * that way it runs on every new document, so it re-arms itself across the
 * user's own reloads (Cmd+R) — no manual re-injection.
 *
 * Interaction model:
 *   - Alt/Option + click  → add the element under the cursor to a numbered
 *     selection queue (pins a badge ①②③ on it + lists it in the HUD).
 *   - Alt + hover         → dashed outline preview of what would be selected.
 *   - Alt + Shift + click  → clear the whole queue (or the HUD "✕ clear").
 *   - Drag the HUD's ⠿ grip → move the HUD anywhere (double-click it to snap
 *     back to the top-right); "−" collapses the HUD to just its title bar.
 *     Both are remembered in sessionStorage, so they survive the reloads this
 *     tool's edit loop performs.
 *   - Normal clicks are untouched, so the page stays fully usable. A primary-
 *     button press that starts with Alt held is suppressed as a whole sequence
 *     (pointerdown → click, moves included) before page handlers see any of
 *     it. Alt + middle/right clicks are left entirely to the page.
 *
 * The agent reads the ordered selection with:
 *     window.__probe.list()
 * which returns, per selection, a generic descriptor: tag / id / classes /
 * selector path / `landmark` (nearest ancestor id — great for grepping source)
 * / short text, plus an optional `label`+`source` when the app provides a
 * label map.
 *
 * Optional per-app enrichment: set `window.__PROBE_LABELS` to an array of
 * `[cssSelector, "Friendly name", "source hint"]` BEFORE this script runs
 * (e.g., prepend the assignment to the initScript). The probe attaches the
 * deepest-matching label to each selection. The configuration is validated and
 * snapshotted immediately, before page scripts can replace it. A label confirms
 * only that a page-controlled element matches the configured selector, not that
 * the element came from the hinted source; the agent must still verify it.
 * Without labels, the generic descriptor is usually enough to locate the source.
 */
(function () {
  function capString(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
  }

  // Treat labels as init-script configuration, not live page state. install()
  // runs at DOMContentLoaded, so reading window.__PROBE_LABELS there would let a
  // page script replace trusted source hints while the document is loading.
  // Copy primitive strings now and ignore malformed or non-string values.
  var LABELS = [];
  var configuredLabels = window.__PROBE_LABELS;
  if (Array.isArray(configuredLabels)) {
    for (var labelIndex = 0; labelIndex < configuredLabels.length; labelIndex++) {
      var entry = configuredLabels[labelIndex];
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0]) continue;
      LABELS.push([
        entry[0],
        capString(entry[1], 80),
        capString(entry[2], 200)
      ]);
    }
  }

  // --- Alt-gesture suppression ---------------------------------------------
  // Registered on window at init-script time — before any page script has run,
  // so these fire ahead of every page listener (window capture runs before
  // document capture, and among window-capture peers registration order wins).
  // stopImmediatePropagation() also silences peers registered later.
  // The Alt state is latched at press time, primary button only: cancelling
  // the late click event can't retroactively stop pointerdown/mousedown, and a
  // modifier change mid-drag must not split a gesture into a half-suppressed
  // sequence. A single (non-pointerId-keyed) latch is intentional — this tool
  // targets mouse-driven desktop Chrome, not simultaneous multi-touch.
  // pointerrawupdate is deliberately NOT suppressed: merely listening to it
  // forces high-frequency dispatch on every page this probe arms.
  var altGesture = null;   // null = idle; true/false = press began Alt+primary
  var pressActive = false; // true while an Alt-latched press is physically held
  var clickSink = null;    // set by install(); receives suppressed Alt-clicks

  function suppress(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  function onDown(e) {
    // pointerdown starts a gesture; mousedown only latches as a fallback when
    // pointer events are unavailable (otherwise it reuses the pointerdown latch)
    if (e.type === 'pointerdown' || altGesture === null || !window.PointerEvent) {
      altGesture = !!e.altKey && e.button === 0;
      pressActive = altGesture;
    }
    if (altGesture) suppress(e);
  }
  function onMoveSuppress(e) { if (pressActive) suppress(e); }
  function onUp(e) {
    if (altGesture) suppress(e);
    if (e.type === 'pointerup' || !window.PointerEvent) pressActive = false;
  }
  function onWinClick(e) {
    // e.detail > 0 marks a mouse-generated click; keyboard activation and
    // synthetic dispatchEvent clicks carry detail 0 and are judged by altKey,
    // so a latch left behind by a click-less drag can never swallow them
    var alt = (altGesture !== null && e.detail > 0) ? altGesture : !!e.altKey;
    altGesture = null;
    if (!alt) return;
    suppress(e);
    if (clickSink) clickSink(e);
  }
  function onCancel(e) {
    if (altGesture) suppress(e);
    altGesture = null; pressActive = false;
  }

  var SUPPRESSORS = [
    ['pointerdown', onDown], ['mousedown', onDown],
    ['pointermove', onMoveSuppress], ['mousemove', onMoveSuppress],
    ['pointerup', onUp], ['mouseup', onUp],
    ['click', onWinClick], ['pointercancel', onCancel]
  ];

  function removeSuppressors() {
    SUPPRESSORS.forEach(function (s) { window.removeEventListener(s[0], s[1], true); });
    if (window.__probeRemoveSuppressors === removeSuppressors) delete window.__probeRemoveSuppressors;
  }

  // Hand off from any previously injected copy immediately — waiting for
  // install() would briefly stack two latching state machines during load.
  if (typeof window.__probeRemoveSuppressors === 'function') window.__probeRemoveSuppressors();
  SUPPRESSORS.forEach(function (s) { window.addEventListener(s[0], s[1], true); });
  window.__probeRemoveSuppressors = removeSuppressors;

  function install() {
    if (window.__PROBE_LABELS !== configuredLabels) {
      console.warn('[PROBE] window.__PROBE_LABELS was replaced after init; using the snapshot taken at init-script time.');
    }
    if (window.__probe) {
      if (typeof window.__probe.teardown === 'function') {
        try { window.__probe.teardown(); }
        catch (e) { console.warn('[PROBE] previous probe teardown failed; continuing with a fresh install.', e); }
      } else {
        console.warn('[PROBE] existing window.__probe has no teardown function; replacing it.');
      }
    }

    function depth(el) { var d = 0, n = el; while ((n = n.parentElement)) d++; return d; }
    function landmark(el) {
      var n = el;
      while (n && n.nodeType === 1) { if (n.id) return '#' + n.id; n = n.parentElement; }
      return '';
    }
    function shortSel(el) {
      var parts = [], n = el;
      for (var i = 0; n && n.nodeType === 1 && i < 5; i++, n = n.parentElement) {
        var s = capString(n.tagName.toLowerCase(), 40);
        if (n.id) { s += '#' + capString(n.id, 80); parts.unshift(s); break; }
        if (n.classList.length) {
          var pathClasses = [];
          for (var ci = 0; ci < n.classList.length && ci < 2; ci++) {
            pathClasses.push(capString(n.classList.item(ci), 40));
          }
          s += '.' + pathClasses.join('.');
        }
        parts.unshift(s);
      }
      return capString(parts.join(' > '), 200);
    }
    function matchLabel(el) {
      var best = null, bd = -1;
      for (var i = 0; i < LABELS.length; i++) {
        var m; try { m = el.closest(LABELS[i][0]); } catch (e) { m = null; }
        if (m) { var d = depth(m); if (d > bd) { bd = d; best = { name: LABELS[i][1] || '', source: LABELS[i][2] || '' }; } }
      }
      return best;
    }
    function describe(el) {
      var lab = matchLabel(el);
      var classes = [];
      if (typeof el.className === 'string' && el.className) {
        for (var i = 0; i < el.classList.length && i < 8; i++) {
          classes.push(capString(el.classList.item(i), 40));
        }
      }
      return {
        tag: capString(el.tagName.toLowerCase(), 40),
        id: capString(el.id, 80),
        classes: classes,
        landmark: capString(landmark(el), 80),
        selector: shortSel(el),
        text: capString((el.textContent || '').replace(/\s+/g, ' ').trim(), 80),
        label: lab ? lab.name : '',
        source: lab ? lab.source : ''
      };
    }
    function shortName(d) {
      if (d.label) return d.label;
      var base = (d.landmark ? d.landmark + ' ' : '') + d.tag + (d.classes.length ? '.' + d.classes.slice(0, 2).join('.') : '');
      return base;
    }

    var sels = [];

    // --- HUD ----------------------------------------------------------------
    // pointer-events is inherited, so `none` on the container makes the whole
    // HUD click-through and each control opts back in with `auto` — the page
    // underneath stays usable except for the few pixels of actual chrome.
    // The bar is built ONCE and never re-rendered: renderHud() rewrites only
    // `body`, so the grip/clear/collapse listeners are never orphaned.
    var hud = document.createElement('div');
    hud.id = '__probe-hud';
    // Translucent so you can see what the HUD is covering. The two knobs trade
    // against each other: alpha controls how much shows through, the backdrop
    // blur keeps the HUD's 11px text legible over busy pages. Keep the blur
    // low — past ~4px it smears the underlying content into an unreadable wash,
    // which defeats the point of being see-through at all.
    // text-shadow matters more than it looks: at this alpha the backdrop is
    // partly the page's own (often light) background, so the cream text loses
    // contrast. The shadow gives every glyph its own edge regardless of what
    // is behind the panel.
    hud.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;max-width:420px;background:rgba(27,26,23,.55);-webkit-backdrop-filter:blur(3px) saturate(1.2);backdrop-filter:blur(3px) saturate(1.2);color:#faf7ef;text-shadow:0 1px 2px rgba(0,0,0,.55);font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.28);pointer-events:none;white-space:pre-wrap;border:1px solid rgba(232,181,58,.8);';

    var BTN_CSS = 'pointer-events:auto;cursor:pointer;border:1px solid #e8b53a;border-radius:4px;padding:0 5px;';

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;user-select:none;';

    var grip = document.createElement('span');
    grip.id = '__probe-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to move · double-click to reset';
    // touch-action:none keeps a drag from being stolen by touch scrolling
    grip.style.cssText = 'pointer-events:auto;cursor:grab;color:#e8b53a;touch-action:none;';

    var title = document.createElement('span');
    title.style.cssText = 'flex:1;';

    var clearBtn = document.createElement('span');
    clearBtn.id = '__probe-clear';
    clearBtn.textContent = '✕ clear';
    clearBtn.style.cssText = BTN_CSS;

    var collapseBtn = document.createElement('span');
    collapseBtn.id = '__probe-collapse';
    collapseBtn.style.cssText = BTN_CSS;

    var body = document.createElement('div');
    body.id = '__probe-body';
    body.style.cssText = 'margin-top:3px;';

    bar.appendChild(grip); bar.appendChild(title);
    bar.appendChild(clearBtn); bar.appendChild(collapseBtn);
    hud.appendChild(bar); hud.appendChild(body);
    document.body.appendChild(hud);

    function renderHud() {
      title.innerHTML = sels.length
        ? '🔍 <b>' + sels.length + ' selected</b>'
        : '🔍 probe armed — <b>Alt/Option+click</b> to queue';
      clearBtn.style.display = sels.length ? '' : 'none';
      collapseBtn.textContent = collapsed ? '+' : '−';
      collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
      // Built as DOM nodes, not innerHTML: shortName() interpolates page-derived
      // ids/classes/labels, so markup there would execute in the page.
      body.textContent = '';
      if (sels.length) {
        sels.forEach(function (s, i) {
          if (i) body.appendChild(document.createElement('br'));
          var num = document.createElement('span');
          num.style.color = '#e8b53a';
          num.textContent = s.n + '.';
          body.appendChild(num);
          body.appendChild(document.createTextNode(' ' + shortName(s.info)));
        });
      } else {
        body.textContent = 'Alt+Shift+click = clear all · ⠿ drag to move';
      }
      body.style.display = collapsed ? 'none' : '';
    }

    // --- HUD placement ------------------------------------------------------
    // Position + collapsed state live in sessionStorage so they survive the
    // reloads this tool's edit loop performs, without leaving a lasting key in
    // the page's origin storage. Storage can throw (file:// origins, strict
    // partitioning), so every access degrades to "start at the default corner"
    // rather than breaking the probe.
    var STORE_KEY = '__probe-hud';
    var placed = false;  // true once the HUD uses left/top instead of the default top/right anchor
    var collapsed = false;

    function readState() {
      try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
    }
    function saveState() {
      var r = hud.getBoundingClientRect();
      var s = { collapsed: collapsed };
      if (placed) { s.left = r.left; s.top = r.top; }
      try { sessionStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
    }
    function moveTo(l, t) {
      hud.style.left = l + 'px';
      hud.style.top = t + 'px';
      hud.style.right = 'auto';
    }
    function clampIntoView() {
      var r = hud.getBoundingClientRect();
      moveTo(
        Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - r.width)),
        Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - r.height))
      );
    }
    function resetPos() {
      placed = false;
      hud.style.left = 'auto';
      hud.style.right = '8px';
      hud.style.top = '8px';
      saveState();
    }

    var saved = readState();
    collapsed = !!saved.collapsed;
    renderHud();  // size the box before measuring it
    if (typeof saved.left === 'number' && typeof saved.top === 'number') {
      placed = true;
      moveTo(saved.left, saved.top);
      clampIntoView();  // the window may have shrunk since the position was saved
    }

    // --- HUD interactions ---------------------------------------------------
    // Note: the window-capture Alt-suppressors above run before these
    // target-phase handlers, so Alt+drag on the grip is swallowed by design.
    // Plain drag is unaffected.
    var dragOff = null;

    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var r = hud.getBoundingClientRect();
      dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
      placed = true;
      moveTo(r.left, r.top);  // switch off the top/right anchor before dragging
      grip.style.cursor = 'grabbing';
      // pointer capture keeps the drag alive when the cursor outruns the HUD
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    });
    grip.addEventListener('pointermove', function (e) {
      if (!dragOff) return;
      e.preventDefault(); e.stopPropagation();
      var r = hud.getBoundingClientRect();
      moveTo(
        Math.min(Math.max(0, e.clientX - dragOff.x), Math.max(0, window.innerWidth - r.width)),
        Math.min(Math.max(0, e.clientY - dragOff.y), Math.max(0, window.innerHeight - r.height))
      );
    });
    function endDrag(e) {
      if (!dragOff) return;
      dragOff = null;
      grip.style.cursor = 'grab';
      try { grip.releasePointerCapture(e.pointerId); } catch (err) {}
      saveState();
    }
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);

    // Fires after both pointerup/endDrag pairs, so the reset wins over the
    // zero-distance "drag" each click of the double-click starts.
    grip.addEventListener('dblclick', function (e) {
      e.preventDefault(); e.stopPropagation();
      resetPos();
    });

    clearBtn.addEventListener('click', function (e) { e.stopPropagation(); clearAll(); });

    collapseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      collapsed = !collapsed;
      renderHud();
      if (placed) clampIntoView();  // expanding near the bottom edge can overflow
      saveState();
    });

    function onResize() { if (placed) { clampIntoView(); saveState(); } }
    window.addEventListener('resize', onResize);

    function addSel(el) {
      if (el === hud || (el.closest && el.closest('#__probe-hud'))) return;
      for (var i = 0; i < sels.length; i++) { if (sels[i].el === el) return; }
      var n = sels.length + 1;
      var badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;z-index:2147483647;min-width:15px;height:15px;line-height:15px;padding:0 3px;border-radius:8px;background:#d94a2a;color:#fff;font:700 10px ui-monospace,monospace;text-align:center;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.45);';
      badge.textContent = n;
      document.body.appendChild(badge);
      el.style.outline = '2px solid #d94a2a';
      el.style.outlineOffset = '-1px';
      var info = describe(el);
      sels.push({ n: n, el: el, badge: badge, info: info });
      renderHud();
    }

    function clearAll() {
      sels.forEach(function (s) { try { s.el.style.outline = ''; } catch (e) {} s.badge.remove(); });
      sels = [];
      renderHud();
      console.log('[PROBE] cleared');
    }

    function tick() {
      for (var i = 0; i < sels.length; i++) {
        var s = sels[i], r;
        try { r = s.el.getBoundingClientRect(); } catch (e) { r = { width: 0, height: 0 }; }
        if (r.width || r.height) {
          s.badge.style.display = 'block';
          s.badge.style.left = Math.max(0, r.left - 6) + 'px';
          s.badge.style.top = Math.max(0, r.top - 6) + 'px';
        } else {
          s.badge.style.display = 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    }
    var raf = requestAnimationFrame(tick);

    var lastHover = null, lastOutline = '';
    function clearHover() {
      if (lastHover) {
        var sel = false;
        for (var i = 0; i < sels.length; i++) if (sels[i].el === lastHover) sel = true;
        if (!sel) lastHover.style.outline = lastOutline;
        lastHover = null;
      }
    }
    function onMove(e) {
      if (!e.altKey) { clearHover(); return; }
      var el = e.target;
      if (el === lastHover || el === hud || (el.closest && el.closest('#__probe-hud'))) return;
      clearHover();
      for (var i = 0; i < sels.length; i++) if (sels[i].el === el) { lastHover = null; return; }
      lastHover = el; lastOutline = el.style.outline;
      el.style.outline = '2px dashed #c66e1d';
    }
    document.addEventListener('mousemove', onMove, true);
    clickSink = function (e) {
      if (e.shiftKey) { clearAll(); return; }
      clearHover();
      addSel(e.target);
    };

    window.__probe = {
      list: function () {
        return sels.map(function (s) {
          return {
            n: s.n,
            tag: s.info.tag,
            id: s.info.id,
            classes: s.info.classes.slice(),
            landmark: s.info.landmark,
            selector: s.info.selector,
            text: s.info.text,
            label: s.info.label,
            source: s.info.source
          };
        });
      },
      clear: clearAll,
      teardown: function () {
        cancelAnimationFrame(raf);
        document.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('resize', onResize);
        removeSuppressors();
        clickSink = null;
        clearAll();
        var h = document.getElementById('__probe-hud');
        if (h) h.remove();
        delete window.__probe;
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
