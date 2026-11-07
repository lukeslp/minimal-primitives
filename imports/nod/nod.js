/* Nod. By Luke Steuber.
   Tilt's stacked trays and fifty boards, tipped by tilting your head. The
   rules and boards are Tilt's own files, unchanged; the trays are drawn as
   Tilt draws them; the camera, calibration and look and hold come from
   Glance. */
(function () {
  'use strict';
  const E = TiltStack, Boards = TiltStackBoards, G = NodGaze, T = NodTrack, P = NodPayoff;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = 'nod.v1';
  const CELL = 64, GAP = 44, PAD = 26, RAIL = '(max-height:520px) and (min-width:560px)';
  const NAMES = { U: 'Up', D: 'Down', L: 'Left', R: 'Right' }, ANGLE = { R: 0, D: 90, L: 180, U: -90, UL: -135, UR: -45 };
  const INPUTS = ['head', 'eyes', 'pointer'], SELECTS = ['dwell', 'tap'], HOLDS = [300, 500, 800, 1200];
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = G.clamp, boardNode = $('#board'), layer = $('#gaze-layer');
  const ids = new Set(Boards.map(b => b.id));

  // ---- The save: one `nod.v1` record. Anything unreadable is left exactly
  // as it was while a fresh game plays on without saving over it.
  let current = Boards[0], parsed = E.prepare(current), place = { ...parsed.start }, hits = 0, history = [], finished = new Set();
  const DEFAULTS = { theme: 'system', motion: 'system', input: 'head', select: 'tap', hold: 500, rewards: 'colour', sound: 'off' };
  let prefs = { ...DEFAULTS };
  let calibration = { head: null, eyes: null }, lastCamera = 'head', protectSave = false;
  const validPlace = (pz, p) => !!p && [p.level, p.row, p.col].every(Number.isInteger) && p.level >= 0 && p.level < pz.levels && p.row >= 0 && p.col >= 0 && p.row < pz.size && p.col < pz.size && pz.grid[p.level][p.row][p.col] !== '#' && (pz.grid[p.level][p.row][p.col] !== 'o' || p.level === pz.levels - 1);
  const validHits = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000;
  const validSettings = s => !!s && typeof s === 'object' && ['system', 'light', 'dark'].includes(s.theme) && ['system', 'reduce'].includes(s.motion) && INPUTS.includes(s.input) && SELECTS.includes(s.select) && HOLDS.includes(s.hold) && (s.rewards === undefined || ['colour', 'calm'].includes(s.rewards)) && (s.sound === undefined || ['off', 'on'].includes(s.sound));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = s && ids.has(s.board) ? Boards.find(x => x.id === s.board) : null;
      if (!b) throw Error('Invalid save');
      const pz = E.prepare(b);
      if (s.version !== 1 || !validPlace(pz, s.place) || !validHits(s.hits) || !Array.isArray(s.history) || s.history.length > 10000 || !s.history.every(h => h && validPlace(pz, h) && validHits(h.hits))) throw Error('Invalid save');
      if (!Array.isArray(s.finished) || !s.finished.every(id => ids.has(id)) || !validSettings(s.settings) || !['head', 'eyes'].includes(s.lastCamera)) throw Error('Invalid save');
      // A calibration that does not read is dropped on its own (it is asked for
      // again); it used to discard the whole save, boards and all.
      if (!s.calibration || typeof s.calibration !== 'object') s.calibration = { head: null, eyes: null };
      for (const k of ['head', 'eyes']) if (!(s.calibration[k] === null || (G.validCalibration(s.calibration[k]) && s.calibration[k].kind === k))) s.calibration[k] = null;
      current = b; parsed = pz; place = { level: s.place.level, row: s.place.row, col: s.place.col }; hits = s.hits;
      history = s.history.map(h => ({ level: h.level, row: h.row, col: h.col, hits: h.hits }));
      finished = new Set(s.finished); prefs = { ...DEFAULTS, ...s.settings }; calibration = { head: s.calibration.head, eyes: s.calibration.eyes }; lastCamera = s.lastCamera;
    }
  } catch (_) { protectSave = true; }
  const pars = new Map(), parOf = b => { if (!pars.has(b.id)) pars.set(b.id, E.par(b)); return pars.get(b.id); };
  const solvedAt = p => p.level === parsed.levels - 1 && parsed.grid[p.level][p.row][p.col] === 'o';
  let solved = solvedAt(place), par = parOf(current), hint = null, busy = false, token = 0;
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, board: current.id, place, hits, history, finished: [...finished], settings: prefs, calibration, lastCamera })); } catch (_) {}
  }
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const sheet = () => document.querySelector('dialog[open]');
  function announce(text) { const n = $('#announcement'); n.textContent = ''; n.textContent = text; }
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
    if (parent) parent.append(n); return n;
  }
  function set(n, attrs) {
    n.cache ||= {};
    for (const k in attrs) { const v = attrs[k] === null || attrs[k] === undefined ? null : String(attrs[k]); if (n.cache[k] === v) continue; if (v === null) n.removeAttribute(k); else n.setAttribute(k, v); n.cache[k] = v; }
  }

  // ---- Layout. The trays fill the shell above a rest area, where the camera
  // glyph, the level glyph and the Next disc sit (beside the trays in a short,
  // wide window). Nothing chosen by looking lies in the page's outer band.
  const geo = { scale: .6, ox: 0, oy: 0, band: 16, rail: false, rest: { cx: 0, cy: 0, room: 96 }, rv: 28, corners: [], pads: [], dead: 10 };
  const sizeOf = () => ({ w: PAD * 2 + parsed.size * CELL, h: PAD * 2 + parsed.levels * parsed.size * CELL + (parsed.levels - 1) * GAP });
  function toolbarRects() { return [...document.querySelectorAll('.toolbar button')].filter(b => b.offsetParent !== null).map(b => b.getBoundingClientRect()); }
  function fit() {
    const shell = $('#board-shell').getBoundingClientRect(), short = Math.min(innerWidth, innerHeight), { w, h } = sizeOf();
    geo.band = Math.max(14, Math.round(short * .04)); geo.rail = matchMedia(RAIL).matches;
    const reserve = geo.rail ? 0 : clamp(Math.round(short * .25), 100, 132);
    const scale = Math.max(.1, Math.min(shell.width / w, (shell.height - reserve) / h));
    const sw = w * scale, sh = h * scale, left = (shell.width - sw) / 2, top = (shell.height - reserve - sh) / 2;
    boardNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    Object.assign(boardNode.style, { width: sw + 'px', height: sh + 'px', left: left + 'px', top: top + 'px' });
    Object.assign(geo, { scale, ox: shell.left + left, oy: shell.top + top, cell: CELL * scale, dead: Math.max(10, CELL * scale * .15) });
    // The rest area: between the lowest tray and the toolbar, or between the
    // trays and the toolbar's rail.
    const tools = toolbarRects(), b = { left: geo.ox + PAD * scale, right: geo.ox + (w - PAD) * scale, top: geo.oy + PAD * scale, bottom: geo.oy + (h - PAD) * scale };
    if (geo.rail) {
      const railLeft = tools.length ? Math.min(...tools.map(r => r.left)) : innerWidth - geo.band;
      geo.rest = { cx: (b.right + railLeft) / 2, cy: (Math.max(0, b.top) + Math.min(innerHeight, b.bottom)) / 2, room: railLeft - b.right };
    } else {
      const toolTop = tools.length ? Math.min(...tools.map(r => r.top)) : innerHeight - geo.band;
      geo.rest = { cx: innerWidth / 2, cy: (b.bottom + toolTop) / 2, room: toolTop - b.bottom };
    }
    geo.trays = b;
    const room = geo.rail ? Math.min(geo.rest.room, 160) : geo.rest.room;
    geo.rv = clamp(Math.round(room * .26), 22, 36);
    placePads(); placeGlyph(); layerDirty = true;
  }
  // Undo and hint: for the head, small pads at the level glyph's upper
  // corners, reached by tilting toward that corner; for eyes and a resting
  // pointer, larger pads either side of where the Next disc sits.
  function placePads() {
    const { cx, cy } = centre(), rv = geo.rv;
    const d = rv + 22, r = 11;
    geo.corners = [['UL', 'undo'], ['UR', 'hint']].map(([dir, name]) => ({ id: 'corner:' + name, name, dir, cx: cx + d * Math.cos(ANGLE[dir] * Math.PI / 180), cy: cy + d * Math.sin(ANGLE[dir] * Math.PI / 180), r }));
    const pr = clamp(Math.round(geo.rest.room * .28), 24, 34), off = 32 + 18 + pr;
    geo.pads = [['undo', -1], ['hint', 1]].map(([name, side]) => geo.rail ? { id: 'pad:' + name, name, kind: 'pad', cx, cy: cy + side * off, r: pr } : { id: 'pad:' + name, name, kind: 'pad', cx: cx + side * off, cy, r: pr });
  }
  // The glyph's centre is the rest area's, where the control frame also
  // centres the Next disc.
  const centre = () => ({ cx: geo.rest.cx, cy: geo.rest.cy });
  function toScreen(u, v) {
    const x0 = geo.band, x1 = innerWidth - geo.band, y0 = geo.band, y1 = innerHeight - geo.band;
    return { x: (x0 + x1) / 2 + u * (x1 - x0) / 2, y: (y0 + y1) / 2 + v * (y1 - y0) / 2 };
  }
  const origin = level => ({ x: PAD, y: PAD + level * (parsed.size * CELL + GAP) });
  const centerOf = (level, row, col) => { const a = origin(level); return { x: a.x + (col + .5) * CELL, y: a.y + (row + .5) * CELL }; };
  const screenOf = p => ({ x: geo.ox + p.x * geo.scale, y: geo.oy + p.y * geo.scale });
  function marbleScreen() { return screenOf(marbleAt || centerOf(place.level, place.row, place.col)); }
  function trayScreen(level) { const a = origin(level), span = parsed.size * CELL; return { left: geo.ox + a.x * geo.scale, top: geo.oy + a.y * geo.scale, right: geo.ox + (a.x + span) * geo.scale, bottom: geo.oy + (a.y + span) * geo.scale }; }

  // ---- The trays, drawn as Tilt draws them.
  let marbleAt = null, hintMark = null, marbleNode = null, paintLayers = {}, painted = false;
  function draw() {
    const ink = ['var(--lv0)', 'var(--lv1)', 'var(--lv2)'];
    boardNode.replaceChildren();
    for (let level = parsed.levels - 1; level >= 0; level--) {
      const at = origin(level), span = parsed.size * CELL;
      el('rect', { x: at.x, y: at.y, width: span, height: span, fill: 'var(--floor)', stroke: 'var(--line)', 'stroke-width': 1, class: 'tray-frame', 'data-level': level }, boardNode);
      paintLayers[level] = el('g', { class: 'paint', 'data-level': level }, boardNode);
      let lines = '';
      for (let i = 1; i < parsed.size; i++) { lines += 'M' + (at.x + i * CELL) + ' ' + at.y + 'V' + (at.y + span); lines += 'M' + at.x + ' ' + (at.y + i * CELL) + 'H' + (at.x + span); }
      el('path', { d: lines, fill: 'none', stroke: 'var(--line)', 'stroke-width': 1 }, boardNode);
      for (let row = 0; row < parsed.size; row++) for (let col = 0; col < parsed.size; col++) {
        const ch = parsed.grid[level][row][col], x = at.x + col * CELL, y = at.y + row * CELL;
        if (ch === '#') el('rect', { x: x + 1, y: y + 1, width: CELL - 2, height: CELL - 2, fill: ink[level] || ink[2] }, boardNode);
        if (ch === 'o') {
          const goal = level === parsed.levels - 1;
          el('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: CELL * (goal ? .34 : .28), fill: 'none', stroke: 'var(--hole)', 'stroke-width': goal ? 3 : 2 }, boardNode);
          if (goal) el('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: CELL * .16, fill: 'none', stroke: 'var(--hole)', 'stroke-width': 2 }, boardNode);
          if (!goal && parsed.grid[level + 1][row][col] !== 'o') { const land = centerOf(level + 1, row, col); el('circle', { cx: land.x, cy: land.y, r: CELL * .18, fill: 'none', stroke: 'var(--ghost)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, boardNode); }
          if (!goal) { const y1 = at.y + span; el('line', { x1: x + CELL / 2, y1, x2: x + CELL / 2, y2: y1 + GAP, stroke: 'var(--shaft)', 'stroke-width': 1.5, 'stroke-dasharray': '2 4' }, boardNode); }
        }
      }
    }
    hintMark = el('path', { id: 'hint-mark', d: 'M-10 5 0-7 10 5', fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', display: 'none' }, boardNode);
    const { w, h } = sizeOf(), clip = el('clipPath', { id: 'payoff-clip' }, el('defs', {}, boardNode)); el('rect', { x: 0, y: 0, width: w, height: h }, clip);
    paintLayers.top = el('g', { class: 'payoff' }, boardNode); paintLayers.exit = paintLayers[parsed.levels - 1]; paintLayers.clip = 'payoff-clip'; painted = false;
    marbleNode = el('g', { id: 'marble' }, boardNode);
    el('circle', { r: CELL * .2, fill: 'var(--ball)' }, marbleNode);
    el('circle', { r: CELL * .06, cx: -CELL * .06, cy: -CELL * .07, fill: 'var(--spec)' }, marbleNode);
    placeMarble(centerOf(place.level, place.row, place.col), 1);
  }
  function placeMarble(point, scale) { marbleAt = point; if (marbleNode) marbleNode.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) scale(${scale})`); }
  function markActive() {
    for (const node of boardNode.querySelectorAll('.tray-frame')) {
      const on = Number(node.getAttribute('data-level')) === place.level;
      set(node, { stroke: on ? 'var(--ink)' : 'var(--line)', 'stroke-width': on ? 2.5 : 1, 'data-active': String(on) });
    }
  }
  function showHint() {
    if (!hintMark) return;
    if (!hint) { set(hintMark, { display: 'none' }); return; }
    const at = origin(place.level), span = parsed.size * CELL;
    const spot = { U: [at.x + span / 2, at.y - 8, 0], D: [at.x + span / 2, at.y + span + 8, 180], L: [at.x - 8, at.y + span / 2, -90], R: [at.x + span + 8, at.y + span / 2, 90] }[hint];
    set(hintMark, { display: null, transform: `translate(${spot[0]} ${spot[1]}) rotate(${spot[2]})` });
  }
  function describe() {
    const lines = [`Board ${Boards.indexOf(current) + 1}. Marble on tray ${place.level + 1}, row ${place.row + 1}, column ${place.col + 1}.`];
    for (let level = 0; level < parsed.levels; level++) {
      const rows = [];
      for (let row = 0; row < parsed.size; row++) {
        const cells = [];
        for (let col = 0; col < parsed.size; col++) {
          const ch = parsed.grid[level][row][col], here = level === place.level && row === place.row && col === place.col;
          cells.push(here && ch === 'o' ? 'marble in the exit' : here ? 'marble' : ch === '#' ? 'block' : ch === 'o' ? (level === parsed.levels - 1 ? 'exit' : 'hole') : 'floor');
        }
        rows.push(cells.join(', '));
      }
      lines.push(`Tray ${level + 1}: ${rows.join('; ')}.`);
    }
    return lines.join(' ');
  }

  // ---- Chrome.
  function refresh() {
    const i = Boards.indexOf(current);
    $('#readout').textContent = `${i + 1} / ${Boards.length} · ${hits} / ${par}`;
    $('#readout').setAttribute('aria-label', `Board ${i + 1} of ${Boards.length}; ${hits} tips; par ${par}`);
    boardNode.setAttribute('aria-label', describe() + ` ${hits} tips, par ${par}.` + (solved ? ' Finished.' : ''));
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = solved;
    $('#next-btn').hidden = !solved || i === Boards.length - 1;
    const on = ['starting', 'calibrating', 'camera'].includes(phase);
    $('#camera-btn').setAttribute('aria-pressed', String(on)); $('#camera-btn').setAttribute('aria-label', on ? 'Stop the camera' : 'Start the camera');
    $('#select').disabled = prefs.input !== 'pointer'; $('#calibrate').disabled = prefs.input === 'pointer';
    $('#input').value = prefs.input; $('#select').value = prefs.input === 'pointer' ? prefs.select : 'dwell'; $('#hold').value = String(prefs.hold);
    document.documentElement.dataset.busy = busy ? '1' : '0';
    boardNode.dataset.solved = String(solved);
    markActive(); showHint(); catalog(); placeGlyph(); wake();
  }
  // Settings lists every board as current, completed or available; all fifty are open.
  function catalog() {
    const list = $('#board-catalog');
    if (!list.children.length) Boards.forEach((b, i) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.dataset.board = b.id;
      button.innerHTML = `<span>Board ${i + 1}</span><span class="catalog-state"></span>`;
      button.addEventListener('click', () => { if (b !== current) go(b.id); $('#settings').close(); });
      item.append(button); list.append(item);
    });
    Boards.forEach((b, i) => {
      const button = list.children[i].firstChild, here = b === current, done = finished.has(b.id);
      button.dataset.state = here ? 'current' : done ? 'completed' : 'available';
      button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, done ? 'Completed' : null, !here && !done ? 'Available' : null].filter(Boolean).join(' · ');
      if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }

  // ---- Play. A tip is applied at once and saved before its motion; a tip
  // that arrives while the marble still rolls finishes that roll first.
  function finishMotion() { if (!busy) return; token++; busy = false; placeMarble(centerOf(place.level, place.row, place.col), 1); landed(); }
  function animate(from, path) {
    const points = [centerOf(from.level, from.row, from.col)].concat(path.map(c => centerOf(c.level, c.row, c.col)));
    if (reduced() || document.hidden || points.length < 2) { placeMarble(points[points.length - 1], 1); busy = false; refresh(); landed(); return; }
    busy = true; refresh();
    const serial = ++token, spans = [];
    for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / CELL; spans.push(path[i - 1].drop ? 180 + d * 70 : 60 + d * 48); }
    const total = spans.reduce((s, x) => s + x, 0), started = performance.now();
    const frame = now => {
      if (serial !== token) return;
      const time = now - started;
      if (time >= total) { placeMarble(points[points.length - 1], 1); busy = false; refresh(); landed(); return; }
      let walked = 0;
      for (let i = 0; i < spans.length; i++) {
        if (time <= walked + spans[i]) {
          const raw = (time - walked) / spans[i], ease = path[i].drop ? raw * raw : raw;
          placeMarble({ x: points[i].x + (points[i + 1].x - points[i].x) * ease, y: points[i].y + (points[i + 1].y - points[i].y) * ease }, path[i].drop ? 1 - .28 * Math.sin(Math.PI * raw) : 1);
          break;
        }
        walked += spans[i];
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  // ---- The payoff. A tip that moves the marble blooms where the marble
  // lands, fuller after a drop through a hole; the finishing tip, once the
  // marble is in the exit, colours the trays in a wave from the exit. Nothing
  // waits for it: the next tip can come at once, and Next is there already.
  let pending = null, turn = 0;
  const audio = P.synth(), stats = { blooms: 0, drops: 0, fades: 0, solves: 0, kinds: [] };
  const stops = () => P.paletteFor(Boards.indexOf(current), dark());
  function landed() {
    const p = pending; pending = null;
    if (!p) return;
    const at = centerOf(p.level, p.row, p.col);
    if (prefs.rewards === 'colour') {
      const b = P.bloom(paintLayers.top, { x: at.x, y: at.y, size: CELL, stops: stops(), full: p.drop, reduced: reduced(), turn: turn++ });
      stats.blooms++; if (p.drop) stats.drops++; if (b.fade) stats.fades++; stats.kinds.push(b.kind); stats.last = { ...b, level: p.level, row: p.row, col: p.col };
    }
    if (prefs.sound === 'on') audio.tick(p.step, p.drop);
    if (p.solved) solvedPayoff(at);
  }
  function solvedPayoff(at) {
    stats.solves++;
    if (prefs.sound === 'on') audio.chord();
    if (prefs.rewards !== 'colour') return;
    unpaint();
    const cells = [];
    for (let level = 0; level < parsed.levels; level++) for (let row = 0; row < parsed.size; row++) for (let col = 0; col < parsed.size; col++) if (parsed.grid[level][row][col] !== '#') { const c = centerOf(level, row, col); cells.push({ level, x: c.x, y: c.y, size: CELL }); }
    P.paint(paintLayers, { cells, from: at, stops: stops(), reduced: reduced(), exitR: CELL * .3 });
    painted = true; boardNode.dataset.painted = 'true';
  }
  function unpaint() {
    for (const n of boardNode.querySelectorAll('.paint > *, .payoff > .paint-ring')) { for (const a of n.getAnimations()) a.cancel(); n.remove(); }
    painted = false; boardNode.dataset.painted = 'false';
  }
  // A tip the walls refuse still nudges the marble toward the wall and back,
  // so a head that tipped sees that the tip landed.
  function nudge(dir) {
    if (reduced() || document.hidden || busy) return;
    const home = centerOf(place.level, place.row, place.col), d = E.DIRS[dir], serial = ++token, started = performance.now();
    const frame = now => {
      if (serial !== token) return;
      const t = clamp((now - started) / 180, 0, 1), k = Math.sin(Math.PI * t) * CELL * .1;
      placeMarble({ x: home.x + d[1] * k, y: home.y + d[0] * k }, 1);
      if (t < 1) requestAnimationFrame(frame); else placeMarble(home, 1);
    };
    requestAnimationFrame(frame);
  }
  function tilt(dir) {
    if (!NAMES[dir] || solved || phase === 'calibrating' || phase === 'starting') return false;
    finishMotion();
    const result = E.slide(current, place, dir), where = r => `Tray ${r.level + 1}, row ${r.row + 1}, column ${r.col + 1}.`;
    hint = null;
    if (!result.moved) { announce(NAMES[dir] + '. The marble stays.'); refresh(); nudge(dir); return false; }
    history.push({ ...place, hits });
    const from = { ...place };
    place = { level: result.level, row: result.row, col: result.col }; hits += 1; solved = result.solved;
    if (solved) finished.add(current.id);
    save();
    const drops = result.path.some(c => c.drop);
    pending = { level: place.level, row: place.row, col: place.col, drop: drops, solved, step: hits - 1 };
    if (solved) announce(`${NAMES[dir]}. ${drops ? 'Drops. ' : ''}Finished in ${hits}, par ${par}. ${Boards.indexOf(current) === Boards.length - 1 ? 'Every board is done.' : 'Next board is ready.'}`);
    else announce(`${NAMES[dir]}. ${drops ? 'Drops to ' : ''}${where(result)}`);
    refresh(); animate(from, result.path);
    return true;
  }
  function undo() {
    finishMotion();
    const previous = history.pop();
    if (!previous) { announce('No tip to undo.'); refresh(); return false; }
    place = { level: previous.level, row: previous.row, col: previous.col }; hits = previous.hits; solved = solvedAt(place); hint = null;
    if (!solved) unpaint();
    save(); placeMarble(centerOf(place.level, place.row, place.col), 1);
    announce(`Undone. Tray ${place.level + 1}, row ${place.row + 1}, column ${place.col + 1}. ${hits} tips.`);
    refresh(); return true;
  }
  function restart() {
    finishMotion();
    const home = parsed.start;
    if (hits !== 0 || place.level !== home.level || place.row !== home.row || place.col !== home.col) history.push({ ...place, hits });
    place = { ...home }; hits = 0; solved = false; hint = null; unpaint();
    save(); placeMarble(centerOf(place.level, place.row, place.col), 1); announce('Restarted.'); refresh(); afterBoardChange();
    return true;
  }
  // Every board is open: any of the fifty can be chosen, and Next leads to the following one.
  function go(id) {
    const next = Boards.find(b => b.id === id);
    if (!next) return false;
    token++; busy = false; pending = null;
    current = next; parsed = E.prepare(current); par = parOf(current); place = { ...parsed.start }; hits = 0; solved = false; hint = null; history = [];
    save(); fit(); draw(); refresh(); afterBoardChange();
    announce(`Board ${Boards.indexOf(current) + 1}.`);
    return true;
  }
  function next() { const b = Boards[Boards.indexOf(current) + 1]; return solved && b ? go(b.id) : false; }
  function armHint() {
    if (solved) return false;
    if (hint) { const dir = hint; hint = null; return tilt(dir); }
    const moves = E.solve(current, place);
    if (!moves || !moves.length) { announce('No way on from here.'); return false; }
    hint = moves[0]; announce(`Hint: ${NAMES[hint]}. Hint again tips it.`); refresh();
    return true;
  }

  // ---- Input. `phase` is where the player is: the camera's first screen
  // (prompt), the camera starting, calibrating, playing by camera, or by pointer.
  let phase = 'pointer', calib = null, face = false, gaze = null, freshHold = false, resumeOnShow = false, virtual = false;
  const pointer = { x: 0, y: 0, present: false };
  const gesture = G.gesture({ hold: prefs.hold });
  const filters = () => prefs.input === 'eyes' ? [G.oneEuro({ minCutoff: .45, beta: .35 }), G.oneEuro({ minCutoff: .45, beta: .35 })] : [G.oneEuro({ minCutoff: .8, beta: .6 }), G.oneEuro({ minCutoff: .8, beta: .6 })];
  let [fx, fy] = filters();
  const headOn = () => phase === 'camera' && prefs.input === 'head';
  // Look and hold chooses for the eyes, and for a pointer when Select by says so.
  const lookOn = () => (phase === 'camera' && prefs.input === 'eyes') || (phase === 'pointer' && prefs.select === 'dwell');
  const pointerDwell = () => (phase === 'pointer' && prefs.select === 'dwell') || phase === 'prompt';
  const inSafe = (x, y) => x >= geo.band && y >= geo.band && x <= innerWidth - geo.band && y <= innerHeight - geo.band;
  const within = (t, x, y, grow) => Math.hypot(x - t.cx, y - t.cy) <= t.r + grow;
  // The camera glyph stands in the rest area, sized to it; beside the Next disc when that waits.
  function placeGlyph() {
    const n = $('#camera-start'); if (n.hidden) return;
    const room = geo.rail ? Math.min(geo.rest.room, 200) : geo.rest.room, d = clamp(Math.floor(room - 24), 64, 120);
    let { cx: x, cy: y } = geo.rest;
    if (!$('#next-btn').hidden) { if (geo.rail) y = Math.max(geo.band + d / 2, y - 44 - d / 2); else x -= 44 + d / 2; }
    Object.assign(n.style, { left: Math.round(x - d / 2) + 'px', top: Math.round(y - d / 2) + 'px', width: d + 'px', height: d + 'px' });
    n.style.setProperty('--glyph-icon', Math.round(d * .4) + 'px');
  }
  function glyphTarget() { const n = $('#camera-start'); if (n.hidden) return null; const b = n.getBoundingClientRect(); return b.width ? { id: 'camera', kind: 'camera', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 } : null; }
  function nextTarget() { const n = $('#next-btn'); if (n.hidden || !n.isConnected) return null; const b = n.getBoundingClientRect(); return b.width ? { id: 'next', kind: 'next', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 } : null; }
  const padLive = p => p.name === 'undo' ? history.length > 0 : !solved;
  // What a look or a resting pointer at (x, y) would choose: nothing in the
  // outer band or behind a sheet; on the marble's own tray, the side of the
  // marble it rests on; nothing elsewhere on the trays or in the rest area.
  // After a tip the marble rolls on, often past the place being looked at;
  // that same resting look chooses nothing more until it has moved away.
  let lookBlock = null;
  const blockRadius = () => Math.max(geo.cell * (prefs.input === 'eyes' ? 1 : .75), 24);
  function dirAt(x, y, cone) {
    if (lookBlock) { if (Math.hypot(x - lookBlock.x, y - lookBlock.y) < blockRadius()) return null; lookBlock = null; }
    const tray = trayScreen(place.level), m = marbleScreen(), grow = geo.cell * .5;
    if (x < tray.left - grow || x > tray.right + grow || y < tray.top - grow || y > tray.bottom + grow) return null;
    const dx = x - m.x, dy = y - m.y;
    if (Math.hypot(dx, dy) < Math.max(geo.cell * (prefs.input === 'eyes' ? .8 : .6), 20)) return null;
    const z = G.zoneOf(dx, dy, cone, -1);
    return z ? { id: 'dir:' + z.dir, kind: 'dir', dir: z.dir } : null;
  }
  function targetAt(x, y) {
    if (!inSafe(x, y) || $('dialog[open]')) return null;
    if (phase === 'prompt') { const g = glyphTarget(); return g && within(g, x, y, 0) ? g : null; }
    if (!lookOn()) return null;
    for (const p of geo.pads) if (within(p, x, y, 0) && padLive(p)) return p;
    const n = nextTarget(); if (n && within(n, x, y, 0)) return n;
    if (solved) return null;
    return dirAt(x, y, 35);
  }
  function holds(t, x, y) {
    if (!inSafe(x, y) || $('dialog[open]')) return false;
    if (t.kind === 'camera') { const g = glyphTarget(); return !!g && within(g, x, y, geo.dead); }
    if (!lookOn()) return false;
    if (t.kind === 'next') { const n = nextTarget(); return !!n && within(n, x, y, geo.dead); }
    if (t.kind === 'pad') return padLive(t) && within(t, x, y, geo.dead);
    if (t.kind === 'dir') { if (solved) return false; const d = dirAt(x, y, 45); return !!d && d.dir === t.dir; }
    return false;
  }
  const dwell = G.dwell({ time: prefs.hold, targets: targetAt, holds });
  function feedLook(t, x, y) {
    if (freshHold && x !== null) { dwell.hold(targetAt(x, y)); freshHold = false; }
    gaze = x === null ? null : { x, y };
    for (const target of dwell.sample(t, x, y)) choose(target);
    wake();
  }
  function choose(t) {
    if (t.kind === 'dir') { lookBlock = gaze || (pointer.present ? { x: pointer.x, y: pointer.y } : null); tilt(t.dir); }
    else if (t.id === 'pad:undo') undo();
    else if (t.id === 'pad:hint') armHint();
    else if (t.id === 'next') next();
    else if (t.id === 'camera') startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  }
  // The head: each reading's point goes to the tilt recogniser, whose tips
  // tip the trays. The upper corners are undo and hint; once a board is
  // finished, any tip chooses Next.
  function feedHead(t, p) {
    for (const e of gesture.sample(t, p)) {
      if (sheet()) continue;
      if (e.dir === 'UL') { if (history.length) undo(); }
      else if (e.dir === 'UR') { if (!solved) armHint(); }
      else if (solved) next();
      else tilt(e.dir);
    }
    wake();
  }
  // A new board, or a new way of looking, starts with whatever lies under the
  // point already counted as chosen, and the head waits for a return to rest.
  function settleLook(keepTilt = false) {
    dwell.reset(); if (!keepTilt) gesture.reset(); lookBlock = null;
    if (phase === 'camera' || phase === 'calibrating') freshHold = true;
    else { freshHold = false; if (pointerDwell() && pointer.present) dwell.hold(targetAt(pointer.x, pointer.y)); }
  }
  function afterBoardChange() { settleLook(); placePads(); layerDirty = true; wake(); }
  function setPhase(next) {
    phase = next; document.body.dataset.phase = next;
    $('#camera-start').hidden = !(next === 'prompt' || next === 'starting'); placeGlyph();
    gaze = null; settleLook();
    if (next !== 'camera' && next !== 'calibrating') setFace(false);
    refresh();
  }
  function setFace(on) { face = on; $('#live').dataset.face = on ? 'seen' : 'none'; }
  function showLive(on) { $('#live').hidden = !on; document.body.dataset.camera = on ? 'on' : 'off'; }
  T.onStream = on => showLive(on || virtual);
  T.onResult = (result, t) => processFace(result, t);
  // Each camera reading: the head's pose or the eyes' look, then calibration,
  // the tilt recogniser or look and hold.
  // Flipped for a player who chose Up and down: Flipped, which every game on
  // this site shares.
  const lookOptions = () => { let invertY = false; try { invertY = localStorage.getItem('minimal-gaze.v1:invert-y') === '1'; } catch (_) {} return { invertY }; };
  function processFace(result, t) {
    if (phase !== 'camera' && phase !== 'calibrating') return;
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    setFace(!!lm);
    const mode = calib ? calib.mode : prefs.input;
    if (!lm) { if (phase === 'calibrating') calibrate(t, null); else if (mode === 'eyes') feedLook(t, null, null); else feedHead(t, null); return; }
    const aspect = virtual ? 4 / 3 : T.aspect();
    const f = mode === 'eyes' ? G.lookAngles(lm, aspect) : G.headPose(lm, result.facialTransformationMatrixes && result.facialTransformationMatrixes[0], aspect);
    if (phase === 'calibrating') { calibrate(t, f); return; }
    const cal = calibration[mode]; if (!cal) return;
    const o = lookOptions();
    if (mode === 'eyes') { const m = G.eyesMap(cal, f, o), p = toScreen(fx.filter(m.u, t), fy.filter(m.v, t)); feedLook(t, clamp(p.x, 0, innerWidth), clamp(p.y, 0, innerHeight)); }
    else { const p = G.headPoint(cal, f); feedHead(t, { x: fx.filter(p.x, t), y: fy.filter(o.invertY ? -p.y : p.y, t) }); }
  }
  // Calibration, as in Glance: one dot at a time; hold still on it and its
  // ring fills. The first time, the centre and then the four edges; after
  // that, each start needs only the centre.
  function beginCalibration(full) {
    calib = { full, mode: prefs.input, spots: full ? [0, 1, 2, 3, 4] : [0], step: 0, window: [], captured: [], progress: 0, last: null };
    setPhase('calibrating'); announce(full ? 'Look at each dot in turn and hold still.' : 'Look at the dot and hold still.');
  }
  function calibrate(t, f) {
    const dt = calib.last === null ? 0 : clamp(t - calib.last, 0, 120), head = calib.mode === 'head';
    const keys = head ? ['yaw', 'pitch', 'roll'] : ['ax', 'ay'], tolerance = head ? .02 : .06, travel = head ? .035 : .06;
    calib.last = t;
    if (f) { calib.window.push({ t, ...f }); while (t - calib.window[0].t > 400) calib.window.shift(); } else calib.window = [];
    const s = G.stillness(calib.window, keys, tolerance), span = calib.window.length ? t - calib.window[0].t : 0, first = calib.captured[0];
    // Each edge dot needs the look moved its own way: across for the side
    // dots, up or down for the top and bottom ones. A turn alone used to
    // take a top or bottom dot with no nod at all.
    // In Nod a side dot may be reached by turning or by tilting the head, so
    // either counts across; up and down must be a nod.
    const spot = calib.spots[calib.step], axis = keys[1], side = spot === 1 || spot === 2, across0 = head ? ['yaw', 'roll'] : [keys[0]];
    const away = from => side ? across0.some(k => Math.abs(s.mean[k] - from[k]) >= travel) : Math.abs(s.mean[axis] - from[axis]) >= travel;
    // And the bottom dot must lie on the other side of the centre from the top
    // one. Still looking up when the bottom dot came used to take it there,
    // and the calibration then ran up and down backwards.
    const across = spot !== 4 || !s.mean || Math.sign(s.mean[axis] - first[axis]) !== Math.sign(calib.captured[3][axis] - first[axis]);
    const moved = calib.step === 0 || (!!s.mean && away(first) && away(calib.captured[calib.captured.length - 1]) && across);
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
    [fx, fy] = filters(); gesture.reset(true); setPhase('camera');
    announce(mode === 'head' ? 'Camera ready. Tilt your head toward a side and hold to tip; come back to level between tips.' : 'Camera ready. Look beside the marble, on its tray, and hold to tip.');
  }
  const permission = async () => { try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch (_) { return 'unknown'; } };
  // Start the camera for head or eyes. Refused or unavailable, play goes on by pointer.
  async function startCamera(mode, { full = false } = {}) {
    if (phase === 'starting') return;
    prefs.input = mode; lastCamera = mode; save();
    if (virtual || T.running) { beginCalibration(full || !G.current(calibration[mode])); return; }
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
    announce('Camera unavailable. Play by pointer or keys; the camera button tries again.');
  }
  function stopCamera() {
    T.stop(); virtual = false; showLive(false); calib = null; resumeOnShow = false;
    if (prefs.input !== 'pointer') lastCamera = prefs.input;
    prefs.input = 'pointer'; save(); setPhase('pointer'); announce('Camera off. Playing by pointer and keys.');
  }
  function toPointer() { prefs.input = 'pointer'; prefs.select = 'tap'; save(); setPhase('pointer'); }

  // ---- The look layer: the level glyph, pads, rings, gaze dot and calibration dot.
  let rafId = 0, layerDirty = true;
  const glyph = el('g', { class: 'glyph' }, layer);
  const vial = el('circle', { class: 'vial' }, glyph), restRing = el('circle', { class: 'rest-ring' }, glyph), bubble = el('circle', { class: 'bubble' }, glyph);
  const edges = Object.fromEntries(['U', 'R', 'D', 'L'].map(d => [d, { track: el('path', { class: 'edge-track' }, glyph), fill: el('path', { class: 'edge-fill' }, glyph) }]));
  const cornerLayer = el('g', { class: 'corners' }, layer), padLayer = el('g', { class: 'pads' }, layer), ringsLayer = el('g', { class: 'dwell-rings' }, layer);
  const nextRing = { track: el('circle', { class: 'dwell-track' }, layer), arc: el('circle', { class: 'dwell-arc' }, layer) };
  const dot = el('g', { class: 'gaze-dot' }, layer); el('circle', { class: 'gaze-halo', r: 18 }, dot); el('circle', { class: 'gaze-core', r: 7 }, dot);
  const spotLayer = el('g', { class: 'spot-layer' }, layer);
  el('circle', { class: 'spot-halo', r: 15 }, spotLayer); el('circle', { class: 'spot', r: 9 }, spotLayer);
  el('circle', { class: 'dwell-track', r: 26 }, spotLayer); const spotArc = el('circle', { class: 'dwell-arc', r: 26 }, spotLayer);
  const rings = new Map();
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14m-6-6 6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', camera: 'M3 8h4l2-3h6l2 3h4v11H3ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' };
  function wake() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function loop(now) {
    rafId = 0;
    if (pointerDwell() && !document.hidden) feedLook(now, pointer.present ? pointer.x : null, pointer.present ? pointer.y : null);
    drawLayer();
    if ((pointerDwell() && pointer.present) || dwell.rings().length) wake();
  }
  // An arc of the circle (cx, cy, r) from angle a to angle b, in degrees.
  function arc(cx, cy, r, a, b) {
    if (b - a < .5) return '';
    const p = deg => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)], [x1, y1] = p(a), [x2, y2] = p(b);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  function ringFor(id) {
    let n = rings.get(id);
    if (!n) { n = { track: el('path', { class: 'dwell-track' }, ringsLayer), arc: el('path', { class: 'dwell-arc' }, ringsLayer) }; rings.set(id, n); }
    return n;
  }
  function drawCorners(show) {
    if (!show) { set(cornerLayer, { display: 'none' }); return; }
    set(cornerLayer, { display: null });
    if (cornerLayer.childElementCount !== geo.corners.length || layerDirty) {
      cornerLayer.replaceChildren();
      for (const c of geo.corners) {
        const g = el('g', { class: 'corner', 'data-corner': c.name }, cornerLayer), k = c.r * 2 * .62 / 24;
        el('circle', { class: 'corner-ring', cx: c.cx.toFixed(1), cy: c.cy.toFixed(1), r: c.r }, g);
        el('path', { class: 'corner-icon', d: icons[c.name], transform: `translate(${(c.cx - 12 * k).toFixed(1)} ${(c.cy - 12 * k).toFixed(1)}) scale(${k.toFixed(3)})`, 'vector-effect': 'non-scaling-stroke' }, g);
        el('path', { class: 'edge-fill corner-fill' }, g);
      }
      layerDirty = 'corners';
    }
    const shown = gesture.shown;
    for (const g of cornerLayer.children) {
      const c = geo.corners.find(x => x.name === g.dataset.corner), live = c.name === 'undo' ? history.length > 0 : !solved, v = shown.dir === c.dir ? shown.value : 0;
      set(g, { 'data-off': String(!live) });
      set(g.lastChild, { d: arc(c.cx, c.cy, c.r + 4, -90, -90 + 360 * Math.min(v, .999)) });
    }
  }
  function drawLayer() {
    const head = headOn(), { cx, cy } = centre(), rv = geo.rv, n = nextTarget();
    // The level glyph: the bubble moves with the head; each edge's arc fills
    // as a tip builds toward it; the rest ring is solid while a return to level is awaited.
    const showGlyph = head && !n;
    set(glyph, { display: showGlyph ? null : 'none', 'data-phase': gesture.phase, 'data-face': face ? 'seen' : 'none' });
    const shown = gesture.shown;
    if (showGlyph) {
      set(vial, { cx: cx.toFixed(1), cy: cy.toFixed(1), r: rv });
      set(restRing, { cx: cx.toFixed(1), cy: cy.toFixed(1), r: (rv * gesture.settings.rest).toFixed(1) });
      const q = gesture.point || { x: 0, y: 0 }, m = Math.hypot(q.x, q.y), k = m > 1.1 ? 1.1 / m : 1;
      set(bubble, { cx: (cx + q.x * k * rv).toFixed(1), cy: (cy + q.y * k * rv).toFixed(1), r: Math.max(4, rv * .2).toFixed(1) });
      for (const [d, e] of Object.entries(edges)) {
        const a = ANGLE[d], v = shown.dir === d ? shown.value : 0;
        set(e.track, { d: arc(cx, cy, rv + 6, a - 30, a + 30) });
        set(e.fill, { d: arc(cx, cy, rv + 6, a - 30 * v, a + 30 * v) });
      }
    }
    const rebuilt = layerDirty; drawCorners(head);
    // With Next waiting, any tip chooses it: its ring fills as the tip builds.
    const nv = head && n && ['U', 'R', 'D', 'L'].includes(shown.dir) ? shown.value : 0;
    if (nv > 0) {
      const r = n.r + 8, C = 2 * Math.PI * r;
      set(nextRing.track, { display: null, cx: n.cx.toFixed(1), cy: n.cy.toFixed(1), r: r.toFixed(1) });
      set(nextRing.arc, { display: null, cx: n.cx.toFixed(1), cy: n.cy.toFixed(1), r: r.toFixed(1), 'stroke-dasharray': `${(nv * C).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(-90 ${n.cx.toFixed(1)} ${n.cy.toFixed(1)})` });
    } else { set(nextRing.track, { display: 'none' }); set(nextRing.arc, { display: 'none' }); }
    // Pads for eyes and a resting pointer.
    if (lookOn()) {
      if (padLayer.childElementCount !== geo.pads.length || rebuilt) {
        padLayer.replaceChildren();
        for (const p of geo.pads) {
          const g = el('g', { class: 'corner pad', 'data-pad': p.name }, padLayer), k = p.r * 2 * .42 / 24;
          el('circle', { class: 'corner-ring', cx: p.cx.toFixed(1), cy: p.cy.toFixed(1), r: p.r }, g);
          el('path', { class: 'corner-icon', d: icons[p.name], transform: `translate(${(p.cx - 12 * k).toFixed(1)} ${(p.cy - 12 * k).toFixed(1)}) scale(${k.toFixed(3)})`, 'vector-effect': 'non-scaling-stroke' }, g);
        }
      }
      for (const g of padLayer.children) { const p = geo.pads.find(x => x.name === g.dataset.pad); set(g, { 'data-off': String(!padLive(p)) }); }
      set(padLayer, { display: null });
    } else set(padLayer, { display: 'none' });
    layerDirty = false;
    // Look-and-hold rings: around a pad, Next or the camera glyph; beside the
    // marble, an arc toward the side being chosen.
    const live = new Set();
    for (const [id, p] of dwell.rings()) {
      const ring = ringFor(id);
      if (id.startsWith('dir:')) {
        const m = marbleScreen(), a = ANGLE[id.slice(4)], r = geo.cell * .42;
        set(ring.track, { d: arc(m.x, m.y, r, a - 45, a + 45) }); set(ring.arc, { d: arc(m.x, m.y, r, a - 45 * p, a + 45 * p) });
      } else {
        const t = id.startsWith('pad:') ? geo.pads.find(x => x.id === id) : id === 'next' ? nextTarget() : glyphTarget();
        if (!t) continue;
        const r = t.r + (id.startsWith('pad:') ? 6 : 9);
        set(ring.track, { d: arc(t.cx, t.cy, r, -90, 269.9) }); set(ring.arc, { d: arc(t.cx, t.cy, r, -90, -90 + 359.9 * p) });
      }
      live.add(id);
    }
    for (const [id, ring] of rings) if (!live.has(id)) { ring.track.remove(); ring.arc.remove(); rings.delete(id); }
    // The eyes show their dot; a pointer shows itself.
    const showDot = phase === 'camera' && prefs.input === 'eyes' && gaze;
    set(dot, { transform: showDot ? `translate(${gaze.x.toFixed(1)} ${gaze.y.toFixed(1)})` : null, display: showDot ? null : 'none' });
    if (phase === 'calibrating' && calib) {
      const s = G.SPOTS[calib.spots[calib.step]], at = toScreen(s.u, s.v), C = 2 * Math.PI * 26;
      set(spotLayer, { display: null, transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`, 'data-step': String(calib.step) });
      set(spotArc, { 'stroke-dasharray': `${(calib.progress * C).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90)' });
    } else set(spotLayer, { display: 'none' });
  }

  // ---- Tilt's own controls, for a pointer and keys alike, in every mode.
  // One gesture is one tip, and it can begin anywhere on the page: a drag or
  // swipe of 24 pixels or more tips the way it travels; a click or tap tips
  // from the marble toward that point (not while a resting pointer chooses,
  // so a system's own dwell click and the game's hold never both tip); a
  // trackpad swipe or the wheel tips the way the fingers go; arrows and W A S D
  // tip. A release counts wherever it lands, and capture lost with no button
  // held is a release.
  const control = t => !!(t && t.closest && t.closest('button,a,select,input,textarea,label,summary,dialog'));
  const way = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
  function handTip(dir) {
    if (sheet() || phase === 'calibrating' || phase === 'starting') return false;
    if (phase === 'prompt') toPointer();
    return tilt(dir);
  }
  for (const n of document.body.children) if (n.tagName !== 'DIALOG' && n.style) n.style.touchAction = 'none';
  let stroke = null;
  const html = document.documentElement;
  window.addEventListener('pointerdown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake();
    if (control(e.target) || sheet()) return;
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault(); boardNode.focus({ preventScroll: true });
    stroke = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
    try { html.setPointerCapture(e.pointerId); } catch (_) {}
  }, true);
  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || e.buttons) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true; if (pointerDwell()) wake(); }
    if (!stroke || stroke.id !== e.pointerId) return;
    stroke.lx = e.clientX; stroke.ly = e.clientY;
  }, true);
  function finish(x, y) {
    const dx = x - stroke.x, dy = y - stroke.y, far = Math.max(Math.abs(dx), Math.abs(dy));
    stroke = null;
    if (far >= 24) { handTip(way(dx, dy)); return; }
    if (far > 8 || (phase === 'pointer' && prefs.select === 'dwell')) return;
    const m = marbleScreen(), r = geo.cell * .2, cx = x - m.x, cy = y - m.y;
    if (Math.hypot(cx, cy) < Math.max(r * 1.5, 12)) return;
    handTip(way(cx, cy));
  }
  window.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') pointer.present = false;
    if (!stroke || stroke.id !== e.pointerId) return;
    finish(e.clientX, e.clientY);
  }, true);
  window.addEventListener('pointercancel', e => { if (e.pointerType === 'touch') pointer.present = false; if (stroke && stroke.id === e.pointerId) stroke = null; }, true);
  // A mouse can lose capture a moment before its pointerup, when a move with no button held lands first. That is a release.
  window.addEventListener('lostpointercapture', e => {
    if (e.target !== html || !stroke || stroke.id !== e.pointerId) return;
    if (e.buttons) stroke = null; else finish(stroke.lx, stroke.ly);
  }, true);
  document.documentElement.addEventListener('pointerleave', () => { pointer.present = false; });
  // A trackpad swipe arrives as a stream of wheel steps with momentum after it.
  // It tips once, past a threshold, then waits for the stream to stop. On a Mac
  // the content follows the fingers, so the steps are read backwards there.
  let wheel = { x: 0, y: 0, spent: false, timer: 0 };
  window.addEventListener('wheel', e => {
    if (e.ctrlKey || sheet()) return;
    e.preventDefault();
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(() => { wheel = { x: 0, y: 0, spent: false, timer: 0 }; }, 180);
    if (wheel.spent) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    wheel.x += e.deltaX * k; wheel.y += e.deltaY * k;
    if (Math.max(Math.abs(wheel.x), Math.abs(wheel.y)) < 40) return;
    wheel.spent = true;
    const f = /Mac|iPhone|iPad/.test(navigator.platform) ? -1 : 1;
    handTip(way(wheel.x * f, wheel.y * f));
  }, { passive: false, capture: true });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || sheet() || (e.target.matches && e.target.matches('select,input,textarea'))) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape' && ['starting', 'calibrating'].includes(phase)) { e.preventDefault(); stopCamera(); return; }
    if (e.repeat) return;
    const dir = { ArrowUp: 'U', ArrowRight: 'R', ArrowDown: 'D', ArrowLeft: 'L', w: 'U', d: 'R', s: 'D', a: 'L' }[key];
    if (dir) { e.preventDefault(); handTip(dir); return; }
    if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); undo(); return; }
    if (key === 'h') { e.preventDefault(); armHint(); }
  });
  for (const name of ['dragstart', 'selectstart', 'contextmenu']) boardNode.addEventListener(name, e => e.preventDefault());

  // ---- Chrome, sheets and settings.
  for (const id of ['restart', 'undo', 'hint', 'next', 'settings', 'help']) $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[id]}"/></svg>`;
  $('#camera-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.camera}"/><circle class="lens-dot" cx="12" cy="13" r="1.6"/></svg>`;
  $('#camera-start').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.camera}"/></svg>`;
  $('#undo-btn').onclick = () => undo(); $('#restart-btn').onclick = () => restart(); $('#hint-btn').onclick = () => armHint(); $('#next-btn').onclick = () => next();
  $('#camera-start').onclick = () => startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  $('#camera-btn').onclick = () => { if (['starting', 'calibrating', 'camera'].includes(phase)) stopCamera(); else startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input); };
  let lastFocus = null;
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').onclick = () => { stroke = null; lastFocus = $('#' + id + '-btn'); $('#' + id).showModal(); };
    $('#' + id).addEventListener('close', () => { if (lastFocus) lastFocus.focus(); afterBoardChange(); });
  }
  $('#input').onchange = e => {
    const mode = e.target.value;
    if (mode === 'pointer') { if (phase !== 'pointer') stopCamera(); else { prefs.input = 'pointer'; save(); refresh(); } return; }
    $('#settings').close();
    if (['calibrating', 'camera'].includes(phase) && (T.running || virtual)) { prefs.input = mode; lastCamera = mode; save(); [fx, fy] = filters(); beginCalibration(!G.current(calibration[mode])); }
    else startCamera(mode);
  };
  $('#select').onchange = e => { prefs.select = e.target.value; save(); setPhase(phase); announce(prefs.select === 'dwell' ? 'Choose by resting the pointer.' : 'Choose by tapping and dragging.'); };
  $('#hold').onchange = e => { prefs.hold = +e.target.value; dwell.time = prefs.hold; gesture.hold = prefs.hold; save(); announce(`Hold for ${prefs.hold / 1000} seconds.`); };
  $('#calibrate').onclick = () => { $('#settings').close(); if (prefs.input === 'pointer') return; if (phase === 'camera' || phase === 'calibrating') beginCalibration(true); else startCamera(prefs.input, { full: true }); };
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.motion = prefs.motion;
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion; $('#rewards').value = prefs.rewards; $('#sound').value = prefs.sound;
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (reduced()) finishMotion();
  }
  $('#rewards').onchange = e => { prefs.rewards = e.target.value; if (prefs.rewards === 'calm') unpaint(); save(); announce(prefs.rewards === 'calm' ? 'Rewards calm: paper and ink only.' : 'Rewards in colour.'); };
  // The AudioContext is made here, in the player's own gesture, and never before Sound is on.
  $('#sound').onchange = e => { prefs.sound = e.target.value; if (prefs.sound === 'on') audio.wake(); save(); announce(prefs.sound === 'on' ? 'Sound on.' : 'Sound off.'); };
  for (const id of ['theme', 'motion']) $('#' + id).onchange = e => { prefs[id] = e.target.value; applyPrefs(); save(); refresh(); announce(id === 'theme' ? 'Theme changed.' : 'Motion setting changed.'); };
  motionQuery.addEventListener('change', () => { applyPrefs(); refresh(); }); darkQuery.addEventListener('change', applyPrefs);
  // A resize moves every target, so looks start afresh; a head tilt under way carries on.
  window.addEventListener('resize', () => { fit(); refresh(); settleLook(true); });
  if (window.ResizeObserver) new ResizeObserver(() => { fit(); layerDirty = true; wake(); }).observe($('#board-shell'));
  // A hidden page finishes its motion at once and stops the camera; coming
  // back starts it again where play left off, waiting for a return to level.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      finishMotion(); refresh(); pointer.present = false; stroke = null;
      if (T.running || phase === 'starting') { resumeOnShow = true; T.stop(); if (phase === 'starting') setPhase(prefs.input === 'pointer' ? 'pointer' : 'prompt'); }
    } else if (resumeOnShow) {
      resumeOnShow = false;
      if (phase === 'camera' || phase === 'calibrating') T.start().then(() => { setFace(false); settleLook(); }, () => { if (phase === 'camera' || phase === 'calibrating') fallback(); });
      else if (phase === 'prompt') startCamera(prefs.input);
    }
  });

  // ---- The test hook.
  window.__nod = {
    boards: Boards,
    get board() { return current.id; },
    get state() { return { level: place.level, row: place.row, col: place.col, hits, par, solved, hint, busy, history: history.length }; },
    get finished() { return [...finished]; },
    get payoff() { return { ...stats, kinds: stats.kinds.slice(), painted, palette: Boards.indexOf(current) % 6, stops: stops().map(c => c.slice()), audio: audio.created, sounds: audio.count, rewards: prefs.rewards, sound: prefs.sound }; },
    get input() { return { phase, mode: prefs.input, select: prefs.select, hold: prefs.hold, camera: { ...T.status(), virtual }, face, calibrating: calib && { step: calib.step, of: calib.spots.length, progress: calib.progress, full: calib.full }, gesture: { phase: gesture.phase, reason: gesture.reason, point: gesture.point, shown: gesture.shown, offset: gesture.offset }, gaze: gaze && { ...gaze }, current: dwell.current && dwell.current.id, blocked: dwell.blocked, rings: dwell.rings(), calibration: JSON.parse(JSON.stringify(calibration)) }; },
    tilt: dir => handTip(dir), undo, restart, go, next, hint: armHint,
    geometry() {
      const n = nextTarget(), m = marbleScreen(), c = centre();
      return { scale: geo.scale, cell: geo.cell, band: geo.band, dead: geo.dead, rail: geo.rail, rest: { ...geo.rest }, glyph: { cx: c.cx, cy: c.cy, r: geo.rv }, corners: geo.corners.map(x => ({ ...x })), pads: geo.pads.map(x => ({ ...x })), next: n, camera: glyphTarget(), marble: m, tray: trayScreen(place.level), trays: { ...geo.trays }, spots: G.SPOTS.map(p => toScreen(p.u, p.v)) };
    },
    toScreen, targetAt: (x, y) => { const t = targetAt(x, y); return t && t.id; },
    // Synthetic input for tests: a face reading through the whole pipeline; a
    // head point straight into the tilt recogniser; a page point straight
    // into look and hold; and a camera with no stream, with the same phases.
    face: (result, t) => processFace(result, t),
    point: (x, y, t) => { if (headOn()) feedHead(t, x === null ? null : { x, y }); },
    look: (x, y, t) => { if (lookOn() || phase === 'prompt') feedLook(t, x, y); },
    simulate(mode, { full = true } = {}) { virtual = true; showLive(true); prefs.input = mode; lastCamera = mode; save(); beginCalibration(full || !G.current(calibration[mode])); },
    calibrate: full => beginCalibration(full)
  };
  window.__minimalize = { bounds() {
    // The trays' outer frames are the outermost lines drawn; add their half-pixel hairline.
    const rects = [...boardNode.querySelectorAll('.tray-frame')].map(n => n.getBoundingClientRect());
    const x = Math.min(...rects.map(r => r.left)), y = Math.min(...rects.map(r => r.top)), r = Math.max(...rects.map(r => r.right)), b = Math.max(...rects.map(r => r.bottom));
    return { x: x - .5, y: y - .5, width: r - x + 1, height: b - y + 1 };
  } };

  applyPrefs(); fit(); draw(); refresh(); save();
  // The shared control frame and the fonts may settle the page after this
  // first layout; measure again once they have.
  addEventListener('load', () => { fit(); refresh(); });
  // A camera player is asked once per visit with one glyph; a camera already
  // allowed starts by itself, and a refused one leaves play to the pointer.
  if (prefs.input === 'pointer') setPhase('pointer');
  else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { prefs.input = 'pointer'; save(); setPhase('pointer'); }
  else { setPhase('prompt'); permission().then(state => { if (phase !== 'prompt') return; if (state === 'granted') startCamera(prefs.input); else if (state === 'denied') fallback(); }); }
})();
