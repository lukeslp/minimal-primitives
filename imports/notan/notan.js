/* Notan: the page. Builds the board as an ARIA grid (column clues are column
 * headers, row clues are row headers), handles tap / drag / long-press /
 * keyboard input, saves progress, and plays the solved reveal.
 * Needs engine.js (window.InkEngine) and levels.js (window.InkLevels). */
(function () {
  'use strict';
  const E = window.InkEngine;
  const LEVELS = window.InkLevels;
  const PLUS_LEVELS = window.InkPlusLevels;
  const SIZES = [5, 8, 10, 12, 15];
  const BLANK = 0, INK = 1, MARK = 2;
  const STATE = ['blank', 'filled', 'marked empty'];
  const KEY = 'ink.v1'; // the game was called Ink until 2026-10-04; the key stays so progress carries over
  const HOLD_MS = 380, DOUBLE_MS = 300;
  const $ = (s) => document.querySelector(s);

  /* ---------- one home for progress ----------
   * The game is served from three addresses and a browser keeps a separate save
   * for each, so a player who came back through a different link found level 1.
   * The two older addresses now hand their save to playnotan.com in the URL
   * fragment (never sent to a server); the game folds it into its own save.
   * Folding only ever adds: solved boards, best times, boards in progress. */
  const HOME = 'playnotan.com', OLD_HOMES = ['dr.eamer.dev', 'lukesteuber.com'];
  // Off until the hand-off has been tried on the real hosts; the fold below is live.
  const HAND_OFF = false;
  if (HAND_OFF && OLD_HOMES.includes(location.hostname.replace(/^www\./, ''))) {
    let carry = '';
    try {
      const v = localStorage.getItem(KEY);
      if (v && v.length < 200000) carry = '#carry=' + encodeURIComponent(btoa(unescape(encodeURIComponent(v))));
    } catch (e) { /* nothing to carry */ }
    location.replace('https://' + HOME + '/' + location.search + carry);
    return;
  }
  (function fold() {
    if (!location.hash.startsWith('#carry=')) return;
    try {
      const from = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(location.hash.slice(7))))));
      if (!from || typeof from !== 'object' || Array.isArray(from)) return;
      const had = localStorage.getItem(KEY);
      const to = had ? JSON.parse(had) : null;
      if (!to || typeof to !== 'object') { localStorage.setItem(KEY, JSON.stringify(from)); return; }
      const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      to.solved = plain(to.solved); to.boards = plain(to.boards); to.hinted = plain(to.hinted);
      for (const [id, t] of Object.entries(plain(from.solved))) {
        if (typeof t !== 'number') continue;
        const mine = to.solved[id];
        if (typeof mine === 'number' && mine > 0 && mine <= t) continue;
        to.solved[id] = t;
        if (plain(from.hinted)[id] === true) to.hinted[id] = true; else delete to.hinted[id];
      }
      for (const [id, b] of Object.entries(plain(from.boards))) if (!to.boards[id] && typeof to.solved[id] !== 'number') to.boards[id] = b;
      if (!to.endless && from.endless) to.endless = from.endless;
      if (from.plusUnlocked === true) to.plusUnlocked = true;
      // Stay where this save is, unless it has not got anywhere yet.
      if (!Object.keys(to.solved).length || typeof to.at !== 'string') { if (typeof from.at === 'string') to.at = from.at; }
      localStorage.setItem(KEY, JSON.stringify(to));
    } catch (e) { /* a damaged carry is ignored; the save here is untouched */ }
  })();

  /* ---------- storage (everything optional; private mode just doesn't save) ---------- */
  function readSave() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }
  const raw = readSave();
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const save = {
    at: typeof raw.at === 'string' ? raw.at : null,
    solved: obj(raw.solved),
    boards: obj(raw.boards),
    hinted: obj(raw.hinted),
    endless: raw.endless && typeof raw.endless === 'object' ? raw.endless : null,
    seen: !!raw.seen,
    mark: !!raw.mark,
    quickSize: SIZES.includes(raw.quickSize) ? raw.quickSize : 10,
    zoom: [100, 115, 130, 150].includes(raw.zoom) ? raw.zoom : 100,
    theme: ['light', 'dark'].includes(raw.theme) ? raw.theme : 'system',
  };
  // Redraws keep completion credit, but old cells cannot describe the new art.
  const migrations = {
    leaf: 'leaf-connected', boat: 'boat-sail', goggles: 'goggles-bold',
    alien: 'alien-bold', robot: 'robot-bold',
    jellyfish: 'jellyfish-drift', mountain: 'mountain-ridge', crab: 'crab-raised',
    lion: 'lion-profile', beetle: 'beetle-angled',
    'alien-bold': 'alien-antenna', 'goggles-bold': 'goggles-tilted', 'robot-bold': 'robot-wave',
  };
  for (const [oldId, newId] of Object.entries(migrations)) {
    if (Object.prototype.hasOwnProperty.call(save.solved, oldId)) {
      if (!Object.prototype.hasOwnProperty.call(save.solved, newId)) save.solved[newId] = save.solved[oldId];
      delete save.solved[oldId];
    }
    delete save.boards[oldId];
    if (save.at === oldId) save.at = newId;
  }
  // 2026-10-06: Moth now comes before Beetle, and Lantern and Crab before
  // Jellyfish, to soften the two steepest steps in the ramp. A player who was
  // waiting at one of those walls comes back on the gentler board ahead of it.
  if (raw.rampOrder !== 2) {
    const ahead = { 'beetle-angled': ['moth'], 'jellyfish-drift': ['lantern', 'crab-raised'] }[save.at];
    const first = ahead && ahead.find((id) => typeof save.solved[id] !== 'number');
    if (first) save.at = first;
  }
  save.rampOrder = 2;
  save.plusUnlocked = raw.plusUnlocked === true || typeof save.solved[LEVELS[LEVELS.length - 1].id] === 'number';
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage blocked: play on */ }
  }

  /* ---------- puzzles ---------- */
  const puzzles = (list, plus = false) => list.map((L, index) => {
    const { w, h, sol } = E.fromArt(L.art);
    const { rows, cols } = E.cluesOf(sol, w, h);
    return { id: L.id, name: L.name, index, plus, w, h, sol, rows, cols };
  });
  const RAMP = puzzles(LEVELS), PLUS = puzzles(PLUS_LEVELS, true);
  const sequence = (p) => p.plus ? PLUS : RAMP;
  function newSeed() { return E.FREE_SEED + Math.floor(Math.random() * 900000); }
  function endless(size, seed) {
    for (let s = seed, tries = 0; tries < 20; s++, tries++) {
      const g = E.generate(s, size, size);
      if (g) return { id: 'endless', name: 'No. ' + s, endless: true, size, seed: s, w: size, h: size, sol: g.sol, rows: g.rows, cols: g.cols };
    }
    return null;
  }

  /* ---------- state + elements ---------- */
  const S = {
    puz: null, cells: null, undo: [], locks: { row: [], col: [] }, solved: false, solvedAt: 0, hinted: false, hint: null,
    time: 0, focus: 0, mark: save.mark, drag: null, pending: null,
    lastTap: null, kbd: false, geo: null, lastTo: null,
  };
  const board = $('#board'), grid = $('#grid'), bandR = $('.band-r'), bandC = $('.band-c');
  const cursor = $('.cursor'), hintEl = $('.hint'), caption = $('#caption'), capName = $('#cap-name'), nextBtn = $('#next-btn');
  const lvlBtn = $('#lvl-btn'), lvlText = $('#lvl-text'), clock = $('#clock'), live = $('#live');
  const undoBtn = $('#undo-btn'), modeBtn = $('#mode-btn'), helpBtn = $('#help-btn');
  const shareBtn = $('#share-btn');
  const help = $('#help'), levels = $('#levels'), lvGrid = $('#lv-grid'), lvMeta = $('#lv-meta'), sizesEl = $('#sizes');
  const settings = $('#settings'), settingsBtn = $('#settings-btn');
  const resetConfirm = $('#reset-confirm'), hintBtn = $('#hint-btn');
  const plusSection = $('#plus-section'), plusGrid = $('#plus-grid'), unlockNotice = $('#unlock-notice');
  const dialogs = [help, levels, settings, resetConfirm];
  const modalOpen = () => dialogs.some((dlg) => dlg.open);
  let cellEls = [], rowHeads = [], colHeads = [];
  let finishTimer = 0;

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  let liveTimer = 0;
  function announce(text) {
    clearTimeout(liveTimer);
    live.textContent = '';
    liveTimer = setTimeout(() => { live.textContent = text; }, 40);
  }
  function fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function label(p) { return p.endless ? 'Endless ' + p.size + ' by ' + p.size : (p.plus ? 'New Game+ level ' : 'Level ') + (p.index + 1); }

  /* ---------- open a puzzle ---------- */
  function open(puz) {
    if (!puz) return;
    painter.cancel();
    stopClock();
    clearTimeout(finishTimer);
    S.puz = puz;
    S.undo = [];
    S.lastTap = null;
    cancelClueHold();
    S.locks = { row: Array(puz.h).fill(false), col: Array(puz.w).fill(false) };
    S.solved = false;
    S.drag = null;
    if (S.pending) { clearTimeout(S.pending.timer); S.pending = null; }
    S.lastTo = null;
    const n = puz.w * puz.h;
    S.cells = new Int8Array(n);
    S.time = 0;
    S.hinted = false;
    clearHint();
    const saved = puz.endless
      ? (save.endless && save.endless.size === puz.size && save.endless.seed === puz.seed ? save.endless : null)
      : save.boards[puz.id];
    if (saved && typeof saved.c === 'string' && saved.c.length === n) {
      for (let i = 0; i < n; i++) { const v = saved.c.charCodeAt(i) - 48; S.cells[i] = v === 1 || v === 2 ? v : 0; }
      S.time = Math.max(0, saved.t | 0);
      S.hinted = saved.h === true;
      for (const kind of ['row', 'col']) {
        const locks = saved.locks && saved.locks[kind];
        S.locks[kind] = S.locks[kind].map((_, i) => Array.isArray(locks) && locks[i] === true);
      }
    }
    if (puz.endless) {
      save.quickSize = puz.size;
      save.at = 'endless';
      save.endless = { size: puz.size, seed: puz.seed, c: Array.from(S.cells).join(''), t: S.time, locks: S.locks, h: S.hinted || undefined };
    } else save.at = puz.id;
    persist();
    renderQuickChoices();

    // If focus was on the old board or its Next button, keep it on the board.
    const refocus = caption.contains(document.activeElement) || grid.contains(document.activeElement);
    // Drop the solved state without animating the new board in from the old offset.
    board.classList.add('instant');
    board.classList.remove('solved');
    caption.classList.remove('show');
    caption.hidden = true;
    unlockNotice.hidden = true;
    build();
    layout();
    renderAll();
    hud();
    setUrl();
    void board.offsetWidth;
    board.classList.remove('instant');
    if (refocus) setFocus(0, true);
    if (isSolved()) finish(true);
  }

  function build() {
    const { w, h, rows, cols } = S.puz;
    grid.textContent = '';
    cellEls = new Array(w * h);
    rowHeads = [];
    colHeads = [];
    grid.setAttribute('aria-label', label(S.puz) + ', ' + w + ' by ' + h + ' squares');
    grid.setAttribute('aria-rowcount', String(h + 1));
    grid.setAttribute('aria-colcount', String(w + 1));
    const head = el('div', 'gr');
    head.setAttribute('role', 'row');
    const corner = el('div', 'corner');
    corner.setAttribute('role', 'columnheader');
    corner.innerHTML = '<span class="sr-only">Row clues</span>';
    head.append(corner);
    cols.forEach((clue) => { const d = clueEl('cc', clue); d.setAttribute('role', 'columnheader'); colHeads.push(d); head.append(d); });
    grid.append(head);
    const guides = w > 5 || h > 5;
    for (let r = 0; r < h; r++) {
      const gr = el('div', 'gr');
      gr.setAttribute('role', 'row');
      const rh = clueEl('rc', rows[r]);
      rh.setAttribute('role', 'rowheader');
      rowHeads.push(rh);
      gr.append(rh);
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        const d = el('div', 'cell');
        d.setAttribute('role', 'gridcell');
        d.tabIndex = -1;
        if (r === 0) d.classList.add('t');
        if (c === 0) d.classList.add('l');
        if (c === w - 1) d.classList.add('rt');
        if (r === h - 1) d.classList.add('bt');
        if (guides && c < w - 1 && (c + 1) % 5 === 0) d.classList.add('gx');
        if (guides && r < h - 1 && (r + 1) % 5 === 0) d.classList.add('gy');
        cellEls[i] = d;
        gr.append(d);
      }
      grid.append(gr);
    }
    S.focus = 0;
    cellEls[0].tabIndex = 0;
  }
  function clueEl(kind, clue) {
    const d = el('div', 'clue ' + kind);
    (clue.length ? clue : [0]).forEach((n) => { const s = el('span'); s.textContent = String(n); d.append(s); });
    return d;
  }

  /* ---------- layout: the largest cell that fits between the readout and the icons ---------- */
  function fontFor(cell) { return Math.max(11, Math.min(20, Math.round(cell * 0.46))) * save.zoom / 100; }
  function layout() {
    if (!S.puz) return;
    const { w, h, rows, cols } = S.puz;
    // clientWidth/Height, not innerWidth: on phones innerWidth reports the
    // overflowed width while a new board is still at its default size.
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const narrow = vw < 560;
    const top = narrow ? 52 : 60, bottom = narrow ? 66 : 74, gut = 16;
    const W = vw - 2 * gut, H = vh - top - bottom;
    const rowsN = rows.map((cl) => (cl.length ? cl : [0]));
    const colMax = Math.max(...cols.map((cl) => Math.max(1, cl.length)));
    let g = null;
    for (let s = 72; s >= 8; s--) {
      const f = fontFor(s);
      const cw = Math.ceil(Math.max(...rowsN.map((cl) => cl.reduce((a, n) => a + String(n).length * 0.62 * f, 0) + (cl.length - 1) * 0.5 * f)) + 0.85 * f);
      const ch = Math.ceil(colMax * 1.18 * f + 0.55 * f);
      g = { cell: s, f, cw, ch };
      if (cw + w * s <= W && ch + h * s <= H) break;
    }
    const bw = g.cw + w * g.cell, bh = g.ch + h * g.cell;
    g.left = Math.round((vw - bw) / 2);
    g.top = Math.round(top + Math.max(0, (H - bh) / 2));
    S.geo = g;
    // Where the picture goes once solved: smaller, centered with its name
    // under it, so it sits on the page like a print with room around it.
    const capH = caption.hidden ? 122 * save.zoom / 100 : Math.max(122, caption.offsetHeight);
    const k = Math.min(1, ((H - capH) * 0.72) / (h * g.cell), (W * 0.8) / (w * g.cell));
    const pw = w * g.cell * k, ph = h * g.cell * k;
    const tx = (vw - pw) / 2, ty = top + Math.max(0, (H - ph - capH) / 2);
    const dx = Math.round(tx - g.left - k * g.cw), dy = Math.round(ty - g.top - k * g.ch);
    board.style.cssText = `--cell:${g.cell}px;--f:${g.f}px;--cw:${g.cw}px;--ch:${g.ch}px;--dot:${Math.max(3, Math.round(g.cell * 0.16))}px;--solved:translate(${dx}px,${dy}px) scale(${k.toFixed(4)});left:${g.left}px;top:${g.top}px;width:${bw}px;height:${bh}px`;
    caption.style.top = Math.round(ty + ph + 14) + 'px';
    showBands(S.bandAt == null ? -1 : S.bandAt);
    placeCursor();
    placeHint();
  }

  /* ---------- rendering ---------- */
  function renderCell(i) {
    const v = S.cells[i], d = cellEls[i], w = S.puz.w;
    d.classList.toggle('ink', v === INK);
    d.classList.toggle('mark', v === MARK);
    d.setAttribute('aria-readonly', String(isLocked(i)));
    d.setAttribute('aria-label', 'Row ' + (Math.floor(i / w) + 1) + ', column ' + (i % w + 1) + ': ' + STATE[v] + (isLocked(i) ? ', locked' : ''));
  }
  function lineOf(kind, k) {
    const { w, h } = S.puz;
    const out = [];
    if (kind === 'row') for (let c = 0; c < w; c++) out.push(S.cells[k * w + c]);
    else for (let r = 0; r < h; r++) out.push(S.cells[r * w + k]);
    return out;
  }
  /* Returns true when the line matches its clue. */
  /* A line's clue dims when its filled runs match it; before that, each number
   * fades on its own once its run is finished and closed off (E.doneClues reads
   * the board, never the solution). */
  function lineStatus(kind, k, animate) {
    const clue = kind === 'row' ? S.puz.rows[k] : S.puz.cols[k];
    const head = kind === 'row' ? rowHeads[k] : colHeads[k];
    const line = lineOf(kind, k);
    const cells = line.map((v) => (v === INK ? 1 : v === MARK ? 0 : -1));
    const ok = E.same(E.runs(line), clue);
    const bad = !ok && E.solveLine(cells, clue) === null;
    const parts = clue.length ? E.doneClues(cells, clue) : [ok];
    let count = 0;
    Array.from(head.children).forEach((n, i) => {
      const done = ok || parts[i];
      if (done) count++;
      n.classList.toggle('n-done', done);
    });
    head.classList.toggle('locked', S.locks[kind][k]);
    head.classList.toggle('ok', ok);
    head.classList.toggle('bad', bad);
    const name = (kind === 'row' ? 'Row ' : 'Column ') + (k + 1) + (S.locks[kind][k] ? ', locked' : ', unlocked') + ', clue ' + (clue.length ? clue.join(' ') : '0');
    head.setAttribute('aria-label', name + (ok ? ', done' : bad ? ', cannot fit as marked' : count ? ', ' + count + ' of ' + clue.length + ' numbers done' : ''));
    return ok;
  }
  function renderAll() {
    for (let i = 0; i < S.cells.length; i++) renderCell(i);
    for (let r = 0; r < S.puz.h; r++) lineStatus('row', r);
    for (let c = 0; c < S.puz.w; c++) lineStatus('col', c);
    hud();
  }
  /* Re-check the rows and columns that touch these cells; returns the
   * names of lines that just became done (for the screen-reader note). */
  function updateLines(idx) {
    const w = S.puz.w;
    const rs = new Set(), cs = new Set();
    idx.forEach((i) => { rs.add(Math.floor(i / w)); cs.add(i % w); });
    const done = [];
    rs.forEach((r) => { const was = rowHeads[r].classList.contains('ok'); if (lineStatus('row', r, true) && !was) done.push('row ' + (r + 1)); });
    cs.forEach((c) => { const was = colHeads[c].classList.contains('ok'); if (lineStatus('col', c, true) && !was) done.push('column ' + (c + 1)); });
    return done;
  }
  function isSolved() {
    for (let r = 0; r < S.puz.h; r++) if (!E.same(E.runs(lineOf('row', r)), S.puz.rows[r])) return false;
    for (let c = 0; c < S.puz.w; c++) if (!E.same(E.runs(lineOf('col', c)), S.puz.cols[c])) return false;
    return true;
  }
  function hud() {
    const p = S.puz;
    lvlText.textContent = p.endless ? '∞ ' + p.size : (p.plus ? '+' : '') + String(p.index + 1);
    lvlBtn.setAttribute('aria-label', (p.endless ? 'Endless, ' + p.size + ' by ' + p.size : label(p) + ' of ' + sequence(p).length) + '. Choose a level');
    clock.textContent = fmt(S.time);
    undoBtn.setAttribute('aria-disabled', S.undo.length && !S.solved ? 'false' : 'true');
    hintBtn.setAttribute('aria-disabled', S.solved ? 'true' : 'false');
    modeBtn.setAttribute('aria-pressed', S.mark ? 'true' : 'false');
    modeBtn.querySelector('.m-fill').style.display = S.mark ? 'none' : '';
    modeBtn.querySelector('.m-dot').style.display = S.mark ? '' : 'none';
  }

  /* ---------- clock ---------- */
  let tick = null;
  function startClock() {
    if (tick || S.solved) return;
    tick = setInterval(() => {
      if (document.hidden || modalOpen()) return;
      S.time++;
      clock.textContent = fmt(S.time);
      if (S.time % 10 === 0) storeBoard();
    }, 1000);
  }
  function stopClock() { clearInterval(tick); tick = null; }

  function storeBoard() {
    if (!S.puz || S.solved) return;
    const c = Array.from(S.cells).join('');
    const blank = !S.cells.some((v) => v);
    const h = S.hinted || undefined;
    if (S.puz.endless) save.endless = { size: S.puz.size, seed: S.puz.seed, c, t: S.time, locks: S.locks, h };
    else if (blank && !S.time && !S.hinted && !S.locks.row.some(Boolean) && !S.locks.col.some(Boolean)) delete save.boards[S.puz.id];
    else save.boards[S.puz.id] = { c, t: S.time, locks: S.locks, h };
    persist();
  }

  function isLocked(i) {
    return S.locks.row[Math.floor(i / S.puz.w)] || S.locks.col[i % S.puz.w];
  }
  function toggleLock(kind, k) {
    S.lastTap = null;
    if (S.solved || S.drag || S.pending) return;
    S.locks[kind][k] = !S.locks[kind][k];
    renderAll();
    storeBoard();
    announce((kind === 'row' ? 'Row ' : 'Column ') + (k + 1) + (S.locks[kind][k] ? ', locked' : ', unlocked'));
  }

  /* ---------- moves ---------- */
  /* Two plain toggles, no cycling: a tap fills or clears; a hold or right-click marks or clears.
   * Mark mode swaps them. Filling a marked square (or marking a filled one) replaces it. */
  const toggleInk = (v) => (v === INK ? BLANK : INK);
  const toggleMark = (v) => (v === MARK ? BLANK : MARK);
  function tapOf(v) { return S.mark ? toggleMark(v) : toggleInk(v); }
  function altOf(v) { return S.mark ? toggleInk(v) : toggleMark(v); }

  function pushUndo(snap) {
    S.undo.push(snap);
    if (S.undo.length > 400) S.undo.shift();
  }
  function afterChange(idx, speak) {
    clearHint();
    const done = updateLines(idx);
    storeBoard();
    hud();
    clearTimeout(finishTimer);
    if (isSolved()) {
      // Keep the final fill immediate, but allow its second tap before revealing.
      if (S.lastTap) finishTimer = setTimeout(() => { if (!S.drag && isSolved()) finish(false); }, DOUBLE_MS);
      else finish(false);
      return;
    }
    if (speak) announce(speak + (done.length ? '. ' + done.join(' and ') + ' done' : ''));
  }

  /* A single keyboard move. */
  function act(i, to) {
    S.lastTap = null;
    if (S.solved || isLocked(i) || S.cells[i] === to) return;
    pushUndo(Int8Array.from(S.cells));
    S.cells[i] = to;
    S.lastTo = to;
    startClock();
    renderCell(i);
    afterChange([i], to === BLANK ? 'cleared' : STATE[to]);
  }

  function undo() {
    clearTimeout(finishTimer);
    S.lastTap = null;
    if (S.solved) return;
    const snap = S.undo.pop();
    if (!snap) { announce('Nothing to undo'); return; }
    clearHint();
    const diff = [];
    for (let i = 0; i < snap.length; i++) if (S.cells[i] !== snap[i]) diff.push(i);
    S.cells = snap;
    if (snap.locks) S.locks = {row:snap.locks.row.slice(),col:snap.locks.col.slice()};
    renderAll();
    updateLines(diff);
    storeBoard();
    hud();
    announce('Undone');
  }
  function startOver() {
    clearTimeout(finishTimer);
    S.lastTap = null;
    if (S.solved) { open(S.puz); announce(label(S.puz) + ' again'); return; }
    clearHint();
    painter.cancel();
    const previousLocks = {row:S.locks.row.slice(),col:S.locks.col.slice()};
    const hadLocks = S.locks.row.some(Boolean) || S.locks.col.some(Boolean);
    S.locks.row.fill(false); S.locks.col.fill(false);
    if (!S.cells.some((v) => v) && !hadLocks) { announce('The board is already blank'); return; }
    const snapshot = Int8Array.from(S.cells);
    snapshot.locks = previousLocks;
    pushUndo(snapshot);
    S.cells.fill(0);
    renderAll();
    storeBoard();
    hud();
    announce('Board cleared. Undo brings it back.');
  }

  /* ---------- hint ---------- */
  /* A last resort, kept in Settings and How to play. It rings one wrong square if there is one, the most
   * recently changed first. Otherwise it rings a square the board already
   * settles and the clue that settles it, preferring a square to fill:
   * empty squares never have to be marked, so "leave this empty" helps less.
   * Every board can be finished line by line, so a correct board always has one. */
  function findHint() {
    const { w, h, sol, rows, cols } = S.puz;
    const wrong = (i) => (S.cells[i] === INK && sol[i] !== 1) || (S.cells[i] === MARK && sol[i] === 1);
    for (let k = S.undo.length - 1; k >= 0; k--) {
      const snap = S.undo[k];
      for (let i = 0; i < snap.length; i++) if (snap[i] !== S.cells[i] && wrong(i)) return { i, wrong: true };
    }
    for (let i = 0; i < S.cells.length; i++) if (wrong(i)) return { i, wrong: true };
    const known = Array.from(S.cells, (v) => (v === INK ? 1 : v === MARK ? 0 : -1));
    const lines = [];
    for (let r = 0; r < h; r++) lines.push({ kind: 'row', k: r, clue: rows[r], idx: Array.from({ length: w }, (_, c) => r * w + c) });
    for (let c = 0; c < w; c++) lines.push({ kind: 'col', k: c, clue: cols[c], idx: Array.from({ length: h }, (_, r) => r * w + c) });
    const settle = (L, from) => {
      const line = L.idx.map((i) => from[i]);
      const fill = [], empty = [];
      const res = line.includes(-1) ? E.solveLine(line, L.clue) : null;
      if (res) L.idx.forEach((i, n) => { if (line[n] === -1 && res[n] !== -1) (res[n] === 1 ? fill : empty).push(i); });
      return { fill, empty };
    };
    let best = null, spare = null;
    for (const L of lines) {
      const { fill, empty } = settle(L, known);
      if (fill.length && (!best || fill.length > best.weight)) best = { weight: fill.length, kind: L.kind, k: L.k, i: fill[0], fill: true };
      if (empty.length && !spare) spare = { kind: L.kind, k: L.k, i: empty[0], fill: false };
    }
    if (best) return best;
    // No line settles a square to fill from what is on the board. A player who
    // never marks empties would be shown the same empty square for ever, so
    // carry the empties forward quietly until a line settles a fill.
    const ahead = known.slice();
    for (let changed = true; changed;) {
      changed = false;
      for (const L of lines) {
        const { fill, empty } = settle(L, ahead);
        if (fill.length) return { kind: L.kind, k: L.k, i: fill[0], fill: true };
        for (const i of empty) { ahead[i] = 0; changed = true; }
      }
    }
    return spare;
  }
  function placeHint() {
    if (!S.hint || !S.geo) return;
    const g = S.geo, w = S.puz.w;
    hintEl.style.left = g.cw + (S.hint.i % w) * g.cell + 'px';
    hintEl.style.top = g.ch + Math.floor(S.hint.i / w) * g.cell + 'px';
  }
  function clearHint() {
    if (!S.hint) return;
    S.hint = null;
    hintEl.classList.remove('on', 'wrong', 'fill', 'empty');
    grid.querySelectorAll('.clue.hinted').forEach((n) => n.classList.remove('hinted'));
  }
  function showHint() {
    if (!S.puz || S.solved) return;
    const hint = findHint();
    if (!hint) { announce('No hint: every square is already settled'); return; }
    clearHint();
    S.hint = hint;
    S.hinted = true;
    storeBoard();
    if (hint.kind) (hint.kind === 'row' ? rowHeads : colHeads)[hint.k].classList.add('hinted');
    hintEl.classList.toggle('wrong', !!hint.wrong);
    hintEl.classList.toggle('fill', !hint.wrong && hint.fill === true);
    hintEl.classList.toggle('empty', !hint.wrong && hint.fill === false);
    placeHint();
    void hintEl.offsetWidth;
    hintEl.classList.add('on');
    setFocus(hint.i, true);
    const w = S.puz.w, r = Math.floor(hint.i / w) + 1, c = hint.i % w + 1;
    announce(hint.wrong
      ? 'Hint: row ' + r + ', column ' + c + ' is wrong' + (isLocked(hint.i) ? ', and its line is locked' : '') + '.'
      : 'Hint: row ' + r + ', column ' + c + (hint.fill ? ' can be filled.' : ' stays empty.'));
  }

  /* ---------- solved ---------- */
  function finish(quiet) {
    clearHint();
    S.solved = true;
    S.locks.row.fill(false); S.locks.col.fill(false);
    renderAll();
    S.solvedAt = performance.now();
    stopClock();
    const p = S.puz;
    if (p.endless) {
      save.endless = { size: p.size, seed: newSeed(), c: '', t: 0 };
    } else {
      const best = save.solved[p.id];
      if (!(typeof best === 'number' && best > 0 && best < S.time)) {
        save.solved[p.id] = S.time;
        // A hinted solve counts like any other; this only remembers that the best
        // time came from one, so a leaderboard could leave it out.
        if (S.hinted) save.hinted[p.id] = true;
        else delete save.hinted[p.id];
      }
      delete save.boards[p.id];
      if (!p.plus && p.index === RAMP.length - 1) save.plusUnlocked = true;
      const nx = sequence(p)[p.index + 1] || (!p.plus ? PLUS[0] : null);
      save.at = nx ? nx.id : p.id;
    }
    persist();
    showBands(-1);
    placeCursor();
    board.classList.add('solved');
    capName.textContent = p.name;
    unlockNotice.hidden = p.endless || p.plus || p.index !== RAMP.length - 1;
    shareBtn.hidden = !p.endless;
    shareBtn.textContent = 'Share blank';
    nextBtn.setAttribute('aria-label', p.endless ? 'Next board' : !p.plus && p.index === RAMP.length - 1 ? 'Start New Game+' : p.index + 1 < sequence(p).length ? 'Next level' : 'Choose what to play next');
    caption.hidden = false;
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => caption.classList.add('show')));
    hud();
    if (!quiet) announce((!unlockNotice.hidden ? 'New Game+ unlocked. ' : '') + 'Solved: ' + p.name + ', in ' + fmt(S.time) + '. Press Enter for the next one.');
    // Keyboard players land on Next; pointer players just tap anywhere.
    if (S.kbd) nextBtn.focus({ preventScroll: true });
  }
  function next() {
    const p = S.puz;
    if (p.endless) open(endless(p.size, save.endless ? save.endless.seed : newSeed()));
    else if (p.index + 1 < sequence(p).length) open(sequence(p)[p.index + 1]);
    else if (!p.plus && save.plusUnlocked) {
      open(PLUS[0]);
      announce('New Game+ unlocked. ' + label(S.puz) + ', ' + S.puz.w + ' by ' + S.puz.h);
      return;
    }
    else { openLevels(true); return; }
    announce(label(S.puz) + ', ' + S.puz.w + ' by ' + S.puz.h);
  }

  /* ---------- focus, bands, cursor ---------- */
  function setFocus(i, move) {
    if (!cellEls[i]) return;
    if (cellEls[S.focus]) cellEls[S.focus].tabIndex = -1;
    S.focus = i;
    cellEls[i].tabIndex = 0;
    if (move) cellEls[i].focus({ preventScroll: true });
    showBands(i);
    placeCursor();
  }
  function showBands(i) {
    S.bandAt = i;
    if (i < 0 || S.solved || !S.geo) { bandR.style.opacity = '0'; bandC.style.opacity = '0'; return; }
    const g = S.geo, { w, h } = S.puz;
    const r = Math.floor(i / w), c = i % w;
    bandR.style.cssText = `opacity:1;left:0;top:${g.ch + r * g.cell}px;width:${g.cw + w * g.cell}px;height:${g.cell}px`;
    bandC.style.cssText = `opacity:1;top:0;left:${g.cw + c * g.cell}px;width:${g.cell}px;height:${g.ch + h * g.cell}px`;
  }
  function placeCursor() {
    const on = S.kbd && !S.solved && S.geo && grid.contains(document.activeElement);
    cursor.classList.toggle('on', !!on);
    if (!on) return;
    const g = S.geo, w = S.puz.w;
    cursor.style.left = g.cw + (S.focus % w) * g.cell + 'px';
    cursor.style.top = g.ch + Math.floor(S.focus / w) * g.cell + 'px';
  }

  /* ---------- pointer input ---------- */
  function cellAt(x, y, clamp) {
    const b = board.getBoundingClientRect(), g = S.geo, { w, h } = S.puz;
    let c = Math.floor((x - b.left - g.cw) / g.cell), r = Math.floor((y - b.top - g.ch) / g.cell);
    if (clamp) { c = Math.max(0, Math.min(w - 1, c)); r = Math.max(0, Math.min(h - 1, r)); }
    else if (c < 0 || r < 0 || c >= w || r >= h) return -1;
    return r * w + c;
  }
  let clueHold = null, heldClue = null;
  function cancelClueHold() {
    if (clueHold) clearTimeout(clueHold.timer);
    clueHold = null;
  }
  function clueLine(target) {
    const head = target.closest('.clue');
    if (!head || !grid.contains(head)) return null;
    const kind = head.classList.contains('rc') ? 'row' : 'col';
    return { kind, k: (kind === 'row' ? rowHeads : colHeads).indexOf(head), head };
  }
  document.addEventListener('pointerdown', cancelClueHold, true);
  board.addEventListener('pointerdown', (e) => {
    if (S.solved || !S.geo) return;
    if (e.button !== 0 && e.button !== 2) return;
    const clue = clueLine(e.target);
    if (clue) {
      heldClue = null;
      if (!e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      const hold = { ...clue, id: e.pointerId, x: e.clientX, y: e.clientY };
      hold.timer = setTimeout(() => {
        clueHold = null;
        heldClue = hold.head;
        toggleLock(hold.kind, hold.k);
      }, 500);
      clueHold = hold;
      try { board.setPointerCapture(e.pointerId); } catch (_) { /* fine without capture */ }
      return;
    }
  });
  const painter = NotanPaint.bind({
    root: board, state: S,
    size: () => S.puz,
    rect: () => { const b=board.getBoundingClientRect(),g=S.geo;
      return {left:b.left+g.cw,top:b.top+g.ch,width:S.puz.w*g.cell,height:S.puz.h*g.cell}; },
    accept: e => !S.solved && !!S.geo && !modalOpen() && !clueLine(e.target) && cellAt(e.clientX,e.clientY)>=0,
    locked: isLocked,
    render: renderCell, preview: updateLines,
    focus: i => { S.kbd=false; setFocus(i,true); },
    start: () => { clearTimeout(finishTimer); startClock(); },
    commit: idx => afterChange(idx,null),
    restore: () => { renderAll(); storeBoard(); }
  });
  board.addEventListener('pointermove', e => {
    if(clueHold && e.pointerId===clueHold.id &&
      Math.hypot(e.clientX-clueHold.x,e.clientY-clueHold.y)>=10)cancelClueHold();
    if(e.pointerType==='mouse' && !S.drag && !S.solved)showBands(cellAt(e.clientX,e.clientY));
  });
  board.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !S.drag) showBands(grid.contains(document.activeElement) ? S.focus : -1);
  });
  // Release still cancels a hold if pointer capture was unavailable.
  ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, cancelClueHold));
  window.addEventListener('blur', cancelClueHold);
  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const clue = clueLine(e.target);
    if (clue && heldClue !== clue.head) { cancelClueHold(); toggleLock(clue.kind, clue.k); }
  });

  /* Any pointer press ends keyboard mode (hides the keyboard cursor). */
  document.addEventListener('pointerdown', () => { if (S.kbd) { S.kbd = false; placeCursor(); } }, true);

  // Background holds never enter the board gesture path. A second pointer,
  // movement, cancellation, or loss of the window cancels the pending hold.
  let backgroundHold = null, heldBackground = null;
  const emptyBackground = target => !target.closest('.cell, .clue, button, a, .hud, .caption, dialog');
  function cancelBackground() {
    if (backgroundHold) clearTimeout(backgroundHold.timer);
    backgroundHold = null;
  }
  document.addEventListener('pointerdown', e => {
    cancelBackground();
    heldBackground = null;
    if (!e.isPrimary || e.button !== 0 || modalOpen() || !emptyBackground(e.target) || S.drag || S.pending) return;
    const hold = { id: e.pointerId, x: e.clientX, y: e.clientY, opener: document.activeElement };
    hold.timer = setTimeout(() => {
      backgroundHold = null;
      heldBackground = hold;
      openSettings(hold.opener instanceof HTMLElement && hold.opener !== document.body ? hold.opener : settingsBtn);
    }, 500);
    backgroundHold = hold;
  });
  document.addEventListener('pointermove', e => {
    if (backgroundHold && e.pointerId === backgroundHold.id && Math.hypot(e.clientX - backgroundHold.x, e.clientY - backgroundHold.y) >= 10) cancelBackground();
  });
  ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, cancelBackground));
  window.addEventListener('blur', cancelBackground);
  document.addEventListener('contextmenu', e => {
    if (heldBackground && Math.hypot(e.clientX - heldBackground.x, e.clientY - heldBackground.y) < 10) e.preventDefault();
  });
  document.addEventListener('click', e => {
    if (heldBackground) { heldBackground = null; e.preventDefault(); e.stopImmediatePropagation(); return; }
    // Wait for release so a solved-screen background hold can open Settings.
    if (!S.solved || modalOpen() || e.target.closest('button, dialog') || performance.now() - S.solvedAt < 450) return;
    next();
  }, true);

  /* ---------- keyboard ---------- */
  grid.addEventListener('focusin', (e) => {
    const i = cellEls.indexOf(e.target);
    if (i >= 0) setFocus(i, false);
    showBands(S.focus); placeCursor();
  });
  grid.addEventListener('focusout', () => {
    setTimeout(() => { if (!grid.contains(document.activeElement)) { placeCursor(); showBands(-1); } }, 0);
  });
  grid.addEventListener('keydown', (e) => {
    if (S.solved) return;
    const { w, h } = S.puz;
    const i = S.focus;
    let r = Math.floor(i / w), c = i % w, moved = false, handled = true;
    switch (e.key) {
      case 'ArrowUp': r = Math.max(0, r - 1); moved = true; break;
      case 'ArrowDown': r = Math.min(h - 1, r + 1); moved = true; break;
      case 'ArrowLeft': c = Math.max(0, c - 1); moved = true; break;
      case 'ArrowRight': c = Math.min(w - 1, c + 1); moved = true; break;
      case 'Home': c = 0; if (e.ctrlKey) r = 0; moved = true; break;
      case 'End': c = w - 1; if (e.ctrlKey) r = h - 1; moved = true; break;
      case ' ': case 'Enter': act(i, S.cells[i] === INK ? BLANK : INK); break;
      case 'l': case 'L': if (!e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) toggleLock(e.shiftKey ? 'col' : 'row', e.shiftKey ? c : r); } else handled = false; break;
      case 'x': case 'X': act(i, S.cells[i] === MARK ? BLANK : MARK); break;
      case 'Delete': case 'Backspace': act(i, BLANK); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); S.kbd = true; }
    if (moved) {
      const j = r * w + c;
      setFocus(j, true);
      if (e.shiftKey && S.lastTo !== null && j !== i) act(j, S.lastTo);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (modalOpen()) return;
    const k = e.key;
    if (k === 'Tab') { S.kbd = true; setTimeout(placeCursor, 0); return; }
    if ((k === 'z' || k === 'Z') && !e.altKey) { e.preventDefault(); undo(); return; }
    if (k === '?') { e.preventDefault(); openHelp(); return; }
    if (S.solved && (k === 'Enter' || k === ' ') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); next(); return; }
    if (!S.solved && k.startsWith('Arrow') && !grid.contains(e.target) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      S.kbd = true;
      setFocus(S.focus, true);
    }
  });

  /* ---------- buttons ---------- */
  undoBtn.addEventListener('click', undo);
  modeBtn.addEventListener('click', () => {
    S.lastTap = null;
    S.mark = !S.mark;
    save.mark = S.mark;
    persist();
    hud();
    announce(S.mark ? 'Mark mode on: a tap marks a square empty' : 'Mark mode off: a tap fills');
  });
  nextBtn.addEventListener('click', next);
  // Share the unsolved quick-play board: same size and seed, so a friend
  // gets the identical puzzle (every generated board has one solution).
  shareBtn.addEventListener('click', async () => {
    const p = S.puz;
    if (!p.endless) return;
    const url = location.origin + location.pathname + '?endless=' + p.size + '&seed=' + p.seed;
    const text = 'A ' + p.size + '\u00d7' + p.size + ' Notan board. Can you solve it?';
    if (navigator.share) {
      try { await navigator.share({ title: 'Notan', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
      shareBtn.textContent = 'Link copied';
      announce('Link copied');
    } catch (_) {
      shareBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { shareBtn.textContent = 'Share blank'; }, 2500);
  });
  helpBtn.addEventListener('click', openHelp);
  lvlBtn.addEventListener('click', () => openLevels(false));

  /* ---------- sheets ---------- */
  function showSheet(dlg, opener) {
    if (dlg.open) return;
    painter.cancel();
    cancelClueHold();
    dlg.showModal();
    dlg.querySelector('.sheet-body').scrollTop = 0;
    dlg.addEventListener('close', () => {
      // close() restores native focus synchronously, but this event is queued.
      // Keep any focus chosen since then (by the player or a new board/dialog).
      const active = document.activeElement;
      if (!dlg.open && (active === document.body || dlg.contains(active)) &&
          opener.isConnected && opener.getClientRects().length)
        opener.focus({ preventScroll: true });
    }, { once: true });
  }
  function openHelp() { showSheet(help, helpBtn); }
  function openSettings(opener = settingsBtn) {
    showSheet(settings, opener);
    settings.querySelector('.sheet-x').focus({ preventScroll: true });
  }
  settingsBtn.addEventListener('click', () => openSettings());
  help.addEventListener('close', () => {
    if (!save.seen) { save.seen = true; persist(); }
  });
  dialogs.forEach((dlg) => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const controls = [...dlg.querySelectorAll('button, a[href], summary, [tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  $('#reset-level').addEventListener('click', () => { startOver(); settings.close(); });
  hintBtn.addEventListener('click', () => { if (hintBtn.getAttribute('aria-disabled') !== 'true') showHint(); });
  $('#reset-all').addEventListener('click', () => showSheet(resetConfirm, $('#reset-all')));
  $('#confirm-reset').addEventListener('click', () => {
    save.solved = {}; save.boards = {}; save.hinted = {}; save.endless = null; save.at = null; save.plusUnlocked = false;
    persist();
    resetConfirm.close();
    settings.close();
    open(RAMP[0]);
    announce('All progress erased. Level 1.');
  });

  function appearance() {
    if (save.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = save.theme;
    document.documentElement.style.setProperty('--zoom', save.zoom / 100);
    const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[save.theme];
    const paths = {
      system: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/>',
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
      dark: '<path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>',
    };
    $('#theme-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[save.theme] + '</svg><span>' + save.theme[0].toUpperCase() + save.theme.slice(1) + '</span>';
    $('#theme-btn').setAttribute('aria-label', 'Theme: ' + save.theme + '. Switch to ' + nextTheme + '.');
    $('#zoom-sizes').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.textContent) === save.zoom)));
  }
  [100, 115, 130, 150].forEach(n => {
    const b = el('button', 'size-choice');
    b.type = 'button'; b.textContent = String(n);
    b.setAttribute('aria-label', n + ' percent');
    b.addEventListener('click', () => { save.zoom = n; appearance(); persist(); layout(); });
    $('#zoom-sizes').append(b);
  });
  $('#theme-btn').addEventListener('click', () => {
    save.theme = { system: 'light', light: 'dark', dark: 'system' }[save.theme];
    appearance(); persist();
  });
  appearance();

  function renderQuickChoices() {
    [sizesEl, $('#settings-sizes'), $('#solved-sizes')].filter(Boolean).forEach((row) => {
      row.replaceChildren();
      SIZES.forEach((n) => {
        const b = el('button', 'size-choice');
        b.type = 'button';
        b.textContent = String(n);
        b.setAttribute('aria-label', 'Quick play, ' + n + ' by ' + n);
        b.setAttribute('aria-pressed', String(save.quickSize === n));
        b.addEventListener('click', () => {
          const p = endless(n, newSeed());
          if (!p) { announce('Could not make a board. Please try again.'); return; }
          storeBoard();
          // Even a repeated seed starts with a blank board.
          save.endless = null;
          const dlg = row.closest('dialog');
          if (dlg) dlg.close();
          open(p);
          if (!dlg) setFocus(0, true);
          announce('Quick play, ' + n + ' by ' + n);
        });
        row.append(b);
      });
    });
  }
  function openLevels(atEnd) {
    lvGrid.textContent = '';
    plusGrid.textContent = '';
    plusSection.hidden = !save.plusUnlocked;
    let solved = 0;
    [...RAMP, ...(save.plusUnlocked ? PLUS : [])].forEach((p) => {
      const i = p.index;
      const li = el('li');
      const b = el('button', 'lv');
      b.type = 'button';
      const done = typeof save.solved[p.id] === 'number';
      b.textContent = String(i + 1);
      if (done) { solved++; b.classList.add('done'); }
      b.setAttribute('aria-label', label(p) + ', ' + (done ? p.name + ', solved' : p.w + ' by ' + p.h));
      if (S.puz.id === p.id) { b.setAttribute('aria-current', 'true'); }
      b.addEventListener('click', () => { levels.close(); open(p); setFocus(0, true); announce(label(p) + ', ' + p.w + ' by ' + p.h); });
      li.append(b);
      (p.plus ? plusGrid : lvGrid).append(li);
    });
    lvMeta.textContent = solved + ' of ' + (RAMP.length + (save.plusUnlocked ? PLUS.length : 0)) + ' solved';
    showSheet(levels, atEnd ? nextBtn : lvlBtn);
    (levels.querySelector('[aria-current="true"]') || lvGrid.querySelector('button'))?.focus({ preventScroll: true });

  }

  /* ---------- URL ---------- */
  function setUrl() {
    const p = S.puz;
    const q = p.endless ? '?endless=' + p.size + '&seed=' + p.seed : (p.plus ? '?plus=' : '?level=') + (p.index + 1);
    try { history.replaceState(null, '', location.pathname + q); } catch (_) { /* file:// or sandbox */ }
  }
  function initial() {
    const q = new URLSearchParams(location.search);
    if (q.has('plus')) { // a reload keeps its board even if the browser dropped the save
      const n = Number(q.get('plus'));
      if (Number.isInteger(n) && n >= 1 && n <= PLUS.length) return PLUS[n - 1];
    }
    if (q.has('endless')) {
      const want = parseInt(q.get('endless'), 10);
      const size = SIZES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), 10);
      let seed = parseInt(q.get('seed'), 10);
      if (!(seed > 0)) seed = save.endless && save.endless.size === size ? save.endless.seed : newSeed();
      const p = endless(size, seed);
      if (p) return p;
    }
    if (q.has('level')) {
      const n = parseInt(q.get('level'), 10);
      if (n >= 1 && n <= RAMP.length) return RAMP[n - 1];
    }
    if (save.at === 'endless' && save.endless && SIZES.includes(save.endless.size) && save.endless.seed > 0) {
      const p = endless(save.endless.size, save.endless.seed);
      if (p) return p;
    }
    return [...RAMP, ...(save.plusUnlocked ? PLUS : [])].find((p) => p.id === save.at) || RAMP[0];
  }

  /* ---------- go ---------- */
  let rz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(layout); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) storeBoard(); });
  window.addEventListener('pagehide', storeBoard);

  open(initial());
  // How to play opens only from the ? button or the ? key, never on load (Luke, 2026-10-04).
  window.__notan = { S, RAMP, PLUS, open, next, endless, isSolved };
})();
