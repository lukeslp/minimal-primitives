/* Glance. By Luke Steuber. */
(function () {
  'use strict';
  const E = GlanceEngine, boards = GlanceBoards, G = GlanceGaze, T = GlanceTrack, P = GlancePayoff;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = 'glance.v1';
  const boardNode = $('#board'), layer = $('#gaze-layer');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = G.clamp, copy = E.copy, smooth = x => x * x * (3 - 2 * x);
  const INPUTS = ['head', 'eyes', 'pointer'], SELECTS = ['dwell', 'tap'], HOLDS = [600, 800, 1000, 1400];
  let board = boards[0], grid = E.start(board), hits = 0, history = [], finished = new Set();
  const REWARDS = ['colour', 'calm'], SOUNDS = ['off', 'on'];
  let prefs = { theme: 'system', motion: 'system', input: 'head', select: 'tap', dwell: 800, rewards: 'colour', sound: 'off' };
  let calibration = { head: null, eyes: null }, lastCamera = 'head', protectSave = false, saved = null;
  const validGrid = (g, b) => Array.isArray(g) && g.length === b.cells.length && g.every((row, r) => Array.isArray(row) && row.length === b.cells[r].length && row.every((v, c) => b.cells[r][c] === '.' ? v === null : v === 0 || v === 1));
  const validHits = n => Number.isSafeInteger(n) && n >= 0;
  const validSettings = s => !!s && ['system', 'light', 'dark'].includes(s.theme) && ['system', 'reduce'].includes(s.motion) && INPUTS.includes(s.input) && SELECTS.includes(s.select) && HOLDS.includes(s.dwell) && (s.rewards === undefined || REWARDS.includes(s.rewards)) && (s.sound === undefined || SOUNDS.includes(s.sound));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(b => b.id === s?.board);
      if (!b || !validGrid(s.grid, b) || !validHits(s.hits) || !Array.isArray(s.history) || s.history.length > 10000 || !s.history.every(h => h && validGrid(h.grid, b) && validHits(h.hits)) || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id)) || !validSettings(s.settings)) throw Error('Invalid save');
      if (s.campaign !== 1 || !Number.isInteger(s.reached) || s.reached < 0 || s.reached >= boards.length || !['head', 'eyes'].includes(s.lastCamera)) throw Error('Invalid save');
      // A calibration that does not read is dropped on its own (it is asked for
      // again); it used to discard the whole save, boards and all.
      if (!s.calibration || typeof s.calibration !== 'object') s.calibration = { head: null, eyes: null };
      for (const k of ['head', 'eyes']) if (!(s.calibration[k] === null || (G.validCalibration(s.calibration[k]) && s.calibration[k].kind === k))) s.calibration[k] = null;
      board = b; grid = copy(s.grid); hits = s.hits; history = s.history; finished = new Set(s.finished); prefs = { rewards: 'colour', sound: 'off', ...s.settings }; calibration = { head: s.calibration.head, eyes: s.calibration.eyes }; lastCamera = s.lastCamera; saved = s;
    }
  } catch (_) { protectSave = true; }
  // Every board is open from the start; a new player begins on board 1, and
  // the save still records the finished boards. Older saves that kept a
  // campaign reach load as they are, with every board open.
  const reached = boards.length - 1;
  const pars = new Map(), parOf = b => { if (!pars.has(b.id)) pars.set(b.id, E.par(b)); return pars.get(b.id); };
  let hint = null, focus = [0, 0], keyboard = false, hover = null;
  const gestures = new Map();
  let busy = false, queue = [], animation = null, epoch = 0;
  let display = { before: grid, after: grid, t: 1, at: null, settle: 0 };
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const rowsOf = () => board.cells.length, colsOf = () => board.cells[0].length, present = (r, c) => r >= 0 && c >= 0 && r < rowsOf() && c < colsOf() && board.cells[r][c] !== '.';
  const lightCount = g => g.flat().filter(v => v === 1).length;
  function announce(text) { $('#announcement').textContent = text; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ board: board.id, grid, hits, history, finished: [...finished], settings: prefs, campaign: 1, reached, calibration, lastCamera })); } catch (_) {}
  }
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) n.setAttribute(key, value);
    if (parent) parent.append(n); return n;
  }
  function set(n, attrs) {
    n.cache ||= {};
    for (const key in attrs) { const v = attrs[key]; if (n.cache[key] === v) continue; if (v === null || v === undefined) n.removeAttribute(key); else n.setAttribute(key, v); n.cache[key] = v; }
  }

  // ---- Layout. The board is as large as fits between the header and the
  // toolbar, by height as well as width, keeping only a thin clear gap round
  // it and a narrow band at the page's sides, where trackers are weakest.
  // While choosing is by look and hold the toolbar's own Undo and Hint grow
  // to at least a phone's smallest tile and become look targets themselves.
  const M = .07, HALF = .46, GAP = 12, geo = { s: 60, ox: 0, oy: 0, band: 16, dead: 10, cells: new Map(), area: null };
  const railMode = () => matchMedia('(max-height:520px) and (min-width:560px)').matches;
  const toolSize = () => clamp(Math.round(Math.min(innerWidth, innerHeight) / 6), 64, 160);
  const visibleTools = () => [...document.querySelectorAll('.toolbar button')].filter(n => n.offsetParent !== null);
  function fit() {
    const rows = rowsOf(), cols = colsOf(), short = Math.min(innerWidth, innerHeight), band = Math.max(10, Math.round(short * .03));
    document.body.dataset.look = dwellOn() ? 'dwell' : 'plain'; document.body.style.setProperty('--tool', toolSize() + 'px');
    const tools = visibleTools().map(n => n.getBoundingClientRect()), rail = railMode() && tools.length > 0;
    let right = innerWidth - band, bottom = innerHeight - band;
    if (rail) right = Math.min(right, Math.min(...tools.map(r => r.left)) - GAP);
    else if (tools.length) {
      // The frame sets Next on the toolbar row, rising above a short row to
      // stay on the page, unless the row has no room between its two groups
      // for it; then it goes in a gap below the board, which is kept.
      const barTop = Math.min(...tools.map(r => r.top)), rowMid = (barTop + Math.max(...tools.map(r => r.bottom))) / 2;
      const lefts = tools.filter(r => r.left + r.width / 2 < innerWidth / 2), rights = tools.filter(r => r.left + r.width / 2 >= innerWidth / 2);
      const slot = (rights.length ? Math.min(...rights.map(r => r.left)) : innerWidth) - (lefts.length ? Math.max(...lefts.map(r => r.right)) : 0);
      bottom = Math.min(bottom, barTop, Math.min(rowMid - 32, innerHeight - 70)) - GAP;
      if (slot < 64 + 2 * 16) bottom = Math.min(bottom, barTop - GAP - 80);
    }
    // Either below the restart button across the page's width, or higher,
    // just below the readout, kept in from the restart button on both sides.
    const restart = $('#restart-btn').getBoundingClientRect(), readout = $('#readout').getBoundingClientRect();
    const inset = Math.max(band, restart.right + 6), size = (l, r, t) => Math.min((r - l) / (cols + 2 * M), (bottom - t) / (rows + 2 * M));
    const wide = { left: band, right, top: Math.max(band, restart.bottom + GAP) }, high = { left: inset, right: Math.min(right, innerWidth - inset), top: Math.max(band, readout.bottom + 6) };
    const pick = size(high.left, high.right, high.top) > size(wide.left, wide.right, wide.top) ? high : wide, { left, top } = pick;
    right = pick.right;
    const s = Math.max(24, Math.floor(size(left, right, top) * 2) / 2);
    geo.area = { x: left, y: top, w: right - left, h: bottom - top };
    Object.assign($('#board-shell').style, { top: top + 'px', left: left + 'px', right: innerWidth - right + 'px', bottom: innerHeight - bottom + 'px' });
    boardNode.setAttribute('viewBox', `${-M} ${-M} ${cols + 2 * M} ${rows + 2 * M}`);
    boardNode.style.width = (cols + 2 * M) * s + 'px'; boardNode.style.height = (rows + 2 * M) * s + 'px';
    const r = boardNode.getBoundingClientRect();
    Object.assign(geo, { s, band, ox: r.left + M * s, oy: r.top + M * s, dead: Math.max(10, s * .15), rect: { left: r.left + M * s, top: r.top + M * s, right: r.left + (cols + M) * s, bottom: r.top + (rows + M) * s } });
    geo.cells = new Map();
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) if (present(rr, cc)) geo.cells.set(rr + ',' + cc, { id: `cell:${rr}:${cc}`, kind: 'cell', r: rr, c: cc, x: geo.ox + cc * s, y: geo.oy + rr * s, w: s, h: s });
    placeGlyph();
  }
  // Page units to pixels: -1 to 1 across the reach inside the outer band.
  function toScreen(u, v) {
    const x0 = geo.band, x1 = innerWidth - geo.band, y0 = geo.band, y1 = innerHeight - geo.band;
    return { x: (x0 + x1) / 2 + u * (x1 - x0) / 2, y: (y0 + y1) / 2 + v * (y1 - y0) / 2 };
  }

  // ---- The board.
  let tiles = new Map(), ringLayer = null, ringNode = null, frameNode = null, built = null;
  function build() {
    boardNode.replaceChildren();
    const rows = rowsOf(), cols = colsOf();
    frameNode = svg('rect', { class: 'frame', x: -.06, y: -.06, width: cols + .12, height: rows + .12 }, boardNode);
    const layerTiles = svg('g', { id: 'tiles', 'aria-hidden': 'true' }, boardNode);
    tiles = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (present(r, c)) {
      const g = svg('g', { class: 'tile', 'data-r': r, 'data-c': c }, layerTiles), face = svg('rect', { class: 'face' }, g), tint = svg('rect', { class: 'tint', opacity: 0 }, g);
      tiles.set(r + ',' + c, { g, face, tint, r, c });
    }
    ringNode = svg('circle', { class: 'solve-ring', r: 1, display: 'none', 'aria-hidden': 'true' }, boardNode);
    ringLayer = svg('g', { id: 'rings', 'aria-hidden': 'true' }, boardNode);
    built = board;
  }
  // Each turning tile shows its old face while it narrows and its new one as
  // it widens, the chosen tile first and its neighbours a moment after.
  function drawTiles() {
    const h = HALF + (.5 - HALF) * display.settle, edge = +(1 - display.settle).toFixed(3);
    for (const t of tiles.values()) {
      const a = display.before[t.r][t.c], b = display.after[t.r][t.c];
      let sx = 1, face = b;
      if (a !== b && display.t < 1) {
        const delay = display.at && (display.at[0] !== t.r || display.at[1] !== t.c) ? 60 : 0, p = clamp((display.t * 300 - delay) / 220, 0, 1), turn = Math.cos(Math.PI * smooth(p));
        sx = Math.max(.03, Math.abs(turn)); face = turn >= 0 ? a : b;
      }
      set(t.g, { transform: `translate(${t.c + .5} ${t.r + .5})` + (sx < 1 ? ` scale(${sx.toFixed(4)} 1)` : '') });
      set(t.face, { class: 'face ' + (face ? 'light' : 'dark'), x: -h, y: -h, width: 2 * h, height: 2 * h, 'stroke-opacity': edge < 1 ? edge : null });
      set(t.tint, { x: -h, y: -h, width: 2 * h, height: 2 * h });
    }
    boardNode.dataset.busy = String(busy); boardNode.dataset.solved = String(E.solved(board, grid)); boardNode.dataset.settle = String(+display.settle.toFixed(3));
  }
  // Focus, hint and hover rings sit on their own layer in the board, each in
  // the tone opposite the face beneath it.
  function drawRings() {
    ringLayer.replaceChildren();
    for (const [p, name, radius] of [[hover, 'hover-ring', .34], [hint && [hint.r, hint.c], 'hint-ring', .29], [keyboard && focus, 'focus-ring', .42]]) {
      if (!p || !present(p[0], p[1])) continue;
      const tone = grid[p[0]][p[1]] ? 'on-light' : 'on-dark';
      if (name !== 'hover-ring') svg('circle', { class: 'ring-halo ' + tone, cx: p[1] + .5, cy: p[0] + .5, r: radius }, ringLayer);
      svg('circle', { class: name + ' ' + tone, cx: p[1] + .5, cy: p[0] + .5, r: radius }, ringLayer);
    }
  }
  function draw() { if (built !== board) build(); drawTiles(); drawRings(); }
  function chrome() {
    const solved = E.solved(board, grid), [r, c] = focus, i = boards.indexOf(board);
    boardNode.setAttribute('aria-label', `Board ${i + 1}, ${rowsOf()} rows by ${colsOf()} columns. ${solved ? 'Every tile dark.' : lightCount(grid) + ' light tiles.'} ${hits} moves, par ${parOf(board)}. Focus row ${r + 1}, column ${c + 1}, ${present(r, c) ? (grid[r][c] ? 'light' : 'dark') : 'empty'}.`);
    $('#readout').textContent = `${i + 1} / ${boards.length} · ${hits} / ${parOf(board)}`;
    $('#readout').setAttribute('aria-label', `Board ${i + 1} of ${boards.length}; ${hits} moves; par ${parOf(board)}`);
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = solved;
    // Next comes at once with a finish, while its colour still spreads.
    $('#next-btn').hidden = !solved || i === boards.length - 1;
    const on = ['starting', 'calibrating', 'camera'].includes(phase);
    $('#camera-btn').setAttribute('aria-pressed', String(on)); $('#camera-btn').setAttribute('aria-label', on ? 'Stop the camera' : 'Start the camera');
    $('#select').disabled = prefs.input !== 'pointer'; $('#calibrate').disabled = prefs.input === 'pointer';
    $('#rewards').value = prefs.rewards; $('#sound').value = prefs.sound;
    $('#input').value = prefs.input; $('#select').value = prefs.input === 'pointer' ? prefs.select : 'dwell'; $('#dwell').value = String(prefs.dwell);
    catalog(); placeGlyph(); placeGlyphSoon();
  }
  // The frame places Next a frame later; the glyph then steps clear of it.
  function placeGlyphSoon() { requestAnimationFrame(() => requestAnimationFrame(placeGlyph)); }
  // Settings lists every board as current, completed or available.
  function catalog() {
    const list = $('#board-catalog');
    if (!list.children.length) boards.forEach((b, i) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.dataset.board = b.id;
      button.innerHTML = `<span>Board ${i + 1}</span><span class="catalog-state"></span>`;
      button.addEventListener('click', () => { if (b !== board) go(b.id); $('#settings').close(); });
      item.append(button); list.append(item);
    });
    boards.forEach((b, i) => {
      const button = list.children[i].firstChild, here = b === board, done = finished.has(b.id);
      button.dataset.state = here ? 'current' : done ? 'completed' : 'available';
      button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, done ? 'Completed' : null, !here && !done ? 'Available' : null].filter(Boolean).join(' · ');
      if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }
  function rest() { display = { before: grid, after: grid, t: 1, at: null, settle: E.solved(board, grid) ? (show ? display.settle : 1) : 0 }; draw(); holdColour(); chrome(); }
  // A hidden page runs no frames, so motion there settles at once.
  function tween(duration, paint) {
    if (reduced() || document.hidden) { paint(1); return Promise.resolve(); }
    return new Promise(resolve => {
      const start = performance.now(); let id;
      function finish() { cancelAnimationFrame(id); animation = null; paint(1); resolve(); }
      function frame(now) { const t = clamp((now - start) / duration, 0, 1); paint(t); if (t < 1) id = requestAnimationFrame(frame); else { animation = null; resolve(); } }
      animation = { finish }; paint(0); id = requestAnimationFrame(frame);
    });
  }
  async function change(next, nextHits, remember, token, at = null) {
    const before = grid, settled = display.settle;
    stopShow();
    if (remember) history.push({ grid: copy(grid), hits });
    grid = next; hits = nextHits; hint = null;
    // A tile turned is the act: a bloom where it happened, and a tick if Sound is on.
    if (at && remember) { bloom(at); if (prefs.sound === 'on') sound.tick(Math.round(7 * (1 - lightCount(grid) / tiles.size))); }
    // The move is saved before any motion, so leaving the page cannot lose it.
    if (E.solved(board, grid)) finished.add(board.id);
    display = { before, after: grid, t: 0, at, settle: settled }; chrome(); save();
    await tween(300, t => { display.t = t; display.settle = settled * (1 - smooth(Math.min(1, t * 2))); draw(); });
    if (token !== epoch) return;
    display = { before: grid, after: grid, t: 1, at: null, settle: 0 };
    if (E.solved(board, grid)) {
      // The finished board settles once and takes colour, without holding up the next choice.
      celebrate(at);
      announce(`Every tile dark in ${hits} moves. Par ${parOf(board)}. ${boards.indexOf(board) === boards.length - 1 ? 'Every board is finished.' : 'Next board is open.'}`);
    } else if (at) announce(`Row ${at[0] + 1}, column ${at[1] + 1} turned. ${lightCount(grid)} light. ${hits} moves.`);
  }
  async function act(action) {
    const token = epoch;
    if (action.type === 'flip') {
      const { r, c } = action;
      if (!Number.isInteger(r) || !Number.isInteger(c) || !present(r, c)) return;
      await change(E.flip(board, grid, r, c), hits + 1, true, token, [r, c]);
    } else if (action.type === 'hint') {
      if (hint) await act({ type: 'flip', r: hint.r, c: hint.c });
      else { hint = E.hint(board, grid); if (hint) { focus = [hint.r, hint.c]; announce(`Hint: row ${hint.r + 1}, column ${hint.c + 1}. Hint again turns it.`); } }
    } else if (action.type === 'undo') {
      const previous = history.pop();
      if (previous) { await change(previous.grid, previous.hits, false, token); announce(`Move undone. ${hits} moves.`); }
      else { rest(); announce('No move to undo.'); }
    } else if (action.type === 'restart' || action.type === 'go') {
      if (action.type === 'go') { const next = boards.find(b => b.id === action.id); if (!next) return; board = next; }
      stopShow(); grid = E.start(board); hits = 0; history = []; hint = null; hover = null; focus = firstTile(); fit(); rest(); save(); afterBoardChange();
      announce(action.type === 'restart' ? 'Board restarted.' : `Board ${boards.indexOf(board) + 1}.`);
    }
  }
  const firstTile = () => { for (let r = 0; r < rowsOf(); r++) for (let c = 0; c < colsOf(); c++) if (present(r, c)) return [r, c]; return [0, 0]; };
  async function drain() {
    if (busy) return;
    busy = true; chrome();
    try { while (queue.length) { const job = queue.shift(); await act(job.action); job.resolve(); } }
    finally { busy = false; rest(); }
  }
  function enqueue(action, clear = false) {
    if (clear) { epoch++; for (const job of queue) job.resolve(); queue = []; gestures.clear(); animation?.finish(); }
    return new Promise(resolve => { queue.push({ action, resolve }); drain(); });
  }
  const flip = (r, c) => enqueue({ type: 'flip', r, c });
  const undo = () => enqueue({ type: 'undo' }, true), restart = () => enqueue({ type: 'restart' }, true);
  // Any board can be opened, from Settings or from the test hook; an unknown id is refused.
  const go = id => boards.some(b => b.id === id) ? enqueue({ type: 'go', id }, true).then(() => true) : Promise.resolve(false);
  const next = () => { const b = boards[boards.indexOf(board) + 1]; return b && E.solved(board, grid) ? go(b.id) : Promise.resolve(false); };

  // ---- The reward. Colour is the payoff and never information: a bloom of
  // the board's palette where a tile turns, and on a finish the tiles fill
  // with it in a wave from the last turn, with one ring spreading from there.
  // Reduced motion keeps only fades; Calm keeps paper and ink.
  const payoffStats = { blooms: 0, fades: 0, solves: 0, rings: 0, contexts: 0, ticks: 0, chords: 0 }, sound = P.voice(payoffStats), payLayer = $('#payoff-layer');
  const colourOn = () => prefs.rewards === 'colour', boardPalette = () => P.paletteFor(boards.indexOf(board) + 1, dark());
  let show = null;
  function bloom(at) {
    const t = geo.cells.get(at[0] + ',' + at[1]);
    if (!colourOn() || !t || !payLayer.animate) return;
    const pal = boardPalette(), cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    if (reduced() || document.hidden) {
      payoffStats.fades++;
      const r = svg('rect', { class: 'fade', x: (t.x + t.w * .04).toFixed(1), y: (t.y + t.h * .04).toFixed(1), width: (t.w * .92).toFixed(1), height: (t.h * .92).toFixed(1), fill: P.colourAt(pal, .5), opacity: 0 }, payLayer);
      const a = r.animate([{ opacity: .7 }, { opacity: 0 }], { duration: 200, easing: 'linear' }); a.onfinish = a.oncancel = () => r.remove();
      return;
    }
    payoffStats.blooms++;
    const n = 8, R = t.w * .6, dot = Math.max(5, t.w * .1), turn = ((at[0] * 3 + at[1] * 5) % 8) * Math.PI / 32;
    for (let k = 0; k < n; k++) {
      const a = turn + k * 2 * Math.PI / n, c = svg('circle', { class: 'petal', cx: cx.toFixed(1), cy: cy.toFixed(1), r: dot.toFixed(1), fill: P.colourAt(pal, k / (n - 1)) }, payLayer);
      const anim = c.animate([{ transform: 'translate(0px, 0px) scale(.4)', opacity: 1 }, { opacity: .9, offset: .55 }, { transform: `translate(${(Math.cos(a) * R).toFixed(1)}px, ${(Math.sin(a) * R).toFixed(1)}px) scale(1)`, opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2, .7, .3, 1)' });
      anim.onfinish = anim.oncancel = () => c.remove();
    }
  }
  // Each tile's colour and its place in the wave, outward from the last turn.
  function tintPlan(at) {
    const centre = at || [(rowsOf() - 1) / 2, (colsOf() - 1) / 2], list = [...tiles.values()], dist = t => Math.hypot(t.r - centre[0], t.c - centre[1]), far = Math.max(1e-6, ...list.map(dist)), pal = boardPalette();
    return { centre, far, pal, tiles: list.map(t => ({ t, d: dist(t) / far, colour: P.colourAt(pal, dist(t) / far) })) };
  }
  function stopShow() {
    if (show) { cancelAnimationFrame(show.id); show = null; }
    for (const t of tiles.values()) { set(t.tint, { opacity: 0 }); t.tint.getAnimations?.().forEach(a => a.cancel()); }
    if (ringNode) set(ringNode, { display: 'none' });
  }
  // A finished board holds in colour until Next (after a reload or a theme change too).
  function holdColour() {
    if (show) return;
    const on = colourOn() && E.solved(board, grid), plan = on ? tintPlan(null) : null;
    for (const t of tiles.values()) { const p = plan && plan.tiles.find(x => x.t === t); set(t.tint, { opacity: on ? 1 : 0, fill: p ? p.colour : null }); }
  }
  function celebrate(at) {
    payoffStats.solves++;
    if (prefs.sound === 'on') sound.chord();
    const plan = colourOn() ? tintPlan(at) : null;
    if (plan) for (const p of plan.tiles) set(p.t.tint, { fill: p.colour });
    if (reduced() || document.hidden) {
      display.settle = 1; drawTiles();
      if (plan) for (const p of plan.tiles) { set(p.t.tint, { opacity: 1 }); if (!document.hidden && p.t.tint.animate) p.t.tint.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'linear' }); }
      return;
    }
    const start = performance.now(), ring = plan ? { cx: plan.centre[1] + .5, cy: plan.centre[0] + .5, k: plan.far + 1.3 } : null;
    if (ring) { payoffStats.rings++; set(ringNode, { display: null, stroke: P.colourAt(plan.pal, .5), transform: `translate(${ring.cx} ${ring.cy}) scale(.3)`, opacity: .85 }); }
    show = { id: 0 };
    const frame = now => {
      if (!show) return;
      const e = now - start;
      display.settle = 1 - (1 - Math.min(1, e / 520)) ** 3; drawTiles();
      if (plan) for (const p of plan.tiles) set(p.t.tint, { opacity: +clamp((e - 700 * p.d) / 300, 0, 1).toFixed(3) });
      if (ring) { const q = Math.min(1, e / 900), k = .3 + (ring.k - .3) * (1 - (1 - q) ** 2); set(ringNode, { transform: `translate(${ring.cx} ${ring.cy}) scale(${k.toFixed(3)})`, opacity: +(.85 * (1 - q)).toFixed(3) }); }
      if (e < 1000) show.id = requestAnimationFrame(frame);
      else { if (ringNode) set(ringNode, { display: 'none' }); show = null; }
    };
    show.id = requestAnimationFrame(frame);
  }
  // Sound starts only on a gesture once it is on; until then no audio context exists.
  for (const name of ['pointerdown', 'keydown']) addEventListener(name, () => { if (prefs.sound === 'on') sound.start(); }, true);

  // ---- Input. `phase` is where the player is: the camera's first screen
  // (prompt), the camera starting, calibrating, playing by camera, or by pointer.
  let phase = 'pointer', calib = null, face = false, gaze = null, freshHold = false, resumeOnShow = false, virtual = false;
  const pointer = { x: 0, y: 0, present: false };
  const filters = () => prefs.input === 'eyes' ? [G.oneEuro({ minCutoff: .45, beta: .35 }), G.oneEuro({ minCutoff: .45, beta: .35 })] : [G.oneEuro({ minCutoff: .8, beta: .6 }), G.oneEuro({ minCutoff: .8, beta: .6 })];
  let [fu, fv] = filters();
  const dwellOn = () => phase === 'camera' || (phase === 'pointer' && prefs.select === 'dwell');
  const pointerDwell = () => (phase === 'pointer' && prefs.select === 'dwell') || phase === 'prompt';
  const inSafe = (x, y) => x >= geo.band && y >= geo.band && x <= innerWidth - geo.band && y <= innerHeight - geo.band;
  const within = (t, x, y, grow) => t.cx !== undefined ? Math.hypot(x - t.cx, y - t.cy) <= t.r + grow : x >= t.x - grow && x <= t.x + t.w + grow && y >= t.y - grow && y <= t.y + t.h + grow;
  // The camera glyph stands in the rest area below the board, centred between
  // the board and the toolbar where the Next disc would sit; where the board
  // fills the height, beside it instead (between board and rail on a phone
  // turned sideways). Never over a tile or a control, sized to the room; if
  // Next is waiting where the glyph would be, the glyph stands clear of it.
  function placeGlyph() {
    const n = $('#camera-start'); if (n.hidden || !frameNode) return;
    const b = frameNode.getBoundingClientRect(), tools = visibleTools().map(x => x.getBoundingClientRect()), rail = railMode() && tools.length > 0, need = 64 + 24;
    const barTop = !rail && tools.length ? Math.min(...tools.map(r => r.top)) : innerHeight - geo.band, sideEdge = rail ? Math.min(...tools.map(r => r.left)) : innerWidth - geo.band;
    const yMid = (Math.max(0, b.top) + Math.min(innerHeight, b.bottom)) / 2, spots = [
      [barTop - b.bottom, b.left + b.width / 2, (b.bottom + barTop) / 2],
      [sideEdge - b.right, (b.right + sideEdge) / 2, yMid],
      [b.left - geo.band, (geo.band + b.left) / 2, yMid]];
    const at = rail ? 1 : Math.max(0, spots.findIndex(([room]) => room >= need)), [room, x0, y0] = spots[at];
    const d = clamp(Math.floor(room - 24), 64, 132);
    let x = x0, y = y0;
    const nx = nextTarget();
    if (nx && Math.hypot(nx.cx - x, nx.cy - y) < nx.r + d / 2 + 12) { if (at === 0) x = nx.cx - nx.r - 12 - d / 2; else y = Math.max(geo.band + d / 2, nx.cy - nx.r - 12 - d / 2); }
    Object.assign(n.style, { left: Math.round(x - d / 2) + 'px', top: Math.round(y - d / 2) + 'px', width: d + 'px', height: d + 'px' });
    n.style.setProperty('--glyph-icon', Math.round(d * .4) + 'px');
  }
  function glyphTarget() { const n = $('#camera-start'); if (n.hidden) return null; const b = n.getBoundingClientRect(); return { id: 'camera', kind: 'camera', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 }; }
  function nextTarget() { const n = $('#next-btn'); if (n.hidden || !n.isConnected) return null; const b = n.getBoundingClientRect(); return b.width ? { id: 'next', kind: 'next', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 } : null; }
  // The toolbar's own Undo and Hint, as look targets while choosing is by
  // look and hold (and only while they would do something).
  function toolTargets() {
    if (!dwellOn()) return [];
    return [['undo-btn', 'tool:undo'], ['hint-btn', 'tool:hint']].map(([el, id]) => { const n = $('#' + el); if (!n || n.disabled || n.offsetParent === null) return null; const b = n.getBoundingClientRect(); return { id, kind: 'tool', x: b.left, y: b.top, w: b.width, h: b.height }; }).filter(Boolean);
  }
  // What a look at (x, y) would choose: the toolbar's Undo and Hint and the
  // Next disc wherever they stand; tiles and the camera glyph only inside the
  // outer band; nothing in the rest area or behind a sheet.
  function targetAt(x, y) {
    if ($('dialog[open]')) return null;
    if (phase === 'prompt') { const g = glyphTarget(); return g && inSafe(x, y) && within(g, x, y, 0) ? g : null; }
    if (!dwellOn()) return null;
    for (const t of toolTargets()) if (within(t, x, y, 0)) return t;
    const n = nextTarget(); if (n && within(n, x, y, 0)) return n;
    if (!inSafe(x, y)) return null;
    const c = Math.floor((x - geo.ox) / geo.s), r = Math.floor((y - geo.oy) / geo.s);
    return geo.cells.get(r + ',' + c) || null;
  }
  function holds(t, x, y) {
    if ($('dialog[open]')) return false;
    if (t.kind === 'tool' || t.kind === 'next') { const live = t.kind === 'next' ? (dwellOn() ? nextTarget() : null) : toolTargets().find(x => x.id === t.id); return !!live && within(live, x, y, geo.dead); }
    if (!inSafe(x, y)) return false;
    if (t.kind === 'cell' && !geo.cells.has(t.r + ',' + t.c)) return false;
    const live = t.kind === 'camera' ? glyphTarget() : (dwellOn() ? t : null);
    return !!live && within(live, x, y, geo.dead);
  }
  const dwell = G.dwell({ time: prefs.dwell, targets: targetAt, holds });
  function feed(t, x, y) {
    if (freshHold && x !== null) { dwell.hold(targetAt(x, y)); freshHold = false; }
    gaze = x === null ? null : { x, y };
    for (const target of dwell.sample(t, x, y)) choose(target);
    wake();
  }
  function choose(t) {
    if (t.kind === 'cell') { focus = [t.r, t.c]; flip(t.r, t.c); }
    else if (t.id === 'tool:undo') undo();
    else if (t.id === 'tool:hint') enqueue({ type: 'hint' });
    else if (t.id === 'next') next();
    else if (t.id === 'camera') startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  }
  // A new board, or a new way of looking, starts with whatever lies under the
  // point already counted as chosen, so a resting look cannot pick it.
  // The camera's next reading is that resting look; a pointer's is where it is now.
  function settleLook() {
    dwell.reset();
    if (phase === 'camera' || phase === 'calibrating') freshHold = true;
    else { freshHold = false; if (pointerDwell() && pointer.present) dwell.hold(targetAt(pointer.x, pointer.y)); }
  }
  function afterBoardChange() { settleLook(); wake(); }
  function setPhase(next) {
    phase = next; document.body.dataset.phase = next;
    $('#camera-start').hidden = !(next === 'prompt' || next === 'starting');
    gaze = null; relayout(); settleLook();
    if (next !== 'camera' && next !== 'calibrating') setFace(false);
    chrome(); wake();
  }
  // A change between plain and look-and-hold choosing resizes the toolbar's
  // Undo and Hint, so the board is fitted again.
  function relayout() { if (built) { fit(); draw(); } else placeGlyph(); }
  function setFace(on) { face = on; $('#live').dataset.face = on ? 'seen' : 'none'; }
  function showLive(on) { $('#live').hidden = !on; document.body.dataset.camera = on ? 'on' : 'off'; }
  T.onStream = on => showLive(on || virtual);
  T.onResult = (result, t) => processFace(result, t);
  // Each camera reading: the face's look, then calibration or the point on the page.
  // Flipped for a player who chose Up and down: Flipped, which every game on
  // this site shares.
  const lookOptions = () => { let invertY = false; try { invertY = localStorage.getItem('minimal-gaze.v1:invert-y') === '1'; } catch (_) {} return { invertY }; };
  function processFace(result, t) {
    if (phase !== 'camera' && phase !== 'calibrating') return;
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    setFace(!!lm);
    if (!lm) { if (phase === 'calibrating') calibrate(t, null); else feed(t, null, null); return; }
    const aspect = virtual ? 4 / 3 : T.aspect(), mode = calib ? calib.mode : prefs.input;
    const f = mode === 'eyes' ? G.lookAngles(lm, aspect) : G.headPose(lm, result.facialTransformationMatrixes && result.facialTransformationMatrixes[0], aspect);
    if (phase === 'calibrating') { calibrate(t, f); return; }
    const cal = calibration[mode]; if (!cal) return;
    const o = lookOptions(), m = mode === 'eyes' ? G.eyesMap(cal, f, o) : G.headMap(cal, f, o), p = toScreen(fu.filter(m.u, t), fv.filter(m.v, t));
    feed(t, clamp(p.x, 0, innerWidth), clamp(p.y, 0, innerHeight));
  }
  // Calibration: one dot at a time; hold still on it and its ring fills.
  // A full calibration is the centre and then four edges; a fresh start of a
  // calibrated camera needs only the centre.
  function beginCalibration(full) {
    calib = { full, mode: prefs.input, spots: full ? [0, 1, 2, 3, 4] : [0], step: 0, window: [], captured: [], progress: 0, last: null };
    setPhase('calibrating'); announce(full ? 'Look at each dot in turn and hold still.' : 'Look at the dot and hold still.');
  }
  function calibrate(t, f) {
    const dt = calib.last === null ? 0 : clamp(t - calib.last, 0, 120), head = calib.mode === 'head';
    const keys = head ? ['yaw', 'pitch'] : ['ax', 'ay'], tolerance = head ? .02 : .06, travel = head ? .035 : .06;
    calib.last = t;
    if (f) { calib.window.push({ t, ...f }); while (t - calib.window[0].t > 400) calib.window.shift(); } else calib.window = [];
    const s = G.stillness(calib.window, keys, tolerance), span = calib.window.length ? t - calib.window[0].t : 0, centre = calib.captured[0];
    // Each edge dot needs the look moved its own way: across for the side
    // dots, up or down for the top and bottom ones. A turn alone used to
    // take a top or bottom dot with no nod at all.
    const spot = calib.spots[calib.step], axis = keys[[0, 0, 0, 1, 1][spot]], away = from => Math.abs(s.mean[axis] - from[axis]) >= travel;
    // And the right and bottom dots must lie on the other side of the centre
    // from the left and top ones. Still looking up when the bottom dot came
    // used to take it there, and the calibration then ran up and down backwards.
    const pair = spot === 2 ? 1 : spot === 4 ? 3 : -1, across = pair < 0 || !s.mean || Math.sign(s.mean[axis] - centre[axis]) !== Math.sign(calib.captured[pair][axis] - centre[axis]);
    const moved = calib.step === 0 || (!!s.mean && away(centre) && away(calib.captured[calib.captured.length - 1]) && across);
    calib.progress = f && s.still && span >= 250 && moved ? calib.progress + dt / 900 : Math.max(0, calib.progress - dt / 400);
    if (calib.progress >= 1) {
      calib.captured.push(s.mean); calib.step++; calib.window = []; calib.progress = 0; calib.last = null;
      if (calib.step >= calib.spots.length) finishCalibration(); else announce(`Dot ${calib.step + 1} of ${calib.spots.length}.`);
    }
    wake();
  }
  function finishCalibration() {
    const { mode, full, captured } = calib, made = full ? (mode === 'head' ? G.headCalibration(captured) : G.eyesCalibration(captured)) : G.recentre(calibration[mode], captured[0]);
    if (!made) {
      // Twice in a row is enough: a player who cannot hold the dots is not
      // kept in calibration for ever.
      if (++calFails >= 2) { calFails = 0; T.stop(); virtual = false; showLive(false); calib = null; setPhase('pointer'); announce('Calibration did not take. Play by pointer; the camera button tries again.'); return; }
      beginCalibration(true); announce('Again: look at each dot and hold still.'); return;
    }
    calFails = 0;
    calibration[mode] = made; calib = null; save();
    [fu, fv] = filters(); setPhase('camera');
    announce('Camera ready. Look at a tile and hold.');
  }
  const permission = async () => { try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch (_) { return 'unknown'; } };
  // Start the camera for head or eyes. Refused or unavailable, play goes on by pointer.
  async function startCamera(mode, { full = false } = {}) {
    if (phase === 'starting') return;
    prefs.input = mode; lastCamera = mode; save();
    if (virtual) { beginCalibration(full || !G.current(calibration[mode])); return; }
    if (T.running) { beginCalibration(full || !G.current(calibration[mode])); return; }
    setPhase('starting');
    try { await T.start(); }
    catch (_) { if (phase === 'starting') fallback(); return; }
    if (phase !== 'starting') return;
    beginCalibration(full || !G.current(calibration[mode]));
  }
  // The camera lost mid-play: play goes on by pointer, and the player's choice
  // of camera is kept, so the camera button or the next visit picks it up.
  T.onLost = () => { if (phase !== 'camera' && phase !== 'calibrating') return; virtual = false; showLive(false); calib = null; setPhase('pointer'); announce('The camera stopped. Play by pointer; the camera button tries again.'); };
  let calFails = 0;
  function fallback() {
    T.stop(); virtual = false; showLive(false); calib = null; prefs.input = 'pointer'; save(); setPhase('pointer');
    announce('Camera unavailable. Play by pointer; the camera button tries again.');
  }
  function stopCamera() {
    T.stop(); virtual = false; showLive(false); calib = null; resumeOnShow = false;
    if (prefs.input !== 'pointer') lastCamera = prefs.input;
    prefs.input = 'pointer'; save(); setPhase('pointer'); announce('Camera off. Playing by pointer.');
  }
  function toPointer() { prefs.input = 'pointer'; prefs.select = 'tap'; save(); setPhase('pointer'); }

  // ---- The look layer: gaze dot, rings and the calibration dot.
  let rafId = 0;
  const dot = svg('g', { class: 'gaze-dot' }, layer), dotHalo = svg('circle', { class: 'gaze-halo', r: 18 }, dot), dotCore = svg('circle', { class: 'gaze-core', r: 7 }, dot);
  const ringsLayer = svg('g', { class: 'dwell-rings' }, layer), spotLayer = svg('g', { class: 'spot-layer' }, layer);
  const spotHalo = svg('circle', { class: 'spot-halo', r: 15 }, spotLayer), spot = svg('circle', { class: 'spot', r: 9 }, spotLayer);
  const spotTrack = svg('circle', { class: 'dwell-track on-page', r: 26 }, spotLayer), spotArc = svg('circle', { class: 'dwell-arc on-page', r: 26 }, spotLayer);
  const rings = new Map();
  function wake() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function loop(now) {
    rafId = 0;
    if (pointerDwell() && !document.hidden) feed(now, pointer.present ? pointer.x : null, pointer.present ? pointer.y : null);
    drawLayer();
    if ((pointerDwell() && pointer.present) || dwell.rings().length) wake();
  }
  function ringFor(id) {
    let n = rings.get(id);
    if (!n) { n = { track: svg('circle', { class: 'dwell-track' }, ringsLayer), arc: svg('circle', { class: 'dwell-arc' }, ringsLayer) }; rings.set(id, n); }
    return n;
  }
  function placeRing(n, cx, cy, r, p, tone) {
    const C = 2 * Math.PI * r;
    set(n.track, { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), class: 'dwell-track ' + tone });
    set(n.arc, { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), class: 'dwell-arc ' + tone, 'stroke-dasharray': `${(p * C).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})` });
  }
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', camera: 'M3 8h4l2-3h6l2 3h4v11H3ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' };
  function drawLayer() {
    // The gaze dot shows only for the camera; a pointer shows itself.
    const showDot = phase === 'camera' && gaze;
    set(dot, { transform: showDot ? `translate(${gaze.x.toFixed(1)} ${gaze.y.toFixed(1)})` : null, display: showDot ? null : 'none' });
    const live = new Set();
    for (const [id, p] of dwell.rings()) {
      let cx, cy, r, tone = 'on-page';
      if (id.startsWith('cell:')) { const [, rr, cc] = id.split(':').map(Number), t = geo.cells.get(rr + ',' + cc); if (!t) continue; cx = t.x + t.w / 2; cy = t.y + t.h / 2; r = geo.s * .34; tone = grid[rr][cc] ? 'on-light' : 'on-dark'; }
      // On the toolbar's buttons and the Next disc the ring fills inside them.
      else if (id.startsWith('tool:')) { const t = toolTargets().find(x => x.id === id); if (!t) continue; cx = t.x + t.w / 2; cy = t.y + t.h / 2; r = Math.min(t.w, t.h) / 2 - 4; }
      else if (id === 'next') { const t = nextTarget(); if (!t) continue; cx = t.cx; cy = t.cy; r = t.r - 6; tone = 'on-ink'; }
      else { const t = glyphTarget(); if (!t) continue; cx = t.cx; cy = t.cy; r = t.r + 10; }
      placeRing(ringFor(id), cx, cy, r, p, tone); live.add(id);
    }
    for (const [id, n] of rings) if (!live.has(id)) { n.track.remove(); n.arc.remove(); rings.delete(id); }
    if (phase === 'calibrating' && calib) {
      const at = toScreen(G.SPOTS[calib.spots[calib.step]].u, G.SPOTS[calib.spots[calib.step]].v), C = 2 * Math.PI * 26;
      set(spotLayer, { display: null, transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`, 'data-step': String(calib.step) });
      set(spotArc, { 'stroke-dasharray': `${(calib.progress * C).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90)' });
    } else set(spotLayer, { display: 'none' });
  }

  // ---- Pointer, touch and keys.
  function nearest(event) {
    const x = event.clientX, y = event.clientY, c = Math.floor((x - geo.ox) / geo.s), r = Math.floor((y - geo.oy) / geo.s);
    if (present(r, c)) return [r, c];
    return null;
  }
  // Each pointer is its own press, so two thumbs tapping in turn both count.
  boardNode.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.pointerType === 'mouse' && !e.isPrimary) || $('dialog[open]') || !nearest(e)) return;
    keyboard = false; gestures.set(e.pointerId, { x: e.clientX, y: e.clientY, last: { clientX: e.clientX, clientY: e.clientY }, travel: 0 });
    boardNode.focus({ preventScroll: true }); try { boardNode.setPointerCapture(e.pointerId); } catch (_) {} drawRings();
  });
  const tapsChoose = () => phase === 'camera' || phase === 'prompt' || (phase === 'pointer' && prefs.select === 'tap');
  function release(e) {
    const g = gestures.get(e.pointerId); if (!g) return;
    const at = e.type === 'lostpointercapture' ? g.last : e;
    gestures.delete(e.pointerId); try { boardNode.releasePointerCapture(e.pointerId); } catch (_) {}
    const travel = Math.max(g.travel, Math.hypot(at.clientX - g.x, at.clientY - g.y)), p = nearest(at);
    if (travel > 12 || !p || !tapsChoose()) return;
    // A tap on the dimmed first board means play by touch.
    if (phase === 'prompt') toPointer();
    focus = p; flip(...p);
  }
  const same = (a, b) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
  window.addEventListener('pointermove', e => {
    const g = gestures.get(e.pointerId);
    if (g) {
      g.last = { clientX: e.clientX, clientY: e.clientY };
      g.travel = Math.max(g.travel, Math.hypot(e.clientX - g.x, e.clientY - g.y));
      if (e.pointerType === 'mouse' && e.buttons === 0) release(e);
    }
    if (e.pointerType !== 'touch' || e.buttons) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); }
    if (e.pointerType === 'mouse' && !$('dialog[open]') && phase === 'pointer' && prefs.select === 'tap') { const p = nearest(e); if (!same(p, hover)) { hover = p; drawRings(); } }
  });
  window.addEventListener('pointerdown', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); });
  for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, e => { if (e.pointerType === 'touch') pointer.present = false; });
  document.documentElement.addEventListener('pointerleave', () => { pointer.present = false; });
  window.addEventListener('pointerup', release);
  // Capture lost before the release counts as the release. Lost while still
  // pressed, the press waits for its pointerup on the window.
  boardNode.addEventListener('lostpointercapture', e => { if (e.buttons === 0) release(e); });
  window.addEventListener('pointercancel', e => { gestures.delete(e.pointerId); });
  boardNode.addEventListener('pointerleave', () => { if (hover) { hover = null; drawRings(); } });
  boardNode.addEventListener('focus', () => { if (!gestures.size) keyboard = true; drawRings(); chrome(); });
  boardNode.addEventListener('blur', () => { keyboard = false; drawRings(); });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape' && ['starting', 'calibrating'].includes(phase)) { e.preventDefault(); stopCamera(); return; }
    if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); undo(); return; }
    if (key === 'h') { e.preventDefault(); enqueue({ type: 'hint' }); return; }
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
    if (d) {
      e.preventDefault();
      // Arrows step over empty places to the next tile in that direction.
      let [r, c] = focus; for (let k = 0; k < 5; k++) { r += d[0]; c += d[1]; if (r < 0 || c < 0 || r >= rowsOf() || c >= colsOf()) break; if (present(r, c)) { focus = [r, c]; break; } }
      keyboard = true; hover = null; boardNode.focus({ preventScroll: true }); drawRings(); chrome();
    }
    if ((key === 'Enter' || key === ' ') && e.target === boardNode && present(...focus) && phase !== 'calibrating' && phase !== 'starting') { e.preventDefault(); if (phase === 'prompt') toPointer(); flip(...focus); }
  });
  for (const name of ['dragstart', 'selectstart', 'contextmenu']) boardNode.addEventListener(name, e => e.preventDefault());

  // ---- Chrome, sheets and settings.
  for (const [id, d] of Object.entries(icons)) if (id !== 'camera') $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  $('#camera-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.camera}"/><circle class="lens-dot" cx="12" cy="13" r="1.6"/></svg>`;
  $('#camera-start').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.camera}"/></svg>`;
  // Undo, Hint and Next answer a click or tap in every mode, but never twice
  // for one rest: a click just after a held look fired them does nothing, and
  // a click counts as that rest's choice, so a pointer left resting there
  // does not fire them again.
  const once = (id, run) => () => {
    if (dwellOn()) {
      if (dwell.blocked === id) return;
      if (phase !== 'camera') { const t = id === 'next' ? nextTarget() : toolTargets().find(x => x.id === id); if (t) dwell.hold(t); }
    }
    run();
  };
  $('#undo-btn').onclick = once('tool:undo', undo); $('#restart-btn').onclick = restart; $('#hint-btn').onclick = once('tool:hint', () => enqueue({ type: 'hint' }));
  $('#next-btn').onclick = once('next', () => next());
  $('#camera-start').onclick = () => startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  $('#camera-btn').onclick = () => { if (['starting', 'calibrating', 'camera'].includes(phase)) stopCamera(); else startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input); };
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').onclick = () => { gestures.clear(); hover = null; drawRings(); $('#' + id).showModal(); };
    $('#' + id).addEventListener('close', () => { $('#' + id + '-btn').focus(); afterBoardChange(); });
  }
  $('#input').onchange = e => {
    const mode = e.target.value;
    if (mode === 'pointer') { if (phase !== 'pointer') stopCamera(); else { prefs.input = 'pointer'; save(); chrome(); } return; }
    $('#settings').close();
    if (['calibrating', 'camera'].includes(phase) && (T.running || virtual)) { prefs.input = mode; lastCamera = mode; save(); beginCalibration(!G.current(calibration[mode])); [fu, fv] = filters(); }
    else startCamera(mode);
  };
  $('#select').onchange = e => { prefs.select = e.target.value; save(); setPhase(phase); announce(prefs.select === 'dwell' ? 'Choose by looking and holding.' : 'Choose by tapping.'); };
  $('#rewards').onchange = e => { prefs.rewards = e.target.value; save(); if (prefs.rewards === 'calm') stopShow(); if (!busy) rest(); announce(prefs.rewards === 'calm' ? 'Calm: paper and ink only.' : 'Colour rewards.'); };
  $('#sound').onchange = e => { prefs.sound = e.target.value; save(); if (prefs.sound === 'on') { sound.start(); sound.tick(4); } announce(prefs.sound === 'on' ? 'Sound on.' : 'Sound off.'); };
  $('#dwell').onchange = e => { prefs.dwell = +e.target.value; dwell.time = prefs.dwell; save(); announce(`Hold for ${prefs.dwell / 1000} seconds.`); };
  $('#calibrate').onclick = () => { $('#settings').close(); if (prefs.input === 'pointer') return; if (phase === 'camera' || phase === 'calibrating') beginCalibration(true); else startCamera(prefs.input, { full: true }); };
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.motion = prefs.motion;
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion;
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (reduced()) animation?.finish();
    if (!busy) rest(); else draw();
  }
  for (const id of ['theme', 'motion']) $('#' + id).onchange = e => { prefs[id] = e.target.value; applyPrefs(); save(); announce(id === 'theme' ? 'Theme changed.' : 'Motion setting changed.'); };
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { fit(); draw(); settleLook(); placeGlyphSoon(); wake(); });
  // A hidden page finishes its motion at once and stops the camera; coming
  // back starts it again where play left off.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      animation?.finish(); pointer.present = false;
      if (T.running || phase === 'starting') { resumeOnShow = true; T.stop(); if (phase === 'starting') setPhase(prefs.input === 'pointer' ? 'pointer' : 'prompt'); }
    } else if (resumeOnShow) {
      resumeOnShow = false;
      if (phase === 'camera' || phase === 'calibrating') T.start().then(() => { setFace(false); dwell.reset(); freshHold = true; }, () => { if (phase === 'camera' || phase === 'calibrating') fallback(); });
      else if (phase === 'prompt') startCamera(prefs.input);
    }
  });

  // ---- The test hook.
  window.__glance = {
    boards,
    get board() { return board.id; },
    get state() { return { rows: rowsOf(), cols: colsOf(), grid: copy(grid), solved: E.solved(board, grid), light: lightCount(grid), hits, par: parOf(board), hint: hint && { ...hint }, focus: focus.slice() }; },
    get reached() { return reached; },
    get payoff() { return { ...payoffStats, showing: !!show, context: !!sound.context, rewards: prefs.rewards, sound: prefs.sound }; },
    get input() { return { phase, mode: prefs.input, select: prefs.select, dwell: prefs.dwell, camera: { ...T.status(), virtual }, face, calibrating: calib && { step: calib.step, of: calib.spots.length, progress: calib.progress, full: calib.full }, gaze: gaze && { ...gaze }, current: dwell.current && dwell.current.id, blocked: dwell.blocked, rings: dwell.rings(), calibration: JSON.parse(JSON.stringify(calibration)) }; },
    flip, undo, restart, go, next, hint: () => enqueue({ type: 'hint' }),
    center(r, c) { const t = geo.cells.get(r + ',' + c); return t && { x: t.x + t.w / 2, y: t.y + t.h / 2, size: t.w }; },
    geometry() { const box = id => { const n = $('#' + id), b = n.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }; return { s: geo.s, band: geo.band, dead: geo.dead, rect: { ...geo.rect }, area: { ...geo.area }, tool: toolSize(), tools: { undo: box('undo-btn'), hint: box('hint-btn') }, targets: toolTargets().map(t => t.id), next: nextTarget(), glyph: glyphTarget(), spots: G.SPOTS.map(p => toScreen(p.u, p.v)) }; },
    toScreen, targetAt: (x, y) => { const t = targetAt(x, y); return t && t.id; },
    // Synthetic looks for tests: a face reading through the whole pipeline,
    // or a point on the page straight into look and hold.
    face: (result, t) => processFace(result, t),
    look: (x, y, t) => { if (dwellOn() || phase === 'prompt') feed(t, x, y); },
    // A camera with no stream, for tests: the same phases and pipeline.
    simulate(mode, { full = true } = {}) { virtual = true; showLive(true); prefs.input = mode; lastCamera = mode; save(); beginCalibration(full || !G.current(calibration[mode])); },
    calibrate: full => beginCalibration(full)
  };
  window.__minimalize = { bounds() {
    // The frame is the outermost line drawn; add its half-pixel hairline.
    const b = frameNode.getBoundingClientRect();
    return { x: b.x - .5, y: b.y - .5, width: b.width + 1, height: b.height + 1 };
  } };
  fit(); applyPrefs(); rest(); save(); focus = firstTile();
  // The shared control frame and the fonts may settle the page after this
  // first layout; measure again once they have.
  addEventListener('load', () => { fit(); draw(); placeGlyphSoon(); wake(); });
  // The frame moves Next by setting properties on the body; follow it.
  new MutationObserver(() => { if (!$('#camera-start').hidden) placeGlyphSoon(); }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  // A camera player is asked once per visit with one glyph; a camera already
  // allowed starts by itself, and a refused one leaves play to the pointer.
  if (prefs.input === 'pointer') setPhase('pointer');
  else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { prefs.input = 'pointer'; save(); setPhase('pointer'); }
  else { setPhase('prompt'); permission().then(state => { if (phase !== 'prompt') return; if (state === 'granted') startCamera(prefs.input); else if (state === 'denied') fallback(); }); }
})();
