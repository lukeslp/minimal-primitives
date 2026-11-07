/* Noon · the selection engine, after Nomon (Broderick and MacKay, 2009). By Luke Steuber. */
(function (root, make) {
  const E = make();
  if (typeof module === 'object' && module.exports) module.exports = E; else root.NoonEngine = E;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Every clock's hand turns once a period. A press is scored for every clock
  // by how far its hand stood from noon, with a click-time distribution: a
  // Gaussian on the time offset from noon, wrapped to the period. The starting
  // model is centred on noon and 60 ms wide; learning can move its centre to a
  // player's own offset and widen it to their spread, never narrow it.
  const ALPHA = 99, LOG_ALPHA = Math.log(ALPHA);
  const SIGMA0 = 60, MU_LIMIT = 300;
  // After a press the most likely clock reaches noon half a period later.
  const LEAD = .5;
  // Learning: each click decays the earlier ones by LAMBDA, so the model
  // weighs about the last ten; a selection teaches only once two later
  // selections have stood, so an Undo can take it back first (the paper's delay).
  const LAMBDA = .9, PRIOR_WEIGHT = 1 / (1 - LAMBDA), DELAY = 2, NEAR = .25;
  // Seven speeds, from about four seconds a turn to 0.8, each about a quarter
  // quicker than the one before; the fourth, 1.9 s, is near the paper's 2.0 s
  // novice setting and is where a new player starts.
  const STEPS = Object.freeze([4000, 3100, 2400, 1900, 1450, 1100, 800]), DEFAULT_STEP = 3;
  const MAX_PRESSES = 60;
  const mod1 = x => x - Math.floor(x);
  const wrap = x => mod1(x + .5) - .5;
  const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

  const DEFAULT_MODEL = Object.freeze({ mu: 0, sigma: SIGMA0 });

  // Log likelihood (unnormalised; every clock shares sigma) of a press
  // landing `delta` ms from a clock's noon.
  function logLikelihood(delta, T, model) {
    const s2 = 2 * model.sigma * model.sigma, a = [-1, 0, 1].map(k => -((delta + k * T - model.mu) ** 2) / s2), m = Math.max(...a);
    return m + Math.log(a.reduce((sum, v) => sum + Math.exp(v - m), 0));
  }

  // One selection: the clocks in contention, in their fixed order, each with
  // a phase (its noon as a fraction of the period after `ref`) and a log score.
  function selection(ids, T, t0) {
    const n = ids.length, phase = new Map(ids.map((id, k) => [id, k / n]));
    return { ids: ids.slice(), T, logp: new Map(ids.map(id => [id, 0])), phase, ref: t0 + LEAD * T, presses: 0, glide: null, offsets: [] };
  }
  // A hand's turn since noon as a fraction of a full turn. During a glide the
  // hand eases from where it stood to its new place along the shorter way; a
  // press is scored by the hand as drawn.
  function settled(sel, id, t) { return mod1((t - sel.ref) / sel.T - sel.phase.get(id)); }
  function turn(sel, id, t) {
    const now = settled(sel, id, t), g = sel.glide;
    if (!g || t >= g.end || !g.from.has(id)) return now;
    const from = g.from.get(id) + (t - g.start) / sel.T;
    return mod1(from + wrap(now - from) * smooth((t - g.start) / (g.end - g.start)));
  }
  // Offset from noon in ms: negative before noon, positive after.
  const offset = (sel, id, t) => wrap(turn(sel, id, t)) * sel.T;
  // The first settled noon of a clock at or after t.
  function noonAfter(sel, id, t) {
    let at = sel.ref + sel.phase.get(id) * sel.T;
    if (at < t) at += Math.ceil((t - at) / sel.T) * sel.T;
    return at;
  }
  function ranked(sel) {
    const order = new Map(sel.ids.map((id, k) => [id, k]));
    return sel.ids.slice().sort((a, b) => sel.logp.get(b) - sel.logp.get(a) || order.get(a) - order.get(b));
  }
  // Probabilities, normalised, in the fixed order.
  function probabilities(sel) {
    const m = Math.max(...sel.logp.values()), w = sel.ids.map(id => Math.exp(sel.logp.get(id) - m)), z = w.reduce((a, b) => a + b, 0);
    return new Map(sel.ids.map((id, k) => [id, w[k] / z]));
  }
  // After a press: the clocks are ranked by score and take phases from n even
  // slots so the likeliest have their noons as far apart as possible. The
  // leader takes the first slot; each clock after it, in rank order, takes
  // the free slot farthest from every slot already taken, and of equally far
  // slots the one farthest from the leader's. So the runner-up stands half a
  // period from the leader, the next two a quarter from both, and a stronger
  // contender never stands nearer the leader than a weaker one of the same round.
  function spread(sel, order) {
    const n = order.length, taken = [], free = new Array(n).fill(true), phase = new Map();
    const apart = (a, b) => { const d = Math.abs(a - b) % n; return Math.min(d, n - d); };
    for (const id of order) {
      let best = -1, far = -1, lead = -1;
      for (let s = 0; s < n; s++) {
        if (!free[s]) continue;
        let m = n; for (const p of taken) m = Math.min(m, apart(p, s));
        const l = taken.length ? apart(taken[0], s) : 0;
        if (m > far || m === far && l > lead) { best = s; far = m; lead = l; }
      }
      free[best] = false; taken.push(best); phase.set(id, best / n);
    }
    return phase;
  }
  // A press at time t. Returns the winner once its score is 99 times the
  // runner-up's, the paper's setting (an error bound of about 1%), or null.
  function press(sel, t, model = DEFAULT_MODEL, glide = 0) {
    for (const id of sel.ids) sel.logp.set(id, sel.logp.get(id) + logLikelihood(offset(sel, id, t), sel.T, model));
    sel.offsets.push(new Map(sel.ids.map(id => [id, offset(sel, id, t)])));
    sel.presses++;
    const order = ranked(sel);
    if (order.length === 1 || sel.logp.get(order[0]) - sel.logp.get(order[1]) >= LOG_ALPHA) return order[0];
    const from = new Map(sel.ids.map(id => [id, turn(sel, id, t)]));
    sel.phase = spread(sel, order); sel.ref = t + LEAD * sel.T;
    sel.glide = glide > 0 ? { start: t, end: t + glide, from } : null;
    return null;
  }

  // The player's timing, learned with damping and a delay, as in the paper.
  function learner() { return { w: PRIOR_WEIGHT, s1: 0, s2: PRIOR_WEIGHT * SIGMA0 * SIGMA0, pending: [] }; }
  function model(l, adapt = true) {
    if (!adapt || !l) return DEFAULT_MODEL;
    const mu = Math.max(-MU_LIMIT, Math.min(MU_LIMIT, l.s1 / l.w)), v = l.s2 / l.w - (l.s1 / l.w) ** 2;
    return { mu, sigma: Math.max(SIGMA0, Math.sqrt(Math.max(0, v))) };
  }
  function absorb(l, offsets) { for (const x of offsets) { l.w = LAMBDA * l.w + 1; l.s1 = LAMBDA * l.s1 + x; l.s2 = LAMBDA * l.s2 + x * x; } }
  // A selection's clicks wait in line; the one two selections back is learned.
  function remember(l, offsets) { l.pending.push(offsets); while (l.pending.length > DELAY) absorb(l, l.pending.shift()); }
  function forget(l) { l.pending.pop(); }
  // The offsets a selection teaches: the chosen clock's offset at each of its
  // presses, kept only near noon.
  const taught = (sel, winner) => sel.offsets.map(m => m.get(winner)).filter(x => x !== undefined && Math.abs(x) <= NEAR * sel.T).map(x => Math.round(x * 100) / 100);

  // A board: a picture on a grid of clocks, given by the lengths of the runs
  // of filled cells in each row and column. Cell i is row floor(i / cols),
  // column i % cols. Choosing a clock fills its cell, or empties it again.
  const step = s => Number.isInteger(s) && s >= 0 && s < STEPS.length ? s : DEFAULT_STEP;
  function period(board, speed = DEFAULT_STEP) { return STEPS[step(speed)]; }
  const cache = new WeakMap();
  function info(board) {
    if (cache.has(board)) return cache.get(board);
    const R = board.rows, C = board.cols, sol = new Uint8Array(R * C);
    board.picture.forEach((row, r) => [...row].forEach((ch, c) => { sol[r * C + c] = ch === '#' ? 1 : 0; }));
    const rowCells = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => r * C + c));
    const colCells = Array.from({ length: C }, (_, c) => Array.from({ length: R }, (_, r) => r * C + c));
    const sweep = colCells.flat();
    const out = { R, C, N: R * C, sol, K: sol.reduce((a, b) => a + b, 0), rowCells, colCells, sweep, rows: rowCells.map(l => runs(l.map(i => sol[i]))), cols: colCells.map(l => runs(l.map(i => sol[i]))) };
    cache.set(board, out); return out;
  }
  // The runs of filled cells along a line, as lengths; an empty line has none.
  function runs(cells) { const out = []; let n = 0; for (const v of cells) { if (v) n++; else if (n) { out.push(n); n = 0; } } if (n) out.push(n); return out; }
  const same = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);
  // A line goes quiet when its filled cells make exactly its clue.
  function quiet(board, filled) {
    const g = info(board), has = filled instanceof Set ? filled : new Set(filled);
    return { rows: g.rowCells.map((l, r) => same(runs(l.map(i => has.has(i) ? 1 : 0)), g.rows[r])), cols: g.colCells.map((l, c) => same(runs(l.map(i => has.has(i) ? 1 : 0)), g.cols[c])) };
  }
  // A clock is choosable while its cell is filled, or while neither its row
  // nor its column has gone quiet: once a line's clue is met, its empty cells
  // are empty by its logic and leave contention, until a cell in it is emptied.
  function live(board, filled, q = quiet(board, filled)) {
    const g = info(board), has = filled instanceof Set ? filled : new Set(filled);
    return Array.from({ length: g.N }, (_, i) => has.has(i) || (!q.rows[Math.floor(i / g.C)] && !q.cols[i % g.C]));
  }
  const start = () => ({ filled: [], history: [], view: -1 });
  function solved(board, state) { const q = quiet(board, state.filled); return q.rows.every(Boolean) && q.cols.every(Boolean); }
  const MODES = Object.freeze(['cell', 'line']);
  // Whose turn it is. Choosing by cell: every choosable clock, by column then
  // row, then undo once there is a choice to take back. Choosing by line: on
  // the board, a clock for each row with a choosable clock in it; zoomed into
  // a row, that row's choosable clocks, a clock to zoom out, and undo. A
  // finished board offers next and undo, the last board nothing.
  function contention(board, state, mode = 'cell', lastBoard = false) {
    if (solved(board, state)) return lastBoard ? [] : ['next', 'undo'];
    const g = info(board), ok = live(board, state.filled), undo = state.history.length ? ['undo'] : [];
    if (mode !== 'line') return g.sweep.filter(i => ok[i]).concat(undo);
    if (state.view < 0) return g.rowCells.map((l, r) => l.some(i => ok[i]) ? 'r' + r : null).filter(Boolean).concat(undo);
    return g.rowCells[state.view].filter(i => ok[i]).concat('out', undo);
  }
  // What choosing does: a cell's clock fills or empties it; undo takes back
  // the last fill or emptying; a row's clock zooms into it, out zooms back.
  function choose(board, state, id) {
    const s = { filled: state.filled.slice(), history: state.history.slice(), view: state.view };
    if (id === 'undo') { const i = s.history.pop(); if (i !== undefined) { const k = s.filled.indexOf(i); if (k >= 0) s.filled.splice(k, 1); else s.filled.push(i); } }
    else if (id === 'out') s.view = -1;
    else if (typeof id === 'string' && id[0] === 'r') s.view = Number(id.slice(1));
    else if (Number.isInteger(id)) { const k = s.filled.indexOf(id); if (k >= 0) s.filled.splice(k, 1); else s.filled.push(id); s.history.push(id); }
    s.filled.sort((a, b) => a - b);
    if (solved(board, s)) s.view = -1;
    return s;
  }
  // The next choice on a perfect run: empty a wrongly filled cell first, then
  // fill the picture's cells in the given order; choosing by line, zoom into
  // the cell's row first, or out of another row.
  function next(board, state, mode = 'cell', order = null) {
    if (solved(board, state)) return 'next';
    const g = info(board), has = new Set(state.filled), wrong = g.sweep.find(i => has.has(i) && !g.sol[i]);
    const target = wrong !== undefined ? wrong : (order || g.sweep).find(i => g.sol[i] && !has.has(i));
    if (mode !== 'line') return target;
    const row = Math.floor(target / g.C);
    return state.view === row ? target : state.view >= 0 ? 'out' : 'r' + row;
  }

  // A perfect presser presses exactly at the wanted clock's noon, with the
  // starting model. `shift` moves every press by that many ms.
  function cost(ids, want, T, shift = 0, m = DEFAULT_MODEL) {
    const sel = selection(ids, T, 0); let t = 0;
    for (let k = 0; k < MAX_PRESSES; k++) {
      t = noonAfter(sel, want, t) + shift;
      const winner = press(sel, t, m);
      if (winner !== null) return { presses: sel.presses, winner };
    }
    return { presses: Infinity, winner: null };
  }
  // A perfect run in full: presses at every choice, following `next`.
  function run(board, mode, speed, order, shift = 0) {
    let s = start(), presses = 0;
    for (let guard = 0; guard < 2000 && !solved(board, s); guard++) {
      const want = next(board, s, mode, order), c = cost(contention(board, s, mode), want, period(board, speed), shift);
      if (c.winner !== want) return Infinity;
      presses += c.presses; s = choose(board, s, want);
    }
    return presses;
  }
  // The presses for one choice among n clocks depend only on n and the
  // period (every clock's noon stands in an even slot), so they are tabled.
  const tables = new Map();
  function table(T, n) {
    if (!tables.has(T)) tables.set(T, [0]);
    const t = tables.get(T);
    while (t.length <= n) { const k = t.length; t.push(cost(Array.from({ length: k }, (_, i) => i), 0, T).presses); }
    return t[n];
  }
  // The order of fills for a perfect run, found by search over whole lines.
  // By cell: the clocks in play are always every picture cell, filled or not,
  // plus the empty cells whose row and column are both unfinished, plus undo,
  // so a choice's cost changes only as lines finish. The search finishes one
  // line at a time (its cells in the order that finishes crossing lines
  // soonest) over every set of finished lines. By line: zooming in costs the
  // same whichever row, and within a row the clocks in play do not change
  // while it fills, so the search is over the order of rows.
  function plan(board, mode, speed) {
    const g = info(board), T = period(board, speed), L = g.R + g.C, cellsOf = l => l < g.R ? g.rowCells[l] : g.colCells[l - g.R];
    const solOf = Array.from({ length: L }, (_, l) => cellsOf(l).filter(i => g.sol[i]));
    const memo = new Map();
    if (mode !== 'line') {
      const closure = has => { let m = 0; for (let l = 0; l < L; l++) if (solOf[l].every(i => has.has(i))) m |= 1 << l; return m; };
      const empties = mask => { let e = 0; for (let i = 0; i < g.N; i++) if (!g.sol[i] && !(mask >> Math.floor(i / g.C) & 1) && !(mask >> (g.R + i % g.C) & 1)) e++; return e; };
      const filledOf = mask => { const has = new Set(); for (let l = 0; l < L; l++) if (mask >> l & 1) for (const i of solOf[l]) has.add(i); return has; };
      const best = mask => {
        if (memo.has(mask)) return memo.get(mask);
        const has = filledOf(mask);
        if (has.size === g.K) { const r = { total: 0, order: [] }; memo.set(mask, r); return r; }
        let out = null;
        for (let l = 0; l < L; l++) {
          if (mask >> l & 1) continue;
          const missing = solOf[l].filter(i => !has.has(i));
          // Cells whose crossing line has the fewest cells left go first.
          const cross = i => { const other = l < g.R ? g.R + i % g.C : Math.floor(i / g.C); return solOf[other].filter(j => !has.has(j)).length; };
          missing.sort((a, b) => cross(a) - cross(b) || a - b);
          const now = new Set(has); let total = 0, m = mask;
          for (const i of missing) { total += table(T, g.K + empties(m) + (now.size ? 1 : 0)); now.add(i); m = closure(now); }
          const rest = best(m), sum = total + rest.total;
          if (!out || sum < out.total) out = { total: sum, order: missing.concat(rest.order) };
        }
        memo.set(mask, out); return out;
      };
      // Past eighteen lines the search is too large; a greedy order then
      // finishes next the line with the fewest cells left (used only by the
      // model's larger boards, none of which is in the game).
      if (L > 18) {
        const has = new Set(), order = [];
        while (has.size < g.K) {
          let pick = -1, few = Infinity;
          for (let l = 0; l < L; l++) { const left = solOf[l].filter(i => !has.has(i)).length; if (left && left < few) { few = left; pick = l; } }
          for (const i of solOf[pick]) if (!has.has(i)) { has.add(i); order.push(i); }
        }
        return order;
      }
      return best(closure(new Set())).order;
    }
    const rowsWith = g.rowCells.map((l, r) => solOf[r].length > 0), zoomN = rowsWith.filter(Boolean).length;
    const best = (mask, any) => {
      const key = mask + ':' + any;
      if (memo.has(key)) return memo.get(key);
      const has = new Set(); for (let r = 0; r < g.R; r++) if (mask >> r & 1) for (const i of solOf[r]) has.add(i);
      if (has.size === g.K) { const r = { total: 0, order: [] }; memo.set(key, r); return r; }
      const colDone = g.colCells.map((l, c) => solOf[g.R + c].every(i => has.has(i)));
      let out = null;
      for (let r = 0; r < g.R; r++) {
        if (mask >> r & 1 || !rowsWith[r]) continue;
        const sols = solOf[r], empties = g.rowCells[r].filter(i => !g.sol[i] && !colDone[i % g.C]).length, done = has.size + sols.length === g.K;
        let total = table(T, zoomN + (any ? 1 : 0));
        sols.forEach((_, k) => { total += table(T, sols.length + empties + 1 + (any || k ? 1 : 0)); });
        if (!done) total += table(T, sols.length + 2);
        const rest = best(mask | 1 << r, true), sum = total + rest.total;
        if (!out || sum < out.total) out = { total: sum, order: sols.concat(rest.order) };
      }
      memo.set(key, out); return out;
    };
    return best(0, false).order;
  }
  // Par: the presses of a perfect run along the planned order, by the real
  // algorithm at every choice.
  function solve(board, mode, speed, shift = 0) { const order = plan(board, mode, speed); return { order, par: run(board, mode, speed, order, shift) }; }
  // A floor for choosing by cell: after the first choice the clocks in play
  // are never fewer than the picture's cells plus undo.
  function floor(board, speed) {
    const g = info(board), T = period(board, speed), e0 = live(board, []).filter((v, i) => v && !g.sol[i]).length;
    let low = Infinity; for (let n = g.K + 1; n <= g.K + 1 + e0; n++) low = Math.min(low, table(T, n));
    return table(T, g.K + e0) + (g.K - 1) * low;
  }

  return { ALPHA, LOG_ALPHA, SIGMA0, LEAD, LAMBDA, DELAY, NEAR, STEPS, DEFAULT_STEP, MODES, DEFAULT_MODEL, wrap, mod1, logLikelihood, selection, turn, settled, offset, noonAfter, ranked, probabilities, spread, press, learner, model, absorb, remember, forget, taught, period, info, runs, quiet, live, start, solved, contention, choose, next, cost, run, table, plan, solve, floor };
});
