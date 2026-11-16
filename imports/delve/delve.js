/* Delve shell: draws the run on a canvas, turns taps, drags and keys into
 * moves, keeps the save, and says one line when something is new. */
(() => {
  'use strict';
  const D = globalThis.Delve;
  const $ = (s) => document.querySelector(s);
  const KEY = 'delve.v1';
  let C = 30; // one square, in CSS pixels; set in fit()
  const board = $('#board'), map = $('#map'), ctx = map.getContext('2d');
  // Landscape phones: the toolbar stands at the right, where the shared control frame puts it.
  const rail = matchMedia('(max-height: 520px) and (min-width: 560px)');

  /* ---------- storage: everything optional; a corrupt save is kept aside ---------- */
  function readSave() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return {}; }
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch (e) { /* fall through */ }
    try { if (!localStorage.getItem(KEY + '.corrupt')) localStorage.setItem(KEY + '.corrupt', raw); } catch (e) { /* storage blocked */ }
    return {};
  }
  const raw = readSave();
  // Delve is always dark: a `theme` an older save carries is read past and no longer kept.
  const save = {
    mode: raw.mode === 'random' ? 'random' : 'daily',
    best: typeof raw.best === 'number' && raw.best > 0 ? raw.best : 0,
    daily: raw.daily && typeof raw.daily === 'object' ? { key: String(raw.daily.key || ''), best: Number(raw.daily.best) || 0 } : { key: '', best: 0 },
    seen: Object.assign({ move: false, enemy: false, stairs: false, enemyAt: null, stairsAt: null }, raw.seen && typeof raw.seen === 'object' ? raw.seen : {}),
  };
  // The best depth before this run began, so only a deeper fall is called a new best.
  // An older save without it counts the run so far as already known.
  save.before = typeof raw.before === 'number' && raw.before >= 0 ? raw.before : save.best;
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, mode: save.mode, best: save.best, before: save.before, daily: save.daily, seen: save.seen, run: D.serialize(run) })); } catch (e) { /* storage blocked: play on */ }
  }

  /* ---------- the run ---------- */
  let run = null;
  const query = new URLSearchParams(location.search);
  const wantSeed = query.has('seed') ? (Number(query.get('seed')) >>> 0) : null;
  if (raw.run) {
    try { run = D.deserialize(raw.run); } catch (e) {
      try { if (!localStorage.getItem(KEY + '.corrupt')) localStorage.setItem(KEY + '.corrupt', JSON.stringify(raw.run)); } catch (_) { /* blocked */ }
      run = null;
    }
  }
  if (wantSeed !== null && !(run && run.seed === wantSeed)) { run = D.newRun(wantSeed, 'random'); save.mode = 'random'; save.before = save.best; }
  if (!run) { run = D.newRun(save.mode === 'daily' ? D.dailySeed().seed : D.randomSeed(), save.mode); save.before = save.best; }
  if (run.mode === 'daily' && save.daily.key !== D.dailySeed().key) save.daily = { key: D.dailySeed().key, best: 0 };

  function startRun(mode) {
    stopTravel();
    save.mode = mode;
    save.before = save.best;
    const today = D.dailySeed();
    run = D.newRun(mode === 'daily' ? today.seed : D.randomSeed(), mode);
    if (mode === 'daily' && save.daily.key !== today.key) save.daily = { key: today.key, best: 0 };
    pendingNew = 0;
    fell = []; struckMe = false; found = '';
    jump();
    render();
    persist();
    say('Floor 1.');
  }
  function noteBest() {
    if (run.depth > save.best) save.best = run.depth;
    if (run.mode === 'daily' && save.daily.key === D.dailySeed().key && run.depth > save.daily.best) save.daily.best = run.depth;
  }

  /* ---------- drawing ---------- */
  let tx = 0, ty = 0;
  /* Where the last strikes fell, shown until your next move: a gray cross on
   * each square struck, and your own square inverted when a strike found you.
   * The mark comes first, the strike lands where it was: the board shows both. */
  let fell = [], struckMe = false;
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    return { ink: cs.getPropertyValue('--ink').trim(), bg: cs.getPropertyValue('--bg').trim(), floor: cs.getPropertyValue('--floor').trim(), fog: cs.getPropertyValue('--fog').trim(), guide: cs.getPropertyValue('--guide').trim() };
  }
  /* The pieces are small line drawings in the manner of the flask on the
   * toolbar: a 24-unit box, round strokes, no fill. The same paths draw the
   * board, the readout and the key in Help. Each keeps clear of the middle of
   * its box, so a square's own gray (or its inversion when struck) still shows
   * through at its center. */
  const ICONS = {
    you: 'M14.6 5.4a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0zM9.3 9.8h5.4l2.3 10.7H7z',
    blot: 'M4.5 18.5h15c0-5.8-3.2-10.5-7.5-10.5S4.5 12.7 4.5 18.5zM9.4 14.6h.01M14.6 14.6h.01',
    lancer: 'M5.5 20.5V11a4 4 0 0 1 8 0v9.5zM8.2 12.2h.01M10.8 12.2h.01M18.5 8.4v12.1M18.5 3.2l1.7 2.7-1.7 2.5-1.7-2.5z',
    hulk: 'M3.5 20.5V10.5a5.5 5.5 0 0 1 5.5-5.5h6a5.5 5.5 0 0 1 5.5 5.5v10zM7.4 8.7l3 1.1M16.6 8.7l-3 1.1M8.8 12h.01M15.2 12h.01M8.6 20.5v-3.2M15.4 20.5v-3.2',
    stairs: 'M4.5 6.5H9V11h4.5v4.5H18V20',
    flask: 'M10 3h4M11 3v5l-5.2 9A2 2 0 0 0 7.5 20h9a2 2 0 0 0 1.7-3L13 8V3M8 15h8',
    blade: 'M19.5 4.5l-9.7 9.7M7.2 11.6l5.2 5.2M9.8 14.2 5.5 18.5M4.6 19.4h.01',
    armor: 'M12 3.5 5.5 6v5.6c0 4 2.6 7.2 6.5 8.9 3.9-1.7 6.5-4.9 6.5-8.9V6zM12 8v6.5',
  };
  // How much of its square each fills: a hulk crowds it, a blot sits low and small.
  const FILL = { you: 0.84, blot: 0.74, lancer: 0.88, hulk: 1, stairs: 0.7, flask: 0.72, blade: 0.8, armor: 0.72 };
  const SHAPES = {};
  for (const k in ICONS) SHAPES[k] = new Path2D(ICONS[k]);
  // `under` is the color of the square beneath: given, the drawing is first cut out of
  // whatever already lies there (a strike's cross), so a figure on a marked square stays legible.
  function icon(name, x, y, color, weight, under) {
    const k = (C - 2) * FILL[name] / 24;
    ctx.save();
    ctx.translate(x * C + (C - 24 * k) / 2, y * C + (C - 24 * k) / 2); ctx.scale(k, k);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (under) { ctx.fillStyle = ctx.strokeStyle = under; ctx.lineWidth = ((weight || 1.8) + 3) / k; ctx.fill(SHAPES[name]); ctx.stroke(SHAPES[name]); }
    ctx.strokeStyle = color; ctx.lineWidth = (weight || 1.8) / k;
    ctx.stroke(SHAPES[name]);
    ctx.restore();
  }
  for (const n of document.querySelectorAll('[data-icon]')) n.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[n.dataset.icon] + '"/></svg>';
  // A cross over a square. On your own square it runs corner to corner, so its
  // four arms show around the figure standing on it.
  const cross = (x, y, inset = 6) => {
    const l = x * C + inset, t = y * C + inset, r = x * C + C - inset, b = y * C + C - inset;
    ctx.beginPath(); ctx.moveTo(l, t); ctx.lineTo(r, b); ctx.moveTo(r, t); ctx.lineTo(l, b); ctx.stroke();
  };
  /* The room the board has: under the readout, above the strip's line and the toolbar. */
  function room() {
    const top = 44, bottom = rail.matches ? 8 : 92;
    return { vw: innerWidth - (rail.matches ? 64 : 0), top, areaH: innerHeight - top - bottom };
  }
  /* The whole floor on the page: the biggest square that shows all of it, from 20px to 40px.
   * A floor too big for that (a phone on its side, or a run saved on the older, larger floors)
   * keeps 30px squares and the view follows you. */
  function fit() {
    const { vw, areaH } = room();
    const whole = Math.floor(Math.min(vw / run.floor.w, areaH / run.floor.h));
    C = whole >= 20 ? Math.min(40, whole) : 30;
  }
  function draw() {
    const f = run.floor, p = run.player, col = colors();
    const dpr = Math.min(3, devicePixelRatio || 1);
    if (map.width !== f.w * C * dpr || map.height !== f.h * C * dpr) { map.width = f.w * C * dpr; map.height = f.h * C * dpr; map.style.width = f.w * C + 'px'; map.style.height = f.h * C + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.w * C, f.h * C);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      if (!f.seen[i] || f.tiles[i] === D.WALL) continue;
      const vis = run.view[i];
      ctx.fillStyle = vis ? col.floor : col.fog;
      ctx.fillRect(x * C + 1, y * C + 1, C - 2, C - 2);
      if (f.tiles[i] === D.STAIRS) icon('stairs', x, y, vis ? col.ink : col.guide);
    }
    // Things lying on the floor: in ink while in sight, in gray once only remembered.
    const lying = f.flasks.map(([x, y]) => ({ x, y, kind: 'flask' })).concat(f.gear);
    for (const t of lying) {
      const i = t.y * f.w + t.x;
      if (f.seen[i]) icon(t.kind, t.x, t.y, run.view[i] ? col.ink : col.guide);
    }
    // Struck this turn: your square inverted, and drawn on in the page color from here on.
    const me = struckMe ? col.bg : col.ink;
    if (struckMe) { ctx.fillStyle = col.ink; ctx.fillRect(p.x * C + 1, p.y * C + 1, C - 2, C - 2); }
    const thin = Math.max(1.5, C / 16), heavy = C / 7;
    ctx.lineWidth = thin; ctx.lineCap = 'round';
    ctx.strokeStyle = col.guide;
    for (const [x, y] of fell) if (run.view[y * f.w + x] && !(struckMe && x === p.x && y === p.y)) cross(x, y);
    // A lancer's squares are one thrust: a line from it through them joins the crosses into a lane.
    ctx.strokeStyle = col.ink;
    for (const e of f.enemies) {
      if (e.kind !== 'lancer' || e.state !== 'mark' || !e.targets.length || !run.view[e.y * f.w + e.x]) continue;
      const [lx, ly] = e.targets[e.targets.length - 1];
      ctx.beginPath(); ctx.moveTo((e.x + 0.5) * C, (e.y + 0.5) * C); ctx.lineTo((lx + 0.5) * C, (ly + 0.5) * C); ctx.stroke();
    }
    // A cross where a strike will land: thin for one, heavy where standing there costs two or more.
    for (const [x, y, dmg] of D.danger(run)) {
      if (!run.view[y * f.w + x]) continue;
      const mine = x === p.x && y === p.y;
      ctx.strokeStyle = mine ? me : col.ink;
      ctx.lineWidth = dmg >= 2 ? heavy : thin;
      cross(x, y, mine ? 2.5 : dmg >= 2 ? 5 : 6);
    }
    ctx.lineWidth = thin;
    for (const e of f.enemies) {
      if (!run.view[e.y * f.w + e.x]) continue;
      // Dim at rest: half ink, 3:1 on the floor gray, against 6.7:1 awake.
      ctx.globalAlpha = e.state === 'rest' ? 0.5 : 1;
      icon(e.kind, e.x, e.y, col.ink, 0, col.floor);
      ctx.globalAlpha = 1;
      // The hits it can still take, as pips along the foot of its square.
      const s = Math.max(2, Math.round(C / 10)), gap = Math.max(1, Math.round(s / 2)), w = e.hp * s + (e.hp - 1) * gap;
      const x0 = Math.round(e.x * C + (C - w) / 2), y0 = e.y * C + C - s - 2;
      ctx.fillStyle = col.floor; ctx.fillRect(x0 - 1, y0 - 1, w + 2, s + 2);
      ctx.fillStyle = col.ink;
      for (let k = 0; k < e.hp; k++) ctx.fillRect(x0 + k * (s + gap), y0, s, s);
    }
    icon('you', p.x, p.y, me, 2.2, struckMe ? col.ink : col.floor);
    if (run.over) { ctx.strokeStyle = me; ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(p.x * C + 6, p.y * C + 6); ctx.lineTo(p.x * C + C - 6, p.y * C + C - 6); ctx.stroke(); }
  }
  /* The whole floor stays put when it fits; otherwise the window follows you,
   * centered both ways. With Access on it always follows, so the pad of keys
   * has a place beside the squares in sight that does not move. */
  const accessOn = () => !!document.body.dataset.access && document.body.dataset.access !== 'off';
  function area() {
    const { vw, top, areaH } = room();
    return { vw, top, areaH, fits: run.floor.w * C <= vw && run.floor.h * C <= areaH && !accessOn() };
  }
  function camera() {
    const { vw, top, areaH, fits } = area(), p = run.player;
    if (fits) { tx = (vw - run.floor.w * C) / 2; ty = top + (areaH - run.floor.h * C) / 2; }
    else { tx = vw / 2 - (p.x + 0.5) * C; ty = top + areaH / 2 - (p.y + 0.5) * C; }
    map.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px)';
  }
  function jump() { map.classList.add('instant'); fit(); camera(); void map.offsetWidth; map.classList.remove('instant'); }
  const screenOf = (x, y) => [tx + (x + 0.5) * C, ty + (y + 0.5) * C];
  // What the board shows, for Access to keep its keys clear of: the whole
  // floor, or, when the view follows you, the square of sight around you.
  window.__minimalize = {
    bounds() {
      const { vw, top, areaH, fits } = area();
      if (fits) return { x: tx, y: ty, width: run.floor.w * C, height: run.floor.h * C };
      const s = (2 * D.RADIUS + 1) * C, w = Math.min(s, vw), h = Math.min(s, areaH);
      return { x: (vw - w) / 2, y: top + (areaH - h) / 2, width: w, height: h };
    },
  };
  new MutationObserver(() => { jump(); draw(); }).observe(document.body, { attributes: true, attributeFilter: ['data-access'] });

  function hud() {
    $('#depth').textContent = run.depth;
    const hp = $('#hp');
    hp.setAttribute('aria-label', 'Health ' + run.hp + ' of ' + run.maxHp);
    let s = '';
    for (let i = 0; i < run.maxHp; i++) s += '<i' + (i < run.hp ? ' class="on"' : '') + '></i>';
    hp.innerHTML = s;
    // What you carry: a blade and armor, each with its plus, once you have one.
    for (const kind of ['blade', 'armor']) {
      const n = $('#hud-' + kind);
      n.hidden = !run[kind];
      $('#' + kind + '-n').textContent = '+' + run[kind];
      n.setAttribute('aria-label', kind === 'blade' ? 'Blade plus ' + run.blade + ': your hits do ' + (1 + run.blade) + '.' : 'Armor plus ' + run.armor + ': ' + run.armor + ' more health.');
    }
    const fb = $('#flask-btn');
    $('#flask-count').textContent = run.flasks;
    fb.setAttribute('aria-disabled', String(run.flasks < 1));
    fb.setAttribute('aria-label', 'Drink a flask. Heals three. ' + (run.flasks === 1 ? 'One left.' : run.flasks + ' left.'));
  }

  /* ---------- the strip: one line, only when something is new ---------- */
  let pendingNew = 0;
  let found = ''; // what a piece of gear did, shown until your next move
  function stripText() {
    if (run.over) return 'Fell on floor ' + run.depth + '. ' + (run.depth > save.before && run.depth > 1 ? 'A new best.' : 'Best ' + save.best + '.');
    if (pendingNew) return 'Tap again to start over.';
    if (found) return found;
    if (!save.seen.move) return 'Tap where you want to go.';
    const f = run.floor;
    if (!save.seen.enemy && f.enemies.some((e) => run.view[e.y * f.w + e.x])) return 'It marks where it will strike. Step off, then hit it.';
    if (!save.seen.stairs && run.view[f.stairs[1] * f.w + f.stairs[0]]) return 'Stairs. Step on them to go deeper.';
    return '';
  }
  function teach(ev) {
    const f = run.floor, s = save.seen;
    if (ev.some((e) => e.t === 'step')) s.move = true;
    if (!s.enemy && f.enemies.some((e) => run.view[e.y * f.w + e.x])) { if (s.enemyAt === null) s.enemyAt = run.turn; }
    if (!s.enemy && (ev.some((e) => e.t === 'kill') || (s.enemyAt !== null && run.turn - s.enemyAt >= 10))) s.enemy = true;
    if (!s.stairs && run.view[f.stairs[1] * f.w + f.stairs[0]] && s.stairsAt === null) s.stairsAt = run.turn;
    if (!s.stairs && (ev.some((e) => e.t === 'descend') || (s.stairsAt !== null && run.turn - s.stairsAt >= 12))) s.stairs = true;
  }

  function render() {
    draw(); camera(); hud();
    $('#strip-text').textContent = stripText();
    // The end of a run: the outcome in the strip and one arrow to go again.
    $('#completion').hidden = !run.over;
    document.documentElement.classList.toggle('over', run.over);
  }
  function say(text) { const live = $('#live'); live.textContent = ''; live.textContent = text; }

  /* ---------- turns ---------- */
  const NAMES = { blot: 'blot', lancer: 'lancer', hulk: 'hulk' };
  const FULL = 'You can carry two flasks.';
  let byKey = false; // the last input came from a key, so focus follows to the arrow at the end
  function doAct(action) {
    if (run.over) return [];
    if (pendingNew) { pendingNew = 0; }
    const ev = D.act(run, action);
    if (!ev.length || (ev.length === 1 && ev[0].t === 'blocked')) return ev;
    if (action.type !== 'flask') { fell = []; struckMe = false; found = ''; }
    const lines = [];
    for (const e of ev) {
      if (e.t === 'struck' || e.t === 'whiff') fell.push(...e.targets);
      if (e.t === 'kill') lines.push('The ' + NAMES[e.kind] + ' is gone.');
      else if (e.t === 'hit') lines.push('You hit the ' + NAMES[e.kind] + '.');
      else if (e.t === 'struck') { struckMe = true; lines.push('Struck for ' + e.dmg + '. Health ' + e.hp + ' of ' + run.maxHp + '.'); }
      else if (e.t === 'pickup') lines.push('A flask. ' + e.flasks + ' carried.');
      else if (e.t === 'full') { found = FULL; lines.push(FULL); }
      else if (e.t === 'gear') { found = e.kind === 'blade' ? 'A blade. Your hits do ' + e.dmg + '.' : 'Armor. One more health.'; lines.push(e.kind === 'blade' ? 'A blade, plus ' + e.level + '. Your hits do ' + e.dmg + '.' : 'Armor, plus ' + e.level + '. Health ' + e.hp + ' of ' + e.maxHp + '.'); }
      else if (e.t === 'drink') lines.push('Health ' + e.hp + ' of ' + run.maxHp + '.');
      else if (e.t === 'descend') { lines.push('Floor ' + e.depth + '.'); noteBest(); jump(); }
      else if (e.t === 'died') { lines.push('You fell on floor ' + e.depth + '.'); noteBest(); stopTravel(); }
    }
    if (!run.over && D.marks(run).some((t) => t[0] === run.player.x && t[1] === run.player.y)) lines.push('Your square is marked.');
    teach(ev);
    render();
    if (lines.length) say(lines.join(' '));
    persist();
    if (run.over && byKey) requestAnimationFrame(() => { if (run.over && !document.querySelector('dialog[open]')) $('#next-btn').focus({ preventScroll: true }); });
    return ev;
  }

  /* ---------- walking to a tapped square ----------
   * A tap two or more squares away walks there, one turn a step, over
   * squares already seen, while nothing is in sight. It stops when an enemy
   * comes into view, at a flask or gear, or at any other input, and it goes
   * around the stairs unless they are where you tapped. With an enemy in
   * sight a tap is one step, as it always was. */
  const STEP_MS = 70;
  let travel = null;
  function stopTravel() { if (travel) { clearTimeout(travel.timer); travel = null; } }
  const enemyInView = () => run.floor.enemies.some((e) => run.view[e.y * run.floor.w + e.x]);
  const markedSquare = (x, y) => D.marks(run).some((t) => t[0] === x && t[1] === y);
  /* The way there: the fewest steps, and among those the straightest (fewest diagonal steps), so
   * a tap straight up walks straight up. It never crosses the stairs unless the stairs were tapped. */
  function pathTo(gx, gy) {
    const f = run.floor, p = run.player, at = (x, y) => y * f.w + x;
    if (!D.passable(f, gx, gy) || !f.seen[at(gx, gy)]) return null;
    const n = f.w * f.h, prev = new Int32Array(n).fill(-2), far = new Int32Array(n), slant = new Int32Array(n), start = at(p.x, p.y), goal = at(gx, gy), q = [start];
    prev[start] = -1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % f.w, y = (i / f.w) | 0;
      for (const [dx, dy] of D.DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!D.passable(f, nx, ny)) continue;
        const ni = at(nx, ny);
        if (!f.seen[ni] || D.enemyAt(f, nx, ny) || markedSquare(nx, ny) || (ni !== goal && f.tiles[ni] === D.STAIRS)) continue;
        const k = slant[i] + (dx && dy ? 1 : 0);
        if (prev[ni] === -2) { prev[ni] = i; far[ni] = far[i] + 1; slant[ni] = k; q.push(ni); }
        else if (far[ni] === far[i] + 1 && k < slant[ni]) { prev[ni] = i; slant[ni] = k; }
      }
    }
    if (prev[goal] === -2) return null;
    const steps = [];
    for (let k = goal; prev[k] !== -1; k = prev[k]) { const j = prev[k]; steps.unshift([(k % f.w) - (j % f.w), ((k / f.w) | 0) - ((j / f.w) | 0)]); }
    return steps;
  }
  function travelTo(gx, gy) {
    const steps = pathTo(gx, gy);
    if (!steps || !steps.length) return false;
    travel = { steps, timer: 0 };
    const next = () => {
      if (!travel) return;
      const [dx, dy] = travel.steps.shift(), p = run.player;
      if (D.enemyAt(run.floor, p.x + dx, p.y + dy) || markedSquare(p.x + dx, p.y + dy)) { travel = null; return; }
      const ev = doAct({ type: 'move', dx, dy });
      if (!travel || !travel.steps.length || run.over || !ev.some((e) => e.t === 'step') || ev.some((e) => e.t === 'descend' || e.t === 'pickup' || e.t === 'full' || e.t === 'gear') || enemyInView() || document.querySelector('dialog[open]')) { travel = null; return; }
      travel.timer = setTimeout(next, STEP_MS);
    };
    next();
    return true;
  }

  /* ---------- input: pointer events only ---------- */
  let down = null;
  document.addEventListener('pointerdown', () => { stopTravel(); byKey = false; }, true);
  board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { board.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
  });
  board.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (run.over) return;
    let vx = dx, vy = dy;
    if (Math.hypot(dx, dy) < 14) {
      const [px, py] = screenOf(run.player.x, run.player.y);
      vx = e.clientX - px; vy = e.clientY - py;
      if (Math.hypot(vx, vy) < C * 0.55) { doAct({ type: 'wait' }); return; }
      const gx = Math.floor((e.clientX - tx) / C), gy = Math.floor((e.clientY - ty) / C);
      if (Math.max(Math.abs(gx - run.player.x), Math.abs(gy - run.player.y)) >= 2 && !enemyInView() && travelTo(gx, gy)) return;
    }
    const sector = Math.round(Math.atan2(vy, vx) / (Math.PI / 4));
    const [mx, my] = D.DIRS[((sector % 8) + 8) % 8];
    doAct({ type: 'move', dx: mx, dy: my });
  });
  board.addEventListener('pointercancel', () => { down = null; });
  board.addEventListener('contextmenu', (e) => e.preventDefault());

  const KEYS = {
    ArrowRight: [1, 0], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowUp: [0, -1],
    d: [1, 0], s: [0, 1], a: [-1, 0], w: [0, -1], q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
    6: [1, 0], 2: [0, 1], 4: [-1, 0], 8: [0, -1], 7: [-1, -1], 9: [1, -1], 1: [-1, 1], 3: [1, 1],
  };
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    stopTravel();
    const onControl = e.target.closest && e.target.closest('button, a, input, select');
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    byKey = true;
    // At the end of a run, Enter or Space goes again, as the arrow does.
    if (run.over && (k === 'Enter' || k === ' ') && !onControl) { e.preventDefault(); startRun(save.mode); return; }
    if (KEYS[k]) { e.preventDefault(); doAct({ type: 'move', dx: KEYS[k][0], dy: KEYS[k][1] }); }
    // Waiting is acting on your own square: period, 5, Space, or Enter (the select key of the Access pad).
    else if ((k === '.' || k === '5' || ((k === ' ' || k === 'Enter') && !onControl))) { e.preventDefault(); doAct({ type: 'wait' }); }
    else if (k === 'f') doAct({ type: 'flask' });
    else if (k === 'n') newRun();
    else if (k === '?') open($('#help'));
  });

  /* ---------- buttons ---------- */
  function newRun() {
    if (!run.over && run.turn > 0 && !pendingNew) {
      pendingNew = setTimeout(() => { pendingNew = 0; render(); }, 4000);
      render();
      return;
    }
    clearTimeout(pendingNew); pendingNew = 0;
    startRun(save.mode);
  }
  $('#new-btn').addEventListener('click', newRun);
  $('#next-btn').addEventListener('click', () => { if (run.over) startRun(save.mode); });
  $('#flask-btn').addEventListener('click', () => doAct({ type: 'flask' }));

  function open(dlg) { if (!dlg.open) dlg.showModal(); }
  $('#help-btn').addEventListener('click', () => open($('#help')));
  $('#settings-btn').addEventListener('click', () => { settings(); open($('#settings')); });
  for (const dlg of document.querySelectorAll('dialog.sheet')) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => board.focus({ preventScroll: true }));
  }

  function settings() {
    $('#mode-daily').setAttribute('aria-pressed', String(save.mode === 'daily'));
    $('#mode-random').setAttribute('aria-pressed', String(save.mode === 'random'));
    $('#best').textContent = save.best || '—';
    $('#best-daily').textContent = save.daily.key === D.dailySeed().key && save.daily.best ? save.daily.best : '—';
  }
  function chooseMode(mode) {
    save.mode = mode;
    if (run.over || run.turn === 0) { startRun(mode); $('#settings').close(); }
    settings(); persist();
  }
  $('#mode-daily').addEventListener('click', () => chooseMode('daily'));
  $('#mode-random').addEventListener('click', () => chooseMode('random'));

  addEventListener('resize', () => { map.classList.add('instant'); fit(); render(); void map.offsetWidth; map.classList.remove('instant'); });

  /* ---------- go ---------- */
  jump();
  render();
  noteBest();
  persist();
  window.__delve = { get run() { return run; }, act: doAct, screenOf, get C() { return C; }, get traveling() { return !!travel; }, save, startRun, newRun, engine: D };
})();
