/* Loop · Mandaza tiles: rules, geometry, exact solver and hints. By Luke Steuber. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.LoopEngine = engine;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Flat-top hexagons in axial coordinates. Vertex k of a unit hexagon sits at
  // angle 60k degrees (y down, so angles run clockwise on screen); edge k runs
  // from vertex k to vertex k+1, and the tile across edge k is q+dq, r+dr.
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const S3 = Math.sqrt(3);
  const FRACTIONS = [[], [1 / 2], [3 / 8, 5 / 8]];
  const key = (q, r) => q + ',' + r;
  function cells(radius) {
    const out = [];
    for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) out.push([q, r]);
    return out;
  }
  const center = (q, r) => ({ x: 1.5 * q, y: S3 * (r + q / 2) });
  const vertex = k => ({ x: Math.cos(Math.PI / 3 * k), y: Math.sin(Math.PI / 3 * k) });
  const inward = k => ({ x: -Math.cos(Math.PI / 3 * k + Math.PI / 6), y: -Math.sin(Math.PI / 3 * k + Math.PI / 6) });
  // A tile is stored in its solved orientation: counts[k] dots on edge k and
  // pairs of dots [[k, i], [k2, i2]] joined inside it. Turning a tile by t
  // steps moves edge k to edge k + t (clockwise on screen).
  const countAt = (tile, rot, k) => tile.counts[((k - rot) % 6 + 6) % 6];
  const turnDot = ([k, i], rot) => [(k + rot) % 6, i];
  function index(board) {
    const map = new Map(); board.tiles.forEach((t, i) => map.set(key(t.q, t.r), i)); return map;
  }
  // Edges whose two sides disagree, or which carry dots off the board.
  function loose(board, rots) {
    const at = index(board), out = [];
    board.tiles.forEach((t, i) => {
      for (let k = 0; k < 6; k++) {
        const n = countAt(t, rots[i], k); if (!n && !(at.has(key(t.q + DIRS[k][0], t.r + DIRS[k][1])))) continue;
        const j = at.get(key(t.q + DIRS[k][0], t.r + DIRS[k][1]));
        const m = j === undefined ? 0 : countAt(board.tiles[j], rots[j], (k + 3) % 6);
        if (n !== m && n > 0) out.push({ tile: i, edge: k, dots: n, facing: m });
      }
    });
    return out;
  }
  const solved = (board, rots) => loose(board, rots).length === 0;
  // Distinct count patterns a tile can show, with the turns that show each.
  function patterns(tile) {
    const seen = new Map();
    for (let rot = 0; rot < 6; rot++) {
      const counts = [0, 1, 2, 3, 4, 5].map(k => countAt(tile, rot, k)).join('');
      if (!seen.has(counts)) seen.set(counts, []);
      seen.get(counts).push(rot);
    }
    return [...seen.entries()].map(([counts, rots]) => ({ counts: counts.split('').map(Number), rots }));
  }
  // Every assignment of patterns whose edges all agree; stops after `limit`.
  function solve(board, limit = 2) {
    const at = index(board), pats = board.tiles.map(patterns), choice = Array(board.tiles.length).fill(-1);
    let count = 0, solution = null;
    const fits = i => {
      const t = board.tiles[i], c = pats[i][choice[i]].counts;
      for (let k = 0; k < 6; k++) {
        const j = at.get(key(t.q + DIRS[k][0], t.r + DIRS[k][1]));
        if (j === undefined) { if (c[k]) return false; continue; }
        if (choice[j] >= 0 && pats[j][choice[j]].counts[(k + 3) % 6] !== c[k]) return false;
      }
      return true;
    };
    const go = i => {
      if (count >= limit) return;
      if (i === board.tiles.length) { count++; if (!solution) solution = choice.map((p, j) => pats[j][p].rots); return; }
      for (let p = 0; p < pats[i].length; p++) { choice[i] = p; if (fits(i)) go(i + 1); }
      choice[i] = -1;
    };
    go(0);
    return { count, solution };
  }
  // Turns a tile still needs (clockwise taps) to reach a pattern in the answer.
  const need = (rot, targets) => Math.min(...targets.map(t => ((t - rot) % 6 + 6) % 6));
  function hint(board, rots) {
    const { count, solution } = solve(board, 2);
    if (count !== 1) return null;
    const near = new Set(loose(board, rots).map(e => e.tile));
    const todo = board.tiles.map((t, i) => ({ i, taps: need(rots[i], solution[i]) })).filter(x => x.taps > 0);
    if (!todo.length) return null;
    todo.sort((a, b) => (near.has(a.i) ? 0 : 1) - (near.has(b.i) ? 0 : 1) || a.taps - b.taps);
    const h = todo[0];
    return { tile: h.i, taps: h.taps, to: (rots[h.i] + h.taps) % 6 };
  }
  // Fewest hits: one turning gesture per tile that needs turning.
  function par(board) {
    const { solution } = solve(board, 1);
    return board.tiles.filter((t, i) => need(board.start[i], solution[i]) > 0).length;
  }
  function taps(board) {
    const { solution } = solve(board, 1);
    return board.tiles.reduce((a, t, i) => a + need(board.start[i], solution[i]), 0);
  }
  // Geometry in units of the hexagon radius, for drawing.
  function dot(q, r, k, i, n) {
    const c = center(q, r), a = vertex(k), b = vertex((k + 1) % 6), f = FRACTIONS[n][i];
    return { x: c.x + a.x + (b.x - a.x) * f, y: c.y + a.y + (b.y - a.y) * f };
  }
  // Mandaza's curve inside one tile, from dot [k0, i0] to dot [k1, i1].
  function curve(tile, rot, pair) {
    const [[k0, i0], [k1, i1]] = pair.map(d => turnDot(d, rot));
    const n0 = countAt(tile, rot, k0), n1 = countAt(tile, rot, k1);
    const p0 = dot(tile.q, tile.r, k0, i0, n0), p1 = dot(tile.q, tile.r, k1, i1, n1);
    const diff = Math.abs(k1 - k0), m0 = inward(k0), m1 = inward(k1);
    let d0, d1;
    if (diff === 0) { d0 = d1 = 0.2; }
    else if (diff === 1 || diff === 5) {
      const common = (k1 - k0 === -1 || k1 - k0 === 5) ? k0 : k1, c = center(tile.q, tile.r), v = vertex(common);
      const corner = { x: c.x + v.x, y: c.y + v.y }, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      d0 = 0.75 * dist(corner, p1); d1 = 0.75 * dist(corner, p0);
    } else if (diff === 2 || diff === 4) { d0 = d1 = 0.6; }
    else { d0 = d1 = 0.5; }
    return [p0, { x: p0.x + m0.x * d0, y: p0.y + m0.y * d0 }, { x: p1.x + m1.x * d1, y: p1.y + m1.y * d1 }, p1];
  }
  // Closed loops of a solved board, each a list of [tile index, pair index],
  // for drawing the finish. A dot's partner across an edge is mirrored: dot i
  // of n meets dot n-1-i on the facing edge.
  function loops(board, rots) {
    if (!solved(board, rots)) return [];
    const at = index(board), used = new Set(), out = [];
    const partnerIn = (i, d) => { const t = board.tiles[i]; for (let p = 0; p < t.pairs.length; p++) { const [a, b] = t.pairs[p].map(x => turnDot(x, rots[i])); if (a[0] === d[0] && a[1] === d[1]) return [p, b]; if (b[0] === d[0] && b[1] === d[1]) return [p, a]; } return null; };
    board.tiles.forEach((t, i0) => t.pairs.forEach((_, p0) => {
      if (used.has(i0 + ':' + p0)) return;
      const loop = []; let i = i0, d = turnDot(t.pairs[p0][0], rots[i0]);
      for (let guard = 0; guard < 10000; guard++) {
        const hit = partnerIn(i, d); if (!hit) break;
        const [p, exit] = hit; if (used.has(i + ':' + p)) break;
        used.add(i + ':' + p); loop.push([i, p]);
        const tt = board.tiles[i], n = countAt(tt, rots[i], exit[0]), j = at.get(key(tt.q + DIRS[exit[0]][0], tt.r + DIRS[exit[0]][1]));
        if (j === undefined) break;
        i = j; d = [(exit[0] + 3) % 6, n - 1 - exit[1]];
      }
      out.push(loop);
    }));
    return out;
  }
  // The loops that close on a board in play, solved or not: each a list of
  // [tile, pair] whose every curve end meets the next curve's across an edge
  // with the same number of dots on both sides, back to where it began.
  function closedLoops(board, rots) {
    const at = index(board), seen = new Set(), out = [];
    const partnerIn = (i, d) => { const t = board.tiles[i]; for (let p = 0; p < t.pairs.length; p++) { const [a, b] = t.pairs[p].map(x => turnDot(x, rots[i])); if (a[0] === d[0] && a[1] === d[1]) return [p, b]; if (b[0] === d[0] && b[1] === d[1]) return [p, a]; } return null; };
    board.tiles.forEach((t, i0) => t.pairs.forEach((_, p0) => {
      if (seen.has(i0 + ':' + p0)) return;
      const start = turnDot(t.pairs[p0][0], rots[i0]), loop = []; let i = i0, d = start, closed = false;
      for (let guard = 0; guard < 10000; guard++) {
        const hit = partnerIn(i, d); if (!hit) break;
        const [p, exit] = hit;
        if (loop.length && i === i0 && p === p0) { closed = d[0] === start[0] && d[1] === start[1]; break; }
        if (seen.has(i + ':' + p)) break;
        seen.add(i + ':' + p); loop.push([i, p]);
        const tt = board.tiles[i], n = countAt(tt, rots[i], exit[0]), j = at.get(key(tt.q + DIRS[exit[0]][0], tt.r + DIRS[exit[0]][1]));
        if (j === undefined || countAt(board.tiles[j], rots[j], (exit[0] + 3) % 6) !== n) break;
        i = j; d = [(exit[0] + 3) % 6, n - 1 - exit[1]];
      }
      if (closed) out.push(loop);
    }));
    return out;
  }
  // Linked tiles and turning rings. A board may list `links`, groups of tile
  // indices that turn together, and `rings`, the radii of rings that turn
  // round the centre as a whole, with `offsets` giving each ring's turn at the
  // start. A ring turn of s steps is a rigid turn of s sixths: every tile of
  // the ring moves round with it and turns by s. Arrangements are compared by
  // ring turns and edge counts, as `solve` compares boards without them, and
  // nothing above this point changes for boards that use neither.
  const mod6 = n => (n % 6 + 6) % 6;
  const ring = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  function spin(q, r, s) { for (let k = 0; k < mod6(s); k++) [q, r] = [-r, q + r]; return [q, r]; }
  // The board with its turnable rings moved to the given turns.
  function arrange(board, offsets) {
    if (!board.rings || !offsets) return board;
    return Object.assign({}, board, { tiles: board.tiles.map(t => { const s = mod6(offsets[ring(t.q, t.r)] || 0); if (!s) return t; const [q, r] = spin(t.q, t.r, s); return Object.assign({}, t, { q, r }); }) });
  }
  const group = (board, i) => (board.links || []).find(g => g.includes(i)) || [i];
  function units(board) {
    const seen = new Set(), out = [];
    board.tiles.forEach((_, i) => { if (seen.has(i)) return; const g = group(board, i); g.forEach(j => seen.add(j)); out.push(g); });
    return out;
  }
  // One gesture on tile i turns its whole group.
  function turnUnit(board, rots, i, steps) { const next = rots.slice(); for (const j of group(board, i)) next[j] = mod6(next[j] + steps); return next; }
  // One ring gesture turns ring k by steps, carrying its tiles round.
  function turnRing(board, rots, offsets, k, steps) {
    const nextRots = rots.slice(), nextOffsets = (offsets || []).slice();
    nextOffsets[k] = mod6((nextOffsets[k] || 0) + steps);
    board.tiles.forEach((t, i) => { if (ring(t.q, t.r) === k) nextRots[i] = mod6(nextRots[i] + steps); });
    return { rots: nextRots, offsets: nextOffsets };
  }
  // Every solved arrangement reachable from (rots, offsets), up to `limit`:
  // every combination of ring turns, then each unit's turn, with no dots
  // facing off the board and every shared edge agreeing. A solution gives the
  // ring turns and, for every tile, the final turns that finish it.
  function solveAll(board, rots, offsets, limit = 2) {
    rots = rots || board.start; offsets = offsets || board.offsets || [];
    const rings = board.rings || [], us = units(board), unitOf = [];
    us.forEach((g, u) => g.forEach(j => { unitOf[j] = u; }));
    let combos = [[]];
    for (const k of rings) combos = combos.flatMap(o => [0, 1, 2, 3, 4, 5].map(s => { const n = o.slice(); n[k] = s; return n; }));
    let count = 0, solution = null;
    for (const target of combos) {
      if (count >= limit) break;
      const arranged = arrange(board, target), at = index(arranged);
      const base = rots.map((r, i) => { const k = ring(board.tiles[i].q, board.tiles[i].r); return rings.includes(k) ? mod6(r + (target[k] || 0) - (offsets[k] || 0)) : r; });
      const counts = (j, d) => [0, 1, 2, 3, 4, 5].map(k => countAt(arranged.tiles[j], base[j] + d, k));
      const options = us.map(g => { const seen = new Map(); for (let d = 0; d < 6; d++) { const sig = g.map(j => counts(j, d).join('')).join('|'); if (!seen.has(sig)) seen.set(sig, []); seen.get(sig).push(d); } return [...seen.values()].map(ds => ({ ds, c: g.map(j => counts(j, ds[0])) })); });
      const chosen = us.map(() => -1), now = [];
      const fits = u => {
        for (const [m, j] of us[u].entries()) {
          const t = arranged.tiles[j], c = options[u][chosen[u]].c[m];
          for (let k = 0; k < 6; k++) {
            const n = at.get(key(t.q + DIRS[k][0], t.r + DIRS[k][1]));
            if (n === undefined) { if (c[k]) return false; continue; }
            const v = unitOf[n]; if (chosen[v] < 0) continue;
            const cn = options[v][chosen[v]].c[us[v].indexOf(n)];
            if (cn[(k + 3) % 6] !== c[k]) return false;
          }
        }
        return true;
      };
      const go = u => {
        if (count >= limit) return;
        if (u === us.length) {
          count++;
          if (!solution) {
            const finals = []; us.forEach((g, v) => g.forEach(j => { finals[j] = options[v][chosen[v]].ds.map(d => mod6(base[j] + d)); }));
            solution = { offsets: rings.map(k => [k, target[k]]).reduce((o, [k, s]) => { o[k] = s; return o; }, []), finals, units: us.map((g, v) => ({ tiles: g, turns: options[v][chosen[v]].ds })) };
          }
          return;
        }
        for (let o = 0; o < options[u].length; o++) { chosen[u] = o; if (fits(u)) go(u + 1); }
        chosen[u] = -1;
      };
      go(0);
    }
    return { count, solution };
  }
  const steps6 = s => Math.min(mod6(s), 6 - mod6(s));
  // Fewest gestures: the ring steps the answer needs, either way round, and
  // one gesture for each unit not yet at a finishing turn. Gestures commute,
  // so this is exact: ring gestures alone change the ring turns, unit
  // gestures alone change a unit's turn relative to its ring.
  function parAll(board, rots, offsets) {
    rots = rots || board.start; offsets = offsets || board.offsets || [];
    const { solution } = solveAll(board, rots, offsets, 1);
    if (!solution) return null;
    let n = 0; for (const k of board.rings || []) n += steps6((solution.offsets[k] || 0) - (offsets[k] || 0));
    for (const u of solution.units) if (!u.turns.includes(0)) n++;
    return n;
  }
  // The next gesture towards the one answer: a ring step while a ring is off,
  // then a unit turn, nearest a loose end first.
  function hintAll(board, rots, offsets) {
    offsets = offsets || board.offsets || [];
    const { count, solution } = solveAll(board, rots, offsets, 2);
    if (count !== 1) return null;
    for (const k of board.rings || []) {
      const s = mod6((solution.offsets[k] || 0) - (offsets[k] || 0)); if (!s) continue;
      const tile = board.tiles.findIndex(t => ring(t.q, t.r) === k);
      return { ring: k, steps: s <= 3 ? 1 : -1, tile };
    }
    const near = new Set(loose(arrange(board, offsets), rots).map(e => e.tile));
    const todo = solution.units.filter(u => !u.turns.includes(0)).map(u => ({ tile: u.tiles[0], tiles: u.tiles, taps: Math.min(...u.turns) }));
    if (!todo.length) return null;
    todo.sort((a, b) => (a.tiles.some(j => near.has(j)) ? 0 : 1) - (b.tiles.some(j => near.has(j)) ? 0 : 1) || a.taps - b.taps);
    const h = todo[0];
    return { tile: h.tile, tiles: h.tiles, taps: h.taps, to: mod6(rots[h.tile] + h.taps) };
  }
  return { DIRS, cells, center, vertex, countAt, turnDot, patterns, loose, solved, solve, hint, par, taps, dot, curve, loops, closedLoops, ring, spin, arrange, group, units, turnUnit, turnRing, solveAll, parAll, hintAll };
});
