/* Delve: an endless descent drawn in squares.
 * Turn-based on a square grid. Every floor is built from the run seed and
 * its depth, so a run is reproducible. Enemies show the square they will
 * strike before they strike it, and they come in packs. Works in the browser (root.Delve) and in
 * Node (module.exports). The grid routines (recursive shadowcasting,
 * rooms-and-corridors, breadth-first distances, mulberry32) are ported
 * from naqbu; see LICENSE-NOTES. */
(function (root) {
  'use strict';

  /* ---------- randomness ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFor(seed) {
    const next = mulberry32(seed >>> 0);
    return {
      next,
      int: (a, b) => a + Math.floor(next() * (b - a + 1)),
      chance: (p) => next() < p,
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
    };
  }
  /* FNV-1a over text, so a daily seed is the same on every device. */
  function hashString(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
    return h >>> 0;
  }
  function dailySeed(date) {
    const d = date || new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { seed: hashString('delve-daily-' + key), key };
  }
  function randomSeed() { return (Math.random() * 4294967296) >>> 0; }

  /* ---------- the grid ---------- */
  /* A floor is the size of a phone screen, so the whole of it is on the page
   * and what you have not walked through is dark, not off the edge. */
  const W = 12, H = 20, RADIUS = 6;
  const WALL = 0, FLOOR = 1, STAIRS = 2;
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const KINDS = {
    // blot: steps up and strikes the square you stand on.
    blot: { hp: 2, dmg: 1, reach: 1 },
    // lancer: strikes two squares in a straight line.
    lancer: { hp: 1, dmg: 1, reach: 2, line: true },
    // hulk: slow, strikes every square around it.
    hulk: { hp: 3, dmg: 2, reach: 1, sweep: true, slow: true },
  };
  const MAX_HP = 5;
  /* Gear is found, never bought: a blade adds one to every hit you land, armor
   * adds one square of health. What you can carry stops early, because the
   * dungeon never stops: one blade (a hulk still takes two hits), three armor,
   * two flasks. */
  const MAX_BLADE = 1, MAX_ARMOR = 3, MAX_FLASKS = 2;
  /* The numbers the depth curve was tuned with (scripted readers, see the
   * README). Enemies on a floor below the first: `base + per * depth + quad *
   * depth * depth`, rounded and never capped. `flask` and `gear` are the
   * chance a floor holds one; `clear` is how many steps from the start the
   * nearest enemy may stand; `wide` is the share of corridors cut two squares
   * wide, so that a pack is not always met one at a time; `unit` keeps a pack
   * with a hulk in it walking at the hulk's pace. */
  const TUNE = { base: 3, per: 1, quad: 0.02, flask: 0.5, gear: 0.4, clear: 5, wide: 0.5, unit: 1 };

  const idx = (f, x, y) => y * f.w + x;
  const inBounds = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h;
  const tileAt = (f, x, y) => (inBounds(f, x, y) ? f.tiles[idx(f, x, y)] : WALL);
  const passable = (f, x, y) => tileAt(f, x, y) !== WALL;

  /* Recursive shadowcasting from (ox, oy) within radius. Returns a mask. */
  function lineOfSight(f, ox, oy, radius) {
    const out = new Uint8Array(f.w * f.h);
    out[idx(f, ox, oy)] = 1;
    const r2 = radius * radius;
    const opaque = (x, y) => !inBounds(f, x, y) || f.tiles[idx(f, x, y)] === WALL;
    const OCT = [[1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1], [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]];
    function cast(row, start, end, xx, xy, yx, yy) {
      if (start < end) return;
      let newStart = 0;
      for (let j = row; j <= radius; j++) {
        let blocked = false;
        for (let dx = -j, dy = -j; dx <= 0; dx++) {
          const lSlope = (dx - 0.5) / (dy + 0.5);
          const rSlope = (dx + 0.5) / (dy - 0.5);
          if (start < rSlope) continue;
          if (end > lSlope) break;
          const x = ox + dx * xx + dy * xy;
          const y = oy + dx * yx + dy * yy;
          if (inBounds(f, x, y) && dx * dx + dy * dy <= r2) out[idx(f, x, y)] = 1;
          if (blocked) {
            if (opaque(x, y)) newStart = rSlope;
            else { blocked = false; start = newStart; }
          } else if (opaque(x, y) && j < radius) {
            blocked = true;
            cast(j + 1, start, lSlope, xx, xy, yx, yy);
            newStart = rSlope;
          }
        }
        if (blocked) break;
      }
    }
    for (const [xx, xy, yx, yy] of OCT) cast(1, 1, 0, xx, xy, yx, yy);
    return out;
  }

  /* Breadth-first distances over floor, eight ways. -1 is unreachable. */
  function distanceMap(f, sx, sy) {
    const dist = new Int16Array(f.w * f.h).fill(-1);
    if (!inBounds(f, sx, sy) || !passable(f, sx, sy)) return dist;
    const q = new Int32Array(f.w * f.h);
    let head = 0, tail = 0;
    dist[idx(f, sx, sy)] = 0;
    q[tail++] = idx(f, sx, sy);
    while (head < tail) {
      const i = q[head++];
      const x = i % f.w, y = (i / f.w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(f, nx, ny)) continue;
        const ni = idx(f, nx, ny);
        if (dist[ni] !== -1 || f.tiles[ni] === WALL) continue;
        dist[ni] = dist[i] + 1;
        q[tail++] = ni;
      }
    }
    return dist;
  }

  /* ---------- floors ---------- */
  function carve(f, x, y) {
    if (inBounds(f, x, y) && f.tiles[idx(f, x, y)] === WALL) f.tiles[idx(f, x, y)] = FLOOR;
  }
  /* An L from one room's middle to another's. Half of them are two squares wide. */
  function corridor(f, rng, ax, ay, bx, by) {
    let x = ax, y = ay;
    const wide = TUNE.wide > 0 && rng.chance(TUNE.wide);
    const sx = bx >= ax ? 1 : -1, sy = by >= ay ? 1 : -1;
    const stepX = () => { while (x !== bx) { x += Math.sign(bx - x); carve(f, x, y); if (wide) carve(f, x, y + (inBounds(f, x, y + sy) ? sy : -sy)); } };
    const stepY = () => { while (y !== by) { y += Math.sign(by - y); carve(f, x, y); if (wide) carve(f, x + (inBounds(f, x + sx, y) ? sx : -sx), y); } };
    if (rng.chance(0.5)) { stepX(); stepY(); } else { stepY(); stepX(); }
  }
  const center = (r) => [Math.floor((r.x1 + r.x2) / 2), Math.floor((r.y1 + r.y2) / 2)];
  // Rooms keep at least one square of rock between them.
  function overlaps(a, rooms) {
    return rooms.some((b) => a.x1 - 1 <= b.x2 && a.x2 + 1 >= b.x1 && a.y1 - 1 <= b.y2 && a.y2 + 1 >= b.y1);
  }
  function floorTiles(f) {
    const out = [];
    for (let i = 0; i < f.tiles.length; i++) if (f.tiles[i] === FLOOR) out.push(i);
    return out;
  }
  const roomOf = (f, i) => f.rooms.findIndex((r) => (i % f.w) >= r.x1 && (i % f.w) <= r.x2 && ((i / f.w) | 0) >= r.y1 && ((i / f.w) | 0) <= r.y2);
  /* Which enemies a depth draws from; the list is a weighting. Blots alone on
   * the first floor, lancers from the second, hulks from the fourth, and the
   * blots thin out as the others thicken. */
  function kindsFor(depth) {
    if (depth < 2) return ['blot'];
    if (depth < 4) return ['blot', 'blot', 'lancer'];
    if (depth < 7) return ['blot', 'blot', 'lancer', 'lancer', 'hulk'];
    if (depth < 12) return ['blot', 'lancer', 'lancer', 'hulk', 'hulk'];
    return ['blot', 'lancer', 'lancer', 'lancer', 'hulk', 'hulk', 'hulk'];
  }
  /* Enemies come in packs. Three on the first floor, five on the second, and
   * from there one more every floor and a little more than that the deeper
   * you go, without end; the biggest pack a depth allows grows too. */
  const enemyCount = (depth) => Math.round(TUNE.base + TUNE.per * depth + TUNE.quad * depth * depth);
  const packLimit = (depth) => (depth < 6 ? 3 : depth < 12 ? 4 : depth < 20 ? 5 : 6);
  function packSizes(depth) {
    if (depth === 1) return [2, 1]; // the first floor: a pair, and one blot alone to learn on
    const n = enemyCount(depth), k = Math.ceil(n / packLimit(depth)), out = [];
    for (let i = 0; i < k; i++) out.push(Math.floor(n / k) + (i < n % k ? 1 : 0));
    return out; // largest first
  }

  /* Rooms and corridors: four to seven rooms, joined top to bottom with two
   * extra links (half the corridors two squares wide), the start in one room and the stairs in another, far off. */
  function layout(rng, depth) {
    const f = { w: W, h: H, depth, tiles: new Uint8Array(W * H), seen: new Uint8Array(W * H), rooms: [], start: null, stairs: null, enemies: [], flasks: [], gear: [] };
    const target = rng.int(5, 7);
    for (let tries = 0; tries < 300 && f.rooms.length < target; tries++) {
      const w = rng.int(3, 6), h = rng.int(3, 5);
      const x1 = rng.int(0, W - w), y1 = rng.int(0, H - h);
      const r = { x1, y1, x2: x1 + w - 1, y2: y1 + h - 1 };
      if (!overlaps(r, f.rooms)) f.rooms.push(r);
    }
    f.rooms.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
    for (const r of f.rooms) for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) f.tiles[idx(f, x, y)] = FLOOR;
    for (let i = 0; i < f.rooms.length - 1; i++) corridor(f, rng, ...center(f.rooms[i]), ...center(f.rooms[i + 1]));
    for (let k = 0; k < 2; k++) {
      const a = rng.pick(f.rooms), b = rng.pick(f.rooms);
      if (a !== b) corridor(f, rng, ...center(a), ...center(b));
    }
    const startRoom = rng.pick(f.rooms);
    f.start = [rng.int(startRoom.x1, startRoom.x2), rng.int(startRoom.y1, startRoom.y2)];
    const dist = distanceMap(f, f.start[0], f.start[1]), all = floorTiles(f), si0 = idx(f, f.start[0], f.start[1]);
    let max = 0;
    for (const i of all) if (dist[i] > max) max = dist[i];
    // The stairs: far, in a room that is not the start's, and never the only way
    // through (a walk past them must not have to go down).
    const hangs = (s) => {
      const seen = new Uint8Array(W * H), q = [si0];
      seen[si0] = 1;
      for (let h = 0; h < q.length; h++) for (const [dx, dy] of DIRS) {
        const x = (q[h] % W) + dx, y = ((q[h] / W) | 0) + dy, j = y * W + x;
        if (!inBounds(f, x, y) || seen[j] || j === s || f.tiles[j] === WALL) continue;
        seen[j] = 1; q.push(j);
      }
      return q.length !== all.length - 1;
    };
    const far = rng.shuffle(all.filter((i) => dist[i] >= Math.max(8, max * 0.6) && roomOf(f, i) >= 0 && f.rooms[roomOf(f, i)] !== startRoom));
    let si = far.find((i) => !hangs(i));
    // A floor worth the screen: four rooms at least, spread over most of its height.
    const top = Math.min(...f.rooms.map((r) => r.y1)), bottom = Math.max(...f.rooms.map((r) => r.y2));
    f.ok = si !== undefined && f.rooms.length >= 4 && bottom - top >= 15;
    if (si === undefined) si = all.filter((i) => dist[i] === max)[0];
    f.tiles[si] = STAIRS;
    f.stairs = [si % W, (si / W) | 0];
    return f;
  }

  /* One floor from the run seed and its depth. The layout is drawn again (from
   * the same stream, so a seed still gives one floor) until it has four rooms
   * and a proper place for the stairs. Then the packs: each takes a room away
   * from the start and out of its sight, and the floor's flask and gear lie in
   * the middle of a pack, so the things worth having are the things guarded. */
  function makeFloor(seed, depth) {
    const rng = rngFor(hashString(seed + ':' + depth));
    let f = null;
    for (let attempt = 0; attempt < 40; attempt++) { f = layout(rng, depth); if (f.ok) break; }
    delete f.ok;
    const dist = distanceMap(f, f.start[0], f.start[1]), sees = lineOfSight(f, f.start[0], f.start[1], RADIUS);
    const startRoom = roomOf(f, idx(f, f.start[0], f.start[1])), stairsRoom = roomOf(f, idx(f, f.stairs[0], f.stairs[1]));
    const taken = new Set();
    // Where an enemy or a thing may be put: open floor, some steps from the start and out of its sight.
    let clear = TUNE.clear, hidden = true;
    const free = (i) => f.tiles[i] === FLOOR && !taken.has(i) && dist[i] >= clear && !(hidden && sees[i]);
    const hasFlask = depth === 1 || rng.chance(TUNE.flask);
    const gearKind = depth >= 2 && rng.chance(TUNE.gear) ? (rng.chance(0.5) ? 'blade' : 'armor') : null;
    // Rooms in the order the packs take them: any but the start's, the stairs' room last.
    const order = rng.shuffle(f.rooms.map((r, k) => k).filter((k) => k !== startRoom));
    if (depth === 1) order.sort((a, b) => dist[idx(f, ...center(f.rooms[a]))] - dist[idx(f, ...center(f.rooms[b]))]);
    else if (order.includes(stairsRoom)) { order.splice(order.indexOf(stairsRoom), 1); order.push(stairsRoom); }
    const sizes = packSizes(depth);
    // The first floor teaches: the lone blot stands in the nearest room, the pair farther in.
    if (depth === 1) sizes.reverse();
    const kinds = kindsFor(depth);
    const used = new Set(); // rooms that already hold a pack
    let id = 0;
    sizes.forEach((size, p) => {
      const holds = [];
      if (hasFlask && p === (depth === 1 ? sizes.length - 1 : 0)) holds.push('flask');
      if (gearKind && p === Math.min(1, sizes.length - 1)) holds.push(gearKind);
      // Its room, or the next in the order with a square to spare (one without a pack first); failing every room, nearer the start.
      let spots = [];
      for (const relax of [[TUNE.clear, true], [TUNE.clear, false], [3, false]]) {
        [clear, hidden] = relax;
        for (const fresh of [true, false]) for (let k = 0; k < order.length && !spots.length; k++) {
          const room = order[(p + k) % order.length];
          if (!fresh || !used.has(room)) spots = floorTiles(f).filter((i) => free(i) && roomOf(f, i) === room);
        }
        if (!spots.length) spots = floorTiles(f).filter(free);
        if (spots.length) break;
      }
      if (!spots.length) return;
      const anchor = rng.pick(spots);
      used.add(roomOf(f, anchor));
      const ad = distanceMap(f, anchor % W, (anchor / W) | 0);
      // What the pack guards lies at its middle; the pack stands around it.
      for (const thing of holds) {
        const at = thing === 'flask' || !holds.includes('flask') ? anchor : floorTiles(f).filter((i) => free(i) && i !== anchor).sort((a, b) => ad[a] - ad[b])[0];
        if (at === undefined) continue;
        taken.add(at);
        if (thing === 'flask') f.flasks.push([at % W, (at / W) | 0]);
        else f.gear.push({ x: at % W, y: (at / W) | 0, kind: thing });
      }
      const mine = [];
      for (let k = 0; k < size; k++) {
        let kind = rng.pick(kinds);
        // Packs are mixed wherever the depth has more than one kind to mix.
        if (k === size - 1 && size > 1 && kinds.some((x) => x !== kind) && mine.every((x) => x === kind)) kind = rng.pick(kinds.filter((x) => x !== kind));
        mine.push(kind);
      }
      // Its members stand close around, on squares as far from the start and as hidden as the anchor's;
      // only a floor too crowded for that puts one in the open or nearer.
      [clear, hidden] = [3, false];
      const open = rng.shuffle(floorTiles(f).filter((i) => free(i) && ad[i] >= 0));
      const rank = (i) => (dist[i] >= TUNE.clear && !sees[i] ? 0 : dist[i] >= TUNE.clear ? 100 : 200) + Math.max(2, ad[i]);
      const near = open.sort((a, b) => rank(a) - rank(b));
      for (const kind of mine) {
        const i = near.shift();
        if (i === undefined) break;
        taken.add(i);
        f.enemies.push({ id: id++, kind, x: i % W, y: (i / W) | 0, hp: KINDS[kind].hp, state: 'move', targets: [], pack: p, awake: false });
      }
    });
    return f;
  }

  /* ---------- the run ---------- */
  function refreshView(run) {
    const f = run.floor;
    run.view = lineOfSight(f, run.player.x, run.player.y, RADIUS);
    for (let i = 0; i < run.view.length; i++) if (run.view[i]) f.seen[i] = 1;
  }
  function descend(run) {
    run.depth++;
    run.floor = makeFloor(run.seed, run.depth);
    // Gear you can no longer use turns into the other kind, or is not there.
    const full = { blade: run.blade >= MAX_BLADE, armor: run.armor >= MAX_ARMOR };
    run.floor.gear = run.floor.gear.filter((g) => {
      if (full[g.kind]) g.kind = g.kind === 'blade' ? 'armor' : 'blade';
      return !full[g.kind];
    });
    run.player = { x: run.floor.start[0], y: run.floor.start[1] };
    refreshView(run);
  }
  function newRun(seed, mode) {
    const run = { seed: seed >>> 0, mode: mode || 'random', depth: 0, hp: MAX_HP, maxHp: MAX_HP, flasks: 1, blade: 0, armor: 0, turn: 0, kills: 0, over: false, floor: null, player: null, view: null };
    descend(run);
    return run;
  }

  const enemyAt = (f, x, y) => f.enemies.find((e) => e.x === x && e.y === y) || null;
  const sameTile = (a, b) => a[0] === b[0] && a[1] === b[1];

  /* The squares an enemy would strike from where it stands, or null. */
  function strikeTargets(f, e, p) {
    const K = KINDS[e.kind];
    if (K.sweep) {
      if (Math.max(Math.abs(p.x - e.x), Math.abs(p.y - e.y)) !== 1) return null;
      return DIRS.map(([dx, dy]) => [e.x + dx, e.y + dy]).filter(([x, y]) => passable(f, x, y));
    }
    for (const [dx, dy] of DIRS) {
      const line = [];
      let hit = false;
      for (let k = 1; k <= K.reach; k++) {
        const x = e.x + dx * k, y = e.y + dy * k;
        if (!passable(f, x, y)) break;
        line.push([x, y]);
        if (x === p.x && y === p.y) hit = true;
      }
      if (hit) return line;
    }
    return null;
  }

  /* Enemies take their turn. Marked ones strike, rested ones wake, awake
   * ones mark if they can and step closer if they cannot. A pack sleeps until
   * you can see one of its members; then all of it is up, and stays up, and
   * it comes on together. */
  function enemiesAct(run, ev) {
    const f = run.floor, p = run.player;
    const dist = distanceMap(f, p.x, p.y);
    const roused = new Set();
    for (const e of f.enemies) if (!e.awake && run.view[idx(f, e.x, e.y)]) roused.add(e.pack);
    if (roused.size) for (const e of f.enemies) if (roused.has(e.pack)) e.awake = true;
    const woke = new Set();
    // A pack keeps together: while a hulk of theirs lives, the others step only on the turns a hulk can,
    // so they arrive with it and not ahead of it. Marking and striking are never slowed.
    const heavy = new Set();
    if (TUNE.unit) for (const e of f.enemies) if (KINDS[e.kind].slow) heavy.add(e.pack);
    for (const e of f.enemies) {
      if (e.state === 'mark') {
        // Each strike names the squares it fell on, so the board can show it.
        const fell = e.targets.map((t) => t.slice());
        if (e.targets.some((t) => t[0] === p.x && t[1] === p.y)) {
          run.hp -= KINDS[e.kind].dmg;
          ev.push({ t: 'struck', kind: e.kind, dmg: KINDS[e.kind].dmg, hp: Math.max(0, run.hp), targets: fell });
        } else ev.push({ t: 'whiff', kind: e.kind, targets: fell });
        e.state = 'rest'; e.targets = [];
      } else if (e.state === 'rest') {
        e.state = 'move'; woke.add(e);
      }
    }
    for (const e of f.enemies) {
      if (e.state !== 'move' || woke.has(e)) continue;
      const d = dist[idx(f, e.x, e.y)];
      if (d < 0 || !e.awake) continue; // its pack has not seen you yet
      let targets = strikeTargets(f, e, p);
      if (!targets && !((KINDS[e.kind].slow || heavy.has(e.pack)) && run.turn % 2)) {
        let best = null, bestD = d;
        for (const [dx, dy] of DIRS) {
          const x = e.x + dx, y = e.y + dy;
          if (!passable(f, x, y) || (x === p.x && y === p.y) || enemyAt(f, x, y)) continue;
          const nd = dist[idx(f, x, y)];
          if (nd >= 0 && nd < bestD) { bestD = nd; best = [x, y]; }
        }
        if (best) { e.x = best[0]; e.y = best[1]; targets = strikeTargets(f, e, p); }
      }
      if (targets) { e.state = 'mark'; e.targets = targets; ev.push({ t: 'mark', kind: e.kind }); }
    }
  }

  /* One player action: {type:'move',dx,dy} | {type:'wait'} | {type:'flask'}.
   * Returns the events of the turn. Moving into a wall takes no turn. */
  function act(run, action) {
    const ev = [];
    if (run.over) return ev;
    const f = run.floor, p = run.player;
    if (action.type === 'flask') {
      if (run.flasks < 1 || run.hp >= run.maxHp) return ev;
      run.flasks--; run.hp = Math.min(run.maxHp, run.hp + 3);
      ev.push({ t: 'drink', hp: run.hp });
      return ev; // drinking is free
    }
    if (action.type === 'move') {
      const nx = p.x + Math.sign(action.dx), ny = p.y + Math.sign(action.dy);
      const e = enemyAt(f, nx, ny);
      if (e) {
        e.hp -= 1 + run.blade;
        ev.push({ t: 'hit', kind: e.kind, x: nx, y: ny, hp: Math.max(0, e.hp) });
        if (e.hp <= 0) { f.enemies.splice(f.enemies.indexOf(e), 1); run.kills++; ev.push({ t: 'kill', kind: e.kind, x: nx, y: ny }); }
      } else if (passable(f, nx, ny)) {
        p.x = nx; p.y = ny;
        ev.push({ t: 'step', x: nx, y: ny });
        const fi = f.flasks.findIndex((t) => sameTile(t, [nx, ny]));
        // Two flasks are all you can carry; a third stays where it lies.
        if (fi >= 0 && run.flasks >= MAX_FLASKS) ev.push({ t: 'full' });
        else if (fi >= 0) { f.flasks.splice(fi, 1); run.flasks++; ev.push({ t: 'pickup', flasks: run.flasks }); }
        const gi = f.gear.findIndex((g) => g.x === nx && g.y === ny);
        if (gi >= 0) {
          const kind = f.gear.splice(gi, 1)[0].kind;
          if (kind === 'blade') run.blade++;
          else { run.armor++; run.maxHp++; run.hp++; }
          ev.push({ t: 'gear', kind, level: run[kind], dmg: 1 + run.blade, hp: run.hp, maxHp: run.maxHp });
        }
        if (f.tiles[idx(f, nx, ny)] === STAIRS) {
          run.turn++;
          descend(run);
          ev.push({ t: 'descend', depth: run.depth });
          return ev;
        }
      } else {
        ev.push({ t: 'blocked' });
        return ev;
      }
    } else if (action.type === 'wait') ev.push({ t: 'wait' });
    else return ev;
    run.turn++;
    refreshView(run); // what you see from where you now stand is what wakes
    enemiesAct(run, ev);
    if (run.hp <= 0) { run.hp = 0; run.over = true; ev.push({ t: 'died', depth: run.depth }); }
    return ev;
  }

  /* Which squares are marked for a strike, for drawing. */
  function marks(run) {
    const out = [];
    for (const e of run.floor.enemies) if (e.state === 'mark') for (const t of e.targets) out.push(t);
    return out;
  }
  /* The same squares once each, with what standing there would cost: [x, y, damage]. */
  function danger(run) {
    const sum = new Map();
    for (const e of run.floor.enemies) if (e.state === 'mark') for (const [x, y] of e.targets) sum.set(x + ',' + y, [x, y, (sum.has(x + ',' + y) ? sum.get(x + ',' + y)[2] : 0) + KINDS[e.kind].dmg]);
    return [...sum.values()];
  }

  /* ---------- saving ---------- */
  const TILE_CH = ['#', '.', '>'];
  function serialize(run) {
    const f = run.floor;
    return {
      v: 1, seed: run.seed, mode: run.mode, depth: run.depth, hp: run.hp, maxHp: run.maxHp, flasks: run.flasks, blade: run.blade, armor: run.armor, turn: run.turn, kills: run.kills, over: run.over,
      player: { x: run.player.x, y: run.player.y },
      floor: {
        w: f.w, h: f.h,
        tiles: Array.from(f.tiles, (t) => TILE_CH[t]).join(''),
        seen: Array.from(f.seen, (s) => (s ? '1' : '0')).join(''),
        start: f.start, stairs: f.stairs, flasks: f.flasks, gear: f.gear.map((g) => ({ x: g.x, y: g.y, kind: g.kind })),
        enemies: f.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, hp: e.hp, state: e.state, targets: e.targets, pack: e.pack, awake: e.awake })),
      },
    };
  }
  /* A run saved before the carry limits may hold more than they allow (a blade of two, five armor,
   * any number of flasks). It loads with what it has and finds no more. */
  const OLD_BLADE = 2, OLD_ARMOR = 5;
  function deserialize(o) {
    const num = (v, lo, hi) => { if (typeof v !== 'number' || !(v >= lo && v <= hi)) throw new Error('bad save'); return v; };
    if (!o || o.v !== 1 || !o.floor || !o.player) throw new Error('bad save');
    const w = num(o.floor.w, 4, 200), h = num(o.floor.h, 4, 200);
    if (typeof o.floor.tiles !== 'string' || o.floor.tiles.length !== w * h || typeof o.floor.seen !== 'string' || o.floor.seen.length !== w * h) throw new Error('bad save');
    const f = { w, h, depth: num(o.depth, 1, 1e6), tiles: new Uint8Array(w * h), seen: new Uint8Array(w * h), rooms: [], start: o.floor.start, stairs: o.floor.stairs, enemies: [], flasks: [], gear: [] };
    for (let i = 0; i < w * h; i++) {
      const t = TILE_CH.indexOf(o.floor.tiles[i]);
      if (t < 0) throw new Error('bad save');
      f.tiles[i] = t; f.seen[i] = o.floor.seen[i] === '1' ? 1 : 0;
    }
    for (const t of Array.isArray(o.floor.flasks) ? o.floor.flasks : []) f.flasks.push([num(t[0], 0, w - 1), num(t[1], 0, h - 1)]);
    // A save from before gear has none, and carries none.
    for (const g of Array.isArray(o.floor.gear) ? o.floor.gear : []) {
      if (g.kind !== 'blade' && g.kind !== 'armor') throw new Error('bad save');
      f.gear.push({ x: num(g.x, 0, w - 1), y: num(g.y, 0, h - 1), kind: g.kind });
    }
    // A save from before packs has none: each of its enemies is a pack of one, asleep until seen.
    for (const [k, e] of (Array.isArray(o.floor.enemies) ? o.floor.enemies : []).entries()) {
      if (!KINDS[e.kind]) throw new Error('bad save');
      f.enemies.push({ id: e.id | 0, kind: e.kind, x: num(e.x, 0, w - 1), y: num(e.y, 0, h - 1), hp: num(e.hp, 1, 99), state: ['move', 'mark', 'rest'].includes(e.state) ? e.state : 'move', targets: Array.isArray(e.targets) ? e.targets.map((t) => [num(t[0], 0, w - 1), num(t[1], 0, h - 1)]) : [], pack: Number.isInteger(e.pack) ? e.pack : 1000 + k, awake: e.awake === true });
    }
    const run = { seed: num(o.seed, 0, 4294967295), mode: o.mode === 'daily' ? 'daily' : 'random', depth: f.depth, hp: num(o.hp, 0, 99), maxHp: num(o.maxHp, 1, 99), flasks: num(o.flasks, 0, 99), blade: num(o.blade || 0, 0, OLD_BLADE), armor: num(o.armor || 0, 0, OLD_ARMOR), turn: num(o.turn, 0, 1e9), kills: num(o.kills || 0, 0, 1e9), over: !!o.over, floor: f, player: { x: num(o.player.x, 0, w - 1), y: num(o.player.y, 0, h - 1) }, view: null };
    refreshView(run);
    return run;
  }

  const api = { W, H, RADIUS, WALL, FLOOR, STAIRS, DIRS, KINDS, MAX_HP, MAX_BLADE, MAX_ARMOR, MAX_FLASKS, TUNE, mulberry32, hashString, dailySeed, randomSeed, lineOfSight, distanceMap, makeFloor, packSizes, kindsFor, newRun, act, marks, danger, strikeTargets, serialize, deserialize, idx, passable, enemyAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Delve = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
