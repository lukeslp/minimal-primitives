import {FULL, WELL, PLANET, corner, leaving, lights, onRim, rad, spacing, spots} from './well.mjs?v=0f8ac9d7';
import {CELL, star, twinkle} from './sky.mjs?v=0f8ac9d7';

const TAU = Math.PI * 2;
const C = WELL.centre;
// Planets not yet in the well wait in a row under it, from the left. The next
// arrow of a solved stage sits under the middle.
// The planets wait in a row centred under the well; `count` is how many the stage has.
export const trayPoint = (slot, count = 1) => ({ x: 300 + (slot - (count - 1) / 2) * 52, y: 634 });
export const NEXT = { x: 300, y: 634 };

// A planet makes a well in the sheet the dots and the stars are drawn on. Inside
// its reach everything is drawn in toward it, by DEPTH at the planet and by
// nothing at the edge of its reach, exactly where its pull on a probe stops. So
// the sky lies true wherever a probe flies straight. A fine weave of faint
// points, each lattice step cut into smaller ones, shows only where the sheet is
// bent and fades out where it flattens: it is how far a planet's pull reaches,
// and it is what moves when a wide lattice has no dot near enough to a planet.
export const DEPTH = 26;
const WEAVE = { step: 22.5, dot: 0.7, strength: 0.3 };
// Asked for with ?orb=hole, a planet is drawn as a black hole instead: no light
// of its own, a rim of light bent round it, and a tilted disc whose far side is
// lifted over the top. The sheet is then bent the way a lens bends light, pushed
// outward by RING squared over the distance, and RING sits on the rim so the ring
// a lens makes of the dot behind it is the rim itself.
const HOLE = { ring: PLANET.r + 1.5, inner: 1.3, outer: 2.2, tilt: 0.3, turn: -0.35, bands: 8 };
// A dot is a little larger where the lattice is wide, so a few dots still read as places.
const dotSize = step => 1.8 + (step - 45) * 0.012;
// A planet that has just landed does two things, both gone within this time: one
// ripple travels out through the dots to its reach, and a little dust falls in.
export const RIPPLE = 1100;
const DUST = 18;
// Afterwards the dust stays, and it is the quietest thing on the board: a faint
// band of specks turning slowly close round the planet, quicker the closer in.
// It keeps within the planet's glow, so it never crosses a path or a dot.
const DISC = { specks: 14, inner: PLANET.r + 1.5, outer: PLANET.r + 9.5, turn: 0.9, fall: 0.9, streak: 0.24, strength: 0.38 };
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function createView(canvas) {
  const g = canvas.getContext('2d');
  let geometry = { scale: 1, x: 0, y: 0 };
  let width = 1;
  let height = 1;
  let ratio = 1;
  // The lattice is painted pixel by pixel into its own layer, and only again
  // when a planet moves.
  const layer = document.createElement('canvas');
  const paint = layer.getContext('2d');
  const sample = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  let origin = { x: 0, y: 0 };
  let plain = null;
  let image = null;
  let plainKey = '';
  let layerKey = null;
  let strength = 255;
  // The stars that can show inside the well, by cell, for the layer to look up.
  const skyFrom = Math.floor((C - WELL.rim) / CELL) - 1;
  const skyCells = Math.floor((C + WELL.rim) / CELL) + 2 - skyFrom;
  const skyX = new Float32Array(skyCells * skyCells);
  const skyY = new Float32Array(skyCells * skyCells);
  const skyR = new Float32Array(skyCells * skyCells);
  const skyA = new Float32Array(skyCells * skyCells);
  // One list of specks per planet, {r, a}, moved on a little each frame.
  let discs = [];
  let discTime = 0;
  const tints = new Map();
  // A CSS colour as red, green, blue numbers, for gradients that fade it out.
  function tint(colour) {
    if (!tints.has(colour)) {
      sample.clearRect(0, 0, 1, 1);
      sample.fillStyle = colour;
      sample.fillRect(0, 0, 1, 1);
      tints.set(colour, [...sample.getImageData(0, 0, 1, 1).data].slice(0, 3).join(','));
    }
    return tints.get(colour);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const scale = Math.min(width / 600, height / 668);
    geometry = { scale, x: (width - 600 * scale) / 2, y: (height - 668 * scale) / 2 };
    plainKey = '';
  }
  function toBoard(x, y) {
    const rect = canvas.getBoundingClientRect();
    return { x: (x - rect.left - geometry.x) / geometry.scale, y: (y - rect.top - geometry.y) / geometry.scale };
  }

  // How much of a dot covers the point of the lattice that a pixel shows.
  function cover(x, y, soft, open, step, dot) {
    const col = Math.round((x - C) / step);
    const row = Math.round((y - C) / step);
    if (col * col + row * row > open) return 0;
    const amount = (dot - Math.hypot(x - C - col * step, y - C - row * step)) / soft + 0.5;
    return amount <= 0 ? 0 : amount >= 1 ? 1 : amount;
  }

  // `sky` is the stage's sky, or null when there are no stars. Within a planet's
  // reach the layer is opaque paper with the bent dots and stars on it, covering
  // the unbent stars of the page behind; elsewhere it holds the dots alone.
  function lattice(lenses, colour, size, sky, ink, paper, woven, lensed = false) {
    const pixel = geometry.scale * ratio;
    const reach = WELL.rim + 2;
    const open = size * size + 0.25;
    const step = spacing(size);
    const dot = dotSize(step);
    const weave = woven ? step / Math.max(1, Math.round(step / WEAVE.step)) : 0;
    const base = `${colour}|${ink}|${paper}|${pixel}|${geometry.x}|${geometry.y}|${size}|${sky}|${weave}|${lensed}`;
    if (base !== plainKey) {
      if (sky !== null) {
        for (let j = 0; j < skyCells; j++) {
          for (let i = 0; i < skyCells; i++) {
            const one = star(i + skyFrom, j + skyFrom, sky);
            const at = j * skyCells + i;
            skyX[at] = one ? one.x : 0;
            skyY[at] = one ? one.y : 0;
            skyR[at] = one ? one.r : 0;
            skyA[at] = one ? one.a : 0;
          }
        }
      }
      origin = { x: Math.floor((geometry.x + (C - reach) * geometry.scale) * ratio), y: Math.floor((geometry.y + (C - reach) * geometry.scale) * ratio) };
      const size = Math.ceil(2 * reach * pixel) + 2;
      layer.width = layer.height = size;
      sample.clearRect(0, 0, 1, 1);
      sample.fillStyle = colour;
      sample.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = sample.getImageData(0, 0, 1, 1).data;
      strength = alpha;
      plain = new Uint8ClampedArray(size * size * 4);
      for (let row = 0, at = 0; row < size; row++) {
        const y = ((origin.y + row + 0.5) / ratio - geometry.y) / geometry.scale;
        for (let col = 0; col < size; col++, at += 4) {
          const x = ((origin.x + col + 0.5) / ratio - geometry.x) / geometry.scale;
          plain[at] = red;
          plain[at + 1] = green;
          plain[at + 2] = blue;
          plain[at + 3] = cover(x, y, 1 / pixel, open, step, dot) * alpha;
        }
      }
      image = paint.createImageData(size, size);
      plainKey = base;
      layerKey = null;
    }
    const key = lenses.map(lens => `${lens.x.toFixed(2)},${lens.y.toFixed(2)},${lens.k.toFixed(3)},${lens.wave === null ? '' : lens.wave.toFixed(3)}`).join(';');
    if (key === layerKey) return;
    layerKey = key;
    const data = image.data;
    data.set(plain);
    if (lenses.length) {
      const size = layer.width;
      const [dotRed, dotGreen, dotBlue] = tint(colour).split(',').map(Number);
      const [inkRed, inkGreen, inkBlue] = tint(ink).split(',').map(Number);
      const [paperRed, paperGreen, paperBlue] = tint(paper).split(',').map(Number);
      const full = PLANET.reach * PLANET.reach;
      const hidden = (PLANET.r - 1) ** 2;
      const edge = (WELL.rim + 1) ** 2;
      const toCol = x => Math.round((geometry.x + x * geometry.scale) * ratio - origin.x);
      const toRow = y => Math.round((geometry.y + y * geometry.scale) * ratio - origin.y);
      const left = Math.max(0, Math.min(...lenses.map(lens => toCol(lens.x - PLANET.reach))) - 1);
      const right = Math.min(size, Math.max(...lenses.map(lens => toCol(lens.x + PLANET.reach))) + 1);
      const top = Math.max(0, Math.min(...lenses.map(lens => toRow(lens.y - PLANET.reach))) - 1);
      const bottom = Math.min(size, Math.max(...lenses.map(lens => toRow(lens.y + PLANET.reach))) + 1);
      for (let row = top; row < bottom; row++) {
        const y = ((origin.y + row + 0.5) / ratio - geometry.y) / geometry.scale;
        for (let col = left; col < right; col++) {
          const x = ((origin.x + col + 0.5) / ratio - geometry.x) / geometry.scale;
          if ((x - C) * (x - C) + (y - C) * (y - C) > edge) continue;
          let bendX = 0;
          let bendY = 0;
          let stretch = 1;
          let bent = 0;
          let seen = 1;
          for (let index = 0; index < lenses.length; index++) {
            const lens = lenses[index];
            const dx = x - lens.x;
            const dy = y - lens.y;
            const square = dx * dx + dy * dy;
            if (square >= full) continue;
            if (square < hidden) { seen = 0; break; }
            const distance = Math.sqrt(square);
            // What shows at this point lies further out on the flat sheet, by the depth of the well here.
            const slope = lens.k * (1 - distance / PLANET.reach);
            // A well shows what lies further out; a lens shows what lies nearer in.
            const bend = lensed ? HOLE.ring * HOLE.ring * lens.k * (distance > PLANET.reach * 2 / 3 ? 1 - smoothstep((distance - PLANET.reach * 2 / 3) / (PLANET.reach / 3)) : 1) / square
              : -DEPTH * slope * slope / distance;
            bendX += dx * bend;
            bendY += dy * bend;
            if (slope > bent) bent = slope;
            if (lens.wave !== null) {
              // The ripple: one swell travelling out through the dots, spent by the time it reaches the reach.
              const fade = distance > PLANET.reach * 2 / 3 ? 1 - smoothstep((distance - PLANET.reach * 2 / 3) / (PLANET.reach / 3)) : 1;
              const along = (distance - lens.wave * PLANET.reach) / 20;
              const swell = 7 * (1 - lens.wave) * fade * along * Math.exp(-along * along) / distance;
              bendX += dx * swell;
              bendY += dy * swell;
            }
            stretch += Math.abs(bend);
            seen = 2;
          }
          if (seen === 1) continue;
          const at = (row * size + col) * 4;
          if (!seen) { data[at + 3] = 0; continue; }
          const fromX = x - bendX;
          const fromY = y - bendY;
          const soft = stretch / pixel;
          let red = paperRed;
          let green = paperGreen;
          let blue = paperBlue;
          if (sky !== null) {
            const i = Math.floor(fromX / CELL) - skyFrom;
            const j = Math.floor(fromY / CELL) - skyFrom;
            const cell = j * skyCells + i;
            if (i >= 0 && j >= 0 && i < skyCells && j < skyCells && skyA[cell]) {
              const amount = (skyR[cell] - Math.hypot(fromX - skyX[cell], fromY - skyY[cell])) / soft + 0.5;
              if (amount > 0) {
                const light = Math.min(1, amount) * skyA[cell];
                red += (inkRed - red) * light;
                green += (inkGreen - green) * light;
                blue += (inkBlue - blue) * light;
              }
            }
          }
          if (weave) {
            // Faintest right by the planet, where the points are drawn out, and where the sheet flattens.
            const thread = cover(fromX, fromY, soft, Infinity, weave, WEAVE.dot) * WEAVE.strength * bent * (1 - 0.6 * bent);
            if (thread > 0) {
              red += (inkRed - red) * thread;
              green += (inkGreen - green) * thread;
              blue += (inkBlue - blue) * thread;
            }
          }
          const lit = cover(fromX, fromY, soft, open, step, dot) * strength / 255;
          if (lit > 0) {
            red += (dotRed - red) * lit;
            green += (dotGreen - green) * lit;
            blue += (dotBlue - blue) * lit;
          }
          data[at] = red;
          data[at + 1] = green;
          data[at + 2] = blue;
          data[at + 3] = 255;
        }
      }
    }
    paint.putImageData(image, 0, 0);
  }

  // `bodies` is where each planet is drawn, {x, y, k}: k is how far it has
  // settled into the well, from 0 (in the tray) to 1. `shown` is the result
  // for the bodies as drawn, which differs from the board's only mid-glide.
  // `won` runs from 0 to 1 as a solved board settles into one picture: the rim
  // lights round from the top, the paths firm up and the working marks go.
  // `slots` is where each planet waits in the tray (null once it is in the well),
  // and `waves` how far along each planet's ripple is, 0 to 1, or null.
  function draw({ board, planets, bodies, shown, won = 0, hints, held, mode, lens = true, clues = true, sky = null, weave = true, hole = false, selected = null, time = null, slots = planets.map((_, i) => i), waves = planets.map(() => null) }) {
    const size = board.size ?? FULL;
    const dots = spots(board);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim();
    const paper = css.getPropertyValue('--bg').trim();
    const quiet = css.getPropertyValue('--guide').trim();
    const s = geometry.scale;
    const circle = (x, y, r, fill = false) => {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      if (fill) g.fill(); else g.stroke();
    };
    const numeral = (value, point) => g.fillText(String(value), point.x, point.y);
    // The board is drawn on clear glass: the page's sky shows through it.
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    g.translate(geometry.x, geometry.y);
    g.scale(s, s);
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 1 / s;
    g.font = `500 ${Math.max(16, 10 / s)}px "Plex Mono", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    circle(300, 300, WELL.rim);
    g.clip();
    if (lens) {
      lattice(bodies.map((body, i) => ({ ...body, wave: waves[i] })).filter(body => body.k > 0.01), quiet, size, sky, ink, paper, weave && !hole, hole);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(layer, origin.x, origin.y);
      g.restore();
    } else {
      g.fillStyle = quiet;
      dots.forEach(dot => circle(dot.x, dot.y, dotSize(spacing(size)), true));
    }
    // The disc. `time` is null when nothing may move, and then it is not drawn.
    if (time !== null && !hole) {
      const seconds = discTime ? Math.min(0.05, Math.max(0, (time - discTime) / 1000)) : 0;
      discTime = time;
      // Evenly round the planet, so the band reads as one thing turning.
      if (discs.length !== bodies.length) discs = bodies.map(() => Array.from({ length: DISC.specks }, (_, at) => ({ r: DISC.inner + Math.random() * (DISC.outer - DISC.inner), a: (at + Math.random() * 0.6) / DISC.specks * TAU })));
      g.strokeStyle = ink;
      g.lineCap = 'round';
      g.lineWidth = 0.8 / s;
      bodies.forEach((body, i) => {
        if (body.k <= 0.01) return;
        for (const speck of discs[i]) {
          const depth = (DISC.outer - speck.r) / (DISC.outer - DISC.inner);
          const spin = DISC.turn * (22 / speck.r) ** 1.5;
          speck.r -= DISC.fall * (1 + depth) * seconds;
          speck.a += spin * seconds;
          if (speck.r <= DISC.inner) speck.r = DISC.outer;
          g.globalAlpha = DISC.strength * body.k * Math.min(1, (DISC.outer - speck.r) / 2, (speck.r - DISC.inner) / 1.5);
          g.beginPath();
          g.arc(body.x, body.y, speck.r, speck.a - spin * DISC.streak, speck.a);
          g.stroke();
        }
      });
      g.globalAlpha = 1;
      g.lineCap = 'butt';
    } else discTime = 0;
    // Dust falls in to a planet that has just landed: a few specks from inside
    // its reach, slowly at first and then fast, turning a little as they go.
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineWidth = 1 / s;
    const chance = n => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
    bodies.forEach((body, i) => {
      if (waves[i] === null || body.k <= 0.01) return;
      for (let speck = 0; speck < DUST; speck++) {
        const part = waves[i] * 1.35 - 0.3 * chance(speck + i * 31 + 0.5);
        if (part <= 0 || part >= 1) continue;
        const from = PLANET.reach * (0.5 + 0.5 * chance(speck * 7 + i * 13 + 1.5));
        const angle = speck / DUST * TAU + chance(speck + i * 17 + 2.5);
        const at = fall => {
          const radius = PLANET.r + (from - PLANET.r) * (1 - fall * fall);
          const turned = angle + 0.7 * fall * fall;
          return [body.x + Math.cos(turned) * radius, body.y + Math.sin(turned) * radius];
        };
        g.globalAlpha = 0.6 * Math.min(1, part * 6) * (1 - part ** 4);
        g.beginPath();
        g.moveTo(...at(Math.max(0, part - 0.07)));
        g.lineTo(...at(part));
        g.stroke();
      }
    });
    g.globalAlpha = 1;
    g.lineCap = 'butt';
    if (mode === 'paths') {
      g.strokeStyle = ink;
      g.lineWidth = 0.8 / s;
      if (clues && !won) {
        // The way out: the line each bent probe leaves along, drawn back from
        // its light to the corner where it meets the way in. A planet turns a
        // probe about the line that halves that corner.
        const exits = lights(board);
        const ways = leaving(board);
        g.globalAlpha = 0.5;
        g.setLineDash([2 / s, 4 / s]);
        board.probes.forEach((probe, i) => {
          if (ways[i] === null || shown.lit[i]) return;
          const to = onRim(exits[i]);
          const from = corner(probe, exits[i], ways[i]) ?? { x: to.x - Math.cos(ways[i]) * 150, y: to.y - Math.sin(ways[i]) * 150 };
          g.beginPath();
          g.moveTo(from.x, from.y);
          g.lineTo(to.x, to.y);
          g.stroke();
        });
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      g.lineWidth = (0.8 + 0.8 * won) / s;
      shown.traces.forEach(path => {
        const points = path.points;
        const fade = path.lost === 'time' ? Math.floor(points.length * 0.75) : points.length;
        g.beginPath();
        points.slice(0, fade).forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
        g.stroke();
        for (let i = fade; i < points.length; i++) {
          g.globalAlpha = (points.length - i) / (points.length - fade);
          g.beginPath();
          g.moveTo(...points[i - 1]);
          g.lineTo(...points[i]);
          g.stroke();
        }
        g.globalAlpha = 1;
      });
    }
    g.restore();
    g.strokeStyle = ink;
    circle(300, 300, WELL.rim);
    if (won) {
      g.lineWidth = 4 / s;
      g.beginPath();
      g.arc(300, 300, WELL.rim, -Math.PI / 2, -Math.PI / 2 + TAU * won);
      g.stroke();
      g.lineWidth = 1 / s;
    }
    shown.traces.forEach((path, i) => {
      if (path.exit === null || (mode === 'paths' && shown.lit[i])) return;
      g.fillStyle = ink;
      const p = onRim(path.exit);
      circle(p.x, p.y, 3, true);
      if (mode === 'dots') numeral(i + 1, onRim(path.exit, WELL.rim - 22));
    });
    board.probes.forEach((probe, i) => {
      const p = onRim(rad(probe.at));
      g.fillStyle = ink;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(rad(probe.aim));
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-5, -5);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.restore();
      numeral(i + 1, onRim(rad(probe.at), 288));
    });
    lights(board).forEach((angle, i) => {
      const p = onRim(angle);
      g.fillStyle = shown.lit[i] ? ink : paper;
      circle(p.x, p.y, 13, true);
      g.strokeStyle = ink;
      circle(p.x, p.y, 13);
      g.fillStyle = shown.lit[i] ? paper : ink;
      numeral(i + 1, p);
    });
    // A hint is four ticks about a dot, so it is never taken for a planet's ring.
    g.strokeStyle = ink;
    g.lineWidth = 1.5 / s;
    board.answer.slice(0, won ? 0 : hints).forEach(index => {
      const dot = dots[index];
      g.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        g.moveTo(dot.x + dx * 7, dot.y + dy * 7);
        g.lineTo(dot.x + dx * 15, dot.y + dy * 15);
      }
      g.stroke();
    });
    g.lineWidth = 1 / s;
    // The tray shows every place it has; the ones whose planet is out in the well are dashed.
    if (!won) {
      const waiting = slots.filter(slot => slot !== null).length;
      g.globalAlpha = 0.3;
      g.setLineDash([3 / s, 4 / s]);
      for (let slot = waiting; slot < planets.length; slot++) circle(trayPoint(slot, planets.length).x, trayPoint(slot, planets.length).y, PLANET.r);
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    // The planets are the one soft thing here: a glow and a little shading, both still.
    const inkTint = tint(ink);
    const paperTint = tint(paper);
    // Dark ink on light paper glows as a shadow would, so it is kept fainter.
    const soft = inkTint.split(',').reduce((sum, part) => sum + Number(part), 0) < 384 ? 0.45 : 1;
    planets.forEach((index, i) => {
      const body = bodies[i];
      // The planet a tap will move is the lit one: its glow is wider and stronger.
      const lit = selected === i;
      const reach = PLANET.r * (lit ? 2.9 : 2.1);
      if (hole) {
        const strength = held?.planet === i && index === null ? 0.4 : 1;
        const R = PLANET.r;
        g.save();
        g.translate(body.x, body.y);
        g.globalAlpha = strength;
        const halo = g.createRadialGradient(0, 0, R * 0.9, 0, 0, R * (lit ? 3.4 : 2.5));
        halo.addColorStop(0, `rgba(${inkTint},${(lit ? 0.5 : 0.2) * soft})`);
        halo.addColorStop(1, `rgba(${inkTint},0)`);
        g.fillStyle = halo;
        circle(0, 0, R * (lit ? 3.4 : 2.5), true);
        // The disc: bands that turn, quicker the closer in. `from` to `to` is the half drawn.
        const band = (from, to, light) => {
          g.save();
          g.rotate(HOLE.turn);
          g.scale(1, HOLE.tilt);
          g.strokeStyle = ink;
          g.lineWidth = 1.7;
          for (let at = 0; at < HOLE.bands; at++) {
            const radius = R * (HOLE.inner + (HOLE.outer - HOLE.inner) * at / (HOLE.bands - 1));
            g.globalAlpha = strength * light * (1 - at / (HOLE.bands + 1.5));
            g.setLineDash([radius * 1.5, radius * 0.2 + at]);
            g.lineDashOffset = at * 9 - (time === null ? 0 : time / 1000 * 22 * Math.sqrt(HOLE.inner * R / radius));
            g.beginPath();
            g.arc(0, 0, radius, from, to);
            g.stroke();
          }
          g.restore();
        };
        band(Math.PI, TAU, 0.3);
        g.globalAlpha = strength;
        g.fillStyle = paper;
        circle(0, 0, R, true);
        // Light bent round the hole: a rim all the way round, and the disc's far side over the top.
        g.strokeStyle = ink;
        g.globalAlpha = strength * 0.9;
        g.lineWidth = 1.5;
        circle(0, 0, R + 0.75);
        g.globalAlpha = strength * 0.5;
        g.lineWidth = 2.8;
        g.beginPath();
        g.arc(0, 0, R + 3, Math.PI + HOLE.turn + 0.3, TAU + HOLE.turn - 0.3);
        g.stroke();
        band(0, Math.PI, 0.75);
        g.restore();
        g.globalAlpha = 1;
        return;
      }
      g.globalAlpha = held?.planet === i && index === null ? 0.4 : 1;
      const glow = g.createRadialGradient(body.x, body.y, PLANET.r * 0.7, body.x, body.y, reach);
      glow.addColorStop(0, `rgba(${inkTint},${(lit ? 0.62 : 0.26) * soft})`);
      glow.addColorStop(1, `rgba(${inkTint},0)`);
      g.fillStyle = glow;
      circle(body.x, body.y, reach, true);
      g.fillStyle = ink;
      circle(body.x, body.y, PLANET.r, true);
      const shade = g.createRadialGradient(body.x - PLANET.r * 0.35, body.y - PLANET.r * 0.4, PLANET.r * 0.15, body.x, body.y, PLANET.r);
      shade.addColorStop(0, `rgba(${paperTint},0)`);
      shade.addColorStop(1, `rgba(${paperTint},0.3)`);
      g.fillStyle = shade;
      circle(body.x, body.y, PLANET.r, true);
      g.globalAlpha = 1;
    });
  }
  return { resize, toBoard, draw, get geometry() { return { ...geometry }; } };
}

// The page's sky, on its own canvas behind everything. `x`, `y` and `scale` say
// where the board lies on the page. With `time` null the stars hold still.
export function createSky(canvas) {
  const g = canvas.getContext('2d');
  let drawn = -Infinity;
  let key = '';
  let count = 0;
  function draw({ seed, x, y, scale, colour, time = null }) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const wide = innerWidth;
    const high = innerHeight;
    const now = `${seed}|${x}|${y}|${scale}|${wide}|${high}|${colour}|${time === null}`;
    // The stars change slowly: ten pictures a second is plenty.
    if (now === key && (time === null || time - drawn < 100)) return;
    drawn = time ?? -Infinity;
    if (canvas.width !== Math.round(wide * ratio) || canvas.height !== Math.round(high * ratio)) {
      canvas.width = Math.round(wide * ratio);
      canvas.height = Math.round(high * ratio);
    }
    const left = -x / scale;
    const top = -y / scale;
    const right = (wide - x) / scale;
    const bottom = (high - y) / scale;
    key = now;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, wide, high);
    g.translate(x, y);
    g.scale(scale, scale);
    g.fillStyle = colour;
    count = 0;
    const seconds = time === null ? null : time / 1000;
    for (let j = Math.floor(top / CELL); j <= Math.floor(bottom / CELL); j++) {
      for (let i = Math.floor(left / CELL); i <= Math.floor(right / CELL); i++) {
        const one = star(i, j, seed);
        if (!one) continue;
        count++;
        g.globalAlpha = seconds === null ? one.a : twinkle(one, seconds);
        g.beginPath();
        g.arc(one.x, one.y, Math.max(one.r, 0.6 / scale), 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  return { draw, get count() { return count; } };
}
