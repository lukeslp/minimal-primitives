/* Pursuit · paths, the pursuit selector and the board rules. By Luke Steuber.
   After Vidal, Bulling and Gellersen, "Pursuits" (UbiComp 2013): every target
   moves on its own closed path, and the one chosen is the one whose motion
   the eyes, the head or a pointer follows, measured by Pearson's correlation
   on x and on y over the last second. No document, clock or page lives here;
   every call is given its time, so the tests and the board search run it too. */
(function (root, make) {
  const E = make();
  if (typeof module === 'object' && module.exports) module.exports = E; else root.PursuitEngine = E;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  // The selector. A target is chosen when its score (the smaller of its x and
  // y correlations, at the best of a few lags) reaches THRESHOLD and leads every
  // other target by MARGIN for FILL ms in all. Its trail fills while it leads
  // by the margin, holds while it stays the leader above the threshold but
  // another target looks alike for a moment, and drains otherwise. The input
  // is compared with where each target was up to a quarter second earlier,
  // since a follower lags a little and the camera and its smoothing lag a
  // little more.
  const WINDOW = 1000, LAGS = [0, 80, 160, 240], THRESHOLD = .8, MARGIN = .15, FILL = 600;
  // Following also moves about as far as the target does: the input's spread
  // on each axis, against the target's, must lie within GAIN, and the two axes
  // within RATIO of each other. Smooth wandering that happens to curve like a
  // path for a moment rarely matches its size on both axes as well.
  const GAIN = [.4, 2.5], RATIO = 1.6;
  // And it keeps the target's coupling of x with y: the correlation between
  // the input's own x and y must lie within COUPLING of the target's. A
  // straight stroke, whose x and y move in lockstep, rarely matches a curve.
  const COUPLING = .4;
  // And it never moves much faster than the target: the input's peak speed
  // (over spans of at least SPAN_MS) may be at most SPEED times the target's,
  // scaled by the gain. Saccades and quick strokes jump far faster than any path.
  const SPEED = 3, SPEED_SPAN = 80;
  // A window needs most of a second of samples, at least twelve, with no gap
  // longer than GAP; the input must also move, by at least the floor given for
  // its units, so a still look never correlates with anything.
  const GAP = 150, SPAN = 800, SAMPLES = 12;
  // A path that changes after a choice blends into its new path over GLIDE ms.
  const GLIDE = 420;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

  // A path is [kind, a, b, tilt, dir, period, phase]: kind 'o' is an ellipse
  // (a circle when a equals b) and '8' a figure of eight, Lissajous one to two;
  // a and b are its half widths in cells, tilt turns it (degrees), dir is 1 or
  // -1, the period is in ms and the phase in turns. Returns the offset from the
  // path's centre at time t (ms since the board began).
  function local(path, t) {
    const kind = path[0], a = path[1], b = path[2], tilt = path[3], dir = path[4], period = path[5], phase = path[6];
    const u = TAU * (t / period + phase) * dir;
    let x, y;
    if (kind === '8') { x = a * Math.sin(u); y = b * Math.sin(2 * u); }
    else { x = a * Math.cos(u); y = b * Math.sin(u); }
    if (!tilt) return [x, y];
    const r = tilt * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  }
  // The farthest a path reaches from its centre on each axis.
  function reach(path) {
    let x = 0, y = 0;
    for (let k = 0; k < 96; k++) { const p = local(path, path[5] * k / 96); x = Math.max(x, Math.abs(p[0])); y = Math.max(y, Math.abs(p[1])); }
    return [x, y];
  }

  // Pearson's correlation of the first n values of a and b; `out[0]`, when
  // given, receives the spread of a over the spread of b.
  function pearson(a, b, n, out) {
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; ab += da * db; aa += da * da; bb += db * db; }
    if (out) out[0] = bb < 1e-12 ? Infinity : Math.sqrt(aa / bb);
    return aa < 1e-12 || bb < 1e-12 ? 0 : ab / Math.sqrt(aa * bb);
  }

  // The selector: samples of the input in, a choice out. Candidates are
  // { id, at(t) } with at giving a target's position at time t, in any units
  // in the input's units. `floor` is the least spread, in those units, that
  // counts as moving; `gain` and `ratio` bound how far the input moves against
  // each target (null leaves them out). With signed false the score ignores the
  // sign of each correlation and the size of the motion, and reports the signs
  // and gains it found: used once to learn how the camera's readings run.
  function selector(options = {}) {
    const o = { window: WINDOW, lags: LAGS, threshold: THRESHOLD, margin: MARGIN, fill: FILL, gap: GAP, span: SPAN, samples: SAMPLES, floor: 0, signed: true, gain: GAIN, ratio: RATIO, coupling: COUPLING, speed: SPEED, ...options };
    let ts = [], xs = [], ys = [], acc = new Map(), last = null, signs = null, gains = null;
    const gx = [0], gy = [0];
    let view = { scores: new Map(), leader: null, best: -1, second: -1, gated: true, confidence: 0, signs: null };
    const tx = new Float64Array(512), ty = new Float64Array(512), ix = new Float64Array(512), iy = new Float64Array(512);
    // The fastest the series a (x) and b (y) move over spans of at least SPEED_SPAN ms.
    function peak(a, b, n) {
      let top = 0, j = 0;
      for (let i = 0; i < n; i++) {
        while (j < n && ts[j] - ts[i] < SPEED_SPAN) j++;
        if (j >= n) break;
        const v = Math.hypot(a[j] - a[i], b[j] - b[i]) / (ts[j] - ts[i]);
        if (v > top) top = v;
      }
      return top;
    }
    function reset() { ts = []; xs = []; ys = []; acc = new Map(); last = null; view = { scores: new Map(), leader: null, best: -1, second: -1, gated: true, confidence: 0, signs: null }; }
    function sample(t, x, y, candidates) {
      if (x === null || x === undefined || y === null || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
        if (ts.length && t - ts[ts.length - 1] > o.gap) reset();
        return null;
      }
      if (ts.length && t <= ts[ts.length - 1]) return null;
      if (ts.length && t - ts[ts.length - 1] > o.gap) reset();
      ts.push(t); xs.push(x); ys.push(y);
      let cut = 0; while (cut < ts.length && ts[cut] < t - o.window) cut++;
      if (ts.length - cut > 500) cut = ts.length - 500;
      if (cut) { ts.splice(0, cut); xs.splice(0, cut); ys.splice(0, cut); }
      const dt = last === null ? 0 : Math.min(100, t - last); last = t;
      const n = ts.length, scores = new Map();
      let inputXY = 0, inputSpeed = 0;
      let gated = n < o.samples || t - ts[0] < o.span;
      if (!gated) {
        let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
        let vx = 0, vy = 0; for (let i = 0; i < n; i++) { vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
        if (Math.sqrt(vx / n) < o.floor || Math.sqrt(vy / n) < o.floor) gated = true;
        for (let i = 0; i < n; i++) { ix[i] = xs[i]; iy[i] = ys[i]; }
        inputXY = o.coupling ? pearson(ix, iy, n) : 0;
        inputSpeed = o.speed ? peak(ix, iy, n) : 0;
      }
      let leader = null, best = -Infinity, second = -Infinity, found = null, scale = null;
      if (!gated) for (const c of candidates) {
        let s = -Infinity, sg = null, sc = null;
        for (const L of o.lags) {
          for (let i = 0; i < n; i++) { const p = c.at(ts[i] - L); tx[i] = p[0]; ty[i] = p[1]; }
          const rx = pearson(ix, tx, n, gx), ry = pearson(iy, ty, n, gy);
          let v = o.signed ? Math.min(rx, ry) : Math.min(Math.abs(rx), Math.abs(ry));
          if (o.gain && (gx[0] < o.gain[0] || gx[0] > o.gain[1] || gy[0] < o.gain[0] || gy[0] > o.gain[1])) v = Math.min(v, 0);
          if (o.ratio && (gx[0] > o.ratio * gy[0] || gy[0] > o.ratio * gx[0])) v = Math.min(v, 0);
          if (o.coupling && v > 0 && Math.abs(pearson(tx, ty, n) - inputXY) > o.coupling) v = 0;
          if (o.speed && v > 0 && inputSpeed > o.speed * (gx[0] + gy[0]) / 2 * peak(tx, ty, n)) v = 0;
          if (v > s) { s = v; sg = [rx < 0 ? -1 : 1, ry < 0 ? -1 : 1]; sc = [gx[0], gy[0]]; }
        }
        scores.set(c.id, s);
        if (s > best) { second = best; best = s; leader = c.id; found = sg; scale = sc; } else if (s > second) second = s;
      }
      const passing = leader !== null && best >= o.threshold && best - second >= o.margin;
      const holding = !passing && leader !== null && best >= o.threshold && acc.has(leader);
      for (const [id, a] of acc) if (!((passing || holding) && id === leader)) { const q = a - dt / o.fill; if (q <= 0) acc.delete(id); else acc.set(id, q); }
      let chosen = null;
      if (passing) { const a = (acc.get(leader) || 0) + dt / o.fill; if (a >= 1) chosen = leader; else acc.set(leader, a); }
      // What the trail shows: how near the leader is to the threshold, scaled
      // by how clearly it leads, then the steady part filling.
      const lead = leader === null ? 0 : second === -Infinity ? 1 : clamp((best - second) / o.margin, 0, 1);
      const near = leader === null ? 0 : clamp((best - .4) / (o.threshold - .4), 0, 1);
      view = { scores, leader, best, second, gated, signs: found, confidence: leader === null ? 0 : chosen !== null ? 1 : .6 * near * lead + .4 * (acc.get(leader) || 0) };
      if (chosen !== null) { signs = found; gains = scale; reset(); view.leader = chosen; view.confidence = 1; }
      return chosen;
    }
    return {
      sample, reset,
      get view() { return view; },
      // The signs and gains (input spread over target spread) found at the last
      // choice: with signed false, which way and how far the input runs.
      get signs() { return signs; },
      get gains() { return gains; },
      progress: id => acc.get(id) || 0,
      get size() { return ts.length; }
    };
  }

  // ---- The board rules. A board is a picture of sockets: every target
  // circles its socket on a path; marked targets (hollow rings) belong in the
  // picture and the rest are decoys. Choosing a marked target that is open
  // fills its socket; choosing anything else crosses it out, and the picture
  // is not finished while a cross stands. On an ordered board only the next
  // mark of the order is open. Undo takes back the last choice.
  const start = () => ({ filled: [], crossed: [], history: [] });
  const marks = b => b.targets.map((t, i) => t.mark ? i : -1).filter(i => i >= 0);
  const par = b => marks(b).length;
  function open(b, s) {
    if (!b.order) return marks(b).filter(i => !s.filled.includes(i));
    const next = b.order.find(i => !s.filled.includes(i));
    return next === undefined ? [] : [next];
  }
  const solved = (b, s) => s.crossed.length === 0 && marks(b).every(i => s.filled.includes(i));
  // How many choices stand: the stage that sets each target's path.
  const stage = s => s.filled.length + s.crossed.length;
  const pathOf = (b, i, k) => { const p = b.targets[i].paths; return p[Math.min(k, p.length - 1)]; };
  // The targets still moving: neither filled nor crossed, while the picture is unfinished.
  const contention = (b, s) => solved(b, s) ? [] : b.targets.map((_, i) => i).filter(i => !s.filled.includes(i) && !s.crossed.includes(i));
  function choose(b, s, i) {
    const n = { filled: s.filled.slice(), crossed: s.crossed.slice(), history: s.history.concat([{ filled: s.filled.slice(), crossed: s.crossed.slice() }]) };
    if (open(b, s).includes(i)) n.filled.push(i); else n.crossed.push(i);
    return n;
  }
  function undo(s) {
    if (!s.history.length) return s;
    const h = s.history[s.history.length - 1];
    return { filled: h.filled.slice(), crossed: h.crossed.slice(), history: s.history.slice(0, -1) };
  }
  // Targets in reading order by socket: column, then row.
  const sweep = b => b.targets.map((_, i) => i).sort((p, q) => b.targets[p].at[0] - b.targets[q].at[0] || b.targets[p].at[1] - b.targets[q].at[1]);
  // The choice a perfect run makes next: undo while a cross stands, else the first open mark.
  function hint(b, s) {
    if (solved(b, s)) return null;
    if (s.crossed.length) return 'undo';
    const o = open(b, s);
    return sweep(b).find(i => o.includes(i)) ?? null;
  }
  // The intended answer: every mark once, in the order when there is one.
  const answer = b => b.order ? b.order.slice() : sweep(b).filter(i => b.targets[i].mark);
  // Where a target is, in cells from its socket, at time t: on the path of its
  // stage, blending from the path it had before a change.
  function offset(b, i, k, t, change = null) {
    const p = local(pathOf(b, i, k), t);
    if (!change || t >= change.at + GLIDE || t < change.at) return p;
    const q = local(pathOf(b, i, change.from), t), f = smooth((t - change.at) / GLIDE);
    return [q[0] + (p[0] - q[0]) * f, q[1] + (p[1] - q[1]) * f];
  }
  // How far every path of a board reaches beyond its sockets, on each axis.
  function extent(b) {
    let x = 0, y = 0;
    for (const t of b.targets) for (const p of t.paths) { const r = reach(p); x = Math.max(x, r[0]); y = Math.max(y, r[1]); }
    return [x, y];
  }
  return { WINDOW, LAGS, THRESHOLD, MARGIN, FILL, GAIN, RATIO, COUPLING, SPEED, GAP, SPAN, SAMPLES, GLIDE, TAU, clamp, smooth, local, reach, pearson, selector, start, marks, par, open, solved, stage, pathOf, contention, choose, undo, sweep, hint, answer, offset, extent };
});
