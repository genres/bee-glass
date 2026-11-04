// ==UserScript==
// @name         Bee glass
// @namespace    https://github.com/genres/bee-glass
// @version      1.2
// @description  Dark websites become see-through glass (72%, like a translucent terminal) while images, video, text, buttons and pop-ups stay solid. Needs a transparent Firefox (bee glass kit).
// @match        *://*/*
// @run-at       document-start
// @noframes
// @inject-into  content
// @grant        GM_addStyle
// @license      MIT
// @homepageURL  https://github.com/genres/bee-glass
// @supportURL   https://github.com/genres/bee-glass/issues
// ==/UserScript==

(() => {
  'use strict';
  const BASE_ALPHA = 0.72;   // page glass opacity (a kitty terminal at background_opacity 0.72)
  const TINT_ALPHA = 0.55;   // cards/panels lighter than the page base, layered over it
  const POP_ALPHA = 0.86;    // dark pop-ups (search dropdowns, menus, dialogs): glass but readable over content
  const VEIL_ALPHA = 0.35;   // dark blurred sticky bars: backdrop blur renders solid black on a see-through window, so tint instead
  const DARK_LUM = 0.2;      // only dark colours become glass; light surfaces stay solid for readability
  const SAME = 8;            // per-channel difference that still counts as "the page colour"

  // Never touch media, form fields, controls or anything that floats above content.
  const SKIP = 'img,picture,video,canvas,svg,iframe,embed,object,input,textarea,select,button,a,label,summary,' +
    '[role=button],[role=menuitem],[role=option],[role=tooltip],[contenteditable=""],[contenteditable=true],' +
    ':has(> video),:has(> canvas)';
  const FLOATING = '[role=menu],[role=listbox],[role=dialog],[role=alertdialog],[role=tooltip],[aria-modal=true],dialog,[popover]';

  const ID = ':not(#bee-glass-none)'; // adds ID specificity so site !important rules lose
  let base = null;                    // [r,g,b] of the page background, or null = leave the page alone
  const tints = new Set();

  const parse = (s) => {
    const m = s.match(/rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:[,/] ?([\d.]+%?))?\)/);
    if (!m) return null;
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].endsWith('%')) a /= 100;
    return [+m[1], +m[2], +m[3], a];
  };
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const same = (c, d) => Math.abs(c[0] - d[0]) <= SAME && Math.abs(c[1] - d[1]) <= SAME && Math.abs(c[2] - d[2]) <= SAME;

  GM_addStyle(`
    html[data-bee-glass-base]${ID} { background-color: rgb(var(--bee-glass-base) / ${BASE_ALPHA}) !important; }
    html[data-bee-glass-base] body${ID}, [data-bee-glass="clear"]${ID} { background-color: transparent !important; }
    [data-bee-glass^="v-"]${ID}, [data-bee-glass="clear"]${ID} { backdrop-filter: none !important; }
  `);

  function pageBase() {
    const html = document.documentElement, body = document.body;
    const had = html.hasAttribute('data-bee-glass-base');
    if (had) html.removeAttribute('data-bee-glass-base');   // read the site's colour, not ours
    let found = null;
    let decided = false;
    for (const el of [body, html]) {
      const c = el && parse(getComputedStyle(el).backgroundColor);
      if (c && c[3] >= 0.9) { found = lum(c) < DARK_LUM ? c.slice(0, 3) : null; decided = true; break; }
    }
    if (decided) { if (had) html.setAttribute('data-bee-glass-base', ''); return found; }
    // No background at all + light text (dark-scheme default pages, error pages): the window is
    // see-through there, so give it the same black glass or the text sits on bare wallpaper.
    if (!found && body) {
      const hb = parse(getComputedStyle(html).backgroundColor), bb = parse(getComputedStyle(body).backgroundColor);
      const txt = parse(getComputedStyle(body).color);
      if ((!hb || hb[3] === 0) && (!bb || bb[3] === 0) && txt && lum(txt) > 0.6) found = [0, 0, 0];
    }
    if (had) html.setAttribute('data-bee-glass-base', '');
    return found;
  }

  // One generated rule per (alpha, colour) mark, e.g. data-bee-glass="t-22-24-28".
  function mark(prefix, c, alpha) {
    const key = `${prefix}-${c.slice(0, 3).join('-')}`;
    if (!tints.has(key)) {
      tints.add(key);
      GM_addStyle(`[data-bee-glass="${key}"]${ID} { background-color: rgb(${c.slice(0, 3).join(' ')} / ${alpha}) !important; }`);
    }
    return key;
  }

  const isFloating = (el, cs) => el.matches(FLOATING) ||
    ((cs.position === 'fixed' || cs.position === 'absolute') && cs.boxShadow !== 'none');

  function classify(el) {
    if (el.matches(SKIP)) return null;
    const cs = getComputedStyle(el);
    const c = parse(cs.backgroundColor);
    if (!c || lum(c) >= DARK_LUM) return null;                      // light: keep for readability
    // Blurred dark bars (sticky headers): the blur turns solid black here, so a light tint instead.
    if (cs.backdropFilter !== 'none' && c[3] > 0) return mark('v', c, VEIL_ALPHA);
    if (c[3] < 0.9) return null;                                    // already translucent: the site's own glass
    if (cs.cursor === 'pointer') return null;                       // clickable surface: keep its states
    if (isFloating(el, cs)) return mark('p', c, POP_ALPHA);         // pop-up root: readable glass
    // Inside a pop-up: layers in the pop-up's own colour clear, anything else keeps its colour.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const m = batch.get(a) || a.getAttribute('data-bee-glass');
      if (m && m.startsWith('p-')) return m === `p-${c.slice(0, 3).join('-')}` ? 'clear' : null;
    }
    if (same(c, base)) return 'clear';
    return mark('t', c, TINT_ALPHA);
  }

  const batch = new Map();  // marks decided in the current pass (attributes are written after all reads)
  const trees = new Set(), singles = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    if (!document.body) return schedule();
    if (!base) {
      base = pageBase();
      if (!base) { trees.clear(); singles.clear(); return; }  // light or unstyled page: leave it as the site made it
      document.documentElement.style.setProperty('--bee-glass-base', base.join(' '));
      document.documentElement.setAttribute('data-bee-glass-base', '');
      trees.clear(); singles.clear(); trees.add(document.body);
    }
    const els = [...singles];
    for (const root of trees) if (root.isConnected) els.push(root, ...root.getElementsByTagName('*'));
    trees.clear(); singles.clear();
    // Read everything first (with our marks removed so the site's own colour shows), then write.
    const live = els.filter((el) => el.isConnected && el !== document.documentElement);
    live.forEach((el) => el.removeAttribute('data-bee-glass'));
    batch.clear();
    const marks = live.map((el) => { const m = classify(el); if (m) batch.set(el, m); return m; });
    live.forEach((el, i) => marks[i] && el.setAttribute('data-bee-glass', marks[i]));
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => n.nodeType === 1 && trees.add(n));
      else if (r.target === document.documentElement || r.target === document.body) queueRecheck();
      else singles.add(r.target);
    }
    if (trees.size || singles.size) schedule();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

  // Dark Reader and theme toggles change the page colour after load: recheck the base.
  const recheck = () => {
    const b = pageBase();
    if (String(b) === String(base)) return;
    base = null;
    document.documentElement.removeAttribute('data-bee-glass-base');
    document.querySelectorAll('[data-bee-glass]').forEach((el) => el.removeAttribute('data-bee-glass'));
    schedule();
  };
  let recheckTimer = 0;
  function queueRecheck() { clearTimeout(recheckTimer); recheckTimer = setTimeout(recheck, 100); }
  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', recheck);
  setTimeout(recheck, 1500);
  schedule();
})();
