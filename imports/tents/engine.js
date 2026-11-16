/* Tents: pure rules, solver, hint deductions and seeded generator.
   A puzzle is {id,w,h,cells,rows,cols}: cells[i] is 1 for a tree, 0 for open ground;
   rows and cols hold the tent counts (both null on a board that has no numbers).
   A state is an array the same length: 0 blank, 1 tent, 2 grass (the player's "nothing here"). */
(function (root) {
  'use strict';
  const VERSION = 'tents-1';
  const BLANK = 0, TENT = 1, GRASS = 2;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const topologies = new WeakMap();
  function topology(p) {
    let t = topologies.get(p);
    if (t) return t;
    const n = p.w * p.h, orth = [], around = [], trees = [];
    for (let i = 0; i < n; i++) {
      const x = i % p.w, y = (i / p.w) | 0, o = [], a = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h) continue;
        a.push(Y * p.w + X);
        if (!dx || !dy) o.push(Y * p.w + X);
      }
      orth.push(o); around.push(a);
      if (p.cells[i]) trees.push(i);
    }
    const treesBy = orth.map(o => o.filter(j => p.cells[j]));
    t = { n, orth, around, trees, treesBy };
    topologies.set(p, t);
    return t;
  }

  function valid(p) {
    if (!p || !Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1) return false;
    if (!Array.isArray(p.cells) || p.cells.length !== p.w * p.h || !p.cells.every(v => v === 0 || v === 1)) return false;
    if (p.rows === null && p.cols === null) return true;
    const count = a => Array.isArray(a) && a.every(v => Number.isInteger(v) && v >= 0);
    return count(p.rows) && count(p.cols) && p.rows.length === p.h && p.cols.length === p.w;
  }
  function stateValid(p, s) {
    return Array.isArray(s) && s.length === p.w * p.h && s.every((v, i) => v === 0 || ((v === 1 || v === 2) && !p.cells[i]));
  }

  /* Largest set of tree-tent pairs in which every tree and every tent is used once.
     `keep` (optional) is an earlier list of {tent,tree}: pairs still on the board are kept unless a
     larger set needs them moved, so the page's ties do not jump about as tents are added. */
  function pairing(p, s, keep) {
    const t = topology(p), owner = new Map(), held = new Set();
    function assign(tree, seen) {
      for (const c of t.orth[tree]) {
        if (s[c] !== TENT || p.cells[c] || seen.has(c)) continue;
        seen.add(c);
        if (!owner.has(c) || assign(owner.get(c), seen)) { owner.set(c, tree); return true; }
      }
      return false;
    }
    if (keep) for (const q of keep) {
      if (s[q.tent] !== TENT || p.cells[q.tent] || !p.cells[q.tree] || owner.has(q.tent) || held.has(q.tree) || !t.orth[q.tent].includes(q.tree)) continue;
      owner.set(q.tent, q.tree); held.add(q.tree);
    }
    for (const tree of t.trees) if (!held.has(tree)) assign(tree, new Set());
    return { size: owner.size, pairs: [...owner].map(([tent, tree]) => ({ tent, tree })) };
  }

  function lineCounts(p, s) {
    const rows = Array(p.h).fill(0), cols = Array(p.w).fill(0);
    for (let i = 0; i < s.length; i++) if (s[i] === TENT && !p.cells[i]) { rows[(i / p.w) | 0]++; cols[i % p.w]++; }
    return { rows, cols };
  }

  /* What the rules say about the marks on the board. Nothing here knows the answer. */
  function inspect(p, s) {
    const t = topology(p), tents = [];
    for (let i = 0; i < t.n; i++) if (s[i] === TENT && !p.cells[i]) tents.push(i);
    const touching = tents.filter(i => t.around[i].some(j => s[j] === TENT && !p.cells[j]));
    const lonely = tents.filter(i => !t.treesBy[i].length);
    const { rows, cols } = lineCounts(p, s);
    const status = (have, want) => have < want ? 'short' : have === want ? 'met' : 'over';
    const rowState = p.rows ? rows.map((v, y) => status(v, p.rows[y])) : null;
    const colState = p.cols ? cols.map((v, x) => status(v, p.cols[x])) : null;
    const match = pairing(p, s);
    const linesMet = (!rowState || rowState.every(v => v === 'met')) && (!colState || colState.every(v => v === 'met'));
    const solved = !touching.length && linesMet && tents.length === t.trees.length && match.size === t.trees.length;
    const broken = [];
    if (touching.length) broken.push({ rule: 'touch', cells: touching });
    if (lonely.length) broken.push({ rule: 'tree', cells: lonely });
    if (rowState) rowState.forEach((v, y) => { if (v === 'over') broken.push({ rule: 'row', index: y }); });
    if (colState) colState.forEach((v, x) => { if (v === 'over') broken.push({ rule: 'col', index: x }); });
    return { solved, tents, touching, lonely, rowCount: rows, colCount: cols, rowState, colState, pairs: match.pairs, broken };
  }

  /* Counts solutions, stopping at `limit`. `fixed` is a state whose tents must stay tents and whose grass must stay empty. */
  function count(p, options) {
    const o = options || {}, limit = o.limit || 2, fixed = o.fixed || null, budget = o.budget || 4000000;
    const t = topology(p), clues = !!p.rows;
    const result = { count: 0, solution: null, nodes: 0, status: 'ok' };
    if (fixed) for (let i = 0; i < t.n; i++) if (fixed[i] === TENT && (p.cells[i] || !t.treesBy[i].length)) return result;
    const cand = [];
    for (let i = 0; i < t.n; i++) if (!p.cells[i] && t.treesBy[i].length) cand.push(i);
    const rowAfter = Array(cand.length).fill(0), colAfter = Array(cand.length).fill(0);
    {
      const r = Array(p.h).fill(0), c = Array(p.w).fill(0);
      for (let k = cand.length - 1; k >= 0; k--) {
        const y = (cand[k] / p.w) | 0, x = cand[k] % p.w;
        rowAfter[k] = r[y]++; colAfter[k] = c[x]++;
      }
      if (clues) {
        if (p.rows.some((v, y) => v > r[y]) || p.cols.some((v, x) => v > c[x])) return result;
        if (p.rows.reduce((a, b) => a + b, 0) !== t.trees.length || p.cols.reduce((a, b) => a + b, 0) !== t.trees.length) return result;
      }
    }
    const rowLeft = clues ? p.rows.slice() : null, colLeft = clues ? p.cols.slice() : null;
    const s = Array(t.n).fill(0);
    function search(k, left) {
      if (result.count >= limit || result.status !== 'ok') return;
      if (++result.nodes > budget) { result.status = 'exhausted'; return; }
      if (cand.length - k < left) return;
      if (k === cand.length) {
        if (clues && (rowLeft.some(v => v) || colLeft.some(v => v))) return;
        if (pairing(p, s).size !== t.trees.length) return;
        if (++result.count === 1) result.solution = s.slice();
        return;
      }
      const i = cand[k], y = (i / p.w) | 0, x = i % p.w, f = fixed ? fixed[i] : 0;
      if (left > 0 && f !== GRASS && (!clues || (rowLeft[y] > 0 && colLeft[x] > 0)) && !t.around[i].some(j => s[j] === TENT)) {
        s[i] = TENT; if (clues) { rowLeft[y]--; colLeft[x]--; }
        search(k + 1, left - 1);
        s[i] = 0; if (clues) { rowLeft[y]++; colLeft[x]++; }
      }
      if (f !== TENT && (!clues || (rowLeft[y] <= rowAfter[k] && colLeft[x] <= colAfter[k]))) search(k + 1, left);
    }
    search(0, t.trees.length);
    return result;
  }

  function unique(p) { const r = count(p, { limit: 2 }); return r.status === 'ok' && r.count === 1; }

  /* ---- Hint deductions ---- */
  const plural = (n, one, many) => n === 1 ? one : many;

  /* The first simple rule that forces something, as {rule,value,cells,...}; null when none applies. */
  function simple(p, s) {
    const t = topology(p), open = i => !p.cells[i] && s[i] === BLANK;
    let cells = [];
    for (let i = 0; i < t.n; i++) if (open(i) && !t.treesBy[i].length) cells.push(i);
    if (cells.length) return { rule: 'no-tree', value: GRASS, cells, evidence: [] };
    const near = [];
    for (let i = 0; i < t.n; i++) if (open(i) && t.around[i].some(j => s[j] === TENT)) { cells.push(i); for (const j of t.around[i]) if (s[j] === TENT && !near.includes(j)) near.push(j); }
    if (cells.length) return { rule: 'touch', value: GRASS, cells, evidence: near };
    if (p.rows) {
      const c = lineCounts(p, s), lines = [];
      for (let y = 0; y < p.h; y++) lines.push({ line: 'row', index: y, want: p.rows[y], have: c.rows[y], cells: Array.from({ length: p.w }, (_, x) => y * p.w + x) });
      for (let x = 0; x < p.w; x++) lines.push({ line: 'col', index: x, want: p.cols[x], have: c.cols[x], cells: Array.from({ length: p.h }, (_, y) => y * p.w + x) });
      for (const l of lines) { const free = l.cells.filter(open); if (free.length && l.have === l.want) return { rule: 'line-full', value: GRASS, cells: free, line: l.line, index: l.index, evidence: [] }; }
      for (const l of lines) { const free = l.cells.filter(open); if (free.length && l.want - l.have === free.length) return { rule: 'line-needs', value: TENT, cells: free, line: l.line, index: l.index, evidence: [] }; }
    }
    for (const tree of t.trees) {
      if (t.orth[tree].some(j => s[j] === TENT)) continue;
      const free = t.orth[tree].filter(open);
      if (free.length === 1) return { rule: 'tree-last', value: TENT, cells: free, evidence: [tree] };
    }
    return null;
  }

  /* A plain contradiction in a partial state, or null. */
  function contradiction(p, s) {
    const t = topology(p), open = i => !p.cells[i] && s[i] === BLANK;
    for (let i = 0; i < t.n; i++) if (s[i] === TENT && t.around[i].some(j => s[j] === TENT)) return { type: 'touch', cells: [i] };
    for (let i = 0; i < t.n; i++) if (s[i] === TENT && !t.treesBy[i].length) return { type: 'no-tree', cells: [i] };
    if (p.rows) {
      const c = lineCounts(p, s);
      for (let y = 0; y < p.h; y++) {
        let free = 0; for (let x = 0; x < p.w; x++) if (open(y * p.w + x)) free++;
        if (c.rows[y] > p.rows[y]) return { type: 'over', line: 'row', index: y };
        if (c.rows[y] + free < p.rows[y]) return { type: 'short', line: 'row', index: y };
      }
      for (let x = 0; x < p.w; x++) {
        let free = 0; for (let y = 0; y < p.h; y++) if (open(y * p.w + x)) free++;
        if (c.cols[x] > p.cols[x]) return { type: 'over', line: 'col', index: x };
        if (c.cols[x] + free < p.cols[x]) return { type: 'short', line: 'col', index: x };
      }
    }
    for (const tree of t.trees) if (!t.orth[tree].some(j => s[j] === TENT || open(j))) return { type: 'tree', cells: [tree] };
    let tents = 0, blanks = 0;
    for (let i = 0; i < t.n; i++) { if (s[i] === TENT) tents++; else if (open(i)) blanks++; }
    if (tents > t.trees.length) return { type: 'pairs' };
    if (!blanks && !inspect(p, s).solved) return { type: 'pairs' };
    return null;
  }

  /* Follows the simple rules from an assumption until they stop or break. */
  function refute(p, s, cell, value) {
    const a = s.slice(); a[cell] = value;
    for (let guard = 0; guard < 400; guard++) {
      const bad = contradiction(p, a);
      if (bad) return bad;
      const step = simple(p, a);
      if (!step) return null;
      for (const i of step.cells) a[i] = step.value;
    }
    return null;
  }

  const lineName = (line, index) => (line === 'row' ? 'row ' : 'column ') + (index + 1);
  function why(bad) {
    if (bad.type === 'touch') return 'two tents end up touching';
    if (bad.type === 'over') return lineName(bad.line, bad.index) + ' gets too many tents';
    if (bad.type === 'short') return lineName(bad.line, bad.index) + ' cannot reach its number';
    if (bad.type === 'tree') return 'a tree is left with no cell for its tent';
    return 'the trees and tents cannot pair up';
  }
  function sentence(h) {
    const n = h.cells.length;
    switch (h.rule) {
      case 'wrong-tent': return h.touching ? 'These tents touch, and no solution keeps this one. Clear it.' : 'Contradiction: no solution keeps this tent. Clear it.';
      case 'wrong-grass': return 'Contradiction: every solution needs a tent here. Clear the dot.';
      case 'no-tree': return plural(n, 'No tree beside this cell, so it is grass.', 'No tree beside these cells, so they are grass.');
      case 'touch': return plural(n, 'This cell touches a tent, so it is grass.', 'These cells touch a tent, so they are grass.');
      case 'line-full': return capital(lineName(h.line, h.index)) + ' has all its tents. The rest is grass.';
      case 'line-needs': return capital(lineName(h.line, h.index)) + ' needs ' + plural(n, 'its last open cell.', 'every open cell it has left.');
      case 'tree-last': return 'This tree has one cell left for its tent.';
      case 'contradiction': return 'Contradiction: as ' + (h.value === GRASS ? 'a tent' : 'grass') + ', ' + why(h.because) + '. So it is ' + (h.value === GRASS ? 'grass.' : 'a tent.');
      case 'search': return 'Contradiction: ' + (h.value === GRASS ? 'with a tent here' : 'with grass here') + ', nothing else fits. So it is ' + (h.value === GRASS ? 'grass.' : 'a tent.');
      default: return '';
    }
  }
  const capital = text => text[0].toUpperCase() + text.slice(1);

  /* The next deduction from the marks on the board: {rule,value,cells,evidence,text}. null on a finished board. */
  function hint(p, s) {
    const t = topology(p), done = h => { h.evidence = h.evidence || []; h.text = sentence(h); return h; };
    if (inspect(p, s).solved) return null;
    // Marks that no solution can keep come first; the solver proves each one.
    if (count(p, { limit: 1, fixed: s }).count === 0) {
      const marks = [];
      for (let i = 0; i < t.n; i++) if (s[i] === TENT) marks.push(i);
      for (let i = 0; i < t.n; i++) if (s[i] === GRASS) marks.push(i);
      for (const i of marks) {
        const only = Array(t.n).fill(0); only[i] = s[i];
        if (count(p, { limit: 1, fixed: only }).count === 0) {
          const touching = s[i] === TENT && t.around[i].some(j => s[j] === TENT);
          return done({ rule: s[i] === TENT ? 'wrong-tent' : 'wrong-grass', value: BLANK, cells: [i], touching, evidence: touching ? t.around[i].filter(j => s[j] === TENT) : [] });
        }
      }
    }
    const easy = simple(p, s);
    if (easy) return done(easy);
    const blanks = [];
    for (let i = 0; i < t.n; i++) if (!p.cells[i] && s[i] === BLANK) blanks.push(i);
    for (const i of blanks) for (const value of [TENT, GRASS]) {
      const bad = refute(p, s, i, value);
      if (bad) return done({ rule: 'contradiction', value: value === TENT ? GRASS : TENT, cells: [i], because: bad });
    }
    for (const i of blanks) {
      const as = s.slice(); as[i] = GRASS;
      if (count(p, { limit: 1, fixed: as }).count === 0) return done({ rule: 'search', value: TENT, cells: [i] });
    }
    return blanks.length ? done({ rule: 'search', value: GRASS, cells: [blanks[0]] }) : null;
  }

  function apply(s, h) { const next = s.slice(); for (const i of h.cells) next[i] = h.value; return next; }

  /* Solves by Hint alone and reports which kinds of step it needed. */
  function grade(p) {
    let s = Array(p.w * p.h).fill(0);
    const out = { solved: false, steps: 0, contradictions: 0, searches: 0, rules: {} };
    for (let guard = 0; guard < 600; guard++) {
      const h = hint(p, s);
      if (!h) break;
      out.steps++; out.rules[h.rule] = (out.rules[h.rule] || 0) + 1;
      if (h.rule === 'contradiction') out.contradictions++;
      if (h.rule === 'search') out.searches++;
      s = apply(s, h);
    }
    out.solved = inspect(p, s).solved; out.state = s;
    return out;
  }

  /* ---- Generator ---- */
  function candidate(w, h, rand, target) {
    const n = w * h, p = { w, h, cells: Array(n).fill(0), rows: null, cols: null }, t = topology(p);
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const tent = Array(n).fill(0), tree = Array(n).fill(0);
    let placed = 0;
    for (const i of order) {
      if (placed >= target) break;
      if (tent[i] || tree[i] || t.around[i].some(j => tent[j])) continue;
      const spots = t.orth[i].filter(j => !tent[j] && !tree[j]);
      if (!spots.length) continue;
      tent[i] = 1; tree[spots[Math.floor(rand() * spots.length)]] = 1; placed++;
    }
    const out = { w, h, cells: tree, rows: Array(h).fill(0), cols: Array(w).fill(0) };
    for (let i = 0; i < n; i++) if (tent[i]) { out.rows[(i / w) | 0]++; out.cols[i % w]++; }
    return out;
  }

  const TARGETS = { 4: 3, 5: 5, 6: 7, 7: 10, 8: 12 };
  /* Deterministic for (seed, size, options). options.accept(grade, puzzle) filters by difficulty. */
  function generate(seed, size, options) {
    const o = options || {}, w = o.w || size, h = o.h || size, target = o.tents || TARGETS[size] || Math.round(w * h / 5), tries = o.tries || 400;
    for (let attempt = 0; attempt < tries; attempt++) {
      const rand = rng((Math.imul(seed >>> 0, 2654435761) + Math.imul(attempt + 1, 40503) + w * 97 + h) >>> 0);
      const p = candidate(w, h, rand, target);
      if (p.cells.reduce((a, b) => a + b, 0) < target || !unique(p)) continue;
      const g = grade(p);
      if (!g.solved || g.searches) continue;
      if (o.accept && !o.accept(g, p)) continue;
      return { w, h, cells: p.cells, rows: p.rows, cols: p.cols, seed, attempt, version: VERSION, contradictions: g.contradictions };
    }
    return null;
  }

  /* Free play once all thirty are solved: an 8x8 like the campaign's last size, needing one to five
     contradiction steps and never a plain search. generate() keeps only boards the solver proves have
     one answer (unique) and Hint can finish. `avoid` holds tree layouts already in use. */
  function freePlay(seed, avoid) {
    for (let k = 0; k < 50; k++) {
      const p = generate((seed + Math.imul(k, 7919)) >>> 0, 8, { tries: 60, accept: g => g.contradictions >= 1 && g.contradictions <= 5 });
      if (p && !(avoid && avoid.has(p.cells.join('')))) return p;
    }
    return null;
  }

  const api = { VERSION, BLANK, TENT, GRASS, rng, topology, valid, stateValid, pairing, inspect, count, unique, simple, contradiction, hint, apply, grade, candidate, generate, freePlay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
