/* Shoo (Minimal): the page. Bees flee from the cell you tap. The rule is in
   engine.js, the boards in boards.js, the thirty of the campaign and their
   order in campaign.js, the finish's palettes in payoff.js. The
   board, the bees and their motion, the hive and the finish are ported from
   shoo/shoo.js; the camera and look-and-hold are left out, and every tap
   leaves a brief ring on the cell it landed on. */
(function () {
  'use strict';
  // The campaign (campaign.js) is thirty of the eighty boards in boards.js, in its own order. Once every
  // one is done the game is finished, and New Game+ deals the other fifty (the pool) at random.
  const E = ShooEngine, all = ShooBoards, boards = ShooCampaign.map(id => all.find(b => b.id === id)), P = ShooPayoff;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg';
  // Version 2 of the board and progress saves holds bees; version 1 held the
  // stones of an earlier rule and is left alone, unread.
  const K = { current: 'shoo-minimal.current.v2', progress: 'shoo-minimal.progress.v2', settings: 'shoo-minimal.settings.v1' };
  const SQ = Math.sqrt(3) / 2, RAD = 1 / Math.sqrt(3);
  // Screen angles of the six directions, east first, as the engine orders them.
  const ANGLE = [0, -60, -120, 180, 120, 60], COMPASS = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const word = n => WORDS[n] || String(n), Word = n => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
  const ease = t => 1 - (1 - t) ** 3, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // Saves are checked against all eighty boards, so a save that names a board outside the campaign is
  // still whole: it is kept as it was. Only campaign boards count as done.
  const known = new Set(all.map(b => b.id)), ids = new Set(boards.map(b => b.id)), boardOf = id => all.find(b => b.id === id);
  const pool = all.filter(b => !ids.has(b.id)), poolIds = new Set(pool.map(b => b.id));
  const hivesOf = b => { const L = E.layout(b); return L.cells.map((x, i) => i).filter(i => L.cells[i].kind === 'hive'); };
  const beeCount = b => E.bits(E.start(b));
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');

  /* ---- Storage: every read is checked; a save that fails is ignored. ---- */
  let storageOk = true;
  function read(key, check, otherwise) {
    try { const raw = localStorage.getItem(key); if (raw === null) return otherwise; const v = JSON.parse(raw); return check(v) ? v : otherwise; } catch (_) { return otherwise; }
  }
  function write(key, value) { if (!storageOk) return; try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { storageOk = false; } }
  const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // A position is trusted only when every part of it fits its board.
  const validBees = (m, b) => Number.isSafeInteger(m) && m >= 0 && m < 2 ** 31 && E.layout(b).cells.every((x, i) => !E.has(m, i) || x.kind === 'open') && m >>> E.layout(b).n === 0;
  const validHomes = (h, m, b) => Array.isArray(h) && h.length === hivesOf(b).length && h.every(n => Number.isSafeInteger(n) && n >= 0) && h.reduce((s, n) => s + n, 0) + E.bits(m) === beeCount(b);
  const validHits = n => Number.isSafeInteger(n) && n >= 0 && n < 100000;
  const validPosition = (p, b) => isObject(p) && validBees(p.bees, b) && validHomes(p.homes, p.bees, b) && validHits(p.hits);
  const boardValid = (id, v) => validPosition(v, boardOf(id)) && Array.isArray(v.undo) && v.undo.length <= 400 && v.undo.every(u => validPosition(u, boardOf(id)));
  const progress = read(K.progress, v => isObject(v) && v.version === 2 && Array.isArray(v.completed) && v.completed.every(id => known.has(id)) && new Set(v.completed).size === v.completed.length, { version: 2, completed: [] });
  const prefs = read(K.settings, v => isObject(v) && v.version === 1 && ['system', 'light', 'dark'].includes(v.theme) && ['system', 'reduce'].includes(v.motion) && ['color', 'plain'].includes(v.finish), { version: 1, theme: 'system', motion: 'system', finish: 'color' });
  const store = read(K.current, v => isObject(v) && v.version === 2 && known.has(v.at) && isObject(v.boards) && Object.keys(v.boards).every(id => known.has(id) && boardValid(id, v.boards[id])), { version: 2, at: boards[0].id, boards: {} });
  // Every campaign board done: the game is finished and New Game+ is open (as in Slant).
  const unlocked = () => boards.every(b => progress.completed.includes(b.id));
  // The pool boards New Game+ has dealt this round, in order; none comes again until all fifty have.
  store.pool = Array.isArray(store.pool) ? [...new Set(store.pool.filter(id => poolIds.has(id)))] : [];
  // A player last on a board outside the campaign stays there once the game is finished (a New Game+
  // board); before that, they go on from the first campaign board not yet done.
  if (!ids.has(store.at)) {
    if (unlocked() && poolIds.has(store.at)) { if (!store.pool.includes(store.at)) store.pool.push(store.at); }
    else store.at = (boards.find(b => !progress.completed.includes(b.id)) || boards[0]).id;
  }
  const asked = Number(new URLSearchParams(location.search).get('level'));
  if (Number.isInteger(asked) && asked >= 1 && asked <= boards.length) store.at = boards[asked - 1].id;

  let board = boardOf(store.at), L = E.layout(board), bees = E.start(board), homes = hivesOf(board).map(() => 0), hits = 0, history = [];
  let hint = null, focus = 0, keyboard = false, hover = null, press = null, washOrigin = null;
  let busy = false, queue = [], animation = null, epoch = 0, finale = false;
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const solved = () => E.solved(bees), home = () => homes.reduce((s, n) => s + n, 0);
  const freeCells = m => L.cells.map((x, i) => i).filter(i => E.has(m, i));
  const indexOfBoard = () => boards.indexOf(board);
  // A New Game+ board has no place in the campaign and shows no id: the id means nothing to a player.
  const boardName = () => indexOfBoard() < 0 ? 'New Game+ board' : 'Board ' + (indexOfBoard() + 1);
  const say = text => { $('#feedback').textContent = text; };
  const announce = text => { $('#live').textContent = text; };
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) n.setAttribute(key, value);
    if (parent) parent.append(n); return n;
  }
  function set(n, attrs) {
    n.cache ||= {};
    for (const key in attrs) { const v = attrs[key]; if (n.cache[key] === v) continue; if (v === null || v === undefined) n.removeAttribute(key); else n.setAttribute(key, v); n.cache[key] = v; }
  }

  /* ---- Geometry. Board units: a cell is one unit across its flats; odd rows
     sit half a unit to the right. The drawing is one SVG in board units; each
     cell is also a hexagonal button above it, the same size. ---- */
  const center = i => { const x = L.cells[i]; return { x: x.c + (x.r & 1) / 2, y: x.r * SQ }; };
  const corners = (cx, cy, k = 1) => [0, 1, 2, 3, 4, 5].map(j => { const a = Math.PI / 180 * (60 * j - 90); return `${(cx + Math.cos(a) * RAD * k).toFixed(4)},${(cy + Math.sin(a) * RAD * k).toFixed(4)}`; }).join(' ');
  function extent() {
    const xs = L.cells.map((_, i) => center(i).x), ys = L.cells.map((_, i) => center(i).y);
    return { x0: Math.min(...xs) - .5, x1: Math.max(...xs) + .5, y0: Math.min(...ys) - RAD, y1: Math.max(...ys) + RAD };
  }
  // Gaps: places inside the board with no cell (the ring boards' middle, the
  // bowtie's notches). Their neighbors' outlines draw them on four or more
  // sides, so on paper they looked like empty cells, though no bee can hop in
  // and no tap lands there. They are hatched in gray hairlines instead.
  function gaps() {
    const out = [];
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      if (L.at(r, c) >= 0) continue;
      const [q] = E.toAxial(r, c), around = E.DIRS.filter(([dq, dr]) => { const [rr, cc] = E.fromAxial(q + dq, r + dr); return L.at(rr, cc) >= 0; }).length;
      if (around >= 4) out.push({ r, c, x: c + (r & 1) / 2, y: r * SQ });
    }
    return out;
  }
  // The hatch: lines rising to the right, spaced .14 apart along x + y, cut to a hexagon a little inside the gap's outline.
  function hatch(cx, cy) {
    const pts = [0, 1, 2, 3, 4, 5].map(j => { const a = Math.PI / 180 * (60 * j - 90); return [Math.cos(a) * RAD * .9, Math.sin(a) * RAD * .9]; });
    let d = '';
    for (let n = 0; n < 10; n++) {
      const k = -.63 + n * .14, hit = [];
      for (let j = 0; j < 6; j++) {
        const [x0, y0] = pts[j], [x1, y1] = pts[(j + 1) % 6], f0 = x0 + y0 - k, f1 = x1 + y1 - k;
        if (f0 === f1 || f0 * f1 > 0) continue;
        const t = f0 / (f0 - f1); hit.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
      if (hit.length < 2) continue;
      hit.sort((a, b) => a[0] - b[0]);
      const [a, b] = [hit[0], hit[hit.length - 1]];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > .02) d += `M${(cx + a[0]).toFixed(4)} ${(cy + a[1]).toFixed(4)}L${(cx + b[0]).toFixed(4)} ${(cy + b[1]).toFixed(4)}`;
    }
    return d;
  }
  const geo = { s: 60, ex: null };
  const root = $('#board');
  let boardGaps = [], gapLayer = null, art = null, cellLayer = null, washLayer = null, markLayer = null, tapLayer = null, beeLayer = null, ringLayer = null, hiveDots = new Map(), beeNodes = new Map(), leaving = new Set(), built = null;
  // As large as the room allows, with a 16px gutter at the sides.
  function fit() {
    const ex = extent(), W = ex.x1 - ex.x0, H = ex.y1 - ex.y0, shell = $('#board-shell');
    const s = Math.max(24, Math.floor(Math.min((shell.clientWidth - 32) / W, (shell.clientHeight - 16) / H, 128)));
    Object.assign(geo, { s, ex });
    root.style.width = W * s + 'px'; root.style.height = H * s + 'px';
    if (art) art.setAttribute('viewBox', `${ex.x0.toFixed(4)} ${ex.y0.toFixed(4)} ${W.toFixed(4)} ${H.toFixed(4)}`);
    root.querySelectorAll('.cell').forEach(n => { const p = center(+n.dataset.i); n.style.cssText = `left:${((p.x - ex.x0 - .5) * s).toFixed(2)}px;top:${((p.y - ex.y0 - RAD) * s).toFixed(2)}px;width:${s}px;height:${(2 * RAD * s).toFixed(2)}px`; });
  }

  /* ---- The board. ---- */
  // A bee: an ink body and head, two paper bands and two hairline wings,
  // pointing along +x; the idle buzz drifts the whole of it a little.
  function beeNode(i, angle) {
    const g = svg('g', { class: 'bee' }, beeLayer), buzz = svg('g', { class: 'buzz' }, g), turn = svg('g', {}, buzz);
    const seed = (i * 7919 + built.id.length * 31 + (beeNodes.size + 1) * 104729) % 1000 / 1000;
    buzz.style.setProperty('--buzz-time', (1.7 + seed * 1.1).toFixed(2) + 's'); buzz.style.setProperty('--buzz-delay', (-seed * 3).toFixed(2) + 's');
    const wings = [-1, 1].map(k => svg('ellipse', { class: 'bee-wing', cx: -.05, cy: .1 * k, rx: .11, ry: .06, transform: `rotate(${26 * k} -.05 ${.1 * k})` }, turn));
    svg('ellipse', { class: 'bee-body', cx: -.02, cy: 0, rx: .17, ry: .1 }, turn);
    svg('circle', { class: 'bee-body', cx: .19, cy: 0, r: .066 }, turn);
    svg('path', { class: 'bee-band', d: 'M-.07 -.084V.084M.03 -.092V.092' }, turn);
    const p = center(i);
    // fly: while the bee dodges a tap on its own cell, its offset, heading, lift and wingbeat.
    return { g, buzz, turn, wings, at: i, x: p.x, y: p.y, angle, scale: 1, opacity: 1, fly: null };
  }
  // Each bee first faces a fixed way of its own, away from the nearest hive.
  function restAngle(i) {
    const p = center(i), h = hivesOf(board).map(center).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const a = h ? Math.atan2(p.y - h.y, p.x - h.x) * 180 / Math.PI : 0;
    return Math.round(a / 60) * 60 + ((i * 37) % 3 - 1) * 14;
  }
  function build() {
    root.replaceChildren(); beeNodes = new Map(); hiveDots = new Map(); leaving = new Set();
    built = board;
    art = svg('svg', { class: 'art', 'aria-hidden': 'true' }, root);
    cellLayer = svg('g', { class: 'cells' }, art);
    gapLayer = svg('g', { class: 'gaps' }, art);
    boardGaps = gaps();
    for (const g of boardGaps) svg('path', { class: 'gap', d: hatch(g.x, g.y), 'data-r': g.r, 'data-c': g.c }, gapLayer);
    washLayer = svg('g', { class: 'wash' }, art);
    markLayer = svg('g', { class: 'marks' }, art);
    L.cells.forEach((x, i) => {
      const p = center(i);
      svg('polygon', { class: 'hex', points: corners(p.x, p.y), 'data-i': i }, cellLayer);
      if (x.kind === 'flower') {
        const g = svg('g', { class: 'flower', transform: `translate(${p.x.toFixed(4)} ${p.y.toFixed(4)})` }, markLayer);
        for (let k = 0; k < 5; k++) { const a = Math.PI / 180 * (72 * k - 90); svg('circle', { class: 'petal', cx: (Math.cos(a) * .115).toFixed(4), cy: (Math.sin(a) * .115).toFixed(4), r: .072 }, g); }
        svg('circle', { class: 'pistil', r: .05 }, g);
      } else if (x.kind === 'hive') {
        const g = svg('g', { class: 'hive', transform: `translate(${p.x.toFixed(4)} ${p.y.toFixed(4)})` }, markLayer);
        svg('polygon', { class: 'hive-body', points: corners(0, 0, .8) }, g);
        svg('path', { class: 'hive-door', d: 'M-.075 .31V.25A.075 .075 0 0 1 .075 .25V.31Z' }, g);
        hiveDots.set(i, svg('g', { class: 'hive-bees' }, g));
      }
    });
    const walls = svg('g', { class: 'walls' }, art);
    for (const [r1, c1, r2, c2] of board.walls || []) {
      const a = center(L.at(r1, c1)), b = center(L.at(r2, c2)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y), px = -(b.y - a.y) / len * RAD / 2, py = (b.x - a.x) / len * RAD / 2;
      svg('line', { class: 'wall', x1: (mx + px).toFixed(4), y1: (my + py).toFixed(4), x2: (mx - px).toFixed(4), y2: (my - py).toFixed(4) }, walls);
    }
    tapLayer = svg('g', { class: 'taps' }, art);
    beeLayer = svg('g', { class: 'bees' }, art);
    ringLayer = svg('g', { class: 'rings' }, art);
    L.cells.forEach((x, i) => {
      const n = document.createElement('div');
      n.className = 'cell'; n.setAttribute('role', 'button'); n.dataset.i = i; n.tabIndex = -1;
      root.append(n);
    });
    fit(); placeBees();
  }
  // Bees on the board as the state has them, each in its cell.
  function placeBees() {
    beeLayer.replaceChildren(); beeNodes = new Map(); leaving = new Set();
    for (const i of freeCells(bees)) beeNodes.set(i, beeNode(i, restAngle(i)));
    drawHomes(); drawBees();
  }
  // Bees already home show as paper dots in their hive above its door.
  const ROWS = [[], [1], [2], [3], [2, 2], [2, 3], [3, 3], [2, 3, 2], [3, 2, 3], [3, 3, 3]];
  function dots(n) {
    const rows = ROWS[Math.min(n, ROWS.length - 1)], ys = rows.length === 1 ? [-.03] : rows.length === 2 ? [-.1, .04] : [-.17, -.03, .11], out = [];
    rows.forEach((m, k) => { for (let j = 0; j < m; j++) out.push([(j - (m - 1) / 2) * .16, ys[k]]); });
    return out;
  }
  function drawHomes() {
    hivesOf(board).forEach((h, k) => {
      const g = hiveDots.get(h); if (!g) return;
      const n = homes[k] || 0;
      if (g.childElementCount === Math.min(n, 9)) return;
      g.replaceChildren();
      for (const [x, y] of dots(n)) svg('circle', { class: 'hive-bee', cx: x.toFixed(3), cy: y.toFixed(3), r: .042 }, g);
    });
  }
  // The tap to come: a cell pressed, under a resting mouse, or under the
  // keyboard focus. Bees beside it turn away from it and, with motion on, lean;
  // a bee on that cell itself is on alert, a little lifted with its wings up.
  function pressure() {
    if (busy || solved()) return null;
    if (press !== null) return { at: press, p: .7 };
    if (hover !== null) return { at: hover, p: .45 };
    if (keyboard && L.cells[focus]) return { at: focus, p: .45 };
    return null;
  }
  function drawBees() {
    const look = pressure(), still = reduced();
    for (const b of [...beeNodes.values(), ...leaving]) {
      let x = b.x, y = b.y, angle = b.angle, lift = 0, wing = 26, state = null;
      if (look && !b.moving) {
        const d = L.nb[look.at].indexOf(b.at);
        if (d >= 0) { angle = ANGLE[d]; if (!still) { const a = ANGLE[d] * Math.PI / 180, k = .07 * look.p; x += Math.cos(a) * k; y += Math.sin(a) * k; } }
        if (look.at === b.at) { lift = .06; wing = 40; state = 'aware'; }
      }
      if (b.fly && !b.moving) { x += b.fly.dx; y += b.fly.dy; angle = b.fly.angle; lift = b.fly.lift; wing = b.fly.wing; state = 'flying'; }
      const scale = b.scale * (1 + lift);
      set(b.g, { transform: `translate(${x.toFixed(4)} ${y.toFixed(4)})` + (Math.abs(scale - 1) > .0005 ? ` scale(${scale.toFixed(3)})` : ''), opacity: b.opacity < 1 ? b.opacity.toFixed(3) : null, 'data-dodge': state });
      set(b.turn, { transform: `rotate(${Math.round(angle)})` });
      // On alert or in flight the wings rise from the body and the idle drift stops.
      b.wings.forEach((w, k) => { const s = k ? 1 : -1; set(w, { transform: `rotate(${(s * wing).toFixed(1)} -.05 ${(s * .1).toFixed(3)})` }); });
      if (b.buzz.style.animationPlayState !== (state ? 'paused' : '')) b.buzz.style.animationPlayState = state ? 'paused' : '';
    }
  }
  // Focus, hint and hover rings in the board, in the tone opposite the cell.
  function drawRings() {
    ringLayer.replaceChildren();
    for (const [i, name, radius] of [[hover, 'hover-ring', .36], [hint && hint.look >= 0 ? hint.look : null, 'hint-ring', .3], [keyboard ? focus : null, 'focus-ring', .42]]) {
      if (i === null || i === undefined || !L.cells[i]) continue;
      const p = center(i), tone = L.cells[i].kind === 'hive' ? 'on-hive' : 'on-page';
      if (name !== 'hover-ring') svg('circle', { class: 'ring-halo ' + tone, cx: p.x.toFixed(4), cy: p.y.toFixed(4), r: radius }, ringLayer);
      svg('circle', { class: name + ' ' + tone, cx: p.x.toFixed(4), cy: p.y.toFixed(4), r: radius }, ringLayer);
    }
    $('#undo-btn').dataset.hint = String(!!(hint && hint.stuck));
  }
  function draw() { if (built !== board) build(); drawBees(); drawRings(); root.dataset.solved = String(solved()); }

  /* ---- Words for a screen reader: where each cell is and what is on it. ---- */
  function placeOf(i) { const x = L.cells[i]; let k = 0; for (let c = 0; c <= x.c; c++) if (L.at(x.r, c) >= 0) k++; return `row ${x.r + 1}, place ${k}`; }
  // Gaps side by side in a row are told as one, with its width.
  function gapRuns() { const out = []; for (const g of boardGaps) { const last = out.at(-1); if (last && last.r === g.r && last.c + last.n === g.c) last.n++; else out.push({ r: g.r, c: g.c, n: 1 }); } return out; }
  function gapPlace({ r, c, n }) { let k = 0; for (let x = 0; x < c; x++) if (L.at(r, x) >= 0) k++; return (k ? `row ${r + 1}, after place ${k}` : `row ${r + 1}, before place 1`) + (n > 1 ? `, ${word(n)} cells wide` : ''); }
  // The directions from cell i that lead into a gap.
  function gapSides(i) {
    const x = L.cells[i], [q] = E.toAxial(x.r, x.c);
    return COMPASS.filter((_, d) => { const [rr, cc] = E.fromAxial(q + E.DIRS[d][0], x.r + E.DIRS[d][1]); return boardGaps.some(g => g.r === rr && g.c === cc); });
  }
  const listOf = list => list.length <= 1 ? list.join('') : list.slice(0, -1).join('; ') + ' and ' + list.at(-1);
  function cellWords(i) {
    const x = L.cells[i], k = hivesOf(board).indexOf(i);
    const what = E.has(bees, i) ? 'a bee' : x.kind === 'flower' ? 'a flower' : x.kind === 'hive' ? `the hive, ${word(homes[k])} ${homes[k] === 1 ? 'bee' : 'bees'} inside` : 'empty';
    const walls = COMPASS.filter((_, d) => L.wall[i] >> d & 1), sides = gapSides(i), near = L.nb[i].filter(j => j >= 0 && E.has(bees, j)).length;
    return `${placeOf(i)}: ${what}${walls.length ? `, a wall to the ${listOf(walls)}` : ''}${sides.length ? `, a gap to the ${listOf(sides)}` : ''}${near ? `, ${word(near)} ${near === 1 ? 'bee' : 'bees'} beside it` : ''}`;
  }
  const optionText = b => `${boards.indexOf(b) + 1} · par ${b.par}${progress.completed.includes(b.id) ? ' ✓' : ''}`;
  function chrome() {
    const done = solved(), n = indexOfBoard(), total = beeCount(board), hives = hivesOf(board), free = freeCells(bees), flowers = L.cells.map((x, i) => x.kind === 'flower' ? i : -1).filter(i => i >= 0);
    const parts = [`${boardName()}. ${Word(total)} ${total === 1 ? 'bee' : 'bees'}. ${hives.length === 1 ? 'One hive' : Word(hives.length) + ' hives'}.`,
      done ? 'Every bee is home.' : `${free.length === 1 ? 'A bee' : 'Bees'} at ${listOf(free.map(placeOf))}.` + (home() ? ` ${Word(home())} home.` : ''),
      `${hives.length === 1 ? 'Hive' : 'Hives'} at ${listOf(hives.map(placeOf))}.`,
      flowers.length ? `${flowers.length === 1 ? 'A flower' : 'Flowers'} at ${listOf(flowers.map(placeOf))}.` : '',
      (board.walls || []).length ? `${Word(board.walls.length)} ${board.walls.length === 1 ? 'wall' : 'walls'} between cells.` : '',
      boardGaps.length ? (runs => `${runs.length === 1 ? 'A gap with no cell' : Word(runs.length) + ' gaps with no cell'} at ${listOf(runs.map(gapPlace))}.`)(gapRuns()) : '',
      `${hits} ${hits === 1 ? 'tap' : 'taps'}, par ${board.par}.`];
    root.setAttribute('aria-label', parts.filter(Boolean).join(' '));
    root.querySelectorAll('.cell').forEach(c => { const i = +c.dataset.i; c.tabIndex = i === focus ? 0 : -1; c.setAttribute('aria-label', cellWords(i)); });
    // A New Game+ board shows taps and par alone, where a campaign board also has its place.
    $('#readout').textContent = `${n < 0 ? '' : `${n + 1} / ${boards.length} · `}${hits} / ${board.par}`;
    $('#readout').setAttribute('aria-label', `${n < 0 ? boardName() : `Board ${n + 1} of ${boards.length}`}; ${hits} ${hits === 1 ? 'tap' : 'taps'}; par ${board.par}`);
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = done;
    const frozen = !done && L.cells.every((_, x) => E.step(board, bees, x) === bees);
    $('#undo-btn').classList.toggle('wanted', frozen && history.length > 0);
    $('#completion').hidden = !done || busy;
    $('#next-btn').setAttribute('aria-label', finale || (n === boards.length - 1 && unlocked()) ? 'Start New Game+' : n === boards.length - 1 ? 'Choose next board' : 'Next board');
    $('#feedback').classList.toggle('sr-only', done);
    $('#campaign').value = n < 0 ? '' : board.id;
    $('#previous').disabled = n <= 0; $('#following').disabled = n < 0 || n === boards.length - 1;
    $('#new-game').disabled = !unlocked();
    $('#generation-details').textContent = unlocked() ? '' : `Complete all ${boards.length} to unlock New Game+.`;
    $('#generation-details').hidden = unlocked();
    for (const o of $('#campaign').options) o.textContent = optionText(boardOf(o.value));
    return frozen;
  }
  function rest() { for (const b of leaving) b.g.remove(); leaving.clear(); drawHomes(); for (const b of beeNodes.values()) { const p = center(b.at); Object.assign(b, { x: p.x, y: p.y, scale: 1, opacity: 1, moving: false }); } draw(); chrome(); }
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
  const pause = ms => reduced() || document.hidden ? Promise.resolve() : new Promise(r => setTimeout(r, ms));

  /* ---- Where a tap landed. A ring in ink opens out from the tapped cell's
     center past its edge and fades, over the cell's own brief shade, so the
     tap reads before the bees go; on the ink hive it rides a paper halo. With
     reduced motion the ring stands still and only fades. A tap that moves
     nothing leaves it too.
     A tap on a bee is dodged: the bee takes off the way it faces, flies one
     quick loop around the tapped point, wide enough to show around a
     fingertip but inside its own cell, and lands where it was, facing as
     before, while its neighbors flee. The loop is the tap's mark: a ring
     opening from the cell as well crossed the bee's path and was too much.
     Under reduced motion there is no flight: a still arc beside the bee says
     it looped and stayed, and fades. ---- */
  const stats = { marks: 0, dodges: 0, solves: 0 }, rippling = new Set();
  let rippleFrame = 0;
  function mark(i) {
    if (!tapLayer || !L.cells[i]) return;
    stats.marks++;
    const p = center(i), still = reduced() || document.hidden, bee = E.has(bees, i) ? beeNodes.get(i) : null;
    const g = svg('g', { class: 'tap' + (L.cells[i].kind === 'hive' ? ' on-hive' : '') + (bee ? ' dodge' : ''), transform: `translate(${p.x.toFixed(4)} ${p.y.toFixed(4)})`, 'data-i': i }, tapLayer);
    const m = { g, still, start: performance.now(), bee };
    if (bee) { stats.dodges++; dodgeMarks(m, i); }
    else {
      m.shade = svg('polygon', { class: 'tap-shade', points: corners(0, 0, .97) }, g);
      m.halo = svg('circle', { class: 'tap-halo', r: .44 }, g); m.ring = svg('circle', { class: 'tap-ring', r: .44 }, g);
    }
    rippling.add(m); paintRipple(m, 0);
    if (!rippleFrame) rippleFrame = requestAnimationFrame(ripple);
  }
  // The ring is drawn frame by frame on its radius and opacity attributes (a
  // CSS scale on the circle painted a disc past the cell's edge in Chromium).
  // It opens fast and slows, from a quarter of its reach to past
  // the cell's edge, holding full ink for the first third and fading over the
  // rest; the shade fades a little later. Under reduced motion the radius
  // stays at the cell's size and only the fade runs.
  const RIPPLE = 620, REACH = .74;
  function paintRipple(m, t) {
    if (m.bee) { paintDodge(m, t * RIPPLE); return; }
    const k = 1 - (1 - t) ** 3, r = m.still ? '0.44' : (REACH * (.24 + .76 * k)).toFixed(4), o = (t < .35 ? 1 : 1 - (t - .35) / .65).toFixed(3);
    set(m.ring, { r, opacity: o }); set(m.halo, { r, opacity: o });
    set(m.shade, { opacity: (.16 * (t < .3 ? 1 : 1 - (t - .3) / .7)).toFixed(3) });
  }
  // The loop: out along the bee's own heading (away from the nearest hive,
  // where it already faces), round the tapped point once at about half a
  // cell, so it passes outside a fingertip on every side, and back in; it
  // turns to its old heading as it lands. Odd and even cells loop opposite
  // ways. The radius stays inside the cell, so it never seems to change cells.
  const FLY = 520, LOOP = .44;
  function dodgeMarks(m, i) {
    const b = m.bee;
    m.home = b.angle; m.turn = i % 2 ? 1 : -1;
    if (m.still) {
      // A three-quarter arc beside the bee, open on the side it would leave from.
      const a0 = (b.angle + 40) * Math.PI / 180, a1 = a0 + 1.5 * Math.PI, r = .34, pt = a => `${(Math.cos(a) * r).toFixed(4)} ${(Math.sin(a) * r).toFixed(4)}`;
      m.arc = svg('path', { class: 'tap-arc', d: `M${pt(a0)}A${r} ${r} 0 1 1 ${pt(a1)}` }, m.g);
      return;
    }
    beeLayer.append(b.g);
  }
  const turnTo = (a, b, k) => { const d = ((b - a) % 360 + 540) % 360 - 180; return a + d * k; };
  function flight(m, u) {
    const env = Math.sin(Math.PI * u) ** .5, phi = m.home * Math.PI / 180 + m.turn * 2 * Math.PI * u;
    return { dx: LOOP * env * Math.cos(phi), dy: LOOP * env * Math.sin(phi), env };
  }
  function paintDodge(m, ms) {
    const t = ms / RIPPLE;
    if (m.still) { set(m.arc, { opacity: (t < .35 ? 1 : 1 - (t - .35) / .65).toFixed(3) }); return; }
    const u = Math.min(1, ms / FLY);
    if (u >= 1) { m.bee.fly = null; return; }
    // Heading: along the path, eased back to the old heading over the last fifth.
    const here = flight(m, u), ahead = flight(m, Math.min(1, u + .02)), along = Math.atan2(ahead.dy - here.dy, ahead.dx - here.dx) * 180 / Math.PI;
    const angle = u < .8 ? along : turnTo(along, m.home, (u - .8) / .2);
    m.bee.fly = { dx: here.dx, dy: here.dy, angle: u < .06 ? turnTo(m.home, along, u / .06) : angle, lift: .16 * here.env, wing: 26 + 24 * Math.abs(Math.sin(ms / 1000 * 2 * Math.PI * 14)) };
  }
  function ripple(now) {
    rippleFrame = 0;
    let flown = false;
    for (const m of rippling) {
      const t = (now - m.start) / RIPPLE;
      if (t >= 1) { m.g.remove(); rippling.delete(m); if (m.bee) { m.bee.fly = null; flown = true; } } else { paintRipple(m, Math.max(0, t)); flown = flown || !!m.bee; }
    }
    // A dodging bee is drawn here, through the beat before its neighbors hop as well.
    if (flown) drawBees();
    if (rippling.size) rippleFrame = requestAnimationFrame(ripple);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { for (const m of rippling) { m.g.remove(); if (m.bee) m.bee.fly = null; } rippling.clear(); } });

  /* ---- The finish: the board becomes honeycomb in a wave out from the hive
     the last bee entered, with one amber ring spreading from there, and holds
     in color until the next board (payoff.js and shoo.css). Finish: Plain
     keeps paper and ink; reduced motion keeps only a fade. ---- */
  const colorOn = () => prefs.finish === 'color';
  const hexAway = (i, j) => { const a = L.cells[i], b = L.cells[j], dq = a.q - b.q, dr = a.r - b.r; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
  // The page takes color with the comb: the hive's own brown (shoo.css). It reaches the page as the wave
  // reaches the comb's far edge, or at once when the comb is drawn at once; it goes when the comb goes.
  function field(on, animate) {
    const html = document.documentElement;
    if (!on) { delete html.dataset.field; return; }
    if (animate || html.dataset.field) { html.dataset.field = 'hive'; return; }
    document.body.style.transition = 'none'; html.dataset.field = 'hive';
    getComputedStyle(document.body).backgroundColor; document.body.style.transition = '';
  }
  function paintWash(origin, animate) {
    if (!washLayer) return;
    washLayer.replaceChildren(); delete root.dataset.finish;
    if (!colorOn() || !solved() || origin === null || origin === undefined) { field(false); return; }
    washOrigin = origin;
    const away = L.cells.map((_, i) => hexAway(origin, i)), most = Math.max(1, ...away), still = reduced() || document.hidden;
    root.dataset.finish = 'comb'; field(true, animate && !still);
    L.cells.forEach((x, i) => {
      const p = center(i), cell = svg('polygon', { class: 'wash-cell wash-' + P.tone(away[i], most), points: corners(p.x, p.y) }, washLayer);
      if (!animate) return;
      if (still) cell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'linear' });
      else cell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: Math.round(900 * away[i] / most), easing: 'ease-out', fill: 'backwards' });
    });
    if (animate && !still) {
      const o = center(origin), g = svg('g', { class: 'wash-ring', transform: `translate(${o.x.toFixed(4)} ${o.y.toFixed(4)})` }, washLayer);
      const ring = svg('circle', { r: (most + .7).toFixed(3) }, g);
      ring.animate([{ transform: 'scale(.05)', opacity: .95 }, { transform: 'scale(1)', opacity: 0 }], { duration: 1050, easing: 'cubic-bezier(.25, .6, .35, 1)', fill: 'forwards' }).finished.then(() => g.remove(), () => g.remove());
    }
  }
  function clearWash() { if (washLayer) washLayer.replaceChildren(); delete root.dataset.finish; washOrigin = null; field(false); }

  /* ---- A shoo: bees beside the tap hop one cell straight away from it, quick
     and light; a bee that cannot go flinches toward where it would have gone;
     a bee reaching a hive goes in. ---- */
  function save() {
    store.at = board.id; store.boards[board.id] = { bees, homes: homes.slice(), hits, undo: history.slice(-400) };
    write(K.current, store); write(K.progress, progress);
  }
  async function shoo(i, token, marked) {
    if (!marked) mark(i);
    const res = E.shoo(board, bees, i), held = E.has(bees, i) ? `The bee at ${placeOf(i)} dodged and stayed; ` : '';
    if (res.mask === bees) {
      const flinch = res.blocked.map(([n, d]) => ({ b: beeNodes.get(n), d }));
      for (const f of flinch) f.b.angle = ANGLE[f.d];
      const why = res.blocked.length ? `${word(res.blocked.length)} ${res.blocked.length === 1 ? 'bee' : 'bees'} beside it cannot move that way` : 'no bee beside it';
      announce(held ? `${held}${why}. No tap counted.` : `${why}. No tap counted.`.replace(/^./, c => c.toUpperCase()));
      await tween(170, t => { const k = .09 * Math.sin(Math.PI * t); for (const { b, d } of flinch) { const p = center(b.at), a = ANGLE[d] * Math.PI / 180; b.x = p.x + Math.cos(a) * k; b.y = p.y + Math.sin(a) * k; b.moving = t < 1; } drawBees(); });
      return;
    }
    history.push({ bees, homes: homes.slice(), hits });
    const hives = hivesOf(board);
    bees = res.mask; hits++; hint = null; say('');
    for (const [, t] of res.home) homes[hives.indexOf(t)]++;
    // The move is saved before any motion, so leaving the page cannot lose it.
    // Only campaign boards count as progress. The solve that does the last of them is the finale.
    if (solved() && ids.has(board.id) && !progress.completed.includes(board.id)) { const had = unlocked(); progress.completed.push(board.id); if (!had && unlocked()) finale = true; }
    save();
    const hops = [...res.moved.map(m => [...m, false]), ...res.home.map(m => [...m, true])].map(([n, t, d, inside]) => ({ b: beeNodes.get(n), t, from: center(n), to: center(t), d, home: inside }));
    const flinch = res.blocked.map(([n, d]) => ({ b: beeNodes.get(n), d }));
    for (const h of hops) { beeNodes.delete(h.b.at); h.b.angle = ANGLE[h.d]; h.b.moving = true; }
    for (const h of hops) if (!h.home) { h.b.at = h.t; beeNodes.set(h.t, h.b); } else leaving.add(h.b);
    for (const f of flinch) f.b.angle = ANGLE[f.d];
    chrome(); drawBees();
    // The bees turn from the tap at once and go a beat after its ring starts,
    // unless another tap is already waiting.
    if (!queue.length) await pause(70);
    if (token !== epoch) return;
    await tween(230, t => {
      const k = ease(t);
      for (const h of hops) {
        h.b.x = h.from.x + (h.to.x - h.from.x) * k; h.b.y = h.from.y + (h.to.y - h.from.y) * k;
        h.b.scale = h.home ? 1 - .7 * k : 1 + .14 * Math.sin(Math.PI * t); h.b.opacity = h.home ? 1 - k : 1;
      }
      const f = .08 * Math.sin(Math.PI * Math.min(1, t * 1.4));
      for (const { b, d } of flinch) { const p = center(b.at), a = ANGLE[d] * Math.PI / 180; b.x = p.x + Math.cos(a) * f; b.y = p.y + Math.sin(a) * f; }
      drawBees();
    });
    if (token !== epoch) return;
    for (const h of hops) { h.b.moving = false; if (h.home) { h.b.g.remove(); leaving.delete(h.b); } }
    drawHomes();
    const hopped = res.moved.length, went = res.home.length;
    if (solved()) {
      stats.solves++; draw(); paintWash(res.home.length ? res.home[0][1] : hivesOf(board)[0], true);
      announce(`Every bee is home in ${hits} ${hits === 1 ? 'tap' : 'taps'}. Par ${board.par}. ${finale ? `All ${boards.length} boards solved.` : indexOfBoard() === boards.length - 1 ? 'That was the last board.' : 'Next board is open.'}`);
    } else if (held) announce(`${held}${word(hopped + went)} ${hopped + went === 1 ? 'bee' : 'bees'} fled${went ? `, ${word(went)} into the hive` : ''}${res.blocked.length ? `; ${word(res.blocked.length)} could not move` : ''}. ${home()} of ${beeCount(board)} home, ${hits} ${hits === 1 ? 'tap' : 'taps'}.`);
    else announce(`${hopped ? `${Word(hopped)} ${hopped === 1 ? 'bee' : 'bees'} hopped away` : ''}${hopped && went ? '; ' : ''}${went ? `${word(went)} went home` : ''}${res.blocked.length ? `; ${word(res.blocked.length)} could not move` : ''}. ${home()} of ${beeCount(board)} home, ${hits} ${hits === 1 ? 'tap' : 'taps'}.`.replace(/^./, c => c.toUpperCase()));
  }
  // Undo, restart and a new board: the bees are put back where the state has them.
  function reset(next) {
    bees = next.bees; homes = next.homes.slice(); hits = next.hits; hint = null; clearWash();
    if (built === board) placeBees(); else build();
  }
  // Hints: a shortest way home from here, searched in small slices so the
  // page never stalls; the first press marks the cell, the second plays it.
  // From a position no bee can leave for home, the hint marks Undo instead.
  let hinting = null;
  function findHint() {
    if (hinting) return hinting.promise;
    const token = epoch, mask = bees, search = E.search(board, mask);
    let done;
    const promise = new Promise(r => { done = r; });
    hinting = { promise };
    const slice = () => {
      if (token !== epoch || mask !== bees) { hinting = null; done(null); return; }
      const start = performance.now();
      let r = null;
      while (!r && performance.now() - start < 6) r = search.run(250);
      if (!r) { setTimeout(slice, 0); return; }
      hinting = null; done(r);
    };
    slice();
    return promise;
  }
  async function act(action) {
    const token = epoch;
    if (action.type === 'shoo') {
      const { i } = action;
      if (!Number.isInteger(i) || !L.cells[i] || solved()) return;
      await shoo(i, token, action.marked);
    } else if (action.type === 'hint') {
      if (solved()) return;
      if (hint && hint.look >= 0) { focus = hint.look; await act({ type: 'shoo', i: hint.look }); return; }
      if (hint && hint.stuck) { await act({ type: 'undo' }); return; }
      const r = await findHint();
      if (!r || token !== epoch) return;
      hint = r.stuck ? { look: -1, stuck: true } : { look: r.look, moves: r.moves };
      if (hint.stuck) { say('No way home for every bee from here. Hint again to undo.'); announce('No way home for every bee from here. Undo, or Hint again to undo.'); }
      else if (E.has(bees, hint.look)) { focus = hint.look; say('Tap the bee in the dashed ring; it dodges and stays. Hint again plays it.'); announce(`Hint: tap the bee at ${placeOf(hint.look)}; it dodges and stays, and the bees beside it flee. Hint again plays it.`); }
      else { focus = hint.look; say('Tap the dashed ring. Hint again plays it.'); announce(`Hint: tap ${placeOf(hint.look)}. Hint again plays it.`); }
      draw(); chrome();
      // A keyboard player's focus goes to the hinted cell, so Enter plays it there too.
      if (keyboard && !hint.stuck && !$('dialog[open]')) root.querySelector(`.cell[data-i="${focus}"]`)?.focus({ preventScroll: true });
    } else if (action.type === 'undo') {
      const previous = history.pop();
      if (previous) { reset(previous); rest(); save(); say(''); announce(`Tap undone. ${hits} ${hits === 1 ? 'tap' : 'taps'}.`); }
    } else if (action.type === 'restart') {
      if (bees === E.start(board) && hits === 0) return;
      history.push({ bees, homes: homes.slice(), hits });
      reset({ bees: E.start(board), homes: hivesOf(board).map(() => 0), hits: 0 }); rest(); save();
      say('Board set up again. Undo brings it back.'); announce('Board restarted. Undo brings it back.');
    } else if (action.type === 'go') {
      const next = boardOf(action.id); if (!next) return;
      board = next; L = E.layout(board); finale = false;
      const saved = store.boards[board.id], kept = saved && boardValid(board.id, saved);
      history = kept ? saved.undo.map(u => ({ bees: u.bees, homes: u.homes.slice(), hits: u.hits })) : [];
      hover = null; press = null; keyboard = !!action.keyboard; focus = 0; say('');
      reset(kept ? saved : { bees: E.start(board), homes: hivesOf(board).map(() => 0), hits: 0 });
      focus = firstCell(); rest(); save();
      if (solved()) paintWash(hivesOf(board)[0], false);
      announce(`${boardName()}. ${Word(beeCount(board))} ${beeCount(board) === 1 ? 'bee' : 'bees'}. Par ${board.par}.`);
    }
  }
  const firstCell = () => { const f = freeCells(bees); return f.length ? f[0] : 0; };
  async function drain() {
    if (busy) return;
    busy = true; chrome();
    try { while (queue.length) { const job = queue.shift(); await act(job.action); job.resolve(); } }
    finally { busy = false; rest(); afterMove(); }
  }
  function enqueue(action, clear = false) {
    if (clear) { epoch++; for (const job of queue) job.resolve(); queue = []; animation?.finish(); }
    return new Promise(resolve => { queue.push({ action, resolve }); drain(); });
  }
  // After play settles: what the rules alone show. No tap can move any bee:
  // said plainly, with Undo marked. A keyboard player's solve hands focus to Next.
  let wasSolved = false;
  function afterMove() {
    const frozen = chrome();
    if (frozen && !$('#feedback').textContent) say('No bee can move. Undo or restart.');
    if (solved() && !wasSolved && keyboard && !$('dialog[open]')) requestAnimationFrame(() => { if (solved() && !$('#completion').hidden) $('#next-btn').focus({ preventScroll: true }); });
    wasSolved = solved();
  }
  // A tap is marked the moment it lands, even while an earlier hop is still
  // in the air; that hop is cut to its end so play keeps up with the taps.
  const shooAt = i => {
    const marked = !!L.cells[i] && !solved();
    if (marked) { mark(i); if (busy) animation?.finish(); }
    return enqueue({ type: 'shoo', i, marked });
  };
  const undo = () => enqueue({ type: 'undo' }, true), restart = () => enqueue({ type: 'restart' }, true), askHint = () => enqueue({ type: 'hint' });
  const go = (id, opts = {}) => ids.has(id) || (unlocked() && poolIds.has(id)) ? enqueue({ type: 'go', id, ...opts }, true).then(() => true) : Promise.resolve(false);
  // New Game+: a pool board at random, one not yet dealt this round (a new round starts once all fifty
  // have been, and never with the board just played). A board already solved before starts fresh.
  function newGame(opts = {}) {
    if (!unlocked()) return Promise.resolve(false);
    let left = pool.filter(b => !store.pool.includes(b.id) && b !== board);
    if (!left.length) { store.pool = []; left = pool.filter(b => b !== board); }
    let r = Math.random();
    try { r = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; } catch (_) {}
    const next = left[Math.floor(r * left.length)];
    store.pool.push(next.id);
    const saved = store.boards[next.id];
    if (saved && (!boardValid(next.id, saved) || E.solved(saved.bees))) delete store.boards[next.id];
    return go(next.id, opts);
  }
  // Next: the following board; after the last, the first board not yet done.
  // As in Slant, the solve that finishes the campaign, the last board once every
  // one is done, and a New Game+ board all lead to a New Game+ board. A board
  // played again starts fresh.
  function advance(event) {
    if (!solved() || busy) return Promise.resolve(false);
    const byKey = !event || event.detail === 0, n = indexOfBoard(), open = boards.find(b => !progress.completed.includes(b.id));
    delete store.boards[board.id];
    const then = moved => { if (moved && byKey) focusCell(focus); return moved; };
    if (finale || n < 0 || (n === boards.length - 1 && !open)) return newGame({ keyboard: byKey }).then(then);
    return go((n < boards.length - 1 ? boards[n + 1] : open).id, { keyboard: byKey }).then(then);
  }

  /* ---- Input: tap or click a cell; a press shows who will flee. ---- */
  const cellOf = e => { const n = e.target.closest && e.target.closest('.cell'); return n && root.contains(n) ? +n.dataset.i : null; };
  root.addEventListener('pointerdown', e => {
    const i = cellOf(e); if (i === null || e.button > 0) return;
    if (keyboard) keyboard = false;
    press = solved() ? null : i; drawRings(); drawBees();
  });
  const unpress = () => { if (press !== null) { press = null; drawBees(); } };
  for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, unpress);
  root.addEventListener('pointerleave', e => { unpress(); if (hover !== null) { hover = null; drawRings(); drawBees(); } });
  root.addEventListener('click', e => {
    const i = cellOf(e); if (i === null) return;
    keyboard = false; focus = i; press = null;
    if (solved()) { draw(); return; }
    shooAt(i);
  });
  // A resting mouse shows who would flee: the bees beside it turn away.
  root.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const i = solved() ? null : cellOf(e);
    if (i !== hover) { hover = i; drawRings(); drawBees(); }
  });
  root.addEventListener('focusin', e => {
    const i = cellOf(e); if (i === null) return;
    const keyed = e.target.matches(':focus-visible') && !keyboard;
    if (keyed) keyboard = true;
    if (keyed || i !== focus) { focus = i; drawRings(); drawBees(); chrome(); }
  });
  function focusCell(i) { focus = i; drawRings(); drawBees(); chrome(); const n = root.querySelector(`.cell[data-i="${i}"]`); if (n) n.focus({ preventScroll: true }); }
  // Arrows: along the row, or to the nearest cell of the row above or below.
  function neighbor(from, key) {
    const c = L.cells[from], here = center(from);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const d = key === 'ArrowLeft' ? -1 : 1;
      for (let x = c.c + d; x >= 0 && x < L.cols; x += d) { const i = L.at(c.r, x); if (i >= 0) return i; }
      return from;
    }
    const d = key === 'ArrowUp' ? -1 : 1;
    for (let r = c.r + d; r >= 0 && r < L.rows; r += d) {
      let best = -1, gap = Infinity;
      L.cells.forEach((o, i) => { if (o.r !== r) return; const g = Math.abs(center(i).x - here.x) + (o.c === c.c ? 0 : .01); if (g < gap) { gap = g; best = i; } });
      if (best >= 0 && gap < 1.1) return best;
    }
    return from;
  }
  document.addEventListener('keydown', e => {
    if ($('dialog[open]') || e.target.matches('select,input,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) { e.preventDefault(); hover = null; const first = !keyboard; keyboard = true; focusCell(first ? focus : neighbor(focus, key)); return; }
    if (key === 'Home' || key === 'End') { e.preventDefault(); keyboard = true; const row = L.cells.map((c, i) => c.r === L.cells[focus].r ? i : -1).filter(i => i >= 0); focusCell(key === 'Home' ? row[0] : row[row.length - 1]); return; }
    if (key === 'Enter' || key === ' ') {
      if (e.target.closest('button,a,summary')) return;
      e.preventDefault(); keyboard = true;
      if (solved()) advance(); else shooAt(focus);
    } else if (['z', 'Z', 'u', 'U', 'Backspace'].includes(key)) { e.preventDefault(); undo(); }
    else if (key === 'h' || key === 'H') { e.preventDefault(); keyboard = true; askHint(); }
  });
  for (const name of ['dragstart', 'selectstart', 'contextmenu']) root.addEventListener(name, e => e.preventDefault());

  /* ---- Toolbar, sheets and settings. ---- */
  const ICONS = { undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', reset: 'M5 7a8 8 0 1 1-1 9M5 3v5h5' };
  for (const [id, name] of [['restart-btn', 'reset'], ['undo-btn', 'undo'], ['hint-btn', 'hint'], ['next-btn', 'next'], ['settings-btn', 'settings'], ['help-btn', 'help']]) $('#' + id).innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';
  $('#undo-btn').addEventListener('click', undo);
  $('#hint-btn').addEventListener('click', askHint);
  $('#restart-btn').addEventListener('click', restart);
  $('#next-btn').addEventListener('click', advance);
  $('#new-game').addEventListener('click', () => { if (unlocked()) { newGame(); $('#settings').close(); } });
  let lastInvoker = null;
  function openSheet(id, button) {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    hover = null; press = null; drawRings(); drawBees();
    lastInvoker = button; $('#' + id).showModal();
  }
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => openSheet(id, $('#' + id + '-btn')));
    $('#' + id).addEventListener('close', () => { if (lastInvoker && !document.activeElement.closest('.board,dialog[open]')) lastInvoker.focus({ preventScroll: true }); });
    $('#' + id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }
  for (const b of boards) { const o = document.createElement('option'); o.value = b.id; o.textContent = optionText(b); $('#campaign').append(o); }
  $('#campaign').addEventListener('change', e => { if (ids.has(e.target.value)) go(e.target.value); $('#settings').close(); });
  for (const [id, delta] of [['previous', -1], ['following', 1]]) $('#' + id).addEventListener('click', () => {
    const n = indexOfBoard() + delta;
    if (n >= 0 && n < boards.length) go(boards[n].id);
    $('#settings').close();
  });
  $('#reset').addEventListener('click', () => { restart(); $('#settings').close(); });
  function applyPrefs() {
    const html = document.documentElement;
    if (prefs.theme === 'system') delete html.dataset.theme; else html.dataset.theme = prefs.theme;
    if (prefs.motion === 'system') delete html.dataset.motion; else html.dataset.motion = 'reduce';
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion; $('#finish').value = prefs.finish;
    if (reduced()) animation?.finish();
    if (built) { if (!busy) rest(); else draw(); if (solved()) paintWash(washOrigin ?? hivesOf(board)[0], false); else clearWash(); }
  }
  for (const id of ['theme', 'motion', 'finish']) $('#' + id).addEventListener('change', e => { prefs[id] = e.target.value; write(K.settings, prefs); applyPrefs(); });
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { if (built) { fit(); draw(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) animation?.finish(); });

  /* ---- The test hook. ---- */
  const at = (r, c) => L.at(r, c), rc = i => [L.cells[i].r, L.cells[i].c];
  window.__shoo = {
    boards,
    get at() { return board.id; },
    get state() { return { at: board.id, bees: freeCells(bees).map(rc), mask: bees, homes: homes.slice(), home: home(), total: beeCount(board), solved: solved(), hits, par: board.par, undo: history.length, hint: hint && (hint.stuck ? { stuck: true } : { r: L.cells[hint.look].r, c: L.cells[hint.look].c }), focus: rc(focus), keyboard, busy, done: progress.completed.slice() }; },
    shoo: (r, c) => at(r, c) >= 0 ? shooAt(at(r, c)) : Promise.resolve(), undo, restart, go, next: () => advance(), hint: askHint, newGame: () => newGame(),
    get pool() { return { dealt: store.pool.slice(), size: pool.length, unlocked: unlocked(), finale }; },
    index: (r, c) => at(r, c),
    center(r, c) { const n = root.querySelector(`.cell[data-i="${at(r, c)}"]`); if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, size: b.width }; },
    bees() { return [...beeNodes.values()].map(b => ({ r: L.cells[b.at].r, c: L.cells[b.at].c, angle: +(b.turn.getAttribute('transform') || '').replace(/[^\d.-]/g, ''), transform: b.g.getAttribute('transform'), dodge: b.g.getAttribute('data-dodge'), wing: b.wings[0].getAttribute('transform'), drift: b.buzz.style.animationPlayState || 'running' })); },
    get payoff() { return { marks: stats.marks, dodges: stats.dodges, solves: stats.solves, live: tapLayer ? tapLayer.childElementCount : 0, wash: washLayer ? washLayer.querySelectorAll('.wash-cell').length : 0, finish: root.dataset.finish || null }; },
    neighbor, keys: K
  };
  window.__minimalize = { bounds() { const b = cellLayer.getBoundingClientRect(); return { x: b.x - .5, y: b.y - .5, width: b.width + 1, height: b.height + 1 }; } };

  applyPrefs();
  {
    const saved = store.boards[board.id], kept = saved && boardValid(board.id, saved);
    if (kept) { bees = saved.bees; homes = saved.homes.slice(); hits = saved.hits; history = saved.undo.map(u => ({ bees: u.bees, homes: u.homes.slice(), hits: u.hits })); }
  }
  focus = firstCell(); build(); rest(); save(); afterMove();
  if (solved()) paintWash(hivesOf(board)[0], false);
  // The shared control frame and the fonts may settle the page after this
  // first layout; measure again once they have.
  addEventListener('load', () => { fit(); draw(); });
})();
