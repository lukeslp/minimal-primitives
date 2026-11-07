/* Sweep. By Luke Steuber. */
(function () {
  'use strict';
  const E = GlanceEngine, boards = GlanceBoards, S = SweepScan, P = SweepPayoff;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = 'sweep.v1';
  const boardNode = $('#board'), layer = $('#scan-layer'), payoffLayer = $('#payoff-layer');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), smooth = x => x * x * (3 - 2 * x), copy = E.copy;
  const SETTINGS = { mode: ['auto', 'step', 'hold'], speed: ['slow', 'normal', 'fast'], release: S.RELEASES, presstime: S.PRESS_TIMES, longpress: S.LONG_PRESSES, rest: S.RESTS, highlight: ['outline', 'invert'], rewards: ['colour', 'calm'], sound: ['off', 'ticks', 'tones'], theme: ['system', 'light', 'dark'], motion: ['system', 'reduce'] };

  // Saved play: the board, its tiles, the presses, the undo history,
  // finished boards and settings. Every board is open from the start.
  let board = boards[0], grid = E.start(board), hits = 0, history = [], finished = new Set();
  let prefs = { mode: 'auto', speed: 'normal', release: 100, presstime: 0, longpress: 1500, rest: 0, highlight: 'outline', rewards: 'colour', sound: 'off', theme: 'system', motion: 'system' };
  let protectSave = false;
  const validGrid = (g, b) => Array.isArray(g) && g.length === b.cells.length && g.every((row, r) => Array.isArray(row) && row.length === b.cells[r].length && row.every((v, c) => b.cells[r][c] === '.' ? v === null : v === 0 || v === 1));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(x => x.id === s?.board);
      if (!b || s.v !== 1 || !validGrid(s.grid, b) || !Number.isSafeInteger(s.hits) || s.hits < 0) throw Error('Invalid save');
      if (!Array.isArray(s.history) || s.history.length > 5000 || !s.history.every(g => validGrid(g, b))) throw Error('Invalid save');
      if (!Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id))) throw Error('Invalid save');
      // The recovery options came later: a save without them takes their
      // defaults (Long press on at 1.5 s, the others off).
      const later = { presstime: 0, longpress: 1500, rest: 0 }, settings = s.settings && { ...later, ...Object.fromEntries(Object.entries(s.settings).filter(([, v]) => v !== undefined)) };
      // A setting this version does not know falls back to its default rather than
      // discarding the whole save (which used to stop saving progress for good).
      if (settings) for (const [k, v] of Object.entries(SETTINGS)) if (!v.includes(settings[k])) settings[k] = prefs[k];
      if (!settings) throw Error('Invalid save');
      board = b; grid = copy(s.grid); hits = s.hits; history = s.history.map(copy); finished = new Set(s.finished); prefs = settings;
    }
  } catch (_) { protectSave = true; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, board: board.id, grid, hits, history, finished: [...finished], settings: prefs })); } catch (_) {}
  }
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const rowsOf = () => board.cells.length, colsOf = () => board.cells[0].length, present = (r, c) => r >= 0 && c >= 0 && r < rowsOf() && c < colsOf() && board.cells[r][c] !== '.';
  const solved = () => E.solved(board, grid), last = () => boards.indexOf(board) === boards.length - 1;
  const lightCount = g => g.flat().filter(v => v === 1).length;
  const pars = new Map(), parOf = (b, mode = prefs.mode) => { const k = b.id + mode; if (!pars.has(k)) pars.set(k, S.par(E, b, mode)); return pars.get(k); };
  function announce(text) { $('#announcement').textContent = text; }
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) n.setAttribute(key, value);
    if (parent) parent.append(n); return n;
  }
  function set(n, attrs) {
    n.cache ||= {};
    for (const key in attrs) { const v = attrs[key]; if (n.cache[key] === v) continue; if (v === null || v === undefined) n.removeAttribute(key); else n.setAttribute(key, v); n.cache[key] = v; }
  }

  // ---- The scan. Its rows are the board's rows that hold tiles, then one
  // row of controls: Undo (once there is a move) and Hint. Each row ends in a
  // back stop that returns to the rows. A finished board is scanned across
  // Next and Undo alone, Next first; after the last board nothing is scanned.
  let scan = null, hint = null;
  const lineup = () => S.boardRows(board);
  const controlRow = () => lineup().length;
  function rowsNow() {
    if (solved()) return last() ? [] : [['next', ...(history.length ? ['undo'] : [])]];
    return lineup().map(x => x.cells.map(c => `cell:${x.r}:${c}`).concat('back')).concat([[...(history.length ? ['undo'] : []), 'hint', 'back']]);
  }
  const delay = () => S.SPEEDS[prefs.speed];
  // Row scanning starts again at `row`, after the short pause.
  function resume(row = 0, t = performance.now(), resting = false) { scan = S.start(rowsNow(), { mode: prefs.mode, delay: delay(), t, row, loop: solved(), rest: prefs.rest, resting }); shown = null; shownPos = null; wake(); }
  // The row the scan is on now: the one highlighted, or the one being crossed.
  const here = (t = performance.now()) => Math.max(0, S.at(scan, t).row);
  const locate = id => { for (const [row, items] of scan.rows.entries()) { const item = items.indexOf(id); if (item >= 0) return { row, item }; } return null; };
  // What a perfect scanner pays to choose a scan row's item from row `from`:
  // two presses in auto-scan; in step-scan also a step for each row down to
  // it (wrapping past the controls) and for each item before it.
  function reach(row, item, from = here()) {
    const n = lineup().length + 1;
    return prefs.mode === 'step' ? ((row - from) % n + n) % n + item + 2 : 2;
  }

  // ---- Layout. The board fills the largest fit between the header and the
  // toolbar, by height as well as width, inside a narrow side band, and stays
  // clear of the Next disc, as Glance's does. Each side keeps room for a
  // row's back stop (drawn at the right while a row is crossed), so the board
  // stays centred and the back stops stay inside the fit.
  const M = .12, MX = .58, HALF = .41, BACK = { x: .16, size: .34, pad: .04 }, GAP = 12;
  const geo = { s: 60, ox: 0, oy: 0, rect: null, area: null, band: 12, version: 0 };
  const railMode = () => matchMedia('(max-height:520px) and (min-width:560px)').matches;
  const visibleTools = () => [...document.querySelectorAll('.toolbar button')].filter(n => n.offsetParent !== null);
  function fit() {
    // The old board must not hold the page wide while it is measured: on a
    // phone a page wider than the screen widens the viewport it reports.
    boardNode.style.width = boardNode.style.height = '0px'; document.documentElement.getBoundingClientRect();
    const rows = rowsOf(), cols = colsOf(), short = Math.min(innerWidth, innerHeight), band = Math.max(10, Math.round(short * .03));
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
    const inset = Math.max(band, restart.right + 6), size = (l, r, t) => Math.min((r - l) / (cols + 2 * MX), (bottom - t) / (rows + 2 * M));
    const wide = { left: band, right, top: Math.max(band, restart.bottom + GAP) }, high = { left: inset, right: Math.min(right, innerWidth - inset), top: Math.max(band, readout.bottom + 6) };
    const pick = size(high.left, high.right, high.top) > size(wide.left, wide.right, wide.top) ? high : wide, { left, top } = pick;
    right = pick.right;
    const s = Math.max(24, Math.floor(size(left, right, top) * 2) / 2);
    geo.area = { x: left, y: top, w: right - left, h: bottom - top }; geo.band = band;
    Object.assign($('#board-shell').style, { top: top + 'px', left: left + 'px', right: innerWidth - right + 'px', bottom: innerHeight - bottom + 'px' });
    boardNode.setAttribute('viewBox', `${-M} ${-M} ${cols + 2 * M} ${rows + 2 * M}`);
    boardNode.style.width = (cols + 2 * M) * s + 'px'; boardNode.style.height = (rows + 2 * M) * s + 'px';
    const r = boardNode.getBoundingClientRect();
    Object.assign(geo, { s, ox: r.left + M * s, oy: r.top + M * s, rect: { left: r.left + M * s, top: r.top + M * s, right: r.left + (cols + M) * s, bottom: r.top + (rows + M) * s } });
    geo.version++; shown = null;
  }

  // ---- The board: tiles that turn over, and a dashed ring for a hint.
  let tiles = new Map(), ringLayer = null, frameNode = null, built = null, band = null, banded = [];
  let display = { before: grid, after: grid, t: 1, at: null, settle: 0 }, animation = null;
  function build() {
    boardNode.replaceChildren();
    const rows = rowsOf(), cols = colsOf();
    frameNode = svg('rect', { class: 'frame', x: -.1, y: -.1, width: cols + .2, height: rows + .2 }, boardNode);
    // The Invert highlight: an ink band behind the framed row or tile.
    band = svg('rect', { class: 'band', display: 'none' }, boardNode); banded = [];
    const g0 = svg('g', { id: 'tiles', 'aria-hidden': 'true' }, boardNode);
    tiles = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (present(r, c)) {
      const g = svg('g', { class: 'tile', 'data-r': r, 'data-c': c }, g0), face = svg('rect', { class: 'face' }, g), paint = svg('rect', { class: 'paint', opacity: 0 }, g);
      tiles.set(r + ',' + c, { g, face, paint, r, c });
    }
    ringLayer = svg('g', { id: 'rings', 'aria-hidden': 'true' }, boardNode);
    built = board;
  }
  // A turning tile shows its old face while it narrows and its new one as it
  // widens, the chosen tile first and its neighbours a moment after.
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
      set(t.paint, { x: -h, y: -h, width: 2 * h, height: 2 * h });
    }
    boardNode.dataset.solved = String(solved()); boardNode.dataset.settle = String(+display.settle.toFixed(3)); boardNode.dataset.moving = String(display.t < 1);
  }
  function drawRings() {
    ringLayer.replaceChildren();
    if (!hint || !present(hint.r, hint.c)) return;
    const tone = grid[hint.r][hint.c] ? 'on-light' : 'on-dark';
    svg('circle', { class: 'ring-halo ' + tone, cx: hint.c + .5, cy: hint.r + .5, r: .27 }, ringLayer);
    svg('circle', { class: 'hint-ring ' + tone, cx: hint.c + .5, cy: hint.r + .5, r: .27 }, ringLayer);
  }
  function draw() { if (built !== board) build(); drawTiles(); drawRings(); }
  function rest() { animation?.finish(); epoch++; display = { before: grid, after: grid, t: 1, at: null, settle: solved() ? 1 : 0 }; draw(); }
  // A hidden page runs no frames, so motion there settles at once.
  function tween(duration, paint) {
    if (reduced() || document.hidden) { paint(1); return Promise.resolve(false); }
    return new Promise(resolve => {
      const start = performance.now(); let id;
      function finish() { cancelAnimationFrame(id); animation = null; paint(1); resolve(false); }
      function frame(now) { const t = clamp((now - start) / duration, 0, 1); paint(t); if (t < 1) id = requestAnimationFrame(frame); else { animation = null; resolve(true); } }
      animation = { finish }; paint(0); id = requestAnimationFrame(frame);
    });
  }
  // A turn is played at once, and saved before any motion; the motion only shows it.
  let epoch = 0;
  async function show(before, at) {
    animation?.finish();
    const token = ++epoch, settled = display.settle;
    display = { before, after: grid, t: 0, at, settle: settled };
    await tween(300, t => { display.t = t; display.settle = settled * (1 - smooth(Math.min(1, t * 2))); draw(); });
    if (token !== epoch) return;
    display = { before: grid, after: grid, t: 1, at: null, settle: 0 }; draw();
    // The finished board settles once: the gaps close and the tiles hold still.
    if (solved()) await tween(520, t => { if (token === epoch) { display.settle = 1 - (1 - t) ** 3; draw(); } });
  }

  function chrome() {
    const i = boards.indexOf(board), done = solved(), par = parOf(board);
    $('#readout').textContent = `${i + 1} / ${boards.length} · ${hits} / ${par}`;
    $('#readout').setAttribute('aria-label', `Board ${i + 1} of ${boards.length}; ${hits} presses; par ${par}`);
    boardNode.setAttribute('aria-label', `Board ${i + 1}, ${rowsOf()} rows by ${colsOf()} columns. ${done ? 'Every tile dark.' : lightCount(grid) + ' light tiles.'} ${hits} presses, par ${par}. ${{ step: 'Space steps the frame, Enter chooses.', hold: 'Hold any key to move the frame; let go to choose.', auto: 'Press any key as the frame passes your row, then your tile.' }[prefs.mode]}`);
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = done;
    $('#next-btn').hidden = !done || last();
    $('#speed').disabled = prefs.mode === 'step';
    // Long press is the take-back for auto- and step-scan; in Hold to move,
    // holding is the movement. Rest after is for auto-scan, which moves by
    // itself. Out of their modes the rows rest, saying why.
    reason('longpress', prefs.mode === 'hold' ? 'Not with Hold to move' : null);
    reason('rest', prefs.mode !== 'auto' ? 'Auto-scan only' : null);
    catalog();
  }
  function reason(id, why) {
    const n = $('#' + id); let o = n.querySelector('option[data-reason]');
    if (why) { if (!o) { o = document.createElement('option'); o.dataset.reason = ''; o.value = 'reason'; n.append(o); } o.textContent = why; n.value = 'reason'; n.disabled = true; }
    else { if (o) o.remove(); n.disabled = false; n.value = String(prefs[id]); }
  }
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
      const button = list.children[i].firstChild, now = b === board, done = finished.has(b.id);
      button.dataset.state = now ? 'current' : done ? 'completed' : 'available';
      button.querySelector('.catalog-state').textContent = [now ? 'Current' : null, done ? 'Completed' : null, !now && !done ? 'Available' : null].filter(Boolean).join(' · ');
      if (now) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }

  // ---- Moves. Presses are counted as they happen; a move only changes the board.
  function turn(r, c) {
    const before = grid;
    history.push(copy(grid)); grid = E.flip(board, grid, r, c); hint = null;
    if (solved()) finished.add(board.id);
    chrome(); save(); show(before, [r, c]);
    bloomAt(r, c);
    if (solved()) { paintBoard([r, c], true); sound('solve'); } else sound('act', history.length - 1);
    if (solved()) announce(`Every tile dark in ${hits} presses. Par ${parOf(board)}. ${last() ? 'Every board is finished.' : 'Next board is ready.'}`);
    else announce(`Row ${r + 1}, column ${c + 1} turned. ${lightCount(grid)} light. ${hits} presses.`);
  }
  function takeBack() {
    const previous = history.pop(); if (!previous) return false;
    const before = grid; grid = previous; hint = null; unpaint();
    chrome(); save(); show(before, null); announce(`Move undone. ${hits} presses.`);
    return true;
  }
  // Hint marks the first tile of the perfect scanner's way from the row the
  // scan is on; on board 1 it is shown from the start.
  function mark(from = here()) {
    const p = S.plan(E, board, grid, prefs.mode, from);
    hint = p && p.cells.length ? { r: p.cells[0][0], c: p.cells[0][1] } : null;
    draw(); chrome();
    if (hint) announce(`Hint: row ${hint.r + 1}, column ${hint.c + 1}.`);
  }
  // ---- The payoff: a bloom for every tile chosen, colour for a finished
  // board, held until the next. Calm keeps to paper and ink.
  const payoff = { blooms: 0, fills: 0, painted: false, last: null };
  const colourful = () => prefs.rewards === 'colour';
  const boardPalette = () => P.palette(boards.indexOf(board), dark());
  function bloomAt(r, c) {
    if (!colourful()) return;
    const x = geo.ox + (c + .5) * geo.s, y = geo.oy + (r + .5) * geo.s;
    P.bloom(payoffLayer, x, y, geo.s, boardPalette(), reduced() || document.hidden, (r * 7 + c * 3) % 8 / 8);
    payoff.blooms++; payoff.last = reduced() ? 'fade' : 'bloom';
  }
  function paintBoard(at, animate) {
    if (built !== board) build();
    if (!colourful() || !solved()) { unpaint(); return; }
    const list = [...tiles.values()], b = geo.rect, centre = { x: geo.ox + (at[1] + .5) * geo.s, y: geo.oy + (at[0] + .5) * geo.s };
    const reach = Math.max(...[[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].map(([x, y]) => Math.hypot(x - centre.x, y - centre.y)));
    P.fill(list, at, boardPalette(), { layer: payoffLayer, centre, reach, reduced: reduced() || document.hidden, animate });
    payoff.painted = true; payoff.at = at; if (animate) payoff.fills++;
    boardNode.dataset.painted = 'true';
  }
  function unpaint() { if (payoff.painted) P.clear([...tiles.values()]); payoff.painted = false; boardNode.dataset.painted = 'false'; }
  let generation = 0;
  function fresh() {
    generation++; grid = E.start(board); hits = 0; history = []; hint = null; fit(); rest(); unpaint(); chrome(); save();
    if (boards.indexOf(board) === 0) { const h = E.hint(board, grid); hint = h; draw(); }
    resume(0);
  }
  function go(id) {
    const b = boards.find(x => x.id === id); if (!b) return false;
    board = b; fresh(); announce(`Board ${boards.indexOf(b) + 1}.`); return true;
  }
  function restart() { fresh(); announce('Board restarted.'); }
  function nextBoard() { const b = boards[boards.indexOf(board) + 1]; return b && solved() ? go(b.id) : false; }

  // ---- The switch. A press is judged at the moment it went down.
  let gate = S.gate(prefs.release);
  let switches = 0;
  function press(channel, t) {
    if (!scan || !scan.rows.length || $('dialog[open]')) return null;
    t = Math.min(t, performance.now()); switches++;
    if (solved() === false) hits++;
    // Where the press found the scan, for a long press to step back from.
    const was = S.at(scan, t), wasLoop = scan.loop, gen = generation;
    const r = S.press(scan, t, channel === 'step' ? 'step' : 'select');
    scan = r.scan; if (!r.chosen) sound('press'); else if (!r.chosen.id.startsWith('cell:')) sound('choose');
    if (r.woke) { announce('Scanning from the top.'); chrome(); save(); wake(); return null; }
    const did = { phase: was.phase, row: was.row, loop: wasLoop, gen, entered: !r.chosen && scan.phase === 'cols' ? r.row : -1, turned: r.chosen && r.chosen.id.startsWith('cell:') ? history.length + 1 : 0 };
    if (r.chosen) choose(r.chosen, t);
    else {
      if (scan.phase === 'cols' && r.row >= 0 && !r.gaveUp) announce(r.row === controlRow() ? 'Controls.' : `Row ${lineup()[r.row].r + 1}.`);
      if (r.gaveUp) announce('Back to the rows.');
      chrome(); save();
    }
    wake(); return did;
  }
  // What a chosen item does. After it, row scanning resumes at the row it was in.
  function choose(c, t) {
    if (c.id === 'next') { nextBoard(); return; }
    if (c.id === 'undo') { takeBack(); resume(solved() ? 0 : controlRow(), t); return; }
    if (c.id === 'hint') { mark(c.row); resume(c.row, t); return; }
    if (c.id === 'back') { resume(c.row, t); announce('Back to the rows.'); chrome(); save(); return; }
    const [, r, col] = c.id.split(':').map(Number);
    turn(r, col); resume(c.row, t);
  }
  // The toolbar, for pointers: Undo and a played hint cost what a perfect
  // scanner would pay for them from where the scan is; a finished board's
  // Undo and Next are free, as with the switch.
  function undoButton() {
    if (!history.length) return;
    if (!solved()) hits += reach(controlRow(), 0);
    takeBack(); resume(controlRow());
  }
  function hintButton() {
    if (solved()) return;
    if (hint) {
      const at = locate(`cell:${hint.r}:${hint.c}`), { r, c } = hint;
      hits += reach(at.row, at.item); turn(r, c); resume(at.row); return;
    }
    mark();
  }

  // ---- The scanning frame, drawn when it moves. Outline: a heavy square
  // frame round what is offered, a hairline round the row being crossed.
  // Invert: what is offered sits on an ink band instead, its tiles edged in
  // the page colour, so it is told by lightness over a larger area.
  let shown = null, shownPos = null, rafId = 0, lastSound = null, inverted = [];
  const fill = svg('rect', { class: 'hl-fill', display: 'none' }, layer), rowRect = svg('rect', { class: 'hl heavy' }, layer), itemRect = svg('rect', { class: 'hl heavy' }, layer), ring = svg('circle', { class: 'hl-ring' }, layer);
  const backIcon = svg('path', { class: 'back-icon', d: 'M12 19V5M6 11l6-6 6 6', display: 'none' }, layer);
  const box = n => { const b = n.getBoundingClientRect(); return b.width ? b : null; };
  const nodeOf = id => $('#' + id + '-btn');
  const union = bs => bs.length ? { left: Math.min(...bs.map(b => b.left)), top: Math.min(...bs.map(b => b.top)), right: Math.max(...bs.map(b => b.right)), bottom: Math.max(...bs.map(b => b.bottom)) } : null;
  // The row of controls frames only the buttons it offers now.
  const controlsBox = () => union(['undo', 'hint'].filter(id => scan.rows[controlRow()]?.includes(id)).map(id => box(nodeOf(id))).filter(Boolean));
  const rectAttrs = (b, grow, heavy) => ({ x: (b.left - grow).toFixed(1), y: (b.top - grow).toFixed(1), width: (b.right - b.left + 2 * grow).toFixed(1), height: (b.bottom - b.top + 2 * grow).toFixed(1), class: 'hl ' + (heavy ? 'heavy' : 'thin'), display: null });
  const cellBox = (r, c) => ({ left: geo.ox + c * geo.s, top: geo.oy + r * geo.s, right: geo.ox + (c + 1) * geo.s, bottom: geo.oy + (r + 1) * geo.s });
  // A row's back stop: a small square past the row's right end, or beside
  // Hint for the row of controls (below it when the toolbar is a side rail).
  function backBox(row) {
    if (row === controlRow()) {
      const h = box(nodeOf('hint')), u = box(nodeOf('undo')); if (!h) return null;
      const rail = u && u.left === h.left && u.top < h.top;
      return rail ? { left: h.left, top: h.bottom + 4, right: h.right, bottom: h.bottom + 4 + h.height } : { left: h.right + 4, top: h.top, right: h.right + 4 + h.width, bottom: h.bottom };
    }
    const x = lineup()[row]; if (!x) return null;
    const cx = geo.ox + (colsOf() + BACK.x + BACK.size / 2) * geo.s, cy = geo.oy + (x.r + .5) * geo.s, half = BACK.size / 2 * geo.s;
    return { left: cx - half, top: cy - half, right: cx + half, bottom: cy + half };
  }
  // The row as framed: the board's row (with its back stop while it is
  // crossed), or the Undo and Hint buttons.
  function rowBox(row, crossing) {
    if (row === controlRow() && !scan.loop) { const b = controlsBox(); return crossing ? union([b, backBox(row)].filter(Boolean)) : b; }
    const x = lineup()[row]; if (!x) return null;
    return { left: geo.ox, top: geo.oy + x.r * geo.s, right: crossing ? geo.ox + (colsOf() + BACK.x + BACK.size + BACK.pad) * geo.s : geo.ox + colsOf() * geo.s, bottom: geo.oy + (x.r + 1) * geo.s };
  }
  function invertOn(b, buttons, tilesIn, glyph) {
    set(fill, b ? { ...rectAttrs(b, 0, true), class: 'hl-fill' } : { display: 'none' });
    for (const n of buttons) n.classList.add('inv');
    for (const t of tilesIn) t.g.classList.add('banded');
    inverted = [...buttons, ...tilesIn.map(t => t.g)];
    if (glyph) backIcon.classList.add('inv');
  }
  function drawScan(now) {
    if (!scan) return;
    const before = scan.phase;
    scan = S.settle(scan, now);
    if (before === 'cols' && scan.phase === 'rows') announce('Back to the rows.');
    const p = S.at(scan, now), open = !!$('dialog[open]');
    // On the controls the key also carries where they stand, since the shared
    // frame may move the Next disc a frame after it appears.
    const onControls = p.phase !== 'none' && (scan.loop || p.row === controlRow());
    const where = onControls ? ['undo', 'hint', 'next'].map(id => { const b = box(nodeOf(id)); return b ? Math.round(b.left) + ',' + Math.round(b.top) : '-'; }).join(';') : '';
    const key = open ? 'paused' : [p.phase, p.row, p.item, geo.version, where, prefs.highlight].join(':');
    if (key === shown) return;
    const pos = [p.phase, p.row, p.item].join(':'), moved = shownPos !== null && shownPos !== pos && !open && p.phase !== 'none';
    shown = key; shownPos = open ? null : pos; layer.dataset.phase = open ? 'paused' : p.phase; layer.dataset.row = p.row; layer.dataset.item = p.item;
    for (const n of [fill, rowRect, itemRect, ring, backIcon]) set(n, { display: 'none' });
    for (const n of inverted) n.classList.remove('inv', 'banded'); inverted = []; backIcon.classList.remove('inv');
    if (band) set(band, { display: 'none' });
    // A scan resting after its passes hides its frame until the next press.
    if (p.phase === 'rest' && !open) announce('Scan resting. Press to start again.');
    if (open || p.phase === 'none' || p.phase === 'rest') return;
    const invert = prefs.highlight === 'invert', control = p.row === controlRow() && !scan.loop;
    // The back stop's arrow shows while its row is crossed.
    if (p.phase === 'cols' && !scan.loop) { const b = backBox(p.row); if (b) { const k = (b.right - b.left) / 24 * .62, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2; set(backIcon, { display: null, transform: `translate(${(cx - 12 * k).toFixed(1)} ${(cy - 12 * k).toFixed(1)}) scale(${k.toFixed(3)})` }); } }
    if (p.phase === 'rows') {
      const b = rowBox(p.row, false);
      if (b && invert) { if (control) invertOn(b, [nodeOf('hint'), ...(scan.rows[p.row].includes('undo') ? [nodeOf('undo')] : [])], [], false); else { const r = lineup()[p.row].r; set(band, { display: null, x: 0, y: r, width: colsOf(), height: 1 }); invertOn(null, [], [...tiles.values()].filter(t => t.r === r), false); } }
      else if (b) set(rowRect, rectAttrs(b, control ? 2 : 0, true));
    } else {
      if (!scan.loop) { const b = rowBox(p.row, true); if (b) set(rowRect, rectAttrs(b, control ? 2 : 0, false)); }
      if (p.id.startsWith('cell:')) {
        const [, r, c] = p.id.split(':').map(Number);
        if (invert) { set(band, { display: null, x: c, y: r, width: 1, height: 1 }); invertOn(null, [], [tiles.get(r + ',' + c)].filter(Boolean), false); }
        else set(itemRect, rectAttrs(cellBox(r, c), 0, true));
      } else if (p.id === 'next') { const b = box($('#next-btn')); if (b) set(ring, { cx: ((b.left + b.right) / 2).toFixed(1), cy: ((b.top + b.bottom) / 2).toFixed(1), r: (b.width / 2 + 7).toFixed(1), display: null }); }
      else {
        const b = p.id === 'back' ? backBox(p.row) : box(nodeOf(p.id));
        if (b && invert) invertOn(b, p.id === 'back' ? [] : [nodeOf(p.id)], [], p.id === 'back');
        else if (b) set(itemRect, rectAttrs(b, p.id === 'back' ? 0 : 2, true));
      }
    }
    if (moved) sound('tick', p);
  }
  // While a long press builds (Long press on, after the press has acted), a
  // thin ink ring fills round what is framed now. It starts only after
  // 0.4 s of holding, so an ordinary press never shows it, and fills to full
  // at the long press; with reduced motion it fills in four steps.
  const RING_AFTER = 400;
  const holdRing = svg('rect', { class: 'hold-ring', display: 'none', pathLength: 100 }, layer);
  function focusBox(p) {
    if (p.phase === 'rows') return rowBox(p.row, false);
    if (p.phase !== 'cols') return null;
    if (p.id.startsWith('cell:')) { const [, r, c] = p.id.split(':').map(Number); return cellBox(r, c); }
    if (p.id === 'back') return backBox(p.row);
    return box(p.id === 'next' ? $('#next-btn') : nodeOf(p.id));
  }
  function drawHoldRing(now) {
    const b = long && !long.fired && !$('dialog[open]') && now - long.t >= RING_AFTER ? focusBox(S.at(scan, now)) : null;
    if (!b) { set(holdRing, { display: 'none' }); return; }
    let f = Math.min(1, Math.max(0, (now - long.t - RING_AFTER) / (prefs.longpress - RING_AFTER))); if (reduced()) f = Math.floor(f * 4) / 4;
    set(holdRing, { ...rectAttrs(b, 6, false), class: 'hold-ring', 'stroke-dasharray': `${(f * 100).toFixed(1)} 100` });
    holdRing.dataset.fill = f.toFixed(2);
  }
  function wake() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function loop(now) { rafId = 0; if (document.hidden) return; drawScan(now); drawHoldRing(now); rafId = requestAnimationFrame(loop); }

  // ---- Sound, off unless chosen, made in the page with no files. Ticks: a
  // quiet tick as the frame moves, a click for a press and a lower one for a
  // choice. Tones, a taste of auditory scanning: each row has its own short
  // tone, rising row by row down the board (the controls lowest), tiles a
  // softer tick, the back stop a low tick.
  const TONES = [392, 440, 494, 587, 659, 784];
  let audio = null;
  function sound(kind, p = null) {
    if (prefs.sound === 'off') return;
    let f, length, level;
    if (kind === 'tick' && prefs.sound === 'tones' && p) {
      if (p.phase === 'rows') [f, length, level] = p.row === controlRow() && !scan.loop ? [294, .09, .04] : [TONES[Math.min(TONES.length - 1, p.row)], .09, .04];
      else [f, length, level] = p.id === 'back' ? [220, .03, .02] : [1500, .02, .012];
    } else if (kind === 'act') [f, length, level] = [P.tick(p || 0), .09, .04];
    else if (kind === 'solve') [f, length, level] = [P.CHORD[0], .5, .035];
    else [f, length, level] = { tick: [1800, .025, .018], press: [1200, .04, .035], choose: [700, .07, .045] }[kind];
    lastSound = { kind, f, level };
    // Browsers start sound only after the player has used the page.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try {
      audio = audio || new AudioContext(); if (audio.state === 'suspended') audio.resume();
      const t0 = audio.currentTime, notes = kind === 'solve' ? P.CHORD.map((n, i) => [n, i * .08]) : [[f, 0]];
      for (const [freq, at] of notes) {
        const t = t0 + at, o = audio.createOscillator(), g = audio.createGain();
        o.type = kind === 'solve' || kind === 'act' ? 'triangle' : 'sine';
        o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(.0001, t + length);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + length + .02);
      }
    } catch (_) {}
  }

  // ---- Input. Any key, a tap anywhere or a click anywhere is the switch, at
  // the moment it went down; in step-scan Enter or the right half chooses and
  // every other key or the left half steps. The toolbar, restart and next
  // buttons and the sheets keep their own pointer roles, and a button reached
  // by Tab keeps Enter and Space.
  let lastInput = 'pointer';
  const passKeys = new Set(['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu', 'OS', 'Fn', 'FnLock', 'Hyper', 'Super', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified']);
  // In hold mode one switch is held at a time: going down starts the travel
  // (and is the press), coming up chooses.
  let holding = null;
  // Recovery, all off unless chosen. Press time: a press counts only once
  // held that long, and chooses what was framed when it went down. Long
  // press: a press held past it takes back its step, once.
  let pending = null, long = null, longs = 0;
  function swDown(key, channel, t) {
    if (!scan || !scan.rows.length || $('dialog[open]')) return;
    if (!S.down(gate, key, prefs.mode === 'step' ? channel : 'one', t)) return;
    if (pending || (prefs.mode === 'hold' && holding !== null)) return;
    if (prefs.presstime > 0) { pending = { key, channel, t, timer: setTimeout(accept, Math.max(0, prefs.presstime - (performance.now() - t))) }; return; }
    act(key, channel, t);
  }
  function accept() { const p = pending; pending = null; if (p && !$('dialog[open]')) act(p.key, p.channel, p.t); }
  function act(key, channel, t) {
    if (prefs.mode === 'hold') { holding = key; press('select', t); return; }
    const did = press(channel, t);
    if (did && prefs.longpress > 0 && !did.loop) {
      long = { key, t, did, fired: false, timer: setTimeout(takeBackStep, Math.max(0, prefs.longpress - (performance.now() - t))) };
      wake();
    }
  }
  function swUp(key, t) {
    S.up(gate, key, t);
    if (pending && pending.key === key) { clearTimeout(pending.timer); pending = null; return; }
    if (long && long.key === key) dropLong();
    if (holding !== key) return;
    holding = null; letGo(t);
  }
  function dropLong() { if (long) clearTimeout(long.timer); long = null; }
  function dropPending() { if (pending) clearTimeout(pending.timer); pending = null; }
  // The long press takes back the press's step, then stands a level up: a
  // tile the press turned turns back (as Undo does; the press still counts);
  // from a row's tiles, or from a row the press chose, the scan goes back to
  // row scanning at that row; from a step through the rows, to the top.
  function takeBackStep() {
    const l = long; if (!l || l.fired) return;
    l.fired = true; longs++;
    const d = l.did;
    if (d.gen !== generation || $('dialog[open]')) return;
    const turned = d.turned && history.length === d.turned && takeBack();
    const row = d.phase === 'cols' ? d.row : d.entered >= 0 ? d.entered : 0;
    resume(row);
    announce((turned ? 'Tile turned back. ' : '') + (d.phase === 'cols' || d.entered >= 0 ? 'Back to the rows.' : 'Back to the top.'));
    chrome(); save();
  }
  function letGo(t) {
    if (!scan || prefs.mode !== 'hold' || $('dialog[open]')) return;
    t = Math.min(t, performance.now());
    const r = S.release(scan, t); scan = r.scan;
    if (r.chosen) { if (!r.chosen.id.startsWith('cell:')) sound('choose'); choose(r.chosen, t); }
    else if (r.row >= 0) { sound('press'); announce(r.row === controlRow() ? 'Controls.' : `Row ${lineup()[r.row].r + 1}.`); chrome(); }
    wake();
  }
  // A hold broken off (a lost window, a sheet) chooses nothing.
  function dropHold() { holding = null; if (scan) scan = S.cancel(scan, performance.now()); }
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab') lastInput = 'keyboard';
    if ($('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || passKeys.has(e.key) || /^F\d+$/.test(e.key)) return;
    if (e.target.closest && e.target.closest('select,input,textarea,dialog')) return;
    if (e.target.matches && e.target.matches('button') && (e.key === 'Enter' || e.key === ' ') && lastInput === 'keyboard') return;
    e.preventDefault();
    if (e.repeat) return;
    swDown('k:' + (e.code || e.key), e.key === 'Enter' ? 'select' : 'step', e.timeStamp);
  });
  document.addEventListener('keyup', e => swUp('k:' + (e.code || e.key), e.timeStamp));
  const chromeTarget = t => t.closest && t.closest('button,select,a,label,dialog,input,textarea');
  document.addEventListener('pointerdown', e => {
    lastInput = 'pointer';
    if (chromeTarget(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    swDown('p:' + e.pointerId, e.clientX < innerWidth / 2 ? 'step' : 'select', e.timeStamp);
  });
  window.addEventListener('pointerup', e => swUp('p:' + e.pointerId, e.timeStamp));
  window.addEventListener('pointercancel', e => { S.up(gate, 'p:' + e.pointerId, e.timeStamp); if (holding === 'p:' + e.pointerId) dropHold(); if (long && long.key === 'p:' + e.pointerId) dropLong(); if (pending && pending.key === 'p:' + e.pointerId) dropPending(); });
  for (const name of ['contextmenu', 'dragstart', 'selectstart']) document.addEventListener(name, e => { if (!chromeTarget(e.target) || name !== 'contextmenu') e.preventDefault(); });
  window.addEventListener('blur', () => { S.clear(gate); dropHold(); dropLong(); dropPending(); });

  // ---- Chrome, sheets and settings.
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, d] of Object.entries(icons)) $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  // After a pointer uses a button, the play surface takes focus back, so the
  // next Space or Enter is a press and not that button again.
  const handBack = e => { if (e.detail > 0 || lastInput === 'pointer') boardNode.focus({ preventScroll: true }); };
  $('#undo-btn').addEventListener('click', e => { undoButton(); handBack(e); });
  $('#hint-btn').addEventListener('click', e => { hintButton(); handBack(e); });
  $('#restart-btn').addEventListener('click', e => { restart(); handBack(e); });
  $('#next-btn').addEventListener('click', e => { nextBoard(); handBack(e); });
  // A sheet stops the scan; closing it starts row scanning again where it was.
  const openedBy = {}, pausedAt = {};
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => { openedBy[id] = lastInput; pausedAt[id] = [here(), generation]; S.clear(gate); dropHold(); dropLong(); dropPending(); $('#' + id).showModal(); wake(); });
    $('#' + id).addEventListener('close', () => {
      // A board opened from Settings starts at the top, like any new board.
      const [row, gen] = pausedAt[id] || [0, -1];
      resume(gen === generation && !scan.loop ? row : 0);
      setTimeout(() => { if (openedBy[id] === 'keyboard') $('#' + id + '-btn').focus(); else boardNode.focus({ preventScroll: true }); }, 0);
    });
  }
  function applyPrefs() {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme; root.dataset.motion = prefs.motion;
    for (const k of Object.keys(SETTINGS)) if (!$('#' + k).querySelector('option[data-reason]')) $('#' + k).value = String(prefs[k]);
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (reduced()) animation?.finish();
    gate.release = prefs.release;
    // Colour follows Rewards and the theme's palette stops; a finished board holds it.
    if (built === board && solved() && colourful()) paintBoard(payoff.at || [0, 0], false); else if (built === board) unpaint();
  }
  for (const k of Object.keys(SETTINGS)) $('#' + k).addEventListener('change', e => {
    if (e.target.value === 'reason') return;
    prefs[k] = ['release', 'presstime', 'longpress', 'rest'].includes(k) ? +e.target.value : e.target.value; applyPrefs();
    if (k === 'sound' && prefs.sound !== 'off') sound('choose');
    // A new way of scanning starts row scanning again at the row it was on.
    if (k === 'mode' || k === 'speed' || k === 'rest') { dropHold(); dropLong(); dropPending(); resume(scan.loop ? 0 : here()); }
    chrome(); save();
    announce({ presstime: prefs.presstime ? `Press time ${prefs.presstime / 1000} seconds.` : 'Press time off.', longpress: prefs.longpress ? `Long press of ${prefs.longpress / 1000} seconds takes back a step.` : 'Long press off.', rest: prefs.rest ? `The scan rests after ${prefs.rest} passes.` : 'The scan never rests.', rewards: colourful() ? 'Colour rewards.' : 'Calm: paper and ink only.', mode: `${{ auto: 'Auto-scan', step: 'Step-scan', hold: 'Hold to move' }[prefs.mode]}. Par ${parOf(board)}.`, speed: `Scan speed ${prefs.speed}.`, release: prefs.release ? `Release time ${prefs.release / 1000} seconds.` : 'Release time off.', highlight: prefs.highlight === 'invert' ? 'Inverted highlight.' : 'Outline highlight.', sound: { off: 'Sound off.', ticks: 'Ticks.', tones: 'Row tones.' }[prefs.sound], theme: 'Theme changed.', motion: 'Motion setting changed.' }[k]);
  });
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { fit(); draw(); wake(); });
  // A hidden page forgets held switches and finishes motion; coming back,
  // row scanning starts again at the row it was on.
  let hiddenAt = 0;
  let hiddenResting = false;
  document.addEventListener('visibilitychange', () => {
    S.clear(gate); dropHold(); dropLong(); dropPending();
    if (document.hidden) { hiddenAt = here(); hiddenResting = S.at(scan, performance.now()).phase === 'rest'; animation?.finish(); }
    else { resume(scan.loop ? 0 : hiddenAt, performance.now(), hiddenResting); }
  });

  // ---- The test hook.
  window.__sweep = {
    boards,
    get board() { return board.id; },
    get state() { return { rows: rowsOf(), cols: colsOf(), grid: copy(grid), solved: solved(), light: lightCount(grid), hits, par: parOf(board), pars: { auto: parOf(board, 'auto'), step: parOf(board, 'step') }, hint: hint && { ...hint }, history: history.length, finished: [...finished] }; },
    get prefs() { return { ...prefs }; },
    get scan() { const now = performance.now(), s = S.settle(scan, now), p = S.at(scan, now); return { ...p, mode: s.mode, delay: s.delay, rows: s.rows.map(r => r.slice()), since: s.since, steps: s.steps, hold: s.hold, loop: s.loop, control: controlRow(), now }; },
    // For tests: where an item stands in the scan, the next stretch of time
    // it (or its row) is highlighted, the perfect scanner's way from here, the
    // item it chooses next, and the frame as drawn.
    locate,
    when(want, t = performance.now()) { return S.when(scan, t, want); },
    distance(want) { return S.distance(scan, performance.now(), want); },
    get sound() { return lastSound && { ...lastSound }; },
    get holding() { return holding; },
    get switches() { return switches; },
    get recovery() { return { pending: !!pending, long: !!long && !long.fired, longs, ring: holdRing.getAttribute('display') !== 'none' ? +holdRing.dataset.fill : null }; },
    get payoff() { return { ...payoff, blooming: payoffLayer.querySelectorAll('.bloom').length, palette: P.NAMES[boards.indexOf(board) % P.NAMES.length], painted: payoff.painted, paints: [...tiles.values()].map(t => [t.r, t.c, t.paint.getAttribute('fill'), +getComputedStyle(t.paint).opacity]) }; },
    plan() { const p = S.plan(E, board, grid, prefs.mode, here()); return p && { cells: p.cells.map(c => c.slice()), presses: p.presses }; },
    target() { if (solved()) return last() ? null : 'next'; const p = S.plan(E, board, grid, prefs.mode, here()); return p && p.cells.length ? `cell:${p.cells[0][0]}:${p.cells[0][1]}` : null; },
    frame() { const vis = n => n.getAttribute('display') !== 'none', r = n => ({ x: +n.getAttribute('x'), y: +n.getAttribute('y'), width: +n.getAttribute('width'), height: +n.getAttribute('height') }); return { fill: vis(fill) ? r(fill) : null, band: band && vis(band) ? r(band) : null, back: vis(backIcon), inverted: inverted.map(n => n.id || 'tile:' + n.dataset.r + ':' + n.dataset.c), row: vis(rowRect) ? { x: +rowRect.getAttribute('x'), y: +rowRect.getAttribute('y'), width: +rowRect.getAttribute('width'), height: +rowRect.getAttribute('height'), heavy: rowRect.classList.contains('heavy') } : null, item: vis(itemRect) ? { x: +itemRect.getAttribute('x'), y: +itemRect.getAttribute('y'), width: +itemRect.getAttribute('width'), height: +itemRect.getAttribute('height') } : null, ring: vis(ring) ? { cx: +ring.getAttribute('cx'), cy: +ring.getAttribute('cy'), r: +ring.getAttribute('r') } : null }; },
    center(r, c) { return present(r, c) ? { x: geo.ox + (c + .5) * geo.s, y: geo.oy + (r + .5) * geo.s, size: geo.s } : null; },
    // The fit's area, and the board with its back-stop room on each side.
    geometry() { const x = geo.s * MX; return { s: geo.s, band: geo.band, rect: { ...geo.rect }, area: { ...geo.area }, extent: { x: geo.rect.left - x, y: geo.rect.top - geo.s * M, w: geo.rect.right - geo.rect.left + 2 * x, h: geo.rect.bottom - geo.rect.top + 2 * geo.s * M }, reach: geo.rect.right + (BACK.x + BACK.size + BACK.pad) * geo.s }; },
    go, restart, undo: undoButton, hint: hintButton, next: nextBoard,
    press: (kind = 'select') => press(kind, performance.now())
  };
  window.__minimalize = { bounds() {
    // The frame is the outermost line drawn; add its half-pixel hairline.
    const b = frameNode.getBoundingClientRect();
    return { x: b.x - .5, y: b.y - .5, width: b.width + 1, height: b.height + 1 };
  } };

  // A saved board resumes where it was, its scan starting at the top.
  applyPrefs(); fit(); rest(); chrome(); save();
  if (solved()) paintBoard(payoff.at || [0, 0], false);
  if (boards.indexOf(board) === 0 && !history.length && !hits) { hint = E.hint(board, grid); draw(); }
  resume(0);
  // The shared control frame and the fonts may settle the page after this
  // first layout; measure again once they have.
  addEventListener('load', () => { fit(); draw(); wake(); });
})();
