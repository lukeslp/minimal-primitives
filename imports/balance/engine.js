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
  function count(n, state, limit, keep, work) {
    spend(work);
    const s = state.slice();
    if (!settle(n, s)) return 0;
    const i = s.indexOf(0);
    if (i < 0) { if (keep) keep.push(s); return 1; }
    let total = 0;
    for (const v of [BLACK, WHITE]) {
      s[i] = v;
      total += count(n, s, limit - total, keep, work);
      if (total >= limit) break;
    }
    return total;
  }
  function solve(p) {
    if (!valid(p)) return { count: 0, solution: null };
    const keep = [], total = count(p.n, p.givens, 2, keep);
    return { count: total, unique: total === 1, solution: total === 1 ? keep[0] : null };
  }

  // Every line a state breaks: three alike in a row, or more than half of one shade.
  function breaches(n, s) {
    const out = [];
    for (const line of lines(n)) {
      const c = line.cells;
      for (let k = 2; k < n; k++) {
        const v = s[c[k]];
        if (v && s[c[k - 1]] === v && s[c[k - 2]] === v) out.push({ kind: line.kind, index: line.index, why: 'run', shade: v, cells: [c[k - 2], c[k - 1], c[k]] });
      }
      const count = tally(line, s);
      for (const v of [BLACK, WHITE]) if (count[v] > n / 2) out.push({ kind: line.kind, index: line.index, why: 'share', shade: v, cells: c.filter(i => s[i] === v) });
    }
    return out;
  }
  // Every square the direct rules fill on this state, each once, with the fewest squares that force it.
  function direct(n, s) {
    const out = new Map(), add = (i, m) => { if (!out.has(i) || m.support.length < out.get(i).support.length) out.set(i, m); };
    for (const line of lines(n)) {
      const c = line.cells;
      for (let k = 0; k + 2 < n; k++) {
        const a = s[c[k]], b = s[c[k + 1]], d = s[c[k + 2]];
        if (a && a === b && !d) add(c[k + 2], { value: other(a), support: [c[k], c[k + 1]] });
        if (b && b === d && !a) add(c[k], { value: other(b), support: [c[k + 1], c[k + 2]] });
        if (a && a === d && !b) add(c[k + 1], { value: other(a), support: [c[k], c[k + 2]] });
      }
      const count = tally(line, s);
      for (const v of [BLACK, WHITE]) if (count[v] === n / 2 && count[0]) for (const i of c) if (!s[i]) add(i, { value: other(v), support: c.filter(j => s[j] === v) });
    }
    return out;
  }
  // Why `shade` at square i fails by direct rules alone. Put it there and fill, round by round, every
  // square the direct rules force, until a line breaks; the first round that breaks one is the shortest
  // way there. Of the lines that break, keep the one reached by the fewest squares. `chain` holds the
  // empty squares its steps fill, `marks` the squares already on the board they rest on, `line` the line.
  function trace(n, state, i, shade) {
    const s = state.slice(), from = new Map([[i, []]]);
    s[i] = shade;
    for (let round = 0; round <= s.length; round++) {
      const found = breaches(n, s);
      if (found.length) {
        let best = null;
        for (const f of found) {
          const chain = [], marks = [], seen = new Set(), todo = f.cells.slice();
          while (todo.length) {
            const k = todo.pop();
            if (seen.has(k)) continue;
            seen.add(k);
            if (k === i) continue;
            if (from.has(k)) { chain.push(k); todo.push(...from.get(k)); } else marks.push(k);
          }
          if (!best || chain.length + marks.length < best.chain.length + best.marks.length) best = { line: f, chain, marks };
        }
        best.chain.sort((a, b) => a - b);
        best.marks.sort((a, b) => a - b);
        return best;
      }
      const step = direct(n, s);
      if (!step.size) return null;
      for (const [k, m] of step) { s[k] = m.value; from.set(k, m.support); }
    }
    return null;
  }

  const cap = t => t[0].toUpperCase() + t.slice(1);
  // Hint's words come twice. `text` is shown under the board: "this square" is the one Hint outlines and
  // "the dashed squares" are the ones it dashes, so the words point at what is drawn. `spoken` is what the
  // status line reads aloud: the same sentence with the squares named by row and column.
  const spot = (n, i) => 'the square at row ' + (Math.floor(i / n) + 1) + ', column ' + (i % n + 1);
  const lineName = (kind, index) => kind + ' ' + (index + 1);
  const lineAt = (n, kind, i) => lineName(kind, kind === 'row' ? Math.floor(i / n) : i % n);
  // What breaks a line, as a player would put it: "three black in a row", "too many white squares".
  // A count with its noun: "1 black square", "2 white squares".
  const many = (k, noun) => k + ' ' + noun + (k === 1 ? '' : 's');
  const fault = (why, shade) => why === 'run' ? 'three ' + NAME[shade] + ' in a row' : 'too many ' + NAME[shade] + ' squares';
  // Both from one template: `put(shown, aloud)` gives the shown words in `text` and the named ones in `spoken`.
  function both(build) {
    return { text: build(shown => shown), spoken: build((shown, aloud) => aloud) };
  }
  function sentence(m, n) {
    const need = NAME[m.value], seen = NAME[other(m.value)], here = spot(n, m.i);
    // Rule 1, two alike beside it or on each side of it: "If this square were black, row 3 would have
    // three black in a row, so it is white."
    if (m.rule === 'pair' || m.rule === 'gap') {
      const line = lineAt(n, m.kind, m.i);
      return both(put => 'If ' + put('this square', here) + ' were ' + seen + ', ' + line + ' would have three ' + seen + ' in a row, so it is ' + need + '.');
    }
    // Rule 2, the line already holds half of one shade.
    if (m.rule === 'share') {
      return both(put => cap(lineName(m.kind, m.index)) + ' already has ' + many(n / 2, seen + ' square') + ', half of its ' + n + ', so ' + put('this square', here) + ' is ' + need + '.');
    }
    // A tried shade: the dashed squares are the squares it would force and the marks they rest on, and
    // the line they break is marked past its end.
    if (m.rule === 'trial' && m.breaks) {
      const f = m.breaks, line = lineName(f.kind, f.index), k = m.support.length;
      const result = f.why === 'run' ? 'make ' + fault('run', f.shade) + ' in ' + line : 'give ' + line + ' ' + fault('share', f.shade);
      if (!k) return both(put => 'If ' + put('this square', here) + ' were ' + seen + ', ' + line + ' would have ' + fault(f.why, f.shade) + ', so it is ' + need + '.');
      return both(put => 'If ' + put('this square', here) + ' were ' + seen + ', ' + put(k === 1 ? 'the dashed square' : 'the dashed squares', 'the ' + many(k, 'dashed square')) + ' would ' + result + ', so it is ' + need + '.');
    }
    return both(put => 'If ' + put('this square', here) + ' were ' + seen + ', the board could not be finished, so it is ' + need + '.');
  }
  function explain(m, n) { return Object.assign(m, sentence(m, n)); }

  // The next deduction from the marks on the board. `depth` limits how far it may look:
  // 1 direct rules, 2 trying a shade and following direct rules, 3 trying a shade with a full search.
  // `first` takes the first square a tried shade settles, in board order, rather than the one with the
  // shortest reason; grading uses it, so a board's measured difficulty does not move with Hint's choice.
  function next(p, s, depth, first, work) {
    if (!stateValid(p, s)) return null;
    depth = depth || 3;
    const n = p.n, v = inspect(p, s);
    if (v.runs.length) {
      const run = v.runs[0], said = cap(lineAt(n, run.kind, run.cells[0])) + ' has ' + fault('run', s[run.cells[0]]) + '.';
      return { fault: 'run', support: run.cells, said, text: said + ' Change one of them.', spoken: said + ' Change one of them.' };
    }
    if (v.uneven.length || v.crowded.length) {
      const f = v.uneven[0] || v.crowded[0], line = lines(n).find(l => l.kind === f.kind && l.index === f.index);
      const b = tally(line, s)[BLACK], w = tally(line, s)[WHITE], shade = b > w ? BLACK : WHITE;
      const said = cap(lineName(f.kind, f.index)) + ' has ' + fault('share', shade) + '.';
      return { fault: 'share', support: line.cells.filter(i => s[i] === shade), said, text: said, spoken: said };
    }
    if (v.full) return null;
    const direct = simple(n, s);
    if (direct) return explain(direct, n);
    if (depth < 2) return null;
    const fails = (i, shade, deep) => {
      const t = s.slice();
      t[i] = shade;
      return deep ? count(n, t, 1, null, work) === 0 : !settle(n, t);
    };
    for (const deep of depth >= 3 ? [false, true] : [false]) {
      // A tried shade that fails by direct rules: of all the squares where one does, take the one whose
      // reason is shortest, so the squares Hint marks stay few enough to follow.
      let dead = null, best = null;
      for (let i = 0; i < s.length; i++) {
        if (s[i]) continue;
        const noBlack = fails(i, BLACK, deep), noWhite = fails(i, WHITE, deep);
        if (noBlack && noWhite) { dead = dead === null ? i : dead; continue; }
        if (noBlack || noWhite) {
          const m = { i, value: noBlack ? WHITE : BLACK, rule: deep ? 'search' : 'trial', support: [] };
          if (deep) return explain(m, n);
          const t = trace(n, s, i, other(m.value));
          if (t) Object.assign(m, { support: [...t.chain, ...t.marks], chain: t.chain, marks: t.marks, breaks: t.line, lines: [{ kind: t.line.kind, index: t.line.index }] });
          if (!best || (t && (!best.breaks || m.support.length < best.support.length))) best = m;
          if (first) break;
        }
      }
      if (best) return explain(best, n);
      if (dead !== null) {
        const say = put => 'Neither shade fits ' + put('the dashed square', spot(n, dead)) + ', so an earlier mark is wrong.';
        return { fault: 'stuck', i: dead, support: [dead], ...both(say) };
      }
    }
    return null;
  }

  // A mark to change, for Hint on a board that holds a mistake. The rules can say that three squares
  // match, but not which of them is wrong, so this one asks the board's answer (every board has exactly
  // one). It takes a placed mark that differs from the answer: one the fault names first, then the most
  // recent of `recent` (cell indexes, newest first), then the first on the board, with the shade it needs.
  const answers = new WeakMap();
  function answer(p) {
    if (!answers.has(p)) answers.set(p, valid(p) ? solve(p).solution : null);
    return answers.get(p);
  }
  function fix(p, s, m, recent) {
    const sol = stateValid(p, s) && answer(p);
    if (!sol) return null;
    const wrong = s.map((v, i) => i).filter(i => !p.givens[i] && s[i] && s[i] !== sol[i]);
    if (!wrong.length) return null;
    const n = p.n, stuck = m && m.fault === 'stuck';
    const named = new Set(!m || !m.fault ? [] : stuck ? lines(n).filter(l => l.cells.includes(m.i)).flatMap(l => l.cells) : m.support);
    const order = (recent || []).filter(i => wrong.includes(i));
    const rank = i => (named.has(i) ? 0 : 2) + (order.includes(i) ? 0 : 1);
    const i = wrong.slice().sort((a, b) => rank(a) - rank(b) || (order.indexOf(a) - order.indexOf(b)) || a - b)[0];
    const value = sol[i];
    // The words: what is wrong, if a rule says so, then the shade this square (the one Hint outlines) needs.
    const need = NAME[value], here = spot(n, i);
    const say = stuck ? put => 'Neither shade fits ' + put('the dashed square', spot(n, m.i)) + ', so a mark is wrong: ' + put('this square', here) + ' should be ' + need + '.'
      : m && m.fault ? put => m.said + ' ' + put('This square', cap(here)) + ' should be ' + need + '.'
      : put => 'The board cannot be finished with ' + put('this square', here) + ' ' + NAME[s[i]] + ', so it should be ' + need + '.';
    return { i, value, rule: 'fix', support: stuck ? [m.i] : m && m.fault ? m.support : [], ...both(say) };
  }

  // Solve from the givens by Hint's deductions alone and report how hard that was.
  function grade(p, depth, work) {
    const s = start(p), used = { pair: 0, gap: 0, share: 0, trial: 0, search: 0 };
    for (;;) {
      spend(work);
      const m = next(p, s, depth || 3, true, work);
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
  function fill(n, random, work) {
    const s = Array(n * n).fill(0);
    const place = i => {
      spend(work);
      if (i === s.length) return true;
      for (const v of random() < 0.5 ? [BLACK, WHITE] : [WHITE, BLACK]) {
        s[i] = v;
        if (!broken(n, s) && count(n, s, 1, null, work) > 0 && place(i + 1)) return true;
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
  // Optional deterministic work budget: each search node, fill step and grading step costs one unit.
  // A spent budget returns null, never a board whose uniqueness was not proved. Unbudgeted campaign
  // generation keeps precisely its old order and output.
  const exhausted = new Error('Generation work budget exhausted');
  function spend(work) { if (work && --work.left < 0) throw exhausted; }
  function generate(seed, n, difficulty, maxWork) {
    if (![2, 4, 6, 8, 10, 12].includes(n)) return null;
    const work = maxWork === undefined ? null : { left: maxWork };
    try {
      const plan = DIFFICULTY[difficulty] || DIFFICULTY.Normal, random = rng(seed);
      const solution = fill(n, random, work), givens = solution.slice();
      const floor = Math.ceil(n * n * plan.keep);
      let left = givens.length;
      for (const i of shuffle(givens.map((_, k) => k), random)) {
        if (left <= floor) break;
        const was = givens[i];
        givens[i] = 0;
        const p = { n, givens };
        if (count(n, givens, 2, null, work) === 1 && grade(p, plan.depth, work).solved) left--;
        else givens[i] = was;
      }
      const p = { n, givens };
      return { n, givens, seed: seed >>> 0, difficulty: DIFFICULTY[difficulty] ? difficulty : 'Normal', version: VERSION, level: grade(p, 3, work).level };
    } catch (e) { if (e === exhausted) return null; throw e; }
  }

  return { VERSION, EMPTY, BLACK, WHITE, NAME, rng, valid, stateValid, start, lines, inspect, solve, next, answer, fix, grade, generate };
});
