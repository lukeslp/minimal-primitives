/* Loop · Experiments · Loop's turning tiles on six other tilings, ten boards
   each. A set is chosen from Loop's Settings or Help, or opened on its own
   page to share; once Loop's fifty boards are done, New Game+ plays all sixty
   in sequence. Every solved board draws its whole Mandaza picture. By Luke
   Steuber. */
(function () {
  'use strict';
  const L = LoopTilings, D = LoopTilingsDraw, RUNS = LoopTilingRuns, NS = 'http://www.w3.org/2000/svg', KEY = 'loop-experiments.v1', LOOP_KEY = 'loop.v1', LAST_LOOP_BOARD = 'L50';
  const $ = s => document.querySelector(s);
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const mod = L.mod, params = new URLSearchParams(location.search);
  // A standalone page names its set on the body; the page inside Loop takes
  // ?set=<id> or ?plus.
  const STANDALONE = RUNS.find(r => r.id === document.body.dataset.set) || null, ROOT = STANDALONE ? '../' : './';
  const PLUS = RUNS.flatMap(r => r.boards.map((data, index) => ({ run: r, index, data })));
  const read = key => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; } };
  // The save: the mode and set last played, each set's board and furthest
  // open board, New Game+'s, every finished board, the position on the
  // current board, and the settings. Theme, motion and tile borders are
  // Loop's own: they are read from Loop's save and written back to it,
  // changing only those three fields within the values Loop accepts.
  const saved = read(KEY) || {}, loopSave = read(LOOP_KEY);
  const settings = { theme: 'system', motion: 'system', borders: 'off' };
  for (const src of [saved.settings, loopSave && loopSave.settings]) if (src) {
    if (['system', 'light', 'dark'].includes(src.theme)) settings.theme = src.theme;
    if (['system', 'reduce'].includes(src.motion)) settings.motion = src.motion;
    if (['off', 'on'].includes(src.borders)) settings.borders = src.borders;
  }
  const allIds = new Set(PLUS.map(e => e.data.id));
  const finished = new Set(Array.isArray(saved.finished) ? saved.finished.filter(id => allIds.has(id)) : []);
  const clampTrack = (t, n) => { const reached = Math.min(n - 1, Math.max(0, Number.isInteger(t && t.reached) ? t.reached : 0)); const board = Number.isInteger(t && t.board) && t.board >= 0 && t.board <= reached ? t.board : 0; return { board, reached }; };
  const tracks = { plus: clampTrack(saved.plus, PLUS.length) };
  for (const r of RUNS) {
    const t = clampTrack(saved.sets && saved.sets[r.id], r.boards.length);
    // A set opens every board up to the one after its last finished board.
    t.reached = Math.min(r.boards.length - 1, Math.max(t.reached, ...r.boards.map((b, i) => finished.has(b.id) ? i + 1 : 0)));
    tracks[r.id] = t;
  }
  // One unfinished position per set and one for New Game+, so switching away
  // and back resumes where play stopped. An older save's single position is
  // read as its mode's.
  const positions = {};
  if (saved.positions && typeof saved.positions === 'object') for (const [key, v] of Object.entries(saved.positions)) if (v && typeof v === 'object' && typeof v.board === 'string') positions[key] = v;
  if (saved.position && typeof saved.position === 'object' && typeof saved.position.board === 'string') { const e = PLUS.find(x => x.data.id === saved.position.board); if (e) positions[saved.position.mode === 'plus' ? 'plus' : e.run.id] = positions[saved.position.mode === 'plus' ? 'plus' : e.run.id] || saved.position; }
  const loopBeaten = () => { const s = read(LOOP_KEY); return !!(s && Array.isArray(s.finished) && s.finished.includes(LAST_LOOP_BOARD)); };
  let plusOpen = loopBeaten() || params.has('plus') || saved.plusOpen === true;
  let mode = 'set', run = RUNS[0];
  if (STANDALONE) run = STANDALONE;
  else if (RUNS.some(r => r.id === params.get('set'))) run = RUNS.find(r => r.id === params.get('set'));
  else if (params.has('plus') && plusOpen) mode = 'plus';
  else { if (saved.mode === 'plus' && plusOpen) mode = 'plus'; run = RUNS.find(r => r.id === saved.set) || RUNS[0]; }
  // The boards of the mode as it stands: a set's ten or New Game+'s sixty.
  const list = () => mode === 'plus' ? PLUS : run.boards.map((data, index) => ({ run, index, data }));
  const track = () => tracks[mode === 'plus' ? 'plus' : run.id];
  const reduced = () => settings.motion === 'reduce' || reducedQuery.matches;
  const still = () => reduced() || document.hidden;
  const dark = () => settings.theme === 'dark' || settings.theme === 'system' && darkQuery.matches;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function el(tag, attrs, parent) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (parent) parent.append(n); return n; }
  function announce(message) { const n = $('#announcement'); n.textContent = ''; n.textContent = message; }
  const svg = $('#board'), pic = D.makePic($('#finish'), false);
  let k, here, data, board, answer, rots, hits, history, locks, solved, lay, picture, view, groups, inkLayer, ends, sheen, marks, rimLayer;
  let focus = 0, keyboard = false, hover = null, hint = null, turning = null, gesture = null, wheel = null, S = 1, clock = 0;
  // The line shown once, on the solve that finishes the last of the sixty.
  let ending = '';

  function save() {
    try {
      const sets = {}; for (const r of RUNS) sets[r.id] = tracks[r.id];
      positions[mode === 'plus' ? 'plus' : run.id] = { board: data.id, rots, hits, history: history.slice(-200), locks: [...locks] };
      localStorage.setItem(KEY, JSON.stringify({ mode, set: run.id, sets, plus: tracks.plus, plusOpen, finished: [...finished], positions, settings, ...(settingsPending ? { settingsPending: true } : {}) }));
    } catch (_) { /* not kept */ }
  }
  // Without a Loop save to write into, the settings wait in this save and
  // Loop's page takes them on its next visit (experiments-list.js).
  let settingsPending = saved.settingsPending === true;
  function shareSettings() {
    try {
      const s = read(LOOP_KEY);
      if (!s || !s.settings) { settingsPending = true; save(); return; }
      s.settings.theme = settings.theme; s.settings.motion = settings.motion; s.settings.borders = settings.borders; localStorage.setItem(LOOP_KEY, JSON.stringify(s));
      if (settingsPending) { settingsPending = false; save(); }
    } catch (_) { /* Loop keeps its own */ }
  }
  // The page inside Loop keeps its mode in the address, for reloads and links.
  function syncUrl() {
    if (STANDALONE) return;
    try { const url = new URL(location.href); url.search = mode === 'plus' ? '?plus' : `?set=${run.id}`; history_replace(url); } catch (_) { /* a sandboxed frame */ }
  }
  function history_replace(url) { window.history.replaceState(null, '', url); }
  // A board of the current mode, fresh or as the save left it.
  function load(index) {
    if (turning) turning.finish();
    k = index; here = list()[k]; data = here.data; board = L.prepare(data); answer = L.solve(board, 1).solution.map(x => x[0]);
    const kept = positions[mode === 'plus' ? 'plus' : run.id], p = kept && kept.board === data.id ? kept : null;
    const valid = a => Array.isArray(a) && a.length === board.tiles.length && a.every((x, i) => Number.isInteger(x) && x >= 0 && x < board.tiles[i].n);
    rots = p && valid(p.rots) ? p.rots.slice() : data.start.slice();
    hits = p && Number.isSafeInteger(p.hits) && p.hits >= 0 ? p.hits : 0;
    history = p && Array.isArray(p.history) ? p.history.filter(h => h && valid(h.rots) && Number.isSafeInteger(h.hits)) : [];
    locks = new Set(p && Array.isArray(p.locks) ? p.locks.filter(i => Number.isInteger(i) && i >= 0 && i < board.tiles.length) : []);
    track().board = k; hint = null; hover = null; focus = middle(); ending = '';
    solved = L.solved(board, rots);
    stopReveal(); size(true); save(); syncUrl();
    document.title = mode === 'plus' ? 'Tangles · New Game+' : `Tangles · ${run.name}`;
  }
  function switchSet(r) {
    if (STANDALONE && r !== STANDALONE) { location.href = `../${r.slug}/`; return; }
    mode = 'set'; run = r; load(tracks[r.id].board); announce(`${r.name}, board ${k + 1} of ${r.boards.length}.`);
  }
  function switchPlus() {
    if (!plusOpen) return;
    if (STANDALONE) { location.href = '../experiments.html?plus'; return; }
    mode = 'plus'; load(tracks.plus.board); announce(`New Game+, board ${k + 1} of ${PLUS.length}.`);
  }
  const middle = () => { let best = 0, d = Infinity; const c = centreOf(); board.tiles.forEach((t, i) => { const e = Math.hypot(t.poly.c.x - c.x, t.poly.c.y - c.y); if (e < d) { d = e; best = i; } }); return best; };
  function centreOf() { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const t of board.tiles) for (const v of t.poly.v) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; }
  // The board fits the space the controls leave; the picture fills the page.
  function area(W, H) {
    const bar = $('.toolbar').getBoundingClientRect(), side = bar.height > bar.width;
    // With the toolbar in a side column (a landscape phone), the readout needs
    // less room above the board, as in Loop.
    const top = side ? 36 : 48, left = side ? 56 : 8, right = side ? bar.left - 84 : W - 8, bottom = side ? H - 6 : bar.top - 92;
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, fitW: right - left, fitH: bottom - top };
  }
  function size(force = false) {
    const W = innerWidth, H = innerHeight;
    if (!force && lay && lay.W === W && lay.H === H) return;
    lay = D.layout(L.byId[here.run.id], board, { W, H, ...area(W, H), fit: 0.96 });
    picture = D.plan(L.byId[here.run.id], board, answer, lay, null, `${data.id}/${Math.round(W)}x${Math.round(H)}`);
    const f = $('#finish'); f.style.setProperty('--glow', lay.glow + 'px'); f.style.setProperty('--shadow', lay.shadow + 'px'); f.style.setProperty('--drop', Math.max(0.5, lay.sFinal / lay.unit * 0.02) + 'px');
    render();
    if (solved) { D.fresh(pic, picture); D.complete(pic); pic.S = lay.sFinal; setView(lay.sFinal); inkLayer.style.visibility = 'hidden'; drift(); }
    else { pic.traces = null; paint(); }
  }
  // Boards cycle through Mandaza's palettes, as Loop's do.
  const paletteIndex = (e = here) => (e.index + RUNS.indexOf(e.run)) % D.PALETTES.length;
  const paint = () => D.paint(lay, pic, { night: dark(), palette: D.stops(paletteIndex(), dark()), ink: css('--ink'), time: reduced() ? 0 : clock });
  function setView(s) { S = s; view.setAttribute('transform', `translate(${lay.cx} ${lay.cy}) scale(${s}) translate(${-lay.bx} ${-lay.by})`); }
  const points = (t, scale = 1) => t.poly.v.map(v => `${(t.poly.c.x + (v.x - t.poly.c.x) * scale).toFixed(4)},${(t.poly.c.y + (v.y - t.poly.c.y) * scale).toFixed(4)}`).join(' ');
  function render() {
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${lay.W} ${lay.H}`);
    svg.style.setProperty('--lw', String(lay.playPx / lay.sPlay)); svg.style.setProperty('--rimw', String(lay.playPx * 0.75 / lay.sPlay));
    const defs = el('defs', {}, svg), blur = el('filter', { id: 'halo', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    el('feGaussianBlur', { stdDeviation: (lay.playPx * 0.7 / lay.sPlay).toFixed(4) }, blur);
    view = el('g', {}, svg); setView(lay.sPlay);
    const borders = el('g', { class: 'borders' }, view); for (const t of board.tiles) el('polygon', { points: points(t) }, borders);
    const hitLayer = el('g', {}, view); rimLayer = el('g', {}, view); inkLayer = el('g', { class: 'ink' }, view); ends = el('g', { class: 'ends' }, view); sheen = el('g', { class: 'sheen' }, view); marks = el('g', { class: 'marks' }, view);
    groups = board.tiles.map((t, i) => { el('polygon', { class: 'hit', 'data-tile': i, points: points(t) }, hitLayer); return el('g', { 'data-tile': i }, inkLayer); });
    board.tiles.forEach((_, i) => drawTile(i));
    if (solved) inkLayer.style.visibility = 'hidden';
    drawRims(); drawEnds(); drawMarks(); chrome();
  }
  function drawTile(i) { const t = board.tiles[i], g = groups[i]; g.replaceChildren(); for (const pair of t.pairs) el('path', { d: D.pathOf([L.curve(t, rots[i], pair)]) }, g); }
  // A locked tile has a heavier grey rim just inside its edge: shape and
  // lightness, never a tint.
  function drawRims() { rimLayer.replaceChildren(); if (solved) return; for (const i of locks) el('polygon', { class: 'lock-rim', 'data-lock': i, points: points(board.tiles[i], 0.86) }, rimLayer); }
  function drawEnds() {
    ends.replaceChildren(); if (solved) return;
    const r = lay.playPx * 0.85 / lay.sPlay;
    for (const e of L.loose(board, rots)) { const t = board.tiles[e.tile]; for (let i = 0; i < e.dots; i++) { const p = L.dotAt(t.poly, e.edge, i, e.dots); el('circle', { cx: p.x.toFixed(4), cy: p.y.toFixed(4), r: r.toFixed(4) }, ends); } }
  }
  function drawMarks() {
    marks.replaceChildren(); if (solved) return;
    if (hover !== null && !(keyboard && hover === focus)) el('polygon', { class: 'hover', points: points(board.tiles[hover]) }, marks);
    if (keyboard && document.activeElement === svg) el('polygon', { class: 'focus', points: points(board.tiles[focus], 0.94) }, marks);
    if (hint) el('polygon', { class: 'hint', points: points(board.tiles[hint.tile], 0.8) }, marks);
    const loose = L.loose(board, rots).length;
    svg.setAttribute('aria-label', `${mode === 'plus' ? `New Game+, board ${k + 1} of ${PLUS.length}, ${here.run.name} ${here.index + 1}` : `${run.name}, board ${k + 1} of ${run.boards.length}`}. ${solved ? 'Every line closed' : `${loose} ${loose === 1 ? 'edge' : 'edges'} with loose ends`}. ${hits} hits; par ${data.stats.par}.${solved ? '' : ` Focus tile ${focus + 1}${locks.has(focus) ? ', locked' : ''}.`}`);
  }
  const atEnd = () => k === list().length - 1;
  // New Game+ never dead-ends: past its last board, Next goes to the first
  // board not yet finished, or, with all sixty done, plays them again from
  // board 1, fresh, keeping every finished mark.
  const firstOpenPlus = () => PLUS.findIndex(e => !finished.has(e.data.id));
  const replay = () => mode === 'plus' && atEnd() && firstOpenPlus() < 0;
  // After a set's last board: the first unfinished board of the next set that
  // has one; with every set done, New Game+ once it is open, or Loop.
  const firstOpen = r => { const i = r.boards.findIndex(b => !finished.has(b.id)); return i < 0 ? null : i; };
  function onward() {
    for (let j = 1; j < RUNS.length; j++) { const r = RUNS[(RUNS.indexOf(run) + j) % RUNS.length], i = firstOpen(r); if (i !== null) return { run: r, index: i, label: `Next experiment: ${r.name}` }; }
    return plusOpen ? { plus: true, label: 'New Game+' } : { loop: true, label: 'Back to Tangles' };
  }
  function chrome() {
    $('#readout').textContent = `${mode === 'plus' ? '+ ' : ''}${k + 1} / ${list().length} · ${hits} / ${data.stats.par}`;
    $('#undo-btn').disabled = !history.length;
    $('#hint-btn').disabled = solved;
    svg.dataset.locked = String(solved); svg.tabIndex = solved ? -1 : 0; svg.dataset.borders = settings.borders;
    const next = $('#next-btn'), was = next.hidden;
    next.hidden = !solved;
    const again = replay();
    next.setAttribute('aria-label', again ? 'Replay New Game+' : atEnd() && mode !== 'plus' ? onward().label : 'Next board');
    if (next.dataset.replay !== String(again)) { next.dataset.replay = String(again); next.replaceChildren(icon(again ? icons.restart : icons.next)); }
    const end = $('#ending'); if (end) { end.textContent = ending; end.hidden = !(solved && ending); }
    if (solved) document.body.dataset.field = 'on'; else delete document.body.dataset.field;
    return was && !next.hidden;
  }
  const loopKey = loop => loop.map(([i, p]) => i + ':' + p).sort().join(' ');
  const spin = (i, deg) => { const c = board.tiles[i].poly.c; if (deg) groups[i].setAttribute('transform', `rotate(${deg.toFixed(3)} ${c.x} ${c.y})`); else groups[i].removeAttribute('transform'); };
  function animate(ms, draw, done) {
    if (still()) { draw(1); done(); return; }
    let elapsed = 0;
    const job = { step(dt) { if (turning !== handle) return false; elapsed += dt; const p = Math.min(1, elapsed / ms); draw(p); if (p >= 1) { turning = null; done(); return false; } return true; } };
    const handle = { finish: () => { D.running.delete(job); turning = null; draw(1); done(); } };
    turning = handle; D.run(job);
  }
  // A turn of `steps`, eased from wherever a drag left the tile. A locked tile
  // refuses: it leans a little, shakes and settles back, and no hit counts.
  function turn(i, steps, from = 0) {
    if (solved || !board.tiles[i]) return;
    if (turning) turning.finish();
    const t = board.tiles[i], step = 360 / t.n;
    if (locks.has(i) && mod(steps, t.n)) { const start = Math.max(-6, Math.min(6, from)); animate(320, p => spin(i, p < 1 ? start * (1 - p) + 4 * Math.sin(3 * Math.PI * p) * (1 - p) : 0), () => spin(i, 0)); announce(`Tile ${i + 1} is locked.`); return; }
    if (!mod(steps, t.n)) { const to = steps * step; animate(180, p => spin(i, p < 1 ? from + (to - from) * (1 - (1 - p) ** 3) : 0), () => spin(i, 0)); return; }
    const before = new Set(L.closedLoops(board, rots).map(loopKey));
    history.push({ rots: rots.slice(), hits }); hits++; hint = null;
    const to = steps * step;
    animate(D.TURN, p => spin(i, p < 1 ? from + (to - from) * (1 - (1 - p) ** 3) : 0), () => { rots[i] = mod(rots[i] + steps, t.n); drawTile(i); settle(before, i, steps); });
  }
  function settle(before, i, steps) {
    solved = L.solved(board, rots);
    if (solved) {
      const had = finished.size; finished.add(data.id);
      ending = had < PLUS.length && finished.size === PLUS.length ? `All ${PLUS.length} boards solved.` : '';
      const t = track(); t.reached = Math.max(t.reached, Math.min(list().length - 1, k + 1));
      const own = tracks[here.run.id]; own.reached = Math.max(own.reached, Math.min(here.run.boards.length - 1, here.index + 1));
      drawRims(); drawEnds(); drawMarks(); const shown = chrome(); save();
      announce(`Every line closed. ${hits} hits; par ${data.stats.par}. ${ending || (replay() ? 'Replay New Game+ is ready.' : atEnd() && mode !== 'plus' ? `${onward().label}.` : 'Next board is ready.')}`);
      if (shown && keyboard) $('#next-btn').focus();
      reveal(); return;
    }
    drawEnds(); drawMarks(); chrome(); save();
    const fresh = L.closedLoops(board, rots).filter(l => !before.has(loopKey(l)));
    if (fresh.length) shimmer(fresh);
    const loose = L.loose(board, rots).length;
    announce(`Tile ${i + 1} turned ${Math.abs(steps)} ${Math.abs(steps) === 1 ? 'step' : 'steps'} ${steps > 0 ? 'clockwise' : 'anticlockwise'}. ${hits} hits. ${loose} ${loose === 1 ? 'edge' : 'edges'} with loose ends.`);
  }
  function toggleLock(i) {
    if (solved || !board.tiles[i]) return;
    if (locks.has(i)) locks.delete(i); else locks.add(i);
    drawRims(); drawMarks(); save(); announce(`Tile ${i + 1} ${locks.has(i) ? 'locked' : 'unlocked'}.`);
  }
  // A loop that a move closes gets a quick sheen: a short streak slides once
  // round it, lighter than the ink on white, a soft glow beside it on black.
  function shimmer(loops) {
    if (still()) return;
    const lw = lay.playPx / lay.sPlay, night = dark();
    loops.forEach((loop, n) => {
      const bz = L.loopBezier(board, rots, loop), length = bz.reduce((a, c) => a + D.cubicLength(c), 0) * lay.sPlay;
      const f = Math.min(0.12, 48 / length), duration = Math.round(Math.min(520, 260 + length * 0.22));
      const p = el('path', { d: D.pathOf(bz), pathLength: 1, class: night ? 'halo' : 'core', 'stroke-width': (night ? lw * 2.2 : lw * 0.42).toFixed(4), 'stroke-dasharray': `${f} ${1 + f}`, 'stroke-dashoffset': f }, sheen);
      if (night) p.setAttribute('filter', 'url(#halo)');
      p.animate([{ strokeDashoffset: f }, { strokeDashoffset: -1 }], { duration, delay: n * 40, easing: 'ease-in-out', fill: 'both' }).finished.then(() => p.remove(), () => p.remove());
    });
  }
  // The finish, as Loop's: the view eases out to the picture's scale while the
  // ink fades and every loop starts drawing at once at Mandaza's speed; then
  // the colours drift.
  function stopReveal() { pic.job = null; pic.traces = null; delete document.body.dataset.field; }
  function reveal() {
    D.fresh(pic, picture); pic.S = lay.sPlay; pic.drawn = true;
    if (still()) { D.complete(pic); pic.S = lay.sFinal; setView(lay.sFinal); inkLayer.style.visibility = 'hidden'; paint(); return; }
    let elapsed = 0;
    const job = { step(dt) {
      if (pic.job !== job) return false;
      elapsed += dt; clock += dt; const p = Math.min(1, elapsed / D.ZOOM), s = lay.sPlay + (lay.sFinal - lay.sPlay) * D.ease(p);
      pic.S = s; setView(s);
      const o = Math.max(0, 1 - elapsed / D.FADE); inkLayer.style.opacity = String(o); if (!o) inkLayer.style.visibility = 'hidden';
      let open = false; for (const t of pic.traces) open = t.advance(dt * D.SPEED / s) || open;
      paint();
      if (p >= 1 && !open) { pic.job = null; drift(); return false; }
      return true;
    } };
    pic.job = job; D.run(job);
  }
  function drift() {
    paint(); if (reduced()) return;
    const job = { step(dt) { if (pic.job !== job || !solved) return false; if (document.hidden) return true; clock += dt; paint(); return true; } };
    pic.job = job; D.run(job);
  }
  function undo() {
    if (turning) turning.finish();
    const old = history.pop(); if (!old) { announce('No turns to undo.'); return; }
    rots = old.rots.slice(); hits = old.hits; hint = null;
    if (solved) { solved = false; stopReveal(); paint(); }
    ending = ''; inkLayer.style.opacity = ''; render(); save(); announce(`Turn undone. ${hits} hits.`);
  }
  function restart() {
    if (turning) turning.finish();
    rots = data.start.slice(); hits = 0; history = []; locks.clear(); hint = null; solved = false; ending = ''; stopReveal(); paint();
    render(); save(); announce('Board restarted.');
  }
  function doHint() {
    if (solved) return;
    if (!hint) { hint = L.hint(board, rots, locks); drawMarks(); if (hint) announce(`Hint marks tile ${hint.tile + 1}. Press Hint again to turn it.`); return; }
    const h = hint; hint = null;
    if (locks.has(h.tile)) toggleLock(h.tile);
    turn(h.tile, h.steps);
  }
  function next() {
    if (!solved) return;
    if (!atEnd()) { load(k + 1); announce(`Board ${k + 1} of ${list().length}.`); return; }
    if (mode === 'plus') { const open = firstOpenPlus(); load(open < 0 ? 0 : open); announce(`New Game+, board ${k + 1} of ${PLUS.length}.`); return; }
    const to = onward();
    if (to.loop) { location.href = ROOT; return; }
    if (to.plus) { switchPlus(); return; }
    tracks[to.run.id].board = to.index; save(); switchSet(to.run);
  }

  // Input. A tap or click turns clockwise and Shift turns back. A drag round a
  // tile turns it with the pointer and snaps to the nearest turn as one hit.
  // A press held still for 450 ms, or a right-click, locks or unlocks a tile.
  // The wheel or a trackpad swipe turns the tile under the pointer once per
  // gesture. Lost capture counts as a release.
  const tileOf = e => { const n = e.target && e.target.closest ? e.target.closest('[data-tile]') : null; return n ? Number(n.dataset.tile) : null; };
  const screenOf = i => { const c = board.tiles[i].poly.c, r = svg.getBoundingClientRect(); return { x: r.left + lay.cx + (c.x - lay.bx) * S, y: r.top + lay.cy + (c.y - lay.by) * S }; };
  const angle = (c, e) => Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
  svg.addEventListener('pointerdown', e => {
    if (solved || e.button !== 0) return;
    const i = tileOf(e); if (i === null) return;
    if (turning) turning.finish();
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* already released */ }
    // The turn is measured from the angle of the press itself, so a drag that
    // arrives in one move still turns by the whole of it.
    const g = { i, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, prev: angle(screenOf(i), e), total: 0, shift: e.shiftKey, held: false };
    g.hold = setTimeout(() => { if (gesture === g && !g.moved) { g.held = true; toggleLock(i); } }, 450);
    gesture = g;
  });
  svg.addEventListener('pointermove', e => {
    if (gesture && e.pointerId === gesture.id) {
      const g = gesture, c = screenOf(g.i);
      if (g.held) return;
      if (!g.moved) { if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 7) return; g.moved = true; clearTimeout(g.hold); }
      const a = angle(c, e); g.total += ((a - g.prev + 540) % 360) - 180; g.prev = a;
      spin(g.i, locks.has(g.i) ? Math.max(-6, Math.min(6, g.total)) : g.total);
      return;
    }
    if (e.pointerType === 'mouse') { const i = tileOf(e); if (i !== hover) { hover = i; drawMarks(); } }
  });
  function release(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture; gesture = null; clearTimeout(g.hold); keyboard = false; focus = g.i;
    if (g.held) { drawMarks(); return; }
    if (!g.moved) { turn(g.i, g.shift ? -1 : 1); drawMarks(); return; }
    turn(g.i, Math.round(g.total / (360 / board.tiles[g.i].n)), g.total); drawMarks();
  }
  // A cancelled pointer (the browser took the touch) turns nothing: a tile
  // the drag had moved eases back, and no hit counts.
  function cancel(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture; gesture = null; clearTimeout(g.hold);
    if (g.moved && !g.held) turn(g.i, 0, locks.has(g.i) ? Math.max(-6, Math.min(6, g.total)) : g.total);
  }
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', cancel);
  svg.addEventListener('lostpointercapture', release);
  svg.addEventListener('pointerleave', () => { hover = null; drawMarks(); });
  svg.addEventListener('contextmenu', e => { e.preventDefault(); if (gesture && gesture.held) return; const i = tileOf(e); if (i === null || solved) return; if (e.pointerType === 'touch' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return; toggleLock(i); });
  svg.addEventListener('wheel', e => {
    e.preventDefault(); if (solved) return;
    const i = tileOf(e); if (i === null) return;
    if (!wheel || wheel.i !== i) wheel = { i, total: 0, fired: false };
    wheel.total += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const w = wheel; clearTimeout(w.timer); w.timer = setTimeout(() => { if (wheel === w) wheel = null; }, 180);
    if (!w.fired && Math.abs(w.total) >= 40) { w.fired = true; turn(i, w.total > 0 ? 1 : -1); }
  }, { passive: false });
  // Focus from the keyboard shows the focused tile at once.
  svg.addEventListener('focus', () => { if (svg.matches(':focus-visible')) keyboard = true; drawMarks(); });
  svg.addEventListener('blur', drawMarks);
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['z', 'u', 'Backspace'].includes(e.key)) { e.preventDefault(); undo(); return; }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); doHint(); return; }
    if (document.activeElement !== svg || solved) return;
    const dirs = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    if (dirs[e.key]) {
      e.preventDefault(); keyboard = true;
      const [dx, dy] = dirs[e.key], c = board.tiles[focus].poly.c; let best = null, score = Infinity;
      board.tiles.forEach((t, i) => { const vx = t.poly.c.x - c.x, vy = t.poly.c.y - c.y, along = vx * dx + vy * dy, across = Math.abs(vx * dy - vy * dx); if (along <= 1e-6) return; const s = along + 2 * across; if (s < score) { score = s; best = i; } });
      if (best !== null) focus = best; drawMarks();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); keyboard = true; turn(focus, e.shiftKey ? -1 : 1); drawMarks(); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); keyboard = true; toggleLock(focus); }
  });

  // The picture of any finished board, at 2048 px or more on its long side,
  // shared where a phone can take a file, downloaded at a desk.
  const frameStep = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  async function renderImage(e) {
    const d = e.data, b = L.prepare(d), ans = L.solve(b, 1).solution.map(x => x[0]), T = L.byId[e.run.id], W = innerWidth, H = innerHeight;
    const ly = D.layout(T, b, { W, H, ...area(W, H), fit: 0.96 }), plan = D.plan(T, b, ans, ly, null, `${d.id}/${Math.round(W)}x${Math.round(H)}`);
    const scale = Math.max(2048 / Math.max(W, H), Math.min(devicePixelRatio || 1, 2)), w = Math.round(W * scale), h = Math.round(H * scale), night = dark();
    const lines = document.createElement('canvas'); lines.width = w; lines.height = h;
    const x = lines.getContext('2d'), s = ly.sFinal * scale; x.setTransform(s, 0, 0, s, scale * (ly.cx - ly.bx * ly.sFinal), scale * (ly.cy - ly.by * ly.sFinal));
    x.lineWidth = ly.colourPx / ly.sFinal; x.lineCap = x.lineJoin = 'round';
    const palette = D.stops(paletteIndex(e), night), groups = new Map(), total = plan.loops.length;
    plan.loops.forEach((loop, i) => { const c = D.loopColour(i, total, palette, 0); let g = groups.get(c); if (!g) groups.set(c, g = new Path2D()); g.addPath(new Path2D(D.pathOf(loop.bezier))); });
    for (const [c, g] of groups) { x.strokeStyle = c; x.stroke(g); }
    await frameStep();
    const glow = document.createElement('canvas'); glow.width = Math.ceil(w / 4); glow.height = Math.ceil(h / 4);
    const gx = glow.getContext('2d'); gx.filter = night ? `blur(${ly.glow * scale / 4}px)` : `brightness(0) blur(${Math.max(0.5, ly.shadow * scale / 4)}px)`;
    gx.drawImage(lines, 0, 0, glow.width, glow.height);
    const out = document.createElement('canvas'); out.width = w; out.height = h; const ox = out.getContext('2d');
    ox.fillStyle = getComputedStyle(document.body).backgroundColor; ox.fillRect(0, 0, w, h);
    ox.globalAlpha = night ? 0.9 : 0.18; ox.drawImage(glow, 0, night ? 0 : Math.max(0.5, ly.sFinal / ly.unit * 0.02) * scale, w, h); ox.globalAlpha = 1;
    ox.drawImage(lines, 0, 0);
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
    return blob ? { blob, width: w, height: h, name: `loop-${e.run.slug}-${e.index + 1}.png` } : null;
  }
  async function saveImage(e) {
    const image = await renderImage(e); if (!image) return;
    const file = new File([image.blob], image.name, { type: 'image/png' });
    // A phone offers the file to keep in its photos; a desk downloads it.
    try { if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Tangles · ${e.run.name}` }); announce('Image shared.'); return; } } catch (error) { if (error.name === 'AbortError') return; }
    const url = URL.createObjectURL(image.blob), link = document.createElement('a');
    if ('download' in link) { link.href = url; link.download = image.name; document.body.append(link); link.click(); link.remove(); announce('Image saved.'); }
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Settings: Loop, New Game+ and the six sets, each set with a small drawing
  // of its tiling; then the boards of the mode, each finished one with a
  // button that saves its picture.
  const icon = d => { const s = el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); el('path', { d }, s); return s; };
  function swatch(r) { const s = el('svg', { class: 'shape', viewBox: r.swatch.box, 'aria-hidden': 'true' }); el('path', { d: r.swatch.path, 'vector-effect': 'non-scaling-stroke' }, s); return s; }
  function entryItem(parent, { label, state, current, href, action, disabled, shape }) {
    const li = document.createElement('li'), b = document.createElement(href && !disabled ? 'a' : 'button');
    if (href && !disabled) b.href = href; else { b.type = 'button'; b.disabled = !!disabled; }
    b.className = 'experiment'; if (shape) b.append(shape); else b.append(icon('M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0'));
    const name = document.createElement('span'); name.className = 'name'; name.textContent = label;
    const st = document.createElement('span'); st.className = 'progress'; st.textContent = state;
    b.append(name, st); if (current) b.setAttribute('aria-current', 'true');
    if (action && !disabled) b.addEventListener('click', e => { e.preventDefault(); action(); $('#settings').close(); });
    li.append(b); parent.append(li); return b;
  }
  const doneIn = r => r.boards.filter(b => finished.has(b.id)).length;
  function settingsSheet() {
    const ex = $('#experiments'); ex.replaceChildren();
    entryItem(ex, { label: 'Tangles', state: 'Fifty boards', href: ROOT, shape: icon('M8 7c4-3 9-2 10 2s-1 6 2 9-1 6-5 6-7-3-10-2-6-3-5-7 1-6 6-8Z') });
    const plusDone = PLUS.filter(e => finished.has(e.data.id)).length;
    entryItem(ex, { label: 'New Game+', state: plusOpen ? `${mode === 'plus' ? 'Current · ' : ''}${plusDone} / ${PLUS.length}` : "After Tangles' fifty", current: mode === 'plus', disabled: !plusOpen, action: mode === 'plus' ? () => {} : switchPlus, shape: icon('M12 5v14M5 12h14') });
    for (const r of RUNS) {
      const current = mode === 'set' && r === run;
      entryItem(ex, { label: r.name, state: `${current ? 'Current · ' : ''}${doneIn(r)} / ${r.boards.length}`, current, href: STANDALONE ? `../${r.slug}/` : null, action: STANDALONE ? null : current ? () => {} : () => switchSet(r), shape: swatch(r) });
    }
    $('#catalog-title').textContent = mode === 'plus' ? 'Boards · New Game+' : `Boards · ${run.name}`;
    const boards = $('#level-catalog'); boards.replaceChildren();
    const t = track();
    list().forEach((e, n) => {
      const li = document.createElement('li'), b = document.createElement('button'), now = n === k, done = finished.has(e.data.id), open = n <= t.reached;
      b.type = 'button'; b.className = 'board'; b.dataset.board = e.data.id; b.disabled = !open;
      b.dataset.state = now ? 'current' : done ? 'completed' : open ? 'available' : 'locked';
      const title = document.createElement('span'); title.textContent = `Board ${n + 1}`;
      const state = document.createElement('span'); state.className = 'catalog-state'; state.textContent = [mode === 'plus' ? `${e.run.short} ${e.index + 1}` : null, now ? 'Current' : null, done ? 'Completed' : null, !now && !done ? (open ? 'Available' : 'Locked') : null].filter(Boolean).join(' · ');
      b.append(title, state); if (now) b.setAttribute('aria-current', 'true');
      b.onclick = () => { if (!open) return; if (!now) { load(n); announce(`Board ${n + 1} of ${list().length}.`); } $('#settings').close(); };
      li.append(b);
      if (done) {
        const s = document.createElement('button'); s.type = 'button'; s.className = 'save'; s.dataset.save = e.data.id; s.setAttribute('aria-label', `Save the picture of board ${n + 1}`);
        s.append(icon('M12 4v11M7 10l5 5 5-5M5 20h14')); s.onclick = () => saveImage(e);
        li.append(s);
      }
      boards.append(li);
    });
  }
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, d] of Object.entries(icons)) $('#' + id + '-btn').replaceChildren(icon(d));
  // Help names the sets as links, so a set is two taps from any board.
  function helpSets() {
    const ul = $('#help-sets'); if (!ul) return; ul.replaceChildren();
    for (const r of RUNS) { const li = document.createElement('li'), a = document.createElement('a'); a.href = STANDALONE ? `../${r.slug}/` : `?set=${r.id}`; a.textContent = r.name; li.append(a); ul.append(li); }
  }
  $('#restart-btn').onclick = restart;
  $('#undo-btn').onclick = undo;
  $('#hint-btn').onclick = doHint;
  $('#next-btn').onclick = next;
  for (const id of ['settings', 'help']) { $('#' + id + '-btn').onclick = () => { if (turning) turning.finish(); if (id === 'settings') settingsSheet(); $('#' + id).showModal(); }; $('#' + id).addEventListener('close', () => $('#' + id + '-btn').focus()); }
  function applyPrefs() {
    if (settings.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.motion = settings.motion;
    for (const id of ['theme', 'motion', 'borders']) $('#' + id).value = settings[id];
    svg.dataset.borders = settings.borders;
    document.querySelectorAll('meta[name="theme-color"]').forEach(n => { n.content = dark() ? '#000000' : '#ffffff'; });
    if (lay) { if (solved && pic.traces) { if (reduced()) { if (pic.job) { D.complete(pic); pic.S = lay.sFinal; setView(lay.sFinal); inkLayer.style.visibility = 'hidden'; } pic.job = null; paint(); } else if (!pic.job) drift(); else paint(); } else paint(); }
  }
  for (const id of ['theme', 'motion', 'borders']) $('#' + id).onchange = e => { settings[id] = e.target.value; applyPrefs(); save(); shareSettings(); };
  reducedQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => size(), 120); });
  // The shared control frame moves the toolbar after this script runs (to a
  // side column on a landscape phone), so the board is measured again once it
  // has: when the page finishes loading and whenever the toolbar's box changes.
  const reflow = () => { if (lay) size(true); };
  document.addEventListener('DOMContentLoaded', reflow);
  let toolbarBox = '';
  new ResizeObserver(() => { const r = $('.toolbar').getBoundingClientRect(), box = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`; if (box !== toolbarBox) { const first = !toolbarBox; toolbarBox = box; if (!first) reflow(); } }).observe($('.toolbar'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && lay) paint(); });
  // A help link inside the page switches set without a reload.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('#help-sets a'); if (!a || STANDALONE) return;
    const r = RUNS.find(x => `?set=${x.id}` === a.getAttribute('href')); if (!r) return;
    e.preventDefault(); $('#help').close(); switchSet(r);
  });

  applyPrefs(); helpSets(); load(track().board);

  // A hook for checks.
  window.__loopExperiments = {
    sets: RUNS.map(r => ({ id: r.id, name: r.name, slug: r.slug, boards: r.boards.map(b => b.id) })), standalone: STANDALONE ? STANDALONE.id : null,
    state: () => ({ mode, set: run.id, tiling: here.run.id, index: k, count: list().length, board: data.id, tiles: board.tiles.length, sides: board.tiles.map(t => t.n), rots: rots.slice(), answer: answer.slice(), hits, par: data.stats.par, solved, loose: L.loose(board, rots).length, locks: [...locks].sort((a, b) => a - b), hint: hint && { ...hint }, reached: track().reached, finished: [...finished], plusOpen, sPlay: lay.sPlay, playPx: lay.playPx, smallest: Math.round(Math.min(...board.tiles.map(t => lay.sPlay / Math.tan(Math.PI / t.n)))), drawn: !!(pic.traces && pic.traces.every(t => t.done)) }),
    centres: () => board.tiles.map((_, i) => screenOf(i)),
    busy: () => !!turning || !!(pic.job && pic.traces && !pic.traces.every(t => t.done)),
    turn: (i, steps = 1) => turn(i, steps), lock: i => toggleLock(i), hint: doHint, undo, restart, next,
    set: id => { const r = RUNS.find(x => x.id === id); if (r) switchSet(r); }, plus: switchPlus,
    go: index => { if (index >= 0 && index <= track().reached) load(index); },
    image: async index => { const img = await renderImage(list()[index]); return img && { width: img.width, height: img.height, bytes: img.blob.size }; }
  };
})();
