/* Loop · Tilings · Loop's Mandaza tiles on other tilings: geometry, the curve
   rule for any convex polygon, the rules, an exact solver, hints and the
   picture's generator. By Luke Steuber. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoopTilings = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const S2 = Math.SQRT2, S3 = Math.sqrt(3), DEG = Math.PI / 180;

  // Every tiling has sides of length 1. A periodic tiling is a lattice (a, b)
  // and the polygons of one cell: a regular n-gon about c whose first vertex
  // sits at angle a0 degrees. Vertices run by increasing angle, which is
  // clockwise on screen (y down), so edge k runs from vertex k to k + 1 and a
  // clockwise turn of one step carries edge k to edge k + 1.
  const L488 = 1 + S2, L4612 = 3 + S3, L3464 = 1 + S3;
  const TILINGS = [
    { id: 'hex', name: 'Hexagons', symbol: '6.6.6', a: [1.5, S3 / 2], b: [0, S3],
      motif: [{ n: 6, c: [0, 0], a0: 0 }], board: { centre: [0, 0], radius: 3.5 }, campaign: [[[0, 0], 1.8, 3], 'sheet', [[0, 0], 5.25, 12], [[0, 0], 6.95, 16]] },
    { id: 'square', name: 'Squares', symbol: '4.4.4.4', a: [1, 0], b: [0, 1],
      motif: [{ n: 4, c: [0, 0], a0: 45 }], board: { centre: [0.5, 0.5], radius: 1.6 }, campaign: [[[0, 0], 1.45, 3], 'sheet', [[0.5, 0.5], 2.6, 10], [[0.5, 0.5], 3.6, 14]] },
    { id: 'triangle', name: 'Triangles', symbol: '3.3.3.3.3.3', a: [1, 0], b: [0.5, S3 / 2],
      motif: [{ n: 3, c: [0.5, S3 / 6], a0: 210 }, { n: 3, c: [1, S3 / 3], a0: 270 }], board: { centre: [1, S3 / 3], radius: 1.17 }, campaign: [[[0, 0], 0.6, 3], 'sheet', [[1, S3 / 3], 2.1, 12], [[1, S3 / 3], 2.95, 16]] },
    { id: '488', name: 'Octagons and squares', symbol: '4.8.8', a: [L488, 0], b: [0, L488],
      motif: [{ n: 8, c: [0, 0], a0: 22.5 }, { n: 4, c: [L488 / 2, L488 / 2], a0: 0 }], board: { centre: [0, 0], radius: 3.5 }, campaign: [[[0, 0], 2.45, 3], 'sheet', [[0, 0], 4.85, 10], [[0, 0], 5.15, 12]] },
    { id: '3636', name: 'Hexagons and triangles', symbol: '3.6.3.6', a: [2, 0], b: [1, S3],
      motif: [{ n: 6, c: [0, 0], a0: 0 }, { n: 3, c: [1, S3 / 3], a0: 270 }, { n: 3, c: [1, -S3 / 3], a0: 90 }], board: { centre: [0, 0], radius: 2.1 }, campaign: [[[0, 0], 1.2, 3], 'sheet', [[0, 0], 3.1, 10], [[0, 0], 3.5, 14]] },
    { id: '4612', name: 'Dodecagons, hexagons and squares', symbol: '4.6.12', a: [L4612, 0], b: [L4612 / 2, L4612 * S3 / 2],
      motif: [{ n: 12, c: [0, 0], a0: 15 }, { n: 4, c: [L4612 / 2, 0], a0: 45 }, { n: 4, c: [L4612 / 4, L4612 * S3 / 4], a0: 105 }, { n: 4, c: [-L4612 / 4, L4612 * S3 / 4], a0: 165 },
        { n: 6, c: [L4612 / 2, L4612 * S3 / 6], a0: 0 }, { n: 6, c: [L4612, L4612 * S3 / 3], a0: 0 }], board: { centre: [0, 0], radius: 2.9 }, campaign: [[[0, 0], 2.4, 3], 'sheet', [[0, 0], 4.75, 10], [[0, 0], 5.5, 12]] },
    { id: '3464', name: 'Hexagons, squares and triangles', symbol: '3.4.6.4', a: [L3464, 0], b: [L3464 / 2, L3464 * S3 / 2],
      motif: [{ n: 6, c: [0, 0], a0: 30 }, { n: 4, c: [L3464 / 2, 0], a0: 45 }, { n: 4, c: [L3464 / 4, L3464 * S3 / 4], a0: 105 }, { n: 4, c: [-L3464 / 4, L3464 * S3 / 4], a0: 165 },
        { n: 3, c: [L3464 / 2, L3464 * S3 / 6], a0: 90 }, { n: 3, c: [L3464, L3464 * S3 / 3], a0: 30 }], board: { centre: [0, 0], radius: 1.6 }, campaign: [[[0, 0], 1.4, 3], 'sheet', [[0, 0], 2.4, 10], [[0, 0], 3.2, 14]] },
    { id: 'cairo', name: 'Cairo pentagons', symbol: 'Cairo', irregular: true, make: cairo }
  ];
  const byId = Object.fromEntries(TILINGS.map(t => [t.id, t]));

  const pointKey = p => Math.round(p.x * 1e4) + ',' + Math.round(p.y * 1e4);
  function regular(n, c, a0) {
    const R = 1 / (2 * Math.sin(Math.PI / n)), v = [];
    for (let k = 0; k < n; k++) { const a = (a0 + 360 * k / n) * DEG; v.push({ x: c[0] + R * Math.cos(a), y: c[1] + R * Math.sin(a) }); }
    return { n, c: { x: c[0], y: c[1] }, v, R, regular: true };
  }
  // The Cairo tiling, as a contrast: pentagons with equal sides and corners of
  // 90, about 114 and about 131 degrees cannot turn onto themselves. Corners of four edges sit
  // on a square lattice; inside each lattice square a short edge joins two
  // corners of three, lying across or along by the square's parity. Every
  // lattice edge is the diagonal of one pentagon. h makes every side equal.
  const CH = (Math.sqrt(7) - 1) / 6, CG = 1 / (2 * CH);
  function cairo(rect, pad) {
    const out = [], h = CH, g = CG, seen = new Set();
    const pair = (i, j) => ((i + j) & 1) ? [[i + 0.5, j + 0.5 - h], [i + 0.5, j + 0.5 + h]] : [[i + 0.5 - h, j + 0.5], [i + 0.5 + h, j + 0.5]];
    const join = (i, j, [x, y]) => { const [p, q] = pair(i, j); return ((i + j) & 1) ? (y === j ? p : q) : (x === i ? p : q); };
    const i0 = Math.floor((rect.x0 - pad) / g) - 2, i1 = Math.ceil((rect.x1 + pad) / g) + 2, j0 = Math.floor((rect.y0 - pad) / g) - 2, j1 = Math.ceil((rect.y1 + pad) / g) + 2;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [P, Q, s1, s2] of [[[i, j], [i + 1, j], [i, j - 1], [i, j]], [[i, j], [i, j + 1], [i - 1, j], [i, j]]]) {
      const pts = [P, Q, join(...s1, P), join(...s1, Q), join(...s2, P), join(...s2, Q)].map(([x, y]) => ({ x: x * g, y: y * g }));
      const v = [], keys = new Set(); for (const p of pts) { const k = pointKey(p); if (!keys.has(k)) { keys.add(k); v.push(p); } }
      const c = { x: v.reduce((a, p) => a + p.x, 0) / v.length, y: v.reduce((a, p) => a + p.y, 0) / v.length };
      v.sort((p, q) => Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(q.y - c.y, q.x - c.x));
      const R = Math.max(...v.map(p => Math.hypot(p.x - c.x, p.y - c.y)));
      if (c.x + R < rect.x0 - pad || c.x - R > rect.x1 + pad || c.y + R < rect.y0 - pad || c.y - R > rect.y1 + pad) continue;
      const key = pointKey(c); if (seen.has(key)) continue; seen.add(key);
      out.push({ n: v.length, c, v, R, regular: false, key });
    }
    return out;
  }
  // The polygons whose circumcircle meets rect, grown by pad.
  function polygons(T, rect, pad = 0) {
    if (T.make) return T.make(rect, pad);
    const [ax, ay] = T.a, [bx, by] = T.b, det = ax * by - ay * bx, out = [];
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [x, y] of [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y1]]) {
      const i = (x * by - y * bx) / det, j = (ax * y - ay * x) / det;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    const reach = 2 + pad / Math.min(Math.hypot(ax, ay), Math.hypot(bx, by));
    for (let i = Math.floor(i0 - reach); i <= Math.ceil(i1 + reach); i++) for (let j = Math.floor(j0 - reach); j <= Math.ceil(j1 + reach); j++) for (const m of T.motif) {
      const c = [i * ax + j * bx + m.c[0], i * ay + j * by + m.c[1]], R = 1 / (2 * Math.sin(Math.PI / m.n));
      if (c[0] + R < rect.x0 - pad || c[0] - R > rect.x1 + pad || c[1] + R < rect.y0 - pad || c[1] - R > rect.y1 + pad) continue;
      const p = regular(m.n, c, m.a0); p.key = pointKey(p.c); out.push(p);
    }
    return out;
  }
  // Neighbours across each edge, as [polygon index, its edge], or null.
  function link(polys) {
    const edges = new Map();
    polys.forEach((p, pi) => {
      p.nb = Array(p.n).fill(null);
      for (let k = 0; k < p.n; k++) {
        const a = pointKey(p.v[k]), b = pointKey(p.v[(k + 1) % p.n]), key = a < b ? a + '|' + b : b + '|' + a, e = edges.get(key);
        if (e) { p.nb[k] = e; polys[e[0]].nb[e[1]] = [pi, k]; } else edges.set(key, [pi, k]);
      }
    });
    return polys;
  }
  // Edges per unit area, from one lattice cell. The pictures are scaled so
  // every tiling carries as many edges, and so as many dots, per area as
  // Loop's hexagons at Mandaza's cell size.
  function density(T) {
    if (T.id === 'cairo') return 20 / (4 * CG * CG);
    return T.motif.reduce((a, m) => a + m.n, 0) / 2 / Math.abs(T.a[0] * T.b[1] - T.a[1] * T.b[0]);
  }
  const HEX_DENSITY = 3 / (1.5 * S3);
  const unitOf = T => Math.sqrt(density(T) / HEX_DENSITY);

  // Geometry of one polygon.
  const lerp = (p, q, f) => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
  const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const FRACTIONS = [[], [1 / 2], [3 / 8, 5 / 8], [9 / 32, 1 / 2, 23 / 32]];
  const mid = (p, k) => lerp(p.v[k], p.v[(k + 1) % p.n], 0.5);
  function inward(p, k) {
    const a = p.v[k], b = p.v[(k + 1) % p.n], len = gap(a, b);
    let x = -(b.y - a.y) / len, y = (b.x - a.x) / len; const m = mid(p, k);
    if ((p.c.x - m.x) * x + (p.c.y - m.y) * y < 0) { x = -x; y = -y; }
    return { x, y };
  }
  function corner(p, i) {
    const c = p.v[i], a = p.v[(i + p.n - 1) % p.n], b = p.v[(i + 1) % p.n];
    const ux = a.x - c.x, uy = a.y - c.y, vx = b.x - c.x, vy = b.y - c.y;
    return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
  }
  const dotAt = (p, k, i, n) => lerp(p.v[k], p.v[(k + 1) % p.n], FRACTIONS[n][i]);
  // Mandaza's cell rule (cellToBezier), read by geometry so it holds for any
  // convex polygon. A curve leaves each dot along its edge's inward normal.
  // Two dots on one edge: handles of 0.2. Edges sharing a corner: the handle
  // at each end is k times the corner's distance to the other dot, Mandaza's
  // k = 0.75 for a 120 degree corner, scaled as tan(angle / 4) so that the
  // curve stays near a circular arc about any corner. Edges further apart:
  // handles in proportion to the distance between the two edges' midpoints,
  // at the hexagon's own ratios for the angle between the edges (0.6 over
  // 1.5 at 120 degrees, 0.5 over the square root of 3 when opposite). On the
  // hexagon this is Mandaza's rule exactly.
  const ARC = 0.75 / Math.tan(Math.PI / 6);
  function reach(phi) {
    const a = 0.375 / (S3 / 2), b = 0.4, c = 0.5 / S3;
    if (phi <= Math.PI / 3) return a;
    if (phi <= 2 * Math.PI / 3) return a + (b - a) * (phi - Math.PI / 3) / (Math.PI / 3);
    return b + (c - b) * Math.min(1, (phi - 2 * Math.PI / 3) / (Math.PI / 3));
  }
  function bezier(p, k0, p0, k1, p1) {
    const n = p.n, m0 = inward(p, k0), m1 = inward(p, k1), diff = ((k1 - k0) % n + n) % n;
    let d0, d1;
    if (diff === 0) d0 = d1 = 0.2 * gap(p.v[k0], p.v[(k0 + 1) % n]);
    else if (diff === 1 || diff === n - 1) {
      const ci = diff === n - 1 ? k0 : k1, c = p.v[ci], k = ARC * Math.tan(corner(p, ci) / 4);
      d0 = k * gap(c, p1); d1 = k * gap(c, p0);
    } else {
      const phi = Math.acos(Math.max(-1, Math.min(1, m0.x * m1.x + m0.y * m1.y)));
      d0 = d1 = reach(phi) * gap(mid(p, k0), mid(p, k1));
    }
    return [p0, { x: p0.x + m0.x * d0, y: p0.y + m0.y * d0 }, { x: p1.x + m1.x * d1, y: p1.y + m1.y * d1 }, p1];
  }

  // A board: tiles stored in their solved orientation, counts[k] dots on edge
  // k and pairs [[k, i], [k2, i2]] joined inside. Turning a tile by t steps
  // carries edge k to edge k + t. Dot i of n meets dot n - 1 - i across an edge.
  const mod = (a, n) => ((a % n) + n) % n;
  const countAt = (t, rot, k) => t.counts[mod(k - rot, t.n)];
  const turnDot = ([k, i], rot, n) => [mod(k + rot, n), i];
  // A tiling's preview campaign: board shapes [centre, radius, tiles turned],
  // with 'sheet' standing for the sample sheet's board.
  const shapes = T => T.campaign.map(c => c === 'sheet' ? { centre: T.board.centre, radius: T.board.radius, sheet: true } : { centre: c[0], radius: c[1], turned: c[2] });
  // The board's polygons, matched by key, and its neighbours within the board.
  function boardPolys(T, shape = T.board) {
    const { centre: [cx, cy], radius } = shape;
    const polys = polygons(T, { x0: cx - radius - 2, y0: cy - radius - 2, x1: cx + radius + 2, y1: cy + radius + 2 })
      .filter(p => Math.hypot(p.c.x - cx, p.c.y - cy) <= radius)
      .sort((p, q) => Math.hypot(p.c.x - cx, p.c.y - cy) - Math.hypot(q.c.x - cx, q.c.y - cy) || p.c.y - q.c.y || p.c.x - q.c.x);
    return link(polys);
  }
  function prepare(data) {
    const T = byId[data.tiling], polys = boardPolys(T, data.centre ? data : T.board), at = new Map(polys.map((p, i) => [p.key, i]));
    const order = data.tiles.map(t => at.get(t.key));
    if (order.some(i => i === undefined)) throw Error('board does not fit ' + data.tiling);
    const back = new Map(order.map((pi, ti) => [pi, ti]));
    const tiles = data.tiles.map((t, i) => { const poly = polys[order[i]]; return { ...t, n: poly.n, poly, nb: poly.nb.map(e => e && back.has(e[0]) ? [back.get(e[0]), e[1]] : null) }; });
    return { ...data, T, tiles };
  }
  function loose(board, rots) {
    const out = [];
    board.tiles.forEach((t, i) => {
      for (let k = 0; k < t.n; k++) {
        const n = countAt(t, rots[i], k); if (!n) continue;
        const e = t.nb[k], m = e ? countAt(board.tiles[e[0]], rots[e[0]], e[1]) : 0;
        if (n !== m) out.push({ tile: i, edge: k, dots: n, facing: m });
      }
    });
    return out;
  }
  const solved = (board, rots) => loose(board, rots).length === 0;
  function patterns(tile) {
    const seen = new Map();
    for (let rot = 0; rot < tile.n; rot++) {
      const counts = []; for (let k = 0; k < tile.n; k++) counts.push(countAt(tile, rot, k));
      const key = counts.join(''); if (!seen.has(key)) seen.set(key, { counts, rots: [] });
      seen.get(key).rots.push(rot);
    }
    return [...seen.values()];
  }
  // Every assignment of patterns whose edges agree, searched outward from the
  // first tile; stops after `limit`.
  function solve(board, limit = 2) {
    const N = board.tiles.length, pats = board.tiles.map(patterns), choice = Array(N).fill(-1), seq = [0], seen = new Set([0]);
    for (let x = 0; x < seq.length; x++) for (const e of board.tiles[seq[x]].nb) if (e && !seen.has(e[0])) { seen.add(e[0]); seq.push(e[0]); }
    board.tiles.forEach((_, i) => { if (!seen.has(i)) seq.push(i); });
    let count = 0, solution = null;
    const fits = i => {
      const t = board.tiles[i], c = pats[i][choice[i]].counts;
      for (let k = 0; k < t.n; k++) {
        const e = t.nb[k];
        if (!e) { if (c[k]) return false; continue; }
        if (choice[e[0]] >= 0 && pats[e[0]][choice[e[0]]].counts[e[1]] !== c[k]) return false;
      }
      return true;
    };
    const go = x => {
      if (count >= limit) return;
      if (x === N) { count++; if (!solution) solution = choice.map((p, j) => pats[j][p].rots); return; }
      const i = seq[x];
      for (let p = 0; p < pats[i].length; p++) { choice[i] = p; if (fits(i)) go(x + 1); }
      choice[i] = -1;
    };
    go(0);
    return { count, solution };
  }
  const need = (rot, targets, n) => Math.min(...targets.map(t => mod(t - rot, n)));
  function par(board) { const { solution } = solve(board, 1); return board.tiles.filter((t, i) => need(board.start[i], solution[i], t.n) > 0).length; }
  function taps(board) { const { solution } = solve(board, 1); return board.tiles.reduce((a, t, i) => a + need(board.start[i], solution[i], t.n), 0); }
  // The shortest turn, either way, from rot to any of the targets.
  function nearest(rot, targets, n) {
    let best = null;
    for (const t of targets) { const cw = mod(t - rot, n), steps = cw <= n / 2 ? cw : cw - n; if (best === null || Math.abs(steps) < Math.abs(best)) best = steps; }
    return best;
  }
  // One tile still off its answer, preferring unlocked tiles beside loose
  // ends and then the shortest turn; null when the board is solved.
  function hint(board, rots, locked = new Set()) {
    const { count, solution } = solve(board, 2); if (count < 1) return null;
    const near = new Set(loose(board, rots).map(e => e.tile));
    const todo = board.tiles.map((t, i) => ({ i, steps: nearest(rots[i], solution[i], t.n) })).filter(x => x.steps);
    if (!todo.length) return null;
    todo.sort((a, b) => (locked.has(a.i) ? 1 : 0) - (locked.has(b.i) ? 1 : 0) || (near.has(a.i) ? 0 : 1) - (near.has(b.i) ? 0 : 1) || Math.abs(a.steps) - Math.abs(b.steps) || a.i - b.i);
    return { tile: todo[0].i, steps: todo[0].steps };
  }
  // One pair's curve at a turn, in tiling units.
  function curve(tile, rot, pair) {
    const [[k0, i0], [k1, i1]] = pair.map(d => turnDot(d, rot, tile.n));
    const p0 = dotAt(tile.poly, k0, i0, countAt(tile, rot, k0)), p1 = dotAt(tile.poly, k1, i1, countAt(tile, rot, k1));
    return bezier(tile.poly, k0, p0, k1, p1);
  }
  // Loops that close on the board as it stands, each a list of [tile, pair]
  // in order of travel. A loop is closed when every edge it crosses has the
  // same count of dots on both sides; it need not wait for the whole board.
  function closedLoops(board, rots) {
    const used = new Set(), out = [];
    const partner = (i, d) => { const t = board.tiles[i]; for (let p = 0; p < t.pairs.length; p++) { const [a, b] = t.pairs[p].map(x => turnDot(x, rots[i], t.n)); if (a[0] === d[0] && a[1] === d[1]) return [p, b]; if (b[0] === d[0] && b[1] === d[1]) return [p, a]; } return null; };
    board.tiles.forEach((t, i0) => t.pairs.forEach((_, p0) => {
      if (used.has(i0 + ':' + p0)) return;
      const loop = [], mine = new Set(); let i = i0, d = turnDot(t.pairs[p0][0], rots[i0], t.n), ok = false;
      for (let guard = 0; guard < 10000; guard++) {
        const hit = partner(i, d); if (!hit) break;
        const [p, exit] = hit, key = i + ':' + p;
        if (mine.has(key)) { ok = i === i0 && p === p0; break; }
        mine.add(key); loop.push([i, p]);
        const tt = board.tiles[i], n = countAt(tt, rots[i], exit[0]), e = tt.nb[exit[0]];
        if (!e || countAt(board.tiles[e[0]], rots[e[0]], e[1]) !== n) break;
        i = e[0]; d = [e[1], n - 1 - exit[1]];
      }
      if (ok) { for (const k of mine) used.add(k); out.push(loop); }
    }));
    return out;
  }
  // A loop's cubics, each turned to run along the direction of travel.
  function loopBezier(board, rots, loop) {
    let end = null; const out = [];
    for (const [i, p] of loop) {
      let c = curve(board.tiles[i], rots[i], board.tiles[i].pairs[p]);
      if (end ? gap(end, c[3]) < gap(end, c[0]) : false) c = c.slice().reverse();
      out.push(c); end = c[3];
    }
    return out;
  }

  // Mandaza's seeded generator, from mandaza.app.
  function Mash(seed) {
    let n = 0xefc8249d;
    function mash(data) {
      data = String(data);
      for (let i = 0; i < data.length; i++) { n += data.charCodeAt(i); let h = 0.02519603282416938 * n; n = h >>> 0; h -= n; h *= n; n = h >>> 0; h -= n; n += h * 0x100000000; }
      return (n >>> 0) * 2.3283064365386963e-10;
    }
    mash(seed);
    const next = () => mash('A');
    next.intAlea = (min, max) => { if (max === undefined) { max = min; min = 0; } return Math.floor(min + (max - min) * next()); };
    return next;
  }
  // Mandaza's table of dot counts per edge (index = dots): one row per picture.
  const GEOMETRIES = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 1, 1, 0], [0, 1, 0, 1], [0, 0, 2, 1], [0, 1, 3, 1]];

  // The whole picture, generated as Mandaza generates one and as Loop's reveal
  // grows it round a solved board: one row of the dot table for every edge,
  // odd cells evened along shortest paths, dots paired with concentric loop
  // building and a regularity of 5 from the full cell nearest the centre.
  // row picks the table's row, as the seed would otherwise. A
  // rim tile meets the field only along one run of its outer edges, so the new
  // curves there never cross the puzzle's. rect is the page in tiling units.
  function picture(T, { rect, board = null, rots = null, centre = { x: 0, y: 0 }, seed = 'picture', row = null }) {
    const rndGen = Mash(seed + '/gen'), rndStruct = Mash(seed + '/struct'), drawn = rndGen.intAlea(GEOMETRIES.length);
    const geometry = row === null ? drawn : row, pool = [];
    GEOMETRIES[geometry].forEach((count, nb) => { for (let k = 0; k < count; k++) pool.push(nb); });
    const list = link(polygons(T, rect, 1.5)), boardAt = new Map(board ? board.tiles.map((t, i) => [t.poly.key, i]) : []);
    const dist = p => Math.hypot(p.c.x - centre.x, p.c.y - centre.y);
    const cells = list.map(p => ({ poly: p, tile: boardAt.get(p.key), d: dist(p) }));
    cells.forEach(cell => { cell.neighbors = cell.poly.nb.map(e => { if (!e) return null; const o = cells[e[0]]; return cell.tile === undefined || o.tile === undefined ? [o, e[1]] : null; }); });
    // A rim tile keeps its longest run of outer edges.
    for (const cell of cells) if (cell.tile !== undefined && cell.neighbors.some(Boolean)) {
      const n = cell.poly.n, out = cell.neighbors.map(Boolean); let best = null;
      for (let s = 0; s < n; s++) if (out[s] && !out[(s + n - 1) % n]) { let len = 0; while (len < n && out[(s + len) % n]) len++; if (!best || len > best.len) best = { s, len }; }
      if (!best) best = { s: 0, len: n };
      cell.run = best.s;
      for (let k = 0; k < n; k++) if (out[k] && mod(k - best.s, n) >= best.len) { const [o, ok] = cell.neighbors[k]; o.neighbors[ok] = null; cell.neighbors[k] = null; }
    }
    const live = cells.filter(c => c.neighbors.some(Boolean)).sort((a, b) => a.d - b.d);
    for (const cell of live) { cell.ndots = Array(cell.poly.n).fill(0); cell.set = Array(cell.poly.n).fill(false); cell.dots = []; }
    // Three dots sit 0.72 from a corner, too deep for a square or a triangle:
    // the arcs round two corners would meet. Their edges carry at most two.
    // Cairo's pentagons are tighter still: arcs round their 131 degree corner
    // reach the far curves, so their edges carry one dot.
    const most = (cell, k) => { const [o] = cell.neighbors[k]; return !cell.poly.regular || !o.poly.regular ? 1 : cell.poly.n > 5 && o.poly.n > 5 ? 3 : 2; };
    for (const cell of live) for (let k = 0; k < cell.poly.n; k++) {
      if (cell.set[k] || !cell.neighbors[k]) continue; const [o, ok] = cell.neighbors[k];
      cell.ndots[k] = o.ndots[ok] = Math.min(most(cell, k), pool[rndStruct.intAlea(pool.length)]); cell.set[k] = o.set[ok] = true;
    }
    const odd = cell => cell.ndots.reduce((a, b) => a + b, 0) & 1;
    const change = (cell, k) => { const n = cell.ndots[k], to = n === 1 ? (rndStruct() < 0.5 || most(cell, k) < 2 ? 0 : 2) : n === 3 ? 2 : n === 0 ? 1 : (rndStruct() < 0.5 || most(cell, k) < 3 ? 1 : 3); const [o, ok] = cell.neighbors[k]; cell.ndots[k] = o.ndots[ok] = to; };
    for (const start of live) {
      if (!odd(start)) continue;
      const from = new Map([[start, null]]), queue = [start];
      search: for (let x = 0; x < queue.length; x++) for (let k = 0; k < queue[x].poly.n; k++) {
        const e = queue[x].neighbors[k]; if (!e || from.has(e[0])) continue;
        from.set(e[0], [queue[x], k]);
        if (odd(e[0])) { for (let step = from.get(e[0]); step; step = from.get(step[0])) change(step[0], step[1]); break search; }
        queue.push(e[0]);
      }
    }
    for (const cell of live) for (let k = 0; k < cell.poly.n; k++) {
      const n = cell.ndots[k]; if (!n || cell.dots[k]) continue;
      const [o, ok] = cell.neighbors[k]; cell.dots[k] = []; o.dots[ok] = [];
      for (let i = 0; i < n; i++) {
        const a = { cell, kedge: k, index: i }, b = { cell: o, kedge: ok, index: n - 1 - i };
        a.other = b; b.other = a; cell.dots[k][i] = a; o.dots[ok][n - 1 - i] = b;
      }
    }
    for (const cell of live) {
      const n = cell.poly.n, from = cell.run || 0; cell.flat = [];
      for (let j = 0; j < n; j++) {
        const k = (from + j) % n, c = cell.ndots[k]; if (!c) continue;
        cell.dots[k].forEach((dot, i) => { Object.assign(dot, dotAt(cell.poly, k, i, c)); cell.flat.push(dot); });
      }
      cell.connectables = [cell.flat.slice()]; cell.actives = cell.flat.slice();
    }
    const regularity = 5;
    function pickNextDot(cell, dotin, direct) {
      for (let kcon = 0; kcon < cell.connectables.length; kcon++) {
        const group = cell.connectables[kcon]; let k0 = group.indexOf(dotin), k1;
        if (k0 === -1) continue;
        if (rndStruct.intAlea(regularity) !== 0) k1 = direct ? (k0 + 1) % group.length : (k0 + group.length - 1) % group.length;
        else k1 = rndStruct.intAlea(group.length / 2) * 2 + ((k0 & 1) ^ 1);
        const dotout = group[k1];
        if (k1 < k0) [k0, k1] = [k1, k0];
        const inner = group.splice(k0, k1 + 1 - k0); inner.shift(); inner.pop();
        if (inner.length) cell.connectables.push(inner);
        if (!group.length) cell.connectables.splice(kcon, 1);
        return dotout;
      }
    }
    function build(dot) {
      const loop = { pairs: [], start: dot, closed: false };
      const extend = direct => {
        const dot0 = !loop.pairs.length ? loop.start : direct ? loop.pairs[loop.pairs.length - 1][1].other : loop.pairs[0][0].other;
        if (!dot0) return false;
        const dot1 = pickNextDot(dot0.cell, dot0, direct); if (!dot1) return false;
        if (direct) loop.pairs.push([dot0, dot1]); else loop.pairs.unshift([dot1, dot0]);
        return true;
      };
      for (let guard = 0; guard < 100000; guard++) {
        if (!extend(true)) break;
        if (loop.pairs[0][0].other === loop.pairs[loop.pairs.length - 1][1]) { loop.closed = true; break; }
      }
      if (!loop.closed) while (extend(false));
      for (const [a, b] of loop.pairs) a.loop = b.loop = loop;
      return loop;
    }
    const nextcw = (dot, step) => { const a = dot.cell.actives, n = a[(a.indexOf(dot) + step + a.length) % a.length]; return n.loop ? null : n; };
    const loops = [], full = cell => cell.connectables[0] && cell.connectables[0].length && cell.neighbors.every((e, k) => e && cell.ndots[k]);
    const first = live.find(full) || live.find(cell => cell.connectables[0] && cell.connectables[0].length);
    if (first) {
      loops.push(build(first.connectables[0][Math.floor(first.connectables[0].length / 2)]));
      for (let k = 0; k < loops.length;) {
        let found = null;
        for (const [d0, d1] of loops[k].pairs) if ((found = nextcw(d0, 1) || nextcw(d1, -1) || nextcw(d0, -1) || nextcw(d1, 1))) break;
        if (found) loops.push(build(found)); else k++;
      }
      for (const cell of live) for (const dot of cell.actives) if (!dot.loop) loops.push(build(dot));
    }
    const field = loops.map(loop => {
      const bz = loop.pairs.map(([a, b]) => bezier(a.cell.poly, a.kedge, { x: a.x, y: a.y }, b.kedge, { x: b.x, y: b.y }));
      return { bezier: bz, closed: loop.closed && gap(bz[0][0], bz[bz.length - 1][3]) < 1e-6, board: false };
    });
    const own = board ? closedLoops(board, rots).map(loop => ({ bezier: loopBezier(board, rots, loop), closed: true, board: true })) : [];
    const centreOf = t => { let sx = 0, sy = 0, n = 0; for (const c of t.bezier) for (const p of [c[0], c[3]]) { sx += p.x; sy += p.y; n++; } return Math.hypot(sx / n - centre.x, sy / n - centre.y); };
    own.sort((a, b) => centreOf(a) - centreOf(b)); field.sort((a, b) => centreOf(a) - centreOf(b));
    return { loops: own.concat(field), board: own.length, geometry, cells: cells.filter(c => c.tile === undefined).length };
  }
  return { TILINGS, byId, shapes, polygons, link, density, unitOf, FRACTIONS, dotAt, inward, corner, bezier, reach, gap, boardPolys, prepare, countAt, turnDot, loose, solved, patterns, solve, need, nearest, hint, par, taps, curve, closedLoops, loopBezier, Mash, GEOMETRIES, picture, mod };
});
