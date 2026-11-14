/* iPhone Duo: where a game sits when the phone is partly folded. Book pose plays it
   on the trailing side of the fold with its name on the leading side. Laptop pose
   plays it above the fold and puts its toolbar below, on the half resting on the
   table: the buttons there press the game's own buttons, so every pose has the same
   controls. Without the app's fold bridge (any other device or browser) this does
   nothing. By Luke Steuber. */
(() => {
  'use strict';
  const root = document.documentElement;
  const player = document.getElementById('player');
  const pane = document.getElementById('duo-pane');
  if (!player || !pane) return;
  const HIDE = 'duo-toolbar-below';
  let frame = null, doc = null, observers = [], originals = [], proxies = [], queued = false;
  let watched = new WeakSet(); // never mark the game's own DOM
  const loaded = new WeakSet(); // frames past their own load: their initial about:blank is never touched

  const pose = () => root.dataset.duoPose;
  const docOf = f => { if (!f || !loaded.has(f)) return null; try { return f && f.contentDocument && f.contentDocument.body ? f.contentDocument : null; } catch (_) { return null; } };
  const toolbar = d => d && d.querySelector('body[data-control-frame] .control-toolbar');
  const shown = b => !b.hidden && !b.closest('[hidden]') && b.ownerDocument.defaultView.getComputedStyle(b).display !== 'none';

  function hideOriginal(d, on) {
    if (!d) return;
    let style = d.getElementById(HIDE);
    if (on && !style) {
      style = d.createElement('style'); style.id = HIDE;
      // Kept in place but unseen, so the game keeps its spacing and its Next keeps its spot.
      style.textContent = 'body[data-control-frame] .control-toolbar{visibility:hidden!important}';
      d.head.append(style);
    } else if (!on && style) style.remove();
  }

  function colors(d) {
    const view = d.defaultView, paint = el => view.getComputedStyle(el).backgroundColor;
    const clear = c => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    const bg = [d.body, d.documentElement].map(paint).find(c => !clear(c)) || '#111';
    const ink = view.getComputedStyle(toolbar(d)?.querySelector('button') || d.body).color;
    pane.style.setProperty('--duo-bg', bg); player.style.setProperty('--duo-bg', bg); pane.style.setProperty('--duo-ink', ink);
  }

  function copy(from, to) {
    for (const name of ['aria-label', 'title', 'aria-pressed', 'aria-expanded', 'aria-haspopup']) {
      const v = from.getAttribute(name);
      if (v === null) to.removeAttribute(name); else to.setAttribute(name, v);
    }
    to.disabled = from.disabled;
    to.classList.toggle('is-armed', from.classList.contains('is-armed'));
    // The game's own icon, copied as nodes.
    if (to.dataset.icon !== from.innerHTML) { to.dataset.icon = from.innerHTML; to.replaceChildren(...[...from.childNodes].map(n => document.importNode(n, true))); }
  }

  function mirror() {
    queued = false;
    const bar = toolbar(doc);
    const groups = bar ? [...bar.children].map(g => (g.matches('button') ? [g] : [...g.querySelectorAll('button')]).filter(shown)) : [];
    const list = groups.flat();
    if (list.length !== originals.length || list.some((b, i) => b !== originals[i])) {
      const focused = proxies.indexOf(document.activeElement);
      const strip = document.createElement('div');
      strip.setAttribute('role', 'toolbar'); strip.setAttribute('aria-label', bar?.getAttribute('aria-label') || 'Game controls');
      proxies = [];
      for (const group of groups) {
        const holder = document.createElement('div'); holder.className = 'duo-group';
        for (const original of group) {
          const proxy = document.createElement('button');
          proxy.type = 'button'; proxy.className = 'duo-proxy';
          proxy.addEventListener('click', () => { original.click(); schedule(); });
          holder.append(proxy); proxies.push(proxy);
        }
        strip.append(holder);
      }
      originals = list;
      pane.querySelector('[role="toolbar"]')?.remove();
      pane.append(strip);
      if (focused >= 0 && proxies[Math.min(focused, proxies.length - 1)]) proxies[Math.min(focused, proxies.length - 1)].focus();
    }
    originals.forEach((b, i) => copy(b, proxies[i]));
    if (doc) colors(doc);
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(mirror); } };

  function watch(d) {
    for (const o of observers) o.disconnect();
    observers = []; watched = new WeakSet();
    if (!d) return;
    // The control frame builds its toolbar once the game is ready; theme switches recolor the page.
    const page = new MutationObserver(() => { const bar = toolbar(d); if (bar) watchBar(bar); layout(); });
    page.observe(d.body, { attributes: true, attributeFilter: ['data-control-frame', 'class', 'style', 'data-theme', 'data-look'] });
    page.observe(d.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-look'] });
    observers.push(page);
    const bar = toolbar(d);
    if (bar) watchBar(bar);
  }
  function watchBar(bar) {
    if (watched.has(bar)) return;
    watched.add(bar);
    const o = new MutationObserver(schedule);
    o.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'aria-pressed', 'aria-expanded', 'aria-label', 'class', 'style'] });
    observers.push(o);
  }

  function layout() {
    // Not folded, or no fold bridge at all (every device but iPhone Duo): leave the game frame alone.
    if (pose() !== 'book' && pose() !== 'laptop') {
      if (doc) { hideOriginal(doc, false); watch(null); doc = null; }
      delete player.dataset.duo; pane.querySelector('[role="toolbar"]')?.remove(); originals = []; proxies = [];
      return;
    }
    const p = player.hidden ? null : pose();
    const d = docOf(frame);
    if (d !== doc) { doc = d; originals = []; watch(d); }
    const mode = p === 'book' ? 'book' : p === 'laptop' ? (toolbar(doc) ? 'laptop-controls' : 'laptop') : '';
    if (mode) player.dataset.duo = mode; else delete player.dataset.duo;
    hideOriginal(doc, mode === 'laptop-controls');
    pane.querySelector('.duo-title').textContent = frame?.title || '';
    if (mode === 'laptop-controls') mirror();
    else { pane.querySelector('[role="toolbar"]')?.remove(); originals = []; proxies = []; if (mode && doc) colors(doc); }
  }

  function attach() {
    const next = player.querySelector('iframe');
    if (next === frame) return layout();
    frame = next;
    next?.addEventListener('load', () => { loaded.add(next); layout(); });
    layout();
  }

  const title = Object.assign(document.createElement('p'), { className: 'duo-title' });
  title.setAttribute('aria-hidden', 'true'); // the game frame already carries its name
  pane.replaceChildren(title);
  new MutationObserver(attach).observe(player, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('duo:fold', layout);
  attach();
})();
