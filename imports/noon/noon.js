/* Noon. By Luke Steuber. */
(function () {
  'use strict';
  const E = NoonEngine, boards = NoonBoards, $ = s => document.querySelector(s);
  const KEY = 'noon.v2', OLD_KEY = 'noon.v1', TAU = Math.PI * 2;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x), mix = (a, b, u) => a + (b - a) * u;
  const GLIDE = 240, GHOST = 600, SETTLE = 220, PULSE = 220, FINISH = 600, ZOOM = 380;
  const CHOICES = { theme: ['system', 'light', 'dark'], motion: ['system', 'reduce'], choose: ['auto', 'cell', 'line'], rewards: ['colour', 'calm'], adapt: ['on', 'off'], sound: ['off', 'on'], hold: ['off', '1000', '1500', '2000'], release: ['off', '100', '250', '500', '1000'] };
  const BLOOM = 500, WAVE = 700, RING = 1000;
  // Mandaza's palettes, as Loop uses them: board n takes palette (n - 1) mod 6,
  // less any stop too pale for light paper or too dark for black.
  const PALETTES = ['#3c096c #5a189a #9d4edd #48bfe3 #80ffdb', '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0', '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96', '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff', '#ff5e5b #ffed66 #00cecb #5c5cff', '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00'].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const luminance = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const validSpeed = s => Number.isInteger(s) && s >= 0 && s < E.STEPS.length;

  // Saved play: the board, its filled cells and their history, presses,
  // finished boards, settings and the timing learned. Every board is open.
  let board = boards[0], state = E.start(), hits = 0, finished = new Set();
  let prefs = { theme: 'system', motion: 'system', speed: E.DEFAULT_STEP, choose: 'auto', rewards: 'colour', adapt: 'on', sound: 'off', hold: '1500', release: 'off' }, learner = E.learner();
  let protectSave = false;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const validTiming = t => t && finite(t.w) && t.w > 0 && t.w <= 1000 && finite(t.s1) && finite(t.s2) && t.s2 >= 0 && Array.isArray(t.pending) && t.pending.length <= E.DELAY && t.pending.every(p => Array.isArray(p) && p.length <= 200 && p.every(x => finite(x) && Math.abs(x) <= 10000));
  const cellList = (a, b, max) => Array.isArray(a) && a.length <= max && a.every(i => Number.isInteger(i) && i >= 0 && i < b.rows * b.cols);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(x => x.id === s?.board);
      if (!b || s.v !== 2 || !cellList(s.filled, b, b.rows * b.cols) || new Set(s.filled).size !== s.filled.length || !cellList(s.history, b, 5000)) throw Error('Invalid save');
      if (!Number.isSafeInteger(s.hits) || s.hits < 0 || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id))) throw Error('Invalid save');
      // Settings added later load at their defaults: Rewards in colour, Hold to take back at 1.5 s, Release time off.
      if (s.settings) for (const [k, v] of [['rewards', 'colour'], ['hold', '1500'], ['release', 'off']]) if (s.settings[k] === undefined) s.settings[k] = v;
      // A setting this version does not know falls back to its default rather than
      // discarding the whole save (which used to stop saving progress for good).
      if (s.settings && typeof s.settings === 'object') { for (const [k, v] of Object.entries(CHOICES)) if (!v.includes(s.settings[k])) s.settings[k] = prefs[k]; if (!validSpeed(s.settings.speed)) s.settings.speed = prefs.speed; }
      if (!s.settings || typeof s.settings !== 'object' || !validTiming(s.timing)) throw Error('Invalid save');
      board = b; state = { filled: s.filled.slice().sort((x, y) => x - y), history: s.history.slice(), view: -1 }; hits = s.hits; finished = new Set(s.finished); prefs = { ...s.settings };
      learner = { w: s.timing.w, s1: s.timing.s1, s2: s.timing.s2, pending: s.timing.pending.map(p => p.slice()) };
    } else {
      // The first version's save held other puzzles; its settings and learned
      // timing carry over, and it is left as it was.
      const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
      if (old && old.settings && ['theme', 'motion', 'adapt', 'sound'].every(k => CHOICES[k].includes(old.settings[k]))) {
        prefs = { ...prefs, theme: old.settings.theme, motion: old.settings.motion, adapt: old.settings.adapt, sound: old.settings.sound, speed: { slower: 1, normal: 3, faster: 5 }[old.settings.speed] ?? E.DEFAULT_STEP };
        if (validTiming(old.timing)) learner = { w: old.timing.w, s1: old.timing.s1, s2: old.timing.s2, pending: [] };
      }
    }
  } catch (_) { protectSave = true; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 2, board: board.id, filled: state.filled, history: state.history, hits, finished: [...finished], settings: prefs, timing: learner })); } catch (_) {}
  }

  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || prefs.theme === 'system' && darkQuery.matches;
  const last = () => boards.indexOf(board) === boards.length - 1;
  const T = () => E.period(board, prefs.speed);
  // Auto chooses, on each board at each speed, whichever way has the lower par.
  const mode = () => prefs.choose === 'auto' ? (board.par.line[prefs.speed] < board.par.cell[prefs.speed] ? 'line' : 'cell') : prefs.choose;
  const par = () => board.par[mode()][prefs.speed];
  const order = () => board.order[mode()][prefs.speed];
  const solved = () => E.solved(board, state);
  const model = () => E.model(learner, prefs.adapt === 'on');
  function announce(text) { $('#announcement').textContent = text; }

  // The current selection and what is drawn around it.
  let sel = null, probs = new Map(), fade = new Map(), ghost = null, settle = null, done = null, hint = null, arrival = null, q = null, ok = [], zoom = { from: 0, to: 0, start: 0, row: -1 };
  // Rewards: a bloom where each cell was filled, and the finished picture
  // taking the board's palette. Counted for the tests.
  let blooms = [];
  const rewards = { blooms: 0, solves: 0 };
  const colourOn = () => prefs.rewards === 'colour';
  const palette = () => PALETTES[boards.indexOf(board) % PALETTES.length].filter(rgb => dark() ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  const stop = (pal, t) => { const at = clamp(t, 0, .9999) * (pal.length - 1), i = Math.floor(at), f = at - i, a = pal[i], b = pal[Math.min(pal.length - 1, i + 1)]; return `rgb(${a.map((v, c) => Math.round(v + (b[c] - v) * f)).join(',')})`; };
  function begin(t = performance.now()) {
    const ids = E.contention(board, state, mode(), last());
    sel = ids.length ? E.selection(ids, T(), t) : null;
    probs = sel ? E.probabilities(sel) : new Map();
    q = E.quiet(board, state.filled); ok = E.live(board, state.filled, q);
    if (hint !== null && !(sel && sel.ids.includes(hint))) hint = null;
  }
  // How far the view is zoomed into its row, from 0 (the board) to 1.
  function zoomAt(now) { if (reduced() || zoom.start === 0) return zoom.to; return mix(zoom.from, zoom.to, smooth((now - zoom.start) / ZOOM)); }
  function setZoom(to, t) { const now = zoomAt(t); zoom = { ...zoom, from: now, to, start: t }; }

  // Layout. The board is the grid of clocks with its row clues to the left
  // and column clues above, filling the area between the header and the
  // toolbar (less room for the next disc), at the largest cell that fits. A
  // ring takes 0.42 of its cell, up to 0.48 where that keeps it 44 px across,
  // and never more than a third of the window's short side; the numerals
  // grow with the cells. Choosing by line, each row has a clock in the margin
  // beside its clue. Zoomed into a row, its cells grow across the width with
  // their column clues above them and the out clock at the left.
  const canvas = $('#clocks'), ctx = canvas.getContext('2d');
  let layout = null, ink = '#000', paper = '#fff', dim = '#737373';
  const landscape = matchMedia('(orientation: landscape) and (max-height: 500px)');
  const clueText = clue => clue.length ? clue : [0];
  // On a narrow screen the numerals stay at 10 px so the clocks keep 44 px.
  let narrow = false;
  function measure(s, rowNums, colNums, withClocks) {
    // A row's clock is 44 px across where its row is tall enough, never wider than the row.
    const f = narrow ? 10 : clamp(.3 * s, 10, 26), k = withClocks ? Math.min(Math.max(22, Math.min(.42 * s, cap() * .9)), .48 * s) : 0;
    return { f, k, wK: withClocks ? 2 * k + .2 * s : 0, wR: rowNums * .64 * f + Math.max(0, rowNums - 1) * .45 * f + .8 * f, hC: colNums * 1.18 * f + .6 * f };
  }
  const cap = () => Math.min(innerWidth, innerHeight) / 6;
  function fit() {
    const side = landscape.matches ? 64 : 0, foot = landscape.matches ? 0 : 16;
    $('#stage').style.padding = `0 ${side}px ${foot}px`;
    const shell = $('#board-shell').getBoundingClientRect(), g = E.info(board);
    const area = { x: shell.left + side, y: shell.top, w: Math.max(1, shell.width - 2 * side), h: Math.max(1, shell.height - foot) };
    narrow = area.w < 360;
    const rowNums = Math.max(...g.rows.map(c => clueText(c).length)), colNums = Math.max(...g.cols.map(c => clueText(c).length)), line = mode() === 'line';
    let s = Math.min(area.w / g.C, area.h / g.R), m;
    for (let k = 0; k < 8; k++) { m = measure(s, rowNums, colNums, line); s = Math.min((area.w - m.wR - m.wK) / g.C, (area.h - m.hC) / g.R); }
    s = Math.min(s, cap() / .42 * 1.15); m = measure(s, rowNums, colNums, line);
    // Choosing by line, the board's cells are only shown, so on a narrow
    // screen its rows may stand taller than its columns are wide, giving each
    // row's clock 44 px where the height allows.
    let rh = s;
    if (line && m.k < 22) { rh = Math.min(Math.max(s, 22 / .48), (area.h - m.hC) / g.R); m = { ...m, k: Math.min(22, .48 * rh) }; }
    const r = Math.min(cap(), Math.max(.42 * Math.min(s, rh), Math.min(22, .48 * Math.min(s, rh)))), W = m.wK + m.wR + g.C * s, H = m.hC + g.R * rh;
    const node = $('#board'); node.style.width = W + 'px'; node.style.height = H + 'px';
    const box = node.getBoundingClientRect(), gx = box.left + m.wK + m.wR, gy = box.top + m.hC;
    const at = Array.from({ length: g.N }, (_, i) => [gx + (i % g.C + .5) * s, gy + (Math.floor(i / g.C) + .5) * rh]);
    // The zoomed row spans the whole width, its column clues above it and,
    // in a band below, the out clock with the row's clue beside it.
    let z = Math.min(area.w / g.C, area.h * .3), mz;
    for (let k = 0; k < 4; k++) { mz = measure(z, rowNums, colNums, false); z = Math.min(area.w / g.C, (area.h - mz.hC) / 2.6); }
    const zoomLimit = area.w / g.C <= (area.h - mz.hC) / 2.6 ? 'width' : 'height';
    z = Math.max(z, s); mz = measure(z, rowNums, colNums, false);
    const zr = Math.min(Math.max(cap(), r), Math.max(.42 * z, Math.min(22, .475 * z))), ok_ = Math.max(22, Math.min(.36 * z, cap() * .9)), band = Math.max(2 * ok_ + .3 * z, 1.6 * mz.f);
    const zH = mz.hC + z + band, zy = area.y + (area.h - zH) / 2, zgx = area.x + (area.w - g.C * z) / 2, zcy = zy + mz.hC + z / 2;
    const out = { x: zgx + ok_ + .1 * z, y: zcy + z / 2 + band / 2, r: ok_ }, zclue = { x: out.x + ok_ + .35 * mz.f + rowNums * .64 * mz.f + Math.max(0, rowNums - 1) * .45 * mz.f, y: out.y };
    layout = { box, area, s, rh, r, m, gx, gy, at, z, zr, mz, zgx, zcy, out, zclue, rowNums, colNums, zoomLimit };
    const dpr = Math.min(3, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function colours() { const cs = getComputedStyle(document.documentElement); ink = cs.getPropertyValue('--ink').trim() || '#000'; paper = cs.getPropertyValue('--bg').trim() || '#fff'; dim = cs.getPropertyValue('--done').trim() || '#737373'; }
  // The control clocks are drawn round the toolbar's undo button and the next disc.
  function controlAt(id) {
    const node = id === 'undo' ? $('#undo-btn') : $('#next-btn');
    if (!node || node.hidden || !node.getClientRects().length) return null;
    const b = node.getBoundingClientRect(); if (!b.width) return null;
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, R: id === 'undo' ? 21.5 : 34, t: id === 'undo' ? 4 : 3 };
  }
  // Zoomed into a row, the rest of the board stays as faint context: a little
  // stronger on black, where the same faintness reads as nothing.
  const context = () => dark() ? .09 : .055;
  // Where a clock is drawn now, with the zoom u: a cell, a row's clock, or the out clock.
  function place(id, u) {
    const L = layout, g = E.info(board), v = state.view >= 0 ? state.view : zoom.row;
    if (typeof id === 'number') {
      const [bx, by] = L.at[id], row = Math.floor(id / g.C);
      if (row !== v || !u) return { x: bx, y: by, r: L.r, a: 1 - u * (row === v ? 0 : 1 - context()) };
      return { x: mix(bx, L.zgx + (id % g.C + .5) * L.z, u), y: mix(by, L.zcy, u), r: mix(L.r, L.zr, u), a: 1 };
    }
    if (id === 'out') return { x: L.out.x, y: L.out.y, r: L.out.r, a: u };
    if (typeof id === 'string' && id[0] === 'r') { const k = Number(id.slice(1)); return { x: L.box.left + L.m.wK / 2, y: L.gy + (k + .5) * L.rh, r: L.m.k, a: 1 - u }; }
    return null;
  }

  // Drawing. A clock is a ring with a faint fixed line at noon and a hand; a
  // filled cell's clock is a solid disc with its hand in the page colour. An
  // empty cell that is empty by its line's logic, out of play, is a faint
  // ring; while choosing by line, cells on the board are still and the rows'
  // clocks turn. A met clue dims. Unlikely clocks' hands fade by lightness.
  function line(x1, y1, x2, y2, width, alpha) { ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function circle(x, y, r, width, alpha) { ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(x, y, Math.max(.1, r), 0, TAU); ctx.stroke(); }
  function disc(x, y, r, alpha) { ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, Math.max(.1, r), 0, TAU); ctx.fill(); }
  function rounded(x, y, half, rad, alpha) { ctx.globalAlpha = alpha; ctx.beginPath(); ctx.roundRect(x - half, y - half, half * 2, half * 2, Math.max(0, rad)); ctx.fill(); }
  const toward = (x, y, f, len) => { const a = f * TAU - TAU / 4; return [x + Math.cos(a) * len, y + Math.sin(a) * len]; };
  function pulseAt(id, now) {
    // On board 1 the cell's hand swells as it reaches noon, twice; a hint does the same.
    const on = (arrival && arrival.id === id && arrival.left > 0) || hint === id;
    if (!on || !sel || !sel.ids.includes(id)) return 0;
    const turn = E.turn(sel, id, now), d = Math.min(turn, 1 - turn) * sel.T;
    if (d > PULSE) return 0;
    return reduced() ? 1 : 1 - smooth(d / PULSE);
  }
  function hand(id, x, y, r, f, filled, now, age) {
    const hw = Math.max(2, r * .072), p = pulseAt(id, now);
    ctx.strokeStyle = filled ? paper : ink; ctx.fillStyle = filled ? paper : ink;
    line(x, y, x, y - r + Math.max(2.5, r * .095), Math.max(1, r * .018), .3 * f);
    if (ghost && ghost.turns.has(id) && age < GHOST) { const [gx, gy] = toward(x, y, ghost.turns.get(id), r * .78); line(x, y, gx, gy, hw * .8, .34 * (reduced() ? 1 : 1 - age / GHOST)); }
    const [hx, hy] = toward(x, y, E.turn(sel, id, now), r * (.74 + .1 * p));
    line(x, y, hx, hy, hw * (1 + 1.1 * p), f); disc(x, y, hw * .9, f);
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    if (hint === id) { const d = Math.max(4, r * .08); ctx.setLineDash([d, d]); circle(x, y, r + Math.max(5, r * .14), Math.max(1.5, r * .03), .9); ctx.setLineDash([]); }
  }
  function numerals(nums, x, y, f, alpha, vertical, colour) {
    ctx.globalAlpha = alpha; ctx.fillStyle = colour; ctx.font = `500 ${f}px "Plex Mono", ui-monospace, monospace`; ctx.textBaseline = 'middle';
    if (vertical) { ctx.textAlign = 'center'; nums.slice().reverse().forEach((n, k) => ctx.fillText(String(n), x, y - k * 1.18 * f)); }
    else { ctx.textAlign = 'right'; let at = x; nums.slice().reverse().forEach(n => { ctx.fillText(String(n), at, y); at -= .64 * f * String(n).length + .5 * f; }); }
    ctx.fillStyle = ink;
  }
  function draw(now) {
    if (!layout) return;
    ctx.setTransform(canvas.width / innerWidth, 0, 0, canvas.height / innerHeight, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round';
    const L = layout, g = E.info(board), u = zoomAt(now), live = sel ? new Set(sel.ids) : new Set(), byLine = mode() === 'line', has = new Set(state.filled), finishedNow = solved(), v = state.view >= 0 ? state.view : zoom.row;
    const top = Math.max(0, ...probs.values()), dt = draw.last ? Math.min(100, now - draw.last) : 16; draw.last = now;
    for (const id of live) {
      const goal = top ? clamp(1 + Math.log10(Math.max(1e-12, probs.get(id) / top)) / 2, .14, 1) : 1;
      const was = fade.has(id) ? fade.get(id) : 1;
      fade.set(id, reduced() ? goal : was + (goal - was) * (1 - Math.exp(-dt / 90)));
    }
    const age = ghost ? now - ghost.at : Infinity, k = finishedNow ? (done && !reduced() ? smooth((now - done.start) / FINISH) : 1) : 0;
    // Clues and cells of the board. Zoomed into a row, everything else fades
    // to context; a paper band then covers the full width behind the zoomed
    // row, its column clues and its out clock, so nothing of the board shows
    // under them, and the open row keeps a quiet mark on the faded board.
    const f = L.m.f, fz = L.mz.f, open = v >= 0 && u > 0;
    const drawCell = i => {
      const p = place(i, u), filled = has.has(i), f_ = fade.has(i) ? fade.get(i) : 1, contender = live.has(i);
      if (p.a <= .01) return;
      if (finishedNow) {
        if (filled) {
          const half = mix(p.r, Math.min(L.s, L.rh) * .5, k), rad = mix(p.r, L.s * .06, k);
          rounded(p.x, p.y, half, rad, 1);
          // The palette arrives in a wave from the last cell filled, or, with
          // reduced motion, fades in all at once.
          if (colourOn() && done) {
            const d = Math.hypot(p.x - done.x, p.y - done.y), t = reduced() ? smooth((now - done.start) / 600) : smooth((now - done.start - WAVE * d / done.far) / 300);
            if (t > 0) { ctx.fillStyle = stop(done.pal, d / done.far); rounded(p.x, p.y, half, rad, t); ctx.fillStyle = ink; }
          }
        }
        else if (k < 1) circle(p.x, p.y, p.r - 1, 1, .25 * (1 - k));
        return;
      }
      const s_ = settle && settle.id === i && !reduced() ? smooth((now - settle.start) / SETTLE) : 1;
      if (filled) disc(p.x, p.y, p.r * (.35 + .65 * s_), p.a);
      // Reduced motion: a filled cell's bloom is a short fade of colour on the cell itself.
      if (filled && reduced() && colourOn()) { const b = blooms.find(x => x.id === i); if (b && now - b.start < 200) { ctx.fillStyle = b.colours[0]; disc(p.x, p.y, p.r, p.a * (1 - (now - b.start) / 200)); ctx.fillStyle = ink; } }
      if (contender) { if (!filled) circle(p.x, p.y, p.r - Math.max(2.5, p.r * .095) / 2, Math.max(2.5, p.r * .095), p.a * (.35 + .65 * f_)); hand(i, p.x, p.y, p.r, f_ * p.a, filled, now, age); }
      else if (!filled) circle(p.x, p.y, p.r - Math.max(1.25, p.r * .024) / 2, Math.max(1.25, p.r * .024), p.a * (ok[i] ? .45 : .2));
    };
    g.rows.forEach((clue, r) => { if (!(r === v && u > 0)) numerals(clueText(clue), L.gx - .55 * f, L.gy + (r + .5) * L.rh, f, 1 - u * (1 - context()), false, q.rows[r] ? dim : ink); });
    for (let i = 0; i < g.N; i++) if (Math.floor(i / g.C) !== v || !u) drawCell(i);
    // Choosing by line: the rows' clocks on the board, the out clock when zoomed.
    if (byLine && !finishedNow) for (let r = 0; r < g.R; r++) {
      const id = 'r' + r, p = place(id, u); if (p.a <= .01) continue;
      if (live.has(id)) { circle(p.x, p.y, p.r - 1.5, 2.5, p.a * (.35 + .65 * (fade.get(id) ?? 1))); hand(id, p.x, p.y, p.r, (fade.get(id) ?? 1) * p.a, false, now, age); }
      else circle(p.x, p.y, p.r - 1, 1.25, .2 * p.a);
    }
    if (open) {
      // The open row's place on the faded board: hairline brackets at its ends and its clue in ink.
      const y0 = L.gy + v * L.rh + .08 * L.rh, y1 = L.gy + (v + 1) * L.rh - .08 * L.rh, xl = L.gx - .06 * L.s, xr = L.gx + g.C * L.s + .06 * L.s, tick = .16 * L.s;
      ctx.lineCap = 'butt';
      for (const [x, d] of [[xl, 1], [xr, -1]]) { line(x + d * tick, y0, x, y0, 1, .6 * u); line(x, y0, x, y1, 1, .6 * u); line(x, y1, x + d * tick, y1, 1, .6 * u); }
      ctx.lineCap = 'round';
      numerals(clueText(g.rows[v]), L.gx - .55 * f, L.gy + (v + .5) * L.rh, f, .6 * u, false, ink);
      // The band: paper across the full width, edged by hairlines.
      const pad = Math.max(8, .15 * L.z), top = L.zcy - L.z / 2 - L.mz.hC - pad, bottom = L.out.y + L.out.r + pad;
      ctx.globalAlpha = u; ctx.fillStyle = paper; ctx.fillRect(0, top, innerWidth, bottom - top); ctx.fillStyle = ink;
      line(0, top + .5, innerWidth, top + .5, 1, .16 * u); line(0, bottom - .5, innerWidth, bottom - .5, 1, .16 * u);
    }
    g.cols.forEach((clue, c) => {
      const x = mix(L.gx + (c + .5) * L.s, L.zgx + (c + .5) * L.z, u), y = mix(L.gy - .55 * f, L.zcy - L.z / 2 - .55 * fz, u);
      numerals(clueText(clue), x, y, mix(f, fz, u), 1, true, q.cols[c] ? dim : ink);
    });
    if (v >= 0 && u > 0) {
      numerals(clueText(g.rows[v]), mix(L.gx - .55 * f, L.zclue.x, u), mix(L.gy + (v + .5) * L.rh, L.zclue.y, u), mix(f, fz, u), 1, false, q.rows[v] ? dim : ink);
      for (let i = v * g.C; i < (v + 1) * g.C; i++) drawCell(i);
    }
    if (byLine && !finishedNow) {
      if (live.has('out') || u > 0) {
        const p = place('out', u);
        if (p.a > .01) {
          const f_ = fade.get('out') ?? 1, d = p.r * .26;
          circle(p.x, p.y, p.r - 1.5, 2.5, p.a * (.35 + .65 * f_));
          // The board in small: four squares inside the out clock's face.
          for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.globalAlpha = .22 * p.a; ctx.fillRect(p.x + dx * d * .55 - d * .4, p.y + dy * d * .55 - d * .4, d * .8, d * .8); }
          if (live.has('out')) hand('out', p.x, p.y, p.r, f_ * p.a, false, now, age);
        }
      }
    }
    // Blooms: soft dots in the board's palette spread half a cell from a
    // filled cell and fade; a fill that meets a clue blooms fuller. The
    // finished picture sends one ring out from its last cell.
    if (colourOn() && !reduced()) {
      blooms = blooms.filter(b => now - b.start < BLOOM);
      for (const b of blooms) {
        const t = (now - b.start) / BLOOM, e = 1 - (1 - t) ** 3, n = b.full ? 10 : 7, p = place(b.id, u), reach = (b.full ? .75 : .55) * L.s;
        for (let j = 0; j < n; j++) { const a = j / n * TAU + b.turn; ctx.fillStyle = b.colours[j % b.colours.length]; disc(p.x + Math.cos(a) * reach * e, p.y + Math.sin(a) * reach * e, L.s * (b.full ? .09 : .07) * (1 - .5 * t), (1 - t) * .9); }
      }
      if (finishedNow && done && now - done.start < RING) { const t = (now - done.start) / RING; ctx.strokeStyle = done.pal[0] ? stop(done.pal, .2) : ink; circle(done.x, done.y, done.far * 1.15 * (1 - (1 - t) ** 2), Math.max(2, L.s * .06), .6 * (1 - t)); }
      ctx.fillStyle = ink; ctx.strokeStyle = ink;
    }
    // The control clocks: a ring round the button with a tick at noon and a
    // tick that runs round it as the hand.
    for (const id of ['undo', 'next']) {
      if (!live.has(id)) continue;
      const c = controlAt(id); if (!c) continue;
      const f_ = fade.has(id) ? fade.get(id) : 1, turn = E.turn(sel, id, now), p = pulseAt(id, now);
      // Next's ring stays within 37 px of its disc's centre, so it clears the board wherever the frame puts the disc.
      circle(c.x, c.y, c.R, 1, .2 + .3 * f_);
      line(c.x, c.y - c.R - c.t, c.x, c.y - c.R + c.t, 1.25, .5 * f_);
      const [ax, ay] = toward(c.x, c.y, turn, c.R - c.t - 1 - p), [bx, by] = toward(c.x, c.y, turn, c.R + c.t + (c.t === 4 ? 1 : 0) + p * (c.t === 4 ? 1 : 0));
      line(ax, ay, bx, by, 2.5 * (1 + .6 * p), f_);
      if (ghost && ghost.turns.has(id) && age < GHOST) { const [gx, gy] = toward(c.x, c.y, ghost.turns.get(id), c.R - 5), [hx, hy] = toward(c.x, c.y, ghost.turns.get(id), c.R + 5); line(gx, gy, hx, hy, 2, .34 * (reduced() ? 1 : 1 - age / GHOST)); }
      if (hint === id) { ctx.setLineDash([4, 4]); circle(c.x, c.y, c.R + 7, 1.5, .9); ctx.setLineDash([]); }
    }
    // The hold ring: an ink arc filling clockwise from noon round what the
    // hold would take back, only while a hold builds and the setting is on,
    // and only once the hold has lasted RING_AFTER, so an ordinary press never
    // shows it; with reduced motion it fills in quarter steps.
    recovery.ring = null;
    if (hold && !hold.fired && prefs.hold !== 'off') {
      checkHold(now);
      const p = hold && !hold.fired && now - hold.start >= RING_AFTER ? holdFocus() : null;
      if (p) {
        let k_ = clamp((now - hold.start - RING_AFTER) / (hold.ms - RING_AFTER), 0, 1); if (reduced()) k_ = Math.floor(k_ * 4) / 4;
        const R = (p.r || p.R) + Math.max(5, (p.r || p.R) * .16);
        ctx.lineCap = 'butt'; circle(p.x, p.y, R, 1, .2);
        if (k_ > 0) { ctx.globalAlpha = .9; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, R, -TAU / 4, -TAU / 4 + TAU * k_); ctx.stroke(); }
        ctx.lineCap = 'round'; recovery.ring = k_;
      }
    }
    ctx.globalAlpha = 1;
    if (arrival && arrival.left > 0 && sel && sel.ids.includes(arrival.id) && now > arrival.until) { arrival.left--; arrival.until = E.noonAfter(sel, arrival.id, now + PULSE + 1) + PULSE; }
  }
  function frame(now) { draw(now); requestAnimationFrame(frame); }

  // Sound, off unless chosen, made in the page: a soft tick for a press, a
  // pitched tick for each fill (rising with the cells filled), a quieter one
  // for an emptying, and a short rising chord when the picture is finished.
  // No audio context exists until Sound is turned on.
  let audio = null;
  function tone(f0, f1, at, length, level) {
    const o = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + at;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + length);
    gain.gain.setValueAtTime(level, t); gain.gain.exponentialRampToValueAtTime(.0001, t + length);
    o.connect(gain).connect(audio.destination); o.start(t); o.stop(t + length + .02);
  }
  function sound(kind) {
    if (prefs.sound !== 'on') return;
    try {
      audio = audio || new AudioContext(); if (audio.state === 'suspended') audio.resume();
      const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      if (kind === 'press') tone(1500, 1500, 0, .04, .03);
      else if (kind === 'fill') { const f = scale[state.filled.length % scale.length]; tone(f, f * 1.01, 0, .12, .045); }
      else if (kind === 'empty') tone(440, 392, 0, .1, .035);
      else if (kind === 'solve') [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(f, f, k * .08, .32, .04));
    } catch (_) {}
  }

  // A press: one switch event at its own time stamp. It counts while the
  // picture is unfinished; once finished, presses only choose next or undo.
  function press(t) {
    if (!sel || $('dialog[open]')) return null;
    const did = { winner: null, presses: sel.presses, view: state.view, undone: state.history[state.history.length - 1] };
    if (!solved()) hits++;
    ghost = { at: t, turns: new Map(sel.ids.map(id => [id, E.turn(sel, id, t)])) };
    if (arrival) arrival.left = 0;
    sound('press');
    const winner = E.press(sel, t, model(), reduced() ? 0 : GLIDE);
    probs = E.probabilities(sel);
    if (winner === null) { chrome(); save(); return did; }
    if (prefs.adapt === 'on') { if (winner === 'undo') E.forget(learner); else E.remember(learner, E.taught(sel, winner)); }
    did.winner = winner; did.leader = winner;
    take(winner, t);
    return did;
  }

  // Recovery. Hold to take back (1.5 s unless changed in Settings): a press held
  // past the chosen time takes back what it did, once, however long it is
  // held. A press that completed a choice has that choice taken back (a fill
  // or emptying, an undo, a zoom in or out); otherwise the choice in progress
  // starts again, at even odds with its phases spread anew and its presses
  // forgotten by the scorer (the readout still counts them); and a first
  // press toward a new choice with a row open steps out to the board. The
  // press itself acts at press-down exactly as without the setting. Release
  // time: a press that comes sooner than the chosen time after a release is
  // refused, so a bounce or tremor is not a second press.
  let hold = null, lastRelease = -Infinity;
  const recovery = { fired: 0, refused: 0, ring: null }, RING_AFTER = 400;
  // The hold is timed from when the press is handled, a few milliseconds
  // after its time stamp, so a late or replayed time stamp can't shorten it.
  function startHold(key, t, did) {
    if (prefs.hold === 'off' || !did) return;
    const ms = Number(prefs.hold);
    hold = { key, start: performance.now(), ms, did, fired: false };
    const mine = hold; setTimeout(() => { if (hold === mine) checkHold(performance.now()); }, ms + 30);
  }
  function endHold(key) { if (hold && (key === undefined || hold.key === key)) hold = null; }
  function checkHold(now) { if (hold && !hold.fired && now - hold.start >= hold.ms) { hold.fired = true; recovery.fired++; takeBack(hold.did, now); } }
  function takeBack(did, now) {
    if ($('dialog[open]')) return;
    const w = did.winner, g = E.info(board), was = solved();
    let said;
    // The timing a taken-back choice taught is forgotten before it is learned, as Undo's is.
    if (w !== null && w !== 'undo' && prefs.adapt === 'on') E.forget(learner);
    if (Number.isInteger(w)) {
      if (state.history[state.history.length - 1] === w) state = E.choose(board, state, 'undo');
      said = `${state.filled.includes(w) ? 'Emptying' : 'Fill'} taken back: row ${Math.floor(w / g.C) + 1}, column ${w % g.C + 1}.`;
    } else if (w === 'undo') {
      if (Number.isInteger(did.undone)) state = E.choose(board, state, did.undone);
      said = 'Undo taken back.';
    } else if (typeof w === 'string' && w[0] === 'r') {
      state = E.choose(board, state, 'out'); setZoom(0, now); said = 'Back to the board.';
    } else if (w === 'out' && did.view >= 0) {
      state = E.choose(board, state, 'r' + did.view); zoom.row = did.view; setZoom(1, now); said = `Row ${did.view + 1} again.`;
    } else if (w === null && did.presses === 0 && state.view >= 0) {
      state = E.choose(board, state, 'out'); setZoom(0, now); said = 'Back to the board.';
    } else said = 'Choice started again.';
    if (was && !solved()) done = null;
    settle = null; hint = null; fade = new Map(); begin(now); chrome(); save();
    announce(said);
  }
  // Where the hold ring is drawn: round what the hold would take back.
  function holdFocus() {
    const d = hold.did, w = d.winner;
    if (Number.isInteger(w)) return place(w, zoomAt(performance.now()));
    if (w === 'undo') return Number.isInteger(d.undone) ? place(d.undone, zoomAt(performance.now())) : null;
    if (typeof w === 'string' && w[0] === 'r') return place('out', 1);
    if (w === 'out') return d.view >= 0 ? place('r' + d.view, 0) : null;
    if (w === 'next') return null;
    if (d.presses === 0 && state.view >= 0) return place('out', 1);
    const lead = sel && E.ranked(sel)[0];
    return lead === undefined ? null : lead === 'undo' || lead === 'next' ? controlAt(lead) : place(lead, zoomAt(performance.now()));
  }
  // What a choice does: next opens the next board; a row's clock zooms into
  // it and out zooms back; undo takes back the last fill or emptying; a cell's
  // clock fills or empties it.
  function take(id, t) {
    if (id === 'next') { const n = boards[boards.indexOf(board) + 1]; if (n) go(n.id); return; }
    const before = state, wasQuiet = q;
    state = E.choose(board, state, id);
    if (typeof id === 'string' && id[0] === 'r') { zoom.row = state.view; setZoom(1, t); }
    else if (state.view < 0 && before.view >= 0) setZoom(0, t);
    const g = E.info(board), cellOf = i => `row ${Math.floor(i / g.C) + 1}, column ${i % g.C + 1}`;
    settle = Number.isInteger(id) && state.filled.includes(id) ? { id, start: t } : null;
    if (hint === id) hint = null;
    const nowSolved = solved();
    fade = new Map(); begin(t);
    if (settle) {
      const met = q.rows.some((v, r) => v && !wasQuiet.rows[r]) || q.cols.some((v, c) => v && !wasQuiet.cols[c]), pal = palette();
      blooms.push({ id, start: t, full: met, turn: (id * 1.7) % TAU, colours: pal.length ? [0, 1, 2, 3, 4].map(k => stop(pal, (k * .23 + id * .07) % 1)) : [ink] }); rewards.blooms++;
    }
    if (nowSolved) {
      finished.add(board.id); rewards.solves++;
      const from = place(Number.isInteger(id) ? id : state.filled[state.filled.length - 1], 0), far = Math.max(1, ...state.filled.map(i => { const p = place(i, 0); return Math.hypot(p.x - from.x, p.y - from.y); }));
      done = { start: t, x: from.x, y: from.y, far, pal: palette() };
    } else done = null;
    chrome(); save();
    if (nowSolved) { announce(`Picture finished in ${hits} presses. Par ${par()}. ${last() ? 'Every board is finished.' : 'Next board is available.'}`); sound('solve'); return; }
    if (id === 'out') { announce('Back to the board.'); return; }
    if (typeof id === 'string' && id[0] === 'r') { announce(`Row ${state.view + 1}: ${clueText(g.rows[state.view]).join(' ')}.`); return; }
    const changed = id === 'undo' ? before.history[before.history.length - 1] : id;
    if (changed === undefined) return;
    const met = [];
    q.rows.forEach((v, r) => { if (v && !wasQuiet.rows[r]) met.push(`row ${r + 1}`); }); q.cols.forEach((v, c) => { if (v && !wasQuiet.cols[c]) met.push(`column ${c + 1}`); });
    announce(`${id === 'undo' ? 'Undone: ' : ''}${state.filled.includes(changed) ? 'filled' : 'emptied'} ${cellOf(changed)}.${met.length ? ' ' + met.join(' and ') + ' ' + (met.length > 1 ? 'match their clues' : 'matches its clue') + '.' : ''}`);
    sound(state.filled.includes(changed) ? 'fill' : 'empty');
  }

  // Pointer chrome: undo is one press; hint marks the next choice of a
  // perfect run, then takes it for the presses a perfect presser needs.
  function undoButton() {
    if (!state.history.length) return;
    if (!solved()) hits++;
    if (prefs.adapt === 'on') E.forget(learner);
    hint = null; take('undo', performance.now());
  }
  function hintButton() {
    if (solved() || !sel) return;
    if (hint !== null && sel.ids.includes(hint)) {
      const id = hint, presses = E.cost(sel.ids, id, sel.T).presses;
      hits += presses; hint = null;
      if (prefs.adapt === 'on') E.remember(learner, []);
      take(id, performance.now()); return;
    }
    hint = E.next(board, state, mode(), order()); if (!sel.ids.includes(hint)) { hint = null; return; }
    announce(typeof hint === 'number' ? 'Hint: the marked cell. Press Hint again to take it.' : hint === 'out' ? 'Hint: back to the board. Press Hint again to take it.' : 'Hint: the marked row. Press Hint again to take it.');
    chrome();
  }

  // Speed: seven steps, shown by the readout's meter; a change applies at
  // once and starts the current choice afresh.
  const meter = (n, cls) => `<svg class="${cls}" viewBox="0 0 34 14" aria-hidden="true">${E.STEPS.map((_, i) => `<rect x="${i * 5}" y="${12 - 1.5 * i}" width="3" height="${2 + 1.5 * i}" class="${i <= n ? 'on' : 'off'}"/>`).join('')}</svg>`;
  let flashTimer = 0;
  function setSpeed(n, flash) {
    n = clamp(n, 0, E.STEPS.length - 1);
    if (n !== prefs.speed) {
      const before = mode();
      prefs.speed = n; $('#speed').value = String(n);
      if (mode() !== before) { state = { ...state, view: -1 }; zoom = { from: 0, to: 0, start: 0, row: -1 }; }
      begin(); fade = new Map(); fit(); chrome(); save();
      announce(`Speed ${n + 1} of ${E.STEPS.length}, ${(E.STEPS[n] / 1000).toFixed(1)} seconds a turn. Par ${par()}.`);
    }
    if (flash) showFlash();
  }
  function showFlash() {
    const node = $('#speed-flash'); node.innerHTML = meter(prefs.speed, 'big'); node.hidden = false;
    node.classList.remove('flash'); void node.offsetWidth; if (!reduced()) node.classList.add('flash');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => { node.hidden = true; }, 900);
  }

  function chrome() {
    const n = boards.indexOf(board) + 1, finishedNow = solved(), g = E.info(board);
    $('#readout-text').textContent = `${n} / ${boards.length} · ${hits} / ${par()}`;
    $('#speed-glyph').innerHTML = meter(prefs.speed, 'small');
    $('#readout').setAttribute('aria-label', `Board ${n} of ${boards.length}; ${hits} presses; par ${par()}; speed ${prefs.speed + 1} of ${E.STEPS.length}`);
    const clues = (list, word) => list.map((c, k) => `${word} ${k + 1}: ${clueText(c).join(' ')}`).join('; ');
    $('#board').setAttribute('aria-label', `Board ${n} of ${boards.length}: ${g.R} rows by ${g.C} columns, ${state.filled.length} cells filled. ${clues(g.rows, 'row')}. ${clues(g.cols, 'column')}. ${finishedNow ? 'Picture finished.' : state.view >= 0 ? `Zoomed into row ${state.view + 1}.` : 'Press any key or tap as a clock\'s hand reaches the top.'}`);
    $('#speed').setAttribute('aria-valuetext', `${prefs.speed + 1} of ${E.STEPS.length}, ${(E.STEPS[prefs.speed] / 1000).toFixed(1)} seconds a turn`);
    $('#undo-btn').disabled = state.history.length === 0;
    $('#hint-btn').disabled = finishedNow;
    $('#next-btn').hidden = !finishedNow || last();
    catalog();
  }
  // Settings lists every board as current, completed or available.
  function catalog() {
    const list = $('#board-catalog');
    if (!list.children.length) boards.forEach((b, i) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'board'; button.dataset.board = b.id;
      button.innerHTML = `<span>Board ${i + 1}</span><span class="catalog-state"></span>`;
      button.addEventListener('click', () => { if (b !== board) go(b.id); $('#settings').close(); });
      item.append(button); list.append(item);
    });
    boards.forEach((b, i) => {
      const button = list.children[i].firstChild, here = b === board, complete = finished.has(b.id);
      button.dataset.state = here ? 'current' : complete ? 'completed' : 'available';
      button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, complete ? 'Completed' : null, !here && !complete ? 'Available' : null].filter(Boolean).join(' · ');
      if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }

  function arrive(t) { const first = sel && sel.ids.find(id => typeof id === 'number'); arrival = board.teach === 'arrival' && first !== undefined ? { id: first, left: 2, until: E.noonAfter(sel, first, t) + PULSE } : null; }
  function reset(t = performance.now()) {
    state = E.start(); hits = 0; hint = null; ghost = null; settle = null; done = null; blooms = []; fade = new Map(); zoom = { from: 0, to: 0, start: 0, row: -1 };
    begin(t); arrive(t);
  }
  function restart() { reset(); fit(); chrome(); save(); announce('Board restarted.'); }
  // Any board can be opened, from Settings or from the test hook.
  function go(id) {
    const i = boards.findIndex(b => b.id === id);
    if (i < 0) return false;
    board = boards[i]; reset(); fit(); chrome(); save();
    const g = E.info(board);
    announce(`Board ${i + 1}: ${g.R} rows by ${g.C} columns.`);
    return true;
  }

  // One switch. Any key, a tap anywhere or a click anywhere is a press, at
  // the moment it went down; a held key or finger counts once. The toolbar,
  // restart and next buttons and the sheets keep their own pointer roles, a
  // button reached by Tab keeps Enter and Space, and [ and ] (or - and +)
  // set the speed.
  const held = new Set(), switchKeys = new Set();
  let lastInput = 'pointer';
  const passKeys = new Set(['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu', 'OS', 'Fn', 'FnLock', 'Hyper', 'Super', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified']);
  const speedKeys = { '[': -1, '-': -1, '_': -1, ']': 1, '=': 1, '+': 1 };
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab') lastInput = 'keyboard';
    if ($('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || passKeys.has(e.key) || /^F\d+$/.test(e.key)) return;
    if (e.target.closest && e.target.closest('select,input,textarea,dialog')) return;
    if (e.key in speedKeys) { e.preventDefault(); if (!e.repeat) setSpeed(prefs.speed + speedKeys[e.key], true); return; }
    if (e.target.matches && e.target.matches('button') && (e.key === 'Enter' || e.key === ' ') && lastInput === 'keyboard') return;
    e.preventDefault();
    const code = e.code || e.key;
    if (e.repeat || held.has(code)) return;
    held.add(code); switchKeys.add(code);
    if (refuse(e.timeStamp)) return;
    startHold('k' + code, e.timeStamp, press(e.timeStamp));
  });
  document.addEventListener('keyup', e => { const code = e.code || e.key; held.delete(code); if (switchKeys.delete(code)) { e.preventDefault(); lastRelease = e.timeStamp; endHold('k' + code); } });
  const refuse = t => { if (prefs.release === 'off' || t - lastRelease >= Number(prefs.release)) return false; recovery.refused++; return true; };
  const switchPointers = new Set();
  const letGo = e => { if (switchPointers.delete(e.pointerId)) { lastRelease = e.timeStamp; endHold('p' + e.pointerId); } };
  document.addEventListener('pointerup', letGo); document.addEventListener('pointercancel', letGo);
  const chromeTarget = t => t.closest && t.closest('button,select,a,label,dialog,input,textarea');
  document.addEventListener('pointerdown', e => {
    lastInput = 'pointer';
    if (chromeTarget(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    switchPointers.add(e.pointerId);
    if (refuse(e.timeStamp)) return;
    startHold('p' + e.pointerId, e.timeStamp, press(e.timeStamp));
  });
  for (const name of ['contextmenu', 'dragstart', 'selectstart']) document.addEventListener(name, e => { if (!chromeTarget(e.target) || name !== 'contextmenu') e.preventDefault(); });
  // A hidden page or a lost window cancels a hold in progress.
  window.addEventListener('blur', () => { held.clear(); endHold(); });
  document.addEventListener('visibilitychange', () => { held.clear(); endHold(); });

  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, d] of Object.entries(icons)) $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  // After a pointer uses a button, the play surface takes focus back, so the
  // next Space or Enter is a press and not that button again.
  const handBack = e => { if (e.detail > 0 || lastInput === 'pointer') $('#board').focus({ preventScroll: true }); };
  $('#undo-btn').addEventListener('click', e => { undoButton(); handBack(e); });
  $('#hint-btn').addEventListener('click', e => { hintButton(); handBack(e); });
  $('#restart-btn').addEventListener('click', e => { restart(); handBack(e); });
  $('#next-btn').addEventListener('click', e => { const n = boards[boards.indexOf(board) + 1]; if (n && solved()) go(n.id); handBack(e); });
  const openedBy = {};
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => { openedBy[id] = lastInput; held.clear(); $('#' + id).showModal(); });
    // The browser gives focus back to the opener as a sheet closes; after a
    // mouse or touch open, the play surface takes it on the next task.
    $('#' + id).addEventListener('close', () => setTimeout(() => { if (openedBy[id] === 'keyboard') $('#' + id + '-btn').focus(); else $('#board').focus({ preventScroll: true }); }, 0));
  }
  function applyPrefs() {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme; root.dataset.motion = prefs.motion;
    for (const k of Object.keys(CHOICES)) $('#' + k).value = prefs[k];
    $('#speed').value = String(prefs.speed);
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    colours();
  }
  for (const k of Object.keys(CHOICES)) $('#' + k).addEventListener('change', e => {
    const before = mode();
    prefs[k] = e.target.value; applyPrefs();
    // A new way of choosing starts the current choice afresh, on the board.
    if (k === 'choose' && mode() !== before) { state = { ...state, view: -1 }; zoom = { from: 0, to: 0, start: 0, row: -1 }; begin(); fade = new Map(); fit(); }
    chrome(); save();
    announce({ theme: 'Theme changed.', motion: 'Motion setting changed.', rewards: colourOn() ? 'Colour rewards.' : 'Calm: paper and ink only.', choose: `Choosing by ${mode()}${prefs.choose === 'auto' ? ', chosen for this board and speed' : ''}. Par ${par()}.`, adapt: prefs.adapt === 'on' ? 'Adapting to your timing.' : 'Using the starting timing.', sound: prefs.sound === 'on' ? 'Sound on.' : 'Sound off.', hold: prefs.hold === 'off' ? 'Hold to take back off.' : `Hold ${Number(prefs.hold) / 1000} seconds to take back a step.`, release: prefs.release === 'off' ? 'Release time off.' : `Presses within ${Number(prefs.release) / 1000} seconds of a release are ignored.` }[k]);
  });
  $('#speed').addEventListener('input', e => setSpeed(Number(e.target.value), false));
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', fit);

  window.__noon = {
    boards,
    get board() { return board.id; },
    get reached() { return boards.length - 1; },
    get state() {
      return { filled: state.filled.slice(), history: state.history.length, view: state.view, zoom: zoomAt(performance.now()), mode: mode(), choose: prefs.choose, hits, par: par(), solved: solved(), quiet: { rows: q.rows.slice(), cols: q.cols.slice() }, contention: sel ? sel.ids.slice() : [], period: T(), speed: prefs.speed, presses: sel ? sel.presses : 0, model: model(), learner: { w: learner.w, s1: learner.s1, s2: learner.s2, pending: learner.pending.length }, hint, gliding: !!(sel && sel.glide && performance.now() < sel.glide.end), arrival: arrival ? arrival.left : 0 };
    },
    // The next settled noon of a clock in the current selection, in page time.
    noonOf(id) { if (!sel || !sel.ids.includes(id)) return null; const now = performance.now(); return E.noonAfter(sel, id, Math.max(now, sel.glide ? sel.glide.end : 0)); },
    turn(id) { return sel && sel.ids.includes(id) ? E.turn(sel, id, performance.now()) : null; },
    pulse(id) { return pulseAt(id, performance.now()); },
    probabilities() { return Object.fromEntries(probs); },
    layout() { const { area, r, s, z, zr, m, mz, out, zoomLimit } = layout; return { area, cap: cap(), r, s, z, zr, rowClock: m.k, out: out.r, font: m.f, zoomFont: mz.f, zoomLimit }; },
    // Where a clock stands now, in viewport pixels.
    where(id) { if (id === 'undo' || id === 'next') return controlAt(id); const p = place(id, zoomAt(performance.now())); return p ? { x: p.x, y: p.y, r: p.r, alpha: p.a } : null; },
    rewards() { return { ...rewards, active: blooms.length, audio: !!audio, colour: colourOn() }; },
    recovery() { return { hold: prefs.hold, release: prefs.release, holding: hold && !hold.fired ? clamp((performance.now() - hold.start) / hold.ms, 0, 1) : null, fired: recovery.fired, refused: recovery.refused, ring: recovery.ring }; },
    phases() { return sel ? Object.fromEntries(sel.ids.map(id => [id, sel.phase.get(id)])) : {}; },
    clues() { const L = layout, g = E.info(board); return { rows: g.rows.map((c, r) => ({ clue: clueText(c), x: L.gx - .55 * L.m.f, y: L.gy + (r + .5) * L.rh, quiet: q.rows[r] })), cols: g.cols.map((c, k) => ({ clue: clueText(c), x: L.gx + (k + .5) * L.s, y: L.gy - .55 * L.m.f, quiet: q.cols[k] })), font: L.m.f }; },
    go: id => go(id), restart, undo: undoButton, hint: hintButton, next: () => E.next(board, state, mode(), order()), speed: n => setSpeed(n, true)
  };
  window.__minimalize = { bounds() {
    const L = layout; return { x: L.box.left, y: L.box.top, width: L.box.width, height: L.box.height };
  } };

  // Play saved mid-board resumes its cells and presses with a fresh choice.
  applyPrefs(); fit(); begin();
  if (!state.history.length && !hits) arrive(performance.now());
  chrome(); save();
  if (document.fonts && document.fonts.load) document.fonts.load('500 16px "Plex Mono"').catch(() => {});
  requestAnimationFrame(frame);
})();
