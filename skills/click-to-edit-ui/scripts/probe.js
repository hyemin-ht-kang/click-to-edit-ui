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
 *   - Normal clicks are untouched, so the page stays fully usable.
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
 * deepest-matching label to each selection. Without it, the generic descriptor
 * is usually enough to locate the source.
 */
(function () {
  function install() {
    if (window.__probe) { window.__probe.teardown(); }

    var LABELS = Array.isArray(window.__PROBE_LABELS) ? window.__PROBE_LABELS : [];

    function depth(el) { var d = 0, n = el; while ((n = n.parentElement)) d++; return d; }
    function landmark(el) {
      var n = el;
      while (n && n.nodeType === 1) { if (n.id) return '#' + n.id; n = n.parentElement; }
      return '';
    }
    function shortSel(el) {
      var parts = [], n = el;
      for (var i = 0; n && n.nodeType === 1 && i < 5; i++, n = n.parentElement) {
        var s = n.tagName.toLowerCase();
        if (n.id) { s += '#' + n.id; parts.unshift(s); break; }
        if (n.classList.length) s += '.' + Array.prototype.slice.call(n.classList, 0, 2).join('.');
        parts.unshift(s);
      }
      return parts.join(' > ');
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
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: (typeof el.className === 'string' && el.className) ? Array.prototype.slice.call(el.classList) : [],
        landmark: landmark(el),
        selector: shortSel(el),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
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

    var hud = document.createElement('div');
    hud.id = '__probe-hud';
    hud.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;max-width:420px;background:#1b1a17;color:#faf7ef;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none;white-space:pre-wrap;border:1px solid #e8b53a;';
    document.body.appendChild(hud);

    function renderHud() {
      if (!sels.length) {
        hud.innerHTML = '🔍 probe armed — <b>Alt/Option+click</b> components to queue them.<br>(Alt+Shift+click = clear all)';
        return;
      }
      var rows = sels.map(function (s) { return '<span style="color:#e8b53a;">' + s.n + '.</span> ' + shortName(s.info); }).join('<br>');
      hud.innerHTML = '🔍 <b>' + sels.length + ' selected</b> <span id="__probe-clear" style="pointer-events:auto;cursor:pointer;border:1px solid #e8b53a;border-radius:4px;padding:0 5px;margin-left:4px;">✕ clear</span><br>' + rows;
      var c = document.getElementById('__probe-clear');
      if (c) c.onclick = clearAll;
    }

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
      console.log('[PROBE #' + n + '] ' + JSON.stringify(info));
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
    function onClick(e) {
      if (!e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) { clearAll(); return; }
      clearHover();
      addSel(e.target);
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    renderHud();

    window.__probe = {
      list: function () {
        return sels.map(function (s) {
          var o = { n: s.n };
          for (var k in s.info) o[k] = s.info[k];
          return o;
        });
      },
      clear: clearAll,
      teardown: function () {
        cancelAnimationFrame(raf);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
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
