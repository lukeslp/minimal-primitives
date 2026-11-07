/* Ticker · colour as the reward: a bloom for each right note and Loop's
   Mandaza palettes for a rebuilt tune. Colour only decorates; nothing to be
   told apart depends on it. By Luke Steuber. */
(function (root) {
  'use strict';
  // Loop's six Mandaza palettes, in board order: board n takes palette (n - 1) mod 6.
  const palettes = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb', // Aurora
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0', // Sunset
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96', // Vaporwave
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff', // Cyberpunk
    '#ff5e5b #ffed66 #00cecb #5c5cff', // Risograph
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00' // Dichromat
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  // Near-black stops vanish on black and near-white ones on white (sRGB relative luminance), as in Loop.
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const visibleStops = (palette, night) => palette.filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  const paletteFor = (index, night) => visibleStops(palettes[index % palettes.length], night);
  // A colour along the palette, t from 0 to 1.
  function colour(stops, t) {
    t = Math.min(.99999, Math.max(0, t));
    if (stops.length === 1) return `rgb(${stops[0].join(', ')})`;
    const at = t * (stops.length - 1), i = Math.min(Math.floor(at), stops.length - 2), f = at - i;
    return `rgb(${stops[i].map((v, c) => Math.round(v + (stops[i + 1][c] - v) * f)).join(', ')})`;
  }
  // A bloom: eight soft dots in the palette spread from (x, y) about `reach`
  // px and fade over 500 ms, by transform and opacity only. With reduced
  // motion it is instead a 200 ms fade of colour on the piece itself, `size`
  // px across, with no transform at all. The layer never takes a pointer.
  function bloom(layer, x, y, { reach, size, stops, reduced, turn = 0 }) {
    const made = [];
    if (reduced) {
      const d = document.createElement('span');
      d.className = 'petal still';
      Object.assign(d.style, { left: x - size / 2 + 'px', top: y - size / 2 + 'px', width: size + 'px', height: size + 'px', background: colour(stops, .5) });
      layer.append(d); made.push(d);
      const a = d.animate([{ opacity: .9 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
      a.onfinish = () => d.remove();
      return made;
    }
    const n = 8, dot = Math.max(7, size * .36);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span'), a = (i + turn * .5) / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), move = (k, sc) => `translate(${(c * reach * k).toFixed(1)}px, ${(s * reach * k).toFixed(1)}px) scale(${sc})`;
      p.className = 'petal';
      Object.assign(p.style, { left: x - dot / 2 + 'px', top: y - dot / 2 + 'px', width: dot + 'px', height: dot + 'px', background: colour(stops, i / (n - 1)) });
      layer.append(p); made.push(p);
      // Out from the piece's edge, full colour for the first half, fading in the second.
      const anim = p.animate([{ transform: move(.45, .55), opacity: 1, easing: 'cubic-bezier(.2, .7, .3, 1)' }, { transform: move(.85, 1), opacity: .95, offset: .5 }, { transform: move(1, .9), opacity: 0 }], { duration: 500, fill: 'forwards' });
      anim.onfinish = () => p.remove();
    }
    return made;
  }
  root.TickerPayoff = { palettes, luminance, visibleStops, paletteFor, colour, bloom };
})(typeof globalThis === 'object' ? globalThis : this);
