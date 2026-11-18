/* Weave · rules, exact solver and hints. By Luke Steuber. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.WeaveEngine = engine;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // A crossing is 1 when the weft (the row thread) lies on top and -1 when the
  // warp (the column thread) does. A run of three equal crossings along a row or
  // a column is a float of three: loose on the front or on the back.
  const key = (r, c) => r + ',' + c;
  function pins(board) {
    const m = new Map();
    for (const [r, c, v] of board.pins) m.set(key(r, c), v);
    return m;
  }
  function start(board) {
    const p = pins(board);
    return Array.from({ length: board.rows }, (_, r) => Array.from({ length: board.cols }, (_, c) => p.has(key(r, c)) ? p.get(key(r, c)) : 1));
  }
  function flip(board, grid, r, c) {
    if (pins(board).has(key(r, c)) || r < 0 || c < 0 || r >= board.rows || c >= board.cols) return null;
    const next = grid.map(row => row.slice());
    next[r][c] = -next[r][c];
    return next;
  }
  function runsOf(values) {
    const out = [];
    for (let i = 0; i < values.length;) {
      let j = i;
      while (j + 1 < values.length && values[j + 1] === values[i]) j++;
      if (j - i + 1 >= 3) out.push({ from: i, to: j, value: values[i] });
      i = j + 1;
    }
    return out;
  }
  function loose(board, grid) {
    const out = [];
    for (let r = 0; r < board.rows; r++) for (const run of runsOf(grid[r])) out.push({ axis: 'row', index: r, ...run });
    for (let c = 0; c < board.cols; c++) for (const run of runsOf(grid.map(row => row[c]))) out.push({ axis: 'col', index: c, ...run });
    return out;
  }
  function solved(board, grid) {
    for (const [k, v] of pins(board)) { const [r, c] = k.split(',').map(Number); if (grid[r][c] !== v) return false; }
    return loose(board, grid).length === 0;
  }
  // Exact search in reading order; stops after `limit` answers.
  function solve(board, limit = 2) {
    const p = pins(board), g = Array.from({ length: board.rows }, () => Array(board.cols).fill(0));
    let count = 0, solution = null, nodes = 0;
    const ok = (r, c) => {
      const v = g[r][c];
      if (c >= 2 && g[r][c - 1] === v && g[r][c - 2] === v) return false;
      if (r >= 2 && g[r - 1][c] === v && g[r - 2][c] === v) return false;
      return true;
    };
    const go = k => {
      if (count >= limit) return;
      if (k === board.rows * board.cols) { count++; if (!solution) solution = g.map(row => row.slice()); return; }
      const r = Math.floor(k / board.cols), c = k % board.cols;
      for (const v of p.has(key(r, c)) ? [p.get(key(r, c))] : [1, -1]) {
        nodes++; g[r][c] = v;
        if (ok(r, c)) go(k + 1);
      }
      g[r][c] = 0;
    };
    go(0);
    return { count, solution, nodes };
  }
  // Crossings forced from the pins by two plain rules, repeated to a fixed
  // point: beside two equal neighbours the next one is opposite; between two
  // equal crossings one apart the middle is opposite.
  function propagate(board) {
    const known = new Map(pins(board));
    const get = (r, c) => known.get(key(r, c));
    let changed = true;
    const set = (r, c, v) => { if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) return; if (!known.has(key(r, c))) { known.set(key(r, c), v); changed = true; } };
    while (changed) {
      changed = false;
      for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) {
        const v = get(r, c); if (v === undefined) continue;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const a = get(r + dr, c + dc), b = get(r + 2 * dr, c + 2 * dc);
          if (a === v) { set(r - dr, c - dc, -v); set(r + 2 * dr, c + 2 * dc, -v); }
          if (b === v && a === undefined) set(r + dr, c + dc, -v);
        }
      }
    }
    return known;
  }
  // Ordered proof from fixed knots only. Choose the first difference from the
  // player's cloth: all earlier premises then already match what is visible.
  // Player notes never become assumptions of a hint.
  function explanation(board, grid) {
    const known = pins(board);
    for (let pass = 0; pass < board.rows * board.cols; pass++) {
      let changed = false;
      for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) for (const [dr, dc, axis] of [[0, 1, 'row'], [1, 0, 'column']]) {
        if (r + 2 * dr >= board.rows || c + 2 * dc >= board.cols) continue;
        const cells = [0, 1, 2].map(k => [r + k * dr, c + k * dc]);
        for (let i = 0; i < 3; i++) {
          const [rr, cc] = cells[i]; if (known.has(key(rr, cc))) continue;
          const pair = cells.filter((_, j) => j !== i), [a, b] = pair.map(([ar, ac]) => known.get(key(ar, ac)));
          if (a === undefined || a !== b) continue;
          const to = -a;
          if (grid[rr][cc] !== to) return { r: rr, c: cc, to, pair, axis, between: i === 1 };
          known.set(key(rr, cc), to); changed = true;
        }
      }
      if (!changed) break;
    }
    return null;
  }
  // One crossing to change, with the visible pair that forces it when possible.
  function hint(board, grid) {
    const reason = explanation(board, grid);
    if (reason) return reason;
    const { count, solution } = solve(board, 2);
    if (count !== 1) return null;
    const p = pins(board), forced = propagate(board), inRun = new Set();
    for (const run of loose(board, grid)) for (let i = run.from; i <= run.to; i++) inRun.add(run.axis === 'row' ? key(run.index, i) : key(i, run.index));
    const diffs = [];
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++)
      if (!p.has(key(r, c)) && grid[r][c] !== solution[r][c]) diffs.push([r, c]);
    if (!diffs.length) return null;
    const rank = ([r, c]) => (forced.has(key(r, c)) ? 0 : 2) + (inRun.has(key(r, c)) ? 0 : 1);
    diffs.sort((a, b) => rank(a) - rank(b));
    const [r, c] = diffs[0];
    return { r, c, to: solution[r][c] };
  }
  // Taps from the unwoven start (every free crossing weft-over) to the answer.
  function par(board) {
    const { solution } = solve(board, 1), p = pins(board);
    let n = 0;
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) if (!p.has(key(r, c)) && solution[r][c] === -1) n++;
    return n;
  }
  return { start, flip, loose, solved, solve, propagate, explanation, hint, par };
});
