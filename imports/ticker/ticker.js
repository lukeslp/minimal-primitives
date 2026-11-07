/* Ticker. By Luke Steuber. */
(function () {
  'use strict';
  const E = TickerEngine, boards = TickerBoards, P = TickerPayoff, $ = s => document.querySelector(s);
  const KEY = 'ticker.v1', TAU = Math.PI * 2;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  // From a choice to the next cycle's first sound; how far ahead sounds are
  // scheduled; how long a lit note lingers after its sound.
  const AFTER = 640, LOOKAHEAD = 120, LINGER = 160;
  const SETTINGS = { hold: ['0', '1000', '1500', '2000'], release: ['0', '100', '250', '500', '1000'], rewards: ['colour', 'calm'], shown: ['on', 'off'], volume: ['quiet', 'normal', 'loud'], split: ['on', 'off'], speed: ['slower', 'normal', 'faster'], adapt: ['on', 'off'], theme: ['system', 'light', 'dark'], motion: ['system', 'reduce'] };
  const VOLUME = { quiet: .35, normal: .7, loud: 1 };
  const LATER = { hold: '1500', release: '0', rewards: 'colour' };

  // Saved play: the board, the notes placed so far, presses, finished
  // boards, settings and the timing learned.
  let board = boards[0], state = E.start(), hits = 0, finished = new Set();
  let prefs = { hold: '1500', release: '0', rewards: 'colour', shown: 'on', volume: 'normal', split: 'on', speed: 'normal', adapt: 'on', theme: 'system', motion: 'system' }, learner = E.learner();
  let protectSave = false;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  function validState(s, b) {
    if (!s || !Array.isArray(s.notes) || typeof s.wrong !== 'boolean' || s.notes.length > b.melody.length) return false;
    if (!s.notes.every(k => Number.isInteger(k) && k >= 0 && k < b.notes.length)) return false;
    const right = s.wrong ? s.notes.slice(0, -1) : s.notes;
    if (!right.every((k, i) => k === b.melody[i])) return false;
    return !s.wrong || (s.notes.length > 0 && s.notes[s.notes.length - 1] !== b.melody[s.notes.length - 1]);
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(x => x.id === s?.board);
      if (!b || s.v !== 1 || !validState(s.state, b)) throw Error('Invalid save');
      if (!Number.isSafeInteger(s.hits) || s.hits < 0 || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(x => x.id === id))) throw Error('Invalid save');
      // Rewards and the recovery settings came later than the others; a save
      // without them takes their defaults: colour, a 1.5 s long press, no release time.
      // A setting this version does not know falls back to its default rather than
      // discarding the whole save (which used to stop saving progress for good).
      if (s.settings && typeof s.settings === 'object') for (const [k, v] of Object.entries(SETTINGS)) if (!v.includes(s.settings[k]) && !(LATER[k] !== undefined && s.settings[k] === undefined)) s.settings[k] = prefs[k];
      if (!s.settings || typeof s.settings !== 'object') throw Error('Invalid save');
      const t = s.timing;
      if (!t || !finite(t.w) || t.w <= 0 || t.w > 1000 || !finite(t.s1) || !finite(t.s2) || t.s2 < 0 || !Array.isArray(t.pending) || t.pending.length > E.DELAY || !t.pending.every(p => Array.isArray(p) && p.length <= 200 && p.every(x => finite(x) && Math.abs(x) <= 10000))) throw Error('Invalid save');
      board = b; state = { notes: s.state.notes.slice(), wrong: s.state.wrong };
      hits = s.hits; finished = new Set(s.finished); prefs = { ...LATER, ...s.settings }; learner = { w: t.w, s1: t.s1, s2: t.s2, pending: t.pending.map(p => p.slice()) };
    }
  } catch (_) { protectSave = true; }
  // Every board is open from the start; the save keeps the finished ones.
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, board: board.id, state, hits, finished: [...finished], settings: prefs, timing: learner })); } catch (_) {}
  }

  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || prefs.theme === 'system' && darkQuery.matches;
  const shown = () => prefs.shown === 'on';
  const index = () => boards.indexOf(board);
  const last = () => index() === boards.length - 1;
  const T = () => E.period(board, prefs.speed);
  const par = () => board.par[prefs.speed];
  const solved = () => E.solved(board, state);
  const model = () => E.model(learner, prefs.adapt === 'on');
  function announce(text) { $('#announcement').textContent = text; }

  // Play moves between: waiting for the first press to start the sound, a
  // tune playing, a choice running (the cycle), and paused while hidden.
  let blooms = 0, finale = null, refused = 0;
  let mode = 'wait', starting = false, choices = 0, switches = 0, sel = null, probs = new Map(), fade = new Map(), hint = null, arrival = null, tuneEnd = 0, tuneKind = null;

  // ---- Sound. Every sound is made in the page with the Web Audio API.
  let ctx = null, master = null, noise = null, version = 0;
  const live = [], log = [], flashes = [], scheduled = new Map();
  const audioOK = () => !!ctx && ctx.state === 'running';
  // Start or resume the sound; called inside the input handlers, which a
  // browser requires before a page may play.
  function wakeAudio() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC({ latencyHint: 'interactive' });
        master = ctx.createGain(); master.gain.value = VOLUME[prefs.volume]; master.connect(ctx.destination);
        // A quarter second of noise, the same every time.
        noise = ctx.createBuffer(1, Math.round(ctx.sampleRate / 4), ctx.sampleRate);
        const d = noise.getChannelData(0); let s = 0x9e3779b9;
        for (let i = 0; i < d.length; i++) { s = Math.imul(s ^ s >>> 15, 0x2c1b3c6d) + 0x297a2d39 | 0; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
        ctx.addEventListener('statechange', ready);
      }
      if (ctx.state === 'suspended' && mode !== 'pause') ctx.resume().then(ready, () => {});
    } catch (_) {}
  }
  // Once the sound runs after the first press, the board's tune plays.
  function ready() {
    if (mode === 'wait' && starting && (audioOK() || !ctx)) { starting = false; startTune(performance.now() + 200); chrome(); }
  }
  // Page time (ms) to the audio context's time (s) at which a sound scheduled
  // there reaches the speaker.
  function toContext(ms) {
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (ms - ts.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || 0) + (ms - performance.now()) / 1000;
  }
  // One sound. `group` is cycle (cancelled when the cycle changes), tune
  // (cancelled when play moves on) or cue (never cancelled). Every sound is
  // logged, played or not, for the test hook.
  function voice(spec) {
    const e = { kind: spec.kind, id: spec.id === undefined ? null : spec.id, at: Math.round(spec.at * 100) / 100, hz: spec.hz || null, to: spec.to || null, pan: spec.pan || 0, dur: Math.round(spec.dur), level: spec.level, group: spec.group, ctxAt: null, state: 'silent' };
    log.push(e); if (log.length > 900) log.splice(0, log.length - 900);
    if (!audioOK()) return e;
    try {
      let c = toContext(spec.at); const now = ctx.currentTime;
      if (c < now) { if (now - c > .05) { e.state = 'late'; return e; } c = now; }
      e.ctxAt = c; e.state = 'scheduled';
      const d = spec.dur / 1000, env = ctx.createGain(), srcs = [];
      env.gain.setValueAtTime(.0001, c); env.gain.exponentialRampToValueAtTime(spec.level, c + .006); env.gain.exponentialRampToValueAtTime(.0001, c + d);
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.setValueAtTime(e.pan, c); env.connect(p); p.connect(master); } else env.connect(master);
      const osc = (type, hz, gain = 1) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(hz, c); if (spec.to) o.frequency.exponentialRampToValueAtTime(spec.to * hz / spec.hz, c + d); if (gain === 1) o.connect(env); else { const g = ctx.createGain(); g.gain.value = gain; o.connect(g); g.connect(env); } srcs.push(o); return o; };
      if (spec.kind === 'replay' || spec.kind === 'tick') {
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(); src.buffer = noise;
        f.type = spec.kind === 'tick' ? 'highpass' : 'bandpass'; f.frequency.value = spec.kind === 'tick' ? 5000 : 3200; f.Q.value = .9;
        src.connect(f); f.connect(env); srcs.push(src);
      } else if (spec.kind === 'wrong') {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.connect(env);
        for (const hz of [98, 103.8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(hz, c); o.connect(f); srcs.push(o); }
      } else if (spec.kind === 'undo' || spec.kind === 'next' || spec.kind === 'back') osc('sine', spec.hz);
      else { osc('triangle', spec.hz); if (spec.kind !== 'note') osc('sine', spec.hz * 2, .28); }
      for (const s of srcs) { s.start(c); s.stop(c + d + .03); }
      const item = { e, srcs, c, group: spec.group };
      live.push(item);
      srcs[0].onended = () => { const i = live.indexOf(item); if (i >= 0) live.splice(i, 1); try { env.disconnect(); } catch (_) {} };
    } catch (_) { e.state = 'failed'; }
    return e;
  }
  // Sounds of the given groups that have not begun are stopped, and their lights with them.
  function cancel(groups, from = performance.now()) {
    if (ctx) for (let i = live.length - 1; i >= 0; i--) {
      const item = live[i];
      if (!groups.includes(item.group) || item.c <= ctx.currentTime + .003) continue;
      for (const s of item.srcs) try { s.stop(0); } catch (_) {}
      item.e.state = 'cancelled'; live.splice(i, 1);
    }
    for (const e of log) if (groups.includes(e.group) && e.at > from && (e.state === 'silent' || e.state === 'late')) e.state = 'cancelled';
    for (let i = flashes.length - 1; i >= 0; i--) if (groups.includes(flashes[i].group) && flashes[i].at > from) flashes.splice(i, 1);
  }
  const cancelCycle = () => { version++; scheduled.clear(); cancel(['cycle']); };
  const cancelAll = () => { version++; scheduled.clear(); cancel(['cycle', 'tune']); };
  function flash(id, at, dur, group, extra = {}) { flashes.push({ id, at, dur, group, ...extra }); }

  // What each item in the cycle sounds like: a note is a short plucked tone
  // at its pitch in its ear; replay is a soft breath of noise; undo falls and
  // next rises, both in the middle.
  function cycleSound(id, at) {
    const n = sel.ids.length, gap = sel.T / n, dur = clamp(gap * .85, 90, 260);
    let boost = 1, extra = {};
    if (arrival && arrival.left > 0 && id === arrival.id) { arrival.left--; boost = 1.5; extra = { arrival: true }; }
    if (typeof id === 'number') voice({ kind: 'note', id, at, hz: E.pitch(board, id).hz, pan: E.pan(board, id, prefs.split === 'on'), dur, level: .32 * boost, group: 'cycle' });
    else if (id === 'replay') voice({ kind: 'replay', id, at, dur: Math.min(dur, 70), level: .5, group: 'cycle' });
    else voice({ kind: id, id, at, hz: id === 'undo' ? 560 : 330, to: id === 'undo' ? 280 : 660, dur: Math.min(dur, 140), level: .3, group: 'cycle' });
    flash(id, at, dur, 'cycle', extra);
  }
  // Schedule the cycle's sounds that fall within the next LOOKAHEAD ms.
  function pump(now) {
    if (mode !== 'select' || !sel) return;
    for (const id of sel.ids) {
      const at = E.onsetAfter(sel, id, now - 15);
      if (at > now + LOOKAHEAD) continue;
      const key = version + '|' + id + '|' + Math.round(at);
      if (scheduled.has(key)) continue;
      scheduled.set(key, at); cycleSound(id, at);
    }
    for (const [k, at] of scheduled) if (at < now - 3000) scheduled.delete(k);
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].at + flashes[i].dur + 2000 < now) flashes.splice(i, 1);
  }
  // A tune: the board's (to listen to) or the rebuilt one (once finished).
  function playTune(notes, t0, kind) {
    cancelAll(); sel = null; mode = 'tune'; tuneKind = kind; hint = null;
    const step = E.step(board, prefs.speed);
    notes.forEach((k, i) => {
      const at = t0 + i * step;
      voice({ kind: 'tune', id: k, at, hz: E.pitch(board, k).hz, pan: E.pan(board, k, prefs.split === 'on'), dur: step * .8, level: .34, group: 'tune' });
      flash(k, at, step * .8, 'tune'); flash('slot' + i, at, step * .8, 'tune');
    });
    tuneEnd = t0 + notes.length * step;
  }
  function startTune(t0) { playTune(board.melody, t0, 'tune'); }
  function begin(t0) {
    cancelCycle(); mode = 'select';
    sel = E.selection(E.contention(board, state, last()), T(), t0);
    probs = E.probabilities(sel); fade = new Map();
    if (hint !== null && !sel.ids.includes(hint)) hint = null;
    // On board 1 the tune's note sounds louder, and shows a ring, the first two times round.
    if (board.teach === 'arrival' && !hits && !state.notes.length && !arrival) arrival = { id: board.melody[0], left: 2 };
    else if (arrival && (hits || state.notes.length)) arrival = null;
  }
  function tick() {
    const now = performance.now();
    if (mode === 'tune' && now >= tuneEnd) begin(tuneEnd + E.REST);
    pump(now);
  }

  // ---- Layout: the ring fills the area between the header and the toolbar,
  // less a row below it for the next disc (beside it in phone landscape,
  // where the toolbar stands at the side). The notes stand on the ring, lower
  // notes lower, the left ear's on the left, as large as the count allows and
  // never wider than a sixth of the window's short side.
  const canvas = $('#notes'), g = canvas.getContext('2d');
  let layout = null, ink = '#000', paper = '#fff';
  const landscape = matchMedia('(orientation: landscape) and (max-height: 500px)');
  function fit() {
    const shell = $('#board-shell').getBoundingClientRect(), foot = landscape.matches ? 0 : 80;
    const area = { x: shell.left, y: shell.top, w: Math.max(1, shell.width), h: Math.max(1, shell.height - foot) }, s = Math.min(area.w, area.h);
    // On a tall screen the ring stretches upward, up to half again as tall
    // as it is wide, so pitch, which is height, has more room.
    const N = board.notes.length, rd = clamp(s * (N <= 3 ? .075 : N <= 5 ? .065 : .055), 11, Math.min(innerWidth, innerHeight) / 12);
    const R = Math.max(1, Math.min(area.w, area.h) / 2 - rd - 2), Ry = Math.max(1, Math.min(area.h / 2 - rd - 2, 1.45 * R));
    const node = $('#board'); node.style.width = 2 * (R + rd + 2) + 'px'; node.style.height = 2 * (Ry + rd + 2) + 'px';
    const box = node.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const at = board.notes.map((_, k) => { const y = (-1 + 2 * (k + .5) / N) * .92; return [cx + (k % 2 ? 1 : -1) * R * Math.sqrt(1 - y * y), cy - y * Ry]; });
    layout = { box, area, s, rd, R, Ry, cx, cy, at, limit: area.w <= area.h ? 'width' : 'height' };
    const dpr = Math.min(3, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  }
  function colours() { const cs = getComputedStyle(document.documentElement); ink = cs.getPropertyValue('--ink').trim() || '#000'; paper = cs.getPropertyValue('--bg').trim() || '#fff'; }
  // Undo, replay and next sound round their buttons.
  function controlAt(id) {
    const node = $('#' + id + '-btn');
    if (!node || node.hidden || !node.getClientRects().length) return null;
    const b = node.getBoundingClientRect(); if (!b.width) return null;
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, R: id === 'next' ? 39 : 21.5 };
  }
  // Where the rebuilt tune's k-th note stands in the middle: left to right in
  // time, up and down by pitch.
  function slotAt(i, k) {
    const { R, cx, cy } = layout, L = board.melody.length, N = board.notes.length, sx = Math.min(R * .22, R * 1.15 / Math.max(1, L - 1));
    return [cx + (i - (L - 1) / 2) * sx, k === null || N < 2 ? cy : cy + layout.Ry * .3 * (1 - 2 * k / (N - 1))];
  }

  // ---- Drawing.
  function line(x1, y1, x2, y2, width, alpha) { g.globalAlpha = alpha; g.lineWidth = width; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  function circle(x, y, r, width, alpha) { g.globalAlpha = alpha; g.lineWidth = width; g.beginPath(); g.arc(x, y, Math.max(.1, r), 0, TAU); g.stroke(); }
  function disc(x, y, r, alpha) { g.globalAlpha = alpha; g.beginPath(); g.arc(x, y, Math.max(.1, r), 0, TAU); g.fill(); }
  // How lit an item is now, 0 to 1: full while its sound plays, then fading.
  function lit(id, now) {
    let best = 0;
    for (const f of flashes) {
      if (f.id !== id || now < f.at) continue;
      const k = now - f.at;
      const v = reduced() ? (k <= f.dur ? 1 : 0) : k <= f.dur * .5 ? 1 : 1 - smooth((k - f.dur * .5) / (f.dur * .5 + LINGER));
      if (v > best) best = v;
    }
    return best;
  }
  function arrivalAt(id, now) {
    for (const f of flashes) if (f.arrival && f.id === id && now >= f.at && now < f.at + 700) return reduced() ? 1 : (now - f.at) / 700;
    return null;
  }
  function headphones(x, y, s, alpha) {
    g.globalAlpha = alpha; g.lineWidth = Math.max(2, s * .06); g.lineCap = 'round';
    g.beginPath(); g.arc(x, y + s * .08, s * .42, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    for (const side of [-1, 1]) { const cx = x + side * s * .4; g.beginPath(); g.moveTo(cx, y - s * .02); g.lineTo(cx, y + s * .2); g.stroke(); g.beginPath(); g.roundRect ? g.roundRect(cx - s * .09, y + s * .1, s * .18, s * .34, s * .07) : g.rect(cx - s * .09, y + s * .1, s * .18, s * .34); g.fill(); }
  }
  function draw(now) {
    if (!layout) return;
    g.setTransform(canvas.width / innerWidth, 0, 0, canvas.height / innerHeight, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'round';
    const { rd, R, cx, cy, at } = layout, moving = !reduced(), inPlay = sel ? new Set(sel.ids) : new Set();
    // Unlikely items fade toward a floor by their probability.
    const top = Math.max(0, ...probs.values()), dt = draw.last ? Math.min(100, now - draw.last) : 16; draw.last = now;
    for (const id of inPlay) {
      const goal = top ? clamp(1 + Math.log10(Math.max(1e-12, probs.get(id) / top)) / 2, .14, 1) : 1, was = fade.has(id) ? fade.get(id) : 1;
      fade.set(id, moving ? was + (goal - was) * (1 - Math.exp(-dt / 90)) : goal);
    }
    const listening = mode === 'tune' || mode === 'wait';
    const ringW = Math.max(1.5, rd * .06), fine = Math.max(1, rd * .04), N = board.notes.length;
    // A rebuilt tune holds its palette until the board changes; Calm keeps paper and ink.
    const tinted = !!finale && colourful() && solved(), pal = tinted ? stops() : null, hue = k => P.colour(pal, N > 1 ? k / (N - 1) : .5);
    let far = 1;
    if (tinted && finale.origin) { const pts = (shown() ? at : []).concat(state.notes.map((k, i) => slotAt(i, k))); for (const q of pts) far = Math.max(far, Math.hypot(q[0] - finale.origin[0], q[1] - finale.origin[1])); }
    if (shown()) { g.globalAlpha = .1; g.lineWidth = fine; g.beginPath(); g.ellipse(cx, cy, R, layout.Ry, 0, 0, TAU); g.stroke(); }
    if (shown()) board.notes.forEach((_, k) => {
      const [x, y] = at[k], f = fade.has(k) ? fade.get(k) : 1, on = inPlay.has(k) || listening, v = lit(k, now);
      // Paper inside each note, so the ring's line stops at its edge.
      g.fillStyle = paper; disc(x, y, rd, 1); g.fillStyle = ink;
      circle(x, y, rd - ringW / 2, ringW, on ? (mode === 'wait' ? .3 : listening ? .8 : .3 + .5 * f) : .16);
      if (tinted) {
        const a = tint(at[k], now, far); if (a > 0) { g.fillStyle = hue(k); disc(x, y, rd - ringW, a); g.fillStyle = ink; }
        if (v > 0) circle(x, y, rd + ringW * 1.5, ringW, v);
      } else if (v > 0) disc(x, y, rd * (moving ? .78 + .22 * v : 1), v);
      const a = arrivalAt(k, now); if (a !== null) circle(x, y, rd * (1.3 + .5 * a), Math.max(2, rd * .08), 1 - a * .8);
      if (hint === k) { g.setLineDash([4, 4]); circle(x, y, rd + Math.max(6, rd * .3), ringW, .9); g.setLineDash([]); }
    });
    if (mode === 'wait') headphones(cx, cy, R * .4, moving ? .75 + .25 * Math.cos(now / 600) : 1);
    else {
      // The tune so far: placed notes by pitch, joined; empty places on the middle line.
      const L = board.melody.length, rm = Math.max(4, R * .05), placed = state.notes.length, thin = Math.max(1.5, rm * .19);
      for (let i = 1; i < placed; i++) { if (state.wrong && i === placed - 1) break; const [x1, y1] = slotAt(i - 1, state.notes[i - 1]), [x2, y2] = slotAt(i, state.notes[i]); line(x1, y1, x2, y2, thin, .9); }
      for (let i = 0; i < L; i++) {
        const v = lit('slot' + i, now);
        if (i < placed) {
          const [x, y] = slotAt(i, state.notes[i]);
          if (state.wrong && i === placed - 1) { const d = rm * 1.1; line(x - d, y - d, x + d, y + d, thin * 1.3, 1); line(x - d, y + d, x + d, y - d, thin * 1.3, 1); }
          else {
            disc(x, y, rm, 1);
            if (tinted) { const a = tint([x, y], now, far); if (a > 0) { g.fillStyle = hue(state.notes[i]); disc(x, y, rm * 1.15, a); g.fillStyle = ink; } }
            if (v > 0) circle(x, y, rm * (1.7 + (moving ? .5 * (1 - v) : 0)), thin, v);
          }
        } else {
          const [x, y] = slotAt(i, null);
          circle(x, y, rm * .8, thin * .85, i === placed && !state.wrong ? .9 : .4);
          if (v > 0) disc(x, y, rm * .8, v);
        }
      }
    }
    // A long press building: a thin ink ring fills round the step, with the notes shown.
    { const p = holdProgress(now);
      if (p > 0 && shown() && mode !== 'wait') { const [x, y] = holdFocus(), r = Math.max(4, R * .05) * 2.6; g.globalAlpha = .9; g.lineWidth = Math.max(1.5, r * .07); g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + p * TAU); g.stroke(); } }
    // Undo, replay and next: a ring round the button, heavy while it sounds.
    if (shown()) for (const id of ['undo', 'replay', 'next']) {
      if (!inPlay.has(id)) continue;
      const c = controlAt(id); if (!c) continue;
      const f = fade.has(id) ? fade.get(id) : 1, v = lit(id, now);
      circle(c.x, c.y, c.R, 1 + 2 * v, Math.max(.2 + .3 * f, v));
      if (hint === id) { g.setLineDash([4, 4]); circle(c.x, c.y, c.R + 7, 1.5, .9); g.setLineDash([]); }
    }
    // One ring spreads from the last note over a second as the colour comes.
    if (tinted && finale.origin && moving && now - finale.at < 1000) {
      const k = (now - finale.at) / 1000, e = 1 - (1 - k) ** 3;
      g.strokeStyle = P.colour(pal, .5); circle(finale.origin[0], finale.origin[1], rd + far * e, Math.max(2, rd * .1), .6 * (1 - k)); g.strokeStyle = ink;
    }
    g.globalAlpha = 1;
  }
  function frame(now) { draw(now); requestAnimationFrame(frame); }

  // ---- Play. A press is one switch event at its own time stamp. The first
  // press starts the sound; presses while a tune plays are not counted; in a
  // cycle each press counts while the tune is unfinished.
  function press(t) {
    if ($('dialog[open]')) return;
    switches++;
    if (mode === 'wait') {
      starting = true; wakeAudio(); ready();
      // A press the browser does not count as the player's own (a look held by
      // Access, a switch through some adapters) cannot start the sound. Rather
      // than wait for ever, the board starts silent after a moment, its dots
      // showing the notes, and sound joins at the first tap or key.
      setTimeout(() => { if (mode === 'wait' && starting) { starting = false; startTune(performance.now() + 200); chrome(); announce('No sound yet: tap or press a key to hear the notes. The dots show them meanwhile.'); } }, 1500);
      return;
    }
    if (mode !== 'select' || !sel) return;
    if (!solved()) hits++;
    if (arrival) arrival.left = 0;
    voice({ kind: 'tick', at: t, dur: 12, level: .12, group: 'cue' });
    const winner = E.press(sel, t, model());
    probs = E.probabilities(sel);
    if (winner === null) { cancelCycle(); chrome(); save(); return; }
    if (prefs.adapt === 'on') { if (winner === 'undo') E.forget(learner); else E.remember(learner, E.taught(sel, winner, model())); }
    take(winner);
  }
  // What a choice does: next opens the next board; replay plays the tune
  // again; undo takes back the last note; a note joins the tune, right or wrong.
  function take(id) {
    const now = performance.now(), k = state.notes.length, L = board.melody.length;
    choices++;
    if (id === 'next') { const next = boards[index() + 1]; if (next) go(next.id); return; }
    if (id === 'replay') { startTune(now + 300); announce('The tune again.'); chrome(); save(); return; }
    state = E.choose(board, state, id); hint = null; sel = null; cancelCycle();
    if (id === 'undo') {
      finale = null;
      voice({ kind: 'back', id, at: now, hz: 520, to: 220, dur: 220, level: .3, group: 'cue' });
      announce('Undone. ' + left()); begin(now + AFTER);
    } else if (state.wrong) {
      voice({ kind: 'wrong', id, at: now, dur: 240, level: .22, group: 'cue' });
      announce('Wrong note. Press as the falling sound plays to take it back.'); begin(now + AFTER);
    } else {
      const origin = reward(id, k);
      if (solved()) {
        // A rising chord in place of the note's own confirmation, then the
        // rebuilt tune; the board takes its palette from the last note outward.
        [5, 7, 8, 5].forEach((p, i) => voice({ kind: 'chord', at: now + i * 55, hz: E.PITCHES[p].hz * (i === 3 ? 2 : 1), pan: prefs.split === 'on' ? -.4 + i * .27 : 0, dur: 560 - i * 55, level: .2, group: 'cue' }));
        finale = { at: now, origin };
        finished.add(board.id); playTune(state.notes, now + 700, 'finish');
        announce(`Tune rebuilt in ${hits} presses. Par ${par()}. ${last() ? 'Every board is finished.' : 'Press as the rising sound plays for the next board.'}`);
      } else { voice({ kind: 'confirm', id, at: now, hz: E.pitch(board, id).hz, pan: E.pan(board, id, prefs.split === 'on'), dur: 320, level: .38, group: 'cue' }); announce(`Right note, ${k + 1} of ${L}.`); begin(now + AFTER); }
    }
    chrome(); save();
  }
  const left = () => { const n = board.melody.length - state.notes.length; return n + (n === 1 ? ' note' : ' notes') + ' left.'; };
  // The reward for a right note: a bloom in the board's palette where it was
  // chosen, its dot on the ring (or, with the notes hidden, its place in the
  // tune). Returns where, for the finished board's wave of colour.
  const colourful = () => prefs.rewards === 'colour';
  const stops = () => P.paletteFor(index(), dark());
  function reward(id, place) {
    if (!layout) return null;
    const onRing = shown(), [x, y] = onRing ? layout.at[id] : slotAt(place, id), size = onRing ? 2 * layout.rd : 6 * Math.max(4, layout.R * .05);
    if (colourful()) { P.bloom($('#payoff'), x, y, { reach: size * .62, size, stops: stops(), reduced: reduced(), turn: blooms }); blooms++; }
    return [x, y];
  }
  // How far the finished board's colour has come at a point: a wave from the
  // last note outward over 700 ms, each piece filling in 300 ms; with reduced
  // motion every piece fades in together.
  function tint(p, now, far) {
    if (!finale) return 0;
    if (!finale.origin) return 1;
    const delay = reduced() ? 0 : 700 * Math.hypot(p[0] - finale.origin[0], p[1] - finale.origin[1]) / far;
    return smooth((now - finale.at - delay) / (reduced() ? 400 : 300));
  }

  // Pointer chrome: undo and replay are one press each while the tune is
  // unfinished; hint marks the next choice and sounds it, then takes it for
  // the presses a perfect presser would need.
  function undoButton() {
    if (!state.notes.length) return;
    if (!solved()) hits++;
    if (prefs.adapt === 'on') E.forget(learner);
    hint = null; take('undo');
  }
  function replayButton() {
    if (mode === 'wait') { press(performance.now()); return; }
    if (!solved()) hits++;
    take('replay');
  }
  function hintButton() {
    if (solved() || mode !== 'select' || !sel) return;
    if (hint !== null && sel.ids.includes(hint)) {
      const id = hint, presses = E.cost(sel.ids, id, sel.T).presses;
      hits += presses; hint = null;
      if (prefs.adapt === 'on') { if (id === 'undo') E.forget(learner); else E.remember(learner, []); }
      take(id); return;
    }
    hint = E.expected(board, state); if (hint === null) return;
    const now = performance.now();
    if (hint === 'undo') voice({ kind: 'undo', id: 'undo', at: now, hz: 560, to: 280, dur: 160, level: .4, group: 'cue' });
    else voice({ kind: 'confirm', id: hint, at: now, hz: E.pitch(board, hint).hz, pan: E.pan(board, hint, prefs.split === 'on'), dur: 320, level: .42, group: 'cue' });
    flash(hint, now, 320, 'cue');
    announce(hint === 'undo' ? 'Hint: the falling sound, undo. Press Hint again to take it.' : 'Hint: this note. Press Hint again to take it.');
    chrome();
  }
  const nextChoice = () => E.expected(board, state);

  function chrome() {
    const n = index() + 1, done = solved(), L = board.melody.length;
    $('#readout').textContent = `${n} / ${boards.length} · ${hits} / ${par()}`;
    $('#readout').setAttribute('aria-label', `Board ${n} of ${boards.length}; ${hits} presses; par ${par()}`);
    const status = mode === 'wait' ? 'Press any key or tap anywhere to start the sound.' : done ? 'Tune rebuilt.' : state.wrong ? 'A wrong note stands; press as the falling sound plays to take it back.' : 'Press any key or tap as each note of the tune comes round.';
    $('#board').setAttribute('aria-label', `Board ${n} of ${boards.length}: a tune of ${L} notes from ${board.notes.length}; ${state.notes.length - (state.wrong ? 1 : 0)} placed. ${status}`);
    $('#undo-btn').disabled = state.notes.length === 0;
    $('#hint-btn').disabled = done;
    $('#next-btn').hidden = !done || last();
    catalog();
  }
  // Settings lists every board as current, completed or available.
  function catalog() {
    const list = $('#board-catalog');
    if (!list.children.length) boards.forEach((b, i) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'board'; button.dataset.board = b.id;
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

  function reset() {
    state = E.start(); hits = 0; hint = null; arrival = null; fade = new Map(); probs = new Map(); finale = null;
    cancelAll(); sel = null;
    if (mode !== 'wait') { mode = 'tune'; startTune(performance.now() + 300); }
  }
  function restart() { reset(); fit(); chrome(); save(); announce('Board restarted.'); }
  // Any board can be opened, from Settings or the test hook; an unknown id is refused.
  function go(id) {
    const i = boards.findIndex(b => b.id === id);
    if (i < 0) return false;
    board = boards[i]; reset(); fit(); chrome(); save();
    announce(`Board ${i + 1}. A tune of ${board.melody.length} ${board.melody.length === 1 ? 'note' : 'notes'} from ${board.notes.length}.`);
    return true;
  }
  // Hidden, the sound stops; back, a fresh cycle starts (after a press if
  // the browser wants one before sound may resume).
  function pause() {
    if (mode === 'wait' || mode === 'pause') return;
    cancelAll(); sel = null; mode = 'pause';
    try { if (ctx) ctx.suspend(); } catch (_) {}
  }
  function resume() {
    if (mode !== 'pause') return;
    const back = () => { if (mode !== 'pause') return; if (!ctx || audioOK()) begin(performance.now() + AFTER); else { mode = 'wait'; chrome(); } };
    if (ctx) ctx.resume().then(back, back); else back();
  }

  // One switch. Any key, a tap anywhere or a click anywhere is a press, at
  // the moment it went down; a held key or finger counts once. The toolbar,
  // restart and next buttons and the sheets keep their own pointer roles,
  // and a button reached by Tab keeps Enter and Space.
  const held = new Set(), switchKeys = new Set(), pressing = new Set();
  let lastInput = 'pointer';

  // Recovery. Release time (off unless chosen) refuses a press
  // that comes within that time of the last release (a bounce or tremor).
  // Long press (1.5 s unless changed): the press acts at once as always; held past the chosen time,
  // it takes back the step: a choice it completed is undone, and the choice
  // in progress starts afresh in the cycle's own order with even odds, the
  // scorer forgetting the presses toward it (they still count). It fires
  // once however long the switch is held; a release, a hidden page or a lost
  // pointer before then cancels it.
  let holding = null, lastRelease = -Infinity, takebacks = 0;
  const holdTime = () => Number(prefs.hold), releaseTime = () => Number(prefs.release);
  function switchDown(t, source) {
    if ($('dialog[open]')) return;
    if (releaseTime() && t - lastRelease < releaseTime()) { refused++; return; }
    cancelHold();
    const was = mode, before = choices, snap = { board: board.id, state: { notes: state.notes.slice(), wrong: state.wrong }, hits, finished: finished.has(board.id), learner: JSON.parse(JSON.stringify(learner)) };
    press(t);
    if (!holdTime() || was !== 'select') return;
    const h = { source, t0: t, snap, completed: choices > before, fired: false };
    h.timer = setTimeout(() => fireHold(h), Math.max(0, t + holdTime() - performance.now()));
    holding = h;
  }
  function switchUp(t, source) {
    lastRelease = t;
    if (holding && holding.source === source) cancelHold();
  }
  function cancelHold() { if (holding) { clearTimeout(holding.timer); holding = null; } }
  function fireHold(h) {
    if (holding !== h || h.fired) return;
    h.fired = true; takeBack(h);
  }
  function takeBack(h) {
    const now = performance.now(), snap = h.snap;
    cancelAll(); sel = null; hint = null;
    if (h.completed) {
      // Undo what the press chose: the note it placed or took back, the tune
      // it replayed, or the board it moved on to; the learner forgets it too.
      if (board.id !== snap.board) { board = boards.find(b => b.id === snap.board); hits = snap.hits; fit(); }
      state = { notes: snap.state.notes.slice(), wrong: snap.state.wrong };
      if (snap.finished) finished.add(board.id); else finished.delete(board.id);
      learner = snap.learner;
      finale = solved() && colourful() ? { at: -Infinity, origin: null } : null;
    }
    takebacks++;
    voice({ kind: 'back', id: 'undo', at: now, hz: 520, to: 220, dur: 220, level: .3, group: 'cue' });
    begin(now + AFTER);
    announce(h.completed ? 'Taken back. Choice started again.' : 'Choice started again.');
    chrome(); save();
  }
  // How far the long press has come, for its ring: nothing for the first
  // 0.4 s, so an ordinary press never shows it, then filling until it takes;
  // stepped in quarters with reduced motion.
  const HOLD_SHOWS = 400;
  function holdProgress(now) {
    if (!holding || holding.fired || !holdTime()) return 0;
    const held = now - holding.t0; if (held < HOLD_SHOWS) return 0;
    const p = Math.min(1, (held - HOLD_SHOWS) / (holdTime() - HOLD_SHOWS));
    return reduced() ? Math.floor(p * 4) / 4 : p;
  }
  // The ring goes round the step being taken: the note the press placed, or the tune's next place.
  function holdFocus() {
    const L = board.melody.length, placedNow = holding && state.notes.length > holding.snap.state.notes.length && board.id === holding.snap.board;
    const i = clamp(state.notes.length - (placedNow || state.wrong || solved() ? 1 : 0), 0, L - 1);
    return slotAt(i, i < state.notes.length ? state.notes[i] : null);
  }
  const passKeys = new Set(['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu', 'OS', 'Fn', 'FnLock', 'Hyper', 'Super', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified']);
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab') lastInput = 'keyboard';
    if ($('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || passKeys.has(e.key) || /^F\d+$/.test(e.key)) return;
    if (e.target.closest && e.target.closest('select,input,textarea,dialog')) return;
    if (e.target.matches && e.target.matches('button') && (e.key === 'Enter' || e.key === ' ') && lastInput === 'keyboard') return;
    e.preventDefault();
    const code = e.code || e.key;
    if (e.repeat || held.has(code)) return;
    held.add(code); switchKeys.add(code);
    switchDown(e.timeStamp, 'k' + code);
  });
  document.addEventListener('keyup', e => { const code = e.code || e.key; held.delete(code); if (switchKeys.delete(code)) { e.preventDefault(); switchUp(e.timeStamp, 'k' + code); } if (starting) wakeAudio(); });
  const chromeTarget = t => t.closest && t.closest('button,select,a,label,dialog,input,textarea');
  document.addEventListener('pointerdown', e => {
    lastInput = 'pointer';
    if (chromeTarget(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pressing.add(e.pointerId); switchDown(e.timeStamp, 'p' + e.pointerId);
  });
  document.addEventListener('pointerup', e => { if (pressing.delete(e.pointerId)) switchUp(e.timeStamp, 'p' + e.pointerId); });
  // A pointer the browser takes away ends its press without completing a long press.
  document.addEventListener('pointercancel', e => { if (pressing.delete(e.pointerId)) { cancelHold(); lastRelease = e.timeStamp; } });
  // A touch grants permission to play on its release, so the sound is woken again there.
  for (const name of ['pointerup', 'touchend', 'click']) document.addEventListener(name, () => { if (starting || (ctx && ctx.state === 'suspended' && mode !== 'pause')) wakeAudio(); });
  for (const name of ['contextmenu', 'dragstart', 'selectstart']) document.addEventListener(name, e => { if (!chromeTarget(e.target) || name !== 'contextmenu') e.preventDefault(); });
  window.addEventListener('blur', () => { held.clear(); cancelHold(); });
  document.addEventListener('visibilitychange', () => { held.clear(); cancelHold(); if (document.hidden) pause(); else resume(); });

  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', replay: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4ZM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10', next: 'M5 12h14M13 6l6 6-6 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, d] of Object.entries(icons)) $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  // After a pointer uses a button, the play surface takes focus back, so the
  // next Space or Enter is a press and not that button again.
  const handBack = e => { if (e.detail > 0 || lastInput === 'pointer') $('#board').focus({ preventScroll: true }); };
  $('#undo-btn').addEventListener('click', e => { wakeAudio(); undoButton(); handBack(e); });
  $('#hint-btn').addEventListener('click', e => { wakeAudio(); hintButton(); handBack(e); });
  $('#replay-btn').addEventListener('click', e => { wakeAudio(); replayButton(); handBack(e); });
  $('#restart-btn').addEventListener('click', e => { wakeAudio(); restart(); handBack(e); });
  $('#next-btn').addEventListener('click', e => { wakeAudio(); const n = boards[index() + 1]; if (n && solved()) go(n.id); handBack(e); });
  const openedBy = {};
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => { openedBy[id] = lastInput; held.clear(); $('#' + id).showModal(); });
    $('#' + id).addEventListener('close', () => setTimeout(() => { if (openedBy[id] === 'keyboard') $('#' + id + '-btn').focus(); else $('#board').focus({ preventScroll: true }); }, 0));
  }
  function applyPrefs() {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme; root.dataset.motion = prefs.motion;
    for (const k of Object.keys(SETTINGS)) $('#' + k).value = prefs[k];
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (master) master.gain.value = VOLUME[prefs.volume];
    colours();
  }
  for (const k of Object.keys(SETTINGS)) $('#' + k).addEventListener('change', e => {
    prefs[k] = e.target.value; applyPrefs();
    // A new speed changes every cycle, so the current choice starts afresh.
    if (k === 'speed' && mode === 'select') begin(performance.now() + AFTER);
    chrome(); save();
    if (k === 'rewards' && !colourful()) $('#payoff').replaceChildren();
    announce({ hold: holdTime() ? `Long press of ${holdTime() / 1000} seconds takes back the step.` : 'Long press off.', release: releaseTime() ? `Presses within ${releaseTime() / 1000} seconds of a release are ignored.` : 'Release time off.', rewards: colourful() ? 'Rewards in colour.' : 'Rewards calm: paper and ink only.', shown: shown() ? 'Notes shown.' : 'Notes hidden: play with your eyes closed.', volume: `Volume ${prefs.volume}.`, split: prefs.split === 'on' ? 'Notes alternate between the ears.' : 'Every note in both ears.', speed: `Speed ${prefs.speed}. Par ${par()}.`, adapt: prefs.adapt === 'on' ? 'Adapting to your timing.' : 'Using the starting timing.', theme: 'Theme changed.', motion: 'Motion setting changed.' }[k]);
  });
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', fit);

  window.__ticker = {
    boards,
    get board() { return board.id; },
    get mode() { return mode; },
    get state() {
      return { notes: state.notes.slice(), wrong: state.wrong, hits, par: par(), solved: solved(), expected: E.expected(board, state), contention: sel ? sel.ids.slice() : [], period: T(), speed: prefs.speed, presses: sel ? sel.presses : 0, model: model(), learner: { w: learner.w, s1: learner.s1, s2: learner.s2, pending: learner.pending.length }, hint, mode, audio: ctx ? ctx.state : 'none', shown: shown(), split: prefs.split, volume: prefs.volume, gain: master ? master.gain.value : null, arrival: arrival ? arrival.left : 0, finished: [...finished], choices, switches, refused, takebacks, hold: prefs.hold, release: prefs.release };
    },
    // The next sound of an item in the current cycle, in page time.
    onsetOf(id) { return mode === 'select' && sel && sel.ids.includes(id) ? E.onsetAfter(sel, id, performance.now()) : null; },
    probabilities() { return Object.fromEntries(probs); },
    // The current choice's slots (a fraction of the cycle each) and the long press, for checks.
    phases() { return sel ? Object.fromEntries(sel.ids.map(id => [id, sel.phase.get(id)])) : null; },
    hold() { const now = performance.now(), p = holdProgress(now), f = layout && mode !== 'wait' ? holdFocus() : null; return { active: !!holding && !holding.fired, fired: !!holding && holding.fired, progress: p, focus: f, r: layout ? Math.max(4, layout.R * .05) * 2.6 : 0 }; },
    sounds() { return log.map(e => ({ ...e })); },
    lit(id) { return lit(id, performance.now()); },
    where(id) { if (typeof id !== 'number') return controlAt(id); const p = layout.at[id]; return p ? { x: p[0], y: p[1], r: layout.rd } : null; },
    layout() { const { area, s, rd, R, limit } = layout; return { area, s, rd, R, limit }; },
    payoff() { return { blooms, finale: finale ? { at: finale.at, origin: finale.origin && finale.origin.slice(), tinted: !!finale && colourful() && solved() } : null, palette: stops().map(c => c.slice()), petals: $('#payoff').children.length }; },
    go: id => go(id), restart, undo: undoButton, hint: hintButton, replay: replayButton, next: nextChoice
  };
  window.__minimalize = { bounds() {
    const { at, rd } = layout, xs = at.map(p => p[0]), ys = at.map(p => p[1]);
    return { x: Math.min(...xs) - rd, y: Math.min(...ys) - rd, width: Math.max(...xs) - Math.min(...xs) + 2 * rd, height: Math.max(...ys) - Math.min(...ys) + 2 * rd };
  } };

  // Play saved mid-board resumes its notes and presses; the first press starts the sound.
  applyPrefs(); fit(); chrome(); save();
  if (solved()) finale = { at: -Infinity, origin: null };
  setInterval(tick, 25);
  requestAnimationFrame(frame);
})();
