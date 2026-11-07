/* Glyph. By Luke Steuber. */
(function () {
  'use strict';
  const E = GlyphEngine, boards = GlyphBoards, G = GlyphGaze, T = GlyphTrack, R = GlyphTrace, P = GlyphPayoff;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = 'glyph.v1';
  const boardNode = $('#board'), layer = $('#gaze-layer');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = G.clamp;
  const INPUTS = ['head', 'eyes', 'pointer'], SELECTS = ['dwell', 'tap'], HOLDS = [600, 800, 1000, 1400], REWARDS = ['colour', 'calm'], SOUNDS = ['off', 'on'];
  let board = boards[0], state = E.start(), hits = 0, history = [], miss = null, finished = new Set();
  let prefs = { theme: 'system', motion: 'system', input: 'head', select: 'tap', dwell: 800, rewards: 'colour', sound: 'off' };
  let calibration = { head: null, eyes: null }, lastCamera = 'head', protectSave = false;
  const isPoint = (p, b) => Number.isInteger(p) && p >= 0 && p < b.n * b.n;
  const validState = (s, b) => !!s && typeof s === 'object' && Number.isInteger(s.drawn) && s.drawn >= 0 && (s.drawn & ~E.parse(b).full) === 0 && Number.isInteger(s.last) && (s.last === -1 || isPoint(s.last, b)) && typeof s.pen === 'boolean' && (!s.pen || s.last >= 0);
  const validMiss = (m, b) => m === null || (Array.isArray(m) && m.length === 2 && isPoint(m[0], b) && isPoint(m[1], b) && m[0] !== m[1]);
  const validHits = n => Number.isSafeInteger(n) && n >= 0;
  // Rewards and Sound came later; a save without them takes their defaults.
  const validSettings = s => !!s && ['system', 'light', 'dark'].includes(s.theme) && ['system', 'reduce'].includes(s.motion) && INPUTS.includes(s.input) && SELECTS.includes(s.select) && HOLDS.includes(s.dwell) && (s.rewards === undefined || REWARDS.includes(s.rewards)) && (s.sound === undefined || SOUNDS.includes(s.sound));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(b => b.id === s?.board);
      if (!b || s.campaign !== 1 || !validState(s.state, b) || !validHits(s.hits) || !validMiss(s.miss, b) || !Array.isArray(s.history) || s.history.length > 10000 || !s.history.every(h => h && validState(h.state, b) && validHits(h.hits) && validMiss(h.miss, b)) || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id)) || !validSettings(s.settings) || !['head', 'eyes'].includes(s.lastCamera)) throw Error('Invalid save');
      // A calibration that does not read is dropped on its own (it is asked for
      // again); it used to discard the whole save, boards and all.
      if (!s.calibration || typeof s.calibration !== 'object') s.calibration = { head: null, eyes: null };
      for (const k of ['head', 'eyes']) if (!(s.calibration[k] === null || (G.validCalibration(s.calibration[k]) && s.calibration[k].kind === k))) s.calibration[k] = null;
      board = b; state = E.copy(s.state); hits = s.hits; history = s.history; miss = s.miss; finished = new Set(s.finished); prefs = { rewards: 'colour', sound: 'off', ...s.settings }; calibration = { head: s.calibration.head, eyes: s.calibration.eyes }; lastCamera = s.lastCamera;
    }
  } catch (_) { protectSave = true; }
  // Every board is open from the start; a new player begins on board 1.
  const pars = new Map(), parOf = b => { if (!pars.has(b.id)) pars.set(b.id, E.par(b)); return pars.get(b.id); };
  let hint = null, focus = 0, keyboard = false, hover = null, penBy = 'other';
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const isSolved = () => E.solved(board, state);
  const lineCount = () => E.parse(board).E, inked = () => { let n = 0; for (let m = state.drawn; m; m &= m - 1) n++; return n; };
  const NAMES = { 2: ['top left', 'top right', 'bottom left', 'bottom right'], 3: ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'] };
  const nameOf = p => NAMES[board.n][p];
  function announce(text) { $('#announcement').textContent = text; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ board: board.id, state, hits, history, miss, finished: [...finished], settings: prefs, campaign: 1, calibration, lastCamera })); } catch (_) {}
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

  // ---- Layout, as in Glance. The square is as large as fits between the
  // header and the toolbar, by height as well as width, keeping only a thin
  // clear gap round it and a narrow band at the page's sides, where trackers
  // are weakest; each point's ring, where a look or finger finds it, is at
  // least a sixth of a phone's short side across. While choosing is by look
  // and hold the toolbar's own Undo and Hint grow to at least that size and
  // become look targets themselves.
  const GAP = 12, geo = { s: 100, ox: 0, oy: 0, r: 30, ru: .3, m: .4, band: 16, dead: 10, points: [], rect: null, area: null };
  const unitR = () => board.n === 2 ? .26 : .3, unitM = () => unitR() + .1;
  const railMode = () => matchMedia('(max-height:520px) and (min-width:560px)').matches;
  const toolSize = () => clamp(Math.round(Math.min(innerWidth, innerHeight) / 6), 64, 160);
  const visibleTools = () => [...document.querySelectorAll('.toolbar button')].filter(n => n.offsetParent !== null);
  function fit() {
    const n = board.n, span = n - 1, ru = unitR(), m = unitM(), total = span + 2 * m, short = Math.min(innerWidth, innerHeight), band = Math.max(10, Math.round(short * .03));
    document.body.dataset.look = dwellOn() ? 'dwell' : 'plain'; document.body.style.setProperty('--tool', toolSize() + 'px');
    const tools = visibleTools().map(n => n.getBoundingClientRect()), rail = railMode() && tools.length > 0;
    let right = innerWidth - band, bottom = innerHeight - band;
    if (rail) right = Math.min(right, Math.min(...tools.map(r => r.left)) - GAP);
    else if (tools.length) {
      // The frame sets Next on the toolbar row, rising above a short row to
      // stay on the page, unless the row has no room between its two groups
      // for it; then it goes in a gap below the square, which is kept.
      const barTop = Math.min(...tools.map(r => r.top)), rowMid = (barTop + Math.max(...tools.map(r => r.bottom))) / 2;
      const lefts = tools.filter(r => r.left + r.width / 2 < innerWidth / 2), rights = tools.filter(r => r.left + r.width / 2 >= innerWidth / 2);
      const slot = (rights.length ? Math.min(...rights.map(r => r.left)) : innerWidth) - (lefts.length ? Math.max(...lefts.map(r => r.right)) : 0);
      bottom = Math.min(bottom, barTop, Math.min(rowMid - 32, innerHeight - 70)) - GAP;
      if (slot < 64 + 2 * 16) bottom = Math.min(bottom, barTop - GAP - 80);
    }
    // Either below the restart button across the page's width, or higher,
    // just below the readout, kept in from the restart button on both sides.
    const restart = $('#restart-btn').getBoundingClientRect(), readout = $('#readout').getBoundingClientRect();
    const inset = Math.max(band, restart.right + 6), size = (l, r, t) => Math.min((r - l) / total, (bottom - t) / total);
    const wide = { left: band, right, top: Math.max(band, restart.bottom + GAP) }, high = { left: inset, right: Math.min(right, innerWidth - inset), top: Math.max(band, readout.bottom + 6) };
    const pick = size(high.left, high.right, high.top) > size(wide.left, wide.right, wide.top) ? high : wide, { left, top } = pick;
    right = pick.right;
    const s = Math.max(24, Math.floor(size(left, right, top) * 2) / 2);
    geo.area = { x: left, y: top, w: right - left, h: bottom - top };
    Object.assign($('#board-shell').style, { top: top + 'px', left: left + 'px', right: innerWidth - right + 'px', bottom: innerHeight - bottom + 'px' });
    boardNode.setAttribute('viewBox', `${-m} ${-m} ${total} ${total}`);
    boardNode.style.width = total * s + 'px'; boardNode.style.height = total * s + 'px';
    const b = boardNode.getBoundingClientRect();
    Object.assign(geo, { s, ru, m, band, ox: b.left + m * s, oy: b.top + m * s, r: ru * s, dead: Math.max(10, s * .08), rect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } });
    geo.points = [];
    for (let p = 0; p < n * n; p++) { const [r, c] = E.rc(n, p); geo.points.push({ id: p, x: geo.ox + c * s, y: geo.oy + r * s, r: geo.r }); }
    tracer.dead = geo.dead; rester.radius = Math.max(20, geo.s * .15);
    placeGlyph();
  }
  // Page units to pixels: -1 to 1 across the reach inside the outer band.
  function toScreen(u, v) {
    const x0 = geo.band, x1 = innerWidth - geo.band, y0 = geo.band, y1 = innerHeight - geo.band;
    return { x: (x0 + x1) / 2 + u * (x1 - x0) / 2, y: (y0 + y1) / 2 + v * (y1 - y0) / 2 };
  }

  // ---- The square.
  let frameNode = null, built = null, zoneNodes = [], dotNodes = [], pencilNodes = [], inkNodes = [], colourNodes = [], gradNodes = [], petalNodes = [], petalLayer, ringNode, missNode, penNode, hintNode, focusNode, hoverNode, figureLayer, pointLayer;
  function build() {
    boardNode.replaceChildren();
    const n = board.n, m = geo.m, span = n - 1, B = E.parse(board), at = p => E.rc(n, p);
    frameNode = svg('rect', { class: 'frame', x: -m + .02, y: -m + .02, width: span + 2 * m - .04, height: span + 2 * m - .04 }, boardNode);
    pointLayer = svg('g', { id: 'points', 'aria-hidden': 'true' }, boardNode);
    zoneNodes = []; for (let p = 0; p < n * n; p++) { const [r, c] = at(p); zoneNodes.push(svg('circle', { class: 'zone', cx: c, cy: r, r: geo.ru }, pointLayer)); }
    figureLayer = svg('g', { id: 'figure', 'aria-hidden': 'true' }, boardNode);
    pencilNodes = B.lines.map(([a, b]) => { const [ra, ca] = at(a), [rb, cb] = at(b); return svg('line', { class: 'pencil', x1: ca, y1: ra, x2: cb, y2: rb }, figureLayer); });
    inkNodes = B.lines.map(() => svg('line', { class: 'ink' }, figureLayer));
    colourNodes = B.lines.map(([a, b]) => { const [ra, ca] = at(a), [rb, cb] = at(b); return svg('line', { class: 'colour', x1: ca, y1: ra, x2: cb, y2: rb, opacity: 0 }, figureLayer); });
    missNode = svg('line', { class: 'miss' }, boardNode);
    const dots = svg('g', { id: 'dots', 'aria-hidden': 'true' }, boardNode);
    dotNodes = []; for (let p = 0; p < n * n; p++) { const [r, c] = at(p); dotNodes.push(svg('circle', { class: 'dot', cx: c, cy: r, r: n === 2 ? .028 : .04 }, dots)); }
    const marks = svg('g', { id: 'marks', 'aria-hidden': 'true' }, boardNode);
    hoverNode = svg('circle', { class: 'hover-ring', r: geo.ru * .86 }, marks); hintNode = svg('circle', { class: 'hint-ring', r: geo.ru * .74 }, marks); focusNode = svg('circle', { class: 'focus-ring', r: geo.ru * .94 }, marks);
    penNode = svg('circle', { class: 'pen', r: n === 2 ? .055 : .075 }, marks);
    // Colour stays inside the square's frame, clear of Next and the toolbar.
    // Each line's colour runs along it, from its end nearer the last point.
    const defs = svg('defs', {}, boardNode), clip = svg('clipPath', { id: 'payoff-clip' }, defs);
    gradNodes = B.lines.map((_, i) => { const g = svg('linearGradient', { id: 'glyph-colour-' + i, gradientUnits: 'userSpaceOnUse' }, defs); return { g, stops: [0, .5, 1].map(o => svg('stop', { offset: o }, g)) }; });
    svg('rect', { x: -m, y: -m, width: span + 2 * m, height: span + 2 * m }, clip);
    const pay = svg('g', { id: 'payoff', 'aria-hidden': 'true', 'clip-path': 'url(#payoff-clip)' }, boardNode);
    ringNode = svg('circle', { class: 'payoff-ring', r: 1, display: 'none' }, pay);
    petalLayer = svg('g', { class: 'petals' }, pay); petalNodes = [];
    built = board;
  }
  // Ink grows along each new line from the pen; the finished glyph settles:
  // the rings and dots fade and the lines thicken a little.
  let anims = [], settle = { value: 0, from: 0, start: 0, run: false }, animId = 0, busy = false;
  function draw() {
    if (built !== board) build();
    const n = board.n, B = E.parse(board), at = p => E.rc(n, p), now = performance.now(), sv = settle.value, w = (n === 2 ? .07 : .09) * (1 + .3 * sv);
    B.lines.forEach(([a, b], i) => {
      const on = !!(state.drawn >> i & 1), anim = anims.find(x => x.line === i);
      set(pencilNodes[i], { 'stroke-width': (n === 2 ? .07 : .09).toFixed(3) });
      if (!on) { set(inkNodes[i], { display: 'none' }); return; }
      let [r1, c1] = at(anim ? anim.from : a), [r2, c2] = at(anim ? anim.to : b);
      if (anim) { const p = clamp((now - anim.start) / 170, 0, 1), e = 1 - (1 - p) ** 2; r2 = r1 + (r2 - r1) * e; c2 = c1 + (c2 - c1) * e; }
      set(inkNodes[i], { display: null, x1: c1.toFixed(4), y1: r1.toFixed(4), x2: c2.toFixed(4), y2: r2.toFixed(4), 'stroke-width': w.toFixed(4) });
    });
    drawPayoff(now, w);
    set(pointLayer, { opacity: sv ? (1 - sv).toFixed(3) : null });
    for (const d of dotNodes) set(d, { opacity: sv ? (1 - sv).toFixed(3) : null });
    if (miss) { const [r1, c1] = at(miss[0]), [r2, c2] = at(miss[1]); set(missNode, { display: null, x1: c1, y1: r1, x2: c2, y2: r2 }); } else set(missNode, { display: 'none' });
    const place = (node, p) => { if (p === null || p === undefined || p < 0) { set(node, { display: 'none' }); return; } const [r, c] = at(p); set(node, { display: null, cx: c, cy: r }); };
    place(penNode, isSolved() ? null : state.last); set(penNode, { 'data-pen': state.pen ? 'down' : 'up' });
    place(hintNode, hint ? hint.point : null); place(focusNode, keyboard ? focus : null); place(hoverNode, hover);
    boardNode.dataset.busy = String(busy); boardNode.dataset.solved = String(isSolved()); boardNode.dataset.settle = String(+sv.toFixed(3)); boardNode.dataset.pen = state.pen ? 'down' : 'up';
  }
  // ---- Colour for a job done (payoff.js). An inked line blooms along its
  // length: soft dots in the board's palette drift out from it and fade in
  // about half a second. A finished figure takes colour in a wave from its
  // last point, nearest lines first, with one ring opening from there, and
  // holds its colour until Next. Only transform and opacity move. With
  // reduced motion a bloom is a 0.2 s colour fade on the line and the finish
  // a fade of the colour. Calm keeps paper and ink.
  const BLOOM = 500, FADE = 200, WAVE = 700, RISE = 300, RING = 900, WAVE_FADE = 400, PETALS = 8;
  let blooms = [], wave = null, audio = null;
  const payoff = { blooms: 0, solves: 0 };
  const colourOn = () => prefs.rewards === 'colour';
  const stops = () => P.paletteFor(boards.indexOf(board), dark());
  const ease = p => 1 - (1 - p) ** 3;
  const sound = () => { if (prefs.sound !== 'on') return null; if (!audio) audio = P.sound(); return audio; };
  function bloom(line, from, to) {
    payoff.blooms++;
    const s = sound(); if (s) try { s.tick(inked() - 1); } catch (_) {}
    if (!colourOn() || document.hidden) return;
    blooms.push({ line, from, to, start: performance.now(), fade: reduced(), seed: payoff.blooms, petals: P.petals(PETALS, payoff.blooms * 7 + line) });
  }
  function finishPayoff(origin) {
    payoff.solves++;
    const s = sound(); if (s) try { s.chord(); } catch (_) {}
    if (!colourOn()) return;
    const B = E.parse(board), mids = B.lines.map(([a, b]) => { const [ra, ca] = E.rc(board.n, a), [rb, cb] = E.rc(board.n, b); return [(ca + cb) / 2, (ra + rb) / 2]; });
    const [r0, c0] = E.rc(board.n, origin);
    wave = { point: origin, origin: [c0, r0], start: performance.now(), fade: reduced() || document.hidden, delays: P.wave(mids, [c0, r0]), far: Math.max(...mids.map(([x, y]) => Math.hypot(x - c0, y - r0))) };
  }
  const payoffActive = now => blooms.some(b => now - b.start < (b.fade ? FADE : BLOOM)) || (wave && now - wave.start < (wave.fade ? WAVE_FADE : Math.max(WAVE + RISE, RING)));
  // The finished figure's colours run along the palette outward from its
  // last point: each line takes the stretch of palette between how far its
  // two ends lie from that point, nearest at the palette's start, so even a
  // single line shows the whole palette.
  function paint(st) {
    const B = E.parse(board), origin = wave ? wave.point : state.last >= 0 ? state.last : 0, at = p => { const [r, c] = E.rc(board.n, p); return [c, r]; }, o = at(origin);
    const far = Math.max(1e-6, ...B.lines.flat().map(p => { const [x, y] = at(p); return Math.hypot(x - o[0], y - o[1]); }));
    B.lines.forEach(([a, b], i) => {
      let [pa, pb] = [at(a), at(b)], [da, db] = [pa, pb].map(([x, y]) => Math.hypot(x - o[0], y - o[1]) / far);
      if (db < da) { [pa, pb] = [pb, pa]; [da, db] = [db, da]; }
      const n = gradNodes[i]; set(n.g, { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] });
      n.stops.forEach((stop, k) => set(stop, { 'stop-color': P.along(st, da + (db - da) * k / 2) }));
    });
  }
  function drawPayoff(now, w) {
    const B = E.parse(board), st = colourOn() ? stops() : null, solved = isSolved();
    if (st && solved) paint(st);
    blooms = blooms.filter(b => now - b.start < (b.fade ? FADE : BLOOM));
    if (wave && now - wave.start >= (wave.fade ? WAVE_FADE : Math.max(WAVE + RISE, RING))) wave = { ...wave, done: true };
    B.lines.forEach((_, i) => {
      let o = 0, colour = null;
      if (st && solved) { colour = `url(#glyph-colour-${i})`; o = !wave || wave.done ? 1 : wave.fade ? clamp((now - wave.start) / WAVE_FADE, 0, 1) : clamp((now - wave.start - wave.delays[i] * WAVE) / RISE, 0, 1); }
      else if (st) { const b = blooms.find(b => b.fade && b.line === i); if (b) { colour = P.along(st, (b.seed % 5) / 4); o = 1 - clamp((now - b.start) / FADE, 0, 1); } }
      set(colourNodes[i], { opacity: o ? o.toFixed(3) : '0', stroke: colour, 'stroke-width': w.toFixed(4) });
    });
    // Petals along each blooming line.
    const live = st ? blooms.filter(b => !b.fade) : [];
    const need = live.length * PETALS, size = board.n === 2 ? .034 : .048, spread = board.n === 2 ? .24 : .36;
    while (petalNodes.length < need) petalNodes.push(svg('circle', { class: 'petal', r: size, cx: 0, cy: 0 }, petalLayer));
    let k = 0;
    for (const b of live) {
      const p = clamp((now - b.start) / BLOOM, 0, 1), e = ease(p), [r1, c1] = E.rc(board.n, b.from), [r2, c2] = E.rc(board.n, b.to), dx = c2 - c1, dy = r2 - r1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      for (const q of b.petals) {
        const t = clamp(q.at + q.along * .2, 0, 1), out = q.side * q.out * spread * e, x = c1 + dx * t + nx * out, y = r1 + dy * t + ny * out, sc = q.size * (.5 + .9 * e);
        set(petalNodes[k++], { display: null, fill: P.along(st, ((q.colour + b.seed) % st.length) / Math.max(1, st.length - 1)), transform: `translate(${x.toFixed(4)} ${y.toFixed(4)}) scale(${sc.toFixed(3)})`, opacity: (p < .3 ? .95 : .95 * (1 - (p - .3) / .7) ** 1.3).toFixed(3) });
      }
    }
    for (; k < petalNodes.length; k++) set(petalNodes[k], { display: 'none' });
    // The ring opening from the last point.
    if (st && wave && !wave.fade && !wave.done && solved) {
      const p = clamp((now - wave.start) / RING, 0, 1);
      set(ringNode, { display: null, stroke: P.along(st, .5), transform: `translate(${wave.origin[0]} ${wave.origin[1]}) scale(${Math.max(.02, (wave.far + .6) * ease(p)).toFixed(4)})`, opacity: (.9 * (1 - p)).toFixed(3) });
    } else set(ringNode, { display: 'none' });
    boardNode.dataset.payoff = st && solved ? (wave && !wave.done ? 'filling' : 'colour') : blooms.length ? 'bloom' : 'none';
  }
  function chrome() {
    const solved = isSolved(), i = boards.indexOf(board);
    boardNode.setAttribute('aria-label', `Board ${i + 1} of ${boards.length}, ${board.n} by ${board.n} points. ${solved ? 'Every line inked.' : `${inked()} of ${lineCount()} lines inked.`} ${state.last < 0 ? 'Pen not set down.' : `Pen ${state.pen ? 'down' : 'lifted'} at ${nameOf(state.last)}.`} ${hits} visits, par ${parOf(board)}. Focus ${nameOf(focus)}.`);
    $('#readout').textContent = `${i + 1} / ${boards.length} · ${hits} / ${parOf(board)}`;
    $('#readout').setAttribute('aria-label', `Board ${i + 1} of ${boards.length}; ${hits} visits; par ${parOf(board)}`);
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = solved;
    // Next appears at once on a finished figure; the colour plays on beside it.
    $('#next-btn').hidden = !solved || i === boards.length - 1;
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
  // Motion runs on its own clock; the state is always already where it ends.
  // A hidden page or reduced motion shows every result at once.
  function animate() {
    const now = performance.now();
    if (reduced() || document.hidden) { anims = []; if (settle.run) { settle.value = 1; settle.run = false; } }
    anims = anims.filter(a => now - a.start < 170);
    if (settle.run) { const p = clamp((now - settle.start) / 520, 0, 1); settle.value = 1 - (1 - p) ** 3; if (p >= 1) settle.run = false; }
    const was = busy; busy = anims.length > 0 || settle.run;
    draw();
    // Colour plays on its own frames and never holds up the next choice.
    if (busy || payoffActive(now)) { if (!animId) animId = requestAnimationFrame(() => { animId = 0; animate(); }); }
    if (was !== busy) { chrome(); if (!busy) placeGlyph(); }
  }
  function finishMotion() { anims = []; blooms = []; if (wave) wave = { ...wave, done: true }; if (settle.run) { settle.value = 1; settle.run = false; } if (animId) { cancelAnimationFrame(animId); animId = 0; } busy = false; draw(); chrome(); }
  // Registering a point: with the pen down, the straight line from the pen
  // passes any point between, which is visited first.
  function register(q, how = 'tap') {
    if (isSolved() || !isPoint(q, board)) return;
    for (const p of E.path(board, state, q)) visit(p, how);
  }
  function visit(p, how) {
    if (isSolved()) return;
    const r = E.step(board, state, p);
    if (!r || r.kind === 'same') return;
    const from = state.last;
    // Only a pen moved by looking is lifted by a look that rests or leaves the square.
    penBy = how === 'look' ? 'look' : 'other';
    if (r.visit) history.push({ state: E.copy(state), hits, miss });
    state = r.state; hits += r.visit; hint = null;
    miss = r.kind === 'miss' ? [from, p] : null;
    if (r.kind === 'draw' && !reduced() && !document.hidden) anims.push({ line: r.line, from, to: p, start: performance.now() });
    if (r.kind === 'draw') bloom(r.line, from, p);
    // The visit is saved before any motion, so leaving the page cannot lose it.
    if (isSolved()) { finished.add(board.id); settle = { value: 0, run: !reduced() && !document.hidden, start: performance.now() }; if (!settle.run) settle.value = 1; finishPayoff(p); }
    save(); animate(); chrome();
    const left = lineCount() - inked();
    if (isSolved()) announce(`Figure finished in ${hits} visits. Par ${parOf(board)}. ${boards.indexOf(board) === boards.length - 1 ? 'Every board is finished.' : 'Next board is open.'}`);
    else if (r.kind === 'draw') announce(`${nameOf(from)} to ${nameOf(p)} inked. ${left} ${left === 1 ? 'line' : 'lines'} left. ${hits} visits.`);
    else if (r.kind === 'miss') announce(`${nameOf(from)} to ${nameOf(p)}: ${r.reason === 'inked' ? 'already inked' : 'not in the figure'}. ${hits} visits.`);
    else if (r.kind === 'start') announce(`Pen down at ${nameOf(p)}. ${hits} visits.`);
    else announce(`Pen down at ${nameOf(p)}.`);
    if (how !== 'look') wake();
  }
  function lift(say = true) {
    if (!state.pen) return;
    state = E.lift(state); hint = hint && hint.lift ? { ...hint, lift: false } : hint; save(); draw(); chrome();
    if (say) announce('Pen lifted.');
  }
  // Looking cannot carry a lifted pen back to where it was, so after an undo
  // the pen is lifted for the camera and look and hold; set down again where
  // it rests, it carries on for free.
  function undo() {
    const prev = history.pop();
    if (!prev) { announce('No visit to undo.'); return; }
    state = E.copy(prev.state); hits = prev.hits; miss = prev.miss; hint = null;
    if (lookDraws() && state.pen) state = E.lift(state);
    anims = []; blooms = []; wave = null; settle = { value: 0, run: false, start: 0 };
    save(); animate(); chrome(); settleLook();
    announce(`Visit undone. ${hits} visits.`);
  }
  function fresh() { state = E.start(); hits = 0; history = []; miss = null; hint = null; hover = null; focus = 0; anims = []; blooms = []; wave = null; settle = { value: 0, run: false, start: 0 }; }
  function restart() { fresh(); save(); animate(); chrome(); settleLook(); announce('Board restarted.'); }
  // Any board can be opened, from Settings or from the test hook; an unknown id is refused.
  function go(id) {
    const next = boards.find(b => b.id === id);
    if (!next) return false;
    board = next; fresh(); fit(); build(); save(); animate(); chrome(); settleLook(); wake();
    announce(`Board ${boards.indexOf(board) + 1}.`);
    return true;
  }
  function next() { const b = boards[boards.indexOf(board) + 1]; return b && isSolved() ? go(b.id) : false; }
  // A hint marks the next point of a fewest-visits finish from here, with a
  // dashed ring; asked again, it makes that move (lifting first if the move
  // begins a new stroke).
  function doHint(how = 'hint') {
    if (isSolved()) return;
    if (hint) { const h = hint; hint = null; if (h.lift) lift(false); register(h.point, how); return; }
    hint = E.hint(board, state);
    if (hint) { focus = hint.point; draw(); announce(`Hint: ${nameOf(hint.point)}${hint.kind === 'start' ? ', a new stroke' : ''}. Hint again makes the move.`); }
  }

  // ---- Input. `phase` is where the player is: the camera's first screen
  // (prompt), the camera starting, calibrating, playing by camera, or by pointer.
  let phase = 'pointer', calib = null, face = false, gaze = null, freshHold = false, resumeOnShow = false, virtual = false;
  const pointer = { x: 0, y: 0, present: false };
  const filters = () => prefs.input === 'eyes' ? [G.oneEuro({ minCutoff: .45, beta: .35 }), G.oneEuro({ minCutoff: .45, beta: .35 })] : [G.oneEuro({ minCutoff: .8, beta: .6 }), G.oneEuro({ minCutoff: .8, beta: .6 })];
  let [fu, fv] = filters();
  // Drawing by looking: the camera, or a pointer with look and hold.
  const lookDraws = () => phase === 'camera' || (phase === 'pointer' && prefs.select === 'dwell');
  const dwellOn = lookDraws;
  const pointerDwell = () => (phase === 'pointer' && prefs.select === 'dwell') || phase === 'prompt';
  // While the camera draws, the pen follows the look alone and touches on the
  // square are ignored; the toolbar, keys and Settings still work.
  const tapsDraw = () => phase === 'prompt' || (phase === 'pointer' && prefs.select === 'tap');
  const inSafe = (x, y) => x >= geo.band && y >= geo.band && x <= innerWidth - geo.band && y <= innerHeight - geo.band;
  const within = (t, x, y, grow) => Math.hypot(x - t.cx, y - t.cy) <= t.r + grow;
  const zoneAt = (x, y, grow = 0) => { for (const z of geo.points) if (Math.hypot(x - z.x, y - z.y) <= z.r + grow) return z.id; return null; };
  const tracer = R.tracer({ dead: geo.dead }), rester = R.rest({ time: prefs.dwell, radius: 18 });
  // The camera glyph stands in the rest area below the square, centred
  // between the square and the toolbar where the Next disc would sit; where
  // the square fills the height, beside it instead (between square and rail
  // on a phone turned sideways). Never over the square or a control, sized to
  // the room; if Next is waiting where the glyph would be, it stands clear.
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
  // The frame places Next a frame later; the glyph then steps clear of it.
  function placeGlyphSoon() { requestAnimationFrame(() => requestAnimationFrame(placeGlyph)); }
  function glyphTarget() { const n = $('#camera-start'); if (n.hidden) return null; const b = n.getBoundingClientRect(); return { id: 'camera', kind: 'camera', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 }; }
  function nextTarget() { const n = $('#next-btn'); if (n.hidden || !n.isConnected) return null; const b = n.getBoundingClientRect(); return b.width ? { id: 'next', kind: 'next', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 } : null; }
  // The toolbar's own Undo and Hint, as look targets while choosing is by
  // look and hold (and only while they would do something).
  function toolTargets() {
    if (!dwellOn()) return [];
    return [['undo-btn', 'tool:undo'], ['hint-btn', 'tool:hint']].map(([el, id]) => { const n = $('#' + el); if (!n || n.disabled || n.offsetParent === null) return null; const b = n.getBoundingClientRect(); return { id, kind: 'tool', x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 }; }).filter(Boolean);
  }
  const inRect = (t, x, y, grow) => x >= t.x - grow && x <= t.x + t.w + grow && y >= t.y - grow && y <= t.y + t.h + grow;
  // What a held look at (x, y) would choose: the toolbar's Undo and Hint and
  // the Next disc wherever they stand; with the pen lifted, a point (to set
  // it down there), and the camera glyph, only inside the outer band; nothing
  // in the gap round the square or behind a sheet.
  function targetAt(x, y) {
    if ($('dialog[open]')) return null;
    if (phase === 'prompt') { const g = glyphTarget(); return g && inSafe(x, y) && within(g, x, y, 0) ? g : null; }
    if (!dwellOn()) return null;
    for (const t of toolTargets()) if (inRect(t, x, y, 0)) return t;
    const n = nextTarget(); if (n && within(n, x, y, 0)) return n;
    if (!inSafe(x, y)) return null;
    if (!state.pen && !isSolved()) { const z = zoneAt(x, y); if (z !== null) { const q = geo.points[z]; return { id: 'point:' + z, kind: 'point', p: z, cx: q.x, cy: q.y, r: q.r }; } }
    return null;
  }
  function holds(t, x, y) {
    if ($('dialog[open]')) return false;
    if (t.kind === 'tool') { const live = toolTargets().find(z => z.id === t.id); return !!live && inRect(live, x, y, geo.dead); }
    if (t.kind === 'next') { const live = dwellOn() ? nextTarget() : null; return !!live && within(live, x, y, geo.dead); }
    if (!inSafe(x, y)) return false;
    let live = null;
    if (t.kind === 'camera') live = glyphTarget();
    else if (t.kind === 'point') { const q = geo.points[t.p]; live = dwellOn() && !state.pen && !isSolved() && q ? { cx: q.x, cy: q.y, r: q.r } : null; }
    return !!live && within(live, x, y, geo.dead);
  }
  // Open ground: inside the page's reach, off every point's ring, the
  // toolbar's look targets and Next.
  function open(x, y) {
    if (!inSafe(x, y) || $('dialog[open]') || zoneAt(x, y, geo.dead) !== null) return false;
    if (toolTargets().some(t => inRect(t, x, y, geo.dead))) return false;
    const n = nextTarget(); return !(n && within(n, x, y, geo.dead));
  }
  const dwell = G.dwell({ time: prefs.dwell, targets: targetAt, holds });
  // Off the square: further than the dead zone beyond its frame.
  const offSquare = (x, y) => { const b = geo.rect, d = geo.dead; return x < b.left - d || x > b.right + d || y < b.top - d || y > b.bottom + d; };
  // Each look: points entered draw while the pen is down; a held look sets
  // the pen down or works Undo, Hint or Next; a rest off the points, or a look off the
  // square, lifts the pen.
  function feed(t, x, y) {
    if (freshHold && x !== null) { dwell.hold(targetAt(x, y)); tracer.place(x, y, geo.points); rester.reset(); freshHold = false; }
    gaze = x === null ? null : { x, y };
    const entered = tracer.sample(t, x, y, geo.points);
    if (lookDraws()) for (const id of entered) if (state.pen && !isSolved()) register(id, 'look');
    if (lookDraws() && state.pen && penBy === 'look' && x !== null && offSquare(x, y)) lift();
    for (const target of dwell.sample(t, x, y)) choose(target);
    if (lookDraws() && state.pen && penBy === 'look' && !isSolved()) { if (rester.sample(t, x, y, x !== null && open(x, y))) lift(); }
    else rester.reset();
    wake();
  }
  function choose(t) {
    if (t.kind === 'point') register(t.p, 'look');
    else if (t.id === 'tool:undo') undo();
    else if (t.id === 'tool:hint') doHint('look');
    else if (t.id === 'next') next();
    else if (t.id === 'camera') startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  }
  // A new board, or a new way of looking, starts with whatever lies under the
  // point already counted as chosen and entered, so a resting look cannot
  // pick it. The camera's next reading is that resting look; a pointer's is
  // where it is now.
  function settleLook() {
    dwell.reset(); rester.reset();
    if (phase === 'camera' || phase === 'calibrating') { freshHold = true; tracer.reset(); }
    else { freshHold = false; tracer.reset(); if (pointerDwell() && pointer.present) { dwell.hold(targetAt(pointer.x, pointer.y)); tracer.place(pointer.x, pointer.y, geo.points); } }
  }
  function setPhase(next) {
    phase = next; document.body.dataset.phase = next;
    $('#camera-start').hidden = !(next === 'prompt' || next === 'starting');
    gaze = null; relayout(); settleLook();
    if (next !== 'camera' && next !== 'calibrating') setFace(false);
    chrome(); wake();
  }
  // A change between plain and look-and-hold choosing resizes the toolbar's
  // Undo and Hint, so the square is fitted again.
  function relayout() { if (built) { fit(); build(); draw(); } else placeGlyph(); }
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
    announce('Camera ready. Hold your look on a point to set the pen down.');
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

  // ---- The look layer: gaze dot, the pen's line, rings and the calibration dot.
  let rafId = 0;
  const stringNode = svg('line', { class: 'string', display: 'none' }, layer);
  const dot = svg('g', { class: 'gaze-dot' }, layer); svg('circle', { class: 'gaze-halo', r: 18 }, dot); svg('circle', { class: 'gaze-core', r: 7 }, dot);
  const ringsLayer = svg('g', { class: 'dwell-rings' }, layer), spotLayer = svg('g', { class: 'spot-layer' }, layer);
  svg('circle', { class: 'spot-halo', r: 15 }, spotLayer); svg('circle', { class: 'spot', r: 9 }, spotLayer);
  svg('circle', { class: 'dwell-track', r: 26 }, spotLayer); const spotArc = svg('circle', { class: 'dwell-arc', r: 26 }, spotLayer);
  const restRing = { track: svg('circle', { class: 'dwell-track rest-track', display: 'none' }, layer), arc: svg('circle', { class: 'dwell-arc rest-arc', display: 'none' }, layer) };
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
  function placeRing(n, cx, cy, r, p, tone = 'on-page') {
    const C = 2 * Math.PI * r;
    set(n.track, { display: null, class: 'dwell-track ' + tone, cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1) });
    set(n.arc, { display: null, class: 'dwell-arc ' + tone, cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), 'stroke-dasharray': `${(p * C).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})` });
  }
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', camera: 'M3 8h4l2-3h6l2 3h4v11H3ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' };
  let drag = null;
  function drawLayer() {
    // The gaze dot shows only for the camera; a pointer shows itself.
    const showDot = phase === 'camera' && gaze;
    set(dot, { transform: showDot ? `translate(${gaze.x.toFixed(1)} ${gaze.y.toFixed(1)})` : null, display: showDot ? null : 'none' });
    // With the pen down, a fine line runs from the pen to the look or the finger.
    const end = drag && drag.at ? drag.at : lookDraws() && gaze ? gaze : null, from = state.pen && !isSolved() && state.last >= 0 ? geo.points[state.last] : null;
    if (end && from) set(stringNode, { display: null, x1: from.x.toFixed(1), y1: from.y.toFixed(1), x2: end.x.toFixed(1), y2: end.y.toFixed(1) });
    else set(stringNode, { display: 'none' });
    const live = new Set();
    for (const [id, p] of dwell.rings()) {
      let cx, cy, r, tone = 'on-page';
      if (id.startsWith('point:')) { const q = geo.points[+id.slice(6)]; if (!q) continue; cx = q.x; cy = q.y; r = q.r + 5; }
      // On the toolbar's buttons and the Next disc the ring fills inside them.
      else if (id.startsWith('tool:')) { const t = toolTargets().find(x => x.id === id); if (!t) continue; cx = t.cx; cy = t.cy; r = t.r - 4; }
      else if (id === 'next') { const t = nextTarget(); if (!t) continue; cx = t.cx; cy = t.cy; r = t.r - 6; tone = 'on-ink'; }
      else { const t = glyphTarget(); if (!t) continue; cx = t.cx; cy = t.cy; r = t.r + 10; }
      placeRing(ringFor(id), cx, cy, r, p, tone); live.add(id);
    }
    for (const [id, n] of rings) if (!live.has(id)) { n.track.remove(); n.arc.remove(); rings.delete(id); }
    // Resting off the points fills a small ring where the look rests: the pen lifts when it closes.
    const a = rester.anchor;
    if (a && rester.progress > 0) placeRing(restRing, a.x, a.y, 22, rester.progress, 'on-page rest');
    else { set(restRing.track, { display: 'none' }); set(restRing.arc, { display: 'none' }); }
    if (phase === 'calibrating' && calib) {
      const at = toScreen(G.SPOTS[calib.spots[calib.step]].u, G.SPOTS[calib.spots[calib.step]].v), C = 2 * Math.PI * 26;
      set(spotLayer, { display: null, transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`, 'data-step': String(calib.step) });
      set(spotArc, { 'stroke-dasharray': `${(calib.progress * C).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90)' });
    } else set(spotLayer, { display: 'none' });
  }

  // ---- Pointer, touch and keys. A press on a point registers it at once;
  // dragging on enters every point the finger passes; a tap between the
  // points lifts the pen.
  const gestures = new Map();
  boardNode.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.pointerType === 'mouse' && !e.isPrimary) || $('dialog[open]') || !tapsDraw()) return;
    keyboard = false; hover = null;
    const g = { x: e.clientX, y: e.clientY, last: { clientX: e.clientX, clientY: e.clientY }, travel: 0, registered: false, trace: R.tracer({ dead: geo.dead }) };
    gestures.set(e.pointerId, g);
    boardNode.focus({ preventScroll: true }); try { boardNode.setPointerCapture(e.pointerId); } catch (_) {}
    const z = zoneAt(e.clientX, e.clientY);
    g.trace.place(e.clientX, e.clientY, geo.points);
    if (z !== null) {
      // A tap on the dimmed first board means play by touch.
      if (phase === 'prompt') toPointer();
      focus = z; register(z, 'tap'); g.registered = true;
    }
    drag = { at: { x: e.clientX, y: e.clientY } }; draw(); wake();
  });
  function release(e) {
    const g = gestures.get(e.pointerId); if (!g) return;
    const at = e.type === 'lostpointercapture' ? g.last : e;
    gestures.delete(e.pointerId); try { boardNode.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!gestures.size) drag = null;
    const travel = Math.max(g.travel, Math.hypot(at.clientX - g.x, at.clientY - g.y));
    if (!g.registered && travel <= 12 && tapsDraw() && phase !== 'prompt') lift();
    wake();
  }
  const same = (a, b) => a === b;
  window.addEventListener('pointermove', e => {
    const g = gestures.get(e.pointerId);
    if (g) {
      g.last = { clientX: e.clientX, clientY: e.clientY };
      g.travel = Math.max(g.travel, Math.hypot(e.clientX - g.x, e.clientY - g.y));
      if (e.pointerType === 'mouse' && e.buttons === 0) release(e);
      else if (tapsDraw()) {
        for (const id of g.trace.sample(performance.now(), e.clientX, e.clientY, geo.points)) { if (phase === 'prompt') toPointer(); focus = id; register(id, 'drag'); g.registered = true; }
        drag = { at: { x: e.clientX, y: e.clientY } }; wake();
      }
    }
    if (e.pointerType !== 'touch' || e.buttons) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); }
    if (e.pointerType === 'mouse' && !g && !$('dialog[open]') && phase === 'pointer' && prefs.select === 'tap') { const p = zoneAt(e.clientX, e.clientY); if (!same(p, hover)) { hover = p; draw(); } }
  });
  window.addEventListener('pointerdown', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); });
  // A pointer that goes away is not joined to where it next appears.
  const away = () => { pointer.present = false; if (pointerDwell()) { tracer.reset(); rester.reset(); } };
  for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, e => { if (e.pointerType === 'touch') away(); });
  document.documentElement.addEventListener('pointerleave', away);
  window.addEventListener('pointerup', release);
  // Capture lost before the release counts as the release. Lost while still
  // pressed, the press waits for its pointerup on the window.
  boardNode.addEventListener('lostpointercapture', e => { if (e.buttons === 0) release(e); });
  window.addEventListener('pointercancel', e => { gestures.delete(e.pointerId); if (!gestures.size) drag = null; });
  boardNode.addEventListener('pointerleave', () => { if (hover !== null) { hover = null; draw(); } });
  boardNode.addEventListener('focus', () => { if (!gestures.size) keyboard = true; draw(); chrome(); });
  boardNode.addEventListener('blur', () => { keyboard = false; draw(); });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape') { e.preventDefault(); if (['starting', 'calibrating'].includes(phase)) stopCamera(); else lift(); return; }
    if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); undo(); return; }
    if (key === 'h') { e.preventDefault(); doHint(); return; }
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
    if (d) {
      e.preventDefault();
      const n = board.n, [r, c] = E.rc(n, focus), rr = clamp(r + d[0], 0, n - 1), cc = clamp(c + d[1], 0, n - 1);
      focus = rr * n + cc; keyboard = true; hover = null; boardNode.focus({ preventScroll: true }); draw(); chrome();
    }
    if ((key === 'Enter' || key === ' ') && e.target === boardNode && phase !== 'calibrating' && phase !== 'starting') { e.preventDefault(); if (phase === 'prompt') toPointer(); register(focus, 'key'); }
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
  $('#undo-btn').onclick = once('tool:undo', undo); $('#restart-btn').onclick = restart; $('#hint-btn').onclick = once('tool:hint', () => doHint());
  $('#next-btn').onclick = once('next', () => next());
  $('#camera-start').onclick = () => startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  $('#camera-btn').onclick = () => { if (['starting', 'calibrating', 'camera'].includes(phase)) stopCamera(); else startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input); };
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').onclick = () => { gestures.clear(); drag = null; hover = null; draw(); $('#' + id).showModal(); };
    $('#' + id).addEventListener('close', () => { $('#' + id + '-btn').focus(); settleLook(); wake(); });
  }
  $('#input').onchange = e => {
    const mode = e.target.value;
    if (mode === 'pointer') { if (phase !== 'pointer') stopCamera(); else { prefs.input = 'pointer'; save(); chrome(); } return; }
    $('#settings').close();
    if (['calibrating', 'camera'].includes(phase) && (T.running || virtual)) { prefs.input = mode; lastCamera = mode; save(); beginCalibration(!G.current(calibration[mode])); [fu, fv] = filters(); }
    else startCamera(mode);
  };
  $('#select').onchange = e => { prefs.select = e.target.value; save(); setPhase(phase); announce(prefs.select === 'dwell' ? 'Draw by looking and holding.' : 'Draw by tapping and dragging.'); };
  $('#dwell').onchange = e => { prefs.dwell = +e.target.value; dwell.time = prefs.dwell; rester.time = prefs.dwell; save(); announce(`Hold for ${prefs.dwell / 1000} seconds.`); };
  $('#calibrate').onclick = () => { $('#settings').close(); if (prefs.input === 'pointer') return; if (phase === 'camera' || phase === 'calibrating') beginCalibration(true); else startCamera(prefs.input, { full: true }); };
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.motion = prefs.motion;
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion; $('#rewards').value = prefs.rewards; $('#sound').value = prefs.sound;
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (reduced()) finishMotion(); else { draw(); chrome(); }
  }
  $('#rewards').onchange = e => { prefs.rewards = e.target.value; if (prefs.rewards === 'calm') { blooms = []; wave = wave && { ...wave, done: true }; } save(); draw(); announce(prefs.rewards === 'calm' ? 'Calm: paper and ink only.' : 'Colour rewards on.'); };
  // Sound makes its audio context only now, when it is turned on, and ticks once to say so.
  $('#sound').onchange = e => { prefs.sound = e.target.value; save(); if (prefs.sound === 'on') { const s = sound(); try { s.tick(0); } catch (_) {} } announce(prefs.sound === 'on' ? 'Sound on.' : 'Sound off.'); };
  for (const id of ['theme', 'motion']) $('#' + id).onchange = e => { prefs[id] = e.target.value; applyPrefs(); save(); announce(id === 'theme' ? 'Theme changed.' : 'Motion setting changed.'); };
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { fit(); build(); draw(); settleLook(); placeGlyphSoon(); wake(); });
  // A hidden page finishes its motion at once and stops the camera; coming
  // back starts it again where play left off.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      finishMotion(); pointer.present = false;
      if (T.running || phase === 'starting') { resumeOnShow = true; T.stop(); if (phase === 'starting') setPhase(prefs.input === 'pointer' ? 'pointer' : 'prompt'); }
    } else if (resumeOnShow) {
      resumeOnShow = false;
      if (phase === 'camera' || phase === 'calibrating') T.start().then(() => { setFace(false); dwell.reset(); freshHold = true; }, () => { if (phase === 'camera' || phase === 'calibrating') fallback(); });
      else if (phase === 'prompt') startCamera(prefs.input);
    }
  });

  // ---- The test hook.
  window.__glyph = {
    boards,
    get board() { return board.id; },
    get state() { const B = E.parse(board); return { n: board.n, lines: B.E, inked: inked(), drawn: B.lines.filter((_, i) => state.drawn >> i & 1).map(([a, b]) => '' + a + b), last: state.last, pen: state.pen, solved: isSolved(), hits, par: parOf(board), hint: hint && { ...hint }, focus, miss: miss && miss.slice(), undo: history.length }; },
    get input() { return { phase, mode: prefs.input, select: prefs.select, dwell: prefs.dwell, camera: { ...T.status(), virtual }, face, calibrating: calib && { step: calib.step, of: calib.spots.length, progress: calib.progress, full: calib.full }, gaze: gaze && { ...gaze }, current: dwell.current && dwell.current.id, blocked: dwell.blocked, rings: dwell.rings(), inside: tracer.inside, rest: rester.progress, calibration: JSON.parse(JSON.stringify(calibration)) }; },
    get payoff() { return { ...payoff, blooming: blooms.length, wave: !!wave && !wave.done, palette: boards.indexOf(board) % 6, name: P.NAMES[boards.indexOf(board) % 6], rewards: prefs.rewards, sound: prefs.sound, audio: !!(audio && audio.context) }; },
    register: p => register(p, 'hook'), lift: () => lift(), undo, restart, go, next, hint: () => doHint(),
    point(p) { const q = geo.points[p]; return q && { x: q.x, y: q.y, r: q.r, s: geo.s }; },
    geometry() { return { s: geo.s, r: geo.r, band: geo.band, dead: geo.dead, rect: { ...geo.rect }, points: geo.points.map(p => ({ ...p })), area: geo.area && { ...geo.area }, tools: toolTargets().map(t => ({ ...t })), next: nextTarget(), glyph: glyphTarget(), spots: G.SPOTS.map(p => toScreen(p.u, p.v)) }; },
    toScreen, targetAt: (x, y) => { const t = targetAt(x, y); return t && t.id; }, open: (x, y) => open(x, y),
    // Synthetic looks for tests: a face reading through the whole pipeline,
    // or a point on the page straight into the look input.
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
  fit(); build(); applyPrefs(); if (isSolved()) settle.value = 1; draw(); chrome(); save();
  // The shared control frame and the fonts may settle the page after this
  // first layout; measure again once they have.
  addEventListener('load', () => { fit(); build(); draw(); placeGlyphSoon(); wake(); });
  // The frame moves Next by setting properties on the body; follow it.
  new MutationObserver(() => { if (!$('#camera-start').hidden) placeGlyphSoon(); }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  // A camera player is asked once per visit with one glyph; a camera already
  // allowed starts by itself, and a refused one leaves play to the pointer.
  if (prefs.input === 'pointer') setPhase('pointer');
  else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { prefs.input = 'pointer'; save(); setPhase('pointer'); }
  else { setPhase('prompt'); permission().then(state => { if (phase !== 'prompt') return; if (state === 'granted') startCamera(prefs.input); else if (state === 'denied') fallback(); }); }
})();
