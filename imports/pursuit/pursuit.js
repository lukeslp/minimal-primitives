/* Pursuit. By Luke Steuber. */
(function () {
  'use strict';
  const E = PursuitEngine, boards = PursuitBoards, G = PursuitGaze, T = PursuitTrack, PO = PursuitPayoff;
  const $ = s => document.querySelector(s), KEY = 'pursuit.v1', TAU = Math.PI * 2;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = E.clamp, smooth = E.smooth, INPUTS = ['head', 'eyes', 'pointer'];
  // A chosen target settles into its socket over SETTLE ms; a target undone
  // glides back onto its path over E.GLIDE; the trail reaches back TRAIL ms.
  const SETTLE = 320, TRAIL = 900, FADE = 420;
  // The least spread that counts as moving: pixels for a pointer, and
  // pixels' worth (through the gain learned by following a dot) for the camera.
  const POINTER_FLOOR = 2, CAMERA_FLOOR = 3, TUNE_FLOOR = { head: .004, eyes: .008 };
  // The dot followed once to learn which way the camera's readings run.
  const TUNE_PATH = ['o', 1, 1, 0, 1, 2600, 0];

  // ---- The save: the board, its fills, crosses and undo history, choices,
  // finished boards, settings, and for each camera mode the tuning (sign and
  // gain per axis) and the five-dot calibration of the gaze dot.
  let board = boards[0], state = E.start(), hits = 0, finished = new Set();
  let prefs = { theme: 'system', motion: 'system', input: 'head', rewards: 'colour', sound: 'off' };
  let tuning = { head: null, eyes: null }, calibration = { head: null, eyes: null }, lastCamera = 'head', protectSave = false;
  const indexList = (a, b) => Array.isArray(a) && a.length <= b.targets.length && a.every(i => Number.isInteger(i) && i >= 0 && i < b.targets.length) && new Set(a).size === a.length;
  const validState = (s, b) => !!s && indexList(s.filled, b) && indexList(s.crossed, b) && s.filled.every(i => b.targets[i].mark) && !s.filled.some(i => s.crossed.includes(i));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(x => x.id === s?.board);
      if (!b || s.v !== 1 || !validState(s.state, b) || !Array.isArray(s.state.history) || s.state.history.length > 2000 || !s.state.history.every(h => validState(h, b))) throw Error('Invalid save');
      if (!Number.isSafeInteger(s.hits) || s.hits < 0 || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id))) throw Error('Invalid save');
      if (!s.settings || !['system', 'light', 'dark'].includes(s.settings.theme) || !['system', 'reduce'].includes(s.settings.motion) || !INPUTS.includes(s.settings.input) || !['head', 'eyes'].includes(s.lastCamera)) throw Error('Invalid save');
      if (![undefined, 'colour', 'calm'].includes(s.settings.rewards) || ![undefined, 'off', 'on'].includes(s.settings.sound)) throw Error('Invalid save');
      // A tuning or calibration that does not read is dropped on its own (it is
      // asked for again); it used to discard the whole save, boards and all.
      if (!s.tuning || typeof s.tuning !== 'object') s.tuning = { head: null, eyes: null };
      if (!s.calibration || typeof s.calibration !== 'object') s.calibration = { head: null, eyes: null };
      for (const k of ['head', 'eyes']) {
        if (!(s.tuning[k] === null || G.validTuning(s.tuning[k]))) s.tuning[k] = null;
        if (!(s.calibration[k] === null || (G.validCalibration(s.calibration[k]) && s.calibration[k].kind === k))) s.calibration[k] = null;
      }
      board = b; state = { filled: s.state.filled.slice(), crossed: s.state.crossed.slice(), history: s.state.history.map(h => ({ filled: h.filled.slice(), crossed: h.crossed.slice() })) };
      hits = s.hits; finished = new Set(s.finished); prefs = { theme: s.settings.theme, motion: s.settings.motion, input: s.settings.input, rewards: s.settings.rewards || 'colour', sound: s.settings.sound || 'off' };
      tuning = { head: s.tuning.head, eyes: s.tuning.eyes }; calibration = { head: s.calibration.head, eyes: s.calibration.eyes }; lastCamera = s.lastCamera;
    }
  } catch (_) { protectSave = true; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, board: board.id, state, hits, finished: [...finished], settings: prefs, tuning, calibration, lastCamera })); } catch (_) {}
  }
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  const solved = () => E.solved(board, state), last = () => boards.indexOf(board) === boards.length - 1;
  function announce(text) { $('#announcement').textContent = text; }

  // ---- Board time. Every path is a function of time since the board began
  // (`epoch`); a change of stage records when and from which stage, so paths
  // blend into their new shapes. `settles` holds targets moving to or from
  // their sockets: chosen ones settling, undone ones gliding back.
  let epoch = performance.now(), change = null;
  const settles = new Map();
  function begin(t = performance.now()) { epoch = t; change = null; settles.clear(); blooms.length = 0; finale = null; hint = null; focus = 0; selectorsReset(); }
  // The rewards: blooms where rings were caught, the finished picture's
  // colour wave and ring, and sound when chosen.
  const blooms = [], audio = PO.sound();
  let finale = null, bloomsFired = 0;
  const colourful = () => prefs.rewards === 'colour';
  const stops = () => PO.paletteFor(boards.indexOf(board) + 1, dark());

  // ---- Layout. The board is as large as fits between the header and the
  // toolbar, by height as well as width, as in Glance. Its box covers every
  // path's reach plus a ring's radius and its rings, and ring and path grow
  // together with the cell, so speeds in cells a second stay as tuned. A thin
  // band at the page's sides, where trackers are weakest, stays clear, and so
  // does room for the Next disc and its drift: below the board, or beside it
  // when the toolbar stands at the side. With the camera on, the toolbar's own
  // Undo grows to a sixth of the short side and its glyph orbits inside it.
  const node = $('#board'), canvas = $('#scene'), ctx = canvas.getContext('2d');
  const GAP = 12, NEXT_ROOM = 64 + 2 * 18 + 16, RING = .13;
  const geo = { s: 60, rt: 10, ox: 0, oy: 0, band: 16, rect: null, area: null, next: null, undo: null };
  const extents = new Map(), extentOf = b => { if (!extents.has(b.id)) extents.set(b.id, E.extent(b)); return extents.get(b.id); };
  const railMode = () => matchMedia('(max-height:520px) and (min-width:560px)').matches;
  const toolSize = () => clamp(Math.round(Math.min(innerWidth, innerHeight) / 6), 64, 160);
  const following = () => ['starting', 'tuning', 'calibrating', 'camera'].includes(phase);
  let dpr = 1;
  function fit() {
    const short = Math.min(innerWidth, innerHeight), band = Math.max(10, Math.round(short * .03));
    document.body.dataset.look = following() ? 'follow' : 'plain'; document.body.style.setProperty('--tool', toolSize() + 'px');
    const tools = [...document.querySelectorAll('.toolbar button')].filter(n => n.offsetParent !== null).map(n => n.getBoundingClientRect()), rail = railMode() && tools.length > 0;
    let right = innerWidth - band, bottom = innerHeight - band;
    if (rail) right = Math.min(right, Math.min(...tools.map(r => r.left)) - GAP - NEXT_ROOM);
    else if (tools.length) bottom = Math.min(bottom, Math.min(...tools.map(r => r.top)) - GAP - NEXT_ROOM);
    // Either below the restart button across the page's width, or higher,
    // just below the readout, kept in from the restart button on both sides.
    const [ex, ey] = extentOf(board), spanX = board.cols - 1 + 2 * ex, spanY = board.rows - 1 + 2 * ey;
    const restart = $('#restart-btn').getBoundingClientRect(), readout = $('#readout').getBoundingClientRect(), inset = Math.max(band, restart.right + 6);
    // Box = span × cell + 2 × (ring + 10), the ring a fixed share of the cell but never under 8 px.
    const along = (room, span) => { const c = (room - 20) / (span + 2 * RING); return c * RING >= 8 ? c : (room - 36) / span; };
    const size = (l, r, t) => Math.min(along(r - l, spanX), along(bottom - t, spanY));
    const wide = { left: band, right, top: Math.max(band, restart.bottom + GAP) }, high = { left: inset, right: Math.min(right, innerWidth - inset), top: Math.max(band, readout.bottom + 6) };
    const pick = size(high.left, high.right, high.top) > size(wide.left, wide.right, wide.top) ? high : wide;
    const s = Math.max(24, Math.floor(size(pick.left, pick.right, pick.top) * 2) / 2), rt = Math.max(8, s * RING), m = rt + 10;
    geo.area = { x: pick.left, y: pick.top, w: pick.right - pick.left, h: bottom - pick.top };
    Object.assign($('#board-shell').style, { top: pick.top + 'px', left: pick.left + 'px', right: innerWidth - pick.right + 'px', bottom: innerHeight - bottom + 'px' });
    node.style.width = Math.floor(spanX * s + 2 * m) + 'px'; node.style.height = Math.floor(spanY * s + 2 * m) + 'px';
    const r = node.getBoundingClientRect();
    Object.assign(geo, { s, rt, band, ox: r.left + m + ex * s, oy: r.top + m + ey * s, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } });
    dpr = Math.min(3, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    placeGlyph(); geo.next = null; geo.undo = null; cands = null;
  }
  const rectOf = n => { const b = n.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
  function obstacles() {
    const list = [...document.querySelectorAll('.toolbar button, #restart-btn, #readout, #live:not([hidden])')].filter(n => n.getClientRects().length).map(rectOf);
    return list;
  }
  // The toolbar's Undo as a follow target: while the camera is on and there is
  // something to undo, its glyph orbits inside its own (grown) slot on the
  // undo path, and following the glyph chooses it. A tap or click works too.
  function undoTool() {
    if (!following() || !state.history.length) return null;
    if (geo.undo) return geo.undo;
    const n = $('#undo-btn'); if (n.disabled || !n.getClientRects().length) return null;
    const b = n.getBoundingClientRect(), d = Math.min(b.width, b.height); if (!d) return null;
    return (geo.undo = { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: d / 2, o: Math.max(4, d / 2 - d * .18 - 4) });
  }
  // The Next disc is the shared frame's; it drifts on a small orbit by its
  // own `translate`, measured from where the frame put it, as large as the room allows.
  let nextShift = [0, 0], nextShown = 0;
  function measureNext() {
    const n = $('#next-btn'); if (n.hidden || !n.getClientRects().length) { geo.next = null; return; }
    const r = n.getBoundingClientRect(); if (!r.width) { geo.next = null; return; }
    const R = r.width / 2, cx = r.left + R - nextShift[0], cy = r.top + R - nextShift[1], b = geo.rect, obs = obstacles();
    let room = Math.min(cx - R - geo.band, innerWidth - geo.band - cx - R, cy - R - geo.band, innerHeight - 4 - cy - R);
    const gapTo = rr => Math.max(rr.left - cx, cx - rr.right, rr.top - cy, cy - rr.bottom) - R;
    room = Math.min(room, gapTo(b), ...obs.map(gapTo));
    geo.next = { cx, cy, r: R, o: clamp(room - 6, 4, 28), at: performance.now() };
  }
  const socketPx = i => [geo.ox + board.targets[i].at[0] * geo.s, geo.oy + board.targets[i].at[1] * geo.s];
  // Where target i is at page time t, in pixels.
  function targetAt(i, t) {
    const [sx, sy] = socketPx(i), st = settles.get(i), at = !state.filled.includes(i) && !state.crossed.includes(i) && !solved();
    if (!at) {
      if (st && !st.back && !reduced()) { const f = smooth((t - st.at) / SETTLE); if (f < 1) return [st.from[0] + (sx - st.from[0]) * f, st.from[1] + (sy - st.from[1]) * f]; }
      return [sx, sy];
    }
    const q = E.offset(board, i, E.stage(state), t - epoch, change), x = sx + q[0] * geo.s, y = sy + q[1] * geo.s;
    if (st && st.back && !reduced()) { const f = smooth((t - st.at) / E.GLIDE); if (f < 1) return [sx + (x - sx) * f, sy + (y - sy) * f]; }
    return [x, y];
  }
  const padAt = t => { const u = undoTool(); if (!u) return [0, 0]; const q = E.local(board.pad, t - epoch); return [u.cx + u.o * q[0], u.cy + u.o * q[1]]; };
  const nextAt = t => { const n = geo.next; if (!n) return [0, 0]; const q = E.local(board.next, t - epoch); return [n.cx + n.o * q[0], n.cy + n.o * q[1]]; };
  const nextLive = () => { if (!solved() || last() || $('#next-btn').hidden) return false; if (!geo.next) measureNext(); return !!geo.next; };
  // The things that can be chosen by following now: targets still moving,
  // the toolbar's Undo (with the camera on) once a choice stands, Next once
  // the picture is finished.
  let cands = null;
  function candidates() {
    if (cands) return cands;
    const list = [];
    for (const i of E.contention(board, state)) list.push({ id: i, at: t => targetAt(i, t) });
    if (undoTool()) list.push({ id: 'undo', at: padAt });
    if (nextLive()) list.push({ id: 'next', at: nextAt });
    return (cands = list);
  }

  // ---- Choosing. Every target chosen and every undo is a hit; Next is not.
  let hint = null, focus = 0, keyboard = false;
  // A choice made by following; a click on the same button straight after it does nothing more.
  // It counts as the same click only while nothing else has changed since.
  let lastFollow = { id: null, at: -Infinity, sig: '' };
  const signature = () => board.id + ':' + state.history.length + ':' + state.filled.length + ':' + state.crossed.length;
  const justFollowed = id => lastFollow.id === id && performance.now() - lastFollow.at < 800 && lastFollow.sig === signature();
  function apply(id, t = performance.now()) {
    if (id === 'next') next(); else if (id === 'undo') undo(t); else chooseTarget(id, t);
    lastFollow = { id, at: performance.now(), sig: signature() };
  }
  function chooseTarget(i, t = performance.now()) {
    if (!E.contention(board, state).includes(i)) return false;
    const from = targetAt(i, t), k = E.stage(state), wasOpen = E.open(board, state).includes(i);
    state = E.choose(board, state, i); hits++;
    change = { at: t - epoch, from: k };
    settles.set(i, { at: t, from, back: false });
    // A ring caught blooms where it was caught; a cross gets no bloom.
    if (wasOpen) {
      bloomsFired++;
      if (colourful()) PO.bloom(blooms, from[0], from[1], t, geo.s, stops(), i * .7, i);
      if (prefs.sound === 'on') audio.tick(state.filled.length - 1);
    }
    if (solved()) {
      finished.add(board.id);
      const [ox, oy] = socketPx(i);
      finale = PO.solve(t, ox, oy, state.filled.map(j => { const [x, y] = socketPx(j); return { id: j, x, y }; }), stops());
      if (prefs.sound === 'on') audio.chord();
      // The decoys stop and settle into their sockets; only the picture remains.
      for (const j of board.targets.keys()) if (!state.filled.includes(j) && !state.crossed.includes(j)) settles.set(j, { at: t, from: targetAtMoving(j, t, k), back: false, fade: true });
    }
    if (hint === i) hint = null;
    afterChange(t);
    const left = E.par(board) - state.filled.length;
    if (solved()) announce(`Picture finished in ${hits} choices. Par ${E.par(board)}. ${last() ? 'Every board is finished.' : 'Next board is open; follow or press Next.'}`);
    else if (wasOpen) announce(`Filled. ${left} ${left === 1 ? 'ring' : 'rings'} left.`);
    else announce('Crossed out. Undo takes it back.');
    return true;
  }
  // A target's place on its path before the stage changed (for the finishing settle).
  function targetAtMoving(i, t, k) { const [sx, sy] = socketPx(i), q = E.offset(board, i, k, t - epoch, null); return [sx + q[0] * geo.s, sy + q[1] * geo.s]; }
  function undo(t = performance.now()) {
    if (!state.history.length) { announce('Nothing to undo.'); return; }
    const k = E.stage(state), before = state;
    state = E.undo(state); hits++; finale = null;
    change = { at: t - epoch, from: k };
    // The target taken back glides from its socket onto its path; decoys that had settled start again.
    for (const i of board.targets.keys()) if ((before.filled.includes(i) || before.crossed.includes(i) || E.solved(board, before)) && E.contention(board, state).includes(i)) settles.set(i, { at: t, back: true });
    hint = null; afterChange(t);
    announce(`Undone. ${hits} choices.`);
  }
  function afterChange(t) {
    cands = null; selectorsReset();
    if (focus >= E.contention(board, state).length) focus = 0;
    chrome(); save();
  }
  function go(id) {
    const b = boards.find(x => x.id === id); if (!b) return false;
    board = b; state = E.start(); hits = 0; begin(); fit(); chrome(); save();
    announce(`Board ${boards.indexOf(board) + 1}. ${E.par(board)} ${E.par(board) === 1 ? 'ring' : 'rings'} among ${board.targets.length} moving targets.`);
    return true;
  }
  function restart() { state = E.start(); hits = 0; begin(); fit(); chrome(); save(); announce('Board restarted.'); }
  function next() { const b = boards[boards.indexOf(board) + 1]; if (b && solved()) return go(b.id); return false; }
  // Hint: the first press marks what a perfect run follows next (the undo pad
  // while a cross stands); the second takes it, as one choice.
  function hintPress() {
    if (solved()) return;
    const want = E.hint(board, state);
    if (hint !== null && hint === want) { if (want === 'undo') undo(); else chooseTarget(want); hint = null; chrome(); return; }
    hint = want; chrome();
    announce(want === 'undo' ? 'Hint: undo. Hint again takes it.' : 'Hint: the marked ring. Hint again takes it.');
  }

  // ---- Chrome.
  function chrome() {
    const i = boards.indexOf(board), done = solved(), K = E.par(board), moving = E.contention(board, state).length;
    $('#readout').textContent = `${i + 1} / ${boards.length} · ${hits} / ${K}`;
    $('#readout').setAttribute('aria-label', `Board ${i + 1} of ${boards.length}; ${hits} choices; par ${K}`);
    node.setAttribute('aria-label', `Board ${i + 1} of ${boards.length}: ${state.filled.length} of ${K} rings filled${state.crossed.length ? ', ' + state.crossed.length + ' crossed out' : ''}, ${moving} moving. ${done ? 'Picture finished.' : 'Follow a ring with your eyes, head or pointer, or choose with the arrows and Enter.'}`);
    if ($('#undo-btn').disabled !== (state.history.length === 0)) { $('#undo-btn').disabled = state.history.length === 0; geo.undo = null; cands = null; }
    $('#hint-btn').disabled = done;
    const showNext = done && !last();
    if ($('#next-btn').hidden === showNext) { $('#next-btn').hidden = !showNext; geo.next = null; nextShown = performance.now(); if (!showNext) { nextShift = [0, 0]; $('#next-btn').style.translate = ''; } cands = null; }
    const on = ['starting', 'tuning', 'calibrating', 'camera'].includes(phase);
    $('#camera-btn').setAttribute('aria-pressed', String(on)); $('#camera-btn').setAttribute('aria-label', on ? 'Stop the camera' : 'Start the camera');
    $('#calibrate').disabled = prefs.input === 'pointer';
    $('#input').value = prefs.input;
    catalog(); placeGlyph();
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

  // ---- Input. `phase` is where the player is: the camera's first screen
  // (prompt), the camera starting, following the tuning dot, the five-dot
  // calibration of the gaze dot, playing by camera, or by pointer.
  let phase = 'pointer', calib = null, tune = null, face = false, gaze = null, resumeOnShow = false, virtual = false;
  const pointer = { x: 0, y: 0, present: false };
  const pointerSel = E.selector({ floor: POINTER_FLOOR });
  let cameraSel = E.selector({ floor: CAMERA_FLOOR, gap: 300 }), tuneSel = null;
  function selectorsReset() { pointerSel.reset(); cameraSel.reset(); }
  const filters = () => prefs.input === 'eyes' ? [G.oneEuro({ minCutoff: .45, beta: .35 }), G.oneEuro({ minCutoff: .45, beta: .35 })] : [G.oneEuro({ minCutoff: .8, beta: .6 }), G.oneEuro({ minCutoff: .8, beta: .6 })];
  let [fu, fv] = filters();
  const pointerChooses = () => phase === 'pointer' || phase === 'camera' || phase === 'prompt';
  // The camera glyph stands in the rest area below the board, centred between
  // the board and the toolbar (beside the board when the toolbar is a side
  // rail), sized to the gap; a pointer resting on it starts the camera too.
  function placeGlyph() {
    const n = $('#camera-start'); if (n.hidden || !geo.rect) return;
    const b = geo.rect, tools = [...document.querySelectorAll('.toolbar button')].filter(x => x.offsetParent !== null).map(x => x.getBoundingClientRect());
    const rail = matchMedia('(max-height:520px) and (min-width:560px)').matches && tools.length;
    let x, y, room;
    if (rail) { const left = Math.min(...tools.map(r => r.left)); x = (b.right + left) / 2; y = (Math.max(0, b.top) + Math.min(innerHeight, b.bottom)) / 2; room = left - b.right; }
    else { const top = tools.length ? Math.min(...tools.map(r => r.top)) : innerHeight - geo.band; x = b.left + b.width / 2; y = (b.bottom + top) / 2; room = top - b.bottom; }
    let d = clamp(Math.floor(room - 24), 64, 132);
    // With Next waiting, the glyph stands beside it, clear of its drift.
    if (!$('#next-btn').hidden) { d = Math.min(d, 96); const off = 32 + 28 + 14 + d / 2; if (rail) y = Math.max(geo.band + d / 2, y - off); else x = Math.max(geo.band + d / 2, x - off); }
    Object.assign(n.style, { left: Math.round(x - d / 2) + 'px', top: Math.round(y - d / 2) + 'px', width: d + 'px', height: d + 'px' });
    n.style.setProperty('--glyph-icon', Math.round(d * .4) + 'px');
  }
  function glyphTarget() { const n = $('#camera-start'); if (n.hidden) return null; const b = n.getBoundingClientRect(); return { id: 'camera', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 }; }
  const glyphDwell = G.dwell({ time: 800, targets: (x, y) => { const g = phase === 'prompt' && !$('dialog[open]') ? glyphTarget() : null; return g && Math.hypot(x - g.cx, y - g.cy) <= g.r ? g : null; }, holds: (t, x, y) => { const g = phase === 'prompt' && !$('dialog[open]') ? glyphTarget() : null; return !!g && Math.hypot(x - g.cx, y - g.cy) <= g.r + 10; } });
  function setPhase(nextPhase) {
    phase = nextPhase; document.body.dataset.phase = nextPhase; fit();
    $('#camera-start').hidden = !(nextPhase === 'prompt' || nextPhase === 'starting'); placeGlyph();
    gaze = null; glyphDwell.reset(); selectorsReset();
    if (nextPhase !== 'camera' && nextPhase !== 'calibrating' && nextPhase !== 'tuning') setFace(false);
    chrome();
  }
  function setFace(on) { face = on; $('#live').dataset.face = on ? 'seen' : 'none'; }
  function showLive(on) { $('#live').hidden = !on; document.body.dataset.camera = on ? 'on' : 'off'; }
  T.onStream = on => showLive(on || virtual);
  T.onResult = (result, t) => processFace(result, t);
  // Each camera reading: the face's turn (head) or look (eyes), smoothed, then
  // the tuning dot, the calibration, or, through the learned signs and gains,
  // a sample in pixels' worth for the camera's selector.
  // Flipped for a player who chose Up and down: Flipped, which every game on
  // this site shares.
  const lookOptions = () => { let invertY = false; try { invertY = localStorage.getItem('minimal-gaze.v1:invert-y') === '1'; } catch (_) {} return { invertY }; };
  function processFace(result, t) {
    if (phase !== 'camera' && phase !== 'calibrating' && phase !== 'tuning') return;
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    setFace(!!lm);
    if (!lm) { if (phase === 'calibrating') calibrate(t, null); else if (phase === 'tuning') tuneSel.sample(t, null, null, []); else cameraSel.sample(t, null, null, []); return; }
    const aspect = virtual ? 4 / 3 : T.aspect(), mode = prefs.input === 'pointer' ? lastCamera : prefs.input;
    const f = mode === 'eyes' ? G.lookAngles(lm, aspect) : G.headPose(lm, result.facialTransformationMatrixes && result.facialTransformationMatrixes[0], aspect);
    if (phase === 'calibrating') { calibrate(t, f); return; }
    const x = fu.filter(mode === 'eyes' ? f.ax : f.yaw, t), y = fv.filter(mode === 'eyes' ? f.ay : f.pitch, t);
    if (phase === 'tuning') { tuneSample(t, x, y, mode); return; }
    const cal = calibration[mode];
    const o = lookOptions();
    if (cal) { const m = mode === 'eyes' ? G.eyesMap(cal, { ax: x, ay: y }, o) : G.headMap(cal, { yaw: x, pitch: y }, o), p = toScreen(m.u, m.v); gaze = { x: clamp(p.x, 0, innerWidth), y: clamp(p.y, 0, innerHeight) }; }
    const tn = tuning[mode]; if (!tn) return;
    const got = cameraSel.sample(t, tn.sx * x / tn.gx, (o.invertY ? -1 : 1) * tn.sy * y / tn.gy, candidates());
    if (got !== null) apply(got, t);
  }
  // Page units to pixels: -1 to 1 across the reach inside the outer band.
  function toScreen(u, v) { const x0 = geo.band, x1 = innerWidth - geo.band, y0 = geo.band, y1 = innerHeight - geo.band; return { x: (x0 + x1) / 2 + u * (x1 - x0) / 2, y: (y0 + y1) / 2 + v * (y1 - y0) / 2 }; }
  // The tuning dot circles the middle of the board; followed until its trail
  // fills, it shows which way the camera's readings run and how far.
  function tuneCentre() { const b = geo.rect; return { cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2, r: Math.max(48, Math.min(b.width, b.height, innerWidth, innerHeight) * .3) }; }
  const tuneAt = t => { const c = tuneCentre(), q = E.local(TUNE_PATH, t - tune.at); return [c.cx + c.r * q[0], c.cy + c.r * q[1]]; };
  function beginTuning(full = false) {
    const mode = prefs.input === 'pointer' ? lastCamera : prefs.input;
    tune = { at: performance.now(), full, mode }; tuneSel = E.selector({ signed: false, gain: null, ratio: null, coupling: null, speed: null, floor: TUNE_FLOOR[mode], gap: 300 });
    [fu, fv] = filters(); setPhase('tuning'); announce('Follow the circling dot with your ' + (mode === 'eyes' ? 'eyes' : 'head') + '.');
  }
  function tuneSample(t, x, y, mode) {
    const got = tuneSel.sample(t, x, y, [{ id: 'tune', at: tuneAt }]);
    if (got === null) return;
    const s = tuneSel.signs, g = tuneSel.gains, made = { sx: s[0], sy: s[1], gx: g[0], gy: g[1], ...(mode === 'eyes' ? { e: 2 } : {}) };
    if (!G.validTuning(made)) { tuneSel.reset(); return; }
    tuning[mode] = made; save();
    const full = tune.full; tune = null;
    if (full) beginCalibration(); else { setPhase('camera'); announce('Camera ready. Follow a ring.'); }
  }
  // The five-dot calibration of the gaze dot, as in Glance: a dot appears and
  // its ring fills while the player holds still looking at it.
  function beginCalibration() {
    const mode = prefs.input === 'pointer' ? lastCamera : prefs.input;
    calib = { mode, spots: [0, 1, 2, 3, 4], step: 0, window: [], captured: [], progress: 0, last: null };
    setPhase('calibrating'); announce('Look at each dot in turn and hold still.');
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
  }
  function finishCalibration() {
    const { mode, captured } = calib, made = mode === 'head' ? G.headCalibration(captured) : G.eyesCalibration(captured);
    if (!made) {
      // Twice in a row is enough: a player who cannot hold the dots is not
      // kept in calibration for ever.
      if (++calFails >= 2) { calFails = 0; T.stop(); virtual = false; showLive(false); calib = null; setPhase('pointer'); announce('Calibration did not take. Play by pointer; the camera button tries again.'); return; }
      beginCalibration(); announce('Again: look at each dot and hold still.'); return;
    }
    calFails = 0;
    calibration[mode] = made; calib = null; save();
    [fu, fv] = filters(); setPhase('camera'); announce('Camera ready, with the gaze dot. Follow a ring.');
  }
  const permission = async () => { try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch (_) { return 'unknown'; } };
  // Start the camera for head or eyes. Refused or unavailable, play goes on by pointer.
  async function startCamera(mode, { full = false } = {}) {
    if (phase === 'starting') return;
    prefs.input = mode; lastCamera = mode; save();
    if (virtual || T.running) { afterStart(full); return; }
    setPhase('starting');
    try { await T.start(); }
    catch (_) { if (phase === 'starting') fallback(); return; }
    if (phase !== 'starting') return;
    afterStart(full);
  }
  // An eyes tuning from before the eyes' up and down were measured from the
  // corners runs on a different scale, so it is learned again once.
  function afterStart(full) { [fu, fv] = filters(); const tn = tuning[prefs.input]; if (full || !tn || (prefs.input === 'eyes' && tn.e !== 2)) beginTuning(full); else setPhase('camera'); }
  // The camera lost mid-play: play goes on by pointer, and the player's choice
  // of camera is kept, so the camera button or the next visit picks it up.
  T.onLost = () => { if (phase !== 'camera' && phase !== 'calibrating') return; virtual = false; showLive(false); calib = null; tune = null; setPhase('pointer'); announce('The camera stopped. Play by pointer; the camera button tries again.'); };
  let calFails = 0;
  function fallback() {
    T.stop(); virtual = false; showLive(false); calib = null; tune = null; prefs.input = 'pointer'; save(); setPhase('pointer');
    announce('Camera unavailable. Play by pointer; the camera button tries again.');
  }
  function stopCamera() {
    T.stop(); virtual = false; showLive(false); calib = null; tune = null; resumeOnShow = false;
    if (prefs.input !== 'pointer') lastCamera = prefs.input;
    prefs.input = 'pointer'; save(); setPhase('pointer'); announce('Camera off. Playing by pointer.');
  }
  function toPointer() { if (phase !== 'prompt') return; prefs.input = 'pointer'; save(); setPhase('pointer'); }

  // ---- Drawing. One canvas over the page: the picture's lines and sockets,
  // the targets, the trail of the one being followed, hint and focus rings,
  // the undo pad, and the camera's dots.
  let ink = '#000', paper = '#fff', faint = '#c4c4c4', decoy = '#8f8f8f', sub = '#5e5e5e';
  function colours() { const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d; ink = v('--ink', '#000'); paper = v('--bg', '#fff'); faint = v('--faint', '#c4c4c4'); decoy = v('--decoy', '#8f8f8f'); sub = v('--sub', '#5e5e5e'); }
  function circle(x, y, r, width, colour, alpha = 1, dash = null) { ctx.globalAlpha = alpha; ctx.strokeStyle = colour; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(x, y, Math.max(.1, r), 0, TAU); ctx.stroke(); if (dash) ctx.setLineDash([]); }
  function disc(x, y, r, colour, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, Math.max(.1, r), 0, TAU); ctx.fill(); }
  function line(x1, y1, x2, y2, width, colour, alpha = 1, dash = null) { ctx.globalAlpha = alpha; ctx.strokeStyle = colour; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); if (dash) ctx.setLineDash([]); }
  // A soft trail behind whatever is being followed, back along its own path,
  // as long as the selector's confidence: full when it is chosen. It is one
  // ribbon tapering to a point, filled once, so nothing overlaps itself.
  function trail(at, now, confidence, width) {
    const length = confidence * TRAIL; if (length < 30) return;
    const n = 28, pts = [], left = [], right = [];
    for (let k = 0; k <= n; k++) pts.push(at(now - length * k / n));
    for (let k = 0; k <= n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n, k + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, w = width / 2 * (1 - k / n) ** .8;
      left.push([pts[k][0] - dy / d * w, pts[k][1] + dx / d * w]); right.push([pts[k][0] + dy / d * w, pts[k][1] - dx / d * w]);
    }
    ctx.globalAlpha = .12 + .16 * confidence; ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]);
    for (let k = 1; k <= n; k++) ctx.lineTo(left[k][0], left[k][1]);
    for (let k = n; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', camera: 'M3 8h4l2-3h6l2 3h4v11H3ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' };
  const undoIcon = new Path2D(icons.undo);
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const rt = geo.rt, done = solved(), open = new Set(E.open(board, state)), filled = new Set(state.filled), crossed = new Set(state.crossed), moving = new Set(E.contention(board, state));
    const followView = phase === 'camera' ? cameraSel.view : phase === 'tuning' ? null : pointerSel.view;
    // The picture's lines: faint until both ends are filled, then ink; an
    // ordered board's line is dashed until it is drawn.
    for (const [a, b] of board.edges) {
      const [x1, y1] = socketPx(a), [x2, y2] = socketPx(b), both = filled.has(a) && filled.has(b);
      if (both) {
        const sa = settles.get(a), sb = settles.get(b), late = Math.max(sa && !sa.back ? sa.at : 0, sb && !sb.back ? sb.at : 0), f = reduced() ? 1 : smooth((now - late - SETTLE * .5) / SETTLE);
        if (f < 1) line(x1, y1, x2, y2, 1, faint, 1, board.order ? [4, 5] : null);
        const from = sa && sb && sa.at > sb.at ? [x2, y2, x1, y1] : [x1, y1, x2, y2], w = clamp(rt * .18, 2, 2.6);
        line(from[0], from[1], from[0] + (from[2] - from[0]) * f, from[1] + (from[3] - from[1]) * f, w, ink);
        // A finished picture's lines take the colours of their ends once the wave has reached both.
        const c = done && finale && colourful() ? Math.min(PO.filled(finale, a, now, reduced()), PO.filled(finale, b, now, reduced())) : 0;
        if (c > 0) { const g = ctx.createLinearGradient(x1, y1, x2, y2); g.addColorStop(0, finale.colour.get(a)); g.addColorStop(1, finale.colour.get(b)); ctx.globalAlpha = c; ctx.strokeStyle = g; ctx.lineWidth = w + 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
      } else line(x1, y1, x2, y2, board.order ? 1.25 : 1, board.order ? sub : faint, board.order ? .7 : 1, board.order ? [4, 5] : null);
    }
    // Sockets of unfilled marks: small faint points where the rings will rest.
    for (const i of E.marks(board)) if (!filled.has(i)) { const [x, y] = socketPx(i); disc(x, y, 2.5, faint); }
    // The trail of the target (or pad, or Next) being followed.
    if (followView && followView.leader !== null && followView.confidence > .03) {
      const id = followView.leader, at = typeof id === 'number' ? (moving.has(id) ? t => targetAt(id, t) : null) : id === 'undo' ? (undoTool() ? padAt : null) : id === 'next' && geo.next ? nextAt : null;
      if (at) trail(at, now, followView.confidence, typeof id === 'number' ? rt * 1.5 : 14);
    }
    if (tune && phase === 'tuning' && tuneSel.view.leader === 'tune') trail(tuneAt, now, tuneSel.view.confidence, 16);
    // The targets.
    board.targets.forEach((tg, i) => {
      const [x, y] = targetAt(i, now);
      if (filled.has(i)) {
        const st = settles.get(i), f = st && !st.back && !reduced() ? smooth((now - st.at) / SETTLE) : 1;
        if (f < 1) circle(x, y, rt - 1.25, 2.5, ink);
        disc(x, y, rt * (.55 + .45 * f), ink);
        // At the finish each filled ring takes its colour as the wave reaches it.
        const c = done && finale && colourful() ? PO.filled(finale, i, now, reduced()) : 0;
        if (c > 0) disc(x, y, rt * (1 + .14 * c), finale.colour.get(i), c);
        return;
      }
      if (crossed.has(i)) { circle(x, y, rt, 1, faint); const d = rt * .62; line(x - d, y - d, x + d, y + d, 2, ink); line(x - d, y + d, x + d, y - d, 2, ink); return; }
      if (!moving.has(i)) {
        // At the finish the decoys settle into their sockets and fade back.
        const st = settles.get(i), f = st && !reduced() ? clamp((now - st.at) / FADE, 0, 1) : 1;
        disc(x, y, rt * .62, decoy, 1 - .78 * f); return;
      }
      if (!tg.mark) { disc(x, y, rt * .68, decoy); return; }
      if (open.has(i)) circle(x, y, rt - 1.4, clamp(rt * .22, 2.2, 3.2), ink);
      else circle(x, y, rt - 1, 1.3, ink, .8, [3, 3]);
    });
    // Blooms, and the finished picture's ring of colour. With reduced motion a
    // bloom is a short tint on the ring at rest, and no ring spreads.
    if (colourful()) {
      PO.drawBlooms(ctx, blooms, now, reduced(), b => { const [x, y] = board.targets[b.piece] ? socketPx(b.piece) : [b.x, b.y]; return [x, y, rt * 1.05]; });
      if (done) PO.drawRing(ctx, finale, now, reduced(), geo.s);
    } else blooms.length = 0;
    // Hint (dashed) and keyboard focus (solid) rings follow their targets.
    if (hint !== null && hint !== 'undo' && moving.has(hint)) { const [x, y] = targetAt(hint, now); circle(x, y, rt + 7, 1.5, ink, 1, [4, 4]); }
    const order = focusOrder();
    if (keyboard && order.length && document.activeElement === node) { const [x, y] = targetAt(order[focus % order.length], now); circle(x, y, rt + 9, 5, paper, 1); circle(x, y, rt + 9, 2, ink); }
    // A hint for undo rings the toolbar's Undo.
    if (hint === 'undo') { const r = $('#undo-btn').getBoundingClientRect(); if (r.width) circle(r.left + r.width / 2, r.top + r.height / 2, Math.max(r.width, r.height) / 2 + 6, 1.5, ink, 1, [4, 4]); }
    // The tuning dot, the calibration dot and the gaze dot.
    if (phase === 'tuning' && tune) { const [x, y] = tuneAt(now); disc(x, y, 15, paper); disc(x, y, 9, ink); }
    if (phase === 'calibrating' && calib) {
      const at = toScreen(G.SPOTS[calib.spots[calib.step]].u, G.SPOTS[calib.spots[calib.step]].v);
      disc(at.x, at.y, 15, paper); disc(at.x, at.y, 9, ink); circle(at.x, at.y, 26, 7, paper, .9);
      ctx.globalAlpha = 1; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(at.x, at.y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * calib.progress); ctx.stroke(); ctx.lineCap = 'round';
    }
    if (phase === 'camera' && gaze) { disc(gaze.x, gaze.y, 18, ink, .1); disc(gaze.x, gaze.y, 7, paper); circle(gaze.x, gaze.y, 7, 1.5, ink); }
    // A pointer resting on the camera glyph fills a ring round it.
    for (const [id, p] of glyphDwell.rings()) { if (id !== 'camera') continue; const g = glyphTarget(); if (!g) continue; circle(g.cx, g.cy, g.r + 10, 7, paper, .9); ctx.globalAlpha = 1; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke(); ctx.lineCap = 'round'; }
    ctx.globalAlpha = 1;
  }
  const focusOrder = () => { const moving = new Set(E.contention(board, state)); return E.sweep(board).filter(i => moving.has(i)); };
  // Every frame: the Next disc drifts, a present pointer is sampled, and the scene is drawn.
  let frameId = 0, undoMoving = false;
  function loop(now) {
    frameId = requestAnimationFrame(loop);
    if (!$('#next-btn').hidden) {
      // Measured every frame while the shared frame places and grows it in, then twice a second.
      if (!geo.next || now - nextShown < 450 || now - geo.next.at > 500) measureNext();
      if (geo.next) { const [x, y] = nextAt(now); nextShift = [x - geo.next.cx, y - geo.next.cy]; $('#next-btn').style.translate = `${nextShift[0].toFixed(1)}px ${nextShift[1].toFixed(1)}px`; if (!cands || !cands.some(c => c.id === 'next')) cands = null; }
    }
    // With the camera on, the Undo glyph orbits inside its slot while there is anything to undo.
    {
      const u = undoTool(), svg = $('#undo-btn svg');
      if (u && svg) { const q = E.local(board.pad, now - epoch); svg.style.translate = `${(u.o * q[0]).toFixed(1)}px ${(u.o * q[1]).toFixed(1)}px`; undoMoving = true; }
      else if (undoMoving && svg) { svg.style.translate = ''; undoMoving = false; }
    }
    if (!document.hidden) {
      if (phase === 'prompt') for (const g of glyphDwell.sample(now, pointer.present ? pointer.x : null, pointer.present ? pointer.y : null)) if (g.id === 'camera') startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
      if (pointerChooses() && !$('dialog[open]')) {
        const got = pointer.present ? pointerSel.sample(now, pointer.x, pointer.y, candidates()) : pointerSel.sample(now, null, null, []);
        if (got !== null) { if (phase === 'prompt') toPointer(); apply(got, now); }
      }
    }
    draw(now);
  }

  // ---- Pointer, touch and keys. A mouse is sampled wherever it is; a finger
  // or pen only while it touches. Clicks and taps choose nothing on the board;
  // following does.
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && !e.buttons) return;
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true;
  });
  window.addEventListener('pointerdown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.present = true;
    if ($('dialog[open]') || e.target.closest('button,select,a,dialog')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // On the first screen, touching the play means play by touch.
    if (phase === 'prompt' && e.pointerType !== 'mouse') toPointer();
    keyboard = false;
  });
  for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, e => { if (e.pointerType !== 'mouse') pointer.present = false; });
  document.documentElement.addEventListener('pointerleave', () => { pointer.present = false; });
  window.addEventListener('blur', () => { pointer.present = false; });
  for (const name of ['dragstart', 'selectstart', 'contextmenu']) document.addEventListener(name, e => { if (!e.target.closest || !e.target.closest('dialog')) e.preventDefault(); });
  node.addEventListener('focus', () => { keyboard = true; });
  node.addEventListener('blur', () => { keyboard = false; });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape' && ['starting', 'tuning', 'calibrating'].includes(phase)) { e.preventDefault(); stopCamera(); return; }
    if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); if (state.history.length) undo(); return; }
    if (key === 'h') { e.preventDefault(); hintPress(); return; }
    const order = focusOrder();
    if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(key)) {
      e.preventDefault(); if (!order.length) return;
      focus = (focus + (key === 'ArrowLeft' || key === 'ArrowUp' ? order.length - 1 : 1)) % order.length;
      keyboard = true; node.focus({ preventScroll: true });
      const i = order[focus]; announce(`${board.targets[i].mark ? (E.open(board, state).includes(i) ? 'Ring' : 'Waiting ring') : 'Decoy'}, ${focus + 1} of ${order.length}.`);
      return;
    }
    if ((key === 'Enter' || key === ' ') && e.target === node && order.length && !['starting', 'tuning', 'calibrating'].includes(phase)) {
      e.preventDefault(); if (phase === 'prompt') toPointer(); chooseTarget(order[focus % order.length]);
    }
  });

  // ---- Sheets and settings.
  for (const [id, d] of Object.entries(icons)) if (id !== 'camera') $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  $('#camera-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.camera}"/><circle class="lens-dot" cx="12" cy="13" r="1.6"/></svg>`;
  $('#camera-start').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.camera}"/></svg>`;
  $('#undo-btn').onclick = () => { if (justFollowed('undo')) return; if (state.history.length) undo(); };
  $('#restart-btn').onclick = () => restart();
  $('#hint-btn').onclick = () => hintPress();
  $('#next-btn').onclick = () => { if (justFollowed('next')) return; next(); };
  $('#camera-start').onclick = () => startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input);
  $('#camera-btn').onclick = () => { if (['starting', 'tuning', 'calibrating', 'camera'].includes(phase)) stopCamera(); else startCamera(prefs.input === 'pointer' ? lastCamera : prefs.input); };
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').onclick = () => { selectorsReset(); $('#' + id).showModal(); };
    $('#' + id).addEventListener('close', () => { $('#' + id + '-btn').focus(); selectorsReset(); });
  }
  $('#input').onchange = e => {
    const mode = e.target.value;
    if (mode === 'pointer') { if (phase !== 'pointer') stopCamera(); else { prefs.input = 'pointer'; save(); chrome(); } return; }
    $('#settings').close();
    if (['tuning', 'calibrating', 'camera'].includes(phase) && (T.running || virtual)) { prefs.input = mode; lastCamera = mode; save(); afterStart(false); }
    else startCamera(mode);
  };
  // Calibrate: follow the dot again, then the five dots that place the gaze dot.
  $('#calibrate').onclick = () => { $('#settings').close(); if (prefs.input === 'pointer') return; if (['camera', 'tuning', 'calibrating'].includes(phase)) beginTuning(true); else startCamera(prefs.input, { full: true }); };
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.motion = prefs.motion;
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion; $('#rewards').value = prefs.rewards; $('#sound').value = prefs.sound;
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    colours();
  }
  for (const id of ['theme', 'motion']) $('#' + id).onchange = e => { prefs[id] = e.target.value; applyPrefs(); save(); announce(id === 'theme' ? 'Theme changed.' : 'Motion setting changed.'); };
  $('#rewards').onchange = e => { prefs.rewards = e.target.value; save(); announce(prefs.rewards === 'colour' ? 'Colour rewards on.' : 'Calm: paper and ink only.'); };
  // Sound is made only once it is turned on, in the gesture that turns it on.
  $('#sound').onchange = e => { prefs.sound = e.target.value; save(); if (prefs.sound === 'on') audio.start(); announce(prefs.sound === 'on' ? 'Sound on.' : 'Sound off.'); };
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { fit(); selectorsReset(); });
  // A hidden page settles every motion at once and stops the camera; coming
  // back starts it again where play left off.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const [i, st] of settles) st.at = -Infinity;
      if (change) change.at = -Infinity;
      pointer.present = false; selectorsReset();
      if (T.running || phase === 'starting') { resumeOnShow = true; T.stop(); if (phase === 'starting') setPhase(prefs.input === 'pointer' ? 'pointer' : 'prompt'); }
    } else if (resumeOnShow) {
      resumeOnShow = false;
      if (['camera', 'calibrating', 'tuning'].includes(phase)) T.start().then(() => { setFace(false); selectorsReset(); }, () => { if (['camera', 'calibrating', 'tuning'].includes(phase)) fallback(); });
      else if (phase === 'prompt') startCamera(prefs.input);
    }
  });

  // ---- The test hook.
  window.__pursuit = {
    boards,
    get board() { return board.id; },
    get state() { return { filled: state.filled.slice(), crossed: state.crossed.slice(), history: state.history.length, hits, par: E.par(board), solved: solved(), open: E.open(board, state), contention: E.contention(board, state), stage: E.stage(state), hint, focus: focusOrder()[focus] ?? null }; },
    get input() {
      const v = phase === 'camera' ? cameraSel.view : pointerSel.view;
      return { phase, mode: prefs.input, camera: { ...T.status(), virtual }, face, gaze: gaze && { ...gaze }, tuning: JSON.parse(JSON.stringify(tuning)), calibration: JSON.parse(JSON.stringify(calibration)), tuningNow: tune && { leader: tuneSel.view.leader, confidence: tuneSel.view.confidence }, calibrating: calib && { step: calib.step, of: calib.spots.length, progress: calib.progress }, leader: v.leader, confidence: v.confidence, best: v.best, gated: v.gated, scores: Object.fromEntries(v.scores) };
    },
    get epoch() { return epoch; },
    get payoff() { return { blooms: bloomsFired, active: blooms.length, finale: !!finale, colourful: colourful(), audio: audio.created, palette: PO.NAMES[boards.indexOf(board) % 6] }; },
    go: id => go(id), restart, undo: () => undo(), hint: hintPress, next,
    choose: i => chooseTarget(i),
    // Where something is at page time t (now by default): a target by index, 'undo', 'next' or 'tune'.
    where(id, t = performance.now()) {
      if (id === 'undo') { const u = undoTool(); if (!u) return null; const p = padAt(t); return { x: p[0], y: p[1], r: u.r, o: u.o }; }
      if (id === 'next') { if (!geo.next) measureNext(); if (!geo.next) return null; const p = nextAt(t); return { x: p[0], y: p[1], r: geo.next.r, o: geo.next.o }; }
      if (id === 'tune') { if (!tune) return null; const p = tuneAt(t); return { x: p[0], y: p[1], r: 9 }; }
      if (!board.targets[id]) return null; const p = targetAt(id, t); return { x: p[0], y: p[1], r: geo.rt };
    },
    socket: i => { const p = socketPx(i); return { x: p[0], y: p[1] }; },
    geometry() { const box = id => { const b = $('#' + id).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }; return { s: geo.s, rt: geo.rt, band: geo.band, rect: { ...geo.rect }, area: { ...geo.area }, tool: toolSize(), undo: undoTool() && { ...undoTool() }, tools: { undo: box('undo-btn'), hint: box('hint-btn') }, next: geo.next && { ...geo.next }, glyph: glyphTarget(), spots: G.SPOTS.map(p => toScreen(p.u, p.v)) }; },
    // Synthetic input for tests: a pointer sample straight into the pointer's
    // selector, a face reading through the whole camera pipeline, a camera
    // with no stream that goes through the same phases.
    sample(x, y, t) { if (!pointerChooses()) return null; const got = pointerSel.sample(t, x, y, candidates()); if (got !== null) { if (phase === 'prompt') toPointer(); apply(got, t); } return got; },
    face: (result, t) => processFace(result, t),
    simulate(mode, { full = false } = {}) { virtual = true; showLive(true); prefs.input = mode; lastCamera = mode; save(); afterStart(full); },
    calibrate: () => beginCalibration()
  };
  window.__minimalize = { bounds() { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; } };

  applyPrefs(); fit(); begin(); chrome(); save();
  // The shared control frame and the fonts may settle the page after this
  // first layout; measure again once they have.
  addEventListener('load', () => { fit(); });
  // A camera player is asked once per visit with one glyph; a camera already
  // allowed starts by itself, and a refused one leaves play to the pointer.
  if (prefs.input === 'pointer') setPhase('pointer');
  else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { prefs.input = 'pointer'; save(); setPhase('pointer'); }
  else { setPhase('prompt'); permission().then(state => { if (phase !== 'prompt') return; if (state === 'granted') startCamera(prefs.input); else if (state === 'denied') fallback(); }); }
  frameId = requestAnimationFrame(loop);
})();
