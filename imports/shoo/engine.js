/* Shoo rules. By Luke Steuber.
   A board is a patch of hexagonal cells in rows, each odd row set half a
   cell to the right. A row is a string: '.' no cell, 'o' an open cell, 'B' a
   bee on an open cell, 'H' a hive, 'F' a flower. `walls` lists pairs of
   neighbouring cells [r1, c1, r2, c2] with a wall along their shared edge.
   A shoo is a look at one cell. Every bee in the six cells around it hops one
   cell straight away from it, unless the cell beyond is missing, a flower,
   across a wall or already holds a bee; a bee that lands in a hive goes in and
   stays. The bee under the look holds still and bees farther off do not move.
   The board is done when every bee is home. A state is the set of cells that
   hold a free bee, kept as a bit mask (a board has at most 31 cells). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShooEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Axial directions for pointy-topped hexagons, in turn: east, north-east,
  // north-west, west, south-west, south-east. Direction d + 3 is opposite d.
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const bits = m => { let n = 0; m >>>= 0; while (m) { m &= m - 1; n++; } return n; };
  const has = (m, i) => (m >>> i & 1) === 1;
  const bit = i => (1 << i) >>> 0;
  const toAxial = (r, c) => [c - (r - (r & 1)) / 2, r];
  const fromAxial = (q, r) => [r, q + (r - (r & 1)) / 2];
  const cache = new WeakMap();
  // The board's cells in reading order, each one's six neighbours (-1 where
  // there is none), the walls as a mask of blocked directions per cell, and
  // masks of hives, flowers and the bees at the start.
  function layout(board) {
    let L = cache.get(board);
    if (L) return L;
    const rows = board.cells.length, cols = Math.max(...board.cells.map(s => s.length)), index = [], cells = [];
    let hive = 0, flower = 0, start = 0;
    for (let r = 0; r < rows; r++) {
      index.push([]);
      for (let c = 0; c < cols; c++) {
        const ch = board.cells[r][c] || '.';
        if (ch === '.') { index[r].push(-1); continue; }
        if (!'oBHF'.includes(ch)) throw Error('Unknown cell ' + ch);
        const i = cells.length, [q] = toAxial(r, c);
        index[r].push(i); cells.push({ r, c, q, kind: ch === 'H' ? 'hive' : ch === 'F' ? 'flower' : 'open' });
        if (ch === 'H') hive |= bit(i); if (ch === 'F') flower |= bit(i); if (ch === 'B') start |= bit(i);
      }
    }
    if (cells.length > 31) throw Error('Too many cells');
    const at = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols ? index[r][c] : -1;
    const nb = cells.map(({ r, q }) => DIRS.map(([dq, dr]) => { const [rr, cc] = fromAxial(q + dq, r + dr); return at(rr, cc); }));
    const wall = cells.map(() => 0);
    for (const [r1, c1, r2, c2] of board.walls || []) {
      const a = at(r1, c1), b = at(r2, c2), d = a < 0 ? -1 : nb[a].indexOf(b);
      if (a < 0 || b < 0 || d < 0) throw Error('A wall must stand between two neighbouring cells');
      wall[a] |= 1 << d; wall[b] |= 1 << ((d + 3) % 6);
    }
    // For each look, the hops it can make: from each neighbour n to the cell t
    // beyond, flat in one typed array for the searches: n, t, and 0 for a
    // hop, 1 into a hive, 2 never possible (no cell, a wall or a flower).
    const hops = cells.map((_, i) => {
      const out = [];
      for (let d = 0; d < 6; d++) {
        const n = nb[i][d]; if (n < 0) continue;
        const t = nb[n][d], never = t < 0 || (wall[n] >> d & 1) || (flower >>> t & 1);
        out.push(n, never ? n : t, never ? 2 : (hive >>> t & 1) ? 1 : 0);
      }
      return Int8Array.from(out);
    });
    L = { rows, cols, index, cells, nb, wall, at, hops, n: cells.length, hive: hive >>> 0, flower: flower >>> 0, start: start >>> 0 };
    cache.set(board, L); return L;
  }
  const start = board => layout(board).start;
  const solved = mask => mask >>> 0 === 0;
  // A look at cell i: the next state, and which bees hopped, went home, or
  // were in reach but could not go.
  function shoo(board, mask, i) {
    const L = layout(board), moved = [], home = [], blocked = [];
    let next = mask >>> 0;
    if (!(i >= 0 && i < L.n)) return { mask: next, moved, home, blocked };
    for (let d = 0; d < 6; d++) {
      const n = L.nb[i][d];
      if (n < 0 || !has(mask, n)) continue;
      const t = L.nb[n][d];
      if (t < 0 || (L.wall[n] >> d & 1) || has(L.flower, t) || has(mask, t)) { blocked.push([n, d]); continue; }
      next = (next & ~bit(n)) >>> 0;
      if (has(L.hive, t)) home.push([n, t, d]);
      else { next = (next | bit(t)) >>> 0; moved.push([n, t, d]); }
    }
    return { mask: next, moved, home, blocked };
  }
  // The same look reduced to its next state, without the account of each bee.
  function step(board, mask, i) {
    const h = layout(board).hops[i];
    let next = mask >>> 0;
    for (let k = 0; k < h.length; k += 3) {
      const n = h[k];
      if (!(mask >>> n & 1) || h[k + 2] === 2) continue;
      const t = h[k + 1];
      if (h[k + 2] === 1) next &= ~(1 << n);
      else if (!(mask >>> t & 1)) next = (next & ~(1 << n)) | (1 << t);
    }
    return next >>> 0;
  }
  // The fewest looks that bring one bee home from each cell on a board with no
  // other bee: other bees only ever block, so no bee can do better than this.
  // Infinity marks a cell from which a bee can never get home.
  function lone(board) {
    const L = layout(board);
    if (L.lone) return L.lone;
    const dist = L.cells.map(() => Infinity), queue = [];
    for (let i = 0; i < L.n; i++) if (has(L.hive, i)) { dist[i] = 0; queue.push(i); }
    // Backwards: a bee at n reaches t = nb[n][d] when the look cell nb[n][d + 3] exists.
    for (let k = 0; k < queue.length; k++) {
      const t = queue[k];
      for (let d = 0; d < 6; d++) {
        const n = L.nb[t][(d + 3) % 6];
        if (n < 0 || has(L.flower, n) || has(L.hive, n) || dist[n] !== Infinity) continue;
        if (L.nb[n][d] !== t || (L.wall[n] >> d & 1) || L.nb[n][(d + 3) % 6] < 0) continue;
        dist[n] = dist[t] + 1; queue.push(n);
      }
    }
    return (L.lone = dist);
  }
  // A lower bound on the looks still needed: the farthest bee's own distance,
  // and every look moving at most six bees one cell.
  function bound(board, mask) {
    const d = lone(board);
    let most = 0, sum = 0;
    for (let i = 0, m = mask >>> 0; m; i++, m >>>= 1) if (m & 1) { const x = d[i]; if (x === Infinity) return Infinity; if (x > most) most = x; sum += x; }
    return Math.max(most, Math.ceil(sum / 6));
  }
  // Breadth-first search by layers from a state. Records, for each state, the
  // looks that lead one layer further. Stops at the layer where every bee is
  // home (or at `limit` layers, or `cap` states).
  function layers(board, mask, { limit = 40, cap = 2e6, full = false } = {}) {
    const L = layout(board), depth = new Map([[mask >>> 0, 0]]), succ = new Map(), levels = [[mask >>> 0]];
    let goal = solved(mask) ? 0 : -1, states = 1;
    for (let k = 0; k < limit && levels[k].length && (goal < 0 || full); k++) {
      const next = [];
      for (const u of levels[k]) {
        if (u === 0) continue;
        const out = [];
        for (let i = 0; i < L.n; i++) {
          const v = step(board, u, i);
          if (v === u) continue;
          let dv = depth.get(v);
          if (dv === undefined) { dv = k + 1; depth.set(v, dv); next.push(v); states++; if (v === 0 && goal < 0) goal = k + 1; }
          if (dv === k + 1) out.push([i, v]);
        }
        succ.set(u, out);
        if (states > cap) return { depth, succ, levels, goal, states, capped: true };
      }
      levels.push(next);
    }
    return { depth, succ, levels, goal, states, capped: false };
  }
  // Every shortest way home from a state, as the multiset of looked-at cells
  // (sorted), how many look sequences there are, and the par.
  function solve(board, mask, { limit = 40, cap = 2e6, most = 64 } = {}) {
    const s = layers(board, mask, { limit, cap });
    if (s.goal < 0) return { par: Infinity, answers: [], sequences: 0, states: s.states, capped: s.capped };
    // From the goal layer back: which states reach home in the remaining
    // layers, how many sequences, and their multisets.
    const ways = new Map([[0, { n: 1, sets: [[]], over: false }]]);
    for (let k = s.goal - 1; k >= 0; k--) for (const u of s.levels[k]) {
      if (u === 0) continue;
      let n = 0, keys = new Map(), over = false;
      for (const [i, v] of s.succ.get(u) || []) {
        const w = ways.get(v); if (!w) continue;
        n += w.n; over = over || w.over;
        for (const set of w.sets) { const m = [...set, i].sort((a, b) => a - b), key = m.join(','); if (!keys.has(key)) keys.set(key, m); }
      }
      if (!n) continue;
      if (keys.size > most) { over = true; keys = new Map([...keys].slice(0, most)); }
      ways.set(u, { n, sets: [...keys.values()], over });
    }
    const w = ways.get(mask >>> 0);
    const answers = w.sets.slice().sort((a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; });
    return { par: s.goal, answers, sequences: w.n, over: w.over, states: s.states, capped: s.capped };
  }
  // The par of a board from its start.
  const par = board => solve(board, start(board)).par;
  // One look of a shortest way home from here, by A* with the bound above
  // (it never drops by more than one a look, so the first time home is taken
  // off the queue the way there is a shortest one). Ties go to the state with
  // the smaller bound, then the one found first, so the answer is fixed.
  // `search` returns a stepper: each `run(work)` expands up to `work` states
  // and gives back null while unfinished, then { look, moves, path } once
  // home is found, or { look: -1, stuck: true } when no bee can get home.
  function search(board, mask) {
    const L = layout(board), start = mask >>> 0;
    if (solved(start)) return { run: () => ({ look: -1, done: true, moves: 0, path: [] }) };
    const h0 = bound(board, start);
    if (h0 === Infinity) return { run: () => ({ look: -1, stuck: true }) };
    // A binary heap of [f, h, order, state, g].
    const heap = [], best = new Map([[start, 0]]), from = new Map();
    let order = 0, result = null;
    const less = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    function push(x) { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (less(heap[i], heap[p]) >= 0) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } }
    function pop() { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m]) < 0) m = l; if (r < heap.length && less(heap[r], heap[m]) < 0) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; }
    push([h0, h0, order++, start, 0]);
    return {
      run(work = Infinity) {
        while (!result && work-- > 0) {
          if (!heap.length) { result = { look: -1, stuck: true }; break; }
          const [, , , u, g] = pop();
          if (g !== best.get(u)) continue;
          if (u === 0) {
            const path = []; for (let v = 0; v !== start;) { const [p, i] = from.get(v); path.push(i); v = p; }
            path.reverse(); result = { look: path[0], moves: path.length, path }; break;
          }
          for (let i = 0; i < L.n; i++) {
            const v = step(board, u, i);
            if (v === u) continue;
            const known = best.get(v);
            if (known !== undefined && known <= g + 1) continue;
            const h = bound(board, v);
            if (h === Infinity) continue;
            best.set(v, g + 1); from.set(v, [u, i]); push([g + 1 + h, h, order++, v, g + 1]);
          }
        }
        return result;
      },
      get expanded() { return best.size; }
    };
  }
  const hint = (board, mask) => { const r = search(board, mask).run(); return r && r.done ? null : r; };
  const cellOf = (board, i) => { const c = layout(board).cells[i]; return c ? { r: c.r, c: c.c } : null; };
  const indexOf = (board, r, c) => layout(board).at(r, c);
  return { DIRS, bits, has, toAxial, fromAxial, layout, start, solved, shoo, step, lone, bound, layers, solve, par, search, hint, cellOf, indexOf };
});
