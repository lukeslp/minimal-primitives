/* Loop · drawing, gestures and saved play. By Luke Steuber. */
(function () {
  'use strict';
  // ?samples=1 opens a short preview of the campaign's conceits (linked tiles
  // and a turning ring) with a save of its own.
  const sampling = new URLSearchParams(location.search).get('samples') === '1' && typeof LoopSamples !== 'undefined';
  // Fifty boards by id: the first twelve and the campaign's thirty-eight. The
  // main course plays twenty-five of them in course.js's order; the other
  // twenty-five follow as More boards, in id order, open once the course's last
  // board closes. `boards` is the course then More boards, so every board is
  // still known to the save.
  const E = LoopEngine, ALL = LoopBoards.concat(typeof LoopCampaign !== 'undefined' ? LoopCampaign : []);
  const course = typeof LoopCourse !== 'undefined' ? LoopCourse.map(id => ALL.find(b => b.id === id)).filter(Boolean) : ALL.slice(), extras = ALL.filter(b => !course.includes(b));
  const boards = sampling ? LoopSamples : course.concat(extras), $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = sampling ? 'loop.samples.v2' : 'loop.v1';
  // Saves made with this course carry `order: 2`; `reached` then counts places in the course.
  const ORDER = 2, FINALE = course[course.length - 1], OPENERS = 3;
  // How turning rings show themselves, chosen with ?ring= (light, bezel,
  // groove); an unknown value falls back to the first. The choice touches no save.
  const choose = (name, options) => { const v = new URLSearchParams(location.search).get(name); return options.includes(v) ? v : options[0]; };
  const RING = choose('ring', ['light', 'bezel', 'groove']);
  const board = $('#board'), page = $('#field'), reducedQuery = matchMedia('(prefers-reduced-motion:reduce)'), darkQuery = matchMedia('(prefers-color-scheme:dark)');
  const mod = n => (n % 6 + 6) % 6, validRots = (r, b) => Array.isArray(r) && r.length === b.tiles.length && r.every(n => Number.isInteger(n) && n >= 0 && n < 6);
  // Ring turns are saved only for boards with turning rings.
  const validOffsets = (o, b) => !b.rings ? o === undefined : Array.isArray(o) && o.length === b.offsets.length && o.every((n, k) => Number.isInteger(n) && n >= 0 && n < 6 && (n === 0 || b.rings.includes(k)));
  const validPosition = (s, b) => s && validRots(s.rots, b) && Number.isSafeInteger(s.hits) && s.hits >= 0 && validOffsets(s.offsets, b);
  // Player locks are saved per board: tile indices, each once.
  const validLocks = l => l === undefined || !!l && typeof l === 'object' && !Array.isArray(l) && Object.entries(l).every(([id, list]) => { const b = boards.find(b => b.id === id); return b && Array.isArray(list) && list.every(n => Number.isInteger(n) && n >= 0 && n < b.tiles.length) && new Set(list).size === list.length; });
  const startOffsets = b => b.rings ? b.offsets.slice() : undefined;
  const middle = b => b.tiles.reduce((best, t, i) => E.ring(t.q, t.r) < E.ring(b.tiles[best].q, b.tiles[best].r) ? i : best, 0);
  // Mandaza's multi-hue palettes, in board order. The dark, earthy ones vanish
  // on black and the single-hue ones read as one colour, so the finish skips them.
  const palettes = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb', // Aurora
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0', // Sunset
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96', // Vaporwave
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff', // Cyberpunk
    '#ff5e5b #ffed66 #00cecb #5c5cff', // Risograph
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00' // Dichromat
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  // The finish draws at mandaza.app's own pace, in screen pixels per ms, every
  // loop at that pace however long it is, while the view eases out to
  // Mandaza's scale over REVEAL_ZOOM ms. Both are here to tune.
  const REVEAL_SPEED = (10 + 1990 * .707 * .707) / 1000, REVEAL_ZOOM = 1600;
  // A move that closes loops sends a quick sheen along each one it closed.
  // A pass takes SHEEN ms, from the board's shortest loop to its longest,
  // growing with the square root of the loop's length, give or take JITTER;
  // loops closed together start STAGGER ms apart. Reduced motion shows nothing.
  const SHEEN = [240, 420], JITTER = .08, STAGGER = [20, 60];
  // A press held this long without moving locks or unlocks its tile.
  const HOLD = 450;
  // Mandaza's table of dot counts per edge (index = dots): one row per field.
  const GEOMETRIES = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 1, 1, 0], [0, 1, 0, 1], [0, 0, 2, 1], [0, 1, 3, 1]];
  let px = 60;
  let saved = null, corrupt = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const s = JSON.parse(raw), b = boards.find(b => b.id === s?.board);
      if (!b || !validPosition(s, b) || !Array.isArray(s.history) || !s.history.every(p => validPosition(p, b)) || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(b => b.id === id)) || !['system', 'light', 'dark'].includes(s.settings?.theme) || !['system', 'reduce'].includes(s.settings?.motion) || !validLocks(s.locks) || s.order !== undefined && (sampling || s.order !== ORDER) || s.more !== undefined && !(!sampling && Array.isArray(s.more) && s.more.every(id => extras.some(b => b.id === id))) || s.reached !== undefined && !(Number.isInteger(s.reached) && s.reached >= 0 && s.reached < (sampling ? boards.length : s.order === ORDER ? course.length : ALL.length))) throw Error('Invalid save');
      saved = s;
    }
  } catch (_) { corrupt = true; }
  const finished = new Set(saved?.finished || []), more = new Set(saved?.more || []);
  // Progress. A course board is open up to `reached`, a place in the course: a
  // fresh save opens the first, and solving a board opens the next for good.
  // More boards open once the course's last board closes; one already finished,
  // or open before the course was cut to twenty-five, stays open (`more`).
  // The samples are all open.
  const place = id => course.findIndex(b => b.id === id), oldPlace = id => ALL.findIndex(b => b.id === id);
  let reached = 0, current = boards.find(b => b.id === saved?.board) || boards[0];
  if (sampling) reached = boards.length - 1;
  else if (saved && saved.order === ORDER) reached = Math.min(course.length - 1, Math.max(saved.reached ?? 0, place(current.id), ...[...finished].map(id => place(id) + (place(id) >= 0 ? 1 : 0))));
  else if (saved) {
    // A save from the fifty-board course counted places among all fifty, and
    // one from before the campaign could choose any of the first twelve, as
    // finishing the twelfth opened the thirteenth. Every board it had open
    // stays open: the course up to the furthest of them, and the cut ones
    // under More boards. Finished boards stay finished.
    const was = Math.min(ALL.length - 1, Math.max(saved.reached ?? 11, oldPlace(current.id), ...[...finished].map(id => oldPlace(id) + 1)));
    reached = Math.min(course.length - 1, Math.max(0, ...course.map((b, n) => oldPlace(b.id) <= was ? n : 0), ...course.map((b, n) => finished.has(b.id) ? n + 1 : 0)));
    for (const b of extras) if (oldPlace(b.id) <= was && !finished.has(b.id)) more.add(b.id);
    // A player on a cut board moves to the nearest open course board, by the
    // old order, an unfinished one first; that board starts fresh.
    if (!course.includes(current)) {
      const from = oldPlace(current.id), open = course.slice(0, reached + 1), near = list => list.sort((a, b) => Math.abs(oldPlace(a.id) - from) - Math.abs(oldPlace(b.id) - from) || oldPlace(b.id) - oldPlace(a.id))[0];
      current = near(open.filter(b => !finished.has(b.id))) || near(open);
    }
  }
  const resume = saved && current.id === saved.board;
  let rots = resume ? saved.rots.slice() : current.start.slice(), hits = resume ? saved.hits : 0, offsets = resume && saved.offsets ? saved.offsets.slice() : startOffsets(current);
  let history = resume ? saved.history : [], hint = null, focus = middle(current), hover = null, keyboard = false, pressed = null;
  // A player can lock a tile they are sure of: a locked tile refuses every
  // turn until unlocked. Locks are not moves: no hits, no undo, kept per board
  // in the save and cleared by restart.
  const lockBook = {}; for (const [id, list] of Object.entries(saved?.locks || {})) if (list.length) lockBook[id] = list.slice();
  let locks = new Set(lockBook[current.id] || []);
  const special = b => !!(b.links || b.rings);
  const settings = { theme: 'system', motion: 'system', ...saved?.settings }, pars = new Map(boards.map(b => [b.id, special(b) ? E.parAll(b) : E.par(b)]));
  // Palettes follow the fifty boards' id order, so a board keeps its colours wherever it is played.
  const hue = b => (sampling ? boards : ALL).indexOf(b) % palettes.length;
  const isExtra = b => !sampling && extras.includes(b);
  const isOpen = b => sampling || (isExtra(b) ? finished.has(FINALE.id) || finished.has(b.id) || more.has(b.id) : place(b.id) >= 0 && place(b.id) <= reached);
  // The first course board not yet finished; on the course's last board with none left, Next starts New Game+.
  const courseLeft = () => course.find(b => !finished.has(b.id)) || null;
  const plusEnd = () => !sampling && current === FINALE && !courseLeft();
  // A solve opens the next course board.
  const progress = () => { if (!sampling && place(current.id) >= 0) reached = Math.max(reached, Math.min(course.length - 1, place(current.id) + 1)); };
  // Names: course boards by place, "Board 6 of 25"; More boards as +1 to +25.
  const extraNo = b => extras.indexOf(b) + 1;
  const label = b => sampling ? `Board ${boards.indexOf(b) + 1} of ${boards.length}` : isExtra(b) ? `More board ${extraNo(b)} of ${extras.length}` : `Board ${place(b.id) + 1} of ${course.length}`;
  const counter = b => sampling ? `${boards.indexOf(b) + 1} / ${boards.length}` : isExtra(b) ? `+${extraNo(b)}` : `${place(b.id) + 1} / ${course.length}`;
  // The first boards show each tile's edge until the first turn, then fade it.
  let openerFade = 0, openerEdges = null;
  const opener = () => !sampling && place(current.id) >= 0 && place(current.id) < OPENERS && (hits === 0 && !history.length || openerFade && performance.now() - openerFade < 650);
  // Tile borders are an option, off unless a save says 'on'.
  settings.borders = settings.borders === 'on' ? 'on' : 'off';
  // The board as it stands, with its rings turned; plain boards are themselves.
  const arranged = () => E.arrange(current, offsets);
  let queue = [], busy = false, epoch = 0, animation = null, gesture = null, wheel = null, nextReady = E.solved(arranged(), rots), locked = false, typing = false;
  let ink, dots, marks, groups = [], twins = [], aids = new Map(), rims = new Map();
  let finish = null, finishComplete = false, regrowTimer = null;
  const frames = new Map();
  const reduced = () => settings.motion === 'reduce' || reducedQuery.matches;
  const dark = () => settings.theme === 'dark' || settings.theme === 'system' && darkQuery.matches;
  function svg(tag, attrs, parent) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.append(n); return n; }
  const xy = p => `${p.x} ${p.y}`;
  const cubic = p => `C${xy(p[1])} ${xy(p[2])} ${xy(p[3])}`;
  const hex = (t, radius = .97) => { const c = E.center(t.q, t.r); return Array.from({ length: 6 }, (_, k) => { const v = E.vertex(k); return `${c.x + v.x * radius},${c.y + v.y * radius}`; }).join(' '); };
  function announce(message) { const n = $('#announcement'); n.textContent = ''; n.textContent = message; }
  // Counts are said as a person would: 1 hit, 2 hits; 1 edge, 2 edges.
  const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`, hitsWord = () => count(hits, 'hit'), looseWord = n => `${count(n, 'edge')} with loose ends`;
  function state() { const a = arranged(), out = { rots: rots.slice(), loose: E.loose(a, rots), solved: E.solved(a, rots), hits, par: pars.get(current.id) }; if (current.rings) out.offsets = offsets.slice(); return out; }
  function save() {
    if (corrupt) return;
    try { localStorage.setItem(KEY, JSON.stringify({ board: current.id, rots, hits, history, finished: [...finished], settings, ...(current.rings ? { offsets } : {}), ...(Object.keys(lockBook).length ? { locks: lockBook } : {}), ...(sampling ? {} : { order: ORDER, reached, ...(more.size ? { more: [...more] } : {}) }) })); } catch (_) {}
  }
  function fit() {
    if (!frames.has(current.id)) {
      // Keep one frame through play and completion, measured from the ink in
      // the opening and answer. Invisible portions of edge tiles need no rim.
      const measure = svg('g', { visibility: 'hidden' }, board);
      const plain = !special(current), answer = plain ? E.solve(current, 1).solution.map(r => r[0]) : null, sol = plain ? null : E.solveAll(current, current.start, startOffsets(current), 1).solution;
      const layouts = plain ? [[current, current.start], [current, answer]] : [[E.arrange(current, startOffsets(current)), current.start], [E.arrange(current, sol.offsets), sol.finals.map(f => f[0])]];
      for (const [shape, turns] of layouts) shape.tiles.forEach((t, i) => {
        for (const pair of t.pairs) { const p = E.curve(t, turns[i], pair); svg('path', { d: `M${xy(p[0])} ${cubic(p)}` }, measure); }
      });
      const b = measure.getBBox(); frames.set(current.id, { x: b.x - .18, y: b.y - .18, width: b.width + .36, height: b.height + .36 }); measure.remove();
    }
    const f = frames.get(current.id), shell = $('#board-shell'), rail = matchMedia('(orientation:landscape) and (max-height:500px)').matches;
    // Under the board a 72 px band (#completion) is kept, so a board that fills the height leaves the Next disc,
    // which then stands on the toolbar's row, clear of its lines.
    const scale = Math.min((shell.clientWidth - (rail ? 48 : 0)) / f.width, (shell.clientHeight - (rail ? 0 : 72)) / f.height);
    board.setAttribute('viewBox', `${f.x} ${f.y} ${f.width} ${f.height}`);
    board.style.width = `${f.width * scale}px`; board.style.height = `${f.height * scale}px`;
    // Lines stay a ninth of a tile wide on dense boards but never thicker than 6 px.
    px = scale; const line = String(Math.min(1 / 9, 6 / scale)); board.style.setProperty('--line', line);
  }
  function rings() {
    if (!marks) return; marks.replaceChildren();
    // A solved board is a finished picture: nothing marks a tile on it.
    if (!locked) {
      const a = arranged();
      if (hover !== null) svg('polygon', { class: 'hover-ring', points: hex(a.tiles[hover]), 'aria-hidden': true }, marks);
      // The tile under a press, with any tiles linked to it, is outlined in ink while the press lasts and for a
      // moment after, so which piece turns is plain on boards whose tiles have no borders. It fades once let go;
      // under reduced motion it stands and then goes. The marks are redrawn often, so the fade is placed in time.
      if (pressed) for (const j of pressed.tiles) { const n = svg('polygon', { class: 'press-ring', points: hex(a.tiles[j]), 'data-tile': j, 'aria-hidden': true }, marks); if (pressed.released !== null) { n.dataset.fading = ''; n.style.animationDelay = `-${Math.round(performance.now() - pressed.released)}ms`; } }
      if (keyboard) svg('polygon', { class: 'focus-ring', points: hex(a.tiles[focus], .92), 'data-tile': focus, 'aria-hidden': true }, marks);
      // A hint marks the tile, its whole linked group, or every tile of a ring.
      if (hint) for (const i of hint.ring !== undefined ? a.tiles.map((t, i) => i).filter(i => E.ring(a.tiles[i].q, a.tiles[i].r) === hint.ring) : hint.tiles || [hint.tile]) svg('polygon', { class: 'hint-ring', points: hex(a.tiles[i], .84), 'aria-hidden': true }, marks);
    }
    const s = state();
    board.setAttribute('aria-label', `${label(current)}. ${s.solved ? 'Every line closed' : looseWord(s.loose.length)}. ${hitsWord()}; par ${s.par}.` + (s.solved ? '' : ` Focus tile ${focus + 1}, turn ${rots[focus] + 1} of 6.`));
  }
  function updateChrome() {
    $('#readout').textContent = `${counter(current)} · ${hits} / ${pars.get(current.id)}`;
    $('#undo-btn').disabled = !history.length && !busy;
    locked = E.solved(arranged(), rots); if (locked) hover = null;
    board.tabIndex = locked ? -1 : 0; board.dataset.locked = String(locked);
    // On board 25 with every course board finished, Next starts New Game+ and the end line stands above it.
    const end = nextReady && plusEnd();
    $('#next-btn').hidden = !nextReady || last(); $('#next-btn').setAttribute('aria-label', end ? 'Start New Game+' : 'Next board');
    $('#end-line').hidden = !end; $('#end-line').textContent = end ? `All ${course.length} boards solved.` : '';
    board.dataset.solved = String(locked); board.dataset.busy = String(busy); rings();
  }
  // The finish is one reveal: the solved board turns out to be a piece of a
  // whole Mandaza. Its tiles are cells of one hex grid whose other cells come
  // from the original generator; the view eases out until the board's tiles
  // are Mandaza-sized cells, and every loop of the picture, the board's too,
  // starts drawing at the same moment. It is drawn on two canvases over the
  // board, as Mandaza draws: every frame clears and strokes every loop, each in
  // its own drifting colour; a blurred copy of the lines under them is the glow.
  const layer = $('#finish'), glowCanvas = layer.querySelector('.glow'), lineCanvas = layer.querySelector('.lines');
  const lctx = lineCanvas.getContext('2d'), gctx = glowCanvas.getContext('2d');
  let dpr = 1;
  // The glow is a quarter-size copy of the lines, blurred as it is drawn where
  // the browser can, and stretched back over the page under them.
  const GLOW = 4, softens = (() => { try { gctx.filter = 'blur(1px)'; return gctx.filter === 'blur(1px)'; } catch (_) { return false; } })();
  layer.dataset.soften = String(softens);
  // The fade of the monochrome ink as the reveal begins.
  const FADE = 420;
  const ease = p => p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
  function sizeCanvas() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(layer.clientWidth * dpr), h = Math.round(layer.clientHeight * dpr);
    if (lineCanvas.width !== w || lineCanvas.height !== h) { lineCanvas.width = w; lineCanvas.height = h; }
    const gw = Math.ceil(w / GLOW), gh = Math.ceil(h / GLOW);
    if (glowCanvas.width !== gw || glowCanvas.height !== gh) { glowCanvas.width = gw; glowCanvas.height = gh; }
  }
  function blank() { for (const [c, x] of [[lineCanvas, lctx], [glowCanvas, gctx]]) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); } }
  // The board scales about its own centre, the centre of the picture.
  function setZoom(z) {
    // Back at full scale the transform always goes, even before a new board is measured.
    if (z >= .9999) { board.style.transform = ''; return; }
    const f = frames.get(current.id); if (!f) return;
    board.style.transformOrigin = `${-f.x * px}px ${-f.y * px}px`; board.style.transform = z < .9999 ? `scale(${z})` : '';
  }
  function stopDrift() { if (finish?.frame) cancelAnimationFrame(finish.frame); if (finish) { finish.frame = 0; finish.last = null; } }
  function clearFinish() {
    stopDrift(); finish = null; finishComplete = false; clearTimeout(regrowTimer); blank(); setZoom(1);
    if (ink) ink.style.opacity = ''; delete board.dataset.reveal;
    delete document.body.dataset.field; delete layer.dataset.tile; delete layer.dataset.zoom;
  }
  // Loop i of n takes the palette at i / (n - 1), shifted by Mandaza's idle
  // pulse, 0.18 sin(time / 2500 + i × 0.6), reflected at either end. Board
  // loops come first, so colour flows from the board outward. A palette stop
  // that would vanish into the ground is left out: near-black stops on black,
  // near-white stops on white (sRGB relative luminance).
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const visibleStops = (palette, night) => palette.filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  function loopColour(order, total, time, palette) {
    let t = total > 1 ? order / (total - 1) : .5;
    t += .18 * Math.sin(time / 2500 + order * .6);
    t = Math.min(.99999, Math.max(0, t < 0 ? -t : t > 1 ? 2 - t : t));
    const at = t * (palette.length - 1), i = Math.min(Math.floor(at), palette.length - 2), f = at - i;
    return `rgb(${palette[i].map((v, channel) => Math.round(v + (palette[i + 1][channel] - v) * f)).join(', ')})`;
  }
  const palette = () => visibleStops(palettes[hue(current)], dark());
  // Board loops are ordered from the centre outward; loops at one distance go by angle.
  const radial = (a, b) => (Math.round(Math.hypot(a.x, a.y) * 1e6) - Math.round(Math.hypot(b.x, b.y) * 1e6)) || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x);
  const driftTime = () => finish && !reduced() ? finish.clock : 0;
  // Restarts the frame loop after a pause, a sheet or a change of settings.
  function syncFinish() {
    if (!finish) return;
    layer.dataset.night = String(dark());
    if (!finish.frame) { finish.last = null; finish.frame = requestAnimationFrame(frameFinish); }
  }
  function render(showFinish = true) {
    clearFinish(); clearTimeout(shimmerTimer);
    board.replaceChildren(); groups = [];
    const targets = svg('g', { 'aria-hidden': true }, board), shape = arranged();
    shape.tiles.forEach((t, i) => svg('polygon', { class: 'tile-hit', 'data-tile': i, points: hex(t, 1) }, targets));
    // Marks for turning rings, as chosen by ?ring=, in the theme's greys.
    const defs = svg('defs', {}, board), lineWidth = Math.min(1 / 9, 6 / px);
    svg('feDropShadow', { class: 'lift-shadow', dx: 0, dy: .05, stdDeviation: .07 }, svg('filter', { id: 'loop-lift', x: -.3, y: -.3, width: 1.6, height: 1.6 }, defs));
    svg('feGaussianBlur', { stdDeviation: .2 }, svg('filter', { id: 'loop-soft', x: -.5, y: -.5, width: 2, height: 2 }, defs));
    const sheen = svg('linearGradient', { id: 'loop-sheen', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    for (const [o, v] of [[0, 0], [.45, 0], [1, 1]]) svg('stop', { offset: o, class: 'sheen-stop', 'stop-opacity': v }, sheen);
    const guides = svg('g', { class: 'guides', 'aria-hidden': true }, board), aidLayer = svg('g', { class: 'aids', 'aria-hidden': true }, board);
    twins = []; aids = new Map(); aidShown = null; delete board.dataset.lift;
    if (current.rings) {
      const at = new Set(shape.tiles.map(t => t.q + ',' + t.r)), seams = [];
      for (const t of shape.tiles) for (let k = 0; k < 6; k++) {
        const q = t.q + E.DIRS[k][0], r = t.r + E.DIRS[k][1], mine = E.ring(t.q, t.r), theirs = E.ring(q, r);
        if (!at.has(q + ',' + r) || theirs <= mine || !current.rings.includes(mine) && !current.rings.includes(theirs)) continue;
        const c = E.center(t.q, t.r), v0 = E.vertex(k), v1 = E.vertex((k + 1) % 6);
        seams.push(`M${c.x + v0.x} ${c.y + v0.y}L${c.x + v1.x} ${c.y + v1.y}`);
      }
      if (RING === 'groove') { svg('path', { class: 'groove', d: seams.join(''), 'stroke-width': .16, filter: 'url(#loop-soft)' }, guides); svg('path', { class: 'groove-line', d: seams.join('') }, guides); }
      else for (const d of seams) svg('path', { class: 'ring-line', d }, guides);
      for (const k of current.rings) {
        const clip = svg('clipPath', { id: 'loop-ring-' + k }, defs), reach = k * 1.8 + 1.4;
        for (const t of shape.tiles) if (E.ring(t.q, t.r) === k) svg('polygon', { points: hex(t, 1) }, clip);
        const aid = { k };
        if (RING === 'light') {
          // A soft lit sector of the ring, turned to the pointer's angle.
          aid.glow = svg('g', { class: 'ring-light', 'clip-path': `url(#loop-ring-${k})`, opacity: 0 }, aidLayer);
          const w = Math.PI / 5; aid.turn = svg('path', { d: `M0 0L${reach * Math.cos(-w)} ${reach * Math.sin(-w)}A${reach} ${reach} 0 0 1 ${reach * Math.cos(w)} ${reach * Math.sin(w)}Z`, filter: 'url(#loop-soft)' }, aid.glow);
        }
        if (RING === 'groove') {
          // Light falling across the lifted ring from the pointer's side.
          aid.glow = svg('g', { class: 'ring-sheen', 'clip-path': `url(#loop-ring-${k})`, opacity: 0 }, aidLayer);
          aid.turn = svg('rect', { x: -reach, y: -reach, width: 2 * reach, height: 2 * reach, fill: 'url(#loop-sheen)' }, aid.glow);
        }
        if (RING === 'bezel') {
          // A thin track just outside the ring with fine ticks, turning with it.
          const r = bezel(k), ticks = [];
          for (let n = 0; n < 36; n++) { const a = n * Math.PI / 18, long = n % 6 === 0 ? .2 : .09; ticks.push(`M${(r - long / 2) * Math.cos(a)} ${(r - long / 2) * Math.sin(a)}L${(r + long / 2) * Math.cos(a)} ${(r + long / 2) * Math.sin(a)}`); }
          aid.dial = svg('g', { class: 'ring-bezel', 'data-ring': k, transform: 'rotate(0 0 0)' }, aidLayer);
          svg('circle', { class: 'bezel-track', r }, aid.dial); svg('path', { class: 'bezel-ticks', d: ticks.join('') }, aid.dial);
        }
        aids.set(k, aid);
      }
    }
    // Faint hairline borders round every tile, under the lines and tints, shown
    // when the setting is on. A turning ring's borders turn with it; a tile's
    // own turns and nudges leave its border still.
    const borders = svg('g', { class: 'borders', 'aria-hidden': true }, board), still = svg('g', {}, borders); rims = new Map();
    for (const k of current.rings || []) rims.set(k, svg('g', { 'data-ring': k, transform: 'rotate(0 0 0)' }, borders));
    for (const t of shape.tiles) svg('polygon', { class: 'tile-border', points: hex(t, 1) }, rims.get(E.ring(t.q, t.r)) || still);
    // On the first boards each tile's edge shows until the first turn, so the
    // piece a tap turns is plain before any press, then fades in 0.6 s.
    if (opener() && !E.solved(shape, rots)) {
      const edges = svg('g', { class: 'opener', 'aria-hidden': true }, board);
      if (hits || history.length) { edges.dataset.fading = ''; edges.style.animationDelay = `-${Math.round(performance.now() - openerFade)}ms`; }
      for (const t of shape.tiles) svg('polygon', { class: 'opener-edge', points: hex(t, 1) }, edges);
      openerEdges = edges;
    } else openerEdges = null;
    ink = svg('g', { class: 'paint' }, board); dots = svg('g', { class: 'ends' }, board); marks = svg('g', { class: 'marks' }, board);
    shape.tiles.forEach((t, i) => {
      const c = E.center(t.q, t.r), g = svg('g', { 'data-tile': i, transform: `rotate(0 ${xy(c)})`, ...((current.rings || []).includes(E.ring(t.q, t.r)) ? { 'data-ring': E.ring(t.q, t.r) } : {}) }, ink); groups.push(g);
      for (const pair of t.pairs) { const p = E.curve(t, rots[i], pair); svg('path', { class: 'ink', d: `M${xy(p[0])} ${cubic(p)}` }, g); }
      if (locks.has(i)) lockMark(g, t);
    });
    // A linked tile shows on its own lines: each line's stretch inside the tile
    // is tinted, one hue and lightness per group, over the untinted line. Where
    // a line runs on into the next tile the tint stops square at the edge, so
    // the loop changes tint there with no gap and no cap; a loose end keeps its
    // round end, tinted. The tints turn with their tiles.
    const tints = svg('g', { class: 'tints', 'aria-hidden': true }, ink), loose = E.loose(shape, rots);
    (current.links || []).forEach((group, gi) => group.forEach(j => {
      const t = shape.tiles[j], c = E.center(t.q, t.r), open = new Set(loose.filter(l => l.tile === j).map(l => l.edge));
      const edgeOf = q => mod(Math.floor(Math.atan2(q.y - c.y, q.x - c.x) * 3 / Math.PI));
      const g = svg('g', { class: 'tint tint-' + gi % 3, 'data-tile': j, 'data-group': gi, transform: `rotate(0 ${xy(c)})` }, tints);
      for (const pair of t.pairs) {
        const p = E.curve(t, rots[j], pair); svg('path', { d: `M${xy(p[0])} ${cubic(p)}` }, g);
        for (const q of [p[0], p[3]]) if (open.has(edgeOf(q))) svg('path', { class: 'cap', d: `M${xy(q)}h0` }, g);
      }
      twins[j] = [g];
    }));
    fit();
    // The edges stay within the board's frame, clear of the readout and toolbar.
    if (openerEdges) { const f = frames.get(current.id), clip = svg('clipPath', { id: 'loop-opener-clip' }, defs); svg('rect', { x: f.x, y: f.y, width: f.width, height: f.height }, clip); openerEdges.setAttribute('clip-path', 'url(#loop-opener-clip)'); }
    const closed = showFinish && E.solved(arranged(), rots);
    if (closed) makeFinish();
    updateChrome();
    // A finished board shown again (a reload, undo to a closed board, a closed
    // sheet) appears as the whole picture at once, once it is planned.
    if (closed) { const token = epoch; growField().then(ready => { if (!ready || token !== epoch) return; completeFinish(); finishComplete = true; syncFinish(); updateChrome(); }); }
    else sizePicture();
  }
  function tween(ms, draw) {
    if (reduced() || document.hidden) { draw(1); return Promise.resolve(true); }
    return new Promise(resolve => {
      const start = performance.now(); let frame;
      function finish(result) { cancelAnimationFrame(frame); if (animation?.finish === complete) animation = null; resolve(result); }
      function complete() { draw(1); finish(true); }
      animation = { finish: complete, cancel: () => finish(false) };
      function tick(now) { const p = Math.min(1, (now - start) / ms); draw(p); if (p === 1) finish(true); else frame = requestAnimationFrame(tick); }
      draw(0); frame = requestAnimationFrame(tick);
    });
  }
  // A cubic's point at u.
  const at = (p, u) => { const v = 1 - u, w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u]; return { x: w[0] * p[0].x + w[1] * p[1].x + w[2] * p[2].x + w[3] * p[3].x, y: w[0] * p[0].y + w[1] * p[1].y + w[2] * p[2].y + w[3] * p[3].y }; };
  // The page in CSS pixels, and the board's own mapping onto it, unzoomed.
  function view() { const b = layer.getBoundingClientRect(); return b.width && b.height ? { width: b.width, height: b.height } : null; }
  function boardMatrix() {
    const kept = board.style.transform; board.style.transform = '';
    const m = board.getScreenCTM(), b = layer.getBoundingClientRect(); board.style.transform = kept;
    return m && m.a ? { a: m.a, e: m.e - b.left, f: m.f - b.top } : null;
  }
  // The board's mapping at the zoom of the moment.
  const viewOf = f => ({ a: f.base.a * f.z, e: f.base.e, f: f.base.f });

  // Mandaza's own pieces, ported from mandaza.app: the Mash generator, the
  // split and length of a cubic, and a loop that draws itself cubic by cubic.
  function Mash(seed) {
    let n = 0xefc8249d;
    function mash(data) {
      data = String(data);
      for (let i = 0; i < data.length; i++) { n += data.charCodeAt(i); let h = 0.02519603282416938 * n; n = h >>> 0; h -= n; h *= n; n = h >>> 0; h -= n; n += h * 0x100000000; }
      return (n >>> 0) * 2.3283064365386963e-10;
    }
    mash(seed);
    const next = () => mash('A');
    next.intAlea = (min, max) => { if (max === undefined) { max = min; min = 0; } return Math.floor(min + (max - min) * next()); };
    next.alea = (min, max) => max === undefined ? min * next() : min + (max - min) * next();
    return next;
  }
  const lerp = (p0, p1, a) => ({ x: a * p1.x + (1 - a) * p0.x, y: a * p1.y + (1 - a) * p0.y });
  const gap = (p0, p1) => Math.hypot(p1.x - p0.x, p1.y - p0.y);
  function split(c, a) {
    const pa = lerp(c[0], c[1], a), pb = lerp(c[1], c[2], a), pc = lerp(c[2], c[3], a), pd = lerp(pa, pb, a), pe = lerp(pb, pc, a), pf = lerp(pd, pe, a);
    return [[c[0], pa, pd, pf], [pf, pe, pc, c[3]]];
  }
  function cubicLength(c) { const d0 = split(c, .5), d1 = split(d0[0], .5), d2 = split(d0[1], .5); return gap(d1[0][0], d1[0][3]) + gap(d1[1][0], d1[1][3]) + gap(d2[0][0], d2[0][3]) + gap(d2[1][0], d2[1][3]); }
  // A closed curve as Mandaza draws it, in tile units: the completed cubics are
  // kept in one Path2D, and the cubic in flight is split at the distance reached.
  class Trace {
    constructor(bezier) {
      this.bezier = bezier; this.lengths = bezier.map(cubicLength); this.length = this.lengths.reduce((a, b) => a + b, 0);
      let sx = 0, sy = 0; bezier.forEach((c, i) => { const m = at(c, .5); sx += m.x * this.lengths[i]; sy += m.y * this.lengths[i]; });
      this.centre = { x: sx / this.length, y: sy / this.length }; this.reset();
    }
    reset() { this.path = new Path2D(); this.path.moveTo(this.bezier[0][0].x, this.bezier[0][0].y); this.next = 0; this.drawnLength = 0; this.pos = 0; this.started = null; }
    get done() { return this.next >= this.bezier.length; }
    // Moves on by d tile radii; true while still drawing.
    advance(d, now) {
      if (this.done) return false;
      if (this.started === null) this.started = now ?? 0;
      this.pos += d;
      while (this.next < this.bezier.length && this.pos >= this.drawnLength + this.lengths[this.next]) {
        const c = this.bezier[this.next]; this.path.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
        this.drawnLength += this.lengths[this.next++];
      }
      return !this.done;
    }
    shape() {
      if (this.done) return this.path;
      const p = new Path2D(this.path), frag = split(this.bezier[this.next], (this.pos - this.drawnLength) / this.lengths[this.next])[0];
      p.bezierCurveTo(frag[1].x, frag[1].y, frag[2].x, frag[2].y, frag[3].x, frag[3].y);
      return p;
    }
  }

  // The board's loops in tile units, each cubic turned along its direction of travel.
  function makeFinish() {
    const shape = arranged(), board = E.loops(shape, rots).map(loop => {
      let end = null; const bezier = [];
      for (const [i, j] of loop) {
        let p = E.curve(shape.tiles[i], rots[i], shape.tiles[i].pairs[j]);
        if (end && gap(end, p[3]) < gap(end, p[0])) p = p.slice().reverse();
        bezier.push(p); end = p[3];
      }
      const t = new Trace(bezier); t.closed = gap(bezier[0][0], end) < 1e-6; return t;
    }).sort((x, y) => radial(x.centre, y.centre));
    board.forEach((t, i) => { t.order = i; });
    finish = { board, field: [], plan: null, total: board.length, base: boardMatrix() || { a: px, e: 0, f: 0 }, z: 1, clock: 0, elapsed: 0, last: null, frame: 0, go: false, onReveal: null, times: [] };
    layer.dataset.night = String(dark());
  }
  const loopsOf = f => f.field.length ? f.board.concat(f.field) : f.board;
  // The whole picture at once: a reload, a regrown field, reduced motion.
  function completeFinish() {
    const f = finish; if (!f || !f.plan) return;
    for (const t of loopsOf(f)) t.advance(Infinity, f.last ?? 0);
    f.go = true; f.whole = true; f.elapsed = Math.max(f.elapsed, REVEAL_ZOOM); f.z = f.plan.zoom; setZoom(f.z);
    ink.style.visibility = 'hidden'; document.body.dataset.field = 'on'; board.dataset.reveal = 'on';
  }
  // The reveal: every loop starts at once; the promise settles when the view
  // has eased out and the board's loops have closed. Reduced motion shows the
  // whole picture at once.
  function reveal() {
    const f = finish; f.go = true; document.body.dataset.field = 'on'; board.dataset.reveal = 'on';
    if (reduced() || document.hidden) { completeFinish(); syncFinish(); return Promise.resolve(true); }
    return new Promise(resolve => {
      function settle(result) { if (animation?.finish === complete) animation = null; f.onReveal = null; resolve(result); }
      function complete() { completeFinish(); settle(true); }
      animation = { finish: complete, cancel: () => settle(false), trace: true };
      f.onReveal = () => settle(true);
      syncFinish();
    });
  }
  // One frame: ease the view, advance every loop at Mandaza's speed in screen
  // pixels, then clear and stroke every loop in its colour of the moment, and
  // copy the lines onto the glow layer.
  function frameFinish(now) {
    const f = finish; if (!f) return; f.frame = 0;
    const still = reduced(), dt = f.last === null || document.hidden ? 0 : Math.min(64, now - f.last); f.last = now;
    if (!still) f.clock += dt;
    if (f.go && f.plan) {
      f.elapsed += dt;
      const p = still ? 1 : Math.min(1, f.elapsed / REVEAL_ZOOM);
      f.z = 1 + (f.plan.zoom - 1) * ease(p); setZoom(f.z);
      if (ink.style.visibility !== 'hidden') { const o = still ? 0 : Math.max(0, 1 - f.elapsed / FADE); ink.style.opacity = o; if (!o) ink.style.visibility = 'hidden'; }
      const step = still ? Infinity : dt * REVEAL_SPEED / (f.base.a * f.z);
      let open = false;
      for (const t of f.board) open = t.advance(step, now) || open;
      for (const t of f.field) t.advance(step, now);
      if (f.onReveal && p >= 1 && !open) f.onReveal();
      if (!f.whole && !open && f.field.every(t => t.done)) { f.whole = true; if (finishComplete) updateChrome(); }
    }
    paintFinish();
    f.times.push(now); while (f.times.length && now - f.times[0] > 1000) f.times.shift();
    if (!still || f.onReveal) f.frame = requestAnimationFrame(frameFinish);
  }
  function paintFinish() {
    const f = finish; sizeCanvas(); blank(); if (!f || !f.go || !f.plan) return;
    const v = viewOf(f), colours = palette(), time = driftTime();
    lctx.lineCap = lctx.lineJoin = 'round';
    lctx.setTransform(dpr * v.a, 0, 0, dpr * v.a, dpr * v.e, dpr * v.f); lctx.lineWidth = f.plan.lineTile;
    // Loops whose colour of the moment is the same share one stroke.
    const groups = new Map();
    for (const t of loopsOf(f)) { if (!t.pos) continue; const c = t.colour = loopColour(t.order, f.total, time, colours); let g = groups.get(c); if (!g) groups.set(c, g = new Path2D()); g.addPath(t.shape()); }
    for (const [c, g] of groups) { lctx.strokeStyle = c; lctx.stroke(g); }
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    if (softens) gctx.filter = dark() ? `blur(${f.plan.glow * dpr / GLOW}px)` : `brightness(0) blur(${Math.max(.5, f.plan.cellPx * .044 * dpr / GLOW)}px)`;
    gctx.drawImage(lineCanvas, 0, 0, glowCanvas.width, glowCanvas.height); gctx.filter = 'none';
  }

  // The rest of the picture, generated as Mandaza generates one: the board's
  // own hex grid, one row of the dot table for every edge, dots placed and
  // paired with the regularity and concentric loop building of the original,
  // from the centre outward. The board's tiles are cells of that grid. A solved
  // board's rim carries no dots, so its outer edges are generated like any
  // other: in each rim tile they form one run that no puzzle curve divides,
  // and the new curves there pair only those dots, so they never cross the
  // puzzle's, and the picture runs on into the board. The seed is the board
  // id and the page size, so a board always grows the same picture on the
  // same page. Where the original closes one dot in each odd cell, leaving a
  // loose end, the picture changes edges by one along short paths between odd
  // cells, so every curve closes, as on the board.
  const distance = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  function around(k) {
    if (!k) return [[0, 0]];
    const out = []; let q = E.DIRS[4][0] * k, r = E.DIRS[4][1] * k;
    for (let d = 0; d < 6; d++) for (let j = 0; j < k; j++) { out.push([q, r]); q += E.DIRS[d][0]; r += E.DIRS[d][1]; }
    return out;
  }
  // Mandaza's cell geometry: vertex k and the inward normal of edge k (edge k
  // runs from vertex k to k + 1, starting at the top), and the neighbour across
  // edge k in axial steps. Mandaza's edge k is the engine's edge k + 4.
  const S3 = Math.sqrt(3), XS = [-.5, .5, 1, .5, -.5, -1], YS = [-S3 / 2, -S3 / 2, 0, S3 / 2, S3 / 2, 0], XP = [0, -S3 / 2, -S3 / 2, 0, S3 / 2, S3 / 2], YP = [1, .5, -.5, -1, -.5, .5];
  const STEP = [0, 1, 2, 3, 4, 5].map(k => E.DIRS[(k + 4) % 6]);
  // One width for every line at the reveal's scale: Mandaza's radius / 30 × 1.2,
  // and at least 2.4 px so it holds on a phone.
  const lineWidth = cellPx => Math.max(2.4, cellPx / 25);
  // Planning runs in slices of ten milliseconds a frame: it yields whenever
  // its slice is spent.
  const slice = { until: 0 };
  function* planField(v, m, ctx = { board: current, shape: arranged(), rots }) {
    const W = v.width, H = v.height, seed = `loop/${ctx.board.id}/${Math.round(W)}x${Math.round(H)}`, rndGen = Mash(seed + '/gen');
    // The reveal's scale: Mandaza-sized cells, near the size the middle
    // boards' tiles already are on this page. Larger tiles ease out to it.
    const cap = Math.max(34, Math.min(W, H) / 13), zoom = m.a > cap * 1.15 ? cap / m.a : 1, cellPx = m.a * zoom;
    const geometry = rndGen.intAlea(GEOMETRIES.length), pool = [];
    GEOMETRIES[geometry].forEach((count, nb) => { for (let k = 0; k < count; k++) pool.push(nb); });
    // The page in tile units at the reveal's scale, and one cell beyond it.
    const s = m.a * zoom, page = { x: -m.e / s, y: -m.f / s, width: W / s, height: H / s };
    const within = (q, r, e) => { const c = E.center(q, r); return c.x + 1 > page.x - e && c.x - 1 < page.x + page.width + e && c.y + 1 > page.y - e && c.y - 1 < page.y + page.height + e; };
    // Cells come ring by ring from the centre: the board's rim tiles (those
    // beside a gap or the outside), every gap inside the board, and every
    // cell on or just beyond the page.
    const shape = ctx.shape, R = ctx.board.radius, tileAt = new Map(shape.tiles.map((t, i) => [t.q + ',' + t.r, i]));
    const rim = (q, r) => E.DIRS.some(([dq, dr]) => !tileAt.has((q + dq) + ',' + (r + dr)));
    const cells = new Map(), list = [], key = (q, r) => (q + 4096) * 8192 + r + 4096;
    for (let k = 0, any = true; any; k++) {
      any = k <= R;
      for (const [q, r] of around(k)) {
        const tile = tileAt.get(q + ',' + r);
        if (tile !== undefined ? !rim(q, r) : k > R && !within(q, r, 1.75)) continue; any = true;
        const c = E.center(q, r), cell = { q, r, ring: k, tile, vertices: XS.map((x, i) => ({ x: c.x + x, y: c.y + YS[i] })) }; cells.set(key(q, r), cell); list.push(cell);
      }
      if (performance.now() > slice.until) yield;
    }
    // A rim tile meets only field cells here: its edges to other board tiles
    // carry the puzzle's own dots, already paired.
    for (const cell of list) cell.neighbors = STEP.map(([dq, dr]) => { const n = cells.get(key(cell.q + dq, cell.r + dr)); return n && (cell.tile === undefined || n.tile === undefined) ? n : undefined; });
    // A rim tile whose open edges fall in more than one run (beside a gap and
    // the outside both) keeps only its longest run open, so the new curves in
    // it never have to cross the puzzle's.
    for (const cell of list) {
      if (cell.tile === undefined) continue;
      const runs = []; let from = 0; while (from < 6 && cell.neighbors[from] && cell.neighbors[(from + 5) % 6]) from++;
      for (let j = 0; j < 6; j++) { const k = (from + j) % 6; if (!cell.neighbors[k]) continue; if (!runs.length || !cell.neighbors[(k + 5) % 6]) runs.push([]); runs[runs.length - 1].push(k); }
      if (runs.length < 2) continue;
      const keep = runs.reduce((a, b) => b.length > a.length ? b : a);
      for (const run of runs) if (run !== keep) for (const k of run) { const n = cell.neighbors[k]; n.neighbors[(k + 3) % 6] = undefined; cell.neighbors[k] = undefined; }
    }
    // Seams with the board: every field edge against a rim tile, with the
    // puzzle's dot count there (none, on a solved board).
    const seams = [];
    for (const cell of list) if (cell.tile === undefined) for (let dir = 0; dir < 6; dir++) {
      const other = cell.neighbors[dir]; if (!other || other.tile === undefined) continue;
      seams.push({ cell, other, q: cell.q, r: cell.r, dir, tile: other.tile, puzzle: E.countAt(shape.tiles[other.tile], ctx.rots[other.tile], ((dir + 3) % 6 + 4) % 6) });
    }
    const rndStruct = Mash(seed + '/struct');
    for (const cell of list) { cell.ndots = []; cell.dots = []; }
    // Dot counts per edge, drawn from the chosen row, as createGrid does.
    for (const cell of list) for (let dir = 0; dir < 6; dir++) {
      if (cell.ndots[dir] !== undefined) continue; const other = cell.neighbors[dir]; if (!other) continue;
      cell.ndots[dir] = other.ndots[(dir + 3) % 6] = pool[rndStruct.intAlea(pool.length)];
    }
    // Odd cells are paired along the shortest path of cells, each edge on it
    // changed by one dot, so every cell has an even number of dots.
    const odd = cell => cell.ndots.reduce((a, b) => a + (b || 0), 0) & 1;
    const change = (cell, dir) => { const n = cell.ndots[dir], to = n === 1 ? (rndStruct() < .5 ? 0 : 2) : n === 3 ? 2 : n === 0 ? 1 : (rndStruct() < .5 ? 1 : 3); cell.ndots[dir] = cell.neighbors[dir].ndots[(dir + 3) % 6] = to; };
    for (const start of list) {
      if (performance.now() > slice.until) yield;
      if (!odd(start)) continue;
      const from = new Map([[start, null]]), queue = [start];
      search: for (let i = 0; i < queue.length; i++) for (let dir = 0; dir < 6; dir++) {
        const next = queue[i].neighbors[dir]; if (!next || from.has(next)) continue;
        from.set(next, [queue[i], dir]);
        if (odd(next)) { for (let step = from.get(next); step; step = from.get(step[0])) change(step[0], step[1]); break search; }
        queue.push(next);
      }
    }
    // Dots, paired across each edge in mirrored order, placed along it.
    for (const cell of list) for (let dir = 0; dir < 6; dir++) {
      const n = cell.ndots[dir]; if (!n || cell.dots[dir]) continue;
      const other = cell.neighbors[dir], back = (dir + 3) % 6; cell.dots[dir] = []; other.dots[back] = [];
      for (let k = 0; k < n; k++) {
        const a = { cell, kedge: dir, index: k }, b = { cell: other, kedge: back, index: n - 1 - k };
        a.other = b; b.other = a; cell.dots[dir][k] = a; other.dots[back][n - 1 - k] = b;
      }
    }
    for (const cell of list) {
      cell.flat = [];
      // A rim tile's outer edges are taken in order round the tile from the
      // first of their run, so its dots pair as one face of the tile.
      let from = 0; if (cell.tile !== undefined) while (from < 6 && !(cell.neighbors[from] && !cell.neighbors[(from + 5) % 6])) from++;
      for (let j = 0; j < 6; j++) {
        const k = (from + j) % 6, n = cell.ndots[k]; if (!n) continue;
        const f = [[1 / 2], [3 / 8, 5 / 8], [9 / 32, 1 / 2, 23 / 32]][n - 1], p0 = cell.vertices[k], p1 = cell.vertices[(k + 1) % 6];
        cell.dots[k].forEach((dot, i) => { Object.assign(dot, lerp(p0, p1, f[i])); cell.flat.push(dot); });
      }
      cell.connectables = [cell.flat.slice()]; cell.actives = cell.flat.slice();
    }
    // Mandaza's loop building, with concentric pairing and regularity 5.
    const regularity = 5;
    function pickNextDot(cell, dotin, direct) {
      for (let kcon = 0; kcon < cell.connectables.length; kcon++) {
        const group = cell.connectables[kcon]; let k0 = group.indexOf(dotin), k1;
        if (k0 === -1) continue;
        if (rndStruct.intAlea(regularity) !== 0) k1 = direct ? (k0 + 1) % group.length : (k0 + group.length - 1) % group.length;
        else k1 = rndStruct.intAlea(group.length / 2) * 2 + ((k0 & 1) ^ 1);
        const dotout = group[k1];
        if (k1 < k0) [k0, k1] = [k1, k0];
        const inner = group.splice(k0, k1 + 1 - k0); inner.shift(); inner.pop();
        if (inner.length) cell.connectables.push(inner);
        if (!group.length) cell.connectables.splice(kcon, 1);
        return dotout;
      }
    }
    function build(dot) {
      const loop = { pairs: [], start: dot, closed: false };
      const extend = direct => {
        const dot0 = !loop.pairs.length ? loop.start : direct ? loop.pairs[loop.pairs.length - 1][1].other : loop.pairs[0][0].other;
        if (!dot0) return false;
        const dot1 = pickNextDot(dot0.cell, dot0, direct); if (!dot1) return false;
        if (direct) loop.pairs.push([dot0, dot1]); else loop.pairs.unshift([dot1, dot0]);
        return true;
      };
      for (let guard = 0; guard < 100000; guard++) {
        if (!extend(true)) break;
        if (loop.pairs[0][0].other === loop.pairs[loop.pairs.length - 1][1]) { loop.closed = true; break; }
      }
      if (!loop.closed) while (extend(false));
      for (const [a, b] of loop.pairs) a.loop = b.loop = loop;
      return loop;
    }
    const nextcw = (dot, step) => { const a = dot.cell.actives, n = a[(a.indexOf(dot) + step + a.length) % a.length]; return n.loop ? null : n; };
    // The original starts at its centre cell; the rest of this picture grows
    // outward from the full cell nearest the board.
    const loops = [], full = cell => cell.connectables[0].length && cell.neighbors.every((n, dir) => n && cell.ndots[dir]);
    const first = list.find(full) || list.find(cell => cell.connectables[0].length);
    if (first) {
      loops.push(build(first.connectables[0][Math.floor(first.connectables[0].length / 2)]));
      for (let k = 0; k < loops.length;) {
        let found = null;
        for (const [d0, d1] of loops[k].pairs) if ((found = nextcw(d0, 1) || nextcw(d1, -1) || nextcw(d0, -1) || nextcw(d1, 1))) break;
        if (found) loops.push(build(found)); else k++;
        if (performance.now() > slice.until) yield;
      }
      for (const cell of list) { for (const dot of cell.actives) if (!dot.loop) loops.push(build(dot)); if (performance.now() > slice.until) yield; }
    }
    // Mandaza's curves in each cell, in tile units.
    function toBezier(cell, p0, p1) {
      const bin = p0.kedge, bout = p1.kedge; let pa, pb, dd;
      switch (Math.abs(bout - bin)) {
        case 0: dd = .2; pa = { x: p0.x + XP[bin] * dd, y: p0.y + YP[bin] * dd }; pb = { x: p1.x + XP[bout] * dd, y: p1.y + YP[bout] * dd }; break;
        case 1: case 5: {
          const kc = bout - bin === -1 || bout - bin === 5 ? bin : bout, din = gap(cell.vertices[kc], p0), dout = gap(cell.vertices[kc], p1);
          pa = { x: p0.x + XP[bin] * .75 * dout, y: p0.y + YP[bin] * .75 * dout }; pb = { x: p1.x + XP[bout] * .75 * din, y: p1.y + YP[bout] * .75 * din }; break;
        }
        case 2: case 4: dd = .6; pa = { x: p0.x + XP[bin] * dd, y: p0.y + YP[bin] * dd }; pb = { x: p1.x + XP[bout] * dd, y: p1.y + YP[bout] * dd }; break;
        default: dd = .5; pa = { x: p0.x + XP[bin] * dd, y: p0.y + YP[bin] * dd }; pb = { x: p1.x + XP[bout] * dd, y: p1.y + YP[bout] * dd };
      }
      return [{ x: p0.x, y: p0.y }, pa, pb, { x: p1.x, y: p1.y }];
    }
    const traces = [];
    for (const loop of loops) {
      const bezier = loop.pairs.map(([a, b]) => toBezier(a.cell, a, b)), t = new Trace(bezier);
      t.closed = loop.closed && gap(bezier[0][0], bezier[bezier.length - 1][3]) < 1e-6; traces.push(t);
      if (performance.now() > slice.until) yield;
    }
    traces.sort((x, y) => Math.hypot(x.centre.x, x.centre.y) - Math.hypot(y.centre.x, y.centre.y));
    const seen = list.filter(cell => cell.tile === undefined && within(cell.q, cell.r, 0) && cell.ndots.some(Boolean));
    const linePx = lineWidth(cellPx);
    return { traces, zoom, cellPx, linePx, lineTile: linePx / cellPx, glow: Math.max(1.5, cellPx / 10), geometry, seams: seams.map(({ cell, other, q, r, dir, tile, puzzle }) => ({ q, r, dir, tile, puzzle, field: cell.ndots[dir] || 0, board: other.ndots[(dir + 3) % 6] || 0 })), tiles: seen.length, rings: new Set(seen.map(cell => cell.ring)).size };
  }
  // The picture is planned over frames of its own, apart from the turn that
  // closed the board; the promise settles once its loops are ordered.
  // The picture is sized ahead, in idle moments during play: how many loops it
  // will have on this page sets every loop's colour, so a sheen can show the
  // colour its loop will have in the finished picture.
  const sizes = new Map(); let sizing = null;
  const later = f => 'requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 400 }) : setTimeout(() => f(null), 16);
  function sizeKey() { const v = view(), m = boardMatrix(); return v && m ? `${current.id} ${Math.round(v.width)}x${Math.round(v.height)} ${m.a.toFixed(2)}` : null; }
  function sizePicture() {
    const key = sizeKey(); if (!key || sizes.has(key) || sizing?.key === key) return;
    const job = sizing = { key, plan: planField(view(), boardMatrix()) };
    const step = deadline => {
      if (sizing !== job) return;
      slice.until = performance.now() + Math.max(1, Math.min(6, deadline ? deadline.timeRemaining() - 1 : 6));
      const next = job.plan.next();
      if (next.done) { sizes.set(key, next.value.traces.length); sizing = null; } else later(step);
    };
    later(step);
  }
  function growField() {
    const f = finish; if (!f) return Promise.resolve(false);
    return f.growing = new Promise(resolve => {
      let plan = null;
      const step = () => {
        if (finish !== f) return resolve(false);
        if (!plan) { const v = view(); f.base = boardMatrix() || f.base; if (!v) return resolve(false); plan = planField(v, f.base); }
        slice.until = performance.now() + 10; const next = plan.next();
        if (!next.done) { requestAnimationFrame(step); return; }
        const done = next.value; f.plan = done; f.field = done.traces; const key = sizeKey(); if (key) sizes.set(key, done.traces.length);
        f.field.forEach((t, i) => { t.order = f.board.length + i; }); f.total = f.board.length + f.field.length;
        layer.dataset.tile = done.cellPx; layer.dataset.zoom = done.zoom;
        layer.style.setProperty('--glow', done.glow + 'px'); layer.style.setProperty('--ink', Math.max(1, done.cellPx * .044) + 'px'); layer.style.setProperty('--drop', Math.max(.5, done.cellPx * .02) + 'px');
        resolve(true);
      };
      requestAnimationFrame(step);
    });
  }
  async function finishPicture(token) {
    makeFinish();
    const growing = growField();
    // The next arrow comes at once, usable while the picture draws on behind
    // it. Focus does not move to it: a keyboard player keeps the board; after
    // a tap or click nothing is left focused, so no outline suggests a
    // selection.
    nextReady = true; updateChrome();
    if (document.activeElement === board && !typing) board.blur();
    const ready = await growing;
    if (token !== epoch || !ready) return;
    const done = await reveal();
    if (token !== epoch || !done) return;
    ink.style.visibility = 'hidden';
    finishComplete = true; updateChrome();
  }
  // Without motion the whole picture completes at once; a hidden page only pauses.
  function settleField() { if (finish?.go) { completeFinish(); if (finish.onReveal) finish.onReveal(); } }
  // A resized page regrows the picture to fit, shown complete.
  function regrow() {
    if (!finish) return;
    finish.base = boardMatrix() || finish.base; if (finish.go) setZoom(finish.z); syncFinish();
    clearTimeout(regrowTimer); regrowTimer = setTimeout(() => {
      if (!finish || !finishComplete) return;
      const f = finish; growField().then(ready => { if (!ready || finish !== f) return; completeFinish(); f.last = null; if (reduced()) paintFinish(); else syncFinish(); });
    }, 120);
  }
  function fieldState(detail) {
    const f = finish, field = f?.go ? f.field : null;
    const out = field ? { tiles: f.plan.tiles, rings: f.plan.rings, closed: loopsOf(f).every(t => t.closed), loops: field.length, drawn: loopsOf(f).every(t => t.done), fps: f.times.length } : { tiles: 0, rings: 0, closed: true, loops: 0, drawn: false, fps: f ? f.times.length : 0 };
    if (!detail || !f) return out;
    const v = viewOf(f), page = p => ({ x: v.a * p.x + v.e, y: v.a * p.y + v.f }), colours = palette(), time = driftTime();
    const describe = t => ({ order: t.order, colour: loopColour(t.order, f.total, time, colours), done: t.done, closed: t.closed !== false, started: t.started, drawn: Math.min(t.length, t.pos) * v.a, length: t.length * v.a, width: f.plan ? f.plan.lineTile * v.a : 0, cubics: t.bezier.map(c => c.map(page)) });
    return { ...out, revealing: f.go, time: f.last, zoom: f.z, targetZoom: f.plan?.zoom, cellPx: f.plan?.cellPx, tilePx: v.a, linePx: f.plan?.linePx, geometry: f.plan?.geometry, seams: f.plan?.seams || [], board: f.board.map(describe), field: (field || []).map(describe) };
  }

  // A finished board's picture, the same file whichever board is open: the
  // board solved, the whole Mandaza grown round it from the board's own seed,
  // 2048 pixels square on the dark ground, every loop complete in its colour
  // as the reveal begins. The board's cells are sized so it fits with a ring
  // of field round it. It is drawn in frame-sized steps.
  // A quiet address in the corner of a shared board picture: where the minimal games live.
  function stampMinimal(canvas,ink){const ctx=canvas.getContext('2d'),h=Math.max(12,Math.round(Math.min(canvas.width,canvas.height)*.017));ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=.5;ctx.fillStyle=ink;ctx.font='400 '+h+'px "IBM Plex Mono","Plex Mono",ui-monospace,monospace';ctx.textAlign='right';ctx.textBaseline='alphabetic';ctx.fillText('lukesteuber.com/minimal/',canvas.width-h*1.2,canvas.height-h*1.1);ctx.restore();return canvas;}
  const PICTURE = 2048, frameStep = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  async function pictureOf(b) {
    if (!b) return null;
    const plain = !special(b), sol = plain ? null : E.solveAll(b, b.start, startOffsets(b), 1).solution;
    const shape = plain ? b : E.arrange(b, sol.offsets), turns = plain ? E.solve(b, 1).solution.map(r => r[0]) : sol.finals.map(f => f[0]);
    const own = E.loops(shape, turns).map(loop => new Trace(chain(shape, turns, loop))).sort((x, y) => radial(x.centre, y.centre));
    const R = b.radius, cap = Math.max(34, PICTURE / 13), a = Math.min(cap, PICTURE / (Math.max(3 * R + 2, Math.sqrt(3) * (2 * R + 1)) + 4)), m = { a, e: PICTURE / 2, f: PICTURE / 2 };
    const plan = planField({ width: PICTURE, height: PICTURE }, m, { board: b, shape, rots: turns });
    let step; do { slice.until = performance.now() + 8; step = plan.next(); if (!step.done) await frameStep(); } while (!step.done);
    const field = step.value, loops = [...own, ...field.traces], colours = visibleStops(palettes[hue(b)], true), scale = a * field.zoom;
    const lines = document.createElement('canvas'); lines.width = lines.height = PICTURE;
    const lx = lines.getContext('2d'); lx.setTransform(scale, 0, 0, scale, m.e, m.f); lx.lineWidth = field.lineTile; lx.lineCap = lx.lineJoin = 'round';
    const groups = new Map();
    loops.forEach((t, i) => { const c = loopColour(i, loops.length, 0, colours); let g = groups.get(c); if (!g) groups.set(c, g = new Path2D()); const p = new Path2D(); p.moveTo(t.bezier[0][0].x, t.bezier[0][0].y); for (const q of t.bezier) p.bezierCurveTo(q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y); g.addPath(p); });
    let until = performance.now() + 8;
    for (const [c, g] of groups) { lx.strokeStyle = c; lx.stroke(g); if (performance.now() > until) { await frameStep(); until = performance.now() + 8; } }
    const glow = document.createElement('canvas'); glow.width = glow.height = Math.ceil(PICTURE / GLOW);
    const gx = glow.getContext('2d'); gx.filter = `blur(${field.glow / GLOW}px)`; gx.drawImage(lines, 0, 0, glow.width, glow.height); await frameStep();
    const out = document.createElement('canvas'); out.width = out.height = PICTURE; const ox = out.getContext('2d');
    ox.fillStyle = '#000'; ox.fillRect(0, 0, PICTURE, PICTURE); ox.globalAlpha = .9; ox.drawImage(glow, 0, 0, PICTURE, PICTURE); ox.globalAlpha = 1;
    await frameStep(); ox.drawImage(lines, 0, 0); stampMinimal(out, '#fff');
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
    return blob ? { blob, width: PICTURE, height: PICTURE, name: `loop-${b.id}.png` } : null;
  }
  // Settings saves a finished board's picture: a phone is offered the file to
  // keep in its photos, a desk downloads it, and as a last resort it opens.
  async function savePicture(id) {
    const b = boards.find(x => x.id === id); if (!b || !finished.has(id)) return;
    const image = await pictureOf(b); if (!image) return;
    const file = new File([image.blob], image.name, { type: 'image/png' });
    try { if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Tangles' }); announce('Image shared.'); return; } } catch (error) { if (error.name === 'AbortError') return; }
    const url = URL.createObjectURL(image.blob), link = document.createElement('a');
    if ('download' in link) { link.href = url; link.download = image.name; document.body.append(link); link.click(); link.remove(); announce('Image saved.'); }
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // A move that closes loops, short of solving the board, sends a quick sheen
  // along each loop it closed: a short, soft streak inside the line's own
  // width, in the colour that loop will have in the finished picture, slides
  // once round the loop, eased, and is gone; longer loops take a little longer,
  // with a small seeded give so no two passes are alike. On black ink a
  // thin lighter core keeps a lift of lightness in it; on white ink the colour
  // glows just beyond the line, as the picture's lines do. The streak is a
  // tenth of the loop or 40 pixels, whichever is shorter. Loops already
  // closed stay as they are, and undo shimmers nothing. Reduced motion shows
  // nothing.
  const loopKey = loop => loop.map(([i, p]) => i + ':' + p).sort().join(' ');
  const closedKeys = () => new Set(E.closedLoops(arranged(), rots).map(loopKey));
  const shimmers = { moves: 0, loops: 0, last: 0, still: 0, keys: [], glints: [] };
  let shimmerTimer = 0;
  // A loop as cubics in order of travel, its place by geometry, and its centre.
  function chain(shape, turns, loop) {
    let end = null; const out = [];
    for (const [i, j] of loop) { let p = E.curve(shape.tiles[i], turns[i], shape.tiles[i].pairs[j]); if (end && gap(end, p[3]) < gap(end, p[0])) p = p.slice().reverse(); out.push(p); end = p[3]; }
    return out;
  }
  const placeOf = (shape, turns, loop) => loop.flatMap(([i, j]) => shape.tiles[i].pairs[j].map(d => { const t = shape.tiles[i], [e, n] = E.turnDot(d, turns[i]); return `${t.q},${t.r},${e},${n}`; })).sort().join(' ');
  function centreOf(cubics) { let x = 0, y = 0, sum = 0; for (const c of cubics) { const l = cubicLength(c), m = at(c, .5); x += m.x * l; y += m.y * l; sum += l; } return { x: x / sum, y: y / sum }; }
  // The answer's loops, ordered as the reveal will order them.
  let answer = null;
  function answerLoops() {
    if (answer?.id === current.id) return answer.loops;
    const plain = !special(current), sol = plain ? null : E.solveAll(current, current.start, startOffsets(current), 1).solution;
    const shape = plain ? current : E.arrange(current, sol.offsets), turns = plain ? E.solve(current, 1).solution.map(r => r[0]) : sol.finals.map(f => f[0]);
    const loops = E.loops(shape, turns).map(loop => { const c = chain(shape, turns, loop); return { place: placeOf(shape, turns, loop), centre: centreOf(c), length: c.reduce((a, q) => a + cubicLength(q), 0) }; }).sort((x, y) => radial(x.centre, y.centre));
    answer = { id: current.id, loops }; return loops;
  }
  // A closed loop's colour in the finished picture as the reveal begins: its
  // own if the answer has the same loop, otherwise the colour of its place
  // among the answer's loops.
  function glintOf(shape, loop, cubics) {
    const loops = answerLoops(), place = placeOf(shape, rots, loop), centre = centreOf(cubics);
    let order = loops.findIndex(l => l.place === place); const exact = order >= 0;
    if (!exact) order = loops.filter(l => radial(l.centre, centre) < 0).length;
    const field = sizes.get(sizeKey()), total = loops.length + (field ?? 30);
    // Its pass: longer for a longer loop, by the square root of its length
    // between the board's shortest and longest loops, with a seeded give.
    const roots = loops.map(l => Math.sqrt(l.length)), low = Math.min(...roots), high = Math.max(...roots), length = cubics.reduce((a, q) => a + cubicLength(q), 0);
    const share = high > low ? Math.min(1, Math.max(0, (Math.sqrt(length) - low) / (high - low))) : .5, give = 1 + JITTER * (2 * Mash(`${current.id}/${loopKey(loop)}`)() - 1);
    return { colour: loopColour(order, total, 0, palette()), order, total, exact, sized: field !== undefined, length, duration: Math.round((SHEEN[0] + (SHEEN[1] - SHEEN[0]) * share) * give) };
  }
  function shimmer(before) {
    const shape = arranged(), fresh = E.closedLoops(shape, rots).filter(loop => !before.has(loopKey(loop)));
    shimmers.last = fresh.length; shimmers.keys = fresh.map(loopKey); shimmers.glints = []; if (!fresh.length) return;
    shimmers.moves++; shimmers.loops += fresh.length;
    if (reduced() || document.hidden) { shimmers.still++; return; }
    const night = dark(), lw = Number(board.style.getPropertyValue('--line')) || 1 / 9, scale = board.getScreenCTM()?.a || px;
    const g = svg('g', { class: 'shimmer', 'aria-hidden': true }, board); board.insertBefore(g, dots);
    svg('feGaussianBlur', { stdDeviation: lw * .3 }, svg('filter', { id: 'loop-glint', x: -.2, y: -.2, width: 1.4, height: 1.4 }, g));
    svg('feGaussianBlur', { stdDeviation: lw * .08 }, svg('filter', { id: 'loop-glint-soft', x: -.2, y: -.2, width: 1.4, height: 1.4 }, g));
    let delay = 0, last = 0; const stagger = Mash(`${current.id}/${shimmers.keys.join('|')}`);
    for (const [k, loop] of fresh.entries()) {
      const cubics = chain(shape, rots, loop), glint = glintOf(shape, loop, cubics), d = `M${xy(cubics[0][0])}` + cubics.map(cubic).join('') + 'Z', paths = [];
      // Loops closed together start a little apart, never in lockstep.
      if (k) delay += Math.round(STAGGER[0] + (STAGGER[1] - STAGGER[0]) * stagger());
      shimmers.glints.push({ key: loopKey(loop), ...glint, delay }); last = Math.max(last, delay + glint.duration);
      const sheen = svg('g', { class: 'sheen', 'data-key': loopKey(loop), style: `--glint:${glint.colour}` }, g);
      if (night) paths.push(svg('path', { class: 'glint-glow', d, pathLength: 1, 'stroke-width': lw * 1.1, filter: 'url(#loop-glint)' }, sheen));
      paths.push(svg('path', { class: 'glint-colour', d, pathLength: 1, 'stroke-width': lw * .55, filter: 'url(#loop-glint-soft)' }, sheen));
      if (!night) paths.push(svg('path', { class: 'glint-lift', d, pathLength: 1, 'stroke-width': lw * .2 }, sheen));
      const seg = Math.min(.1, 40 / (paths[0].getTotalLength() * scale));
      for (const path of paths) {
        path.style.strokeDasharray = `${seg} ${1 + seg}`; path.style.strokeDashoffset = seg;
        path.animate([{ strokeDashoffset: seg, opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .8 }, { strokeDashoffset: -1, opacity: 0 }], { duration: glint.duration, delay, easing: 'ease-in-out', fill: 'both' });
      }
    }
    clearTimeout(shimmerTimer); shimmerTimer = setTimeout(() => g.remove(), last + 40);
  }
  // A locked tile is marked by a heavier grey rim just inside its edge,
  // under the lines and inside the hover and focus outlines, so it reads by
  // shape and lightness and never as a tint.
  function lockMark(g, t) {
    const m = svg('g', { class: 'lock-mark', 'aria-hidden': true }, g); g.prepend(m);
    svg('polygon', { class: 'lock-rim', points: hex(t, .88) }, m);
  }
  function toggleLock(i) {
    if (locked || !Number.isInteger(i) || !current.tiles[i]) return;
    if (locks.has(i)) locks.delete(i); else locks.add(i);
    if (locks.size) lockBook[current.id] = [...locks].sort((a, b) => a - b); else delete lockBook[current.id];
    const g = groups[i]; g?.querySelector('.lock-mark')?.remove(); if (g && locks.has(i)) lockMark(g, arranged().tiles[i]);
    if (locks.has(i)) settle(i);
    save(); announce(`Tile ${i + 1} ${locks.has(i) ? 'locked' : 'unlocked'}.`);
  }
  // The lock lands with a tiny settle of the tile.
  function settle(i) {
    const t = arranged().tiles[i], c = E.center(t.q, t.r);
    play('settle', 220, p => spinTile(i, p ? `translate(${xy(c)}) scale(${1 - .07 * Math.sin(Math.PI * p)}) translate(${-c.x} ${-c.y})` : `rotate(0 ${xy(c)})`));
  }
  // A turn that would move a locked tile is refused: the tile, its group or
  // its ring leans no more than LEAN degrees while dragged, then gives a small
  // shake and settles back. No hit is counted.
  const LEAN = 6, lean = d => Math.max(-LEAN, Math.min(LEAN, d)), holds = members => members.some(j => locks.has(j));
  async function refuse(spin, start) {
    if (!reduced() && !document.hidden) motions.refuse++;
    hint = null; rings();
    await tween(320, p => spin(p < 1 ? start * (1 - p) + 4 * Math.sin(3 * Math.PI * p) * (1 - p) : 0));
    spin(0);
  }
  async function act(action) {
    const token = epoch;
    if (action.type === 'hint') {
      if (!hint) {
        hint = special(current) ? E.hintAll(current, rots, offsets) : E.hint(current, rots); rings();
        if (hint?.ring !== undefined) announce(`Hint marks ring ${hint.ring}. Press Hint again to turn it.`);
        else if (hint) announce(`Hint marks tile ${hint.tile + 1}. Press Hint again to turn it.`); else announce('Every line is closed.');
        return;
      }
      action = hint.ring !== undefined ? { type: 'ring', k: hint.ring, steps: hint.steps } : { type: 'turn', i: hint.tile, steps: hint.taps };
    }
    // A solved board stays as drawn until undo, restart or the next board.
    if (E.solved(arranged(), rots)) return;
    if (action.type === 'ring') {
      // A ring turn carries every tile of the ring round the centre together.
      const { k, steps, from } = action; if (!(current.rings || []).includes(k) || !Number.isSafeInteger(steps)) return;
      stopMotion(); const members = ringTiles(k), start = holds(members) ? lean(from ?? 0) : from ?? 0, end = steps * 60, before = closedKeys();
      if (steps !== 0 && holds(members)) { await refuse(a => spinRing(k, members, a), start); if (token === epoch) announce(`Ring ${k} holds a locked tile.`); return; }
      nextReady = false; clearFinish(); ink.style.visibility = ''; hint = null; updateChrome();
      // The ring settles into its sixth with a small overshoot, a detent.
      await tween(260, p => { const x = p - 1, eased = 1 + 2 * x * x * x + x * x; spinRing(k, members, start + (end - start) * eased); });
      if (token !== epoch) return;
      // A ring step counts as one gesture; a drag that carries it two steps counts two.
      if (steps !== 0) { firstTurn(); history.push({ rots: rots.slice(), hits, ...(current.rings ? { offsets: offsets.slice() } : {}) }); ({ rots, offsets } = E.turnRing(current, rots, offsets, k, steps)); hits += Math.abs(steps); }
      render(false);
      if (E.solved(arranged(), rots)) { finished.add(current.id); progress(); announce(`Every line closed. ${hitsWord()}; par ${pars.get(current.id)}.`); save(); await finishPicture(token); }
      else { shimmer(before); announce(steps ? `Ring ${k} turned ${Math.abs(steps) === 1 ? 'one step' : Math.abs(steps) + ' steps'} ${steps > 0 ? 'clockwise' : 'counterclockwise'}. ${hitsWord()}. ${looseWord(E.loose(arranged(), rots).length)}.` : `Ring ${k} returned.`); save(); }
      return;
    }
    const { i, steps, from } = action;
    if (!Number.isInteger(i) || !current.tiles[i] || !Number.isSafeInteger(steps)) return;
    // A gesture on a linked tile turns its whole group.
    stopMotion(); const members = E.group(current, i), shape = arranged(), start = holds(members) ? lean(from ?? 0) : from ?? 0, end = steps * 60, before = closedKeys();
    if (steps !== 0 && holds(members)) { await refuse(a => { for (const j of members) spinTile(j, `rotate(${a} ${xy(E.center(shape.tiles[j].q, shape.tiles[j].r))})`); }, start); if (token === epoch) announce(`Tile ${i + 1} is locked.`); return; }
    nextReady = false; clearFinish(); ink.style.visibility = ''; hint = null;
    dots.querySelectorAll(`[data-tile="${i}"]`).forEach(n => n.remove()); updateChrome();
    await tween(180, p => { const eased = 1 - (1 - p) ** 3; for (const j of members) spinTile(j, `rotate(${start + (end - start) * eased} ${xy(E.center(shape.tiles[j].q, shape.tiles[j].r))})`); });
    if (token !== epoch) return;
    if (steps !== 0) { firstTurn(); history.push({ rots: rots.slice(), hits, ...(current.rings ? { offsets: offsets.slice() } : {}) }); rots = E.turnUnit(current, rots, i, steps); hits++; }
    render(false);
    const closed = E.solved(arranged(), rots);
    if (closed) { finished.add(current.id); progress(); announce(`Every line closed. ${hitsWord()}; par ${pars.get(current.id)}.`); save(); await finishPicture(token); }
    else { shimmer(before); announce(steps ? `Tile ${i + 1}${members.length > 1 ? ` and ${members.length - 1} linked` : ''} turned ${count(Math.abs(steps), 'step')} ${steps > 0 ? 'clockwise' : 'counterclockwise'}. ${hitsWord()}. ${looseWord(E.loose(arranged(), rots).length)}.` : `Tile ${i + 1} returned to its turn.`); save(); }
  }
  // The first turn on an opening board fades its tile edges; reduced motion drops them at once.
  function firstTurn() { if (opener() && !openerFade) openerFade = reduced() ? 0 : performance.now(); }
  async function drain() {
    if (busy) return; busy = true; updateChrome();
    while (queue.length) { const job = queue.shift(); await act(job.action); job.resolve(); }
    busy = false; updateChrome();
  }
  function enqueue(action) { return new Promise(resolve => { queue.push({ action, resolve }); drain(); }); }
  const turn = (i, steps = 1) => enqueue({ type: 'turn', i, steps });
  const turnRing = (k, steps = 1) => enqueue({ type: 'ring', k, steps });
  // The press outline: shown from a press on a tile until PRESS_MS after it is let go.
  const PRESS_MS = 700;
  function showPress(i) { clearPress(); pressed = { tiles: E.group(current, i), released: null, timer: 0 }; }
  function endPress() { if (!pressed || pressed.released !== null) return; const p = pressed; p.released = performance.now(); p.timer = setTimeout(() => { if (pressed === p) { pressed = null; rings(); } }, PRESS_MS); rings(); }
  function clearPress() { if (pressed) clearTimeout(pressed.timer); pressed = null; }
  function clearInput() {
    clearPress(); stopMotion(); clearTimeout(arrival); clearTimeout(shimmerTimer); shimmers.last = 0; shimmers.keys = []; epoch++; for (const job of queue) job.resolve(); queue = []; animation?.cancel(); animation = null;
    stopDrift();
    if (gesture) clearTimeout(gesture.hold); gesture = null; if (wheel) clearTimeout(wheel.timer); wheel = null; hint = null; hover = null;
  }
  function undo() { clearInput(); const old = history.pop(); if (old) { rots = old.rots.slice(); hits = old.hits; if (current.rings) offsets = old.offsets.slice(); } nextReady = E.solved(arranged(), rots); render(); save(); announce(old ? `Turn undone. ${hitsWord()}.` : 'No turns to undo.'); }
  function restart() { clearInput(); openerFade = 0; locks.clear(); delete lockBook[current.id]; rots = current.start.slice(); offsets = startOffsets(current); hits = 0; history = []; nextReady = false; render(); save(); announce('Board restarted.'); }
  // Past the course's last board the arrow goes to the first course board not
  // yet finished; with every one finished it starts New Game+ (the tilings, on
  // experiments.html). The last of More boards has none; More boards lead on
  // to the next open one; the samples go round.
  const following = () => { if (sampling) return boards[(boards.indexOf(current) + 1) % boards.length]; if (current === FINALE) return courseLeft(); const n = boards.indexOf(current) + 1; return n < boards.length && isOpen(boards[n]) ? boards[n] : null; };
  const last = () => !following() && !plusEnd();
  function go(id) {
    const b = boards.find(b => b.id === id); if (!b) return;
    clearInput(); openerFade = 0; current = b; locks = new Set(lockBook[b.id] || []); rots = b.start.slice(); offsets = startOffsets(b); hits = 0; history = []; focus = middle(b); nextReady = false; render(); save(); announce(`${label(b)}.`); arrive();
  }
  function local(e) { const matrix = board.getScreenCTM(); return matrix ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()) : null; }
  function tileAt(p) {
    if (!p) return null;
    const shape = arranged();
    for (let i = 0; i < shape.tiles.length; i++) {
      const t = shape.tiles[i], c = E.center(t.q, t.r), x = Math.abs(p.x - c.x), y = Math.abs(p.y - c.y);
      if (x <= 1 && y <= Math.sqrt(3) / 2 && Math.sqrt(3) * x + y <= Math.sqrt(3) + 1e-8) return i;
    }
    return null;
  }
  const hit = e => tileAt(local(e));
  // Tiles of ring k, and transforms that keep each tile's marks with it.
  const ringTiles = k => { const shape = arranged(); return shape.tiles.map((t, i) => i).filter(i => E.ring(shape.tiles[i].q, shape.tiles[i].r) === k); };
  function spinTile(j, transform) { groups[j]?.setAttribute('transform', transform); for (const g of twins[j] || []) g.setAttribute('transform', transform); }
  function spinRing(k, members, degrees) { for (const j of members) spinTile(j, `rotate(${degrees} 0 0)`); aids.get(k)?.dial?.setAttribute('transform', `rotate(${degrees} 0 0)`); rims.get(k)?.setAttribute('transform', `rotate(${degrees} 0 0)`); }
  // A ring tile's core (within CORE of its centre) takes tile turns; the band
  // beyond it, where ring tiles meet, and the bezel's track take ring turns.
  const CORE = .55, bezel = k => k * Math.sqrt(3) + .87;
  function zoneAt(p) {
    if (!p || locked) return null;
    const rings = current.rings || [], i = tileAt(p), t = i === null ? null : arranged().tiles[i], k = t && E.ring(t.q, t.r);
    const c = t && E.center(t.q, t.r), core = !!t && Math.hypot(p.x - c.x, p.y - c.y) <= CORE;
    // The track crosses the inner edge of the next ring out; a tile's core still turns the tile.
    if (RING === 'bezel' && !core) for (const r of rings) if (Math.abs(Math.hypot(p.x, p.y) - bezel(r)) <= .2) return { kind: 'ring', k: r, i, track: true };
    if (i === null) return null;
    if (!rings.includes(k)) return { kind: 'tile', i };
    return { kind: core ? 'tile' : 'ring', i, k };
  }
  // The ring aid: the light or sheen turned to the pointer's angle round the
  // centre, and the ring lifted, while the pointer is over the ring.
  let aidShown = null;
  function showAid(k, angle) {
    const aid = aids.get(k); if (!aid) return;
    if (aid.turn) { aid.turn.setAttribute('transform', `rotate(${angle * 180 / Math.PI} 0 0)`); aid.glow.setAttribute('opacity', 1); aid.angle = angle; }
    if (RING !== 'light') board.dataset.lift = k;
    aidShown = k;
  }
  function hideAid() { for (const aid of aids.values()) aid.glow?.setAttribute('opacity', 0); delete board.dataset.lift; aidShown = null; }
  // Small motions that say how things move: a linked group nudges together
  // on hover or press; the first ring board rocks its ring on arrival.
  let motion = null, arrival = null;
  const motions = { nudge: 0, rock: 0, settle: 0, refuse: 0 };
  function stopMotion() { if (!motion) return; cancelAnimationFrame(motion.frame); motion.draw(0); motion = null; }
  function play(kind, ms, draw) {
    if (reduced() || document.hidden || locked || busy || gesture?.drag) return;
    stopMotion(); motions[kind]++;
    const start = performance.now(), m = { draw, frame: 0, kind };
    const step = now => { const p = Math.min(1, (now - start) / ms); draw(p < 1 ? p : 0); if (p < 1) m.frame = requestAnimationFrame(step); else motion = null; };
    motion = m; m.frame = requestAnimationFrame(step);
  }
  function nudge(i) {
    const members = E.group(current, i); if (members.length < 2) return;
    const shape = arranged(), centres = members.map(j => xy(E.center(shape.tiles[j].q, shape.tiles[j].r)));
    play('nudge', 320, p => { const a = 5 * Math.sin(Math.PI * p); members.forEach((j, n) => spinTile(j, `rotate(${a} ${centres[n]})`)); });
  }
  function rock(k) { const members = ringTiles(k); play('rock', 900, p => spinRing(k, members, 6 * Math.sin(2 * Math.PI * p) * (1 - p * .3))); }
  // The first linked board nudges its group once on arrival; the first ring board rocks its ring.
  function arrive() {
    clearTimeout(arrival); if (!current.teach || reduced()) return;
    const b = current; arrival = setTimeout(() => { if (current !== b || locked) return; if (b.links) nudge(b.links[0][0]); else if (b.rings) rock(b.rings[0]); }, 500);
  }
  // A ring drag carries the ring with the pointer; on release it snaps to the
  // nearest sixth once past a quarter of the way.
  const detent = a => { const d = Math.abs(a) * 180 / Math.PI; return d < 25 ? 0 : Math.sign(a) * Math.floor((d + 35) / 60); };
  function preview(g) {
    if (busy || !g.drag) return;
    const shape = arranged();
    if (g.mode === 'ring') { const members = ringTiles(g.ring), d = g.around * 180 / Math.PI; spinRing(g.ring, members, holds(members) ? lean(d) : d); return; }
    const members = E.group(current, g.i), d = g.angle * 180 / Math.PI, a = holds(members) ? lean(d) : d;
    for (const j of members) spinTile(j, `rotate(${a} ${xy(E.center(shape.tiles[j].q, shape.tiles[j].r))})`);
  }
  function track(e) {
    const g = gesture; if (!g || e.pointerId !== g.id) return;
    g.last = { clientX: e.clientX, clientY: e.clientY }; const p = local(e);
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 7) { if (!g.drag) stopMotion(); g.drag = true; clearTimeout(g.hold); }
    if (p && g.i !== null) {
      const t = arranged().tiles[g.i], c = E.center(t.q, t.r);
      if (Math.hypot(p.x - c.x, p.y - c.y) > .15) {
        const a = Math.atan2(p.y - c.y, p.x - c.x);
        if (g.previous !== null) g.angle += Math.atan2(Math.sin(a - g.previous), Math.cos(a - g.previous));
        g.previous = a;
      }
      // From a ring tile's core, a drag that leaves its hexagon carries the ring.
      const x = Math.abs(p.x - c.x), y = Math.abs(p.y - c.y), outside = x > 1 || y > Math.sqrt(3) / 2 || Math.sqrt(3) * x + y > Math.sqrt(3);
      if (g.ring !== null && g.mode !== 'ring' && outside) { g.mode = 'ring'; clearPress(); rings(); for (const j of E.group(current, g.i)) spinTile(j, `rotate(0 ${xy(E.center(arranged().tiles[j].q, arranged().tiles[j].r))})`); board.dataset.cursor = 'grabbing'; }
    }
    if (p && g.ring !== null) {
      const b = Math.atan2(p.y, p.x);
      g.around += Math.atan2(Math.sin(b - g.centre), Math.cos(b - g.centre)); g.centre = b;
      showAid(g.ring, b);
    }
    preview(g);
  }
  function release(e) {
    const g = gesture; if (!g || e.pointerId !== g.id) return;
    if (e.type !== 'lostpointercapture') track(e); gesture = null; clearTimeout(g.hold); endPress();
    try { board.releasePointerCapture(g.id); } catch (_) {}
    hideAid(); delete board.dataset.cursor;
    // A hold that locked the tile ends there.
    if (g.held) return;
    if (g.mode === 'ring') {
      // A tap on the bezel's track turns one step toward the side tapped.
      const steps = g.track && !g.drag ? g.side : detent(g.around);
      enqueue({ type: 'ring', k: g.ring, steps, from: !busy ? g.around * 180 / Math.PI : undefined }); return;
    }
    stopMotion();
    const steps = g.drag ? Math.sign(g.angle) * Math.round(Math.abs(g.angle) / (Math.PI / 3)) : g.shift ? -1 : 1;
    // A drag can cover many turns while remaining one history entry and hit.
    enqueue({ type: 'turn', i: g.i, steps, from: !busy && g.drag ? g.angle * 180 / Math.PI : undefined });
  }
  board.addEventListener('pointerdown', e => {
    // A finished board takes no input, not even focus.
    if (locked) { e.preventDefault(); return; }
    if (!e.isPrimary || e.button !== 0 || gesture) return; const p = local(e), z = zoneAt(p); if (!z) return;
    e.preventDefault(); keyboard = false; if (z.i !== null) focus = z.i; hover = null;
    const c = z.i !== null ? E.center(arranged().tiles[z.i].q, arranged().tiles[z.i].r) : { x: 0, y: 0 };
    gesture = { id: e.pointerId, i: z.i, x: e.clientX, y: e.clientY, last: e, angle: 0, drag: false, previous: z.i !== null && Math.hypot(p.x - c.x, p.y - c.y) > .15 ? Math.atan2(p.y - c.y, p.x - c.x) : null, ring: z.k ?? null, mode: z.kind, track: !!z.track, side: p.x >= 0 ? 1 : -1, around: 0, centre: Math.atan2(p.y, p.x), shift: e.shiftKey, held: false, hold: 0 };
    // Held still for HOLD ms, a press locks or unlocks the tile instead of turning it.
    if (z.i !== null) { const g = gesture; g.hold = setTimeout(() => { if (gesture !== g || g.drag) return; g.held = true; hideAid(); delete board.dataset.cursor; toggleLock(g.i); }, HOLD); }
    if (z.k !== undefined) showAid(z.k, gesture.centre);
    if (z.kind === 'ring') board.dataset.cursor = 'grabbing';
    else if (z.i !== null) nudge(z.i);
    if (z.i !== null && z.kind !== 'ring') showPress(z.i);
    board.focus({ preventScroll: true }); keyboard = false; board.setPointerCapture(e.pointerId); rings();
  });
  let hovered = null;
  window.addEventListener('pointermove', e => {
    if (gesture?.id === e.pointerId) { track(e); if (e.pointerType === 'mouse' && e.buttons === 0) release(e); return; }
    if (e.pointerType !== 'mouse' || locked) return;
    const p = local(e), z = zoneAt(p); hover = z?.i ?? null; rings();
    // Hovering the ring shows its aid and a grab cursor in the band.
    if (z?.k !== undefined) showAid(z.k, Math.atan2(p.y, p.x)); else if (aidShown !== null) hideAid();
    if (z?.kind === 'ring') board.dataset.cursor = 'grab'; else delete board.dataset.cursor;
    // Entering a linked group nudges it.
    const group = hover !== null && E.group(current, hover).length > 1 ? E.group(current, hover)[0] : null;
    if (group !== hovered && group !== null) nudge(hover);
    hovered = group;
  });
  window.addEventListener('pointerup', release);
  board.addEventListener('lostpointercapture', e => { if (gesture?.id !== e.pointerId) return; if (e.buttons === 0) release(e); else { clearTimeout(gesture.hold); gesture = null; clearPress(); render(); } });
  window.addEventListener('pointercancel', e => { if (gesture?.id === e.pointerId) { clearTimeout(gesture.hold); gesture = null; clearPress(); render(); } });
  board.addEventListener('pointerleave', () => { hovered = null; if (!gesture) { hideAid(); delete board.dataset.cursor; } if (hover === null) return; hover = null; rings(); });
  let pointer = 'mouse'; window.addEventListener('pointerdown', e => { pointer = e.pointerType; }, true);
  board.addEventListener('contextmenu', e => { e.preventDefault(); if (locked || pointer !== 'mouse') return; const i = hit(e); if (i !== null) { focus = i; toggleLock(i); } });
  board.addEventListener('wheel', e => {
    if (locked || e.ctrlKey || e.metaKey) return; const i = hit(e); if (i === null) return; e.preventDefault();
    if (!wheel) wheel = { total: 0, fired: false, i, timer: null };
    clearTimeout(wheel.timer); wheel.total += (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? board.clientHeight : 1);
    if (!wheel.fired && Math.abs(wheel.total) >= 40) { wheel.fired = true; turn(wheel.i, Math.sign(wheel.total)); }
    wheel.timer = setTimeout(() => { wheel = null; }, 180);
  }, { passive: false });
  board.addEventListener('focus', () => { keyboard = true; rings(); }); board.addEventListener('blur', () => { keyboard = false; rings(); });
  function navigate(key) {
    const shape = arranged(), c = E.center(shape.tiles[focus].q, shape.tiles[focus].r), horizontal = key === 'ArrowLeft' || key === 'ArrowRight', sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const options = shape.tiles.map((t, i) => ({ i, c: E.center(t.q, t.r) })).filter(p => sign * (horizontal ? p.c.x - c.x : p.c.y - c.y) > .01);
    options.sort((a, b) => {
      const score = p => horizontal ? Math.abs(p.c.y - c.y) * 10 + Math.abs(p.c.x - c.x) : Math.hypot(p.c.x - c.x, p.c.y - c.y) + Math.abs(p.c.x - c.x) * .01;
      return score(a) - score(b);
    });
    if (options.length) focus = options[0].i;
    keyboard = true; hover = null; board.focus({ preventScroll: true }); rings(); announce(board.getAttribute('aria-label'));
  }
  // The last input decides where focus goes when a board closes.
  document.addEventListener('keydown', () => { typing = true; }, true); window.addEventListener('pointerdown', () => { typing = false; }, true);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
    // The shared frame puts the arrow after the toolbar; while it shows, a
    // forward Tab from the top of the page goes to it first.
    if (e.key === 'Tab' && !e.shiftKey && !$('#next-btn').hidden && (e.target === document.body || e.target.matches('#restart-btn,#readout'))) { e.preventDefault(); $('#next-btn').focus(); return; }
    const key = e.key.toLowerCase();
    if (['z', 'u', 'backspace'].includes(key)) { e.preventDefault(); undo(); return; }
    if (key === 'h') { e.preventDefault(); enqueue({ type: 'hint' }); return; }
    if (locked) return;
    if (e.key.startsWith('Arrow')) { e.preventDefault(); navigate(e.key); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target === board) { e.preventDefault(); turn(focus, e.shiftKey ? -1 : 1); }
    if (key === 'l' && e.target === board) { e.preventDefault(); toggleLock(focus); }
    // R turns the focused tile's ring one step; Shift with R turns it back.
    if (key === 'r' && e.target === board) { const t = arranged().tiles[focus], k = E.ring(t.q, t.r); if ((current.rings || []).includes(k)) { e.preventDefault(); turnRing(k, e.shiftKey ? -1 : 1); } }
  });
  for (const name of ['selectstart', 'dragstart']) board.addEventListener(name, e => e.preventDefault());
  const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', save: 'M12 4v11M7 10l5 5 5-5M5 20h14', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, d] of Object.entries(icons)) { const n = $('#' + id + '-btn'); if (n) n.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`; }
  $('#restart-btn').onclick = restart; $('#undo-btn').onclick = undo; $('#hint-btn').onclick = () => enqueue({ type: 'hint' });
  $('#next-btn').onclick = () => { if (!nextReady) return; if (plusEnd()) { location.href = './experiments.html?plus'; return; } const b = following(); if (b) go(b.id); };
  for (const id of ['settings', 'help']) { $('#' + id + '-btn').onclick = () => { const keepFinish = finishComplete; clearInput(); nextReady = E.solved(arranged(), rots); if (keepFinish) { syncFinish(); updateChrome(); } else render(); if (id === 'settings') catalog(); $('#' + id).showModal(); }; $('#' + id).addEventListener('close', () => $('#' + id + '-btn').focus()); }
  // Settings lists the course's boards, then More boards: current, completed,
  // available or locked. More boards say "After board 25" until it closes.
  function catalog() {
    const lists = [[$('#level-catalog'), sampling ? boards : course]];
    if (!sampling && extras.length) lists.push([$('#more-catalog'), extras]);
    const moreSection = $('#more-title')?.closest('section'); if (moreSection) moreSection.hidden = sampling || !extras.length;
    for (const [list, entries] of lists) {
      if (!list) continue;
      if (!list.children.length) for (const b of entries) {
        const li = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.className = 'board'; button.dataset.board = b.id; button.innerHTML = `<span>${isExtra(b) ? '+' + extraNo(b) : 'Board ' + (entries.indexOf(b) + 1)}</span><span class="catalog-state"></span>`;
        button.onclick = () => { if (!isOpen(b)) return; if (b !== current) go(b.id); $('#settings').close(); };
        li.append(button); list.append(li);
      }
      for (const [n, b] of entries.entries()) {
        const button = list.children[n].firstChild, now = b === current, done = finished.has(b.id), open = isOpen(b);
        button.dataset.state = now ? 'current' : done ? 'completed' : open ? 'available' : 'locked'; button.disabled = !open;
        button.querySelector('.catalog-state').textContent = [now ? 'Current' : null, done ? 'Completed' : null, !now && !done ? (open ? 'Available' : isExtra(b) ? `After board ${course.length}` : 'Locked') : null].filter(Boolean).join(' · ');
        if (now) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
        // A finished board's tile carries a button that saves its picture.
        const name = isExtra(b) ? `board +${extraNo(b)}` : `board ${n + 1}`;
        let saver = list.children[n].querySelector('.save');
        if (done && !saver) { saver = document.createElement('button'); saver.type = 'button'; saver.className = 'save'; saver.dataset.save = b.id; saver.setAttribute('aria-label', `Save the picture of ${name}`); saver.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.save}"/></svg>`; saver.onclick = () => savePicture(b.id); list.children[n].append(saver); }
        if (!done && saver) saver.remove();
      }
    }
  }
  // Once there are turning rings, Help names their gestures, in the same three sentences.
  if (boards.some(b => b.rings)) {
    const [, how, keys] = document.querySelectorAll('#help .sheet-body p');
    how.textContent = 'Tap to turn clockwise, Shift-click to turn back, drag or scroll to turn either way, drag around the middle to turn a ring, and hold or right-click a tile to lock it.';
    keys.textContent = 'Arrows choose a tile; Enter or Space turns it, Shift with Enter turns back, R turns its ring, L locks it, Z, U or Backspace undoes, and H marks a hint, then makes its turn.';
  }
  function applyPrefs() {
    document.documentElement.dataset.theme = settings.theme; document.documentElement.dataset.motion = settings.motion;
    for (const id of ['theme', 'motion', 'borders']) $('#' + id).value = settings[id];
    board.dataset.borders = settings.borders;
    document.querySelectorAll('meta[name="theme-color"]').forEach(n => { n.content = settings.theme === 'dark' || settings.theme === 'system' && darkQuery.matches ? '#000000' : '#ffffff'; });
    if (reduced()) { animation?.finish(); settleField(); }
    syncFinish();
  }
  for (const id of ['theme', 'motion', 'borders']) $('#' + id).onchange = e => { settings[id] = e.target.value; applyPrefs(); save(); };
  reducedQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { fit(); regrow(); });
  // A hidden page pauses the drawing and the drift; a turn in motion completes.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (animation && !animation.trace) animation.finish(); stopDrift(); } else syncFinish(); });
  window.addEventListener('pagehide', stopDrift);
  window.addEventListener('pageshow', syncFinish);
  function bounds() {
    const b = ink.getBBox(), pad = 1 / 18;
    let left = b.x - pad, top = b.y - pad, right = b.x + b.width + pad, bottom = b.y + b.height + pad;
    if (dots.childElementCount) {
      const d = dots.getBBox(); left = Math.min(left, d.x); top = Math.min(top, d.y); right = Math.max(right, d.x + d.width); bottom = Math.max(bottom, d.y + d.height);
    }
    const matrix = board.getScreenCTM(), p = new DOMPoint(left, top).matrixTransform(matrix), q = new DOMPoint(right, bottom).matrixTransform(matrix);
    return { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y };
  }
  window.__loop = {
    boards, get board() { return current; }, get state() { return state(); }, turn, ring: turnRing, undo, restart, go: id => { const b = boards.find(b => b.id === id); if (b && isOpen(b)) go(id); }, course: course.map(b => b.id), more: extras.map(b => b.id), sampling, affordances: { ring: RING }, motions: () => ({ ...motions }), shimmers: () => ({ ...shimmers, keys: shimmers.keys.slice(), glints: shimmers.glints.map(g => ({ ...g })) }), locks: () => [...locks].sort((a, b) => a - b), reveal: { speed: REVEAL_SPEED, zoom: REVEAL_ZOOM },
    finishColors: () => finish?.go ? finish.board.map(t => loopColour(t.order, finish.total, driftTime(), palette())) : [],
    field: options => fieldState(options?.detail),
    // The rendered image's size and bytes; the last image stays on image.blob for checks.
    image: Object.assign(async (id = current.id) => { if (!finished.has(id)) return null; const r = await pictureOf(boards.find(b => b.id === id)); if (!r) return null; window.__loop.image.blob = r.blob; return { width: r.width, height: r.height, bytes: r.blob.size, name: r.name }; }, { blob: null })
  };
  window.__minimalize = { bounds };
  board.dataset.ringAid = RING;
  applyPrefs(); render(); save(); arrive();
})();
