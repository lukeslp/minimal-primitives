/* Sweep · row-column scanning. By Luke Steuber.
   A highlight steps down a list of rows; a press chooses the row, and the
   highlight then steps across that row's items; a press chooses the item.
   Three ways to move it, as communication devices offer:
   - auto: it steps by itself at the scan delay;
   - step: it moves only when the step switch is pressed;
   - hold: it travels at the scan delay while the switch is held, and
     letting go chooses (an inverse scan).
   Every position is a function of the time since the phase began, of the
   steps taken, or of how long the switch has been held, so a press is judged
   by the moment it went down (or came up), not by when the page got round to it. */
(function (root, make) {
  const S = make();
  if (typeof module === 'object' && module.exports) module.exports = S; else root.SweepScan = S;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Scan delay per highlight, in ms. Communication devices offer 0.2 to 10 s
  // and default to 1 s; Sweep keeps three of those.
  const SPEEDS = { slow: 1600, normal: 1000, fast: 600 };
  // In auto-scan the first highlight of every scan (the top, a resumed row,
  // the first item of a chosen row) holds half as long again: the pause
  // between levels, so the first item is not missed.
  const PAUSE = 1.5;
  // Column scanning gives up after two full passes and returns to the rows.
  const CYCLES = 2;
  const RELEASES = [0, 100, 250, 500, 1000];

  // A scan over `rows`, each a list of item ids, starting in row scanning at
  // `row` at time `t`. A `loop` scan is a single row scanned across for good
  // (the finished board's Next and Undo). `steps` counts the moves made by
  // the step switch, or before the current hold began; `hold` is when the
  // switch went down in hold mode, or null.
  // `rest`, for auto-scan, is how many full passes with no press the scan
  // makes before it stops and hides (0: never); `resting` starts it stopped.
  function start(rows, { mode = 'auto', delay = SPEEDS.normal, t = 0, row = 0, loop = false, rest = 0, resting = false } = {}) {
    const n = rows.length;
    return { mode, delay, rows: rows.map(r => r.slice()), phase: loop ? 'cols' : 'rows', row: n ? Math.max(0, Math.min(n - 1, row)) : 0, since: t, steps: 0, hold: null, loop: !!loop, rest: mode === 'auto' ? rest : 0, resting: !!resting };
  }
  const first = s => s.delay * PAUSE;
  // How many highlights have passed `e` ms into an auto-scan phase.
  const passed = (s, e) => e < first(s) ? 0 : 1 + Math.floor((e - first(s)) / s.delay);
  // Where the k-th highlight of an auto-scan phase begins, in ms after the phase began.
  const begins = (s, k) => k <= 0 ? 0 : first(s) + (k - 1) * s.delay;
  // How long auto-scan column scanning of a row of m items lasts before it gives up.
  const timeout = (s, m) => begins(s, CYCLES * m);
  // Moves made so far in this phase.
  function moves(s, t) {
    if (s.mode === 'auto') return passed(s, Math.max(0, t - s.since));
    if (s.mode === 'hold') return s.steps + (s.hold === null ? 0 : Math.floor(Math.max(0, t - s.hold) / s.delay));
    return s.steps;
  }
  // Column scanning that has run past its two passes is row scanning again,
  // resuming at the row it left; in hold mode a held switch travels on down the rows.
  function settle(s, t) {
    if (s.phase !== 'cols' || s.loop || !s.rows.length || s.mode === 'step') return s;
    const m = s.rows[s.row].length;
    if (s.mode === 'auto') { const limit = timeout(s, m); return t - s.since < limit ? s : { ...s, phase: 'rows', since: s.since + limit, steps: 0 }; }
    if (s.hold === null || moves(s, t) < CYCLES * m) return s;
    const shift = (CYCLES * m - s.steps) * s.delay;
    return { ...s, phase: 'rows', since: s.hold + shift, hold: s.hold + shift, steps: 0 };
  }
  // Rest after N passes: the moment row scanning (or a finished board's
  // loop) has made N full passes since it began, or Infinity.
  function restsAt(s) {
    if (!s.rest || s.mode !== 'auto' || (s.phase === 'cols' && !s.loop)) return Infinity;
    const n = s.phase === 'rows' ? s.rows.length : s.rows[s.row].length;
    return s.since + begins(s, s.rest * n);
  }
  const resting = (s, t) => s.resting || t >= restsAt(s);
  // The highlight at time t: in row scanning a row, in column scanning a row
  // and an item; resting, none.
  function at(s, t) {
    if (!s.rows.length) return { phase: 'none', row: -1, item: -1, id: null };
    s = settle(s, t);
    if (resting(s, t)) return { phase: 'rest', row: -1, item: -1, id: null };
    const k = moves(s, t);
    if (s.phase === 'rows') return { phase: 'rows', row: (s.row + k) % s.rows.length, item: -1, id: null };
    const items = s.rows[s.row], item = k % items.length;
    return { phase: 'cols', row: s.row, item, id: items[item] };
  }
  // Choosing what is highlighted at t: a row starts column scanning across
  // it; an item is returned for the page to act on.
  function choose(s, t) {
    const p = at(s, t);
    if (p.phase === 'rows') return { scan: { ...s, phase: 'cols', row: p.row, since: t, steps: 0, hold: null }, chosen: null, row: p.row };
    return { scan: { ...s, hold: null }, chosen: { row: p.row, item: p.item, id: p.id }, row: p.row };
  }
  // A press at time t, of the select switch (the only switch in auto-scan),
  // the step switch, or in hold mode the switch going down. Returns the scan
  // after it and what it chose, if anything.
  function press(s, t, kind = 'select') {
    if (!s.rows.length) return { scan: s, chosen: null, row: -1 };
    t = Math.max(t, s.since);
    s = settle(s, t);
    // A press to a resting scan starts it again from the top and chooses nothing.
    if (resting(s, t)) return { scan: { ...s, phase: s.loop ? 'cols' : 'rows', row: 0, since: t, steps: 0, hold: null, resting: false }, chosen: null, row: -1, woke: true };
    if (s.mode === 'hold') return { scan: s.hold === null ? { ...s, hold: t } : s, chosen: null, row: -1 };
    if (s.mode === 'step' && kind === 'step') {
      const steps = s.steps + 1;
      if (s.phase === 'cols' && !s.loop && steps >= CYCLES * s.rows[s.row].length) return { scan: { ...s, phase: 'rows', steps: 0, since: t }, chosen: null, row: s.row, gaveUp: true };
      return { scan: { ...s, steps }, chosen: null, row: -1 };
    }
    return choose(s, t);
  }
  // Hold mode: letting go at time t chooses what the travel reached.
  function release(s, t) {
    if (s.mode !== 'hold' || s.hold === null || !s.rows.length) return { scan: s, chosen: null, row: -1 };
    t = Math.max(t, s.hold);
    const before = s.phase, after = settle(s, t);
    return { ...choose(after, t), gaveUp: before === 'cols' && after.phase === 'rows' };
  }
  // A hold broken off without a release (a sheet, a lost window): the
  // highlight stays where the travel reached and nothing is chosen.
  function cancel(s, t) {
    if (s.mode !== 'hold' || s.hold === null) return s;
    s = settle(s, t);
    return { ...s, steps: moves(s, t), hold: null };
  }
  // How many moves from the highlight at t to `want` (a row in row scanning,
  // an item of the row being crossed): the steps of step-scan, or the
  // delays a hold must last.
  function distance(s, t, want) {
    const p = at(s, t), live = settle(s, t);
    if (p.phase === 'rows') return ((want.row - p.row) % live.rows.length + live.rows.length) % live.rows.length;
    if (p.phase === 'cols' && want.row === p.row) { const m = live.rows[p.row].length; return ((want.item - p.item) % m + m) % m; }
    return null;
  }
  // The next stretch of time at or after `t` in which `want` is highlighted,
  // as [from, to): a row in row scanning, or an item of the row being scanned
  // across. Auto-scan only; null if it cannot be highlighted from here.
  function when(s, t, want) {
    if (s.mode !== 'auto' || !s.rows.length) return null;
    s = settle(s, t);
    const n = s.phase === 'rows' ? s.rows.length : s.rows[s.row].length;
    const index = s.phase === 'rows' ? want.row : want.item, base = s.phase === 'rows' ? s.row : 0;
    if (s.phase === 'cols' && want.row !== s.row) return null;
    const end = Math.min(s.phase === 'cols' && !s.loop ? timeout(s, n) : Infinity, restsAt(s) - s.since);
    if (resting(s, t)) return null;
    // A row of one item stays on it until the columns give up.
    if (n === 1) return s.since + end > t ? [Math.max(s.since, t), s.since + end] : null;
    for (let k = (index - base + n) % n; begins(s, k) < end; k += n) {
      const from = s.since + begins(s, k), to = Math.min(s.since + begins(s, k + 1), s.since + end);
      if (to > t) return [Math.max(from, t), to];
    }
    return null;
  }

  // Release time: after a switch is released, its presses are refused for
  // `release` ms, and while it is held no other press on it counts, so a
  // bounce or a tremor cannot choose twice. Each switch (the one switch, or
  // step and select in step-scan) keeps its own time. With release off,
  // every new press counts. A key held down counts once.
  function gate(release = 0) { return { release, held: new Map(), last: new Map() }; }
  function down(g, key, channel, t) {
    // A press of a key already down means its release was missed: it is new.
    g.held.delete(key);
    let ok = true;
    if (g.release > 0) {
      for (const c of g.held.values()) if (c === channel) ok = false;
      if (g.last.has(channel) && t - g.last.get(channel) < g.release) ok = false;
    }
    g.held.set(key, channel);
    return ok;
  }
  function up(g, key, t) {
    if (!g.held.has(key)) return;
    const channel = g.held.get(key); g.held.delete(key);
    g.last.set(channel, Math.max(g.last.get(channel) || -Infinity, t));
  }
  function clear(g) { g.held.clear(); }

  // The board's rows that hold tiles, top to bottom, each with its tiles'
  // columns left to right: the scan's rows before the last row of controls.
  function boardRows(board) {
    const out = [];
    board.cells.forEach((row, r) => { const cells = []; [...row].forEach((ch, c) => { if (ch !== '.') cells.push(c); }); if (cells.length) out.push({ r, cells }); });
    return out;
  }
  // The perfect scanner's way through a board from here, starting in row
  // scanning at row `from`: which tiles, in which order, and how many presses.
  // Auto-scan costs two presses a tile (its row, then the tile), so the
  // smallest answer is best. Step-scan also pays one press per step: a tile's
  // place in its row, and the steps down to its row. After each choice the
  // scan resumes at the chosen row, so taking the rows in scanning order from
  // here, wrapping past the controls once, costs the steps to the farthest
  // row and no more; tiles of one row cost the same in any order.
  function plan(E, board, grid, mode = 'auto', from = 0) {
    if (E.solved(board, grid)) return { cells: [], presses: 0 };
    const s = E.solve(board, grid); if (!s.count) return null;
    const rows = boardRows(board), n = rows.length + 1, row = new Map(rows.map((x, i) => [x.r, i]));
    const fwd = r => ((row.get(r) - from) % n + n) % n, col = (r, c) => rows[row.get(r)].cells.indexOf(c);
    const cost = cells => mode === 'step' ? cells.reduce((sum, [r, c]) => sum + col(r, c) + 2, 0) + Math.max(...cells.map(([r]) => fwd(r))) : 2 * cells.length;
    let best = null;
    // Answers come smallest first, so of equal costs the smaller answer wins.
    for (const a of s.answers) { const cells = E.cellsOf(board, a), presses = cost(cells); if (!best || presses < best.presses) best = { cells, presses }; }
    best.cells.sort((p, q) => fwd(p[0]) - fwd(q[0]) || p[1] - q[1]);
    return best;
  }
  // Par: the fewest presses from a board's start, scanning from the top.
  const par = (E, board, mode = 'auto') => plan(E, board, E.start(board), mode, 0).presses;

  return { SPEEDS, PAUSE, CYCLES, RELEASES, PRESS_TIMES: [0, 100, 250, 500], LONG_PRESSES: [0, 1000, 1500, 2000], RESTS: [0, 2, 4, 8], start, restsAt, settle, at, press, release, cancel, distance, when, first, begins, timeout, gate, down, up, clear, boardRows, plan, par };
});
