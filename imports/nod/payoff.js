/* Nod · colour as the reward. By Luke Steuber.
   Play stays paper and ink; colour is the reward. A tip that moves the marble
   blooms where it lands, and a drop through a hole blooms fuller. A finished
   board takes colour: its trays fill with the board's palette in a wave
   outward from the exit, with one ring spreading from there, and hold until
   Next. Loop's six Mandaza palettes, board n using palette (n - 1) mod 6. Only
   transform and opacity are animated, nothing takes a pointer, and nothing
   waits for an effect to end. Reduced motion keeps everything still: a bloom
   becomes a short colour fade on the cell, and the solve a fade of the fill.
   Sound, off unless turned on, is a soft tick per tip and a rising chord on
   a finish, synthesised; no AudioContext exists until it is turned on. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NodPayoff = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  // Loop's palettes (loop/loop.js), in board order.
  const PALETTES = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb', // Aurora
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0', // Sunset
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96', // Vaporwave
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff', // Cyberpunk
    '#ff5e5b #ffed66 #00cecb #5c5cff', // Risograph
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00' // Dichromat
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const NAMES = ['Aurora', 'Sunset', 'Vaporwave', 'Cyberpunk', 'Risograph', 'Dichromat'];
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  // Near-black stops vanish on dark paper and near-white ones on light paper.
  const visibleStops = (palette, night) => palette.filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  const paletteFor = (index, night) => visibleStops(PALETTES[((index % 6) + 6) % 6], night);
  const css = rgb => `rgb(${rgb.map(Math.round).join(', ')})`;
  function colourAt(stops, t) {
    t = Math.min(.99999, Math.max(0, t));
    if (stops.length === 1) return css(stops[0]);
    const at = t * (stops.length - 1), i = Math.min(Math.floor(at), stops.length - 2), f = at - i;
    return css(stops[i].map((v, c) => v + (stops[i + 1][c] - v) * f));
  }
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (parent) parent.append(n); return n;
  }
  const ease = 'cubic-bezier(.2,.7,.3,1)', FILL = .82;
  // One bloom at (x, y) in the board's units, `size` a cell. Petals spread
  // about half a cell and fade in about 500 ms; a drop sends a fuller ring of
  // petals further, with an inner ring after it. Reduced motion: a 200 ms
  // colour fade on the cell, no movement. Returns what it drew.
  function bloom(layer, { x, y, size, stops, full = false, reduced = false, turn = 0 }) {
    if (reduced) {
      const r = el('rect', { x: x - size / 2 + 1, y: y - size / 2 + 1, width: size - 2, height: size - 2, fill: colourAt(stops, (turn % 5) / 4), class: 'bloom-fade', opacity: 0 }, layer);
      const a = r.animate([{ opacity: 0 }, { opacity: .7, offset: .35 }, { opacity: 0 }], { duration: 200, easing: 'linear' });
      a.onfinish = a.oncancel = () => r.remove();
      return { kind: full ? 'drop' : 'tip', petals: 0, fade: true };
    }
    const g = el('g', { class: 'bloom' }, layer), rings = full ? [[10, .8, .15, 600, 0], [6, .45, .1, 520, 60]] : [[8, .55, .13, 500, 0]];
    let petals = 0, live = 0;
    for (const [count, reach, radius, duration, delay] of rings) {
      for (let k = 0; k < count; k++) {
        const a = (k / count + turn * .137 + (delay ? .5 / count : 0)) * Math.PI * 2, from = size * .2, to = size * reach;
        const c = el('circle', { cx: x, cy: y, r: size * radius, fill: colourAt(stops, ((k + turn) % stops.length) / Math.max(1, stops.length - 1)), opacity: 0 }, g);
        c.style.transformOrigin = `${x}px ${y}px`;
        const dx = Math.cos(a), dy = Math.sin(a);
        const anim = c.animate([
          { transform: `translate(${(dx * from).toFixed(2)}px, ${(dy * from).toFixed(2)}px) scale(1)`, opacity: 1 },
          { transform: `translate(${(dx * to).toFixed(2)}px, ${(dy * to).toFixed(2)}px) scale(.3)`, opacity: 0 }
        ], { duration, delay, easing: ease, fill: 'backwards' });
        live++; anim.onfinish = anim.oncancel = () => { if (--live === 0) g.remove(); };
        petals++;
      }
    }
    return { kind: full ? 'drop' : 'tip', petals, fade: false };
  }
  // The finished board takes colour. `cells` are the trays' open cells, each
  // {x, y, size} in the board's units, and `from` is the exit. Each cell fills
  // with the palette by its distance from the exit, in a wave over about a
  // second; one ring spreads from the exit across the stack; the exit fills
  // solid. Everything holds until cleared. Reduced motion: one fade of the fill.
  function paint(layers, { cells, from, stops, reduced = false, exitR = 20 }) {
    const far = Math.max(1, ...cells.map(c => Math.hypot(c.x - from.x, c.y - from.y))), made = [];
    for (const c of cells) {
      const d = Math.hypot(c.x - from.x, c.y - from.y) / far, r = el('rect', { x: c.x - c.size / 2 + 1, y: c.y - c.size / 2 + 1, width: c.size - 2, height: c.size - 2, fill: colourAt(stops, d), class: 'paint-cell' }, layers[c.level]);
      // A little paper shows through, so the trays' ink still reads.
      r.style.transformOrigin = `${c.x}px ${c.y}px`; r.style.opacity = FILL;
      const frames = reduced ? [{ opacity: 0 }, { opacity: FILL }] : [{ opacity: 0, transform: 'scale(.55)' }, { opacity: FILL, transform: 'scale(1)' }];
      r.animate(frames, { duration: reduced ? 400 : 320, delay: reduced ? 0 : Math.round(d * 720), easing: reduced ? 'linear' : ease, fill: 'backwards' });
      made.push(r);
    }
    const exit = el('circle', { cx: from.x, cy: from.y, r: exitR, fill: colourAt(stops, 0), class: 'paint-exit' }, layers.exit || layers.top);
    exit.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 400 : 260, easing: 'linear', fill: 'backwards' });
    made.push(exit);
    if (!reduced) {
      // The ring stays within the trays' own picture, never across the page.
      const ring = el('circle', { cx: from.x, cy: from.y, r: far, fill: 'none', stroke: colourAt(stops, 0), 'stroke-width': 4, class: 'paint-ring', 'vector-effect': 'non-scaling-stroke' }, layers.top);
      if (layers.clip) ring.setAttribute('clip-path', `url(#${layers.clip})`);
      ring.style.transformOrigin = `${from.x}px ${from.y}px`;
      const a = ring.animate([{ transform: 'scale(.04)', opacity: .9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 1000, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'forwards' });
      a.onfinish = () => ring.remove();
      made.push(ring);
    }
    return made.length;
  }
  // Sound: soft triangle tones through one quiet master gain, made only once
  // Sound is on.
  function synth() {
    let ctx = null, master = null, count = 0;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16], base = 523.25;
    function ready() {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC(); master = ctx.createGain(); master.gain.value = .12; master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    function tone(freq, at, length, level) {
      const c = ready(); if (!c) return;
      const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .008); g.gain.exponentialRampToValueAtTime(.0005, t + length);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + length + .02);
      count++;
    }
    const note = step => base * 2 ** (step / 12);
    return {
      wake: ready,
      tick(step, drop) { const s = scale[step % scale.length]; if (drop) { tone(note(s), 0, .22, .5); tone(note(s - 5), .07, .3, .45); } else tone(note(s), 0, .16, .45); },
      chord() { [0, 4, 7, 12].forEach((s, i) => tone(note(s), i * .07, .55, .35)); },
      get created() { return !!ctx; }, get count() { return count; }
    };
  }
  return { PALETTES, NAMES, luminance, visibleStops, paletteFor, colourAt, bloom, paint, synth };
});
