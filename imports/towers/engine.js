/* Towers: pure rules, solver, hint deductions and seeded generator. Luke Steuber. */
(function (root) {
  'use strict';
  const VERSION = 'towers-1';
  const SIDES = ['top', 'bottom', 'left', 'right'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rng) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // Cells of one line in the order they are seen from a side.
  function lineCells(n, side, k) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (side === 'left') out.push(k * n + i);
      else if (side === 'right') out.push(k * n + n - 1 - i);
      else if (side === 'top') out.push(i * n + k);
      else out.push((n - 1 - i) * n + k);
    }
    return out;
  }
  // How many towers show along a line: a taller one hides the shorter ones behind it.
  function visible(heights) {
    let top = 0, count = 0;
    for (const h of heights) if (h > top) { top = h; count++; }
    return count;
  }
  function emptyClues(n) {
    return { top: Array(n).fill(0), bottom: Array(n).fill(0), left: Array(n).fill(0), right: Array(n).fill(0) };
  }
  function cluesOf(n, cells) {
    const clues = emptyClues(n);
    for (const side of SIDES) for (let k = 0; k < n; k++) clues[side][k] = visible(lineCells(n, side, k).map(i => cells[i]));
    return clues;
  }
  // The 2n rows and columns, each with the number at either end (0 when there is none).
  function allLines(p) {
    const out = [];
    for (let k = 0; k < p.n; k++) out.push({ kind: 'row', k, cells: lineCells(p.n, 'left', k), a: { side: 'left', k, clue: p.clues.left[k] }, b: { side: 'right', k, clue: p.clues.right[k] } });
    for (let k = 0; k < p.n; k++) out.push({ kind: 'column', k, cells: lineCells(p.n, 'top', k), a: { side: 'top', k, clue: p.clues.top[k] }, b: { side: 'bottom', k, clue: p.clues.bottom[k] } });
    return out;
  }
  function startCells(p) { return p.given.slice(); }
  function stateValid(p, cells) {
    return Array.isArray(cells) && cells.length === p.n * p.n &&
      cells.every((v, i) => Number.isInteger(v) && v >= 0 && v <= p.n && (!p.given[i] || v === p.given[i]));
  }

  // What the rules say about the marks on the board. Nothing here knows the answer.
  function inspect(p, cells) {
    const n = p.n, repeats = new Set();
    for (const line of allLines(p)) {
      const seen = new Map();
      for (const i of line.cells) if (cells[i]) { if (!seen.has(cells[i])) seen.set(cells[i], []); seen.get(cells[i]).push(i); }
      for (const group of seen.values()) if (group.length > 1) for (const i of group) repeats.add(i);
    }
    const clues = {}, bad = [];
    for (const side of SIDES) {
      clues[side] = [];
      for (let k = 0; k < n; k++) {
        const want = p.clues[side][k];
        if (!want) { clues[side].push('none'); continue; }
        const heights = lineCells(n, side, k).map(i => cells[i]);
        if (heights.includes(0)) clues[side].push('open');
        else if (visible(heights) === want) clues[side].push('met');
        else { clues[side].push('broken'); bad.push({ side, k }); }
      }
    }
    const full = cells.every(v => v > 0);
    return { full, repeats: [...repeats].sort((a, b) => a - b), clues, bad, solved: full && !repeats.size && !bad.length && stateValid(p, cells) };
  }

  const permCache = {};
  function perms(n) {
    if (permCache[n]) return permCache[n];
    const out = [], cur = [], used = Array(n + 1).fill(false);
    (function go() {
      if (cur.length === n) { out.push(cur.slice()); return; }
      for (let v = 1; v <= n; v++) if (!used[v]) { used[v] = true; cur.push(v); go(); cur.pop(); used[v] = false; }
    })();
    return (permCache[n] = out);
  }
  function fits(perm, a, b) {
    return (!a || visible(perm) === a) && (!b || visible(perm.slice().reverse()) === b);
  }

  // Count the finished boards that agree with the fixed cells, stopping at `limit`.
  function solve(p, cells, limit) {
    const n = p.n, fixed = cells || p.given, max = limit || 2, all = perms(n);
    const rows = [];
    for (let r = 0; r < n; r++) rows.push(all.filter(perm => fits(perm, p.clues.left[r], p.clues.right[r]) && perm.every((v, c) => !fixed[r * n + c] || fixed[r * n + c] === v)));
    const grid = [], colUsed = Array(n).fill(0), solutions = [];
    let count = 0;
    function columnsHold(r) {
      for (let c = 0; c < n; c++) {
        const want = p.clues.top[c];
        if (!want) continue;
        const seen = visible(grid.slice(0, r + 1).map(row => row[c]));
        if (seen > want || (r === n - 1 && seen !== want)) return false;
      }
      if (r === n - 1) for (let c = 0; c < n; c++) {
        const want = p.clues.bottom[c];
        if (want && visible(grid.map(row => row[c]).reverse()) !== want) return false;
      }
      return true;
    }
    (function go(r) {
      if (count >= max) return;
      if (r === n) { count++; solutions.push([].concat(...grid)); return; }
      for (const perm of rows[r]) {
        let ok = true;
        for (let c = 0; c < n; c++) if (colUsed[c] & (1 << perm[c])) { ok = false; break; }
        if (!ok) continue;
        grid.push(perm);
        if (columnsHold(r)) {
          for (let c = 0; c < n; c++) colUsed[c] |= 1 << perm[c];
          go(r + 1);
          for (let c = 0; c < n; c++) colUsed[c] &= ~(1 << perm[c]);
        }
        grid.pop();
        if (count >= max) return;
      }
    })(0);
    return { count, solutions };
  }

  // Candidates as bit masks (bit h-1 for height h).
  const single = m => m && !(m & (m - 1));
  const heightOf = m => 32 - Math.clz32(m);
  function baseCands(p, cells) {
    const n = p.n, fullMask = (1 << n) - 1, cand = Array(n * n).fill(fullMask);
    for (let i = 0; i < n * n; i++) {
      if (cells[i]) { cand[i] = 1 << (cells[i] - 1); continue; }
      const r = Math.floor(i / n), c = i % n;
      for (let j = 0; j < n; j++) {
        if (cells[r * n + j]) cand[i] &= ~(1 << (cells[r * n + j] - 1));
        if (cells[j * n + c]) cand[i] &= ~(1 << (cells[j * n + c] - 1));
      }
    }
    return cand;
  }
  // Every way to fill one line that agrees with the candidates and its two numbers:
  // the union of heights seen at each place, or null when no arrangement is left.
  function lineUnion(p, line, cand) {
    const union = Array(p.n).fill(0);
    let any = false;
    for (const perm of perms(p.n)) {
      if (!perm.every((v, j) => cand[line.cells[j]] & (1 << (v - 1)))) continue;
      if (!fits(perm, line.a.clue, line.b.clue)) continue;
      any = true;
      perm.forEach((v, j) => { union[j] |= 1 << (v - 1); });
    }
    return any ? union : null;
  }
  // Repeat the line count over every row and column until nothing changes.
  function settle(p, cand) {
    const lines = allLines(p);
    for (let changed = true; changed;) {
      changed = false;
      for (const line of lines) {
        const union = lineUnion(p, line, cand);
        if (!union) return false;
        line.cells.forEach((i, j) => { if (cand[i] !== union[j]) { cand[i] = union[j]; changed = true; } });
      }
    }
    return true;
  }

  const LEVELS = { fix: 0, staircase: 1, front: 1, lastHeight: 2, lastPlace: 3, lineCount: 4, crossCount: 5, trial: 6, search: 7 };
  const cluesOn = line => [line.a, line.b].filter(e => e.clue).map(e => ({ side: e.side, k: e.k }));
  function rowAndColumn(p, i) {
    const lines = allLines(p), r = Math.floor(i / p.n), c = i % p.n;
    return [lines[r], lines[p.n + c]];
  }

  // One deduction a person could follow from the marks on the board, or null on a finished board.
  // { i, value, kind, level, text, cells: [the line that forces it], clues: [{side,k}] }
  function next(p, cells) {
    const n = p.n, lines = allLines(p);
    if (cells.every(v => v > 0) && inspect(p, cells).solved) return null;

    // Marks that cannot all stand come first: point at one and offer to clear it.
    if (solve(p, cells, 1).count === 0) {
      const state = inspect(p, cells);
      const answer = solve(p, p.given, 1).solutions[0];
      if (!answer) return null;
      const wrong = cells.map((v, j) => j).filter(j => cells[j] && !p.given[j] && cells[j] !== answer[j]);
      if (!wrong.length) return null;
      const repeated = wrong.find(j => state.repeats.includes(j));
      const i = repeated !== undefined ? repeated : wrong[0];
      const why = repeated !== undefined ? 'This height repeats in its row or column.' : 'I tried every finished board with a ' + cells[i] + ' here and none fits the numbers.';
      const [row, column] = rowAndColumn(p, i);
      return { i, value: 0, kind: 'fix', level: LEVELS.fix, text: why, cells: [...new Set([...row.cells, ...column.cells])], clues: [] };
    }

    // A number equal to the size: the heights climb 1 to N away from it.
    for (const side of SIDES) for (let k = 0; k < n; k++) {
      if (p.clues[side][k] !== n || n < 2) continue;
      const line = lineCells(n, side, k), j = line.findIndex(i => !cells[i]);
      if (j >= 0) return { i: line[j], value: j + 1, kind: 'staircase', level: LEVELS.staircase, cells: line, clues: [{ side, k }], text: 'All ' + n + ' towers are seen from this number, so the heights climb 1 to ' + n + ' away from it.' };
    }
    // A 1: the tallest tower stands in front.
    for (const side of SIDES) for (let k = 0; k < n; k++) {
      if (p.clues[side][k] !== 1 || n < 2) continue;
      const line = lineCells(n, side, k);
      if (!cells[line[0]]) return { i: line[0], value: n, kind: 'front', level: LEVELS.front, cells: line, clues: [{ side, k }], text: 'One tower is seen from this number, so the tallest, ' + n + ', stands in front.' };
    }
    const cand = baseCands(p, cells);
    // A cell with one height left.
    for (let i = 0; i < n * n; i++) if (!cells[i] && single(cand[i])) {
      const [row, column] = rowAndColumn(p, i);
      return { i, value: heightOf(cand[i]), kind: 'lastHeight', level: LEVELS.lastHeight, cells: [...new Set([...row.cells, ...column.cells])], clues: [], text: 'Every other height is already in this row or column.' };
    }
    // A height with one place left in a line.
    for (const line of lines) for (let h = 1; h <= n; h++) {
      if (line.cells.some(i => cells[i] === h)) continue;
      const places = line.cells.filter(i => !cells[i] && (cand[i] & (1 << (h - 1))));
      if (places.length === 1) return { i: places[0], value: h, kind: 'lastPlace', level: LEVELS.lastPlace, cells: line.cells, clues: [], text: h + ' has one place left in this ' + line.kind + '.' };
    }
    // Counting one line against its numbers.
    for (const line of lines) {
      if (!line.a.clue && !line.b.clue) continue;
      const union = lineUnion(p, line, cand);
      if (!union) continue;
      for (let j = 0; j < n; j++) {
        const i = line.cells[j];
        if (!cells[i] && single(union[j])) return { i, value: heightOf(union[j]), kind: 'lineCount', level: LEVELS.lineCount, cells: line.cells, clues: cluesOn(line), text: 'Count what is seen along this ' + line.kind + ': only ' + heightOf(union[j]) + ' fits here.' };
      }
    }
    // The same count, carried across rows and columns until it settles.
    const settled = cand.slice();
    if (settle(p, settled)) for (let i = 0; i < n * n; i++) if (!cells[i] && single(settled[i])) {
      const [row, column] = rowAndColumn(p, i);
      return { i, value: heightOf(settled[i]), kind: 'crossCount', level: LEVELS.crossCount, cells: [...new Set([...row.cells, ...column.cells])], clues: [...cluesOn(row), ...cluesOn(column)], text: 'Counting this row and column against their numbers leaves only ' + heightOf(settled[i]) + ' here.' };
    }
    // Fallback by contradiction: try each height and keep the one that does not break a rule.
    for (let i = 0; i < n * n; i++) {
      if (cells[i]) continue;
      const alive = [];
      for (let h = 1; h <= n; h++) {
        if (!(settled[i] & (1 << (h - 1)))) continue;
        const trial = settled.slice(); trial[i] = 1 << (h - 1);
        if (settle(p, trial)) alive.push(h);
      }
      if (alive.length === 1) {
        const [row, column] = rowAndColumn(p, i);
        return { i, value: alive[0], kind: 'trial', level: LEVELS.trial, contradiction: true, cells: [...new Set([...row.cells, ...column.cells])], clues: [...cluesOn(row), ...cluesOn(column)], text: 'By trial: every height but ' + alive[0] + ' here soon breaks a rule.' };
      }
    }
    const answer = solve(p, cells, 1).solutions[0], i = cells.findIndex(v => !v);
    const [row, column] = rowAndColumn(p, i);
    return { i, value: answer[i], kind: 'search', level: LEVELS.search, contradiction: true, cells: [...new Set([...row.cells, ...column.cells])], clues: [], text: 'By trial and error: only ' + answer[i] + ' here leads to a finished board.' };
  }

  // Solve from the givens with Hint deductions only; report the hardest step used.
  function grade(p) {
    const cells = startCells(p), kinds = {};
    let level = 0, steps = 0;
    for (;;) {
      const move = next(p, cells);
      if (!move) break;
      cells[move.i] = move.value; steps++;
      level = Math.max(level, move.level); kinds[move.kind] = (kinds[move.kind] || 0) + 1;
      if (steps > p.n * p.n * 2) return { solved: false, level, steps, kinds, cells };
    }
    return { solved: inspect(p, cells).solved, level, steps, kinds, cells };
  }

  function randomLatin(n, rng) {
    const grid = Array(n * n).fill(0);
    (function fill(i) {
      if (i === n * n) return true;
      const r = Math.floor(i / n), c = i % n;
      for (const v of shuffle(Array.from({ length: n }, (_, k) => k + 1), rng)) {
        let ok = true;
        for (let j = 0; j < c && ok; j++) if (grid[r * n + j] === v) ok = false;
        for (let j = 0; j < r && ok; j++) if (grid[j * n + c] === v) ok = false;
        if (!ok) continue;
        grid[i] = v;
        if (fill(i + 1)) return true;
      }
      grid[i] = 0;
      return false;
    })(0);
    return grid;
  }
  const countClues = p => SIDES.reduce((sum, side) => sum + p.clues[side].filter(Boolean).length, 0);
  const countGivens = p => p.given.filter(Boolean).length;

  // A random Latin square, all its view numbers, then numbers taken away (and as few
  // givens added as needed) while the solver still proves one solution.
  // options: n, givens (cells shown from the start), clues (stop removing at this many),
  // maxLevel (hardest Hint step the board may need).
  function generate(seed, options) {
    const o = Object.assign({ n: 4, givens: 0, clues: 0, maxLevel: LEVELS.crossCount }, options || {});
    const n = o.n, rng = mulberry32(seed >>> 0), answer = randomLatin(n, rng);
    const p = { n, clues: cluesOf(n, answer), given: Array(n * n).fill(0) };
    for (const i of shuffle(Array.from({ length: n * n }, (_, k) => k), rng).slice(0, o.givens)) p.given[i] = answer[i];
    // All the numbers together can still leave two boards: give one cell where they differ.
    for (;;) {
      const found = solve(p, p.given, 2);
      if (found.count === 1) break;
      const other = found.solutions.find(s => s.some((v, i) => v !== answer[i]));
      const differ = answer.map((v, i) => i).filter(i => other[i] !== answer[i]);
      const i = differ[Math.floor(rng() * differ.length)];
      p.given[i] = answer[i];
    }
    const slots = [];
    for (const side of SIDES) for (let k = 0; k < n; k++) slots.push([side, k]);
    let left = slots.length;
    for (const [side, k] of shuffle(slots, rng)) {
      if (left <= o.clues) break;
      const kept = p.clues[side][k];
      p.clues[side][k] = 0;
      if (solve(p, p.given, 2).count === 1 && grade(p).level <= o.maxLevel) left--;
      else p.clues[side][k] = kept;
    }
    const g = grade(p);
    return { n, clues: p.clues, given: p.given, seed: seed >>> 0, level: g.level, version: VERSION };
  }

  // Free play once all thirty are solved: a 5 x 5 like the campaign's last boards (no fixed towers,
  // ten numbers, a line count or a count carried across needed). Seeds are walked from `seed` until a
  // board meets that slot, as build-levels.cjs walks them. generate() has proved one answer already;
  // the solver is asked again here, and Hint must finish it.
  const FREE = { n: 5, givens: 0, clues: 10, maxLevel: LEVELS.crossCount, minLevel: LEVELS.lineCount };
  function freePlay(seed) {
    for (let k = 0; k < 400; k++) {
      const p = generate((seed + k) >>> 0, FREE);
      if (countClues(p) > FREE.clues || countGivens(p) > FREE.givens || p.level < FREE.minLevel || p.level > FREE.maxLevel) continue;
      if (solve(p, p.given, 2).count !== 1 || !grade(p).solved) continue;
      return p;
    }
    return null;
  }

  const api = { VERSION, SIDES, LEVELS, FREE, mulberry32, lineCells, visible, cluesOf, emptyClues, allLines, startCells, stateValid, inspect, solve, next, grade, generate, freePlay, countClues, countGivens };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Towers = api;
})(typeof self !== 'undefined' ? self : this);
