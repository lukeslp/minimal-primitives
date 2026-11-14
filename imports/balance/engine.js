/* Balance rules, solver, deduction and seeded generator. No UI, no storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Balance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'balance-1';
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const NAME = ['empty', 'black', 'white'];
  const other = v => 3 - v;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function valid(p) {
    return !!p && Number.isInteger(p.n) && p.n >= 2 && p.n <= 12 && p.n % 2 === 0 &&
      Array.isArray(p.givens) && p.givens.length === p.n * p.n &&
      p.givens.every(v => v === 0 || v === 1 || v === 2);
  }
  function stateValid(p, s) {
    return valid(p) && Array.isArray(s) && s.length === p.givens.length &&
      s.every((v, i) => (v === 0 || v === 1 || v === 2) && (p.givens[i] === 0 || v === p.givens[i]));
  }
  function start(p) { return p.givens.slice(); }

  // Every row and column as a list of cell indexes.
  const lineCache = {};
  function lines(n) {
    if (lineCache[n]) return lineCache[n];
    const out = [];
    for (let r = 0; r < n; r++) out.push({ kind: 'row', index: r, cells: Array.from({ length: n }, (_, c) => r * n + c) });
    for (let c = 0; c < n; c++) out.push({ kind: 'column', index: c, cells: Array.from({ length: n }, (_, r) => r * n + c) });
    return (lineCache[n] = out);
  }
  function tally(line, s) {
    const count = [0, 0, 0];
    for (const i of line.cells) count[s[i]]++;
    return count;
  }

  // What the two rules say about the marks on the board. Never consults an answer.
  function inspect(p, s) {
    if (!stateValid(p, s)) return { valid: false, solved: false, full: false, runs: [], uneven: [], crowded: [] };
    const n = p.n, runs = [], uneven = [], crowded = [];
    for (const line of lines(n)) {
      const c = line.cells;
      for (let k = 0; k + 2 < n; k++) {
        if (s[c[k]] && s[c[k]] === s[c[k + 1]] && s[c[k]] === s[c[k + 2]]) runs.push({ kind: line.kind, cells: [c[k], c[k + 1], c[k + 2]] });
      }
      const count = tally(line, s);
      if (count[0] === 0 && count[1] !== count[2]) uneven.push({ kind: line.kind, index: line.index });
      else if (count[1] > n / 2 || count[2] > n / 2) crowded.push({ kind: line.kind, index: line.index, shade: count[1] > n / 2 ? BLACK : WHITE });
    }
    const full = !s.includes(0);
    return { valid: true, full, runs, uneven, crowded, solved: full && !runs.length && !uneven.length };
  }
  function broken(n, s) {
    for (const line of lines(n)) {
      const c = line.cells;
      let b = 0, w = 0;
      for (let k = 0; k < n; k++) {
        const v = s[c[k]];
        if (v === BLACK) b++; else if (v === WHITE) w++;
        if (v && k >= 2 && s[c[k - 1]] === v && s[c[k - 2]] === v) return true;
      }
      if (b > n / 2 || w > n / 2) return true;
    }
    return false;
  }

  // One cell forced directly by a rule: a pair, a gap, or a line with its full share of a shade.
  function simple(n, s) {
    const all = lines(n);
    for (const line of all) {
      const c = line.cells;
      for (let k = 0; k + 2 < n; k++) {
        const a = s[c[k]], b = s[c[k + 1]], d = s[c[k + 2]];
        if (a && a === b && !d) return { i: c[k + 2], value: other(a), rule: 'pair', kind: line.kind, support: [c[k], c[k + 1]] };
        if (b && b === d && !a) return { i: c[k], value: other(b), rule: 'pair', kind: line.kind, support: [c[k + 1], c[k + 2]] };
        if (a && a === d && !b) return { i: c[k + 1], value: other(a), rule: 'gap', kind: line.kind, support: [c[k], c[k + 2]] };
      }
    }
    for (const line of all) {
      const count = tally(line, s);
      if (!count[0]) continue;
      for (const v of [BLACK, WHITE]) {
        if (count[v] === n / 2) {
          return { i: line.cells.find(i => !s[i]), value: other(v), rule: 'share', kind: line.kind, index: line.index, support: line.cells.filter(i => s[i] === v) };
        }
      }
    }
    return null;
  }
  function settle(n, s) {
    for (;;) {
      if (broken(n, s)) return false;
      const m = simple(n, s);
      if (!m) return true;
      s[m.i] = m.value;
    }
  }

  // Count completions of a state, stopping at `limit`.
  function count(n, state, limit, keep) {
    const s = state.slice();
    if (!settle(n, s)) return 0;
    const i = s.indexOf(0);
    if (i < 0) { if (keep) keep.push(s); return 1; }
    let total = 0;
    for (const v of [BLACK, WHITE]) {
      s[i] = v;
      total += count(n, s, limit - total, keep);
      if (total >= limit) break;
    }
    return total;
  }
  function solve(p) {
    if (!valid(p)) return { count: 0, solution: null };
    const keep = [], total = count(p.n, p.givens, 2, keep);
    return { count: total, unique: total === 1, solution: total === 1 ? keep[0] : null };
  }

  const cap = t => t[0].toUpperCase() + t.slice(1);
  function sentence(m) {
    const need = NAME[m.value], seen = NAME[other(m.value)];
    if (m.rule === 'pair') return 'Two ' + seen + ' squares sit together, so the next one is ' + need + '.';
    if (m.rule === 'gap') return 'A ' + seen + ' square on each side, so the middle is ' + need + '.';
    if (m.rule === 'share') return 'This ' + m.kind + ' has all its ' + seen + ', so the rest are ' + need + '.';
    if (m.rule === 'trial') return cap(seen) + ' here soon breaks a rule, so it is ' + need + '.';
    return cap(seen) + ' here leaves no way to finish, so it is ' + need + '.';
  }

  // The next deduction from the marks on the board. `depth` limits how far it may look:
  // 1 direct rules, 2 trying a shade and following direct rules, 3 trying a shade with a full search.
  function next(p, s, depth) {
    if (!stateValid(p, s)) return null;
    depth = depth || 3;
    const n = p.n, v = inspect(p, s);
    if (v.runs.length) return { fault: 'run', support: v.runs[0].cells, text: 'These three match. Change one of them.' };
    if (v.uneven.length || v.crowded.length) {
      const f = v.uneven[0] || v.crowded[0], line = lines(n).find(l => l.kind === f.kind && l.index === f.index);
      const b = tally(line, s)[BLACK], w = tally(line, s)[WHITE], shade = b > w ? BLACK : WHITE;
      return { fault: 'share', support: line.cells.filter(i => s[i] === shade), text: 'This ' + f.kind + ' has too many ' + NAME[shade] + ' squares.' };
    }
    if (v.full) return null;
    const direct = simple(n, s);
    if (direct) { direct.text = sentence(direct); return direct; }
    if (depth < 2) return null;
    const fails = (i, shade, deep) => {
      const t = s.slice();
      t[i] = shade;
      return deep ? count(n, t, 1) === 0 : !settle(n, t);
    };
    for (const deep of depth >= 3 ? [false, true] : [false]) {
      let dead = null;
      for (let i = 0; i < s.length; i++) {
        if (s[i]) continue;
        const noBlack = fails(i, BLACK, deep), noWhite = fails(i, WHITE, deep);
        if (noBlack && noWhite) { dead = dead === null ? i : dead; continue; }
        if (noBlack || noWhite) {
          const m = { i, value: noBlack ? WHITE : BLACK, rule: deep ? 'search' : 'trial', support: [] };
          m.text = sentence(m);
          return m;
        }
      }
      if (dead !== null) return { fault: 'stuck', i: dead, support: [dead], text: 'Neither shade fits here. An earlier mark is wrong.' };
    }
    return null;
  }

  // Solve from the givens by Hint's deductions alone and report how hard that was.
  function grade(p, depth) {
    const s = start(p), used = { pair: 0, gap: 0, share: 0, trial: 0, search: 0 };
    for (;;) {
      const m = next(p, s, depth || 3);
      if (!m || m.fault) break;
      s[m.i] = m.value;
      used[m.rule]++;
    }
    const solved = inspect(p, s).solved;
    return { solved, used, level: !solved ? 4 : used.search ? 3 : used.trial ? 2 : 1, cells: s };
  }

  function shuffle(list, random) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  function fill(n, random) {
    const s = Array(n * n).fill(0);
    const place = i => {
      if (i === s.length) return true;
      for (const v of random() < 0.5 ? [BLACK, WHITE] : [WHITE, BLACK]) {
        s[i] = v;
        if (!broken(n, s) && count(n, s, 1) > 0 && place(i + 1)) return true;
      }
      s[i] = 0;
      return false;
    };
    place(0);
    return s;
  }

  // A seeded board with exactly one answer under the two rules.
  // Easy: direct rules only, and many givens. Normal: direct rules only, few givens.
  // Hard: may need a shade tried and followed.
  const DIFFICULTY = { Easy: { depth: 1, keep: 0.42 }, Normal: { depth: 1, keep: 0 }, Hard: { depth: 2, keep: 0 } };
  function generate(seed, n, difficulty) {
    const plan = DIFFICULTY[difficulty] || DIFFICULTY.Normal, random = rng(seed);
    const solution = fill(n, random), givens = solution.slice();
    const floor = Math.ceil(n * n * plan.keep);
    let left = givens.length;
    for (const i of shuffle(givens.map((_, k) => k), random)) {
      if (left <= floor) break;
      const was = givens[i];
      givens[i] = 0;
      const p = { n, givens };
      if (count(n, givens, 2) === 1 && grade(p, plan.depth).solved) left--;
      else givens[i] = was;
    }
    const p = { n, givens };
    return { n, givens, seed: seed >>> 0, difficulty: DIFFICULTY[difficulty] ? difficulty : 'Normal', version: VERSION, level: grade(p).level };
  }

  return { VERSION, EMPTY, BLACK, WHITE, NAME, rng, valid, stateValid, start, lines, inspect, solve, next, grade, generate };
});
