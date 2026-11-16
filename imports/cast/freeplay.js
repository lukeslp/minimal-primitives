/* Cast · free play: boards drawn in the browser by the campaign's own rules. By Luke Steuber. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const free = factory(root.CastEngine || (node ? require('./engine.js') : null), root.CastBoards || (node ? require('./boards.js') : []));
  if (typeof module === 'object' && module.exports) module.exports = free;
  else root.CastFree = free;
})(typeof globalThis === 'object' ? globalThis : this, function (E, campaign) {
  'use strict';
  // A port of development/campaign.cjs for play after board 50: the same drawn outlines, the same candidate
  // drawing and the same rules, with the late campaign's slot (trial or trials, rooms four or five high,
  // 18 to 26 cubes, three or more below the wall fill). Each free board is the first seed at or after its
  // start whose candidate has exactly one answer and passes every rule. test-engine.cjs checks that this
  // port draws and judges exactly as campaign.cjs does, and that free boards are unique under both solvers.
  const SLOT = {tier: 4, tiers: [3, 4], gap: 3, heights: [4, 5, 5], cubes: [18, 26], k: 50};
  const mulberry = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const SHAPES = {
    ring: ['#####', '#...#', '#...#', '#...#', '#####'], ell: ['##...', '##...', '##...', '#####', '#####'], angle: ['#....', '#....', '#....', '#....', '#####'],
    tee: ['#####', '..#..', '..#..', '..#..', '..#..'], plus: ['..#..', '..#..', '#####', '..#..', '..#..'], aitch: ['#...#', '#...#', '#####', '#...#', '#...#'],
    cup: ['#...#', '#...#', '#...#', '#...#', '#####'], stairs: ['#....', '##...', '###..', '####.', '#####'], band: ['##...', '###..', '.###.', '..###', '...##'],
    ess: ['#####', '#....', '#####', '....#', '#####'], comb: ['#####', '#....', '####.', '#....', '#####'], spiral: ['#####', '....#', '###.#', '#...#', '#####'],
    cee: ['#####', '#....', '#....', '#....', '#####'], pi: ['#####', '.#.#.', '.#.#.', '.#.#.', '.#.#.'], diamond: ['..#..', '.###.', '#####', '.###.', '..#..'],
    zigzag: ['##...', '.##..', '..##.', '...##', '....#'], teeth: ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'], ladder: ['#...#', '#####', '#...#', '#####', '#...#'],
    arch: ['#####', '#####', '##.##', '#...#', '#...#'], pinwheel: ['###.#', '..#.#', '#####', '#.#..', '#.###'], frame: ['#####', '#...#', '#....', '#...#', '#####'],
    eff: ['#####', '#....', '####.', '#....', '#....'], pee: ['####.', '#...#', '####.', '#....', '#....'], zed: ['#####', '...#.', '..#..', '.#...', '#####'],
    wedge: ['#####', '####.', '###..', '##...', '#....'], lattice: ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'], hook: ['#####', '#...#', '#.#.#', '#.###', '#....'],
    bracket: ['###..', '#....', '#####', '....#', '..###'], steps: ['###..', '..#..', '..###', '....#', '....#'], anvil: ['#####', '#####', '..#..', '..#..', '.###.'],
    mushroom: ['.###.', '#####', '..#..', '..#..', '.###.'], gate: ['#####', '#.#.#', '#.#.#', '#...#', '#...#'], vee: ['#...#', '##.##', '.###.', '..#..', '..#..'],
    corner: ['#####', '#####', '##...', '##...', '##...'], hourglass: ['#####', '.###.', '..#..', '.###.', '#####'], key: ['###..', '#.#..', '#####', '...#.', '...##'],
    fork: ['#.#.#', '#####', '..#..', '..#..', '..#..'], chair: ['#....', '#....', '#####', '#...#', '#...#'], bolt: ['###..', '..#..', '.###.', '.#...', '.####'],
    tetris: ['##...', '##...', '.###.', '...##', '...##'],
  };
  const NAMES = Object.keys(SHAPES);
  const MAPS = n => [(r, c) => [r, c], (r, c) => [c, n - 1 - r], (r, c) => [n - 1 - r, n - 1 - c], (r, c) => [n - 1 - c, r], (r, c) => [r, n - 1 - c], (r, c) => [n - 1 - r, c], (r, c) => [c, r], (r, c) => [n - 1 - c, n - 1 - r]];
  const outline = (name, turn) => { const s = SHAPES[name], n = s.length, g = Array.from({length: n}, () => Array(n).fill(0)), m = MAPS(n)[turn]; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const [a, d] = m(r, c); g[a][d] = s[r][c] === '#' ? 1 : 0; } return g; };
  const boardFrom = (h, maxH) => { const v = E.views(h); return {n: h.length, maxH, left: v.left, right: v.right, plan: v.plan, cubes: E.used(h)}; };

  // The deduction ladder (see campaign.cjs): 1 walls, 2 tray, 3 trial, 4 trials, 5 deep.
  function consistent(b, dom) {
    const n = b.n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!dom[r][c].length) return false;
    for (let r = 0; r < n; r++) if (!dom[r].some(d => d.includes(b.left[r]))) return false;
    for (let c = 0; c < n; c++) if (!dom.some(row => row[c].includes(b.right[c]))) return false;
    let lo = 0, hi = 0; for (const row of dom) for (const d of row) { lo += d[0]; hi += d[d.length - 1]; }
    return lo <= b.cubes && hi >= b.cubes;
  }
  function walls(b, dom) {
    const n = b.n;
    for (let changed = true; changed;) {
      changed = false;
      for (let r = 0; r < n; r++) { const k = []; for (let c = 0; c < n; c++) if (dom[r][c].includes(b.left[r])) k.push(c); if (k.length === 1 && dom[r][k[0]].length > 1) { dom[r][k[0]] = [b.left[r]]; changed = true; } }
      for (let c = 0; c < n; c++) { const k = []; for (let r = 0; r < n; r++) if (dom[r][c].includes(b.right[c])) k.push(r); if (k.length === 1 && dom[k[0]][c].length > 1) { dom[k[0]][c] = [b.right[c]]; changed = true; } }
      if (!consistent(b, dom)) return;
    }
  }
  function tray(b, dom) {
    const n = b.n; let lo = 0, hi = 0, changed = false;
    for (const row of dom) for (const d of row) { lo += d[0]; hi += d[d.length - 1]; }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const d = dom[r][c], mn = b.cubes - (hi - d[d.length - 1]), mx = b.cubes - (lo - d[0]), f = d.filter(v => v >= mn && v <= mx); if (f.length !== d.length) { dom[r][c] = f; changed = true; } }
    return changed;
  }
  function settle(b, dom) { for (;;) { walls(b, dom); if (!consistent(b, dom)) return false; if (!tray(b, dom)) return true; if (!consistent(b, dom)) return false; } }
  const domains = b => b.plan.map((row, r) => row.map((p, c) => { const cap = Math.min(b.left[r], b.right[c]); return p ? Array.from({length: cap}, (_, i) => i + 1) : [0]; }));
  function ladder(b) {
    const dom = domains(b), n = b.n, done = () => dom.every(row => row.every(d => d.length === 1));
    let trays = 0, trials = 0, deep = false;
    for (let guard = 0; guard < 400; guard++) {
      walls(b, dom);
      if (done()) break;
      if (tray(b, dom)) { trays++; continue; }
      let found = false;
      for (let r = 0; r < n && !found; r++) for (let c = 0; c < n && !found; c++) if (dom[r][c].length > 1) for (const v of dom[r][c]) {
        const copy = dom.map(row => row.map(d => d.slice())); copy[r][c] = [v];
        if (!settle(b, copy)) { dom[r][c] = dom[r][c].filter(x => x !== v); trials++; found = true; break; }
      }
      if (!found) { deep = true; break; }
    }
    return {tier: deep ? 5 : trials >= 3 ? 4 : trials ? 3 : trays ? 2 : 1, trays, trials};
  }

  // What the fixed front camera shows (see campaign.cjs): nothing hidden, no strip taller than the room,
  // and most of every top in view.
  function buried(h) {
    const n = h.length, out = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (h[r][c]) for (let k = 1; r - k >= 0 && c - k >= 0; k++) { const hb = h[r - k][c - k]; if (hb && h[r][c] >= hb + k) out.push([r - k, c - k]); }
    return out;
  }
  function strip(h, r, c) {
    let top = h[r][c];
    for (let k = 1; r - k >= 0 && c - k >= 0 && k <= top; k++) if (h[r - k][c - k]) top = Math.max(top, k + h[r - k][c - k]);
    return top;
  }
  function topSeen(h, r, c) {
    const n = h.length, boxes = [], U = [.2, .5, .8];
    for (let a = 0; a < n; a++) for (let d = 0; d < n; d++) if (h[a][d] && (a !== r || d !== c)) boxes.push([d, 0, a, d + 1, h[a][d], a + 1]);
    const hit = p => boxes.some(([x0, y0, z0, x1, y1, z1]) => { let t0 = 1e-6, t1 = Infinity; const lo = [x0, y0, z0], hi = [x1, y1, z1]; for (let i = 0; i < 3; i++) { const a = lo[i] - p[i], b = hi[i] - p[i]; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); } return t0 < t1; });
    let seen = 0; for (const u of U) for (const v of U) if (!hit([c + u, h[r][c] + 1e-4, r + v])) seen++;
    return seen / 9;
  }
  function islands(plan) {
    const n = plan.length, seen = plan.map(row => row.map(() => false)); let singles = 0, parts = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (plan[r][c] && !seen[r][c]) {
      parts++; let size = 0; const stack = [[r, c]]; seen[r][c] = true;
      while (stack.length) { const [a, d] = stack.pop(); size++; for (const [x, y] of [[a + 1, d], [a - 1, d], [a, d + 1], [a, d - 1]]) if (x >= 0 && y >= 0 && x < n && y < n && plan[x][y] && !seen[x][y]) { seen[x][y] = true; stack.push([x, y]); } }
      if (size === 1) singles++;
    }
    return {parts, singles};
  }
  const fillToWalls = b => b.plan.reduce((a, row, r) => a + row.reduce((s, p, c) => s + (p ? Math.min(b.left[r], b.right[c]) : 0), 0), 0);
  function violations(b, h, s = SLOT, {tops = true} = {}) {
    const out = [], n = b.n;
    if (b.cubes > 26) out.push('more than 26 cubes');
    if (fillToWalls(b) - b.cubes < s.gap) out.push(`answer within ${s.gap} of the wall fill`);
    for (let r = 1; r < n; r++) for (let c = 1; c < n; c++) if (h[r][c] >= h[r - 1][c - 1] + 2) out.push(`column ${r}${c} two above the one behind`);
    if (buried(h).length) out.push('a column hidden behind another');
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (h[r][c] && strip(h, r, c) > b.maxH) out.push(`strip at ${r}${c} taller than the room`);
    if (tops) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (h[r][c] && topSeen(h, r, c) < 5 / 9) out.push(`the top of ${r}${c} is mostly hidden`);
    if (Math.max(...h.flat()) !== b.maxH) out.push('the tallest stack is short of the room');
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (h[r][c] === b.maxH && 2 * n - 2 - r - c < 2) out.push('the tallest stack stands at the front corner');
    if (s.k > 15 && (b.left.includes(0) || b.right.includes(0))) out.push('an empty row or column');
    if (islands(b.plan).singles > 2) out.push('more than two single squares');
    return out;
  }
  // The campaign's candidate for slot `s`: an outline, a turn, a room height and a height style, heights
  // raised from the back corner forward, never above the column diagonally behind.
  function candidate(seed, s = SLOT, names = NAMES) {
    const rnd = mulberry(seed), name = names[Math.floor(rnd() * names.length)], turn = Math.floor(rnd() * 8);
    const maxH = s.heights[Math.floor(rnd() * s.heights.length)], pick = rnd(), style = s.tier >= 3 ? (pick < .7 ? 0 : 2) : Math.floor(pick * 4), plan = outline(name, turn), n = plan.length;
    const h = plan.map(row => row.map(() => 0)), cells = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (plan[r][c]) cells.push([r, c]);
    cells.sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0]);
    const edge = cells.filter(([r, c]) => !r || !c), level = 2 + Math.floor(rnd() * Math.max(1, maxH - 2)), tower = edge[Math.floor(rnd() * edge.length)] || cells[0];
    let used = 0;
    cells.forEach(([r, c], i) => {
      const bound = Math.min(r && c ? Math.max(1, Math.min(maxH, h[r - 1][c - 1])) : maxH, Math.max(1, s.cubes[1] - used - (cells.length - 1 - i)));
      let v;
      if (r === tower[0] && c === tower[1] && style !== 1) v = maxH;
      else if (style === 0) v = 1 + Math.floor(rnd() * bound);
      else if (style === 1) v = Math.round(maxH - (r + c) / (2 * n - 2) * (maxH - 1) + (rnd() - .5) * 2.4);
      else if (style === 2) v = rnd() < .75 ? level : 1 + Math.floor(rnd() * level);
      else v = rnd() < .3 ? bound : 1;
      h[r][c] = Math.max(1, Math.min(bound, v)); used += h[r][c];
    });
    return {board: boardFrom(h, maxH), heights: h, shape: name, turn, style};
  }
  // Whether a candidate makes a free board: the cube range, the rules, one answer, a rung of trial or trials,
  // and not one of the fifty (the same drawing rules meet a campaign board about once in 130 draws).
  const key = b => JSON.stringify([b.n, b.maxH, b.left, b.right, b.plan, b.cubes]), fifty = new Set(campaign.map(key));
  function accept(cand, s = SLOT) {
    const b = cand.board;
    if (b.cubes < s.cubes[0] || b.cubes > s.cubes[1] || fifty.has(key(b))) return false;
    if (violations(b, cand.heights, s, {tops: false}).length) return false;
    const solved = E.solve(b, 2);
    if (solved.count !== 1 || solved.exhausted) return false;
    if (!s.tiers.includes(ladder(b).tier)) return false;
    return !violations(b, cand.heights, s).length;
  }
  // The free board for a start seed: the first accepted seed at or after it whose board is not in `avoid`
  // (keys of boards played lately; a few boards come up often). Seeds are 31-bit.
  function board(start, avoid = null) {
    for (let seed = Math.abs(Math.floor(start)) % 0x80000000, tries = 0; tries < 200000; seed = (seed + 1) % 0x80000000, tries++) {
      const cand = candidate(seed);
      if (accept(cand) && !(avoid && avoid.has(key(cand.board)))) return {id: 'free', seed, n: cand.board.n, maxH: cand.board.maxH, left: cand.board.left, right: cand.board.right, plan: cand.board.plan, cubes: cand.board.cubes};
    }
    return null;
  }
  // A saved free board is drawn again from its own seed; a seed that is no longer accepted is refused.
  function fromSeed(seed) { if (!Number.isInteger(seed) || seed < 0 || seed >= 0x80000000) return null; const b = board(seed); return b && b.seed === seed ? b : null; }
  return {SLOT, key, SHAPES, NAMES, MAPS, outline, ladder, buried, strip, topSeen, islands, fillToWalls, violations, candidate, accept, board, fromSeed};
});
