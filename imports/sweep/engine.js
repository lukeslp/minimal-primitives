/* Glance rules. By Luke Steuber.
   A board is a small grid of two-faced tiles, some places left empty. Choosing
   a tile turns it over together with its present orthogonal neighbours. The
   board is finished when every tile shows its dark face. A board row is a
   string: '1' a light tile, '0' a dark tile, '.' an empty place.
   Presses commute and a second press undoes the first, so an answer is a set
   of tiles. All answers from a state are one answer plus any combination of
   the presses that change nothing; the solver finds them by elimination over
   GF(2) and returns the smallest. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlanceEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const bits = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const cache = new WeakMap();
  // The board's present tiles in reading order and each one's turn mask.
  function layout(board) {
    let L = cache.get(board);
    if (L) return L;
    const rows = board.cells.length, cols = board.cells[0].length, index = [], cells = [];
    for (let r = 0; r < rows; r++) { index.push([]); for (let c = 0; c < cols; c++) { const here = board.cells[r][c] !== '.'; index[r].push(here ? cells.length : -1); if (here) cells.push([r, c]); } }
    const at = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols ? index[r][c] : -1;
    const masks = cells.map(([r, c]) => [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].reduce((m, [dr, dc]) => { const j = at(r + dr, c + dc); return j < 0 ? m : m | (1 << j); }, 0));
    L = { rows, cols, index, cells, masks, at, n: cells.length };
    cache.set(board, L); return L;
  }
  const start = board => board.cells.map(row => [...row].map(ch => ch === '.' ? null : +ch));
  const copy = grid => grid.map(row => row.slice());
  function toMask(board, grid) { const L = layout(board); let m = 0; L.cells.forEach(([r, c], i) => { if (grid[r][c]) m |= 1 << i; }); return m; }
  function fromMask(board, m) { const L = layout(board), g = start(board).map(row => row.map(v => v === null ? null : 0)); L.cells.forEach(([r, c], i) => { if (m >> i & 1) g[r][c] = 1; }); return g; }
  // Turn the tile at (r, c) and its neighbours; an empty place refuses.
  function flip(board, grid, r, c) {
    const L = layout(board), i = L.at(r, c);
    if (i < 0) return null;
    return fromMask(board, toMask(board, grid) ^ L.masks[i]);
  }
  const solved = (board, grid) => grid.every(row => row.every(v => v !== 1));
  const pressMask = (board, presses) => presses.reduce((m, [r, c]) => m ^ layout(board).masks[layout(board).at(r, c)], 0);
  // Every answer from this state, as press masks, with the smallest first and
  // ties in reading order (the lower mask by its first differing tile).
  function solve(board, grid) {
    const L = layout(board), target = toMask(board, grid), rows = L.masks.map((m, j) => ({ m, b: target >> j & 1 })), pivots = [];
    let row = 0;
    for (let col = 0; col < L.n && row < rows.length; col++) {
      const p = rows.findIndex((x, k) => k >= row && (x.m >> col & 1));
      if (p < 0) continue;
      [rows[row], rows[p]] = [rows[p], rows[row]];
      for (let k = 0; k < rows.length; k++) if (k !== row && (rows[k].m >> col & 1)) { rows[k].m ^= rows[row].m; rows[k].b ^= rows[row].b; }
      pivots.push(col); row++;
    }
    if (rows.slice(row).some(x => x.b)) return { count: 0, answers: [], min: Infinity, nullity: L.n - pivots.length };
    let base = 0; pivots.forEach((col, k) => { if (rows[k].b) base |= 1 << col; });
    const free = [], isPivot = new Set(pivots);
    for (let col = 0; col < L.n; col++) if (!isPivot.has(col)) {
      let v = 1 << col; pivots.forEach((pc, k) => { if (rows[k].m >> col & 1) v |= 1 << pc; }); free.push(v);
    }
    const answers = [];
    for (let s = 0; s < 1 << free.length; s++) { let x = base; free.forEach((v, k) => { if (s >> k & 1) x ^= v; }); answers.push(x); }
    const order = (a, b) => bits(a) - bits(b) || (() => { const d = a ^ b, low = d & -d; return a & low ? -1 : 1; })();
    answers.sort(order);
    return { count: answers.length, answers, min: bits(answers[0]), nullity: free.length };
  }
  const cellsOf = (board, mask) => layout(board).cells.filter((_, i) => mask >> i & 1).map(p => p.slice());
  // The smallest answer from the start: its size is the board's par.
  function par(board) { return solve(board, start(board)).min; }
  // One tile of the smallest answer from here, the first in reading order.
  function hint(board, grid) {
    if (solved(board, grid)) return null;
    const s = solve(board, grid);
    if (!s.count) return null;
    const [r, c] = cellsOf(board, s.answers[0])[0];
    return { r, c };
  }
  // How many smallest answers there are from here (one, on every board's start).
  function minimalCount(board, grid) { const s = solve(board, grid); return s.answers.filter(a => bits(a) === s.min).length; }
  return { layout, start, copy, flip, solved, solve, par, hint, minimalCount, toMask, fromMask, pressMask, cellsOf, bits };
});
