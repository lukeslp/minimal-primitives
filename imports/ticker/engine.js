/* Ticker · the selection engine: a one-switch choice among sounds in a
   repeating cycle, after Ticker (Nel, Kristensson and MacKay) and Nomon
   (Broderick and MacKay). By Luke Steuber. */
(function (root, make) {
  const E = make();
  if (typeof module === 'object' && module.exports) module.exports = E; else root.TickerEngine = E;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Every item in play sounds once a cycle, in its own slot. A press is
  // scored for every item by how long after the item's sound it came, with a
  // click-time distribution: a Gaussian on that delay, wrapped to the cycle.
  // The starting model expects a press 250 ms after the sound, 80 ms wide;
  // learning moves the centre to a player's own delay and widens the spread
  // to theirs, never narrower than the start.
  const ALPHA = 99, LOG_ALPHA = Math.log(ALPHA);
  const SIGMA0 = 80, MU0 = 250, MU_MIN = -150, MU_MAX = 700;
  // After a press that does not decide, the cycle starts again 360 ms later
  // with the likeliest item first.
  const REST = 360;
  // Learning: each click decays the earlier ones by LAMBDA, so the model
  // weighs about the last ten; a choice teaches only once two later choices
  // have stood, so an undo can take it back first (Nomon's delay).
  const LAMBDA = .9, PRIOR_WEIGHT = 1 / (1 - LAMBDA), DELAY = 2, NEAR = .25;
  // Speed moves every cycle three of Nomon's 0.9 steps slower or faster.
  const SPEEDS = { slower: 0.9 ** -3, normal: 1, faster: 0.9 ** 3 };
  const MAX_PRESSES = 60;
  // The notes: two octaves of the major pentatonic scale on C, so any order
  // of them sounds pleasant. With the split on, the board's notes alternate
  // between the ears from the lowest, which starts on the left.
  const PITCHES = Object.freeze([['C4', 261.63], ['D4', 293.66], ['E4', 329.63], ['G4', 392.00], ['A4', 440.00], ['C5', 523.25], ['D5', 587.33], ['E5', 659.26], ['G5', 783.99], ['A5', 880.00]].map(([name, hz]) => Object.freeze({ name, hz })));
  const PAN = .8;
  const mod1 = x => x - Math.floor(x);
  const wrap = x => mod1(x + .5) - .5;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const DEFAULT_MODEL = Object.freeze({ mu: MU0, sigma: SIGMA0 });

  // Log likelihood (unnormalised; every item shares sigma) of a press
  // `delta` ms after an item's sound, the cycle wrapped twice each way.
  function logLikelihood(delta, T, model) {
    const s2 = 2 * model.sigma * model.sigma, a = [-2, -1, 0, 1, 2].map(k => -((delta + k * T - model.mu) ** 2) / s2), m = Math.max(...a);
    return m + Math.log(a.reduce((sum, v) => sum + Math.exp(v - m), 0));
  }

  // One choice: the items in play, in their fixed order, each with a slot (a
  // fraction of the cycle after `ref`, when the cycle's first sound plays)
  // and a log score.
  function selection(ids, T, t0) {
    const n = ids.length, phase = new Map(ids.map((id, k) => [id, k / n]));
    return { ids: ids.slice(), T, logp: new Map(ids.map(id => [id, 0])), phase, ref: t0, presses: 0, offsets: [] };
  }
  // How far round the cycle an item stands since its last sound, as a fraction.
  const since = (sel, id, t) => mod1((t - sel.ref) / sel.T - sel.phase.get(id));
  // The press's delay after an item's nearest sound in ms, within half a cycle either way.
  const offset = (sel, id, t) => wrap(since(sel, id, t)) * sel.T;
  // The first sound of an item at or after t.
  function onsetAfter(sel, id, t) {
    let at = sel.ref + sel.phase.get(id) * sel.T;
    if (at < t) at += Math.ceil((t - at) / sel.T) * sel.T;
    return at;
  }
  // The last sound of an item at or before t, or null before the cycle starts.
  function onsetBefore(sel, id, t) {
    const at = onsetAfter(sel, id, t);
    const before = at <= t ? at : at - sel.T;
    return before < sel.ref ? null : before;
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
  // After a press: the items are ranked by score and take slots from n even
  // ones so the likeliest sound as far apart as possible. The leader takes
  // the first slot; each item after it, in rank order, takes the free slot
  // farthest from every slot already taken, and of equally far slots the one
  // farthest from the leader's. So the runner-up sounds half a cycle after
  // the leader, the next two a quarter from both, and a stronger contender
  // never sounds nearer the leader than a weaker one of the same round.
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
  // runner-up's (Nomon's setting, an error bound of about 1%), or null; then
  // the cycle starts again REST ms later in the spread order.
  function press(sel, t, model = DEFAULT_MODEL) {
    for (const id of sel.ids) sel.logp.set(id, sel.logp.get(id) + logLikelihood(offset(sel, id, t), sel.T, model));
    sel.offsets.push(new Map(sel.ids.map(id => [id, offset(sel, id, t)])));
    sel.presses++;
    const order = ranked(sel);
    if (order.length === 1 || sel.logp.get(order[0]) - sel.logp.get(order[1]) >= LOG_ALPHA) return order[0];
    sel.phase = spread(sel, order); sel.ref = t + REST;
    return null;
  }

  // The player's timing, learned with damping and a delay.
  function learner() { return { w: PRIOR_WEIGHT, s1: PRIOR_WEIGHT * MU0, s2: PRIOR_WEIGHT * (SIGMA0 * SIGMA0 + MU0 * MU0), pending: [] }; }
  function model(l, adapt = true) {
    if (!adapt || !l) return DEFAULT_MODEL;
    const mean = l.s1 / l.w, v = l.s2 / l.w - mean * mean;
    return { mu: clamp(mean, MU_MIN, MU_MAX), sigma: Math.max(SIGMA0, Math.sqrt(Math.max(0, v))) };
  }
  function absorb(l, offsets) { for (const x of offsets) { l.w = LAMBDA * l.w + 1; l.s1 = LAMBDA * l.s1 + x; l.s2 = LAMBDA * l.s2 + x * x; } }
  // A choice's clicks wait in line; the one two choices back is learned.
  function remember(l, offsets) { l.pending.push(offsets); while (l.pending.length > DELAY) absorb(l, l.pending.shift()); }
  function forget(l) { l.pending.pop(); }
  // The delays a choice teaches: the chosen item's delay at each press, taken
  // round the cycle to the side nearest the model's centre and kept only
  // within a quarter cycle of it.
  function taught(sel, winner, m = DEFAULT_MODEL) {
    const out = [];
    for (const map of sel.offsets) {
      const x = map.get(winner); if (x === undefined) continue;
      const near = m.mu + wrap((x - m.mu) / sel.T) * sel.T;
      if (Math.abs(near - m.mu) <= NEAR * sel.T) out.push(Math.round(near * 100) / 100);
    }
    return out;
  }

  // A board: a few notes from the scale (ascending indices into PITCHES) and
  // a tune made of them (indices into the board's notes). The tune is rebuilt
  // note by note; a wrong note stands until it is undone.
  const period = (board, speed = 'normal') => board.period[speed];
  // The tune's own tempo when it is played: a quarter of the cycle, within 320 and 520 ms.
  const step = (board, speed = 'normal') => clamp(Math.round(period(board, speed) / 40) * 10, 320, 520);
  const pitch = (board, k) => PITCHES[board.notes[k]];
  const pan = (board, k, split = true) => split ? (k % 2 ? PAN : -PAN) : 0;
  const solved = (board, state) => !state.wrong && state.notes.length === board.melody.length;
  // What is in play: the board's notes, low to high, then the replay sound;
  // while a wrong note stands, only undo and replay; once the tune is
  // rebuilt, next and replay (replay alone on the last board).
  function contention(board, state, last) {
    if (solved(board, state)) return last ? ['replay'] : ['next', 'replay'];
    if (state.wrong) return ['undo', 'replay'];
    return board.notes.map((_, k) => k).concat('replay');
  }
  // The choice a perfect run makes next: undo while a wrong note stands,
  // otherwise the tune's next note.
  function expected(board, state) {
    if (solved(board, state)) return null;
    return state.wrong ? 'undo' : board.melody[state.notes.length];
  }
  // What choosing does: a note joins the tune, marked wrong unless it is the
  // tune's next; undo takes back the last note; replay and next leave it be.
  function choose(board, state, id) {
    const s = { notes: state.notes.slice(), wrong: state.wrong };
    if (id === 'undo') { if (s.notes.length) { s.notes.pop(); s.wrong = false; } return s; }
    if (typeof id !== 'number' || state.wrong || solved(board, state)) return s;
    s.wrong = id !== board.melody[s.notes.length]; s.notes.push(id);
    return s;
  }
  const start = () => ({ notes: [], wrong: false });

  // A perfect presser presses exactly MU0 after the wanted item sounds, with
  // the starting model. `shift` moves every press by that many ms, for
  // checking that a par holds against a near-perfect press.
  function cost(ids, want, T, shift = 0, m = DEFAULT_MODEL) {
    const sel = selection(ids, T, 0); let t = 0;
    for (let k = 0; k < MAX_PRESSES; k++) {
      t = onsetAfter(sel, want, t) + MU0 + shift;
      const winner = press(sel, t, m);
      if (winner !== null) return { presses: sel.presses, winner };
    }
    return { presses: Infinity, winner: null };
  }
  // Par: the presses a perfect presser needs to rebuild the tune, note by
  // note, each choice among the board's notes and replay.
  function solve(board, speed = 'normal', shift = 0) {
    const T = period(board, speed), ids = contention(board, start(), false), steps = [];
    let par = 0;
    for (const j of board.melody) { const c = cost(ids, j, T, shift); steps.push(c.presses); par += c.winner === j ? c.presses : Infinity; }
    return { par, steps };
  }

  return { ALPHA, LOG_ALPHA, SIGMA0, MU0, MU_MIN, MU_MAX, REST, LAMBDA, DELAY, NEAR, SPEEDS, PITCHES, PAN, DEFAULT_MODEL, wrap, mod1, logLikelihood, selection, since, offset, onsetAfter, onsetBefore, ranked, probabilities, spread, press, learner, model, absorb, remember, forget, taught, period, step, pitch, pan, solved, contention, expected, choose, start, cost, solve };
});
