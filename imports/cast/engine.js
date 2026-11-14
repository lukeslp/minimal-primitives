/* Cast · rules, exact solver and hints. By Luke Steuber. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.CastEngine = engine;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Cubes stand in columns on an n by n plinth; h[r][c] is a column's height.
  // Three lamps cast three shadows: the left wall shows each row's tallest
  // column, the right wall each column's tallest, the floor which squares hold
  // any cube. The tray holds exactly the cubes the answer uses.
  const zeros = n => Array.from({ length: n }, () => Array(n).fill(0));
  function views(h) {
    const n = h.length;
    return {
      left: h.map(row => Math.max(...row)),
      right: Array.from({ length: n }, (_, c) => Math.max(...h.map(row => row[c]))),
      plan: h.map(row => row.map(v => v > 0 ? 1 : 0)),
    };
  }
  const used = h => h.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
  const start = board => zeros(board.n);
  // Set one column's height; refused past the lamp-lit height or the tray.
  function set(board, h, r, c, height) {
    if (r < 0 || c < 0 || r >= board.n || c >= board.n) return null;
    if (height < 0 || height > board.maxH || height === h[r][c]) return null;
    if (used(h) - h[r][c] + height > board.cubes) return null;
    const next = h.map(row => row.slice());
    next[r][c] = height;
    return next;
  }
  function compare(board, h) {
    const v = views(h);
    return {
      left: board.left.map((t, r) => t === v.left[r]),
      right: board.right.map((t, c) => t === v.right[c]),
      plan: board.plan.map((row, r) => row.map((t, c) => t === v.plan[r][c])),
      tray: board.cubes - used(h),
    };
  }
  function solved(board, h) {
    const m = compare(board, h);
    return m.tray === 0 && m.left.every(Boolean) && m.right.every(Boolean) && m.plan.every(row => row.every(Boolean));
  }
  // Every stack matching the shadows and the tray; stops after `limit`.
  // Options drop a constraint, for measuring what each one contributes.
  function solve(board, limit = 2, options = {}) {
    const n = board.n, h = zeros(n), usePlan = options.plan !== false, useTray = options.tray !== false;
    let count = 0, solution = null, nodes = 0;
    const budget = options.budget || Infinity;
    const cap = [];
    for (let k = n * n; k >= 0; k--) {
      if (k === n * n) { cap[k] = 0; continue; }
      const r = Math.floor(k / n), c = k % n, hi = Math.min(board.left[r], board.right[c]);
      cap[k] = cap[k + 1] + (usePlan && !board.plan[r][c] ? 0 : hi);
    }
    const go = (k, sum) => {
      if (count >= limit || ++nodes > budget) return;
      if (useTray && (sum > board.cubes || sum + cap[k] < board.cubes)) return;
      if (k === n * n) { if (!useTray || sum === board.cubes) { count++; if (!solution) solution = h.map(row => row.slice()); } return; }
      const r = Math.floor(k / n), c = k % n, hi = Math.min(board.left[r], board.right[c]);
      let lo = 0, top = hi;
      if (usePlan) { if (board.plan[r][c]) lo = 1; else top = 0; }
      for (let v = lo; v <= top; v++) {
        h[r][c] = v;
        if (c === n - 1 && Math.max(...h[r]) !== board.left[r]) continue;
        if (r === n - 1 && Math.max(...h.map(row => row[c])) !== board.right[c]) continue;
        go(k + 1, sum + v);
      }
      h[r][c] = 0;
    };
    go(0, 0);
    return { count, solution, exhausted: nodes > budget };
  }
  // One column to change: ones the shadows pin to a single height first.
  function hint(board, h) {
    const { count, solution } = solve(board, 2);
    if (count !== 1) return null;
    const diffs = [];
    for (let r = 0; r < board.n; r++) for (let c = 0; c < board.n; c++) if (h[r][c] !== solution[r][c]) diffs.push([r, c]);
    if (!diffs.length) return null;
    const single = ([r, c]) => !board.plan[r][c] || Math.min(board.left[r], board.right[c]) === 1;
    diffs.sort((a, b) => (single(a) ? 0 : 1) - (single(b) ? 0 : 1));
    const [r, c] = diffs[0];
    return { r, c, to: solution[r][c] };
  }
  // Fewest hits: one placement per cube, whether tapped or carried from the tray.
  const par = board => board.cubes;
  return { views, used, start, set, compare, solved, solve, hint, par };
});
