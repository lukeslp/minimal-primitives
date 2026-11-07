/* Sweep · colour as the reward. By Luke Steuber.
   Play stays paper and ink; colour is the payoff. Every tile chosen blooms
   where it was chosen: a few soft dots in the board's palette spread about
   half a cell and fade, in about half a second. A finished board takes colour
   in a wave outward from the last tile chosen, with one ring spreading from
   there, and holds it until the next board. The palettes are Mandaza's six,
   as Loop's finish uses them: board n takes palette (n - 1) mod 6, without
   the stops that would vanish on the page. Colour only decorates: nothing a
   player must tell apart depends on hue. Only transform and opacity move;
   with reduced motion a bloom is a short colour fade on the tile and the
   finish a fade of the colour fill. */
(function (root, make) {
  const P = make();
  if (typeof module === 'object' && module.exports) module.exports = P; else root.SweepPayoff = P;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
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
  // Near-white stops are skipped on light paper and near-black ones on dark.
  const palette = (index, night) => PALETTES[index % PALETTES.length].filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  // A colour along the palette, t from 0 to 1.
  function colour(p, t) {
    t = Math.min(.99999, Math.max(0, t));
    if (p.length === 1) return `rgb(${p[0].join(', ')})`;
    const at = t * (p.length - 1), i = Math.min(Math.floor(at), p.length - 2), f = at - i;
    return `rgb(${p[i].map((v, c) => Math.round(v + (p[i + 1][c] - v) * f)).join(', ')})`;
  }
  const BLOOM = 520, FADE = 200, WAVE = 700, FILL = 320, RING = 1000;
  function el(tag, attrs, parent) { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.append(n); return n; }
  // A bloom at (x, y) in page pixels for a tile `size` pixels across.
  function bloom(layer, x, y, size, p, reduced, seed = 0) {
    const g = el('g', { class: 'bloom', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, layer), runs = [];
    if (reduced) {
      const r = el('rect', { x: (-size * .41).toFixed(1), y: (-size * .41).toFixed(1), width: (size * .82).toFixed(1), height: (size * .82).toFixed(1), fill: colour(p, .5), opacity: 0 }, g);
      runs.push(r.animate([{ opacity: 0 }, { opacity: .8 }, { opacity: 0 }], { duration: FADE, easing: 'ease-out' }));
    } else {
      const n = 8;
      for (let k = 0; k < n; k++) {
        const a = seed + k / n * Math.PI * 2, d = size * (.5 + .14 * (k % 2)), dot = el('circle', { r: (size * .1).toFixed(1), fill: colour(p, k / (n - 1)) }, g);
        runs.push(dot.animate([{ transform: 'translate(0px, 0px) scale(.4)', opacity: 1 }, { transform: `translate(${(Math.cos(a) * d * .7).toFixed(1)}px, ${(Math.sin(a) * d * .7).toFixed(1)}px) scale(1)`, opacity: 1, offset: .45 }, { transform: `translate(${(Math.cos(a) * d).toFixed(1)}px, ${(Math.sin(a) * d).toFixed(1)}px) scale(.8)`, opacity: 0 }], { duration: BLOOM, easing: 'cubic-bezier(.2, .7, .3, 1)' }));
      }
    }
    Promise.all(runs.map(r => r.finished.catch(() => {}))).then(() => g.remove());
    return g;
  }
  // The finished board's colour: each tile's paint fades in after a delay
  // set by its distance from the last tile chosen, coloured along the
  // palette by the same distance; one ring spreads from that tile.
  function fill(tiles, at, p, { layer, centre, reach, reduced, animate }) {
    const far = Math.max(1, ...tiles.map(t => Math.hypot(t.r - at[0], t.c - at[1])));
    const runs = [];
    for (const t of tiles) {
      const d = Math.hypot(t.r - at[0], t.c - at[1]) / far;
      t.paint.setAttribute('fill', colour(p, d));
      t.paint.getAnimations().forEach(a => a.cancel());
      if (!animate) { t.paint.setAttribute('opacity', 1); continue; }
      t.paint.setAttribute('opacity', 0);
      runs.push(t.paint.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FILL, delay: reduced ? 0 : d * WAVE, easing: 'ease-out', fill: 'forwards' }));
    }
    if (animate && !reduced && layer && centre) {
      const g = el('g', { class: 'bloom', transform: `translate(${centre.x.toFixed(1)} ${centre.y.toFixed(1)})` }, layer);
      const ring = el('circle', { r: 10, fill: 'none', stroke: colour(p, .5), 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke' }, g);
      const k = Math.max(1, reach / 10);
      runs.push(ring.animate([{ transform: 'scale(1)', opacity: .9 }, { transform: `scale(${k.toFixed(2)})`, opacity: 0 }], { duration: RING, easing: 'cubic-bezier(.2, .6, .3, 1)' }));
      runs.at(-1).finished.catch(() => {}).then(() => g.remove());
    }
    return runs;
  }
  function clear(tiles) { for (const t of tiles) { t.paint.getAnimations().forEach(a => a.cancel()); t.paint.setAttribute('opacity', 0); } }

  // Sound for the payoff, when Sound is on: a soft pitched tick for each
  // tile, climbing a pentatonic scale as the board's tiles are chosen, and a
  // short rising chord for a finished board.
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
  const tick = n => SCALE[Math.min(SCALE.length - 1, n)];
  const CHORD = [523.25, 659.25, 783.99, 1046.5];
  return { NAMES, PALETTES, palette, colour, luminance, bloom, fill, clear, tick, CHORD, BLOOM, FADE, WAVE, FILL, RING };
});
