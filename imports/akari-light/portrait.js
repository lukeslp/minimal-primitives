/* Upright on phones. Local to each game that opts in (tools/portrait/games.json). Luke Steuber.
   A phone held sideways shows a prompt to turn it upright in place of the board; nothing about
   the game changes, and turning back shows the board exactly as it was. A hard lock by Luke's
   choice (2026-11-22): there is no way past it but turning the phone, except for a player using
   Access (below). Loaded without defer in <head>, so the board is never painted sideways first. */
(function () {
  'use strict';
  const config = {"id":"akari-light"};
  const root = document.documentElement;
  // A phone, sideways: a touch screen whose short side is under 600 px (every phone; no tablet,
  // whose short side is 600 px or more), with the window wider than tall and at most 500 px tall
  // (the games' own sideways-phone layout starts at that height). A fine pointer (a desktop or
  // a laptop, touch screen or not) never matches, nor does a tablet's short window.
  const sideways = matchMedia('(pointer:coarse) and (orientation:landscape) and (max-height:500px)');
  const phone = () => Math.min(screen.width, screen.height) < 600;
  // A player using Access (one switch, or look and hold; tools/control-frame) plays by its pad beside
  // the board and may have no way to turn the phone: they keep the sideways board. The frame marks
  // <body> once Access runs; until then, the choice it saved for this game (or the site default).
  const accessOn = () => {
    const a = document.body && document.body.dataset.access;
    if (a) return a === 'switch' || a === 'look';
    try {
      for (const k of ['minimal-access.v1:' + config.id, 'minimal-access.v1:default']) {
        const raw = localStorage.getItem(k);
        if (raw !== null) { const m = (JSON.parse(raw) || {}).mode; return m === 'switch' || m === 'look'; }
      }
    } catch (e) {}
    return false;
  };
  const LINE = 'Turn your phone upright to play.';
  let prompt = null, line = null, before = null, timer = 0;
  const on = () => root.hasAttribute('data-portrait-turn');
  const wanted = () => phone() && sideways.matches && !accessOn();

  function build() {
    prompt = document.createElement('div');
    prompt.className = 'portrait-turn';
    prompt.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path class="portrait-turn-arc" d="M7 22A17 17 0 0 1 20 7.5M16 4.5l4.2 3-3.2 4"/><g class="portrait-turn-phone"><rect x="17" y="12" width="14" height="24" rx="2.5"/><path d="M22 32.5h4"/></g></svg>' +
      '<p class="portrait-turn-line" role="status" tabindex="-1"></p>';
    line = prompt.querySelector('.portrait-turn-line');
    document.body.append(prompt);
  }

  // What the page had focused, if the prompt hides it; given back when the board returns.
  const hidden = n => n && n !== document.body && !n.closest('dialog,.portrait-turn');
  function show() {
    root.setAttribute('data-portrait-turn', '');
    if (!prompt) return;
    const active = document.activeElement;
    // Focus that the prompt hides (a keyboard player's cell) goes to the line, still empty, so the
    // line is read once, as a status, when it fills.
    if (hidden(active)) { before = active; line.focus({ preventScroll: true }); }
    // Filled after the prompt is on screen (a live region filled while it is still hidden is not read).
    clearTimeout(timer);
    line.textContent = '';
    timer = setTimeout(() => { line.textContent = LINE; }, 150);
  }
  function hide() {
    root.removeAttribute('data-portrait-turn');
    if (!prompt) return;
    clearTimeout(timer);
    line.textContent = '';
    const active = document.activeElement;
    if (before && before.isConnected && (!active || active === document.body || prompt.contains(active))) before.focus({ preventScroll: true });
    before = null;
  }
  function update() {
    const want = wanted();
    if (want !== on()) (want ? show : hide)();
  }

  // While the prompt shows, the board is out of sight, so keys and presses must not play it
  // unseen: they stop here, before the game's own listeners (this file runs first). An open
  // sheet keeps its keys, a host page's Home keeps its presses, and nothing's default action
  // (Tab, a button's Enter) is stopped.
  const stop = e => {
    if (!on() || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (e.type.startsWith('key') || !(t instanceof Element) || !t.closest('[data-minimal-collection]')) e.stopImmediatePropagation();
  };
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) addEventListener(type, stop, true);

  // Installed on a home screen: hold it upright where the browser allows (Android); a refusal,
  // or a browser without the call (iOS), changes nothing.
  try {
    if (phone() && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches && screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(() => {});
  } catch (e) {}

  if (wanted()) root.setAttribute('data-portrait-turn', '');
  const start = () => {
    build();
    if (on()) show();
    update();
    new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['data-access'] });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  if (sideways.addEventListener) sideways.addEventListener('change', update); else sideways.addListener(update);
  addEventListener('resize', update);
})();
