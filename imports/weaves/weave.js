/* Weave. By Luke Steuber. */
(function () {
  'use strict';
  const E = WeaveEngine, course = WeaveCourse, G = WeaveGenerate, boards = course.all, $ = s => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg', KEY = 'weave-minimal.v1', boardNode = $('#board');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const copy = grid => grid.map(row => row.slice()), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => x * x * (3 - 2 * x), beat = x => 1 - (1 - x) ** 3;
  let board = boards[0], grid = E.start(board), hits = 0, history = [], finished = new Set();
  let prefs = { theme: 'system', motion: 'system' }, protectSave = false, saved = null, kept = new Set(), keepMode = false;
  // The optional cloths New Game+'s Next cloth has served, once all are solved, since the round last ran out.
  let played = [];
  function validGrid(g, b) {
    return Array.isArray(g) && g.length === b.rows && g.every(row => Array.isArray(row) && row.length === b.cols && row.every(v => v === 1 || v === -1)) && b.pins.every(([r, c, v]) => g[r][c] === v);
  }
  function validHits(n) { return Number.isSafeInteger(n) && n >= 0; }
  const validKept = (list, b) => list === undefined || Array.isArray(list) && new Set(list).size === list.length && list.every(k => Number.isInteger(k) && k >= 0 && k < b.rows * b.cols && !b.pins.some(([r, c]) => r * b.cols + c === k));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      // An endless cloth is saved as its id, g and the seed, with the seed beside it; the cloth is made again from the seed.
      const s = JSON.parse(raw), b = s?.seed === undefined ? boards.find(b => b.id === s?.board) : G.seedOf(s.board) === s.seed ? G.cloth(s.seed) : null;
      if (!b || !validGrid(s.grid, b) || !validHits(s.hits) || !Array.isArray(s.history) || s.history.length > 10000 || !s.history.every(h => validGrid(h.grid, b) && validHits(h.hits)) || !Array.isArray(s.finished) || !s.finished.every(id => boards.some(b => b.id === id)) || !['system', 'light', 'dark'].includes(s.settings?.theme) || !['system', 'reduce'].includes(s.settings?.motion)) throw Error('Invalid save');
      if (s.campaign !== undefined && (s.campaign !== 1 || !Number.isInteger(s.reached) || s.reached < 0 || s.reached >= (s.course === 1 ? boards.length : course.legacyCount))) throw Error('Invalid save');
      if (s.course !== undefined && (s.course !== 1 || !Number.isInteger(s.courseReached) || s.courseReached < 0 || s.courseReached >= course.main.length)) throw Error('Invalid course');
      if (!validKept(s.kept, b) || !s.history.every(h => validKept(h.kept, b))) throw Error('Invalid notes');
      board = b; grid = copy(s.grid); hits = s.hits; history = s.history; finished = new Set(s.finished); prefs = s.settings; saved = s;
      kept = new Set(s.kept || []);
      // An unknown or repeated id in the round is dropped, never a reason to refuse the save.
      played = Array.isArray(s.pool) ? [...new Set(s.pool.filter(id => course.more.some(b => b.id === id)))] : [];
    }
  } catch (_) { protectSave = true; }
  // Wins after the course, counted from 2026-11-19 on: fresh solves, made by a move once all sixteen main boards are
  // finished, of an optional cloth or an endless one. `held` is the last cloth counted (its id, or g: and its seed),
  // so undo and redo, a restart or a reload of that cloth never counts it twice; `set` lists the optional cloths
  // solved this way. An unreadable record is left as it is, as the main save is, and counting goes on unsaved.
  const PLUS = 'weave-minimal.plus.v1';
  let plus = { version: 1, wins: 0, held: '', set: [] }, protectPlus = false, setEnd = null;
  try {
    const raw = localStorage.getItem(PLUS);
    if (raw !== null) {
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || Object.keys(v).sort().join() !== 'held,set,version,wins' || v.version !== 1 || !validHits(v.wins) || typeof v.held !== 'string' || v.held.length > 96 || !Array.isArray(v.set)) throw Error('Invalid count');
      plus = { version: 1, wins: v.wins, held: v.held, set: [...new Set(v.set.filter(id => course.more.some(b => b.id === id)))] };
    }
  } catch (_) { protectPlus = true; }
  // Keep the legacy catalog index for old records and adapters. The small
  // course has its own progression; optional cloths never depend on this index.
  const openedBy = done => Math.max(-1, ...[...done].map(id => boards.findIndex(b => b.id === id))) + 1;
  let reached = Math.min(boards.length - 1, Math.max(saved ? (saved.campaign === 1 ? saved.reached : 11) : 0, openedBy(finished), boards.indexOf(board)));
  let courseReached = course.migrate(saved, reached, board.id, finished);
  // The optional cloths and endless ones open with New Game+, once all sixteen main boards are finished.
  const available = b => course.index(b.id) < 0 ? allDone() : course.index(b.id) <= courseReached;
  // A board by id: a course board, or an endless cloth made from the seed in its id.
  let made = null;
  const lookup = id => { const b = boards.find(b => b.id === id); if (b || G.seedOf(id) === null) return b || null; if (made?.id !== id) made = G.cloth(G.seedOf(id)); return made; };
  // Each board's par is worked out when it is first shown.
  const pars = new Map(), parOf = b => { if (!pars.has(b.id)) pars.set(b.id, E.par(b)); return pars.get(b.id); };
  let hint = null, focus = [0, 0], keyboard = false, hover = null, refusal = null;
  const gestures = new Map();
  let busy = false, queue = [], animation = null, epoch = 0, scale = 1, tight = 0, dye = 0;
  let display = { before: grid, after: grid, swap: 1, settle: 1 };
  const reduced = () => prefs.motion === 'reduce' || motionQuery.matches;
  const dark = () => prefs.theme === 'dark' || prefs.theme === 'system' && darkQuery.matches;
  const pinned = (r, c) => board.pins.some(p => p[0] === r && p[1] === c);
  // Counts are said as a person would: 1 flip, 2 flips; 1 long run, 2 long runs.
  const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`, hitsWord = () => count(hits, 'flip'), looseWord = n => count(n, 'long run');
  // The runs the dashed lines mark are also said: where each lies once
  // three or fewer are left, and whether the focused crossing is in one.
  const where = run => run.axis === 'row' ? `row ${run.index + 1}, columns ${run.from + 1} to ${run.to + 1}` : `column ${run.index + 1}, rows ${run.from + 1} to ${run.to + 1}`;
  const looseText = list => looseWord(list.length) + (list.length && list.length <= 3 ? ': ' + list.map(where).join('; ') : '');
  const inLoose = (list, r, c) => list.some(run => run.axis === 'row' ? run.index === r && c >= run.from && c <= run.to : run.index === c && r >= run.from && r <= run.to);
  function announce(text) { $('#announcement').textContent = text; }
  function save() {
    if (protectSave) return;
    try { localStorage.setItem(KEY, JSON.stringify({ board: board.id, ...(board.seed === undefined ? {} : { seed: board.seed }), grid, hits, history, kept: [...kept], finished: [...finished], settings: prefs, campaign: 1, reached, course: 1, courseReached, pool: played })); } catch (_) {}
  }
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) n.setAttribute(key, value);
    parent.append(n); return n;
  }
  // One hairline frame encloses the cloth, as far from the outermost warps'
  // centres as from the outermost rows', just clear of the weft's turns
  // (which reach .7 out, beaten or not). A single row stands in a taller frame.
  const frameOf = (rows, cols) => { const mx = .78, my = rows === 1 ? 1.3 : mx; return { x0: -mx, x1: cols - 1 + mx, y0: -my, y1: rows - 1 + my }; };
  function fit() {
    // Room for the frame; on the largest board at phone width the crossings
    // keep 44 pixels apart first and the frame stands in the page margin.
    const frame = frameOf(board.rows, board.cols), pad = -frame.y0 + .02, room = -frame.x0 - .5;
    const side = board.rows === 1 ? room : clamp(($('#board-shell').clientWidth / 44.5 - board.cols - .04) / 2, .2, room), width = board.cols + .04 + side * 2, height = board.rows - 1 + pad * 2;
    scale = Math.min($('#board-shell').clientWidth / width, ($('#board-shell').clientHeight - 48) / height, 340, innerWidth <= 600 ? Infinity : Math.min(innerWidth, innerHeight) * .27);
    boardNode.setAttribute('viewBox', `${-.52 - side} ${-pad} ${width} ${height}`);
    boardNode.style.width = width * scale + 'px'; boardNode.style.height = height * scale + 'px';
  }
  // Ribbon half-width: open while weaving, beaten closer once the cloth holds.
  // Grain threads run along each ribbon at these fractions of its half-width.
  const OPEN = .2, CLOSE = .3, GRAIN = [-.78, -.52, -.26, 0, .26, .52, .78];
  // Two-tone thread, as real cloth is woven: the warp (columns) dark and the
  // weft (rows) pale in either theme, told apart by lightness alone, so every
  // crossing shows dark or pale by which thread lies on top and a finished
  // cloth shows its weave as a picture. For each thread: its plain grey, the
  // swing between riding over and diving under, a raised float's light, and
  // the grey a back float fades to. Then the shadow strengths (cast onto a
  // ribbon beneath; a float's footprint on the ground).
  // The coloured finish. Play stays in grey; when the cloth holds, every
  // thread is dyed from a multi-hue palette, one palette per board in the
  // manner of Mandaza's: the weft one colour through all its turns, each warp
  // its own. Colours are re-lit in OKLab so the weft is always light and every
  // warp clearly darker, and over and under still read by lightness alone;
  // the colour is a reward, never information.
  const PALETTES = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb', '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0', '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96',
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff', '#ff5e5b #ffed66 #00cecb #5c5cff', '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00',
    '#9b5de5 #f15bb5 #fee440 #00bbf9 #00f5d4', '#f94144 #f3722c #f8961e #90be6d #43aa8b #577590', '#ef476f #ffd166 #06d6a0 #118ab2 #7b2cbf',
    '#e63946 #f4a261 #e9c46a #2a9d8f #3a0ca3', '#00a6fb #f72585 #7209b7 #4cc9f0 #ffd60a', '#d00000 #ffba08 #3f88c5 #136f63 #9c27b0'
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const linear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const byte = v => Math.round(255 * clamp(v <= .0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - .055, 0, 1));
  function oklab(rgb8) {
    const [r, g, b] = rgb8.map(linear), l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
  }
  function fromOklab([L, a, b]) {
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
  }
  // A palette colour at a chosen lightness, losing only as much chroma as it must.
  function relit(rgb8, L) {
    let [, a, b] = oklab(rgb8);
    for (let k = 0; k < 40; k++) { const lin = fromOklab([L, a, b]); if (lin.every(v => v >= -.0005 && v <= 1.0005)) break; a *= .93; b *= .93; }
    const out = fromOklab([L, a, b]).map(byte); return { rgb: out, chroma: Math.hypot(a, b) };
  }
  function dyesFor(index, cols) {
    const palette = PALETTES[index % PALETTES.length], light = palette.map(c => relit(c, .86));
    const weftAt = light.reduce((best, c, i) => c.chroma > light[best].chroma ? i : best, 0), rest = palette.filter((_, i) => i !== weftAt);
    return { row: light[weftAt].rgb, col: Array.from({ length: cols }, (_, c) => relit(rest[c % rest.length], .47 + .035 * ((c * 7) % 3 - 1)).rgb) };
  }
  const palette = () => dark()
    ? { row: { base: 200, relief: 13, lift: 236, back: 132 }, col: { base: 84, relief: 14, lift: 118, back: 48 }, cast: .58, float: .2 }
    : { row: { base: 226, relief: 11, lift: 247, back: 246 }, col: { base: 98, relief: 16, lift: 134, back: 170 }, cast: .44, float: .24 };
  let built = null, defs, cloth, rings, layers, pool, seen, memo;
  // Crossing targets are made once per board and never move, so a press or a
  // measurement during motion meets the crossings where they rest.
  function build() {
    boardNode.replaceChildren();
    defs = svg('defs', {}, boardNode); cloth = svg('g', { id: 'cloth', 'aria-hidden': 'true' }, boardNode);
    layers = Object.fromEntries(['footprints', 'row', 'onRow', 'rowMarks', 'col', 'onCol', 'colMarks', 'patches', 'frame', 'knots'].map(name => [name, svg('g', {}, cloth)]));
    const targets = svg('g', { id: 'targets', 'aria-hidden': 'true' }, boardNode);
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) svg('rect', { class: 'crossing-target', 'data-r': r, 'data-c': c, x: c - .5, y: r - .5, width: 1, height: 1 }, targets);
    rings = svg('g', { id: 'rings', 'aria-hidden': 'true' }, boardNode);
    pool = new Map(); seen = new Set(); memo = new Map(); built = board;
  }
  // The cloth's elements are kept from frame to frame under fixed keys, and an
  // attribute is written only when its value changes, so a flip touches just
  // the ribbons and crossings it moves. Anything not drawn this frame goes.
  function put(key, tag, parent, attrs) {
    let n = pool.get(key);
    if (!n) { n = document.createElementNS(NS, tag); n.cache = {}; parent.append(n); pool.set(key, n); }
    for (const name in attrs) {
      const value = attrs[name];
      if (n.cache[name] === value) continue;
      if (value === null || value === undefined) n.removeAttribute(name); else n.setAttribute(name, value);
      n.cache[name] = value;
    }
    seen.add(key); return n;
  }
  // Geometry is worked out again only when what it depends on has changed.
  function remember(key, signature, make) {
    const held = memo.get(key);
    if (held && held.signature === signature) return held.value;
    const value = make(); memo.set(key, { signature, value }); return value;
  }
  // Every ribbon is one continuous strip from its sampled centreline, never
  // cut. Which ribbon lies on top is settled against the true shapes, and
  // shadows and grain are built from the same centreline samples, so a bowed
  // ribbon can never leave a wedge, a sliver or a straight thread.
  function drawCloth() {
    seen.clear();
    const P = palette(), W = OPEN + (CLOSE - OPEN) * tight, hair = +(.7 / scale).toFixed(5);
    // Each loose run of the two blended states is merged, so a float that
    // the move does not touch keeps its full weight.
    const runs = new Map();
    for (const [state, weight] of [[display.before, 1 - display.settle], [display.after, display.settle]]) {
      if (!weight) continue;
      for (const run of E.loose(board, state)) {
        const key = [run.axis, run.index, run.from, run.to, run.value].join();
        const seenRun = runs.get(key); if (seenRun) seenRun.weight += weight; else runs.set(key, { ...run, weight });
      }
    }
    const fronts = [], backs = [];
    for (const run of runs.values()) (run.value === (run.axis === 'row' ? 1 : -1) ? fronts : backs).push(run);
    const rise = (run, t) => { const a = run.from - .42, b = run.to + .42; return t > a && t < b ? Math.sin(Math.PI * (t - a) / (b - a)) * run.weight : 0; };
    function bow(axis, index, t) {
      let lift = 0;
      for (const run of fronts) if (run.axis === axis && run.index === index) lift += rise(run, t);
      return Math.min(1, lift);
    }
    // A back float pales over the stretch where the thread lies behind.
    function sink(axis, index, t) {
      let depth = 0;
      for (const run of backs) if (run.axis === axis && run.index === index) depth += smooth(clamp((t - run.from + .6) / .45, 0, 1)) * smooth(clamp((run.to + .6 - t) / .45, 0, 1)) * run.weight;
      return Math.min(1, depth);
    }
    // What a ribbon's shape depends on: its width and its own front floats.
    const shapes = {};
    const shapeOf = (axis, index) => shapes[axis + index] ??= W.toFixed(5) + fronts.filter(run => run.axis === axis && run.index === index).map(run => `|${run.from},${run.to},${run.weight.toFixed(4)}`).join('');
    const offset = (axis, index, t) => -.115 * bow(axis, index, t);
    // Each row is its own strip. Runs are counted along straight rows and
    // columns, so the drawing never suggests counting round a selvedge turn.
    const rows = board.rows, cols = board.cols, quarter = Math.PI / 4, overlap = .02;
    const turnsRight = () => false, turnsLeft = () => false;
    // Beating pulls each selvedge turn in as far as its ribbon widens, so a
    // turn never reaches further out than it did while weaving.
    const pull = W - OPEN, lead = -pull, start = cols - 1 - pull, frame = frameOf(rows, cols);
    const extent = (axis, index) => axis === 'col' ? [frame.y0, frame.y1] : [turnsLeft(index) ? -lead - quarter - overlap : frame.x0, turnsRight(index) ? start + quarter + overlap : frame.x1];
    // Where a thread lies at t before any float lifts it, and which way is
    // across it there (a float lifts a weft up and a warp to the left).
    function lay(axis, index, t) {
      if (axis === 'col') return { p: [index, t], n: [1, 0] };
      const r = index;
      if (t > start && turnsRight(r)) {
        const q = (t - start) / .5, sin = Math.sin(q), cos = Math.cos(q);
        return r % 2 === 0 ? { p: [start + .5 * sin, r + .5 - .5 * cos], n: [-sin, cos] } : { p: [start + .5 * sin, r - .5 + .5 * cos], n: [sin, cos] };
      }
      if (t < -lead && turnsLeft(r)) {
        const q = (-lead - t) / .5, sin = Math.sin(q), cos = Math.cos(q);
        return r % 2 === 1 ? { p: [-lead - .5 * sin, r + .5 - .5 * cos], n: [sin, cos] } : { p: [-lead - .5 * sin, r - .5 + .5 * cos], n: [-sin, cos] };
      }
      return { p: [t, r], n: [0, 1] };
    }
    const at = (r, c) => display.before[r][c] + (display.after[r][c] - display.before[r][c]) * display.swap;
    // How far this ribbon lies on top at crossing k, from 0 (under) to 1 (over).
    const over = (axis, index, k) => axis === 'row' ? (1 + at(index, k)) / 2 : (1 - at(k, index)) / 2;
    const fmt = p => +p[0].toFixed(4) + ' ' + +p[1].toFixed(4);
    const polyline = points => 'M' + points.map(fmt).join('L');
    // Centreline samples along a ribbon with their unit normals; a straight
    // stretch needs only its two ends.
    function centreline(axis, index, from, to, shift) {
      const bent = fronts.some(run => run.axis === axis && run.index === index), cuts = [from], ts = [];
      if (axis === 'row') for (const k of [0, -lead, start, cols - 1].sort((x, y) => x - y)) if (k > from && k < to && k > cuts[cuts.length - 1]) cuts.push(k);
      cuts.push(to);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const lo = cuts[i], hi = cuts[i + 1], turn = axis === 'row' && ((lo >= start && turnsRight(index)) || (hi <= -lead && turnsLeft(index)));
        // Eight samples a unit keep a bowed edge within a tenth of a pixel;
        // a turn is sampled every few degrees.
        const n = turn ? Math.max(2, Math.ceil((hi - lo) / .05)) : bent ? Math.max(2, Math.ceil((hi - lo) * 8)) : 1;
        for (let k = i ? 1 : 0; k <= n; k++) ts.push(lo + (hi - lo) * k / n);
      }
      const points = ts.map(t => { const { p, n } = lay(axis, index, t), lift = shift ? shift(t) : bent ? offset(axis, index, t) : 0; return [p[0] + n[0] * lift, p[1] + n[1] * lift]; }), last = points.length - 1;
      const normals = points.map((p, k) => {
        const prev = points[Math.max(0, k - 1)], next = points[Math.min(last, k + 1)], dx = next[0] - prev[0], dy = next[1] - prev[1], length = Math.hypot(dx, dy) || 1;
        return [-dy / length, dx / length];
      });
      return { points, normals, ts };
    }
    const across = (line, w) => line.points.map((p, k) => [p[0] + line.normals[k][0] * w, p[1] + line.normals[k][1] * w]);
    const band = (line, lo, hi) => polyline(across(line, hi).concat(across(line, lo).reverse())) + 'Z';
    const threads = line => GRAIN.map(g => polyline(across(line, g * W))).join('');
    const looks = { row: [], col: [] };
    // Where each row starts along the one weft thread, for the dye's flow.
    const weftFrom = [], dyes = dye > 0 ? remember('dyes', board.id, () => dyesFor(board.seed ?? boards.indexOf(board), cols)) : null;
    let weftLength = 0;
    for (let r = 0; r < rows; r++) { const [a, b] = extent('row', r); weftFrom.push(weftLength); weftLength += b - a; }
    for (const axis of ['row', 'col']) {
      const count = axis === 'row' ? board.rows : board.cols, length = axis === 'row' ? board.cols : board.rows;
      for (let index = 0; index < count; index++) {
        const ups = Array.from({ length }, (_, k) => 2 * over(axis, index, k) - 1), id = axis + '-' + index;
        const sinks = backs.some(run => run.axis === axis && run.index === index), [a, b] = extent(axis, index);
        const left = axis === 'row' && turnsLeft(index), right = axis === 'row' && turnsRight(index);
        // A weft's shading is laid along x, so both halves of a turn agree.
        const xa = left ? -lead - .5 : a, xb = right ? start + .5 : b;
        const ends = axis === 'row' ? { x1: xa, y1: index, x2: xb, y2: index } : { x1: index, y1: a, x2: index, y2: b };
        // Lightness follows height: lighter where the ribbon rides over,
        // darker as it dives under, lightest where a float lifts away, and
        // pale with faint edges where it floats behind the cloth.
        const fill = put('shade-' + id, 'linearGradient', defs, { id: 'shade-' + id, gradientUnits: 'userSpaceOnUse', ...ends });
        const edge = sinks && put('edge-' + id, 'linearGradient', defs, { id: 'edge-' + id, gradientUnits: 'userSpaceOnUse', ...ends });
        const samples = Math.ceil((xb - xa) * 5);
        for (let k = 0; k <= samples; k++) {
          const x = xa + (xb - xa) * k / samples, offsetAt = +(k / samples).toFixed(4);
          // Round a turn the thread eases to its middle height by the outermost
          // point; past the last crossing a loose end eases most of the way.
          const turn = right && x > start ? Math.asin(Math.min(1, (x - start) / .5)) : left && x < -lead ? Math.asin(Math.min(1, (-lead - x) / .5)) : null;
          const t = turn === null ? x : x < cols / 2 ? -lead - .5 * turn : start + .5 * turn, k0 = clamp(Math.floor(t), 0, length - 1), k1 = Math.min(length - 1, k0 + 1);
          const f = (1 - Math.cos(Math.PI * clamp(t - k0, 0, 1))) / 2, beyond = t < 0 ? -t : t > length - 1 ? t - length + 1 : 0;
          const ease = turn === null ? 1 - .55 * smooth(Math.min(1, beyond)) : 1 - smooth(turn / (Math.PI / 2));
          const h = (ups[k0] + (ups[k1] - ups[k0]) * f) * ease, behind = sinks ? sink(axis, index, t) : 0;
          const tone = P[axis]; let grey = tone.base + tone.relief * (1 + .35 * tight) * h; grey += (tone.lift - grey) * bow(axis, index, t); grey += (tone.back - grey) * .9 * behind;
          grey = Math.round(grey);
          // The dye flows along the thread from its start: the weft from its
          // free end through every turn, each warp from the top, a little after
          // the one before. Its shading, grain and shadows carry on over it.
          let colour = `rgb(${grey},${grey},${grey})`;
          if (dye > 0) {
            const along = axis === 'row' ? weftFrom[index] + (index % 2 === 0 ? t - a : b - t) : t - a, span = axis === 'row' ? weftLength : (b - a), late = axis === 'row' ? 0 : .25 * index / Math.max(1, cols - 1);
            const front = smooth(clamp((dye - late) / (1 - .25), 0, 1)) * (span + .8), wet = smooth(clamp((front - along) / .8, 0, 1));
            if (wet > 0) { const tint = axis === 'row' ? dyes.row : dyes.col[index], ratio = grey / tone.base; colour = `rgb(${[0, 1, 2].map(i => Math.round(grey + (clamp(tint[i] * ratio, 0, 255) - grey) * wet)).join(',')})`; }
          }
          put(`shade-${id}:${k}`, 'stop', fill, { offset: offsetAt, 'stop-color': colour });
          if (sinks && (k % 2 === 0 || k === samples)) put(`edge-${id}:${k}`, 'stop', edge, { offset: offsetAt, class: 'shade-ink', 'stop-opacity': +(1 - .7 * behind).toFixed(3) });
        }
        // The fill runs a hair past a turn's midpoint so neighbouring rows meet
        // without a seam; edge lines follow the sides and close only at the
        // thread's true ends; the grain stops exactly at the midpoint.
        const shape = remember('ribbon-' + id, shapeOf(axis, index) + hair, () => {
          const line = centreline(axis, index, a, b), sides = [across(line, W), across(line, -W)], n = line.points.length - 1;
          const edge = polyline(sides[0]) + polyline(sides[1]) + (left ? '' : polyline([sides[0][0], sides[1][0]])) + (right ? '' : polyline([sides[0][n], sides[1][n]]));
          return { d: band(line, -W, W), edge, grain: threads(left || right ? centreline(axis, index, left ? a + overlap : a, right ? b - overlap : b) : line) };
        });
        const look = { fill: `url(#shade-${id})`, style: sinks ? `stroke:url(#edge-${id})` : null };
        put('ribbon-' + id, 'path', layers[axis], { class: 'ribbon', 'data-axis': axis, 'data-index': index, d: shape.d, fill: look.fill });
        put('grain-' + id, 'path', layers[axis], { class: 'grain ' + (axis === 'row' ? 'weft' : 'warp'), 'data-axis': axis, 'data-index': index, d: shape.grain, 'stroke-width': hair });
        put('edge-line-' + id, 'path', layers[axis], { class: 'ribbon-edge', 'data-axis': axis, 'data-index': index, d: shape.edge, style: look.style });
        looks[axis][index] = look;
      }
    }
    // A loose stretch carries a dashed line along its own middle, from the
    // near edge of its first crossing to the far edge of its last: the one
    // mark on the cloth of what still breaks the rule, gone once the stretch
    // closes. Its dashes are laid once along the thread, evenly from both
    // ends, and every piece is cut from that one set, so the line drawn
    // between crossings and the line drawn over them stay in step. Whatever
    // ribbon lies over the stretch hides the line there, as it hides the
    // thread: a front float shows it whole, a back float only in the gaps.
    // A row's line over a column is drawn again with the row's patch.
    // Dashes and their weight grow a little with roomy crossings.
    const marks = { row: new Map(), col: new Map() }, dash = clamp(.085 * scale, 5, 9) / scale, gap = .8 * dash, inkWidth = +clamp(.02 * scale, 1.5, 2).toFixed(2);
    const point = (axis, index, t) => { const { p, n } = lay(axis, index, t), lift = offset(axis, index, t); return [p[0] + n[0] * lift, p[1] + n[1] * lift]; };
    for (const run of runs.values()) {
      if (run.weight < .001) continue;
      const lo = run.from - W, span = run.to - run.from + 2 * W, n = Math.max(1, Math.floor((span + gap) / (dash + gap))), first = lo + (span - n * (dash + gap) + gap) / 2;
      const segments = Array.from({ length: n }, (_, k) => { const t = first + k * (dash + gap); return { t, line: [point(run.axis, run.index, t), point(run.axis, run.index, t + dash)] }; });
      // Dark on the pale weft and on a warp's pale back float; pale on the dark warp.
      const mark = { ...run, segments, ink: run.axis === 'row' || (run.value === 1 && !dark()) ? 'ink-dark' : 'ink-light', key: `${run.from}-${run.to}-${run.value}` };
      if (!marks[run.axis].has(run.index)) marks[run.axis].set(run.index, []);
      marks[run.axis].get(run.index).push(mark);
      put(`mark-${run.axis}${run.index}-${mark.key}`, 'path', layers[run.axis === 'row' ? 'rowMarks' : 'colMarks'], { class: 'loose-mark ' + mark.ink, 'data-axis': run.axis, 'data-index': run.index, d: segments.map(s => polyline(s.line)).join(''), 'stroke-width': inkWidth, opacity: run.weight < .999 ? +run.weight.toFixed(3) : null });
    }
    // The frame: one hairline.
    put('frame', 'rect', layers.frame, { class: 'frame', x: frame.x0, y: frame.y0, width: +(frame.x1 - frame.x0).toFixed(4), height: +(frame.y1 - frame.y0).toFixed(4) });
    // A front float lifts off the cloth over its own footprint: the float's
    // outline flattened toward where the thread would rest and dropped a
    // little toward the far side from the light, fading off its outer edge.
    for (const run of fronts) {
      const id = `footprint-${run.axis}${run.index}-${run.from}-${run.to}`, near = run.index + W - .12, far = run.index + W + .045;
      const soft = put(id, 'linearGradient', defs, { id, gradientUnits: 'userSpaceOnUse', ...(run.axis === 'row' ? { x1: 0, x2: 0, y1: near, y2: far } : { y1: 0, y2: 0, x1: near, x2: far }) });
      [[0, 1], [.55, .7], [1, 0]].forEach(([offsetAt, opacity], i) => put(`${id}:${i}`, 'stop', soft, { offset: offsetAt, class: 'shade-ink', 'stop-opacity': opacity }));
      const d = remember(id, W.toFixed(5), () => band(centreline(run.axis, run.index, run.from - .42, run.to + .42, t => .04 * Math.sin(Math.PI * (t - run.from + .42) / (run.to - run.from + .84))), -W, W));
      put('shape-' + id, 'path', layers.footprints, { class: 'front-shadow', 'data-axis': run.axis, 'data-index': run.index, d, fill: `url(#${id})`, 'fill-opacity': +(P.float * run.weight).toFixed(3) });
    }
    // At each crossing the upper ribbon casts its own outline onto the one
    // beneath, offset away from the light: down for a weft, right for a warp,
    // further under a raised float. The caster is exactly what is drawn over
    // that crossing: a weft's patch there, with its loop only while the loop
    // passes in front of the warp, or the warp's own strip. Copies of that
    // outline, each shifted a step further along the light, are clipped piece
    // by piece to the lower ribbon's own strip, which ends where the ribbon
    // ends, so a shadow never reaches the page. Where a weft lies over the
    // edge warp but its loop passes behind it, the warp casts onto that loop
    // alone, beyond the weft's edge. Stacked, the copies are darkest
    // at the caster's edge and fade over the drop; whatever falls under the
    // caster is hidden by it, since the caster is drawn above.
    const turnedAt = (r, c) => (c === 0 && turnsLeft(r)) || (c === cols - 1 && turnsRight(r));
    function cast(upper, ui, uk, lower, li, lk, f, r, c, loopFront = 0, loopOnly = false) {
      const drop = .07 + .09 * bow(upper, ui, uk), strength = f * (1 - .5 * sink(lower, li, lk)), id = `cast-${r}-${c}-${lower}${loopOnly ? '-loop' : ''}`;
      const looped = upper === 'row' && turnedAt(r, c) && loopFront >= .5, steps = clamp(Math.round(drop * scale / 1.5), 3, 6);
      const shape = remember(id, shapeOf(upper, ui) + '/' + shapeOf(lower, li) + '/' + drop.toFixed(5) + '/' + looped + '/' + steps + '/' + (1.2 / scale).toFixed(5), () => {
        let casters;
        if (upper === 'row') casters = [patchShape(r, c, 'crossing'), looped ? patchShape(r, c, 'loop') : null].filter(Boolean).map(p => p.poly);
        else { const strip = centreline('col', c, r - .6, r + .6); casters = [across(strip, W).concat(across(strip, -W).reverse())]; }
        if (!casters.length) return null;
        // A weft's strip stops at each turn's midpoint line, without the hair
        // its fill runs past, so two rows' shadows never double where they meet.
        // The pieces are the lower ribbon's own, between the very samples its
        // fill is drawn from, so a shadow never strays past its edge.
        const [a, b] = extent(lower, li), whole = centreline(lower, li, a, b), lo = Math.max(a, lk - .8), hi = Math.min(b, lk + .8 + drop), ends = [];
        if (lower === 'row') for (const down of [turnsRight(li) && li % 2 === 0, turnsLeft(li) && li % 2 === 1]) if (down) ends.push([[1e3, li + .5], [-1e3, li + .5]]);
        if (lower === 'row') for (const up of [turnsRight(li) && li % 2 === 1, turnsLeft(li) && li % 2 === 0]) if (up) ends.push([[-1e3, li - .5], [1e3, li - .5]]);
        const one = across(whole, W * .999), two = across(whole, -W * .999), pieces = [];
        const beyond = loopOnly ? patchShape(r, c, 'loop')?.half : null;
        if (loopOnly && !beyond) return null;
        for (let k = 0; k + 1 < whole.points.length; k++) {
          if (whole.ts[k + 1] < lo || whole.ts[k] > hi) continue;
          const q = [one[k], one[k + 1], two[k + 1], two[k]];
          if (!inside(q[2], [q[0], q[1]])) q.reverse();
          pieces.push(q.map((p, i) => [p, q[(i + 1) % 4]]).concat(beyond ? [beyond] : [], ends));
        }
        const light = upper === 'row' ? [0, 1] : [1, 0], copies = [];
        for (let j = 1; j <= steps; j++) {
          const shift = drop * j / steps; let d = '';
          for (const poly of casters) {
            const moved = poly.map(([x, y]) => [x + light[0] * shift, y + light[1] * shift]);
            for (const planes of pieces) { const piece = clipShape(moved, planes); if (piece.length >= 3) d += polyline(piece) + 'Z'; }
          }
          copies.push(d);
        }
        return copies;
      });
      if (!shape) return;
      const each = +(1 - Math.pow(1 - P.cast * strength, 1 / shape.length)).toFixed(4), layer = layers[lower === 'col' ? 'onCol' : 'onRow'];
      shape.forEach((d, j) => { if (d) put(`shape-${id}:${j}`, 'path', layer, { class: 'cast', 'data-r': r, 'data-c': c, 'data-on': lower, 'data-part': loopOnly ? 'loop' : null, d, fill: '#000', 'fill-opacity': each }); });
    }
    // Clipping to the inside of a set of half-planes (each kept to the left
    // of a directed edge): a closed shape, and an open line, which may leave
    // in pieces.
    const inside = (p, [a, b]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cross = (p, q, [a, b]) => { const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]], den = r[0] * s[1] - r[1] * s[0], u = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den; return [p[0] + r[0] * u, p[1] + r[1] * u]; };
    function clipShape(shape, planes) {
      let out = shape;
      for (const plane of planes) {
        if (!out.length) break;
        const list = out; out = [];
        for (let j = 0; j < list.length; j++) {
          const p = list[j], q = list[(j + 1) % list.length], pin = inside(p, plane), qin = inside(q, plane);
          if (pin) out.push(p);
          if (pin !== qin) out.push(cross(p, q, plane));
        }
      }
      return out;
    }
    function clipLine(points, planes) {
      const pieces = []; let piece = [];
      for (let j = 0; j + 1 < points.length; j++) {
        let p = points[j], q = points[j + 1], keep = true;
        for (const plane of planes) {
          if (!keep) break;
          const pin = inside(p, plane), qin = inside(q, plane);
          if (!pin && !qin) keep = false; else if (!pin) p = cross(p, q, plane); else if (!qin) q = cross(p, q, plane);
        }
        if (!keep) { if (piece.length) pieces.push(piece); piece = []; continue; }
        if (!piece.length) piece.push(p);
        else if (Math.hypot(piece[piece.length - 1][0] - p[0], piece[piece.length - 1][1] - p[1]) > 1e-9) { pieces.push(piece); piece = [p]; }
        piece.push(q);
      }
      if (piece.length) pieces.push(piece);
      return pieces;
    }
    // A row lying over is drawn again over the column, clipped to the
    // column's strip through the crossing (half a cell either way along it,
    // widened a pixel each side to cover its edge line), so the row's edges
    // meet the column's exactly whatever either ribbon's bow. At the selvedge a
    // row's half of a turn is split at the row's own edge: the crossing part
    // follows the crossing, and the loop beyond it passes in front of the
    // outermost warp only when both rows of the turn lie over that warp;
    // otherwise it goes behind and comes out at the warp's outer edge, and the
    // row's edge line runs on to that edge. During a flip the patches and
    // both shadows cross-fade with the over fractions.
    // The part of row r drawn over column c, as a polygon and its paths.
    function patchShape(r, c, part) {
      const turned = turnedAt(r, c);
      if (part === 'loop' && !turned) return null;
      const id = `patch-${r}-${c}${part === 'loop' ? '-loop' : ''}`, reach = W + 1.2 / scale;
      return remember(id, shapeOf('row', r) + '/' + shapeOf('col', c) + '/' + reach.toFixed(5), () => {
        const from = c === 0 && turnsLeft(r) ? -lead - quarter : c - .5, to = c === cols - 1 && turnsRight(r) ? start + quarter : c + .5;
        const row = centreline('row', r, from, to), col = centreline('col', c, r - .5, r + .5), ends = [col.points[0], col.points[col.points.length - 1]];
        const length = Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]), n = [-(ends[1][1] - ends[0][1]) / length * reach, (ends[1][0] - ends[0][0]) / length * reach];
        const corners = [[ends[0][0] - n[0], ends[0][1] - n[1]], [ends[1][0] - n[0], ends[1][1] - n[1]], [ends[1][0] + n[0], ends[1][1] + n[1]], [ends[0][0] + n[0], ends[0][1] + n[1]]];
        if (!inside(corners[2], [corners[0], corners[1]])) corners.reverse();
        const planes = corners.map((p, i) => [p, corners[(i + 1) % 4]]);
        if (turned) {
          // The row's own edge on the side its turn leaves by, at the crossing.
          const down = r % 2 === (c === cols - 1 ? 0 : 1) && r + 1 < rows, here = centreline('row', r, c - .01, c + .01), k = here.points.length >> 1;
          const y = here.points[k][1] + here.normals[k][1] * W * (down ? 1 : -1), keepAbove = (part === 'crossing') === down;
          planes.push(keepAbove ? [[1e3, y], [-1e3, y]] : [[-1e3, y], [1e3, y]]);
          var half = planes[planes.length - 1];
          // The seam runs from where the turn begins, which the beat pulls in from the warp's middle.
          var seam = polyline([[c === cols - 1 ? start : -lead, y], [c + (c === cols - 1 ? reach : -reach), y]]);
        }
        const sides = [across(row, W), across(row, -W)], fill = clipShape(sides[0].concat([...sides[1]].reverse()), planes);
        if (fill.length < 3) return null;
        const lines = pieces => pieces.filter(piece => piece.length > 1).map(polyline).join('');
        return { poly: fill, planes, half: turned ? half : null, fill: polyline(fill) + 'Z', grain: GRAIN.map(g => lines(clipLine(across(row, g * W), planes))).join(''), edge: sides.map(side => lines(clipLine(side, planes))).join(''), seam: turned ? seam : null };
      });
    }
    function patch(r, c, f, part = 'crossing', g = f, front = 0) {
      const id = `patch-${r}-${c}${part === 'loop' ? '-loop' : ''}`, shape = patchShape(r, c, part);
      if (part === 'loop' && !turnedAt(r, c)) return;
      if (shape && part === 'crossing' && shape.seam && f - front > .001) put(id + ':seam', 'path', layers.patches, { class: 'patch-edge', d: shape.seam, opacity: +(f - front).toFixed(3), style: looks.row[r].style });
      if (!shape || g < .001) return;
      const group = put(id, 'g', layers.patches, { class: 'patch', 'data-r': r, 'data-c': c, 'data-part': part, opacity: g < .999 ? +g.toFixed(3) : null });
      put(id + ':fill', 'path', group, { class: 'patch-fill', d: shape.fill, fill: looks.row[r].fill });
      put(id + ':grain', 'path', group, { class: 'grain weft', d: shape.grain, 'stroke-width': hair });
      put(id + ':edge', 'path', group, { class: 'patch-edge', d: shape.edge, style: looks.row[r].style });
      if (part === 'crossing') for (const mark of marks.row.get(r) || []) {
        if (c < mark.from || c > mark.to) continue;
        const d = mark.segments.filter(s => Math.abs(s.t + dash / 2 - c) < .5 + dash).flatMap(s => clipLine(s.line, shape.planes)).filter(piece => piece.length > 1).map(polyline).join('');
        if (d) put(`${id}:mark-${mark.key}`, 'path', group, { class: 'loose-mark ' + mark.ink, d, 'stroke-width': inkWidth, opacity: mark.weight < .999 ? +mark.weight.toFixed(3) : null });
      }
    }
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) {
      const rowOver = over('row', r, c);
      const partner = (c === cols - 1) === (r % 2 === 0) ? r + 1 : r - 1, loopFront = (c === 0 || c === cols - 1) && partner >= 0 && partner < rows ? Math.min(rowOver, over('row', partner, c)) : 0;
      if (rowOver > .001) { cast('row', r, c, 'col', c, r, rowOver, r, c, loopFront); patch(r, c, rowOver, 'crossing', rowOver, loopFront); }
      if (loopFront > .001) patch(r, c, rowOver, 'loop', loopFront);
      if (rowOver > .001 && loopFront < .999 && turnedAt(r, c)) cast('col', c, r, 'row', r, c, Math.min(rowOver, 1 - loopFront), r, c, 0, true);
      if (rowOver < .999) cast('col', c, r, 'row', r, c, 1 - rowOver, r, c);
    }
    for (const [r, c] of board.pins) {
      const rowTop = grid[r][c] === 1;
      const x = +(c + (rowTop ? 0 : offset('col', c, r))).toFixed(4), y = +(r + (rowTop ? offset('row', r, c) : 0)).toFixed(4);
      const pulse = refusal && refusal.r === r && refusal.c === c ? refusal.pulse : 0;
      const knot = clamp(.055 * scale, 4, 7) / scale;
      // A pin takes the tone opposite the thread lying on top, so it reads on both.
      put(`knot-${r}-${c}`, 'circle', layers.knots, { class: 'knot ' + (rowTop ? 'on-weft' : 'on-warp'), 'data-r': r, 'data-c': c, cx: x, cy: y, r: +(knot * (1 + .75 * pulse)).toFixed(5) });
      if (refusal && refusal.r === r && refusal.c === c && reduced()) put(`refusal-${r}-${c}`, 'circle', layers.knots, { class: 'refusal-ring', cx: x, cy: y, r: +(knot + 6 / scale).toFixed(5) });
    }
    for (const k of kept) {
      const r = Math.floor(k / board.cols), c = k % board.cols;
      put(`kept-${k}`, 'rect', layers.knots, { class: 'kept-mark ' + (grid[r][c] === 1 ? 'on-weft' : 'on-warp'), 'data-r': r, 'data-c': c, x: c - .07, y: r - .07, width: .14, height: .14 });
    }
    for (const [key, n] of pool) if (!seen.has(key)) { n.remove(); pool.delete(key); memo.delete(key); }
    boardNode.dataset.busy = String(busy); boardNode.dataset.solved = String(E.solved(board, grid));
    boardNode.dataset.tight = String(+tight.toFixed(4)); boardNode.dataset.dye = String(+dye.toFixed(4)); boardNode.dataset.swapping = String(display.swap < 1);
  }
  // Rings sit on their own layer, so pointing and arrow keys redraw only
  // them. The focus ring is clearly wider than the dashed hint ring, and both
  // stand on a ground-coloured halo that keeps them clear of ribbon edges.
  function drawRings() {
    rings.replaceChildren();
    for (const [r, c] of hint?.pair || []) {
      svg('rect', { class: 'reason-halo', x: c - .32, y: r - .32, width: .64, height: .64 }, rings);
      svg('rect', { class: 'hint-pair', x: c - .32, y: r - .32, width: .64, height: .64 }, rings);
    }
    for (const [p, name, radius] of [[hover, 'hover-ring', .34], [hint && [hint.r, hint.c], 'hint-ring', .29], [keyboard && focus, 'focus-ring', .43]]) {
      if (!p) continue;
      if (name !== 'hover-ring') svg('circle', { class: 'ring-halo', cx: p[1], cy: p[0], r: radius }, rings);
      svg('circle', { class: name, cx: p[1], cy: p[0], r: radius }, rings);
    }
  }
  function draw() { if (built !== board) build(); drawCloth(); drawRings(); }
  function chrome() {
    const loose = E.loose(board, grid), solved = E.solved(board, grid), [r, c] = focus;
    const main = course.index(board.id), more = course.more.indexOf(board), label = main >= 0 ? `Board ${main + 1}` : more >= 0 ? `Optional cloth ${more + 1}` : 'Endless cloth';
    boardNode.setAttribute('aria-label', `${label}, ${count(board.rows, 'row')} by ${count(board.cols, 'column')}. ${solved ? 'Cloth finished.' : looseText(loose) + '.'} ${hitsWord()}, par ${parOf(board)}. Row ${r + 1}, column ${c + 1}: ${grid[r][c] === 1 ? 'row thread on top' : 'column thread on top'}${pinned(r, c) ? ', knotted' : kept.has(r * board.cols + c) ? ', marked' : ''}${inLoose(loose, r, c) ? ', in a long run' : ''}.`);
    // After the course an optional cloth shows how many of the forty-four are solved, +k / 44, while some are left or
    // it is solved; otherwise, and on an endless cloth, the infinity sign stands where a board shows its number, as
    // Tilt's pool and Cast's free play do. Both add the sixteen and the wins since: 16 + 12 ✓. Before the finish an
    // optional cloth (only an older save can hold one) keeps its own number.
    const after = main < 0 && allDone(), k = plus.set.length, N = course.more.length, inSet = after && more >= 0 && (k < N || solved);
    $('#readout').textContent = `${main >= 0 ? `${main + 1} / ${course.main.length}` : more >= 0 && !after ? `+${more + 1} / ${N}` : inSet ? `+${k} / ${N}` : '∞'} · ${hits} / ${parOf(board)}${after ? ' · ' + tally() : ''}`;
    $('#readout').setAttribute('aria-label', `${main >= 0 ? `${label} of ${course.main.length}` : more >= 0 && !after ? `${label} of ${N}` : inSet ? `${k} of ${N} optional cloths solved` : 'Endless cloth'}; ${hitsWord()}; par ${parOf(board)}${after ? '; ' + tallyWords() : ''}`);
    $('#keep-btn').setAttribute('aria-pressed', String(keepMode));
    $('#undo-btn').disabled = history.length === 0;
    $('#hint-btn').disabled = solved;
    showNext(solved);
    catalog();
  }
  // The end of the main course. Next takes the following board; after the last,
  // the first board not yet finished. With every main board finished, Next goes
  // on to the forty-four optional cloths not yet solved, drawn at random, and
  // once all are solved to endless cloths, each made from a new seed. Before
  // that, an optional cloth's Next returns to the main boards. Replay, from
  // board 1 with the finished marks kept, is left for a course with no Next.
  const allDone = () => course.main.every(b => finished.has(b.id)), setDone = () => plus.set.length === course.more.length;
  const endLine = () => `All ${course.main.length + (setDone() ? course.more.length : 0)} boards solved.`;
  const tally = () => `${course.main.length}${plus.wins ? ' + ' + plus.wins : ''} ✓`, tallyWords = () => `${course.main.length} boards${plus.wins ? ` and ${plus.wins} more` : ''} solved`;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  // An endless cloth waiting behind Next is only its id until it is opened.
  let drawn = null;
  function drawPool() {
    if (drawn && drawn !== board) return drawn;
    const left = course.more.filter(b => b !== board && !plus.set.includes(b.id));
    drawn = left.length ? pick(left) : { id: G.id(G.fresh()) };
    return drawn;
  }
  // New Game+'s Next cloth: an optional cloth not yet solved; with all solved, any
  // of them again, each once before any comes back.
  function nextCloth() {
    let left = course.more.filter(b => b !== board && !plus.set.includes(b.id));
    if (!left.length) left = course.more.filter(b => b !== board && !played.includes(b.id));
    if (!left.length) { played = []; left = course.more.filter(b => b !== board); }
    return pick(left);
  }
  function countPlus() {
    if (course.index(board.id) >= 0 || !allDone()) return;
    const id = board.seed === undefined ? board.id : 'g:' + board.seed;
    if (plus.held === id) return;
    plus.wins++; plus.held = id;
    if (board.seed === undefined && !plus.set.includes(board.id)) { plus.set.push(board.id); if (setDone()) setEnd = board.id; }
    if (!protectPlus) try { localStorage.setItem(PLUS, JSON.stringify(plus)); } catch (_) {}
  }
  function nextTarget() {
    const i = course.index(board.id);
    if (i >= 0 && i < course.main.length - 1) return course.main[i + 1];
    const open = course.main.find(b => !finished.has(b.id));
    if (i < 0) return open || drawPool() || course.main[0];
    return open || drawPool();
  }
  let nextMode = 'next';
  function showNext(solved) {
    const next = $('#next-btn'), line = $('#end-line'), mode = solved && !nextTarget() ? 'replay' : 'next';
    next.hidden = !solved;
    if (mode !== nextMode) {
      nextMode = mode;
      next.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[mode]}"/></svg>`;
    }
    next.setAttribute('aria-label', course.index(board.id) < 0 && !allDone() ? 'Return to main boards' : mode === 'replay' ? 'Replay from board 1' : 'Next board');
    line.textContent = endLine();
    // On a cloth after the course the line shows once, on the solve that completes the forty-four.
    line.hidden = !solved || !allDone() || course.index(board.id) < 0 && setEnd !== board.id;
  }
  // Settings lists every main board as current, completed, available or locked,
  // then New Game+: a line until the course is finished, then a row for the
  // optional cloths and one for endless cloths, each with its count.
  function catalog() {
    const list = $('#board-catalog');
    if (!list.children.length) course.main.forEach((b, i) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.dataset.board = b.id;
      button.innerHTML = `<span>Board ${i + 1}<span class="catalog-size"><span class="catalog-dot"> · </span>${b.rows}×${b.cols}</span></span><span class="catalog-state"></span>`;
      button.addEventListener('click', () => { if (!available(b)) return; if (b !== board) go(b.id); $('#settings').close(); });
      item.append(button); list.append(item);
    });
    course.main.forEach((b, i) => {
      const button = list.children[i].firstChild, here = b === board, done = finished.has(b.id), open = available(b);
      button.dataset.state = here ? 'current' : done ? 'completed' : open ? 'available' : 'locked';
      button.disabled = !open;
      button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, done ? 'Completed' : null, !here && !done ? (open ? 'Available' : 'Locked') : null].filter(Boolean).join(' · ');
      if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    const open = allDone();
    $('#plus-locked').hidden = open; $('#plus-more').hidden = !open; $('#plus-endless').hidden = !open;
    $('#plus-more span').textContent = `More cloths · ${plus.set.length} / ${course.more.length}`;
    $('#plus-endless span').textContent = `Endless · ${plus.wins} ✓`;
  }
  function rest() { display = { before: grid, after: grid, swap: 1, settle: 1 }; tight = dye = E.solved(board, grid) ? 1 : 0; draw(); chrome(); }
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
  async function change(next, nextHits, remember, token, at = null) {
    const before = grid, loosen = tight, dyed = dye;
    if (remember) history.push({ grid: copy(grid), hits, kept: [...kept] });
    if (at) kept.delete(at[0] * board.cols + at[1]);
    grid = next; hits = nextHits; hint = null; refusal = null;
    // The move is saved before any motion, so leaving the page cannot lose it.
    if (E.solved(board, grid)) { finished.add(board.id); reached = Math.min(boards.length - 1, Math.max(reached, boards.indexOf(board) + 1)); courseReached = Math.max(courseReached, course.openedBy(finished)); }
    // `finished` lists course boards only; a solve made by a move after the course may count as a win.
    if (board.seed !== undefined) finished.delete(board.id);
    if (remember && E.solved(board, grid)) countPlus();
    display = { before, after: grid, swap: 0, settle: 0 }; chrome(); save();
    // Unweaving a finished cloth opens it again and lets its colour go during the same swap.
    await tween(120, t => { display.swap = smooth(t); display.settle = smooth(t); tight = loosen * (1 - smooth(t)); dye = dyed * (1 - smooth(t)); draw(); });
    if (token !== epoch) return;
    display = { before: grid, after: grid, swap: 1, settle: 1 }; dye = 0;
    if (E.solved(board, grid)) {
      // The weave is beaten close once: one eased movement with no overshoot,
      // then the cloth holds still until the next board.
      await tween(600, t => { tight = Math.max(tight, beat(t)); draw(); });
      if (token !== epoch) return;
      // Then the dye flows along every thread, about a second, and holds.
      await tween(1100, t => { dye = Math.max(dye, t); draw(); });
      if (token !== epoch) return;
      announce(`Cloth finished in ${hitsWord()}. Par ${parOf(board)}. ${!allDone() ? 'Next board is ready.' : course.index(board.id) >= 0 || setEnd === board.id ? endLine() : tallyWords() + '.'}`);
    } else if (at) announce(`Flipped row ${at[0] + 1}, column ${at[1] + 1}. ${hitsWord()}. ${looseText(E.loose(board, grid))}.`);
  }
  async function act(action) {
    const token = epoch;
    if (action.type === 'keep') {
      const { r, c } = action;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= board.rows || c >= board.cols || pinned(r, c)) return;
      history.push({ grid: copy(grid), hits, kept: [...kept] });
      const k = r * board.cols + c; if (kept.has(k)) kept.delete(k); else kept.add(k);
      hint = null; save(); rest(); announce(`Row ${r + 1}, column ${c + 1} ${kept.has(k) ? 'marked' : 'unmarked'}.`);
    } else if (action.type === 'flip') {
      const { r, c } = action;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= board.rows || c >= board.cols) return;
      // Focus is not moved here: a queued flip starting later must not pull the
      // keyboard ring back from where arrow keys have taken it since.
      const next = E.flip(board, grid, r, c);
      if (!next) {
        refusal = { r, c, pulse: 0 }; announce(`Row ${r + 1}, column ${c + 1} is knotted and can’t flip.`);
        await tween(180, t => { if (refusal) refusal.pulse = Math.sin(t * Math.PI); draw(); }); return;
      }
      if (kept.has(r * board.cols + c) && !action.hinted) { announce(`Row ${r + 1}, column ${c + 1} is marked. Unmark it before you flip it.`); return; }
      await change(next, hits + 1, true, token, [r, c]);
    } else if (action.type === 'hint') {
      if (hint) await act({ type: 'flip', r: hint.r, c: hint.c, hinted: true });
      else {
        hint = E.hint(board, grid);
        if (hint) {
          focus = [hint.r, hint.c];
          // The pair both have one thread on top, so a third in that line would make a run of three.
          const pair = hint.pair?.map(([r, c]) => `row ${r + 1}, column ${c + 1}`).join(' and '), top = v => v === 1 ? 'the row thread' : 'the column thread';
          announce(pair ? `${pair[0].toUpperCase() + pair.slice(1)} both have ${top(-hint.to)} on top, so row ${hint.r + 1}, column ${hint.c + 1} needs ${top(hint.to)} on top. Press Hint again to flip it.` : `Flip row ${hint.r + 1}, column ${hint.c + 1}. Press Hint again to flip it.`);
        }
      }
    } else if (action.type === 'undo') {
      const previous = history.pop();
      if (previous) { kept = new Set(previous.kept || []); await change(previous.grid, previous.hits, false, token); announce(`Undone. ${hitsWord()}.`); }
      else { rest(); announce('Nothing to undo.'); }
    } else if (action.type === 'restart' || action.type === 'go') {
      if (action.type === 'go') {
        const next = lookup(action.id); if (!next || !available(next)) return; board = next; drawn = null;
        // Once all forty-four are solved, an optional cloth opened counts as served; the round ends once all have been.
        if (course.more.includes(board) && allDone() && setDone()) { const served = played.filter(id => id !== board.id).concat(board.id); played = served.length >= course.more.length ? [] : served; }
      }
      setEnd = null;
      grid = E.start(board); hits = 0; history = []; kept.clear(); keepMode = false; hint = null; hover = null; refusal = null; focus = [0, 0]; fit(); rest(); save();
      announce(action.type === 'restart' ? 'Board restarted.' : board.seed !== undefined ? 'Endless cloth.' : course.index(board.id) < 0 ? `Optional cloth ${course.more.indexOf(board) + 1}.` : `Board ${course.index(board.id) + 1}.`);
    }
  }
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
  const flip = (r, c) => enqueue({ type: 'flip', r, c });
  const undo = () => enqueue({ type: 'undo' }, true), restart = () => enqueue({ type: 'restart' }, true);
  // A locked board cannot be opened, from Settings or from the test hook.
  const go = id => { const b = lookup(id); return !b || !available(b) ? Promise.resolve(false) : enqueue({ type: 'go', id }, true).then(() => true); };
  // Hit-testing uses the board's fixed crossing grid, never a shape in motion.
  function nearest(event) {
    const matrix = boardNode.getScreenCTM(); if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const yPad = board.rows === 1 ? 1.1 : .5;
    if (p.x < -.5 || p.x > board.cols - .5 || p.y < -yPad || p.y > board.rows - 1 + yPad) return null;
    const r = clamp(Math.round(p.y), 0, board.rows - 1), c = clamp(Math.round(p.x), 0, board.cols - 1);
    // A knot has its own refusal target; the remainder of the cloth selects
    // the nearest free crossing rather than an unresponsive pinned neighbour.
    if (pinned(r, c) && Math.hypot(p.x - c, p.y - r) < .24) return [r, c];
    let best = null, distance = Infinity;
    for (let rr = 0; rr < board.rows; rr++) for (let cc = 0; cc < board.cols; cc++) {
      if (pinned(rr, cc)) continue;
      const d = Math.hypot(p.x - cc, p.y - rr); if (d < distance) { best = [rr, cc]; distance = d; }
    }
    return best;
  }
  // Each pointer is its own press, so two thumbs tapping in turn both count.
  boardNode.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.pointerType === 'mouse' && !e.isPrimary) || $('dialog[open]') || !nearest(e)) return;
    keyboard = false; gestures.set(e.pointerId, { x: e.clientX, y: e.clientY, last: { clientX: e.clientX, clientY: e.clientY }, travel: 0 });
    boardNode.focus({ preventScroll: true }); try { boardNode.setPointerCapture(e.pointerId); } catch (_) {} drawRings();
  });
  function release(e) {
    const g = gestures.get(e.pointerId); if (!g) return;
    const at = e.type === 'lostpointercapture' ? g.last : e;
    gestures.delete(e.pointerId); try { boardNode.releasePointerCapture(e.pointerId); } catch (_) {}
    const travel = Math.max(g.travel, Math.hypot(at.clientX - g.x, at.clientY - g.y)), p = nearest(at);
    if (travel <= 12 && p) { focus = p; enqueue({ type: keepMode ? 'keep' : 'flip', r: p[0], c: p[1] }); }
  }
  const same = (a, b) => a === b || !!a && !!b && a[0] === b[0] && a[1] === b[1];
  window.addEventListener('pointermove', e => {
    const g = gestures.get(e.pointerId);
    if (g) {
      g.last = { clientX: e.clientX, clientY: e.clientY };
      g.travel = Math.max(g.travel, Math.hypot(e.clientX - g.x, e.clientY - g.y));
      if (e.pointerType === 'mouse' && e.buttons === 0) release(e);
    }
    if (e.pointerType === 'mouse' && !$('dialog[open]')) { const p = nearest(e); if (!same(p, hover)) { hover = p; drawRings(); } }
  });
  window.addEventListener('pointerup', release);
  // Capture lost before the release counts as the release. Lost while still
  // pressed, the press waits for its pointerup on the window.
  boardNode.addEventListener('lostpointercapture', e => { if (e.buttons === 0) release(e); });
  window.addEventListener('pointercancel', e => { gestures.delete(e.pointerId); });
  boardNode.addEventListener('pointerleave', () => { if (hover) { hover = null; drawRings(); } });
  boardNode.addEventListener('focus', () => { if (!gestures.size) keyboard = true; drawRings(); chrome(); });
  boardNode.addEventListener('blur', () => { keyboard = false; drawRings(); });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); undo(); return; }
    if (key === 'h') { e.preventDefault(); enqueue({ type: 'hint' }); return; }
    if (key === 'l' && e.target === boardNode) { e.preventDefault(); enqueue({ type: 'keep', r: focus[0], c: focus[1] }); return; }
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
    if (d) { e.preventDefault(); focus = [clamp(focus[0] + d[0], 0, board.rows - 1), clamp(focus[1] + d[1], 0, board.cols - 1)]; keyboard = true; hover = null; boardNode.focus({ preventScroll: true }); drawRings(); chrome(); }
    if ((key === 'Enter' || key === ' ') && e.target === boardNode) { e.preventDefault(); enqueue({ type: keepMode ? 'keep' : 'flip', r: focus[0], c: focus[1] }); }
  });
  boardNode.addEventListener('contextmenu', e => { e.preventDefault(); const p = nearest(e); if (p && !$('dialog[open]')) { focus = p; enqueue({ type: 'keep', r: p[0], c: p[1] }); } });
  for (const name of ['dragstart', 'selectstart']) boardNode.addEventListener(name, e => e.preventDefault());
  const icons = { keep: 'M5 12l4 4L19 6M4 3h16v18H4Z', restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', replay: 'M4 11V9a3 3 0 0 1 3-3h12m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H5m3 3-3-3 3-3', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, d] of Object.entries(icons)) if (id !== 'replay') $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  $('#undo-btn').onclick = undo; $('#restart-btn').onclick = restart; $('#hint-btn').onclick = () => enqueue({ type: 'hint' });
  $('#keep-btn').onclick = () => { keepMode = !keepMode; chrome(); announce(keepMode ? 'Marking on. Choose a crossing to mark or unmark it.' : 'Marking off.'); };
  $('#next-btn').onclick = () => { if (!E.solved(board, grid)) return; const next = nextTarget(); go((next || course.main[0]).id); };
  $('#next-cloth').onclick = () => { if (!allDone()) return; go(nextCloth().id); $('#settings').close(); };
  $('#new-cloth').onclick = () => { if (!allDone()) return; go(G.id(G.fresh())); $('#settings').close(); };
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').onclick = () => { gestures.clear(); hover = null; drawRings(); $('#' + id).showModal(); };
    $('#' + id).addEventListener('close', () => $('#' + id + '-btn').focus());
  }
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.motion = prefs.motion;
    $('#theme').value = prefs.theme; $('#motion').value = prefs.motion;
    $('meta[name="theme-color"]').content = dark() ? '#000000' : '#ffffff';
    if (reduced()) animation?.finish();
    if (!busy) rest(); else draw();
  }
  for (const id of ['theme', 'motion']) $('#' + id).onchange = e => { prefs[id] = e.target.value; applyPrefs(); save(); announce(id === 'theme' ? 'Theme changed.' : 'Motion setting changed.'); };
  motionQuery.addEventListener('change', applyPrefs); darkQuery.addEventListener('change', applyPrefs);
  window.addEventListener('resize', () => { fit(); draw(); });
  // A page hidden mid-motion finishes it at once rather than leaving it paused.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) animation?.finish();
  });
  window.__weave = { boards, get board() { return board.id; }, get state() { return { rows: board.rows, cols: board.cols, grid: copy(grid), pins: board.pins.map(p => p.slice()), loose: E.loose(board, grid), solved: E.solved(board, grid), hits, par: parOf(board), kept: [...kept] }; }, get reached() { return reached; }, get courseReached() { return courseReached; }, get played() { return played.slice(); }, get plus() { return JSON.parse(JSON.stringify(plus)); }, course, flip, undo, restart, go };
  window.__minimalize = { bounds() {
    const box = cloth.getBBox(), m = cloth.getScreenCTM();
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    // Filled ribbon outlines give geometric paint bounds; add the half-pixel
    // non-scaling hairline, which SVG getBBox excludes.
    return { x: Math.min(...xs) - .5, y: Math.min(...ys) - .5, width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
  } };
  fit(); applyPrefs(); rest(); save();
})();
