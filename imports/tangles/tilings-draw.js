/* Loop · Tilings · drawing: Mandaza's palettes and Loop's colour rule with
   its drift, a curve that draws itself, one animation clock, and the
   picture's scale, plan and canvases. By Luke Steuber. */
(function (root) {
  'use strict';
  const L = root.LoopTilings;
  // Mandaza's multi-hue palettes, as Loop uses them.
  const PALETTES = [
    ['Aurora', '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb'], ['Sunset', '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0'],
    ['Vaporwave', '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96'], ['Cyberpunk', '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff'],
    ['Risograph', '#ff5e5b #ffed66 #00cecb #5c5cff'], ['Dichromat', '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00']
  ].map(([name, hex]) => ({ name, stops: hex.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))) }));
  // Mandaza's drawing speed at its default setting, in screen pixels per ms;
  // Loop's zoom, fade and turn times.
  const SPEED = (10 + 1990 * 0.707 * 0.707) / 1000, ZOOM = 1600, FADE = 420, TURN = 180;

  // Loop's colour rule: loop i of n takes the palette at i / (n - 1), shifted
  // by Mandaza's pulse at time 0; stops that would vanish into the ground are
  // left out.
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const stops = (index, night) => PALETTES[index].stops.filter(rgb => night ? luminance(rgb) >= 0.06 : luminance(rgb) <= 0.7);
  function loopColour(order, total, palette, time = 0) {
    let t = total > 1 ? order / (total - 1) : 0.5;
    t += 0.18 * Math.sin(time / 2500 + order * 0.6);
    t = Math.min(0.99999, Math.max(0, t < 0 ? -t : t > 1 ? 2 - t : t));
    const at = t * (palette.length - 1), i = Math.min(Math.floor(at), palette.length - 2), f = at - i;
    return `rgb(${palette[i].map((v, c) => Math.round(v + (palette[i + 1][c] - v) * f)).join(', ')})`;
  }

  // A closed curve drawn as Mandaza draws it: completed cubics kept in one
  // path, the cubic in flight split at the distance reached.
  const lerp = (p, q, a) => ({ x: p.x + (q.x - p.x) * a, y: p.y + (q.y - p.y) * a });
  function split(c, a) {
    const pa = lerp(c[0], c[1], a), pb = lerp(c[1], c[2], a), pc = lerp(c[2], c[3], a), pd = lerp(pa, pb, a), pe = lerp(pb, pc, a), pf = lerp(pd, pe, a);
    return [[c[0], pa, pd, pf], [pf, pe, pc, c[3]]];
  }
  function cubicLength(c) { const d0 = split(c, 0.5), d1 = split(d0[0], 0.5), d2 = split(d0[1], 0.5); return L.gap(d1[0][0], d1[0][3]) + L.gap(d1[1][0], d1[1][3]) + L.gap(d2[0][0], d2[0][3]) + L.gap(d2[1][0], d2[1][3]); }
  class Trace {
    constructor(bezier, order) { this.bezier = bezier; this.order = order; this.lengths = bezier.map(cubicLength); this.length = this.lengths.reduce((a, b) => a + b, 0); this.reset(); }
    reset() { this.path = new Path2D(); this.path.moveTo(this.bezier[0][0].x, this.bezier[0][0].y); this.next = 0; this.drawn = 0; this.pos = 0; }
    get done() { return this.next >= this.bezier.length; }
    advance(d) {
      if (this.done) return false;
      this.pos += d;
      while (this.next < this.bezier.length && this.pos >= this.drawn + this.lengths[this.next]) {
        const c = this.bezier[this.next]; this.path.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
        this.drawn += this.lengths[this.next++];
      }
      return !this.done;
    }
    shape() {
      if (this.done) return this.path;
      const p = new Path2D(this.path), frag = split(this.bezier[this.next], (this.pos - this.drawn) / this.lengths[this.next])[0];
      p.bezierCurveTo(frag[1].x, frag[1].y, frag[2].x, frag[2].y, frag[3].x, frag[3].y);
      return p;
    }
  }
  const cubic = c => `C${c[1].x.toFixed(4)},${c[1].y.toFixed(4)} ${c[2].x.toFixed(4)},${c[2].y.toFixed(4)} ${c[3].x.toFixed(4)},${c[3].y.toFixed(4)}`;
  const pathOf = bz => `M${bz[0][0].x.toFixed(4)},${bz[0][0].y.toFixed(4)}` + bz.map(cubic).join('');
  const ease = p => p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;

  // One animation clock for the page: each job steps by the frame's time and
  // says whether it wants another frame.
  const running = new Set(); let frame = 0, last = 0;
  function run(job) { running.add(job); if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } }
  function tick(now) { const dt = Math.min(64, now - last); last = now; for (const job of [...running]) if (!job.step(dt)) running.delete(job); frame = running.size ? requestAnimationFrame(tick) : 0; }

  // The scale of a picture: Loop's reveal cell, max(34, short side / 13)
  // pixels of hexagon radius, carried to each tiling by its edges per area.
  // The board fits the area fitW by fitH and sits at (cx, cy) of the page.
  function layout(T, board, { W, H, cx = W / 2, cy = H / 2, fitW = W, fitH = H, fit = 0.86 }) {
    const unit = L.unitOf(T), u = Math.max(34, Math.min(W, H) / 13);
    let bx = 0, by = 0, sPlay = u * unit;
    if (board) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const t of board.tiles) for (const v of t.poly.v) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      bx = (x0 + x1) / 2; by = (y0 + y1) / 2; sPlay = Math.min(fitW * fit / (x1 - x0), fitH * fit / (y1 - y0));
    }
    const sFinal = Math.min(sPlay, u * unit), uFinal = sFinal / unit, uPlay = sPlay / unit;
    return { W, H, cx, cy, bx, by, sPlay, sFinal, unit, colourPx: Math.max(2.4, uFinal / 25), inkPx: Math.min(uFinal / 9, 6), playPx: Math.min(uPlay / 9, 6), glow: Math.max(1.5, uFinal / 10), shadow: Math.max(1, uFinal * 0.044), seed: `${T.id}/${Math.round(W)}x${Math.round(H)}` };
  }
  // The picture over the whole page at its final scale.
  function plan(T, board, answer, lay, row = null, seed = lay.seed) {
    const s = lay.sFinal, rect = { x0: lay.bx - lay.cx / s, x1: lay.bx + (lay.W - lay.cx) / s, y0: lay.by - lay.cy / s, y1: lay.by + (lay.H - lay.cy) / s };
    return L.picture(T, { rect, board, rots: answer, centre: { x: lay.bx, y: lay.by }, seed, row });
  }
  // A picture on a pair of canvases: lines, and a quarter-size copy blurred
  // under them as a glow on black or a faint ink shadow on paper.
  function makePic(frameEl, ink) {
    const canvas = cls => { const c = document.createElement('canvas'); c.className = cls; c.setAttribute('aria-hidden', 'true'); frameEl.append(c); return c; };
    const glow = ink ? null : canvas('glow'), lines = canvas('lines');
    return { frame: frameEl, lines, glow, ink, traces: null, S: 1, drawn: false };
  }
  function fresh(pic, picture) { pic.traces = picture.loops.map((l, i) => new Trace(l.bezier, i)); pic.total = pic.traces.length; }
  function complete(pic) { for (const t of pic.traces) t.advance(Infinity); pic.drawn = true; }
  // Clears and strokes every loop drawn so far: ink in one colour, or each
  // loop in its palette colour, then copies the lines to the glow.
  function paint(lay, pic, { night, palette, ink, time = 0 }) {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(lay.W * dpr), h = Math.round(lay.H * dpr);
    if (pic.lines.width !== w || pic.lines.height !== h) { pic.lines.width = w; pic.lines.height = h; }
    const x = pic.lines.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    let g = null;
    if (pic.glow) {
      const gw = Math.ceil(w / 4), gh = Math.ceil(h / 4);
      if (pic.glow.width !== gw || pic.glow.height !== gh) { pic.glow.width = gw; pic.glow.height = gh; }
      g = pic.glow.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, gw, gh);
    }
    pic.frame.dataset.night = String(night);
    if (!pic.traces) return;
    const S = pic.S;
    x.setTransform(dpr * S, 0, 0, dpr * S, dpr * (lay.cx - lay.bx * S), dpr * (lay.cy - lay.by * S));
    x.lineCap = x.lineJoin = 'round'; x.lineWidth = (pic.ink ? lay.inkPx : lay.colourPx) / lay.sFinal;
    if (pic.ink) {
      const all = new Path2D(); for (const t of pic.traces) if (t.pos) all.addPath(t.shape());
      x.strokeStyle = ink; x.stroke(all);
    } else {
      const groups = new Map();
      for (const t of pic.traces) { if (!t.pos) continue; const c = loopColour(t.order, pic.total, palette, time); let p = groups.get(c); if (!p) groups.set(c, p = new Path2D()); p.addPath(t.shape()); }
      for (const [c, p] of groups) { x.strokeStyle = c; x.stroke(p); }
      if (g) g.drawImage(pic.lines, 0, 0, pic.glow.width, pic.glow.height);
    }
  }
  root.LoopTilingsDraw = { PALETTES, SPEED, ZOOM, FADE, TURN, stops, loopColour, Trace, cubicLength, pathOf, ease, running, run, layout, plan, makePic, fresh, complete, paint };
})(typeof globalThis === 'object' ? globalThis : this);
