/* Shoo. By Luke Steuber.
   The camera input (prompt, calibration, look and hold, the toolbar's look
   targets, privacy) follows Glance's page, so the two games are played alike. */
(function () {
  'use strict';
  const E = ShooEngine, boards = ShooBoards, G = ShooGaze, T = ShooTrack, P = ShooPayoff;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = 'shoo.v1';
  const boardNode = $('#board'), layer = $('#gaze-layer');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = G.clamp, ease = t => 1 - (1 - t) ** 3;
  const INPUTS = ['head', 'eyes', 'pointer'], SELECTS = ['dwell', 'tap'], HOLDS = [600, 800, 1000, 1400], BUZZ = ['buzz', 'calm'], REWARDS = ['colour', 'calm'], SOUNDS = ['off', 'on'];
  const SQ = Math.sqrt(3) / 2, RAD = 1 / Math.sqrt(3);
  // Screen angles of the six directions, east first, as the engine orders them.
  const ANGLE = [0, -60, -120, 180, 120, 60], COMPASS = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const word = n => WORDS[n] || String(n), Word = n => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
  const hivesOf = b => { const L = E.layout(b); return L.cells.map((x, i) => i).filter(i => L.cells[i].kind === 'hive'); };
  const beeCount = b => E.bits(E.start(b));
  let board = boards[0], L = E.layout(board), bees = E.start(board), homes = hivesOf(board).map(() => 0), hits = 0, history = [], finished = new Set();
  let prefs = { theme: 'system', motion: 'system', buzz: 'buzz', rewards: 'colour', sound: 'off', input: 'head', select: 'tap', dwell: 800 };
  let calibration = { head: null, eyes: null }, lastCamera = 'head', protectSave = false;
  // A save is trusted only when every part of it fits its board.
  const validBees = (m, b) => Number.isSafeInteger(m) && m >= 0 && m < 2 ** 31 && E.layout(b).cells.every((x, i) => !E.has(m, i) || x.kind === 'open') && m >>> E.layout(b).n === 0;
  const validHomes = (h, m, b) => Array.isArray(h) && h.length === hivesOf(b).length && h.every(n => Number.isSafeInteger(n) && n >= 0) && h.reduce((s, n) => s + n, 0) + E.bits(m) === beeCount(b);
  const validHits = n => Number.isSafeInteger(n) && n >= 0;
  const validSettings = s => !!s && ['system', 'light', 'dark'].includes(s.theme) && ['system', 'reduce'].includes(s.motion) && BUZZ.includes(s.buzz) && REWARDS.includes(s.rewards) && SOUNDS.includes(s.sound) && INPUTS.includes(s.input) && SELECTS.includes(s.select) && HOLDS.includes(s.dwell);
  // Settings saved before Rewards and Sound existed take their defaults.
  const withDefaults = s => s && typeof s === 'object' ? { rewards: 'colour', sound: 'off', ...s } : s;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(b => b.id === s?.board);
      if (!s || s.v !== 1 || !b || !validBees(s.bees, b) || !validHomes(s.homes, s.bees, b) || !validHits(s.hits)) throw Error('Invalid save');
      if (!Array.isArray(s.history) || s.history.length > 10000 || !s.history.every(h => h && validBees(h.bees, b) && validHomes(h.homes, h.bees, b) && validHits(h.hits))) throw Error('Invalid save');
      if (!Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id)) || !validSettings(withDefaults(s.settings)) || !['head', 'eyes'].includes(s.lastCamera)) throw Error('Invalid save');
      // A calibration that does not read is dropped on its own (it is asked for
      // again); it used to discard the whole save, boards and all.
      if (!s.calibration || typeof s.calibration !== 'object') s.calibration = { head: null, eyes: null };
      for (const k of ['head', 'eyes']) if (!(s.calibration[k] === null || (G.validCalibration(s.calibration[k]) && s.calibration[k].kind === k))) s.calibration[k] = null;
      board = b; L = E.layout(b); bees = s.bees; homes = s.homes.slice(); hits = s.hits; history = s.history; finished = new Set(s.finished); prefs = withDefaults(s.settings); calibration = { head: s.calibration.head, eyes: s.calibration.eyes }; lastCamera = s.lastCamera;
    }
  } catch (_) { protectSave = true; }
  // Every board is open from the start; a new player begins on board 1.
  let hint = null, focus = 0, keyboard = false, hover = null;
  const gestures = new Map();
  let busy = false, queue = [], animation = null, epoch = 0;
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const solved = () => E.solved(bees), home = () => homes.reduce((s, n) => s + n, 0);
  const freeCells = m => L.cells.map((x, i) => i).filter(i => E.has(m, i));
  function announce(text) { $('#announcement').textContent = text; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, board: board.id, bees, homes, hits, history, finished: [...finished], settings: prefs, calibration, lastCamera })); } catch (_) {}
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

  // ---- Geometry. Board units: a cell is one unit across its flats; odd rows
  // sit half a unit to the right.
  const centre = i => { const x = L.cells[i]; return { x: x.c + (x.r & 1) / 2, y: x.r * SQ }; };
  const corners = (cx, cy, k = 1) => [0, 1, 2, 3, 4, 5].map(j => { const a = Math.PI / 180 * (60 * j - 90); return `${(cx + Math.cos(a) * RAD * k).toFixed(4)},${(cy + Math.sin(a) * RAD * k).toFixed(4)}`; }).join(' ');
  function extent() {
    const xs = L.cells.map((_, i) => centre(i).x), ys = L.cells.map((_, i) => centre(i).y);
    return { x0: Math.min(...xs) - .5, x1: Math.max(...xs) + .5, y0: Math.min(...ys) - RAD, y1: Math.max(...ys) + RAD };
  }
  // The board is as large as fits between the header and the toolbar, by
  // height as well as width, keeping only a thin clear gap round it and a
  // narrow band at the page's sides, where trackers are weakest. While
  // choosing is by look and hold the toolbar's own Undo and Hint grow to at
  // least a phone's smallest cell and become look targets themselves (as in Glance).
  const M = .07, GAP = 12, geo = { s: 60, ox: 0, oy: 0, band: 16, dead: 10, cells: new Map(), area: null };
  const railMode = () => matchMedia('(max-height:520px) and (min-width:560px)').matches;
  const toolSize = () => clamp(Math.round(Math.min(innerWidth, innerHeight) / 6), 64, 160);
  const visibleTools = () => [...document.querySelectorAll('.toolbar button')].filter(n => n.offsetParent !== null);
  function fit() {
    const ex = extent(), W = ex.x1 - ex.x0, H = ex.y1 - ex.y0, short = Math.min(innerWidth, innerHeight), band = Math.max(10, Math.round(short * .03));
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
    const inset = Math.max(band, restart.right + 6), size = (l, r, t) => Math.min((r - l) / (W + 2 * M), (bottom - t) / (H + 2 * M));
    const wide = { left: band, right, top: Math.max(band, restart.bottom + GAP) }, high = { left: inset, right: Math.min(right, innerWidth - inset), top: Math.max(band, readout.bottom + 6) };
    const pick = size(high.left, high.right, high.top) > size(wide.left, wide.right, wide.top) ? high : wide, { left, top } = pick;
    right = pick.right;
    const s = Math.max(24, Math.floor(size(left, right, top) * 2) / 2);
    geo.area = { x: left, y: top, w: right - left, h: bottom - top };
    Object.assign($('#board-shell').style, { top: top + 'px', left: left + 'px', right: innerWidth - right + 'px', bottom: innerHeight - bottom + 'px' });
    boardNode.setAttribute('viewBox', `${(ex.x0 - M).toFixed(4)} ${(ex.y0 - M).toFixed(4)} ${(W + 2 * M).toFixed(4)} ${(H + 2 * M).toFixed(4)}`);
    boardNode.style.width = (W + 2 * M) * s + 'px'; boardNode.style.height = (H + 2 * M) * s + 'px';
    const r = boardNode.getBoundingClientRect();
    Object.assign(geo, { s, band, ox: r.left + (M - ex.x0) * s, oy: r.top + (M - ex.y0) * s, dead: Math.max(10, s * .15), rect: { left: r.left + M * s, top: r.top + M * s, right: r.left + (W + M) * s, bottom: r.top + (H + M) * s } });
    geo.cells = new Map();
    L.cells.forEach((x, i) => { const p = centre(i); geo.cells.set(i, { id: `cell:${i}`, kind: 'cell', i, r: x.r, c: x.c, x: geo.ox + p.x * s, y: geo.oy + p.y * s, w: s }); });
    placeGlyph();
  }
  // Page units to pixels: -1 to 1 across the reach inside the outer band.
  function toScreen(u, v) {
    const x0 = geo.band, x1 = innerWidth - geo.band, y0 = geo.band, y1 = innerHeight - geo.band;
    return { x: (x0 + x1) / 2 + u * (x1 - x0) / 2, y: (y0 + y1) / 2 + v * (y1 - y0) / 2 };
  }
  // The cell under a page point: the nearest cell centre of the whole
  // lattice, which is the hexagon the point lies in, if the board has it.
  function cellAt(x, y) {
    const ux = (x - geo.ox) / geo.s, uy = (y - geo.oy) / geo.s, r0 = Math.round(uy / SQ);
    let best = null, bd = Infinity;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const off = (r & 1) / 2, c0 = Math.round(ux - off);
      for (let c = c0 - 1; c <= c0 + 1; c++) { const d = (ux - c - off) ** 2 + (uy - r * SQ) ** 2; if (d < bd) { bd = d; best = [r, c]; } }
    }
    const i = best ? L.at(best[0], best[1]) : -1;
    return i >= 0 ? geo.cells.get(i) : null;
  }

  // ---- The board.
  let built = null, cellLayer = null, washLayer = null, fadeLayer = null, bloomLayer = null, hiveDots = new Map(), beeLayer = null, ringLayer = null, beeNodes = new Map(), leaving = new Set();
  // A bee: an ink body and head, two paper bands and two hairline wings,
  // pointing along +x; the idle buzz drifts the whole of it a little.
  function beeNode(i, angle) {
    const g = svg('g', { class: 'bee' }, beeLayer), buzz = svg('g', { class: 'buzz' }, g), turn = svg('g', {}, buzz);
    const seed = (i * 7919 + built.id.length * 31 + (beeNodes.size + 1) * 104729) % 1000 / 1000;
    buzz.style.setProperty('--buzz-time', (1.7 + seed * 1.1).toFixed(2) + 's'); buzz.style.setProperty('--buzz-delay', (-seed * 3).toFixed(2) + 's');
    svg('ellipse', { class: 'bee-wing', cx: -.05, cy: -.1, rx: .11, ry: .06, transform: 'rotate(-26 -.05 -.1)' }, turn);
    svg('ellipse', { class: 'bee-wing', cx: -.05, cy: .1, rx: .11, ry: .06, transform: 'rotate(26 -.05 .1)' }, turn);
    svg('ellipse', { class: 'bee-body', cx: -.02, cy: 0, rx: .17, ry: .1 }, turn);
    svg('circle', { class: 'bee-body', cx: .19, cy: 0, r: .066 }, turn);
    svg('path', { class: 'bee-band', d: 'M-.07 -.084V.084M.03 -.092V.092' }, turn);
    const p = centre(i);
    const b = { g, turn, at: i, x: p.x, y: p.y, angle, scale: 1, opacity: 1 };
    return b;
  }
  // Each bee first faces a fixed way of its own, away from the nearest hive.
  function restAngle(i) {
    const p = centre(i), h = hivesOf(board).map(centre).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const a = h ? Math.atan2(p.y - h.y, p.x - h.x) * 180 / Math.PI : 0;
    return Math.round(a / 60) * 60 + ((i * 37) % 3 - 1) * 14;
  }
  function build() {
    boardNode.replaceChildren(); beeNodes = new Map(); hiveDots = new Map();
    cellLayer = svg('g', { id: 'cells', 'aria-hidden': 'true' }, boardNode);
    washLayer = svg('g', { id: 'wash', 'aria-hidden': 'true' }, boardNode);
    fadeLayer = svg('g', { id: 'fades', 'aria-hidden': 'true' }, boardNode);
    const marks = svg('g', { id: 'marks', 'aria-hidden': 'true' }, boardNode);
    built = board;
    L.cells.forEach((x, i) => {
      const p = centre(i);
      svg('polygon', { class: 'cell', points: corners(p.x, p.y), 'data-i': i }, cellLayer);
      if (x.kind === 'flower') {
        const g = svg('g', { class: 'flower', transform: `translate(${p.x.toFixed(4)} ${p.y.toFixed(4)})` }, marks);
        for (let k = 0; k < 5; k++) { const a = Math.PI / 180 * (72 * k - 90); svg('circle', { class: 'petal', cx: (Math.cos(a) * .115).toFixed(4), cy: (Math.sin(a) * .115).toFixed(4), r: .072 }, g); }
        svg('circle', { class: 'pistil', r: .05 }, g);
      } else if (x.kind === 'hive') {
        const g = svg('g', { class: 'hive', transform: `translate(${p.x.toFixed(4)} ${p.y.toFixed(4)})` }, marks);
        svg('polygon', { class: 'hive-body', points: corners(0, 0, .8) }, g);
        svg('path', { class: 'hive-door', d: 'M-.075 .31V.25A.075 .075 0 0 1 .075 .25V.31Z' }, g);
        hiveDots.set(i, svg('g', { class: 'hive-bees' }, g));
      }
    });
    const walls = svg('g', { id: 'walls', 'aria-hidden': 'true' }, boardNode);
    for (const [r1, c1, r2, c2] of board.walls || []) {
      const a = centre(L.at(r1, c1)), b = centre(L.at(r2, c2)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y), px = -(b.y - a.y) / len * RAD / 2, py = (b.x - a.x) / len * RAD / 2;
      svg('line', { class: 'wall', x1: (mx + px).toFixed(4), y1: (my + py).toFixed(4), x2: (mx - px).toFixed(4), y2: (my - py).toFixed(4) }, walls);
    }
    bloomLayer = svg('g', { id: 'blooms', 'aria-hidden': 'true' }, boardNode);
    beeLayer = svg('g', { id: 'bees', 'aria-hidden': 'true' }, boardNode);
    ringLayer = svg('g', { id: 'rings', 'aria-hidden': 'true' }, boardNode);
    placeBees();
  }
  // Bees on the board as the state has them, each in its cell.
  function placeBees() {
    beeLayer.replaceChildren(); beeNodes = new Map(); leaving = new Set();
    for (const i of freeCells(bees)) beeNodes.set(i, beeNode(i, restAngle(i)));
    drawHomes(); drawBees();
  }
  // Bees already home show as paper dots in their hive above its door, in
  // centred rows packed like cells: one row up to three, then two or three rows.
  const ROWS = [[], [1], [2], [3], [2, 2], [2, 3], [3, 3], [2, 3, 2]];
  function dots(n) {
    const rows = ROWS[Math.min(n, 7)], ys = rows.length === 1 ? [-.03] : rows.length === 2 ? [-.1, .04] : [-.17, -.03, .11], out = [];
    rows.forEach((m, k) => { for (let j = 0; j < m; j++) out.push([(j - (m - 1) / 2) * .16, ys[k]]); });
    return out;
  }
  function drawHomes() {
    hivesOf(board).forEach((h, k) => {
      const g = hiveDots.get(h); if (!g) return;
      const n = homes[k] || 0;
      if (g.childElementCount === n) return;
      g.replaceChildren();
      for (const [x, y] of dots(n)) svg('circle', { class: 'hive-bee', cx: x.toFixed(3), cy: y.toFixed(3), r: .042 }, g);
    });
  }
  // The look under way: a cell whose ring is filling, or a cell under a
  // resting mouse. Bees beside it turn away from it and, with motion on, lean.
  function pressure() {
    if (busy || solved()) return null;
    let at = null, p = 0;
    for (const [id, q] of dwell.rings()) if (id.startsWith('cell:') && q > p) { at = +id.slice(5); p = q; }
    if (at === null && hover !== null) { at = hover; p = .45; }
    return at === null ? null : { at, p };
  }
  function drawBees() {
    const look = pressure(), still = reduced();
    for (const b of [...beeNodes.values(), ...leaving]) {
      let x = b.x, y = b.y, angle = b.angle;
      if (look && !b.moving) {
        const d = L.nb[look.at].indexOf(b.at);
        if (d >= 0) { angle = ANGLE[d]; if (!still) { const a = ANGLE[d] * Math.PI / 180, k = .07 * look.p; x += Math.cos(a) * k; y += Math.sin(a) * k; } }
      }
      set(b.g, { transform: `translate(${x.toFixed(4)} ${y.toFixed(4)})` + (b.scale !== 1 ? ` scale(${b.scale.toFixed(3)})` : ''), opacity: b.opacity < 1 ? b.opacity.toFixed(3) : null });
      set(b.turn, { transform: `rotate(${Math.round(angle)})` });
    }
  }
  // Focus, hint and hover rings in the board, in the tone opposite the cell.
  function drawRings() {
    ringLayer.replaceChildren();
    for (const [i, name, radius] of [[hover, 'hover-ring', .36], [hint && hint.look >= 0 ? hint.look : null, 'hint-ring', .3], [keyboard ? focus : null, 'focus-ring', .42]]) {
      if (i === null || i === undefined || !L.cells[i]) continue;
      const p = centre(i), tone = L.cells[i].kind === 'hive' ? 'on-hive' : 'on-page';
      if (name !== 'hover-ring') svg('circle', { class: 'ring-halo ' + tone, cx: p.x.toFixed(4), cy: p.y.toFixed(4), r: radius }, ringLayer);
      svg('circle', { class: name + ' ' + tone, cx: p.x.toFixed(4), cy: p.y.toFixed(4), r: radius }, ringLayer);
    }
    $('#undo-btn').dataset.hint = String(!!(hint && hint.stuck));
  }
  function draw() { if (built !== board) build(); drawBees(); drawRings(); boardNode.dataset.busy = String(busy); boardNode.dataset.solved = String(solved()); }
  // Where a cell is, in words a screen reader can say: its row and its place in that row.
  function placeOf(i) { const x = L.cells[i]; let k = 0; for (let c = 0; c <= x.c; c++) if (L.at(x.r, c) >= 0) k++; return `row ${x.r + 1}, place ${k}`; }
  const listOf = list => list.length <= 1 ? list.join('') : list.slice(0, -1).join('; ') + ' and ' + list.at(-1);
  function cellWords(i) {
    const x = L.cells[i], k = hivesOf(board).indexOf(i);
    const what = E.has(bees, i) ? 'a bee' : x.kind === 'flower' ? 'a flower' : x.kind === 'hive' ? `the hive, ${word(homes[k])} ${homes[k] === 1 ? 'bee' : 'bees'} inside` : 'empty';
    const walls = COMPASS.filter((_, d) => L.wall[i] >> d & 1), near = L.nb[i].filter(j => j >= 0 && E.has(bees, j)).length;
    return `${placeOf(i)}: ${what}${walls.length ? `, a wall to the ${listOf(walls)}` : ''}${near ? `, ${word(near)} ${near === 1 ? 'bee' : 'bees'} beside it` : ''}`;
  }
  function chrome() {
    const done = solved(), n = boards.indexOf(board), total = beeCount(board), hives = hivesOf(board), free = freeCells(bees), flowers = L.cells.map((x, i) => x.kind === 'flower' ? i : -1).filter(i => i >= 0);
    // Deadpan, but it states the board as it is.
    const parts = [`Board ${n + 1}. ${Word(total)} ${total === 1 ? 'bee' : 'bees'}. ${hives.length === 1 ? 'One hive' : Word(hives.length) + ' hives'}. They do not like being looked at.`,
      done ? 'Every bee is home.' : `${free.length === 1 ? 'A bee' : 'Bees'} at ${listOf(free.map(placeOf))}.` + (home() ? ` ${Word(home())} home.` : ''),
      `${hives.length === 1 ? 'Hive' : 'Hives'} at ${listOf(hives.map(placeOf))}.`,
      flowers.length ? `${flowers.length === 1 ? 'A flower' : 'Flowers'} at ${listOf(flowers.map(placeOf))}.` : '',
      (board.walls || []).length ? `${Word(board.walls.length)} ${board.walls.length === 1 ? 'wall' : 'walls'} between cells.` : '',
      `${hits} ${hits === 1 ? 'look' : 'looks'}, par ${board.par}.`, `Focus ${cellWords(focus)}.`];
    boardNode.setAttribute('aria-label', parts.filter(Boolean).join(' '));
    $('#readout').textContent = `${n + 1} / ${boards.length} · ${hits} / ${board.par}`;
    $('#readout').setAttribute('aria-label', `Board ${n + 1} of ${boards.length}; ${hits} looks; par ${board.par}`);
    boardNode.dataset.busy = String(busy);
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = done;
    $('#next-btn').hidden = !done || busy || n === boards.length - 1;
    const on = ['starting', 'calibrating', 'camera'].includes(phase);
    $('#camera-btn').setAttribute('aria-pressed', String(on)); $('#camera-btn').setAttribute('aria-label', on ? 'Stop the camera' : 'Start the camera');
    $('#select').disabled = prefs.input !== 'pointer'; $('#calibrate').disabled = prefs.input === 'pointer';
    $('#input').value = prefs.input; $('#select').value = prefs.input === 'pointer' ? prefs.select : 'dwell'; $('#dwell').value = String(prefs.dwell);
    catalog(); placeGlyph(); placeGlyphSoon();
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
      const button = list.children[i].firstChild, here = b === board, done = finished.has(b.id);
      button.dataset.state = here ? 'current' : done ? 'completed' : 'available';
      button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, done ? 'Completed' : null, !here && !done ? 'Available' : null].filter(Boolean).join(' · ');
      if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }
  function rest() { for (const b of leaving) b.g.remove(); leaving.clear(); drawHomes(); for (const b of beeNodes.values()) { const p = centre(b.at); Object.assign(b, { x: p.x, y: p.y, scale: 1, opacity: 1, moving: false }); } draw(); chrome(); }
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
  // ---- Rewards. Each bee shooed blooms where it lands: a few soft dots in
  // the board's palette spread about half a cell and fade, in half a second,
  // under the bees and never in the way. A finished board takes colour: its
  // cells fill with the palette in a wave out from the hive the last bee
  // entered, over about a second, with one ring spreading from there, and it
  // holds in colour until the next board. Reduced motion keeps only fades;
  // Rewards: Calm keeps paper and ink. Sound is off unless turned on.
  const audio = P.sound(), stats = { blooms: 0, solves: 0 };
  const colourOn = () => prefs.rewards === 'colour';
  const stopsNow = () => P.paletteFor(boards.indexOf(board), dark());
  const hexAway = (i, j) => { const a = L.cells[i], b = L.cells[j], dq = a.q - b.q, dr = a.r - b.r; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
  let washOrigin = null;
  function bloom(i, delay) {
    if (!colourOn() || !bloomLayer) return;
    stats.blooms++;
    const still = reduced() || document.hidden, p = centre(i), stops = stopsNow(), g = svg('g', { class: 'bloom', transform: `translate(${p.x.toFixed(4)} ${p.y.toFixed(4)})` }, still ? fadeLayer : bloomLayer);
    const done = a => a.finished.then(() => g.remove(), () => g.remove());
    if (still) {
      // No movement: a short colour fade on the cell, under the hive and the bees.
      const hex = svg('polygon', { class: 'bloom-fade', points: corners(0, 0, .94), fill: P.colourAt(stops, .5) }, g);
      done(hex.animate([{ opacity: 0 }, { opacity: .6, offset: .4 }, { opacity: 0 }], { duration: 200, easing: 'linear' }));
      return;
    }
    const n = 8, turn = (i * 53 + hits * 29) % 45;
    let last = null;
    for (let k = 0; k < n; k++) {
      const a = (turn + k * 45) * Math.PI / 180, d = .4 + .05 * (k % 3), at = f => `translate(${(Math.cos(a) * d * f).toFixed(3)}px, ${(Math.sin(a) * d * f).toFixed(3)}px)`;
      const dot = svg('circle', { class: 'bloom-dot', r: k % 2 ? .078 : .062, fill: P.colourAt(stops, k / (n - 1)) }, g);
      last = dot.animate([{ transform: `${at(0)} scale(.3)`, opacity: 0 }, { transform: `${at(.55)} scale(1)`, opacity: 1, offset: .25 }, { transform: `${at(.85)} scale(.95)`, opacity: .9, offset: .62 }, { transform: `${at(1)} scale(.55)`, opacity: 0 }], { duration: 500, delay, easing: 'cubic-bezier(.25, .6, .35, 1)', fill: 'backwards' });
    }
    done(last);
  }
  function paintWash(origin, animate) {
    if (!washLayer) return;
    washLayer.replaceChildren();
    if (!colourOn() || !solved() || origin === null || origin === undefined) return;
    washOrigin = origin;
    const stops = stopsNow(), away = L.cells.map((_, i) => hexAway(origin, i)), most = Math.max(1, ...away), still = reduced() || document.hidden;
    L.cells.forEach((x, i) => {
      const p = centre(i), cell = svg('polygon', { class: 'wash-cell', points: corners(p.x, p.y), fill: P.colourAt(stops, away[i] / most) }, washLayer);
      if (!animate) return;
      // Reduced motion: the colour fades in where it stands.
      if (still) cell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'linear' });
      else cell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: Math.round(900 * away[i] / most), easing: 'ease-out', fill: 'backwards' });
    });
    if (animate && !still) {
      const o = centre(origin), g = svg('g', { class: 'wash-ring', transform: `translate(${o.x.toFixed(4)} ${o.y.toFixed(4)})` }, washLayer);
      const ring = svg('circle', { r: (most + .7).toFixed(3), stroke: P.colourAt(stops, .35) }, g);
      ring.animate([{ transform: 'scale(.05)', opacity: .95 }, { transform: 'scale(1)', opacity: 0 }], { duration: 1050, easing: 'cubic-bezier(.25, .6, .35, 1)', fill: 'forwards' }).finished.then(() => g.remove(), () => g.remove());
    }
  }
  function clearRewards() { for (const n of [washLayer, fadeLayer, bloomLayer]) if (n) n.replaceChildren(); washOrigin = null; }
  // A shoo: bees beside the look hop one cell straight away from it, quick and
  // light; a bee that cannot go flinches towards where it would have gone; a
  // bee reaching a hive goes in.
  async function shoo(i, token) {
    const res = E.shoo(board, bees, i);
    if (res.mask === bees) {
      const flinch = res.blocked.map(([n, d]) => ({ b: beeNodes.get(n), d }));
      for (const f of flinch) f.b.angle = ANGLE[f.d];
      announce(res.blocked.length ? `${Word(res.blocked.length)} ${res.blocked.length === 1 ? 'bee' : 'bees'} beside it cannot move that way. No look counted.` : 'No bee beside that cell. No look counted.');
      await tween(170, t => { const k = .09 * Math.sin(Math.PI * t); for (const { b, d } of flinch) { const p = centre(b.at), a = ANGLE[d] * Math.PI / 180; b.x = p.x + Math.cos(a) * k; b.y = p.y + Math.sin(a) * k; b.moving = t < 1; } drawBees(); });
      return;
    }
    history.push({ bees, homes: homes.slice(), hits });
    const hives = hivesOf(board);
    bees = res.mask; hits++; hint = null;
    for (const [, t] of res.home) homes[hives.indexOf(t)]++;
    // The move is saved before any motion, so leaving the page cannot lose it.
    if (solved()) finished.add(board.id);
    save();
    const hops = [...res.moved.map(m => [...m, false]), ...res.home.map(m => [...m, true])].map(([n, t, d, inside]) => ({ b: beeNodes.get(n), t, from: centre(n), to: centre(t), d, home: inside }));
    const flinch = res.blocked.map(([n, d]) => ({ b: beeNodes.get(n), d }));
    for (const h of hops) { beeNodes.delete(h.b.at); h.b.angle = ANGLE[h.d]; h.b.moving = true; }
    for (const h of hops) if (!h.home) { h.b.at = h.t; beeNodes.set(h.t, h.b); } else leaving.add(h.b);
    for (const f of flinch) f.b.angle = ANGLE[f.d];
    chrome();
    // Each bee shooed blooms where it lands, as it lands.
    for (const h of hops) bloom(h.t, reduced() ? 0 : 150);
    if (prefs.sound === 'on') { if (solved()) audio.chord(); else audio.tick(home()); }
    await tween(230, t => {
      const k = ease(t);
      for (const h of hops) {
        h.b.x = h.from.x + (h.to.x - h.from.x) * k; h.b.y = h.from.y + (h.to.y - h.from.y) * k;
        h.b.scale = h.home ? 1 - .7 * k : 1 + .14 * Math.sin(Math.PI * t); h.b.opacity = h.home ? 1 - k : 1;
      }
      const f = .08 * Math.sin(Math.PI * Math.min(1, t * 1.4));
      for (const { b, d } of flinch) { const p = centre(b.at), a = ANGLE[d] * Math.PI / 180; b.x = p.x + Math.cos(a) * f; b.y = p.y + Math.sin(a) * f; }
      drawBees();
    });
    if (token !== epoch) return;
    for (const h of hops) { h.b.moving = false; if (h.home) { h.b.g.remove(); leaving.delete(h.b); } }
    drawHomes();
    const hopped = res.moved.length, went = res.home.length;
    if (solved()) {
      // The finished board takes colour from the hive the last bee entered;
      // Next is there at once, and nothing waits for the colour.
      stats.solves++; draw(); paintWash(res.home.length ? res.home[0][1] : hivesOf(board)[0], true);
      announce(`Every bee is home in ${hits} looks. Par ${board.par}. ${boards.indexOf(board) === boards.length - 1 ? 'That was the last board.' : 'Next board is open.'}`);
    } else announce(`${hopped ? `${Word(hopped)} ${hopped === 1 ? 'bee' : 'bees'} hopped away` : ''}${hopped && went ? '; ' : ''}${went ? `${word(went)} went home` : ''}${res.blocked.length ? `; ${word(res.blocked.length)} could not move` : ''}. ${home()} of ${beeCount(board)} home, ${hits} looks.`.replace(/^./, c => c.toUpperCase()));
  }
  // Undo, restart and a new board: the bees are put back where the state has them.
  function reset(next) {
    bees = next.bees; homes = next.homes.slice(); hits = next.hits; hint = null; clearRewards();
    if (built === board) placeBees(); else build();
  }
  // Hints: a shortest way home from here, searched in small slices so the
  // page never stalls; the first press marks the cell, the second plays it.
  // From a state no bee can leave for home, the hint marks undo instead.
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
      await shoo(i, token);
    } else if (action.type === 'hint') {
      if (solved()) return;
      if (hint && hint.look >= 0) { focus = hint.look; await act({ type: 'shoo', i: hint.look }); return; }
      if (hint && hint.stuck) { await act({ type: 'undo' }); return; }
      const r = await findHint();
      if (!r || token !== epoch) return;
      hint = r.stuck ? { look: -1, stuck: true } : { look: r.look, moves: r.moves };
      if (hint.stuck) announce('No bee can get home from here. Undo, or Hint again to undo.');
      else { focus = hint.look; announce(`Hint: look at ${placeOf(hint.look)}. Hint again plays it.`); }
      draw(); chrome();
    } else if (action.type === 'undo') {
      const previous = history.pop();
      if (previous) { reset(previous); rest(); save(); announce(`Look undone. ${hits} looks.`); }
      else { rest(); announce('No look to undo.'); }
      afterBoardChange();
    } else if (action.type === 'restart' || action.type === 'go') {
      if (action.type === 'go') { const next = boards.find(b => b.id === action.id); if (!next) return; board = next; L = E.layout(board); }
      history = []; hover = null;
      reset({ bees: E.start(board), homes: hivesOf(board).map(() => 0), hits: 0 }); focus = firstCell();
      fit(); rest(); save(); afterBoardChange();
      announce(action.type === 'restart' ? 'Board restarted.' : `Board ${boards.indexOf(board) + 1}. ${Word(beeCount(board))} ${beeCount(board) === 1 ? 'bee' : 'bees'}. Par ${board.par}.`);
    }
  }
  const firstCell = () => { const f = freeCells(bees); return f.length ? f[0] : 0; };
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
  const shooAt = i => enqueue({ type: 'shoo', i });
  const undo = () => enqueue({ type: 'undo' }, true), restart = () => enqueue({ type: 'restart' }, true), askHint = () => enqueue({ type: 'hint' });
  // Any board can be opened, from Settings or from the test hook; an unknown id is refused.
  const go = id => boards.some(b => b.id === id) ? enqueue({ type: 'go', id }, true).then(() => true) : Promise.resolve(false);
  const next = () => { const b = boards[boards.indexOf(board) + 1]; return b && solved() && !busy ? go(b.id) : Promise.resolve(false); };

  // ---- Input. `phase` is where the player is: the camera's first screen
  // (prompt), the camera starting, calibrating, playing by camera, or by pointer.
  let phase = 'pointer', calib = null, face = false, gaze = null, freshHold = false, resumeOnShow = false, virtual = false;
  const pointer = { x: 0, y: 0, present: false };
  const filters = () => prefs.input === 'eyes' ? [G.oneEuro({ minCutoff: .45, beta: .35 }), G.oneEuro({ minCutoff: .45, beta: .35 })] : [G.oneEuro({ minCutoff: .8, beta: .6 }), G.oneEuro({ minCutoff: .8, beta: .6 })];
  let [fu, fv] = filters();
  const dwellOn = () => phase === 'camera' || (phase === 'pointer' && prefs.select === 'dwell');
  const pointerDwell = () => (phase === 'pointer' && prefs.select === 'dwell') || phase === 'prompt';
  const inSafe = (x, y) => x >= geo.band && y >= geo.band && x <= innerWidth - geo.band && y <= innerHeight - geo.band;
  const within = (t, x, y, grow) => Math.hypot(x - t.cx, y - t.cy) <= t.r + grow;
  // The camera glyph stands in the rest area below the board, centred between
  // the board and the toolbar where the Next disc would sit; where the board
  // fills the height, beside it instead (between board and rail on a phone
  // turned sideways). Never over a cell or a control, sized to the room; if
  // Next is waiting where the glyph would be, the glyph stands clear of it.
  function placeGlyph() {
    const n = $('#camera-start'); if (n.hidden || !cellLayer) return;
    const b = cellLayer.getBoundingClientRect(), tools = visibleTools().map(x => x.getBoundingClientRect()), rail = railMode() && tools.length > 0, need = 64 + 24;
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
  // The frame places Next a frame later; the glyph then steps clear of it.
  function placeGlyphSoon() { requestAnimationFrame(() => requestAnimationFrame(placeGlyph)); }
  function glyphTarget() { const n = $('#camera-start'); if (n.hidden) return null; const b = n.getBoundingClientRect(); return { id: 'camera', kind: 'camera', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 }; }
  function nextTarget() { const n = $('#next-btn'); if (n.hidden || !n.isConnected) return null; const b = n.getBoundingClientRect(); return b.width ? { id: 'next', kind: 'next', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 } : null; }
  // The toolbar's own Undo and Hint, as look targets while choosing is by
  // look and hold (and only while they would do something).
  function toolTargets() {
    if (!dwellOn()) return [];
    return [['undo-btn', 'tool:undo'], ['hint-btn', 'tool:hint']].map(([el, id]) => { const n = $('#' + el); if (!n || n.disabled || n.offsetParent === null) return null; const b = n.getBoundingClientRect(); return { id, kind: 'tool', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2, x: b.left, y: b.top, w: b.width, h: b.height }; }).filter(Boolean);
  }
  const inBox = (t, x, y, grow) => x >= t.x - grow && x <= t.x + t.w + grow && y >= t.y - grow && y <= t.y + t.h + grow;
  // What a look at (x, y) would choose: the toolbar's Undo and Hint and the
  // Next disc wherever they stand; cells and the camera glyph only inside the
  // outer band; nothing in the rest area or behind a sheet.
  function targetAt(x, y) {
    if ($('dialog[open]')) return null;
    if (phase === 'prompt') { const g = glyphTarget(); return g && inSafe(x, y) && within(g, x, y, 0) ? g : null; }
    if (!dwellOn()) return null;
    for (const t of toolTargets()) if (inBox(t, x, y, 0)) return t;
    const n = nextTarget(); if (n && within(n, x, y, 0)) return n;
    if (!inSafe(x, y)) return null;
    return solved() ? null : cellAt(x, y);
  }
  function holds(t, x, y) {
    if ($('dialog[open]')) return false;
    if (t.kind === 'tool' || t.kind === 'next') { const live = t.kind === 'next' ? (dwellOn() ? nextTarget() : null) : toolTargets().find(q => q.id === t.id); return !!live && (t.kind === 'next' ? within(live, x, y, geo.dead) : inBox(live, x, y, geo.dead)); }
    if (!inSafe(x, y)) return false;
    if (t.kind === 'cell') return dwellOn() && !solved() && geo.cells.get(t.i) === t && (Math.hypot(x - t.x, y - t.y) <= t.w / 2 + geo.dead || cellAt(x, y) === t);
    const live = t.kind === 'camera' ? glyphTarget() : null;
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
    if (t.kind === 'cell') { focus = t.i; shooAt(t.i); }
    else if (t.id === 'tool:undo') undo();
    else if (t.id === 'tool:hint') askHint();
    else if (t.id === 'next') next();
    else if (t.id === 'camera') startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  }
  // A new board, or a new way of looking, starts with whatever lies under the
  // point already counted as chosen, so a resting look cannot pick it.
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
    const s = G.stillness(calib.window, keys, tolerance), span = calib.window.length ? t - calib.window[0].t : 0, centre0 = calib.captured[0];
    // Each edge dot needs the look moved its own way: across for the side
    // dots, up or down for the top and bottom ones. A turn alone used to
    // take a top or bottom dot with no nod at all.
    const spot = calib.spots[calib.step], axis = keys[[0, 0, 0, 1, 1][spot]], away = from => Math.abs(s.mean[axis] - from[axis]) >= travel;
    // And the right and bottom dots must lie on the other side of the centre
    // from the left and top ones. Still looking up when the bottom dot came
    // used to take it there, and the calibration then ran up and down backwards.
    const pair = spot === 2 ? 1 : spot === 4 ? 3 : -1, across = pair < 0 || !s.mean || Math.sign(s.mean[axis] - centre0[axis]) !== Math.sign(calib.captured[pair][axis] - centre0[axis]);
    const moved = calib.step === 0 || (!!s.mean && away(centre0) && away(calib.captured[calib.captured.length - 1]) && across);
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
    announce('Camera ready. Look at a cell beside a bee and hold.');
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
  const dot = svg('g', { class: 'gaze-dot' }, layer); svg('circle', { class: 'gaze-halo', r: 18 }, dot); svg('circle', { class: 'gaze-core', r: 7 }, dot);
  const ringsLayer = svg('g', { class: 'dwell-rings' }, layer), spotLayer = svg('g', { class: 'spot-layer' }, layer);
  svg('circle', { class: 'spot-halo', r: 15 }, spotLayer); svg('circle', { class: 'spot', r: 9 }, spotLayer);
  svg('circle', { class: 'dwell-track on-page', r: 26 }, spotLayer); const spotArc = svg('circle', { class: 'dwell-arc on-page', r: 26 }, spotLayer);
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
      if (id.startsWith('cell:')) { const t = geo.cells.get(+id.slice(5)); if (!t) continue; cx = t.x; cy = t.y; r = geo.s * .36; tone = L.cells[t.i].kind === 'hive' ? 'on-hive' : 'on-page'; }
      // On the toolbar's buttons and the Next disc the ring fills inside them.
      else if (id.startsWith('tool:')) { const t = toolTargets().find(x => x.id === id); if (!t) continue; cx = t.cx; cy = t.cy; r = t.r - 4; }
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
    if (!busy && built === board) drawBees();
  }

  // ---- Pointer, touch and keys.
  const nearest = event => { const t = cellAt(event.clientX, event.clientY); return t ? t.i : null; };
  // Each pointer is its own press, so two thumbs tapping in turn both count.
  boardNode.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.pointerType === 'mouse' && !e.isPrimary) || $('dialog[open]') || nearest(e) === null) return;
    keyboard = false; gestures.set(e.pointerId, { x: e.clientX, y: e.clientY, last: { clientX: e.clientX, clientY: e.clientY }, travel: 0 });
    boardNode.focus({ preventScroll: true }); try { boardNode.setPointerCapture(e.pointerId); } catch (_) {} drawRings();
  });
  const tapsChoose = () => phase === 'camera' || phase === 'prompt' || (phase === 'pointer' && prefs.select === 'tap');
  function release(e) {
    const g = gestures.get(e.pointerId); if (!g) return;
    const at = e.type === 'lostpointercapture' ? g.last : e;
    gestures.delete(e.pointerId); try { boardNode.releasePointerCapture(e.pointerId); } catch (_) {}
    const travel = Math.max(g.travel, Math.hypot(at.clientX - g.x, at.clientY - g.y)), p = nearest(at);
    if (travel > 12 || p === null || !tapsChoose()) return;
    // A tap on the dimmed first board means play by touch.
    if (phase === 'prompt') toPointer();
    focus = p; shooAt(p);
  }
  window.addEventListener('pointermove', e => {
    const g = gestures.get(e.pointerId);
    if (g) {
      g.last = { clientX: e.clientX, clientY: e.clientY };
      g.travel = Math.max(g.travel, Math.hypot(e.clientX - g.x, e.clientY - g.y));
      if (e.pointerType === 'mouse' && e.buttons === 0) release(e);
    }
    if (e.pointerType !== 'touch' || e.buttons) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); }
    // A resting mouse is a look too: the bees beside it turn away.
    if (e.pointerType === 'mouse' && !$('dialog[open]') && phase === 'pointer' && prefs.select === 'tap') { const p = solved() ? null : nearest(e); if (p !== hover) { hover = p; drawRings(); drawBees(); } }
  });
  window.addEventListener('pointerdown', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); });
  for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, e => { if (e.pointerType === 'touch') pointer.present = false; });
  document.documentElement.addEventListener('pointerleave', () => { pointer.present = false; });
  window.addEventListener('pointerup', release);
  // Capture lost before the release counts as the release. Lost while still
  // pressed, the press waits for its pointerup on the window.
  boardNode.addEventListener('lostpointercapture', e => { if (e.buttons === 0) release(e); });
  window.addEventListener('pointercancel', e => { gestures.delete(e.pointerId); });
  boardNode.addEventListener('pointerleave', () => { if (hover !== null) { hover = null; drawRings(); drawBees(); } });
  boardNode.addEventListener('focus', () => { if (!gestures.size) keyboard = true; drawRings(); chrome(); });
  boardNode.addEventListener('blur', () => { keyboard = false; drawRings(); });
  // Arrows: left and right along the row, up and down to the nearest cell in
  // the next row that has one, keeping to a straight line on average.
  function step(from, key) {
    const x = L.cells[from], here = centre(from);
    if (key === 'ArrowLeft' || key === 'ArrowRight') { const d = key === 'ArrowLeft' ? -1 : 1; for (let c = x.c + d; c >= 0 && c < L.cols; c += d) { const i = L.at(x.r, c); if (i >= 0) return i; } return from; }
    const dr = key === 'ArrowUp' ? -1 : 1;
    for (let r = x.r + dr; r >= 0 && r < L.rows; r += dr) {
      let best = -1, bd = Infinity;
      for (let c = 0; c < L.cols; c++) { const i = L.at(r, c); if (i < 0) continue; const dx = centre(i).x - here.x, d = Math.abs(dx) + (dx > 0 === !(x.r & 1) ? 0 : .01); if (d < bd) { bd = d; best = i; } }
      if (best >= 0) return best;
    }
    return from;
  }
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape' && ['starting', 'calibrating'].includes(phase)) { e.preventDefault(); stopCamera(); return; }
    if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); undo(); return; }
    if (key === 'h') { e.preventDefault(); askHint(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      e.preventDefault(); focus = step(focus, key);
      keyboard = true; hover = null; boardNode.focus({ preventScroll: true }); drawRings(); drawBees(); chrome();
    }
    if ((key === 'Enter' || key === ' ') && e.target === boardNode && L.cells[focus] && phase !== 'calibrating' && phase !== 'starting') { e.preventDefault(); if (phase === 'prompt') toPointer(); shooAt(focus); }
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
  $('#undo-btn').onclick = once('tool:undo', undo); $('#restart-btn').onclick = restart; $('#hint-btn').onclick = once('tool:hint', askHint);
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
  $('#dwell').onchange = e => { prefs.dwell = +e.target.value; dwell.time = prefs.dwell; save(); announce(`Hold for ${prefs.dwell / 1000} seconds.`); };
  $('#calibrate').onclick = () => { $('#settings').close(); if (prefs.input === 'pointer') return; if (phase === 'camera' || phase === 'calibrating') beginCalibration(true); else startCamera(prefs.input, { full: true }); };
  function applyPrefs() {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme; root.dataset.motion = prefs.motion; root.dataset.buzz = prefs.buzz === 'calm' || reduced() ? 'calm' : 'buzz';
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion; $('#buzz').value = prefs.buzz; $('#rewards').value = prefs.rewards; $('#sound').value = prefs.sound;
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (reduced()) animation?.finish();
    if (!busy) rest(); else draw();
    if (solved()) paintWash(washOrigin ?? hivesOf(board)[0], false); else clearRewards();
  }
  for (const id of ['theme', 'motion', 'buzz', 'rewards']) $('#' + id).onchange = e => { prefs[id] = e.target.value; applyPrefs(); save(); announce(id === 'theme' ? 'Theme changed.' : id === 'motion' ? 'Motion setting changed.' : id === 'rewards' ? (prefs.rewards === 'calm' ? 'Rewards in paper and ink only.' : 'Rewards in colour.') : prefs.buzz === 'calm' ? 'The bees hold still.' : 'The bees buzz.'); };
  // Sound: the first sound after it is turned on makes the audio context, inside this gesture.
  $('#sound').onchange = e => { prefs.sound = e.target.value; save(); if (prefs.sound === 'on') audio.tick(0); else audio.close(); announce(prefs.sound === 'on' ? 'Sound on.' : 'Sound off.'); };
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
  const at = (r, c) => L.at(r, c), rc = i => [L.cells[i].r, L.cells[i].c];
  window.__shoo = {
    boards,
    get board() { return board.id; },
    get state() { return { bees: freeCells(bees).map(rc), mask: bees, homes: homes.slice(), home: home(), total: beeCount(board), solved: solved(), hits, par: board.par, hint: hint && (hint.stuck ? { stuck: true } : { r: L.cells[hint.look].r, c: L.cells[hint.look].c }), focus: rc(focus), busy }; },
    get input() { return { phase, mode: prefs.input, select: prefs.select, dwell: prefs.dwell, camera: { ...T.status(), virtual }, face, calibrating: calib && { step: calib.step, of: calib.spots.length, progress: calib.progress, full: calib.full }, gaze: gaze && { ...gaze }, current: dwell.current && dwell.current.id, blocked: dwell.blocked, rings: dwell.rings(), calibration: JSON.parse(JSON.stringify(calibration)) }; },
    shoo: (r, c) => at(r, c) >= 0 ? shooAt(at(r, c)) : Promise.resolve(), undo, restart, go, next, hint: askHint,
    cell: (r, c) => at(r, c) >= 0 ? `cell:${at(r, c)}` : null,
    center(r, c) { const t = geo.cells.get(at(r, c)); return t && { x: t.x, y: t.y, size: t.w }; },
    geometry() { const box = id => { const n = $('#' + id), b = n.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }; return { s: geo.s, band: geo.band, dead: geo.dead, rect: { ...geo.rect }, area: { ...geo.area }, tool: toolSize(), tools: { undo: box('undo-btn'), hint: box('hint-btn') }, targets: toolTargets().map(t => t.id), next: nextTarget(), glyph: glyphTarget(), spots: G.SPOTS.map(p => toScreen(p.u, p.v)) }; },
    bees() { return [...beeNodes.values()].map(b => ({ r: L.cells[b.at].r, c: L.cells[b.at].c, angle: +(b.turn.getAttribute('transform') || '').replace(/[^\d.-]/g, ''), transform: b.g.getAttribute('transform') })); },
    get payoff() { return { blooms: stats.blooms, solves: stats.solves, live: (bloomLayer ? bloomLayer.childElementCount : 0) + (fadeLayer ? fadeLayer.childElementCount : 0), wash: washLayer ? washLayer.querySelectorAll('.wash-cell').length : 0, audio: audio.made, palette: P.NAMES[boards.indexOf(board) % 6], stops: stopsNow().length }; },
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
    // The cells are the outermost lines drawn; add their half-pixel hairline.
    const b = cellLayer.getBoundingClientRect();
    return { x: b.x - .5, y: b.y - .5, width: b.width + 1, height: b.height + 1 };
  } };
  focus = firstCell(); fit(); applyPrefs(); rest(); save();
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
