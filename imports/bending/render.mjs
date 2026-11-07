import {BALL_R, G, influence} from './engine.mjs?v=31b88eb6';
import {WELL} from './levels.mjs?v=31b88eb6';

const TAU = Math.PI * 2;
// The board fits the rim, not the 600-unit box, so a phone spends its width on
// the well; the margin holds the keyboard focus rim drawn at rim + 7.
const EXTENT = WELL.rim + 14;
// The field sheet: grid spacing and sample step; how hard each kind of body
// pinches it; and the pull at which a pinch is half its depth.
const GRID = 30;
const GRID_STEP = 5;
const PINCH_STAR = 0.16;
const PINCH_PLANET = 0.4;
const PINCH_HALF = 500;
// Guide beads sit every 0.1 s of flight (the trace keeps a point every 1/60 s),
// so their spacing is the probe's speed: they spread falling in, bunch climbing out.
const BEAD_EVERY = 6;
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function createRenderer(canvas, engine) {
  const context = canvas.getContext('2d');
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let geometry = { scale: 1, x: 0, y: 0 };
  // The flown path stays on the board until the next launch, so a miss can be
  // read against the new aim: the comparison is how the field is learned.
  let flight = [];
  let ghost = null;
  let sheet = null;
  let sheetKey = '';

  // The board draws with the page's colour tokens, so a theme change (system or
  // [data-theme]) reaches the canvas too. Read once, again only when it changes.
  let colorCache = null;
  const forget = () => { colorCache = null; sheetKey = ''; };
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', forget);
  new MutationObserver(forget).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  function palette() {
    if (colorCache) return colorCache;
    const css = getComputedStyle(document.documentElement);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const paper = token('--bg', '#ffffff');
    // Dark when the background is darker than mid grey.
    const probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = paper;
    const hex = probe.fillStyle;
    const dark = /^#/.test(hex) && parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) < 384;
    colorCache = {
      paper,
      well: token('--band', 'rgba(0, 0, 0, .05)'),
      line: token('--frame', '#1c1c1c'),
      quiet: token('--guide', '#8f8f8f'),
      ink: token('--ink', '#000000'),
      ghost: token('--sub', '#5e5e5e'),
      dark
    };
    return colorCache;
  }

  function resize(nextWidth, nextHeight, dpr = 1) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    pixelRatio = Math.min(2, dpr || 1);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const scale = Math.min(width, height) / (EXTENT * 2);
    geometry = { scale, x: width / 2 - WELL.centre * scale, y: height / 2 - WELL.centre * scale };
  }

  function drawEllipseArc(g, fragment, start, end) {
    g.save();
    g.translate(fragment.x, fragment.y);
    g.rotate(fragment.tilt);
    g.scale(1, 0.34);
    g.beginPath();
    g.arc(0, 0, fragment.r, start, end);
    g.stroke();
    g.restore();
  }

  // Each grid point is drawn in toward every body by an amount that follows
  // that body's real pull and stops exactly where the pull stops, so the sheet
  // is flat where a probe flies straight and pinched where it bends.
  function fieldSheet(state) {
    const bodies = [];
    if (engine.star) bodies.push({ x: engine.star.x, y: engine.star.y, mass: engine.star.mass, soft: engine.star.softening ?? engine.star.r, reach: Infinity, pinch: PINCH_STAR });
    for (const peg of state.pegs) if (peg.mass > 0) bodies.push({ x: peg.x, y: peg.y, mass: peg.mass, soft: peg.r, reach: influence(peg), pinch: PINCH_PLANET });
    const key = bodies.map(body => `${body.x}:${body.y}`).join(',');
    if (sheet && key === sheetKey) return sheet;
    const pinch = (x, y) => {
      let dx = 0;
      let dy = 0;
      for (const body of bodies) {
        const bx = body.x - x;
        const by = body.y - y;
        const distance = Math.hypot(bx, by) || 1;
        if (distance >= body.reach) continue;
        const fade = Number.isFinite(body.reach) && distance > body.reach * 2 / 3 ? 1 - smoothstep((distance - body.reach * 2 / 3) / (body.reach / 3)) : 1;
        const pull = G * body.mass / (distance * distance + body.soft * body.soft) * fade;
        // A share of the distance, so lines bunch toward the body instead of sliding.
        const shift = distance * body.pinch * pull / (pull + PINCH_HALF);
        dx += bx / distance * shift;
        dy += by / distance * shift;
      }
      return [x + dx, y + dy];
    };
    sheet = new Path2D();
    // The sheet runs past the rim so the star's pinch never pulls an edge into view.
    const reach = WELL.rim + 4 * GRID;
    for (let offset = -reach + (reach % GRID); offset <= reach; offset += GRID) {
      const span = Math.sqrt(Math.max(0, reach * reach - offset * offset));
      for (const vertical of [false, true]) {
        for (let along = -span; along <= span + 1e-6; along += GRID_STEP) {
          const [x, y] = vertical ? pinch(WELL.centre + offset, WELL.centre + along) : pinch(WELL.centre + along, WELL.centre + offset);
          if (along === -span) sheet.moveTo(x, y); else sheet.lineTo(x, y);
        }
      }
    }
    sheetKey = key;
    return sheet;
  }

  function clearTrails() { flight = []; ghost = null; }

  function draw(alpha = 0, { reducedMotion = false, focusRing = false, swing = null, sliding = false } = {}) {
    const colors = palette();
    const state = engine.state;
    const scale = geometry.scale;
    const px = value => value / scale;
    const g = context;
    g.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    g.clearRect(0, 0, width, height);
    g.fillStyle = colors.paper;
    g.fillRect(0, 0, width, height);
    g.save();
    g.translate(geometry.x, geometry.y);
    g.scale(scale, scale);

    g.fillStyle = colors.well;
    g.beginPath();
    g.arc(WELL.centre, WELL.centre, WELL.rim, 0, TAU);
    g.fill();
    // Keyboard focus on the well draws a second rim just outside it.
    if (focusRing) {
      g.strokeStyle = colors.ink;
      g.lineWidth = px(2);
      g.beginPath();
      g.arc(WELL.centre, WELL.centre, WELL.rim + 7, 0, TAU);
      g.stroke();
    }

    const guide = !state.ball && !state.won ? engine.trajectory() : [];
    g.save();
    g.beginPath();
    g.arc(WELL.centre, WELL.centre, WELL.rim, 0, TAU);
    g.clip();
    // The field sheet, then one dotted contour at each planet's reach: inside it
    // the planet pulls, outside it nothing does. A well the guide enters darkens.
    g.strokeStyle = colors.quiet;
    g.globalAlpha = colors.dark ? 0.34 : 0.4;
    g.lineWidth = px(0.6);
    g.stroke(fieldSheet(state));
    g.globalAlpha = 1;
    for (const peg of state.pegs) {
      if (!peg.mass) continue;
      const reach = influence(peg);
      const entered = guide.some(p => Math.hypot(p.x - peg.x, p.y - peg.y) <= reach);
      g.strokeStyle = entered ? colors.ink : colors.quiet;
      g.globalAlpha = entered ? 0.7 : 0.75;
      g.lineWidth = px(entered ? 1.1 : 0.8);
      g.setLineDash([px(1.5), px(5)]);
      g.beginPath();
      g.arc(peg.x, peg.y, reach, 0, TAU);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.restore();

    // The rim reads as the launcher's track; it thickens while a finger slides it.
    g.strokeStyle = sliding ? colors.ink : colors.line;
    g.lineWidth = px(sliding ? 3 : 1.5);
    g.beginPath();
    g.arc(WELL.centre, WELL.centre, WELL.rim, 0, TAU);
    g.stroke();

    if (engine.star) {
      g.fillStyle = colors.paper;
      g.beginPath();
      g.arc(WELL.centre, WELL.centre, WELL.hole + 5, 0, TAU);
      g.fill();
      g.fillStyle = colors.ink;
      g.beginPath();
      g.arc(WELL.centre, WELL.centre, WELL.hole, 0, TAU);
      g.fill();
      g.strokeStyle = colors.paper;
      g.lineWidth = px(1);
      g.beginPath();
      g.arc(WELL.centre, WELL.centre, WELL.hole - 8, 0, TAU);
      g.stroke();
    }

    // The flown path: drawn as it is flown, then kept until the next launch.
    if (state.ball) {
      if (ghost) ghost = null;
      const last = flight[flight.length - 1];
      if (!last || Math.hypot(state.ball.x - last.x, state.ball.y - last.y) > 3) flight.push({ x: state.ball.x, y: state.ball.y });
    } else if (flight.length > 1) {
      ghost = flight;
      flight = [];
    }
    const flown = state.ball ? flight : ghost;
    if (flown && flown.length > 1) {
      g.strokeStyle = colors.ghost;
      g.globalAlpha = state.ball ? 0.5 : 0.42;
      g.lineWidth = px(1.2);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      flown.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
      g.stroke();
      g.globalAlpha = 1;
    }

    const launchRadius = WELL.rim - BALL_R - 2;
    const aimX = Math.cos(state.aim);
    const aimY = Math.sin(state.aim);
    if (guide.length > 1) {
      const n = guide.length - 1;
      let length = 0;
      for (let i = 0; i < n; i++) length += Math.hypot(guide[i + 1].x - guide[i].x, guide[i + 1].y - guide[i].y);
      // The chord is where the probe would go if nothing pulled. The gap between
      // it and the beads is the field at work.
      g.strokeStyle = colors.quiet;
      g.lineWidth = px(1);
      g.setLineDash([px(3), px(5)]);
      g.beginPath();
      g.moveTo(guide[0].x, guide[0].y);
      g.lineTo(guide[0].x + aimX * length, guide[0].y + aimY * length);
      g.stroke();
      g.setLineDash([]);
      // A thin spine under the beads keeps the bend continuous at a glance.
      g.strokeStyle = colors.ink;
      g.lineCap = 'round';
      g.lineWidth = px(1.1);
      for (let i = 0; i < n; i++) {
        g.globalAlpha = 0.55 * (1 - i / n) + 0.1;
        g.beginPath();
        g.moveTo(guide[i].x, guide[i].y);
        g.lineTo(guide[i + 1].x, guide[i + 1].y);
        g.stroke();
      }
      g.fillStyle = colors.ink;
      for (let i = BEAD_EVERY; i <= n; i += BEAD_EVERY) {
        const t = i / n;
        g.globalAlpha = 0.95 - 0.6 * t;
        g.beginPath();
        g.arc(guide[i].x, guide[i].y, px(2.6 - 1.2 * t), 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
      // A small pulse runs along the guide at the probe's own pace.
      if (!reducedMotion) {
        const at = ((performance.now() / 1700) % 1) * n;
        const i = Math.min(n - 1, Math.floor(at)), f = at - i;
        const x = guide[i].x + (guide[i + 1].x - guide[i].x) * f, y = guide[i].y + (guide[i + 1].y - guide[i].y) * f;
        g.fillStyle = colors.ink;
        g.globalAlpha = 0.8 * (1 - at / n);
        g.beginPath();
        g.arc(x, y, px(3.4), 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      }
    }

    for (const peg of state.pegs) {
      if (peg.target && !peg.hit) {
        g.strokeStyle = colors.ink;
        g.lineWidth = px(2);
        g.save();
        g.translate(peg.x, peg.y);
        g.rotate(peg.tilt ?? 0);
        g.scale(1, 0.34);
        g.beginPath();
        g.arc(0, 0, peg.r + 7, 0, TAU);
        g.stroke();
        g.restore();
      }
      // Depth, still monochrome: a soft shadow falls away from the star and a
      // thin rim of starlight lights the side that faces it.
      const radius = peg.kind === 'moon' ? Math.max(peg.r * 0.65, px(3)) : peg.r;
      const toStar = Math.atan2(WELL.centre - peg.y, WELL.centre - peg.x);
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.22)';
      g.shadowBlur = radius * 0.6 * scale * pixelRatio;
      g.shadowOffsetX = -Math.cos(toStar) * radius * 0.28 * scale * pixelRatio;
      g.shadowOffsetY = -Math.sin(toStar) * radius * 0.28 * scale * pixelRatio;
      g.fillStyle = colors.ink;
      g.beginPath();
      g.arc(peg.x, peg.y, radius, 0, TAU);
      g.fill();
      g.restore();
      if (peg.kind !== 'moon') {
        g.strokeStyle = colors.paper;
        g.globalAlpha = 0.55;
        g.lineWidth = Math.max(px(0.9), radius * 0.09);
        g.lineCap = 'round';
        g.beginPath();
        // Light theme: a lit edge on the star side of a black planet. Dark theme: a
        // shaded edge on the far side of a white one. Either way the star is the light.
        const facing = colors.dark ? toStar + Math.PI : toStar;
        g.arc(peg.x, peg.y, radius * 0.86, facing - 0.85, facing + 0.85);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    for (const fragment of state.fragments) {
      g.strokeStyle = colors.ink;
      g.globalAlpha = reducedMotion ? 0.7 : Math.max(0, 1 - fragment.age / 1.15);
      g.lineWidth = px(1.5);
      drawEllipseArc(g, fragment, -2.6, -1.72);
      drawEllipseArc(g, fragment, -0.38, 0.45);
      drawEllipseArc(g, fragment, 1.08, 1.7);
      g.globalAlpha = 1;
    }

    for (const flash of state.flashes) {
      g.strokeStyle = colors.ink;
      g.globalAlpha = reducedMotion ? 0.45 : Math.max(0, 0.48 - flash.age * 0.68);
      g.lineWidth = px(1);
      g.beginPath();
      g.arc(flash.x, flash.y, 18 + (reducedMotion ? 0 : flash.age * 30), 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }

    for (const assist of state.assists) {
      const size = 6;
      g.strokeStyle = colors.ink;
      g.globalAlpha = reducedMotion ? 0.75 : Math.max(0, 0.9 - assist.age);
      g.lineWidth = px(1.4);
      g.beginPath();
      g.moveTo(assist.x - size, assist.y - size * 0.55);
      g.lineTo(assist.x, assist.y + size * 0.55);
      g.lineTo(assist.x + size, assist.y - size * 0.55);
      g.stroke();
      g.globalAlpha = 1;
    }

    const marker = { x: WELL.centre + Math.cos(state.position) * (WELL.rim - 7), y: WELL.centre + Math.sin(state.position) * (WELL.rim - 7) };
    g.strokeStyle = colors.ink;
    g.lineWidth = px(3);
    g.beginPath();
    g.arc(WELL.centre, WELL.centre, WELL.rim - 7, state.position - 0.09, state.position + 0.09);
    g.stroke();
    if (!state.ball && !state.won) {
      // The launch direction, as a short bold arrow from the rim.
      const tip = { x: marker.x + aimX * 30, y: marker.y + aimY * 30 };
      g.strokeStyle = colors.ink;
      g.lineWidth = px(2.4);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(marker.x, marker.y);
      g.lineTo(tip.x, tip.y);
      g.moveTo(tip.x + Math.cos(state.aim + 2.6) * 8, tip.y + Math.sin(state.aim + 2.6) * 8);
      g.lineTo(tip.x, tip.y);
      g.lineTo(tip.x + Math.cos(state.aim - 2.6) * 8, tip.y + Math.sin(state.aim - 2.6) * 8);
      g.stroke();
      // While a finger swings the aim, the point it is steering rides the chord.
      if (swing) {
        const launch = { x: WELL.centre + Math.cos(state.position) * launchRadius, y: WELL.centre + Math.sin(state.position) * launchRadius };
        g.lineWidth = px(1.5);
        g.beginPath();
        g.arc(launch.x + aimX * px(swing), launch.y + aimY * px(swing), px(7), 0, TAU);
        g.stroke();
      }
    }
    // The loaded probe waits at its launch point; tapping it fires.
    if (!state.ball && !state.won && engine.armed) {
      g.fillStyle = colors.ink;
      g.beginPath();
      g.arc(WELL.centre + Math.cos(state.position) * launchRadius, WELL.centre + Math.sin(state.position) * launchRadius, BALL_R, 0, TAU);
      g.fill();
    }

    if (state.ball) {
      if (!reducedMotion && state.trail.length > 1) {
        // A short tapering trail behind the probe.
        g.strokeStyle = colors.ink;
        g.lineCap = 'round';
        const n = state.trail.length - 1;
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / n;
          g.globalAlpha = 0.45 * t;
          g.lineWidth = px(0.6 + 2.4 * t);
          g.beginPath();
          g.moveTo(state.trail[i].x, state.trail[i].y);
          g.lineTo(state.trail[i + 1].x, state.trail[i + 1].y);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      const x = (state.ball.px ?? state.ball.x) + (state.ball.x - (state.ball.px ?? state.ball.x)) * alpha;
      const y = (state.ball.py ?? state.ball.y) + (state.ball.y - (state.ball.py ?? state.ball.y)) * alpha;
      g.fillStyle = colors.paper;
      g.beginPath();
      g.arc(x, y, BALL_R + 2, 0, TAU);
      g.fill();
      g.fillStyle = colors.ink;
      g.beginPath();
      g.arc(x, y, BALL_R, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function toBoard(clientX, clientY, rect = canvas.getBoundingClientRect()) {
    const x = (clientX - rect.left - geometry.x) / geometry.scale;
    const y = (clientY - rect.top - geometry.y) / geometry.scale;
    return { x, y };
  }

  return { resize, draw, toBoard, clearTrails, get scale() { return geometry.scale; }, get geometry() { return { ...geometry }; } };
}
