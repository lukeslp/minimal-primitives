/* Tilt · Levels: input for mouse, trackpad, touch and keys alike. By Luke Steuber.
 *
 * One gesture is one tilt, on a phone or at a desk, and it can begin anywhere on the page:
 *   - a drag or swipe of 24 pixels or more tilts the way it travels;
 *   - a click or tap tilts from the marble toward that point;
 *   - a two-finger swipe on a trackpad, or the wheel, tilts the way the fingers go;
 *   - W A S D tilt, beside the arrow keys the page already answers.
 * A release counts wherever it lands, and capture lost with no button held is a release.
 * This layer takes pointer input before the board's own handlers see it, so nothing is acted on twice. */
(function () {
  'use strict';
  const game = () => window.__tiltLevels;
  const control = t => !!(t && t.closest && t.closest('button,a,select,input,textarea,label,summary,dialog'));
  const sheet = () => document.querySelector('dialog[open]');
  const way = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
  const marble = () => {
    for (const s of ['.marble', '.ball', '#marble', '#ball']) {
      const n = document.querySelector(s);
      if (n) { const r = n.getBoundingClientRect(); if (r.width > 2) return r; }
    }
    return null;
  };
  function tilt(dir) {
    const g = game();
    if (!g || sheet()) return;
    try { if (g.state && g.state.solved) return; } catch (_) {}
    g.tilt(dir);
  }

  // A swipe may begin anywhere in the play area, so the browser must not claim it as a pan there. Sheets stay scrollable.
  // Set through the style objects, which a strict content policy allows where a style element would be refused.
  for (const n of document.body.children) if (n.tagName !== 'DIALOG' && n.style) n.style.touchAction = 'none';
  document.documentElement.style.overscrollBehavior = 'none';

  let stroke = null;
  const html = document.documentElement;
  window.addEventListener('pointerdown', e => {
    if (control(e.target) || sheet()) return;
    e.stopPropagation();
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    stroke = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
    try { html.setPointerCapture(e.pointerId); } catch (_) {}
  }, true);
  window.addEventListener('pointermove', e => {
    if (!stroke || stroke.id !== e.pointerId) return;
    e.stopPropagation(); stroke.lx = e.clientX; stroke.ly = e.clientY;
  }, true);
  function finish(x, y) {
    const dx = x - stroke.x, dy = y - stroke.y, far = Math.max(Math.abs(dx), Math.abs(dy));
    stroke = null;
    if (far >= 24) { tilt(way(dx, dy)); return; }
    if (far > 8) return; // too long for a click, too short for a swipe
    const m = marble();
    if (!m) return;
    const cx = x - (m.left + m.width / 2), cy = y - (m.top + m.height / 2);
    if (Math.hypot(cx, cy) < Math.max(m.width, m.height) * 0.75) return;
    tilt(way(cx, cy));
  }
  window.addEventListener('pointerup', e => {
    if (!stroke || stroke.id !== e.pointerId) return;
    e.stopPropagation(); finish(e.clientX, e.clientY);
  }, true);
  window.addEventListener('pointercancel', e => {
    if (stroke && stroke.id === e.pointerId) { e.stopPropagation(); stroke = null; }
  }, true);
  // A mouse can lose capture a moment before its pointerup, when a move with no button held lands first. That is a release.
  window.addEventListener('lostpointercapture', e => {
    if (e.target !== html || !stroke || stroke.id !== e.pointerId) return;
    if (e.buttons) stroke = null; else finish(stroke.lx, stroke.ly);
  }, true);

  // A trackpad swipe arrives as a stream of wheel steps with momentum after it. It tilts once, past a threshold, then
  // waits for the stream to stop. On a Mac the content follows the fingers, so the steps are read backwards there.
  let wheel = { x: 0, y: 0, spent: false, timer: 0 };
  window.addEventListener('wheel', e => {
    if (e.ctrlKey || sheet()) return;
    e.preventDefault();
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(() => { wheel = { x: 0, y: 0, spent: false, timer: 0 }; }, 180);
    if (wheel.spent) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    wheel.x += e.deltaX * k; wheel.y += e.deltaY * k;
    if (Math.max(Math.abs(wheel.x), Math.abs(wheel.y)) < 40) return;
    wheel.spent = true;
    const f = /Mac|iPhone|iPad/.test(navigator.platform) ? -1 : 1;
    tilt(way(wheel.x * f, wheel.y * f));
  }, { passive: false, capture: true });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || sheet() || (e.target.matches && e.target.matches('select,input,textarea'))) return;
    const dir = { w: 'U', d: 'R', s: 'D', a: 'L' }[e.key.toLowerCase()];
    if (dir) { e.preventDefault(); tilt(dir); }
  }, true);
})();
