/* Tents: the page. Rules live in engine.js; boards in levels.js. */
(function () {
  'use strict';
  const E = Tents, OPENING = TentsLevels.opening, L = TentsLevels.campaign;
  const $ = s => document.querySelector(s);
  const K = { current: 'tents.current.v1', progress: 'tents.progress.v1', settings: 'tents.settings.v1', opening: 'tents.opening.v1', generated: 'tents.generated.v1' };
  const ids = new Set(L.map(p => p.id));

  /* ---- Storage: every read is validated; a bad save falls back to a fresh one. ---- */
  let storageOk = true;
  function read(key, validate, otherwise) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return otherwise;
      const value = JSON.parse(raw);
      return validate(value) ? value : otherwise;
    } catch (_) { return otherwise; }
  }
  function write(key, value) {
    if (!storageOk) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { storageOk = false; }
  }
  const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
  const progress = read(K.progress, v => isObject(v) && v.version === 1 && Array.isArray(v.completed) && v.completed.every(id => ids.has(id)) && new Set(v.completed).size === v.completed.length, { version: 1, completed: [] });
  const prefs = read(K.settings, v => isObject(v) && v.version === 1 && ['system', 'light', 'dark'].includes(v.theme) && ['system', 'reduce'].includes(v.motion), { version: 1, theme: 'system', motion: 'system' });
  const store = read(K.current, v => isObject(v) && v.version === 1 && ids.has(v.at) && isObject(v.boards) && Object.keys(v.boards).every(id => ids.has(id) && E.stateValid(L.find(p => p.id === id), v.boards[id])), { version: 1, at: L[0].id, boards: {} });
  /* Free play: the generated board in hand, kept under its own key so the campaign save keeps its shape.
     { version, seed, w, h, cells (the trees), rows, cols, state (the marks), playing } */
  let gen = read(K.generated, v => isObject(v) && v.version === 1 && Number.isInteger(v.seed) && typeof v.playing === 'boolean' && E.valid(v) && Array.isArray(v.rows) && E.stateValid(v, v.state), null);
  const allDone = () => L.every(p => progress.completed.includes(p.id));
  const ENDING = 'All ' + L.length + ' boards solved.';

  const query = new URLSearchParams(location.search), asked = Number(query.get('level'));
  if (Number.isInteger(asked) && asked >= 1 && asked <= L.length) store.at = L[asked - 1].id;
  const firstVisit = !query.has('level') && read(K.opening, v => v === 1, 0) !== 1;

  const openingAt = id => OPENING.findIndex(p => p.id === id);
  const genBoard = () => gen && { id: 'generated', w: gen.w, h: gen.h, cells: gen.cells, rows: gen.rows, cols: gen.cols, seed: gen.seed };
  let genPuzzle = genBoard();
  const boardOf = id => id === 'generated' ? genPuzzle : L.find(p => p.id === id) || OPENING[openingAt(id)];
  let at = firstVisit ? OPENING[0].id : gen && gen.playing && !query.has('level') ? 'generated' : store.at, puzzle = boardOf(at), lastInvoker = null;
  /* S is the live state of the board on screen. S.cells: 0 blank, 1 tent, 2 grass.
     S.pairs: the ties drawn last, kept so a tie stays put until the marks move it. */
  const S = { cells: [], undo: [], solved: false, focus: 0, hint: null, keyboard: false, pairs: [] };

  /* ---- Drawing ---- */
  const SHAPES = {
    tree: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="crown" cx="12" cy="10" r="8"/><path class="trunk" d="M10.6 16h2.8v7h-2.8z"/></svg>',
    tent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 23 21h-8.2L12 14.5 9.2 21H1Z"/></svg>',
    grass: '<svg class="dot" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.4"/></svg>'
  };
  const ICONS = { undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', reset: 'M5 7a8 8 0 1 1-1 9M5 3v5h5' };
  for (const [id, name] of [['restart-btn', 'reset'], ['undo-btn', 'undo'], ['hint-btn', 'hint'], ['next-btn', 'next'], ['settings-btn', 'settings'], ['help-btn', 'help']]) $('#' + id).innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';

  function say(text) { $('#feedback').textContent = text; }
  const el = (tag, cls, role) => { const n = document.createElement(tag); n.className = cls; if (role) n.setAttribute('role', role); return n; };
  const cellNodes = () => $('#board').querySelectorAll('.cell');

  function build() {
    const root = $('#board'), p = puzzle;
    root.replaceChildren();
    root.style.setProperty('--w', p.w); root.style.setProperty('--h', p.h);
    root.setAttribute('aria-rowcount', p.h + (p.cols ? 1 : 0)); root.setAttribute('aria-colcount', p.w + (p.rows ? 1 : 0));
    for (let y = 0; y < p.h; y++) {
      const row = el('div', 'grid-row' + (y === p.h - 1 ? ' last' : ''), 'row');
      for (let x = 0; x < p.w; x++) {
        const n = el('div', 'cell', 'gridcell');
        n.dataset.i = y * p.w + x;
        row.append(n);
      }
      // Without numbers the last grid column stays empty.
      row.append(p.rows ? el('div', 'clue row-clue', 'rowheader') : el('div', 'clue-gap'));
      if (!p.rows) row.lastChild.setAttribute('aria-hidden', 'true');
      root.append(row);
    }
    if (p.cols) {
      const row = el('div', 'grid-row', 'row');
      for (let x = 0; x < p.w; x++) row.append(el('div', 'clue col-clue', 'columnheader'));
      root.append(row);
    }
    // Each number sits in a span, so "too many" can box the digit alone.
    for (const n of root.querySelectorAll('.clue')) n.append(document.createElement('span'));
    const ties = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ties.setAttribute('class', 'ties'); ties.setAttribute('aria-hidden', 'true');
    ties.setAttribute('viewBox', '0 0 ' + p.w + ' ' + p.h); ties.setAttribute('preserveAspectRatio', 'none');
    root.append(ties);
  }

  /* The numbers grow with the cells: 14px on a phone's 8x8 board, up to 22px on large cells. The
     gutter beside the rows grows with them, so an 8x8 board on a 390px phone keeps 44px cells. */
  function fit() {
    const shell = $('#board-shell'), p = puzzle, root = $('#board');
    const size = (gut, foot) => Math.max(20, Math.floor(Math.min((shell.clientWidth - 2 * gut - 2) / p.w, (shell.clientHeight - foot - 2) / p.h, 72)));
    const clueFor = cell => Math.max(14, Math.min(22, Math.round(cell * 0.28)));
    let cell = size(18, p.cols ? 24 : 0), clue = clueFor(cell);
    const gut = clue <= 14 ? 18 : clue + 8, foot = !p.cols ? 0 : clue <= 14 ? 24 : clue + 12;
    cell = size(gut, foot); clue = Math.min(clue, clueFor(cell));
    root.style.setProperty('--cell', cell + 'px'); root.style.setProperty('--gut', gut + 'px');
    root.style.setProperty('--foot', foot + 'px'); root.style.setProperty('--clue', clue + 'px');
  }

  /* ---- The solved board's forest ----
     At the solve the meadow runs off the board to fill the screen: the same squares continue in every
     direction, with more trees and a few more tents among them. It is scenery, built from the board's
     own lattice and a fixed scatter per board, clear of the numbers, the arrow and the controls. */
  const mix = (a, b, c) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
  const patch = (x, y) => mix(x, y, 7) % 3;
  let forestKey = '';
  function forest() {
    const old = document.getElementById('forest'), html = document.documentElement;
    html.classList.toggle('woods', S.solved);
    if (!S.solved) { if (old) old.remove(); forestKey = ''; return; }
    const first = cellNodes()[0];
    if (!first) return;
    const r = first.getBoundingClientRect(), s = r.width, W = innerWidth, H = innerHeight, p = puzzle;
    const key = [at, genPuzzle ? genPuzzle.seed : 0, $('#ending').hidden, Math.round(r.left), Math.round(r.top), Math.round(s), W, H].join(' ');
    if (key === forestKey && old) return;
    forestKey = key;
    const seed = at === 'generated' ? gen.seed % 100000 + 1 : Number(at.replace(/\D/g, '')) || 1;
    // Where nothing may stand: the board and its numbers, the readout, the toolbar, the arrow.
    const keep = [{ left: r.left - s * .6, top: r.top - s * .2, right: r.left + s * p.w + s * .9, bottom: r.top + s * p.h + s * .9 }];
    for (const q of ['#restart-btn', '#readout', '.toolbar', '#next-btn', '#ending']) { const n = $(q); if (n) { const b = n.getBoundingClientRect(); if (b.width) keep.push({ left: b.left - 10, top: b.top - 10, right: b.right + 10, bottom: b.bottom + 10 }); } }
    const blocked = (gx, gy) => { const x = r.left + gx * s, y = r.top + gy * s; return keep.some(k => x < k.right && x + s > k.left && y < k.bottom && y + s > k.top); };
    const gx0 = -Math.ceil(r.left / s), gx1 = Math.ceil((W - r.left) / s), gy0 = -Math.ceil(r.top / s), gy1 = Math.ceil((H - r.top) / s);
    const trees = new Set(), tents = new Set(), id = (x, y) => x + ',' + y;
    for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) if (!blocked(x, y) && mix(x, y, seed) % 100 < 24) trees.add(id(x, y));
    for (const t of trees) {
      const [x, y] = t.split(',').map(Number);
      if (mix(x, y, seed + 31) % 100 >= 40) continue;
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]][mix(x, y, seed + 57) % 4], tx = x + side[0], ty = y + side[1];
      if (tx < gx0 || tx >= gx1 || ty < gy0 || ty >= gy1 || blocked(tx, ty) || trees.has(id(tx, ty))) continue;
      let clear = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tents.has(id(tx + dx, ty + dy))) clear = false;
      if (clear) tents.add(id(tx, ty));
    }
    const k = s / 24 * .64, o = s * .18;
    let d = '';
    for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) {
      const px = r.left + x * s, py = r.top + y * s, here = id(x, y);
      d += '<rect class="m' + patch(x, y) + '" x="' + px.toFixed(1) + '" y="' + py.toFixed(1) + '" width="' + (s + .5).toFixed(1) + '" height="' + (s + .5).toFixed(1) + '"/>';
      if (trees.has(here)) d += '<g transform="translate(' + (px + o).toFixed(1) + ' ' + (py + o).toFixed(1) + ') scale(' + k.toFixed(3) + ')"><circle class="c' + mix(x, y, 3) % 2 + '" cx="12" cy="10" r="8"/><path class="k" d="M10.6 16h2.8v7h-2.8z"/></g>';
      else if (tents.has(here)) d += '<g transform="translate(' + (px + o).toFixed(1) + ' ' + (py + o).toFixed(1) + ') scale(' + k.toFixed(3) + ')"><path class="t' + mix(x, y, 5) % 4 + '" d="M12 3 23 21h-8.2L12 14.5 9.2 21H1Z"/></g>';
    }
    const svg = old || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'forest'; svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = d;
    if (!old) document.body.prepend(svg);
  }

  function render() {
    const root = $('#board'), p = puzzle, v = E.inspect(p, S.cells), h = S.hint;
    const broken = new Set([...v.touching, ...v.lonely]), target = new Set(h ? h.cells : []), evidence = new Set(h ? h.evidence : []);
    // A short tie joins each tent to a tree beside it, read from the marks alone: the largest set of
    // one-tent-per-tree pairs, keeping earlier ties where it can. Nothing here knows the answer.
    S.pairs = E.pairing(p, S.cells, S.pairs).pairs.sort((a, b) => a.tree - b.tree);
    const partner = new Map();
    for (const q of S.pairs) { partner.set(q.tent, q.tree); partner.set(q.tree, q.tent); }
    const side = (from, to) => to === from - p.w ? 'above' : to === from + p.w ? 'below' : to === from - 1 ? 'to the left' : 'to the right';
    root.classList.toggle('solved', S.solved);
    cellNodes().forEach((n, i) => {
      const tree = !!p.cells[i], value = S.cells[i], x = i % p.w, y = (i / p.w) | 0;
      n.className = 'cell' + (tree ? ' tree' : value === 1 ? ' tent' : value === 2 ? ' grass' : '') + (x === p.w - 1 ? ' end' : '') + (broken.has(i) ? ' broken' : '') + (target.has(i) ? ' hint-target' : '') + (evidence.has(i) ? ' evidence' : '');
      const shape = tree ? SHAPES.tree : value === 1 ? SHAPES.tent : value === 2 ? SHAPES.grass : '';
      if (n._shape !== shape) { n.innerHTML = shape; n._shape = shape; }
      n.tabIndex = i === S.focus ? 0 : -1;
      // For the solved board only: which meadow green this cell takes, which canvas a tent takes, and
      // how long after the solve its color arrives (a sweep from the top left). Decoration, not state.
      n.dataset.m = patch(x, y);
      if (value === 1) n.dataset.t = (x * 3 + y * 5) % 4; else delete n.dataset.t;
      n.style.setProperty('--d', (x + y) * 35 + 'ms');
      const tie = partner.has(i) ? (tree ? ', its tent ' : ', tied to the tree ') + side(i, partner.get(i)) : '';
      const state = tree ? 'tree' + tie : value === 1 ? 'tent' + tie + (v.touching.includes(i) ? ', touching another tent' : '') + (v.lonely.includes(i) ? ', no tree beside it' : '') : value === 2 ? 'marked as grass' : 'blank';
      n.setAttribute('aria-label', 'Row ' + (y + 1) + ', column ' + (x + 1) + ': ' + state);
      if (tree) n.setAttribute('aria-disabled', 'true'); else n.removeAttribute('aria-disabled');
    });
    const clue = (n, name, index, want, have, state) => {
      n.className = 'clue ' + name + '-clue ' + (state === 'short' ? '' : state) + (h && h.line === name && h.index === index ? ' evidence' : '');
      n.firstChild.textContent = want;
      n.setAttribute('aria-label', (name === 'row' ? 'Row ' : 'Column ') + (index + 1) + ': needs ' + want + ', has ' + have + (state === 'over' ? ', too many' : ''));
    };
    if (p.rows) root.querySelectorAll('.row-clue').forEach((n, y) => clue(n, 'row', y, p.rows[y], v.rowCount[y], v.rowState[y]));
    if (p.cols) root.querySelectorAll('.col-clue').forEach((n, x) => clue(n, 'col', x, p.cols[x], v.colCount[x], v.colState[x]));
    const ties = root.querySelector('.ties'), ns = 'http://www.w3.org/2000/svg';
    const want = S.pairs.map(q => q.tent + '-' + q.tree).join(' ');
    if (ties.dataset.pairs !== want) {
      ties.dataset.pairs = want; ties.replaceChildren();
      for (const q of S.pairs) {
        const ax = q.tree % p.w + .5, ay = ((q.tree / p.w) | 0) + .5, bx = q.tent % p.w + .5, by = ((q.tent / p.w) | 0) + .5, line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', ax + (bx - ax) * .36); line.setAttribute('y1', ay + (by - ay) * .36);
        line.setAttribute('x2', ax + (bx - ax) * .64); line.setAttribute('y2', ay + (by - ay) * .64);
        ties.append(line);
      }
    }
    const n = L.findIndex(q => q.id === at), fresh = S.solved && nextTarget() === 'new', ended = S.solved && n >= 0 && allDone();
    $('#readout').textContent = at === 'generated' ? p.w + ' × ' + p.h + ' · ' + progress.completed.length + ' ✓' : n < 0 ? '' : (n + 1) + ' / ' + L.length + ' · ' + progress.completed.length + ' ✓';
    $('#undo-btn').disabled = !S.undo.length;
    $('#completion').hidden = !S.solved;
    // The line under a solve that leaves the whole campaign done; the status line says it to screen readers.
    $('#ending').hidden = !ended; $('#ending').textContent = ended ? ENDING : '';
    // Next is the frame's disc, there from the solve on while the woods grow in. With the whole campaign done it
    // starts New Game+, and on a New Game+ board it deals the next one.
    const next = $('#next-btn');
    next.hidden = !S.solved;
    next.setAttribute('aria-label', fresh ? (at === 'generated' ? 'Next board' : 'Start New Game+') : 'Next puzzle');
    $('#free-row').hidden = !allDone();
    $('#feedback').classList.toggle('sr-only', S.solved);
    $('#campaign').value = n < 0 ? '' : at;
    $('#previous').disabled = n <= 0; $('#following').disabled = n < 0 || n === L.length - 1;
    for (const o of $('#campaign').options) if (o.value) o.textContent = optionText(o.value);
    forest();
  }
  // Labeled by place in play order, as the readout is: ids name boards in saves and do not follow play order.
  const optionText = id => { const p = boardOf(id); return (L.findIndex(q => q.id === id) + 1) + ' · ' + p.w + ' × ' + p.h + (progress.completed.includes(id) ? ' ✓' : ''); };

  function focusCell(i, dom) {
    S.focus = i; render();
    if (dom) { const n = cellNodes()[i]; if (n) n.focus({ preventScroll: true }); }
  }

  /* ---- Play ---- */
  function save() {
    if (openingAt(at) >= 0) return;
    if (at === 'generated') { gen.state = S.cells.slice(); gen.playing = true; write(K.generated, gen); return; }
    store.at = at; store.boards[at] = S.cells.slice();
    write(K.current, store); write(K.progress, progress);
    if (gen && gen.playing) { gen.playing = false; write(K.generated, gen); }
  }
  function judge(announce) {
    S.solved = E.inspect(puzzle, S.cells).solved;
    if (!S.solved) return;
    if (ids.has(at) && !progress.completed.includes(at)) progress.completed.push(at);
    if (!announce) return;
    say(ids.has(at) && allDone() ? ENDING : 'Solved.');
  }
  function commit(before) {
    if (before.some((v, i) => v !== S.cells[i])) S.undo.push(before);
    S.hint = null; say('');
    judge(true); render(); save();
  }
  function act(i) {
    if (S.solved || puzzle.cells[i]) return;
    const before = S.cells.slice();
    S.cells[i] = (S.cells[i] + 1) % 3;
    commit(before);
  }
  function undo() {
    const before = S.undo.pop();
    if (!before) return;
    S.cells = before; S.hint = null; say('');
    judge(false); render(); save();
  }
  function restart() {
    const before = S.cells.slice();
    S.cells = S.cells.map(() => 0);
    commit(before);
    say(before.some(v => v) ? 'Board cleared. Undo brings it back.' : '');
  }
  function hint() {
    if (S.solved) { say('Solved. Nothing left to work out.'); return; }
    if (S.hint) {
      const h = S.hint, before = S.cells.slice();
      for (const i of h.cells) S.cells[i] = h.value;
      S.focus = h.cells[0];
      commit(before);
      return;
    }
    const h = E.hint(puzzle, S.cells);
    if (!h) { say('Nothing left to work out.'); return; }
    S.hint = { rule: h.rule, value: h.value, cells: h.cells, evidence: h.evidence, line: h.line || null, index: h.index === undefined ? null : h.index };
    say(h.text); render();
  }
  function switchBoard(id) {
    at = id; puzzle = boardOf(id);
    const saved = id === 'generated' ? gen.state : store.boards[id];
    S.cells = saved && E.stateValid(puzzle, saved) ? saved.slice() : Array(puzzle.w * puzzle.h).fill(0);
    S.undo = []; S.hint = null; S.focus = 0; S.keyboard = false; S.solved = false; S.pairs = []; drag = null;
    say(''); build(); fit(); judge(false); render(); save();
  }
  /* Where Next goes from a solved board: the next board in order; past the last, the first one not yet
     solved; with every board solved, a new generated board (and the same from a generated board). */
  function nextTarget() {
    const k = openingAt(at), n = L.findIndex(p => p.id === at);
    if (k >= 0) return k < OPENING.length - 1 ? OPENING[k + 1].id : store.at;
    if (n >= 0 && n < L.length - 1) return L[n + 1].id;
    const open = L.find(p => !progress.completed.includes(p.id));
    return open ? open.id : 'new';
  }
  // A new generated board from a fresh seed, never one of the campaign's. Found in a few milliseconds.
  const layouts = new Set([...OPENING, ...L].map(p => p.cells.join('')));
  function newGenerated() {
    if (!allDone()) return false;
    save();
    let p = null;
    for (let k = 0; k < 3 && !p; k++) p = E.freePlay(crypto.getRandomValues(new Uint32Array(1))[0], layouts);
    if (!p) return false;
    gen = { version: 1, seed: p.seed, w: p.w, h: p.h, cells: p.cells, rows: p.rows, cols: p.cols, state: Array(p.w * p.h).fill(0), playing: true };
    genPuzzle = genBoard();
    switchBoard('generated');
    return true;
  }
  function advance(event) {
    if (!S.solved) return;
    const byKey = !event || event.detail === 0, target = nextTarget();
    if (openingAt(at) === OPENING.length - 1) write(K.opening, 1);
    if (target === 'new') { if (!newGenerated()) return; }
    else switchBoard(target);
    if (byKey) focusCell(S.focus, true);
  }

  /* ---- Input ---- */
  /* A drag dots every blank cell it crosses; a drag that starts on a dot clears dots instead. A drag
     never touches a tent or a tree, and it is one Undo step. A press that stays in its cell is left to
     the click below, so taps, keys, switch and look play exactly as before. */
  let drag = null, dragDone = 0;
  function cellAt(x, y) {
    const p = puzzle, first = cellNodes()[0];
    if (!first) return -1;
    const r = first.getBoundingClientRect(), size = r.width, col = Math.floor((x - r.left) / size), row = Math.floor((y - r.top) / size);
    return col < 0 || row < 0 || col >= p.w || row >= p.h ? -1 : row * p.w + col;
  }
  function paint(i) {
    if (i < 0 || puzzle.cells[i]) return;
    if (drag.clear ? S.cells[i] === 2 : S.cells[i] === 0) S.cells[i] = drag.clear ? 0 : 2;
  }
  function dragEnd(e) {
    const d = drag;
    if (!d || (e && e.pointerId !== d.id)) return;
    drag = null;
    if (!d.moved) return;
    dragDone = performance.now();
    if (e && e.type === 'pointerup') { S.keyboard = false; commit(d.before); }
    else { S.cells = d.before; render(); }
  }
  $('#board').addEventListener('pointerdown', e => {
    if (drag) { dragEnd({ pointerId: drag.id, type: 'pointercancel' }); return; }
    dragDone = 0;
    if (S.solved || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    drag = { id: e.pointerId, start: i, x: e.clientX, y: e.clientY, before: S.cells.slice(), clear: S.cells[i] === 2, moved: false };
  });
  document.addEventListener('pointermove', e => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    // A mouse let go outside the window sends no pointerup; its next move has no button down.
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { dragEnd({ pointerId: d.id, type: 'pointerup' }); return; }
    const size = cellNodes()[0].getBoundingClientRect().width;
    // A finger that slips a few pixels over a cell edge is still a tap.
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < Math.max(10, size * 0.3) || cellAt(e.clientX, e.clientY) === d.start) return;
      d.moved = true; S.hint = null; say(''); paint(d.start);
    }
    // Step along the path so a quick swipe still dots every cell it crosses.
    const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - d.x, e.clientY - d.y) / (size / 4)));
    for (let k = 1; k <= steps; k++) paint(cellAt(d.x + (e.clientX - d.x) * k / steps, d.y + (e.clientY - d.y) * k / steps));
    d.x = e.clientX; d.y = e.clientY;
    render();
  });
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, dragEnd);
  window.addEventListener('blur', () => dragEnd(drag && { pointerId: drag.id, type: 'pointercancel' }));
  $('#board').addEventListener('click', e => {
    const n = e.target.closest('.cell');
    if (!n) return;
    // The click a browser sends at the end of a drag is not a tap.
    if (dragDone && performance.now() - dragDone < 600) { dragDone = 0; return; }
    S.keyboard = false; S.focus = Number(n.dataset.i);
    if (S.solved || puzzle.cells[S.focus]) { render(); return; }
    act(S.focus);
  });
  $('#board').addEventListener('focusin', e => { const n = e.target.closest('.cell'); if (n && Number(n.dataset.i) !== S.focus) { S.focus = Number(n.dataset.i); render(); } });
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.matches('select,input,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const p = puzzle, n = p.w * p.h, x = S.focus % p.w, y = (S.focus / p.w) | 0, key = e.key;
    let to = -1;
    // On a board one cell high (or wide), every arrow steps along the line.
    const step = d => Math.max(0, Math.min(n - 1, S.focus + d));
    if (key === 'ArrowLeft') to = p.w === 1 ? step(-1) : y * p.w + Math.max(0, x - 1);
    else if (key === 'ArrowRight') to = p.w === 1 ? step(1) : y * p.w + Math.min(p.w - 1, x + 1);
    else if (key === 'ArrowUp') to = p.h === 1 ? step(-1) : Math.max(0, y - 1) * p.w + x;
    else if (key === 'ArrowDown') to = p.h === 1 ? step(1) : Math.min(p.h - 1, y + 1) * p.w + x;
    else if (key === 'Home') to = y * p.w;
    else if (key === 'End') to = y * p.w + p.w - 1;
    if (to >= 0) { e.preventDefault(); S.keyboard = true; focusCell(to, true); return; }
    if (key === 'Enter' || key === ' ') {
      if (e.target.closest('button,a,summary')) return;
      e.preventDefault(); S.keyboard = true;
      if (S.solved) advance(); else act(S.focus);
    } else if (key === 'z' || key === 'Z' || key === 'Backspace') { e.preventDefault(); undo(); }
    else if (key === 'h' || key === 'H') { e.preventDefault(); S.keyboard = true; hint(); }
  });
  $('#undo-btn').addEventListener('click', undo);
  $('#hint-btn').addEventListener('click', hint);
  $('#restart-btn').addEventListener('click', restart);
  $('#next-btn').addEventListener('click', advance);

  /* ---- Sheets and settings ---- */
  function openSheet(id, button) {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    lastInvoker = button; $('#' + id).showModal();
  }
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => openSheet(id, $('#' + id + '-btn')));
    $('#' + id).addEventListener('close', () => { if (lastInvoker && !document.activeElement.closest('.board,dialog[open]')) lastInvoker.focus({ preventScroll: true }); });
    $('#' + id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }
  for (const p of L) { const o = document.createElement('option'); o.value = p.id; o.textContent = optionText(p.id); $('#campaign').append(o); }
  $('#new-game').addEventListener('click', () => { $('#settings').close(); newGenerated(); });
  $('#campaign').addEventListener('change', e => { if (ids.has(e.target.value)) switchBoard(e.target.value); $('#settings').close(); });
  for (const [id, delta] of [['previous', -1], ['following', 1]]) $('#' + id).addEventListener('click', () => {
    const n = L.findIndex(p => p.id === at) + delta;
    if (n >= 0 && n < L.length) switchBoard(L[n].id);
    $('#settings').close();
  });
  function applyPrefs() {
    const html = document.documentElement;
    if (prefs.theme === 'system') delete html.dataset.theme; else html.dataset.theme = prefs.theme;
    if (prefs.motion === 'system') delete html.dataset.motion; else html.dataset.motion = 'reduce';
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion;
  }
  for (const id of ['theme', 'motion']) $('#' + id).addEventListener('change', e => { prefs[id] = e.target.value; write(K.settings, prefs); applyPrefs(); });
  $('#reset').addEventListener('click', () => { restart(); $('#settings').close(); });
  $('#replay-opening').addEventListener('click', () => { $('#help').close(); switchBoard(OPENING[0].id); });
  window.addEventListener('resize', () => { fit(); forest(); });

  applyPrefs(); switchBoard(at);
  window.__tents = { S, get puzzle() { return puzzle; }, get at() { return at; }, get progress() { return progress; }, get generated() { return gen; }, keys: K };
})();
