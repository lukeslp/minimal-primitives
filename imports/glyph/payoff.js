/* Glyph · colour and sound for a job done. By Luke Steuber.
   Play is paper and ink; colour is the reward. Every inked line blooms along
   its length, and a finished figure takes colour in a wave from its last
   point. The colours are Loop's six Mandaza palettes, board n using palette
   (n - 1) mod 6, with near-white stops left out on light paper and near-black
   ones on dark. Colour only decorates: nothing a player must tell apart
   depends on hue. Sound is off unless chosen; then a soft pitched tick marks
   each inked line and a short rising chord a finished figure, made in the
   page with WebAudio, and no audio context exists until it is first needed. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlyphPayoff = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // As in Loop (loop/loop.js), in board order.
  const NAMES = ['Aurora', 'Sunset', 'Vaporwave', 'Cyberpunk', 'Risograph', 'Dichromat'];
  const PALETTES = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb',
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0',
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96',
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff',
    '#ff5e5b #ffed66 #00cecb #5c5cff',
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00'
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  // Loop's rule: on dark paper drop stops darker than .06, on light paper stops lighter than .7.
  const visible = (palette, dark) => palette.filter(rgb => dark ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  const paletteFor = (index, dark) => visible(PALETTES[((index % 6) + 6) % 6], dark);
  const css = rgb => `rgb(${rgb.map(v => Math.round(v)).join(', ')})`;
  // A colour along the palette, t from 0 to 1.
  function along(stops, t) {
    if (stops.length === 1) return css(stops[0]);
    t = Math.min(.99999, Math.max(0, t));
    const at = t * (stops.length - 1), i = Math.floor(at), f = at - i;
    return css(stops[i].map((v, c) => v + (stops[i + 1][c] - v) * f));
  }
  // Petals for one bloom: n soft dots spaced along a line, each drifting out
  // to one side or the other by up to `spread`, alternately, with a little
  // seeded variety so no two blooms look stamped.
  function petals(n, seed) {
    let a = (seed * 2654435761) >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return Array.from({ length: n }, (_, k) => ({ at: (k + .3 + rnd() * .4) / n, side: k % 2 ? 1 : -1, out: .55 + rnd() * .45, along: (rnd() - .5) * .3, size: .75 + rnd() * .5, colour: k }));
  }
  // The finished figure's wave: each line's delay from 0 (the nearest line
  // to the last point) to 1 (the farthest), by how far its middle lies.
  function wave(mids, origin) {
    const d = mids.map(([x, y]) => Math.hypot(x - origin[0], y - origin[1])), near = Math.min(...d), span = Math.max(1e-6, Math.max(...d) - near);
    return d.map(v => (v - near) / span);
  }
  // Sound, made only when asked for.
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  function sound(make = () => new (window.AudioContext || window.webkitAudioContext)()) {
    let ctx = null;
    const ready = () => { if (!ctx) ctx = make(); if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {}); return ctx; };
    function tone(freq, at, length, peak, type = 'sine') {
      const c = ready(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + length);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + length + .02);
    }
    return {
      // A soft tick, a step higher for each line inked on the board.
      tick(step) { tone(440 * 2 ** (SCALE[step % SCALE.length] / 12), 0, .16, .05, 'triangle'); },
      // A short rising chord.
      chord() { [0, 4, 7, 12].forEach((n, k) => tone(330 * 2 ** (n / 12), k * .07, .55, .035)); },
      get context() { return ctx; }
    };
  }
  return { NAMES, PALETTES, luminance, visible, paletteFor, along, css, petals, wave, sound };
});
