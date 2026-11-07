// The dark well. Probes enter at fixed points on the rim; the planets that bend
// them are yours to place on a lattice of dots. Every stage's lattice reaches as
// far across the well as any other: early ones are a few dots spread wide, and
// the spacing closes up as the stages go on. A board is solved when every
// probe leaves through its own light. Pure rules: no DOM, usable from Node.
export const WELL = { size: 600, centre: 300, rim: 270 };
export const DT = 1 / 120;
export const SPEED = 125;
export const G = 1600;
export const PROBE_R = 4;
// One kind of planet. Its pull stops dead at `reach`, so a probe that leaves
// along its straight line has told you no planet sits within reach of that line.
export const PLANET = { r: 16, mass: 250, reach: 120 };
// How far from the centre a planet may sit, and how many dots out the finest
// lattice goes. A board's `size` is its own count; its dots stand SPAN / size apart.
export const SPAN = WELL.rim - 45;
export const FULL = 5;
export const spacing = (size = FULL) => SPAN / size;
// How close an exit must be to its light, and how long a probe may wander.
export const LIGHT = 2 * Math.PI / 180;
export const LIMIT = 12;
const TAU = Math.PI * 2;
const C = WELL.centre;
const SAMPLE = 4;

export const rad = degrees => degrees * Math.PI / 180;
export const turn = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const onRim = (angle, radius = WELL.rim) => ({ x: C + Math.cos(angle) * radius, y: C + Math.sin(angle) * radius });
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

// Every place a planet can sit on a lattice of this size, row by row from the top.
const made = new Map();
export function lattice(size = FULL) {
  if (!made.has(size)) {
    const list = [];
    const step = spacing(size);
    for (let row = -size; row <= size; row++) {
      for (let col = -size; col <= size; col++) {
        if (col * col + row * row <= size * size + 0.25) list.push({ x: C + col * step, y: C + row * step, col, row });
      }
    }
    made.set(size, list);
  }
  return made.get(size);
}
export const spots = board => lattice(board.size ?? FULL);
export const dotAt = (col, row, size = FULL) => lattice(size).findIndex(dot => dot.col === col && dot.row === row);
export const open = board => spots(board).map((_, index) => index);

// The nearest dot of a lattice to a point, skipping any index in `taken`; -1
// when the point is outside the well.
export function nearestDot(x, y, taken = [], size = FULL) {
  if (Math.hypot(x - C, y - C) > WELL.rim) return -1;
  let best = -1;
  let distance = Infinity;
  lattice(size).forEach((dot, index) => {
    if (taken.includes(index)) return;
    const d = Math.hypot(dot.x - x, dot.y - y);
    if (d < distance) { distance = d; best = index; }
  });
  return best;
}

// One probe through a set of planets ({x, y} each, anywhere inside the rim).
// Returns the sampled path, and either the rim angle it left by and the way it
// was heading as it left, or why it did not leave.
export function trace(probe, planets = []) {
  const start = onRim(rad(probe.at));
  let { x, y } = start;
  let vx = Math.cos(rad(probe.aim)) * SPEED;
  let vy = Math.sin(rad(probe.aim)) * SPEED;
  let nearest = Infinity;
  let touched = 0;
  const points = [[x, y]];
  const pull = () => {
    let ax = 0;
    let ay = 0;
    for (let index = 0; index < planets.length; index++) {
      const dx = planets[index].x - x;
      const dy = planets[index].y - y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < nearest) nearest = distance;
      if (distance >= PLANET.reach) continue;
      touched |= 1 << index;
      const fade = distance > PLANET.reach * 2 / 3 ? 1 - smoothstep((distance - PLANET.reach * 2 / 3) / (PLANET.reach / 3)) : 1;
      const acceleration = G * PLANET.mass / (distance * distance + PLANET.r * PLANET.r) * fade;
      ax += dx / distance * acceleration;
      ay += dy / distance * acceleration;
    }
    return [ax, ay];
  };
  let [ax, ay] = pull();
  const steps = Math.round(LIMIT / DT);
  for (let step = 1; step <= steps; step++) {
    vx += ax * DT / 2;
    vy += ay * DT / 2;
    const px = x;
    const py = y;
    x += vx * DT;
    y += vy * DT;
    [ax, ay] = pull();
    vx += ax * DT / 2;
    vy += ay * DT / 2;
    if (nearest < PLANET.r + PROBE_R) {
      points.push([x, y]);
      return { points, exit: null, heading: null, lost: 'planet', time: step * DT, nearest, touched };
    }
    const out = Math.hypot(x - C, y - C);
    if (out >= WELL.rim) {
      // Finish exactly on the rim so the mark sits where the path meets it.
      const before = Math.hypot(px - C, py - C);
      const part = out > before ? (WELL.rim - before) / (out - before) : 1;
      const ex = px + (x - px) * part;
      const ey = py + (y - py) * part;
      points.push([ex, ey]);
      return { points, exit: Math.atan2(ey - C, ex - C), heading: Math.atan2(vy, vx), lost: null, time: step * DT, nearest, touched };
    }
    if (step % SAMPLE === 0) points.push([x, y]);
  }
  points.push([x, y]);
  return { points, exit: null, heading: null, lost: 'time', time: LIMIT, nearest, touched };
}

const places = (board, indexes) => indexes.filter(index => index !== null && index >= 0).map(index => spots(board)[index]);

// The lights of a board: where each probe leaves when the planets sit on the
// answer. `leaving` is the way each one is heading as it does, or null for a
// probe the answer never bends. A probe turned by one planet alone leaves on the
// mirror image of the line it came in on, and the planet lies on the mirror.
const lightCache = new WeakMap();
const solution = board => {
  if (!lightCache.has(board)) {
    const paths = board.probes.map(probe => trace(probe, places(board, board.answer)));
    lightCache.set(board, { exits: paths.map(path => path.exit), headings: paths.map(path => path.touched ? path.heading : null) });
  }
  return lightCache.get(board);
};
export const lights = board => solution(board).exits;
export const leaving = board => solution(board).headings;

// The corner a bent probe's path rounds: where the line it enters on meets the
// line it leaves on. Null when the two do not meet inside the well.
export function corner(probe, exit, heading) {
  const from = onRim(rad(probe.at));
  const to = onRim(exit);
  const ux = Math.cos(rad(probe.aim));
  const uy = Math.sin(rad(probe.aim));
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const det = ux * hy - uy * hx;
  if (Math.abs(det) < 1e-6) return null;
  const along = ((to.x - from.x) * hy - (to.y - from.y) * hx) / det;
  const back = (ux * (to.y - from.y) - uy * (to.x - from.x)) / det;
  const point = { x: from.x + ux * along, y: from.y + uy * along };
  return along > 0 && back > 0 && Math.hypot(point.x - C, point.y - C) < WELL.rim ? point : null;
}

// Where every probe goes for these planets, and which lights it reaches.
// `planets` is a list of {x, y}; use `placed` to judge indexes into the board's lattice.
export function judge(board, planets) {
  const targets = lights(board);
  const traces = board.probes.map(probe => trace(probe, planets));
  const lit = traces.map((path, index) => path.exit !== null && Math.abs(turn(path.exit, targets[index])) <= LIGHT);
  return { traces, lit, count: lit.filter(Boolean).length, solved: lit.every(Boolean) };
}

export const placed = (board, indexes) => judge(board, places(board, indexes));
