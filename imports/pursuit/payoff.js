/* Pursuit · colour as the reward. By Luke Steuber.
   Play is paper and ink; colour rewards. Every ring chosen by following it
   blooms where it was caught, a finished picture takes colour in a wave from
   the last ring with one ring of colour spreading out, and both can sound if
   the player asks. The palettes are Loop's six from Mandaza, one per board in
   turn. Colour only decorates: nothing to be told apart depends on hue. */
(function (root, make) {
  const P = make();
  if (typeof module === 'object' && module.exports) module.exports = P; else root.PursuitPayoff = P;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  // Loop's palettes, in board order: Aurora, Sunset, Vaporwave, Cyberpunk, Risograph, Dichromat.
  const PALETTES = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb',
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0',
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96',
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff',
    '#ff5e5b #ffed66 #00cecb #5c5cff',
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00'
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const NAMES = ['Aurora', 'Sunset', 'Vaporwave', 'Cyberpunk', 'Risograph', 'Dichromat'];
  // As in Loop: near-white stops are left out on white paper and near-black ones on black.
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const visible = (stops, night) => stops.filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  // Board n (from 1) takes palette (n - 1) mod 6.
  const paletteFor = (n, night) => visible(PALETTES[(n - 1) % PALETTES.length], night);
  function colourAt(stops, t) {
    t = Math.min(.99999, Math.max(0, t));
    if (stops.length === 1) return `rgb(${stops[0].join(', ')})`;
    const at = t * (stops.length - 1), i = Math.min(Math.floor(at), stops.length - 2), f = at - i;
    return `rgb(${stops[i].map((v, c) => Math.round(v + (stops[i + 1][c] - v) * f)).join(', ')})`;
  }
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3;
  const BLOOM = 520, TINT = 200, WAVE = 820, RING = 1000;

  // A bloom: eight soft petals spreading half a cell from where a ring was
  // caught and fading, about half a second; with reduced motion, a 200 ms
  // tint on the piece itself instead, with nothing moving.
  function bloom(list, x, y, at, cell, stops, turn = 0, piece = null) { list.push({ x, y, at, cell, stops, turn, piece }); }
  function drawBlooms(ctx, list, now, reduced, piece) {
    for (let k = list.length - 1; k >= 0; k--) {
      const b = list[k], age = now - b.at;
      if (age > (reduced ? TINT : BLOOM) || age < 0) { if (age > 0) list.splice(k, 1); continue; }
      if (reduced) {
        const p = piece ? piece(b) : [b.x, b.y, b.cell * .14];
        ctx.globalAlpha = .85 * (1 - age / TINT); ctx.fillStyle = colourAt(b.stops, .5);
        ctx.beginPath(); ctx.arc(p[0], p[1], p[2], 0, TAU); ctx.fill();
        continue;
      }
      const f = ease(age / BLOOM), reach = b.cell * (.12 + .38 * f), size = b.cell * (.085 - .035 * f);
      for (let i = 0; i < 8; i++) {
        const a = b.turn + TAU * i / 8;
        ctx.globalAlpha = .9 * (1 - age / BLOOM); ctx.fillStyle = colourAt(b.stops, i / 7);
        ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach, Math.max(1, size), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    return list.length;
  }
  // The solve: each piece of the picture takes its colour as a wave from the
  // last ring reaches it (by distance, over WAVE ms), the colours running
  // through the palette from there outward, and one ring of colour spreads
  // from the last ring past the picture's edge. With reduced motion every
  // piece fades into its colour together and no ring moves.
  function solve(at, x, y, pieces, stops) {
    const far = Math.max(1, ...pieces.map(p => Math.hypot(p.x - x, p.y - y)));
    const ranked = pieces.map(p => ({ ...p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d);
    const colour = new Map(), delay = new Map();
    ranked.forEach((p, k) => { colour.set(p.id, colourAt(stops, ranked.length > 1 ? k / (ranked.length - 1) : .3)); delay.set(p.id, p.d / far * WAVE); });
    return { at, x, y, far, colour, delay, stops };
  }
  // How far piece `id` has taken its colour (0 to 1) at time now.
  function filled(s, id, now, reduced) {
    if (!s || !s.colour.has(id)) return 0;
    return reduced ? ease((now - s.at) / 400) : ease((now - s.at - s.delay.get(id)) / 220);
  }
  function drawRing(ctx, s, now, reduced, cell) {
    if (!s || reduced) return;
    const age = now - s.at; if (age < 0 || age > RING) return;
    const f = ease(age / RING), r = cell * .3 + (s.far + cell * 1.4) * f;
    ctx.globalAlpha = .75 * (1 - age / RING); ctx.strokeStyle = colourAt(s.stops, f); ctx.lineWidth = Math.max(1, 4 * (1 - f) + 1);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // Sound, off unless chosen: a soft pitched tick per ring (rising through a
  // pentatonic scale) and a short rising chord for a finished picture, made
  // in the page with no files. No AudioContext exists until sound is on.
  function sound() {
    let audio = null;
    const ensure = () => { if (!audio) { const A = globalThis.AudioContext || globalThis.webkitAudioContext; if (!A) return null; audio = new A(); } if (audio.state === 'suspended') audio.resume().catch(() => {}); return audio; };
    function note(f, start, length, level) {
      const a = ensure(); if (!a) return;
      const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(level, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + length);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + length + .03);
    }
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
    return {
      get created() { return !!audio; },
      start() { ensure(); },
      tick(step) { try { note(scale[Math.max(0, step) % scale.length], 0, .09, .045); } catch (_) {} },
      chord() { try { [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => note(f, k * .07, .42, .035)); } catch (_) {} }
    };
  }
  return { PALETTES, NAMES, luminance, visible, paletteFor, colourAt, bloom, drawBlooms, solve, filled, drawRing, sound, BLOOM, TINT, WAVE, RING };
});
