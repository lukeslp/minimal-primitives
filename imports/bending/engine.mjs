import {levels, WELL} from './levels.mjs?v=31b88eb6';

export const DT = 1 / 120;
export const BALL_R = 6;
// A slower launch makes the field legible across the well: a chosen chord is
// now a proposal, not the result.  The fixed 120 Hz integrator remains the
// authority for both preview and flight.
export const SPEED = 125;
export const STAR = { x: WELL.centre, y: WELL.centre, r: WELL.hole, mass: 40000, softening: 35 };
const TAU = Math.PI * 2;
const RESTITUTION = 0.82;
// Exported with `influence` so the board draws the same field it integrates.
export const G = 1600;
// A very light medium prevents rim-skimming probes from orbiting forever;
// deliberate slingshots still have several seconds of clean travel.
const VELOCITY_DECAY = 0.6;
const CAPTURE_TIME = 1;
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const angle = value => {
  const a = value % TAU;
  return a < 0 ? a + TAU : a;
};
const angleDelta = (next, previous) => {
  let delta = angle(next) - angle(previous);
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
};
const polar = (radius, a) => ({ x: WELL.centre + Math.cos(a) * radius, y: WELL.centre + Math.sin(a) * radius });
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export function sweptCircle(x, y, vx, vy, cx, cy, radius, maxTime) {
  const dx = x - cx;
  const dy = y - cy;
  const a = vx * vx + vy * vy;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy - radius * radius;
  if (a < 1e-12) return null;
  if (c < 0 && b < 0) return 0;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= -1e-8 && t <= maxTime + 1e-8 ? Math.max(0, t) : null;
}

function sweptBoundary(ball, radius, maxTime) {
  const dx = ball.x - WELL.centre;
  const dy = ball.y - WELL.centre;
  const a = ball.vx * ball.vx + ball.vy * ball.vy;
  const b = 2 * (dx * ball.vx + dy * ball.vy);
  const c = dx * dx + dy * dy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a < 1e-12 || discriminant < 0) return null;
  const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]
    .filter(t => t >= -1e-8 && t <= maxTime + 1e-8)
    .sort((aTime, bTime) => aTime - bTime);
  return roots.length ? Math.max(0, roots[0]) : null;
}

// Moons are light wells rather than inert pebbles. Their small radius and mass
// make them a loose screen; only the authored planets carry the deep fields.
const planet = peg => peg.mass > 0;
export const influence = peg => peg.influence ?? peg.r * (4.5 + Math.min(1.5, peg.mass / 600));
const orbitPosition = (orbit, phase) => polar(orbit.radius, phase);

export function createEngine(index = 0, options = {}) {
  if (!levels[index]) throw new Error('Unknown Rimlight stage');
  const level = levels[index];
  const star = level.star === false ? null : { ...STAR, ...level.star };
  const planetGravity = options.planetGravity !== false;
  let events = [];
  let history = [];
  let state = freshState();
  let trajectoryKey = '';
  let trajectoryPoints = [];
  // Diagnostic-only shot trace used by the authored-board acceptance suite.
  // It is intentionally closure state, never persisted in a player save.
  let firstContact = null;

  function makePeg(source, id) {
    const peg = { ...source, id, hit: false };
    if (source.orbit) {
      peg.phase = source.orbit.phase;
      Object.assign(peg, orbitPosition(source.orbit, peg.phase));
    }
    return peg;
  }

  function freshState() {
    return {
      version: 2,
      index,
      position: -Math.PI / 2,
      aim: Math.PI / 2,
      balls: level.balls,
      shot: 0,
      time: 0,
      shotTime: 0,
      stillTime: 0,
      score: 0,
      shotBase: 0,
      shotRings: 0,
      shotAssists: 0,
      shotOrbits: 0,
      totalOrbits: 0,
      captures: 0,
      lastShot: null,
      won: false,
      failed: false,
      message: level.hint,
      ball: null,
      pegs: level.pegs.map(makePeg),
      flashes: [],
      fragments: [],
      assists: [],
      trail: []
    };
  }

  const raw = () => {
    const saved = clone(state);
    saved.flashes = [];
    saved.assists = [];
    saved.trail = [];
    saved.ball = null;
    saved.shotTime = 0;
    saved.stillTime = 0;
    saved.shotBase = 0;
    saved.shotRings = 0;
    saved.shotAssists = 0;
    saved.shotOrbits = 0;
    return saved;
  };
  const emit = (type, x, y, noteHz) => {
    events.push({ type, x, y, noteHz });
    if (events.length > 128) events.shift();
  };
  const targetLeft = () => state.pegs.filter(peg => peg.target && !peg.hit).length;
  const shotTotal = () => state.shotBase * (1 + state.shotAssists);

  function resolveShot({ bonus = 0, reason = '' } = {}) {
    const total = shotTotal();
    if (total || bonus) {
      state.score += total + bonus;
      state.lastShot = { total: total + bonus, assists: state.shotAssists, orbits: state.shotOrbits, rings: state.shotRings, bonus };
    } else {
      state.lastShot = null;
    }
    state.shotBase = 0;
    state.shotRings = 0;
    state.shotAssists = 0;
    state.shotOrbits = 0;
    state.ball = null;
    state.trail = [];
    state.shotTime = 0;
    state.stillTime = 0;
    state.failed = !state.won && state.balls === 0;
    state.message = state.won
      ? `Stage clear · +${total + bonus}.`
      : state.failed
        ? 'No probes left. Undo a shot or reset this stage.'
        : reason || 'Choose the next fall.';
    if (state.failed) emit('fail');
  }

  function breakRing(peg) {
    if (peg.hit) return;
    peg.hit = true;
    const value = 100 * 2 ** state.shotRings;
    state.shotRings++;
    state.shotBase += value;
    state.fragments.push({ x: peg.x, y: peg.y, r: peg.r + 5, tilt: peg.tilt ?? 0, age: 0 });
    state.flashes.push({ x: peg.x, y: peg.y, age: 0 });
    const pentatonic = [0, 2, 4, 7, 9];
    emit('hit', peg.x, peg.y, 261.6256 * 2 ** ((pentatonic[(state.shotRings - 1) % 5] + 12 * Math.floor((state.shotRings - 1) / 5)) / 12));
    if (!targetLeft()) {
      state.won = true;
      // One probe per stage is a spare, for forgiveness; it earns no clear
      // bonus, so scores and saved bests stay comparable with earlier play.
      const bonus = Math.max(0, state.balls - 1) * 500;
      emit('win', peg.x, peg.y);
      resolveShot({ bonus });
    }
  }

  function addOrbit(peg) {
    state.shotOrbits++;
    state.totalOrbits++;
    state.shotBase += 250;
    emit('orbit', peg.x, peg.y);
  }

  function beginCapture(peg, track) {
    const ball = state.ball;
    if (!ball || ball.capture) return;
    state.captures++;
    state.shotBase += 500;
    ball.capture = {
      id: peg.id,
      age: 0,
      radius: Math.max(peg.r + BALL_R + 2, Math.hypot(ball.x - peg.x, ball.y - peg.y)),
      angle: Math.atan2(ball.y - peg.y, ball.x - peg.x),
      direction: Math.sign(track.swept) || 1
    };
    emit('capture', peg.x, peg.y);
    state.message = 'The probe is captured.';
  }

  function advanceCapture(dt) {
    const ball = state.ball;
    if (!ball?.capture) return false;
    const capture = ball.capture;
    const peg = state.pegs[capture.id];
    if (!peg) return false;
    capture.age += dt;
    const t = clamp(capture.age / CAPTURE_TIME, 0, 1);
    const radius = capture.radius * (1 - t) + (peg.r * 0.32) * t;
    const a = capture.angle + capture.direction * TAU * 1.2 * t;
    ball.px = ball.x;
    ball.py = ball.y;
    ball.x = peg.x + Math.cos(a) * radius;
    ball.y = peg.y + Math.sin(a) * radius;
    ball.vx = 0;
    ball.vy = 0;
    if (t >= 1) {
      resolveShot({ reason: 'The probe was captured.' });
      return true;
    }
    return false;
  }

  function markContact(peg) {
    firstContact ??= peg.id;
    const track = state.ball?.fields?.[peg.id];
    if (track) track.touched = true;
  }

  function updateFields() {
    const ball = state.ball;
    if (!ball || ball.capture || !planetGravity) return;
    ball.fields ||= {};
    for (const peg of state.pegs) {
      if (!planet(peg)) continue;
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const distance = Math.hypot(dx, dy);
      const radius = influence(peg);
      let track = ball.fields[peg.id];
      if (distance < radius) {
        const currentAngle = Math.atan2(dy, dx);
        if (!track || !track.inside) {
          track = ball.fields[peg.id] = {
            inside: true,
            touched: false,
            assisted: track?.assisted || false,
            heading: Math.atan2(ball.vy, ball.vx),
            angle: currentAngle,
            swept: 0,
            completed: 0
          };
        } else {
          track.swept += angleDelta(currentAngle, track.angle);
          track.angle = currentAngle;
          while (Math.abs(track.swept) >= (track.completed + 1) * TAU) {
            track.completed++;
            addOrbit(peg);
            if (track.completed === 3) {
              beginCapture(peg, track);
              return;
            }
          }
        }
      } else if (track?.inside) {
        track.inside = false;
        const turn = Math.abs(angleDelta(Math.atan2(ball.vy, ball.vx), track.heading));
        if (!track.touched && !track.assisted && turn >= Math.PI / 4) {
          track.assisted = true;
          state.shotAssists++;
          state.assists.push({ x: peg.x + dx * radius / Math.max(distance, 1), y: peg.y + dy * radius / Math.max(distance, 1), age: 0 });
          emit('assist', peg.x, peg.y);
        }
      }
    }
  }

  function applyGravity(ball, dt) {
    const pull = (body, radius = Infinity) => {
      const dx = body.x - ball.x;
      const dy = body.y - ball.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance >= radius) return;
      const epsilon = body.softening ?? body.r;
      let fade = 1;
      if (Number.isFinite(radius) && distance > radius * 2 / 3) fade = 1 - smoothstep((distance - radius * 2 / 3) / (radius / 3));
      const acceleration = G * body.mass / (distance * distance + epsilon * epsilon) * fade;
      ball.vx += dx / distance * acceleration * dt;
      ball.vy += dy / distance * acceleration * dt;
    };
    if (star) pull(star);
    if (planetGravity) for (const peg of state.pegs) if (planet(peg)) pull(peg, influence(peg));
    const retained = Math.exp(-(level.decay ?? VELOCITY_DECAY) * dt);
    ball.vx *= retained;
    ball.vy *= retained;
  }

  function moveOrbiters(dt) {
    for (const peg of state.pegs) {
      if (!peg.orbit) continue;
      peg.phase = angle(peg.phase + peg.orbit.speed * dt);
      Object.assign(peg, orbitPosition(peg.orbit, peg.phase));
    }
  }

  // Returns true when a trace needs to stop at the first contact.
  function moveBall(dt, register = true, stopAtFirst = false) {
    const ball = state.ball;
    if (!ball) return false;
    const innerRadius = WELL.hole + BALL_R;
    const outerRadius = WELL.rim - BALL_R;
    applyGravity(ball, dt);
    let left = dt;
    let iterations = 0;
    while (left > 1e-7 && iterations++ < 12) {
      let earliest = left + 1;
      let contacts = [];
      const consider = (time, contact) => {
        if (time === null || time < 0 || time > left) return;
        if (time < earliest - 1e-7) { earliest = time; contacts = [contact]; }
        else if (Math.abs(time -earliest) < 1e-7) contacts.push(contact);
      };
      if (star) consider(sweptBoundary(ball, innerRadius, left), { hole: true });
      consider(sweptBoundary(ball, outerRadius, left), { rim: true });
      for (const peg of state.pegs) consider(sweptCircle(ball.x, ball.y, ball.vx, ball.vy, peg.x, peg.y, peg.r + BALL_R, left), { peg });
      if (!contacts.length) {
        ball.x += ball.vx * left;
        ball.y += ball.vy * left;
        break;
      }
      ball.x += ball.vx * earliest;
      ball.y += ball.vy * earliest;
      left -= earliest;
      contacts.sort((first, second) => (first.peg?.id ?? -2) - (second.peg?.id ?? -2));
      if (contacts.some(contact => contact.hole)) {
        if (register) resolveShot({ reason: 'The probe fell into the star.' });
        return true;
      }
      if (stopAtFirst) return true;
      for (let pass = 0; pass < 3; pass++) {
        for (const contact of contacts) {
          let nx = 0;
          let ny = 0;
          if (contact.rim) {
            const d = Math.hypot(ball.x - WELL.centre, ball.y - WELL.centre) || 1;
            nx = (WELL.centre - ball.x) / d;
            ny = (WELL.centre - ball.y) / d;
          } else if (contact.peg) {
            const peg = contact.peg;
            const d = Math.hypot(ball.x - peg.x, ball.y - peg.y) || 1;
            nx = (ball.x - peg.x) / d;
            ny = (ball.y - peg.y) / d;
            if (register && pass === 0) {
              markContact(peg);
              if (peg.target) breakRing(peg);
              if (state.won) return true;
            }
            const overlap = peg.r + BALL_R - d;
            if (overlap > 0) { ball.x += nx * (overlap + 1e-5); ball.y += ny * (overlap + 1e-5); }
          }
          const dot = ball.vx * nx + ball.vy * ny;
          if (dot < 0) { ball.vx -= (1 + RESTITUTION) * dot * nx; ball.vy -= (1 + RESTITUTION) * dot * ny; }
          ball.x += nx * 1e-5;
          ball.y += ny * 1e-5;
        }
      }
      if (earliest < 1e-8) left = Math.max(0, left - 1e-7);
    }
    if (register) updateFields();
    return false;
  }

  function validate(saved) {
    if (!saved || saved.version !== 2 || saved.index !== index || !Number.isInteger(saved.balls) || saved.balls < 0 || saved.balls > level.balls ||
      !Number.isInteger(saved.shot) || saved.shot < 0 || saved.shot > 500 || !finite(saved.position) || !finite(saved.aim) ||
      !finite(saved.time) || saved.time < 0 || !finite(saved.score) || saved.score < 0 || !Number.isInteger(saved.totalOrbits) || saved.totalOrbits < 0 ||
      !Number.isInteger(saved.captures) || saved.captures < 0 || typeof saved.won !== 'boolean' || typeof saved.failed !== 'boolean' || saved.ball !== null ||
      !Array.isArray(saved.pegs) || saved.pegs.length !== level.pegs.length || !Array.isArray(saved.fragments)) throw new Error('Invalid Rimlight save');
    const ids = new Set();
    for (const peg of saved.pegs) {
      const source = level.pegs[peg.id];
      if (!source || ids.has(peg.id) || peg.r !== source.r || peg.target !== source.target || peg.kind !== source.kind || peg.mass !== source.mass || typeof peg.hit !== 'boolean') throw new Error('Invalid Rimlight body');
      if (source.orbit) {
        if (!finite(peg.phase)) throw new Error('Invalid Rimlight orbit');
        const expected = orbitPosition(source.orbit, peg.phase);
        if (Math.abs(peg.x - expected.x) > 1e-6 || Math.abs(peg.y - expected.y) > 1e-6) throw new Error('Invalid Rimlight orbit');
      } else if (peg.x !== source.x || peg.y !== source.y) throw new Error('Invalid Rimlight body');
      ids.add(peg.id);
    }
  }

  function action(id, value = true) {
    if (id === 'position' && !state.ball && !state.won && finite(Number(value))) { state.position = angle(Number(value)); return; }
    if (id === 'aim' && !state.ball && !state.won && finite(Number(value))) { state.aim = angle(Number(value)); return; }
    if (id === 'undo' && value !== false) {
      const previous = history.pop();
      if (previous) { state = clone(previous); state.message = 'Shot undone. Choose another fall.'; events = []; }
      return;
    }
    if (id !== 'fire' || value === false || state.ball || state.won || state.failed || !state.balls) return;
    history.push(raw());
    if (history.length > 128) history.shift();
    state.balls--;
    state.shot++;
    state.shotTime = 0;
    state.stillTime = 0;
    state.shotBase = 0;
    state.shotRings = 0;
    state.shotAssists = 0;
    state.shotOrbits = 0;
    state.lastShot = null;
    firstContact = null;
    const start = polar(WELL.rim - BALL_R - 2, state.position);
    state.ball = { x: start.x, y: start.y, px: start.x, py: start.y, vx: Math.cos(state.aim) * SPEED, vy: Math.sin(state.aim) * SPEED, fields: {} };
    state.message = '';
    emit('launch', state.ball.x, state.ball.y);
  }

  function step(dt = DT, input = {}) {
    if (!finite(dt) || dt <= 0 || state.won) return;
    state.time += dt;
    state.flashes = state.flashes.filter(flash => (flash.age += dt) < 0.7);
    state.fragments = state.fragments.filter(fragment => (fragment.age += dt) < 1.15);
    state.assists = state.assists.filter(assist => (assist.age += dt) < 0.75);
    if (!state.ball) {
      if (input.turn) state.position = angle(state.position + clamp(input.turn, -1, 1) * dt * 1.7);
      return;
    }
    moveOrbiters(dt);
    const ball = state.ball;
    ball.px = ball.x;
    ball.py = ball.y;
    state.shotTime += dt;
    if (!ball.capture) moveBall(dt);
    else advanceCapture(dt);
    if (!state.ball) return;
    state.trail.push({ x: state.ball.x, y: state.ball.y });
    if (state.trail.length > 26) state.trail.shift();
    state.stillTime = Math.hypot(state.ball.vx, state.ball.vy) < 15 ? state.stillTime + dt : 0;
    if (state.stillTime >= 2 || state.shotTime >= 30) resolveShot({ reason: 'The probe settled. Its rings still count.' });
  }

  function trajectory() {
    if (state.ball || state.won) return [];
    const key = `${state.position}:${state.aim}:${state.pegs.map(peg => `${peg.x}:${peg.y}:${peg.hit ? 1 : 0}`).join(',')}`;
    if (key === trajectoryKey) return trajectoryPoints;
    const remembered = state;
    const rememberedEvents = events;
    state = clone(state);
    events = [];
    const start = polar(WELL.rim - BALL_R - 2, state.position);
    state.ball = { x: start.x, y: start.y, px: start.x, py: start.y, vx: Math.cos(state.aim) * SPEED, vy: Math.sin(state.aim) * SPEED, fields: {} };
    const points = [{ x: state.ball.x, y: state.ball.y }];
    // A bend cue rather than a full prediction: it reaches about 40% of the
    // well so the first pull is readable, and it never includes the sampled
    // contact point: a guide must never show an outcome.
    const guideLength = 240;
    let length = 0;
    for (let tick = 0; tick < 900 && length < guideLength; tick++) {
      const before = { x: state.ball.x, y: state.ball.y };
      const contact = moveBall(DT, false, true);
      length += Math.hypot(state.ball.x - before.x, state.ball.y - before.y);
      if (contact) break;
      if (tick % 2 === 0 || length >= guideLength) points.push({ x: state.ball.x, y: state.ball.y });
    }
    state = remembered;
    events = rememberedEvents;
    trajectoryKey = key;
    trajectoryPoints = points;
    return trajectoryPoints;
  }

  return {
    get state() { return state; },
    level,
    star,
    action,
    step,
    trajectory,
    firstContact: () => firstContact,
    drainEvents() { return events.splice(0); },
    snapshot() { return { version: 2, index, state: state.ball ? clone(history.at(-1)) : raw(), history: clone(history) }; },
    restore(data) {
      if (!data || data.version !== 2 || data.index !== index || !Array.isArray(data.history) || data.history.length > 128) throw new Error('Invalid Rimlight save');
      validate(data.state);
      data.history.forEach(validate);
      state = clone(data.state);
      state.flashes = [];
      state.assists = [];
      state.trail = [];
      history = clone(data.history);
      events = [];
    },
    debugSnapshot() { return raw(); }
  };
}
