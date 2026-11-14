/* Towers: the page. One verb: a tap raises a tower by one. Luke Steuber. */
(function () {
  'use strict';
  const E = Towers, ALL = TowersLevels;
  const OPENING = ALL.filter(p => p.opening), L = ALL.filter(p => !p.opening);
  const $ = s => document.querySelector(s);
  const K = { current: 'towers.current.v1', progress: 'towers.progress.v1', settings: 'towers.settings.v1', primer: 'towers.primer.v1' };
  const ids = new Set(L.map(p => p.id));
  const openingAt = id => OPENING.findIndex(p => p.id === id);
  const board = id => L.find(p => p.id === id) || OPENING[openingAt(id)];

  // ---- Storage: a save that cannot be read is kept aside, never overwritten.
  const blocked = new Set();
  function read(key, valid, otherwise) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (_) { blocked.add(key); return otherwise; }
    if (raw === null) return otherwise;
    try { const v = JSON.parse(raw); if (!valid(v)) throw Error('invalid'); return v; }
    catch (_) {
      try { localStorage.setItem(key + '.recovery.' + Date.now(), raw); } catch (_) { blocked.add(key); }
      return otherwise;
    }
  }
  function write(key, value) {
    if (blocked.has(key)) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { blocked.add(key); }
  }
  const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
  let progress = read(K.progress, v => isObject(v) && v.version === 1 && Array.isArray(v.completed) && v.completed.every(id => ids.has(id)), { version: 1, completed: [] });
  const prefs = read(K.settings, v => isObject(v) && v.version === 1 && ['system', 'light', 'dark'].includes(v.theme) && ['system', 'reduce'].includes(v.motion) && ['iso', 'flat'].includes(v.view), { version: 1, theme: 'system', motion: 'system', view: 'iso' });
  const store = read(K.current, v => isObject(v) && v.version === 1 && ids.has(v.at) && isObject(v.boards) && Object.keys(v.boards).every(id => ids.has(id) && E.stateValid(board(id), v.boards[id])), { version: 1, at: L[0].id, boards: {} });

  const query = new URLSearchParams(location.search);
  let firstVisit = !query.has('level');
  try { firstVisit = firstVisit && localStorage.getItem(K.primer) === null; } catch (_) { firstVisit = false; }
  let at = firstVisit ? OPENING[0].id : store.at;
  if (query.has('level')) { const n = Number(query.get('level')); if (Number.isInteger(n) && n >= 1 && n <= L.length) at = L[n - 1].id; }
  let puzzle = board(at), lastInvoker = null;
  const S = { cells: (store.boards[at] || E.startCells(puzzle)).slice(), undo: [], focus: 0, hint: null, solved: false, keyboard: false };

  // ---- Icons
  const paths = { undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', reset: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', turn: 'M12 4.5 19 8l-7 3.5L5 8zM4 14.5c1.6 2.6 4.6 4 8 4s6.4-1.4 8-4M20 14.5v3.6M20 14.5h-3.6' };
  for (const [id, name] of [['restart-btn', 'reset'], ['undo-btn', 'undo'], ['hint-btn', 'hint'], ['turn-btn', 'turn'], ['next-btn', 'next'], ['settings-btn', 'settings'], ['help-btn', 'help']])
    $('#' + id).innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
  function say(text) { $('#feedback').textContent = text; $('#announce').textContent = ''; }
  // Spoken only: an arrow key that has nowhere to go names the edge it met.
  function announce(text) { $('#announce').textContent = text; }

  // ---- Drawing. Grid point (row, column, height) to the page.
  // Isometric: columns run down to the right, rows down to the left, height straight up.
  // A level rises little enough (0.48 of a half-tile width shared among n - 1 levels) that the
  // tallest tower never reaches the number on the lowest one behind or beside it. The board is
  // the n by n block and nothing else. Each edge number stands off it on the ground, the same
  // distance on every side, in line with its row or column.
  // The block turns about its middle (`turn`, in radians): a sideways drag carries it round and it
  // comes to rest on a quarter turn, so any side can be brought to the front and looked along.
  function geometry() {
    const shell = $('#board-shell'), W = shell.clientWidth, H = shell.clientHeight, n = puzzle.n;
    if (prefs.view === 'flat') {
      const s = Math.max(8, Math.min(W / (n + 1.8), H / (n + 1.8), 96)), w = (n + 1.8) * s;
      return { flat: true, n, u: s, w, h: w, font: s * .46, clue: s * .46, back: .45, front: .45, co: 1, si: 0, near: (r, c) => r, P: (r, c) => [.9 * s + c * s, .9 * s + r * s] };
    }
    const a = Math.max(6, Math.min(W / (2 * n + 1.6), H / (1.4 * n + 2.1), 72)), b = .7 * a, z = Math.min(.48 * a / Math.max(1, n - 1), .3 * a);
    const w = (2 * n + 1.6) * a, h = (1.4 * n + 2.1) * a, ox = w / 2, oy = 1.05 * a, m = n / 2, co = Math.cos(turn), si = Math.sin(turn);
    // Row and column measured from the middle and turned; `near` grows toward the viewer.
    const spun = (r, c) => { const u = c - m, v = r - m; return [u * co - v * si, u * si + v * co]; };
    return { flat: false, n, u: a, w, h, font: a * .5, clue: a * .44, back: .85, front: .85, co, si,
      near: (r, c) => { const [x, y] = spun(r, c); return x + y; },
      P: (r, c, k) => { const [x, y] = spun(r, c); return [ox + (x - y) * a, oy + n * b + (x + y) * b - (k || 0) * z]; } };
  }
  const num = v => (Math.round(v * 10) / 10).toString();
  const poly = pts => 'M' + pts.map(p => num(p[0]) + ' ' + num(p[1])).join('L') + 'Z';
  // The four corners of a cell at a height: back, right, front, left. `scale` shrinks it about its middle.
  function quad(G, r, c, k, scale) {
    const m = (1 - (scale || 1)) / 2;
    return [[r + m, c + m], [r + m, c + 1 - m], [r + 1 - m, c + 1 - m], [r + 1 - m, c + m]].map(([y, x]) => G.P(y, x, k));
  }
  // A point on the ground `out` squares past the edge on `side`, in line with row or column k,
  // and `across` squares to one side of that line.
  function offEdge(G, side, k, out, across) {
    const n = G.n, j = k + .5 + (across || 0);
    if (side === 'top') return G.P(-out, j, 0);
    if (side === 'left') return G.P(j, -out, 0);
    if (side === 'bottom') return G.P(n + out, j, 0);
    return G.P(j, n + out, 0);
  }
  const cluePoint = (G, side, k) => offEdge(G, side, k, side === 'top' || side === 'left' ? G.back : G.front);
  const svgNode = name => document.createElementNS('http://www.w3.org/2000/svg', name);
  let G = null;
  /* The turn. `turn` is the angle now; at rest it is a whole number of quarter turns. */
  const QUARTER = Math.PI / 2;
  let turn = 0, spin = null, swipe = null, swiped = false;
  const quarters = () => ((Math.round(turn / QUARTER) % 4) + 4) % 4;
  // A finger that is down but has not yet dragged leaves the board at rest: moving the cells about
  // under a press would swallow the tap.
  const atRest = () => !spin && !(swipe && swipe.moved) && Math.abs(turn / QUARTER - Math.round(turn / QUARTER)) < 1e-6;
  const still = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Back to front for the turn in hand. At rest that is row by row as the board now lies, which at
  // no turn is the cells' own order; in between, by how near each cell's middle is.
  function paintOrder(n) {
    const all = Array.from({ length: n * n }, (_, i) => i);
    if (G.flat) return all;
    const near = i => G.near(Math.floor(i / n) + .5, i % n + .5), across = i => { const u = i % n + .5 - n / 2, v = Math.floor(i / n) + .5 - n / 2; return u * G.co - v * G.si - (u * G.si + v * G.co); };
    if (atRest()) { const q = quarters(); return all.sort((i, j) => { const [ri, ci] = turned(i, n, q), [rj, cj] = turned(j, n, q); return ri - rj || ci - cj; }); }
    return all.sort((i, j) => near(i) - near(j) || across(i) - across(j));
  }
  // Where cell i lies, as row and column counted on the board as it now faces (q quarter turns).
  function turned(i, n, q) {
    let r = Math.floor(i / n), c = i % n;
    for (let k = 0; k < q; k++) [r, c] = [c, n - 1 - r];
    return [r, c];
  }
  function turnTo(target, spoken) {
    if (G && G.flat) return;
    if (spin) cancelAnimationFrame(spin.frame);
    const done = () => { spin = null; turn = ((Math.round(target / QUARTER) % 4) + 4) % 4 * QUARTER; draw(); if (spoken) announce('The board turned. ' + ['Its first row runs along the back left.', 'Its first row runs along the back right.', 'Its first row runs along the front right.', 'Its first row runs along the front left.'][quarters()]); };
    if (still() || Math.abs(target - turn) < 1e-3) { done(); return; }
    const from = turn, start = performance.now(), step = now => {
      const t = Math.min(1, (now - start) / 200), ease = 1 - Math.pow(1 - t, 3);
      turn = from + (target - from) * ease;
      if (t === 1) { done(); return; }
      draw(); spin.frame = requestAnimationFrame(step);
    };
    spin = { frame: requestAnimationFrame(step) };
  }
  /* On a solved board, the view from one numbered point: light falls from there along its row or
     column, the towers it reaches stay lit and the ones behind a taller tower fall into shadow.
     `view` is the point in use ({side, k}) or null; a short tour runs once at the solve. */
  let view = null, tour = 0;
  const lineFrom = (side, k) => { const n = puzzle.n, out = []; for (let j = 0; j < n; j++) out.push(side === 'left' ? k * n + j : side === 'right' ? k * n + n - 1 - j : side === 'top' ? j * n + k : (n - 1 - j) * n + k); return out; };
  function sightOf(v) {
    const m = new Map(); let tallest = 0;
    for (const i of lineFrom(v.side, v.k)) { const h = S.cells[i]; m.set(i, h > tallest ? 'seen' : 'shaded'); if (h > tallest) tallest = h; }
    return m;
  }
  const points = () => E.SIDES.flatMap(side => puzzle.clues[side].map((want, k) => want ? { side, k } : null).filter(Boolean));
  function stopTour() { clearTimeout(tour); tour = 0; }
  function look(v, spoken) {
    view = v; draw();
    if (!spoken) return;
    if (!v) { say(''); return; }
    const seen = lineFrom(v.side, v.k).filter(i => sightOf(v).get(i) === 'seen').map(i => S.cells[i]);
    say('From the ' + v.side + ' of ' + (v.side === 'left' || v.side === 'right' ? 'row ' : 'column ') + (v.k + 1) + ': ' + seen.length + (seen.length === 1 ? ' tower shows, height ' : ' towers show, heights ') + seen.join(', ') + '.');
  }
  // Once, at the solve: the light visits the first numbered point on each side, then rests.
  function startTour() {
    stopTour();
    if (document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const stops = E.SIDES.map(side => points().find(p => p.side === side)).filter(Boolean), here = puzzle;
    let n = 0;
    const step = () => {
      if (!S.solved || puzzle !== here) { tour = 0; return; }
      if (n === stops.length) { tour = 0; look(null); return; }
      look(stops[n++]); tour = setTimeout(step, 900);
    };
    tour = setTimeout(step, 900);
  }

  function build() {
    const root = $('#board'), n = puzzle.n, svg = svgNode('svg');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Towers board, ' + n + ' by ' + n);
    for (const name of ['ground', 'clues', 'cells']) {
      const g = svgNode('g'); g.setAttribute('class', name);
      if (name !== 'cells') g.setAttribute('aria-hidden', 'true');
      svg.append(g);
    }
    const ring = svgNode('path'); ring.setAttribute('class', 'focus-ring'); ring.setAttribute('aria-hidden', 'true'); svg.append(ring);
    // The cells are kept in the order they are painted, back to front (see paintOrder).
    for (let i = 0; i < n * n; i++) {
      const g = svgNode('g');
      g.setAttribute('class', 'cell'); g.setAttribute('role', 'button'); g.dataset.i = i;
      g.addEventListener('focus', () => { if (S.focus !== i) { S.focus = i; draw(); } });
      svg.querySelector('.cells').append(g);
    }
    root.replaceChildren(svg);
    draw();
  }

  function cellLabel(i, state) {
    const n = puzzle.n, r = Math.floor(i / n), c = i % n, v = S.cells[i], c4 = puzzle.clues;
    const seen = [[c4.left[r], 'left'], [c4.right[r], 'right'], [c4.top[c], 'top'], [c4.bottom[c], 'bottom']].filter(e => e[0]).map(e => e[0] + ' seen from the ' + e[1]);
    return 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + (v ? (puzzle.given[i] ? 'fixed height ' : 'height ') + v : 'empty') +
      (state.repeats.includes(i) ? ', repeated in its row or column' : '') + (seen.length ? '. ' + seen.join(', ') : '');
  }

  function draw() {
    const root = $('#board'), svg = root.firstElementChild;
    if (!svg) return;
    G = geometry();
    const n = puzzle.n, state = E.inspect(puzzle, S.cells), hint = S.hint;
    const evidence = new Set(hint ? hint.cells : []), hintClues = new Set(hint ? hint.clues.map(c => c.side + c.k) : []);
    root.classList.toggle('flat', G.flat);
    root.classList.toggle('solved', S.solved);
    // The page takes color with the board: the height one taller than the tallest here (towers.css).
    const html = document.documentElement, field = String(n + 1);
    if (S.solved && html.dataset.field !== field) html.dataset.field = field;
    else if (!S.solved && 'field' in html.dataset) delete html.dataset.field;
    svg.setAttribute('width', num(G.w)); svg.setAttribute('height', num(G.h)); svg.setAttribute('viewBox', '0 0 ' + num(G.w) + ' ' + num(G.h));

    let ground = '';
    for (let i = 0; i < n * n; i++) ground += poly(quad(G, Math.floor(i / n), i % n, 0));
    svg.querySelector('.ground').innerHTML = '<path d="' + ground + '"/>';

    let clues = '';
    for (const side of E.SIDES) for (let k = 0; k < n; k++) {
      const want = puzzle.clues[side][k];
      if (!want) continue;
      const [x, y] = cluePoint(G, side, k), mark = state.clues[side][k];
      clues += '<g class="clue ' + mark + (hintClues.has(side + k) ? ' evidence' : '') + (S.solved && view && view.side === side && view.k === k ? ' viewing' : '') + '" data-side="' + side + '" data-k="' + k + '"><circle class="hit" cx="' + num(x) + '" cy="' + num(y) + '" r="' + num(Math.max(23, G.clue * .9)) + '"/><circle cx="' + num(x) + '" cy="' + num(y) + '" r="' + num(G.clue * .62) + '"/><text x="' + num(x) + '" y="' + num(y) + '" font-size="' + num(G.clue) + '">' + want + '</text></g>';
    }
    svg.querySelector('.clues').innerHTML = clues;

    const sight = S.solved && view ? sightOf(view) : null;
    root.classList.toggle('viewing', !!sight);
    root.classList.toggle('turning', !atRest());
    // Keep the cells in painting order. Moving a focused node drops its focus, so it is handed back.
    const cellsLayer = svg.querySelector('.cells'), order = paintOrder(n), nodes = new Map([...cellsLayer.children].map(g => [Number(g.dataset.i), g]));
    if ([...cellsLayer.children].some((g, k) => Number(g.dataset.i) !== order[k])) {
      const held = document.activeElement && cellsLayer.contains(document.activeElement) ? document.activeElement : null;
      for (const i of order) cellsLayer.append(nodes.get(i));
      if (held) held.focus({ preventScroll: true });
    }
    // The four sides of a cell as corner pairs of quad(), each with its outward direction on the grid.
    const SIDES = [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]];
    for (const [i, g] of nodes) {
      const r = Math.floor(i / n), c = i % n, v = S.cells[i], given = !!puzzle.given[i];
      const top = quad(G, r, c, v), base = quad(G, r, c, 0);
      let faces = '';
      if (!G.flat && v) {
        // A side shows when it faces the viewer; it is the left face or the right by which way it leans.
        for (const [p, q, du, dv] of SIDES) {
          const x = du * G.co - dv * G.si, y = du * G.si + dv * G.co;
          if (x + y > 1e-6) faces += '<path class="' + (x - y < 0 ? 'left' : 'right') + '" d="' + poly([base[p], base[q], top[q], top[p]]) + '"/>';
        }
        faces += '<path class="top" d="' + poly(top) + '"/>';
      } else faces = '<path class="' + (given ? 'top' : 'tile') + '" d="' + poly(top) + '"/>';
      // A repeated height is ringed on the tower itself, so a taller tower in front covers it as it would the tower.
      if (state.repeats.includes(i) && !S.solved && !(hint && hint.i === i)) faces += '<path class="mark repeat" d="' + poly(quad(G, r, c, v, .72)) + '"/>';
      const lit = sight ? ' ' + (sight.get(i) || 'aside') : '';
      // The height is written on its own tower, so a tower in front covers it as it covers the tower.
      const [x, y] = G.P(r + .5, c + .5, v);
      let marks = '';
      if (hint && hint.i === i) marks += '<path class="mark target" d="' + poly(quad(G, r, c, v, .72)) + '"/>';
      if (evidence.has(i) && !(hint && hint.i === i)) marks += '<path class="mark evidence" d="' + poly(quad(G, r, c, v, .88)) + '"/>';
      faces += '<g class="labels" aria-hidden="true"><g class="' + (given ? 'given' : '') + lit + '">' + marks + (v ? '<text x="' + num(x) + '" y="' + num(y) + '" font-size="' + num(G.font) + '">' + v + '</text>' : '') + '</g></g>';
      if (g._faces !== faces) { g.innerHTML = faces; g._faces = faces; }
      g.setAttribute('class', 'cell' + (given ? ' given' : '') + lit);
      g.dataset.v = v || 0; // for the solved board's colors only
      g.setAttribute('tabindex', i === S.focus ? '0' : '-1');
      g.setAttribute('aria-label', cellLabel(i, state));
      if (given || S.solved) g.setAttribute('aria-disabled', 'true'); else g.removeAttribute('aria-disabled');
    }
    const f = S.focus, ring = svg.querySelector('.focus-ring');
    ring.setAttribute('d', poly(quad(G, Math.floor(f / n), f % n, S.cells[f], .9)));
    ring.setAttribute('class', 'focus-ring' + (puzzle.given[f] ? ' on-given' : ''));
  }

  function render() {
    draw();
    const n = L.findIndex(p => p.id === at);
    $('#undo-btn').disabled = !S.undo.length;
    $('#readout').textContent = n < 0 ? '' : (n + 1) + ' / ' + L.length + ' · ' + progress.completed.length + ' ✓';
    $('#completion').hidden = !S.solved;
    $('#next-btn').disabled = !S.solved;
    $('#next-btn').setAttribute('aria-label', n === L.length - 1 ? 'Choose next puzzle' : 'Next puzzle');
    $('#feedback').classList.toggle('sr-only', S.solved);
    $('#campaign').value = n < 0 ? '' : at;
    $('#previous').disabled = n <= 0;
    $('#following').disabled = n < 0 || n === L.length - 1;
  }
  function focusCell(i, dom) {
    S.focus = i; draw();
    if (dom) { const node = $('#board').querySelector('.cell[data-i="' + i + '"]'); if (node) node.focus({ preventScroll: true }); }
  }

  // ---- Play
  function save() {
    if (openingAt(at) >= 0) return;
    store.at = at; store.boards[at] = S.cells.slice();
    write(K.current, store); write(K.progress, progress);
  }
  function checkSolved(announce) {
    const was = S.solved, solvedBoard = puzzle;
    S.solved = E.inspect(puzzle, S.cells).solved;
    if (S.solved) {
      if (ids.has(at) && !progress.completed.includes(at)) progress.completed.push(at);
      if (announce) say('Complete.');
      if (!was && announce) startTour();
      if (!was && announce && S.keyboard) requestAnimationFrame(() => { if (S.solved && puzzle === solvedBoard && !document.querySelector('dialog[open]')) $('#next-btn').focus({ preventScroll: true }); });
    }
  }
  function commit(before) {
    if (before.some((v, i) => v !== S.cells[i])) S.undo.push(before);
    S.hint = null; say('');
    checkSolved(true); render(); save();
  }
  function setCell(i, value) {
    if (S.solved || puzzle.given[i] || S.cells[i] === value) return;
    const before = S.cells.slice();
    S.cells[i] = value;
    commit(before);
  }
  // The one verb: empty, 1, 2 ... N, empty.
  const raise = i => setCell(i, (S.cells[i] + 1) % (puzzle.n + 1));
  function undo() {
    const before = S.undo.pop();
    if (!before) return;
    S.cells = before; S.hint = null; say('');
    checkSolved(false); render(); save();
  }
  function restart() {
    const before = S.cells.slice();
    S.cells = E.startCells(puzzle); S.keyboard = false;
    commit(before);
    say('Puzzle restarted. Undo restores your towers.');
  }
  function hint() {
    if (S.solved) { say('Every row, column and number agrees.'); return; }
    if (S.hint) { const move = S.hint; S.hint = null; S.focus = move.i; setCell(move.i, move.value); return; }
    const move = E.next(puzzle, S.cells);
    if (!move) { say('No step found from these towers. Undo or clear a doubtful one.'); return; }
    S.hint = move;
    say(move.text + (move.value ? ' Press Hint again to raise it to ' + move.value + '.' : ' Press Hint again to clear it.'));
    render();
  }
  function switchBoard(id) {
    save();
    at = id; puzzle = board(id);
    S.cells = (store.boards[id] || E.startCells(puzzle)).slice();
    S.undo = []; S.focus = 0; S.hint = null; S.solved = false; S.keyboard = false;
    stopTour(); view = null;
    say(''); checkSolved(false); build(); render(); save();
    if (location.search) history.replaceState(null, '', location.pathname);
  }
  function advance(event) {
    if (!S.solved) return;
    const byKeyboard = !event || event.detail === 0, n = L.findIndex(p => p.id === at), k = openingAt(at);
    if (k >= 0) {
      if (k === OPENING.length - 1) write(K.primer, 1);
      switchBoard(k < OPENING.length - 1 ? OPENING[k + 1].id : store.at);
    } else if (n < L.length - 1) switchBoard(L[n + 1].id);
    else { openSheet('settings', $('#settings-btn')); return; }
    if (byKeyboard) focusCell(0, true);
  }

  // ---- Input. The nearest tower under the pointer takes the tap: SVG hit-tests front to back.
  $('#board').addEventListener('click', e => {
    const node = e.target.closest('.cell');
    if (!node || swiped) return;
    S.keyboard = false;
    const i = Number(node.dataset.i);
    S.focus = i;
    if (S.solved || puzzle.given[i]) { draw(); return; }
    raise(i);
  });
  $('#board').addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Arrows move as the board now faces: the same key goes the same way on the page after any turn.
    const n = puzzle.n, q = G && !G.flat ? quarters() : 0, [r, c] = turned(S.focus, n, q);
    const cellAt = (rr, cc) => { for (let i = 0; i < n * n; i++) { const [a, b] = turned(i, n, q); if (a === rr && b === cc) return i; } return -1; };
    let to = -1;
    S.keyboard = true;
    switch (e.key) {
      case 'ArrowLeft': to = cellAt(r, Math.max(0, c - 1)); break;
      case 'ArrowRight': to = cellAt(r, Math.min(n - 1, c + 1)); break;
      case 'ArrowUp': to = cellAt(Math.max(0, r - 1), c); break;
      case 'ArrowDown': to = cellAt(Math.min(n - 1, r + 1), c); break;
      case 'Home': to = cellAt(r, 0); break;
      case 'End': to = cellAt(r, n - 1); break;
      case 'Enter': case ' ': if (S.solved) advance(); else raise(S.focus); break;
      case 'Delete': case '0': setCell(S.focus, 0); break;
      default:
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) setCell(S.focus, Number(e.key));
        else return;
    }
    e.preventDefault();
    // The edge is named as the board's own: its left stays its left however it is turned.
    if (to === S.focus && e.key.startsWith('Arrow')) { const i = S.focus, rr = Math.floor(i / n), cc = i % n, met = [cc === 0 && 'Left', rr === 0 && 'Top', cc === n - 1 && 'Right', rr === n - 1 && 'Bottom'], k = { ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3 }[e.key]; announce((met[(k + q) % 4] || met[(k + 4 - q) % 4] || met.find(Boolean)) + ' edge.'); }
    else if (to >= 0) announce('');
    if (to >= 0) focusCell(to, true);
  });
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || e.target.matches('select,input,textarea')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || e.key === 'Backspace') { e.preventDefault(); S.keyboard = true; undo(); }
    else if (key === 'h') { e.preventDefault(); S.keyboard = true; hint(); }
    else if (e.key === '[' || e.key === ']') { e.preventDefault(); S.keyboard = true; turnTo((Math.round(turn / QUARTER) + (e.key === ']' ? 1 : -1)) * QUARTER, true); }
    else if (S.solved && key === 'v') {
      // V walks the light round the numbered points; after the last it rests.
      e.preventDefault(); stopTour();
      const all = points(), at = view ? all.findIndex(p => p.side === view.side && p.k === view.k) : -1;
      look(at + 1 < all.length ? all[at + 1] : null, true);
    } else if (S.solved && e.key === 'Escape' && view) { e.preventDefault(); stopTour(); look(null, true); }
  });
  // A sideways drag turns the board, as far as the finger goes; let go and it comes to rest on the
  // nearest quarter turn, or the next one on for a short flick. A tap is still a tap.
  const shell = $('#board-shell');
  shell.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || !G || G.flat) return;
    if (spin) { cancelAnimationFrame(spin.frame); spin = null; }
    swiped = false;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, from: turn, moved: false };
  });
  shell.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.moved) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      swipe.moved = true;
      try { shell.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    }
    turn = swipe.from - dx * .008;
    draw();
  });
  const endSwipe = e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const w = swipe, dx = e.clientX - w.x;
    swipe = null;
    if (!w.moved) return;
    swiped = true; setTimeout(() => { swiped = false; }, 0);
    const base = Math.round(w.from / QUARTER), steps = e.type === 'pointercancel' || Math.abs(dx) < 18 ? 0 : Math.round(-dx * .008 / QUARTER) || -Math.sign(dx);
    turnTo((base + steps) * QUARTER, false);
  };
  shell.addEventListener('pointerup', endSwipe);
  shell.addEventListener('pointercancel', endSwipe);
  $('#turn-btn').addEventListener('click', e => { S.keyboard = e.detail === 0; turnTo((Math.round(turn / QUARTER) + 1) * QUARTER, true); });
  // Tap a number on a solved board to see from there; tap it again, or anywhere else on the board, to rest.
  $('#board').addEventListener('click', e => {
    if (!S.solved) return;
    const clue = e.target.closest && e.target.closest('.clue');
    stopTour();
    if (!clue) { if (view) look(null, true); return; }
    const v = { side: clue.dataset.side, k: Number(clue.dataset.k) };
    look(view && view.side === v.side && view.k === v.k ? null : v, true);
  });
  $('#undo-btn').addEventListener('click', undo);
  $('#hint-btn').addEventListener('click', e => { S.keyboard = e.detail === 0; hint(); });
  $('#restart-btn').addEventListener('click', restart);
  $('#next-btn').addEventListener('click', advance);

  // ---- Sheets and settings
  function openSheet(id, button) {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    lastInvoker = button; $('#' + id).showModal();
  }
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => openSheet(id, $('#' + id + '-btn')));
    $('#' + id).addEventListener('close', () => { if (!document.activeElement.closest('.board,dialog[open]') && lastInvoker) lastInvoker.focus({ preventScroll: true }); });
  }
  L.forEach((p, k) => { const o = document.createElement('option'); o.value = p.id; o.textContent = (k + 1) + ' · ' + p.n + ' × ' + p.n; $('#campaign').append(o); });
  $('#campaign').addEventListener('change', e => { switchBoard(e.target.value); $('#settings').close(); });
  for (const [id, delta] of [['previous', -1], ['following', 1]]) $('#' + id).addEventListener('click', () => {
    const n = L.findIndex(p => p.id === at) + delta;
    if (n >= 0 && n < L.length) switchBoard(L[n].id);
    $('#settings').close();
  });
  function applyPrefs() {
    const html = document.documentElement;
    if (prefs.theme === 'system') delete html.dataset.theme; else html.dataset.theme = prefs.theme;
    html.dataset.motion = prefs.motion;
    for (const id of ['theme', 'motion', 'view']) $('#' + id).value = prefs[id];
  }
  for (const id of ['theme', 'motion', 'view']) $('#' + id).addEventListener('change', e => { prefs[id] = e.target.value; write(K.settings, prefs); applyPrefs(); render(); });
  $('#reset').addEventListener('click', () => { restart(); $('#settings').close(); });
  $('#replay-opening').addEventListener('click', () => { $('#help').close(); switchBoard(OPENING[0].id); });
  window.addEventListener('resize', draw);

  applyPrefs(); checkSolved(false); build(); render(); save();
  // For the tests: the state, and where on the page a cell's top face is.
  window.__towers = {
    S, keys: K,
    get puzzle() { return puzzle; }, get at() { return at; }, get progress() { return progress; },
    get turn() { return { angle: turn, quarters: quarters(), resting: atRest() }; },
    point(i) {
      const box = $('#board svg').getBoundingClientRect(), n = puzzle.n, p = G.P(Math.floor(i / n) + .5, i % n + .5, S.cells[i]);
      return { x: box.left + p[0], y: box.top + p[1] };
    }
  };
})();
