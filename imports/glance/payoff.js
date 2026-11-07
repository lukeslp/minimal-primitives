/* Glance · colour and sound as the reward. By Luke Steuber.
   Play is paper and ink; colour only decorates. The palettes are Mandaza's,
   as Loop's finish uses them, one per board in turn. Sound is synthesised,
   and no audio context exists until Sound is turned on. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlancePayoff = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Aurora, Sunset, Vaporwave, Cyberpunk, Risograph and Dichromat, in Loop's order.
  const palettes = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb',
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0',
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96',
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff',
    '#ff5e5b #ffed66 #00cecb #5c5cff',
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00'
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  // Stops that would vanish into the page are left out: near-black on black, near-white on white.
  const visible = (palette, night) => palette.filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  // Board n (from 1) takes palette (n - 1) mod 6.
  const paletteFor = (n, night) => visible(palettes[(n - 1) % palettes.length], night);
  // A colour along the palette, t from 0 to 1.
  function colourAt(palette, t) {
    t = Math.min(.99999, Math.max(0, t));
    if (palette.length === 1) return `rgb(${palette[0].join(', ')})`;
    const at = t * (palette.length - 1), i = Math.min(Math.floor(at), palette.length - 2), f = at - i;
    return `rgb(${palette[i].map((v, k) => Math.round(v + (palette[i + 1][k] - v) * f)).join(', ')})`;
  }
  // Soft sine tones on a pentatonic scale: a short tick per act, rising with
  // progress, and a rising chord on a finish. Quiet, and only when asked for.
  function voice(stats) {
    let ctx = null;
    const AC = () => (typeof window === 'object' && (window.AudioContext || window.webkitAudioContext)) || null;
    function context(create) {
      if (!ctx && create && AC()) { ctx = new (AC())(); stats.contexts++; }
      if (ctx && ctx.state === 'suspended') try { ctx.resume().catch(() => {}); } catch (_) {}
      return ctx;
    }
    const scale = [0, 2, 4, 7, 9], note = k => 392 * 2 ** ((12 * Math.floor(k / 5) + scale[((k % 5) + 5) % 5]) / 12);
    function tone(freq, delay, length, level) {
      const c = context(true); if (!c) return;
      const t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + .012); g.gain.exponentialRampToValueAtTime(.0001, t0 + length);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + length + .05);
    }
    return {
      tick(step) { stats.ticks++; tone(note(step), 0, .14, .05); },
      chord() { stats.chords++; [0, 2, 4, 5].forEach((k, i) => tone(note(5 + k), i * .085, .55, .045)); },
      wake() { context(false); },
      start() { context(true); },
      get context() { return ctx; }
    };
  }
  return { palettes, luminance, visible, paletteFor, colourAt, voice };
});
