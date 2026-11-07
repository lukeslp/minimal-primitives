/* Nod · reading the head and turning it into tips. By Luke Steuber.
   Adapted from Glance's gaze.js. Pure parts of the input, shared by the page
   and its tests: a one-euro filter, the look-and-hold machine, the features
   read from face landmarks (head yaw, pitch and roll, and the eyes' look),
   the calibrations that turn them into a point, and the tilt recogniser that
   turns that point into one tip at a time. No camera, page or clock lives
   here; every call is given its time.
   Its body is generated from tools/input/gaze-core.js by tools/sync-gaze.py;
   edit the core or tools/input/extras/, never this file. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NodGaze = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // The one-euro filter (Casiez, Roussel and Vogel, 2012): smooth at rest,
  // quick when the point moves fast. Times in milliseconds.
  function oneEuro({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    let x = null, dx = 0, last = null;
    const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    return {
      filter(value, t) {
        if (x === null || last === null || t <= last) { if (x === null) x = value; last = t; return x; }
        const dt = Math.min(.25, (t - last) / 1000); last = t;
        const raw = (value - x) / dt; dx += alpha(dCutoff, dt) * (raw - dx);
        x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
        return x;
      },
      reset() { x = null; dx = 0; last = null; }
    };
  }
  // Look and hold. `targets(x, y)` names what lies under a point (or null in
  // the rest area); `holds(target, x, y)` says whether a point still counts
  // as on a target, its own area grown by the dead zone. A ring fills while
  // the point stays on its target and drains when it leaves; a full ring
  // fires once, and that target cannot fire again until the point has left
  // it. A short loss of the face changes nothing; a longer one is looking away.
  function dwell({ time = 800, drain = 400, lost = 300, targets, holds }) {
    let current = null, blocked = null, last = null, missing = null;
    const progress = new Map();
    function sample(t, x, y) {
      const dt = last === null ? 0 : clamp(t - last, 0, 120), fired = [];
      last = t;
      if (x === null || x === undefined) {
        if (missing === null) missing = t;
        if (t - missing < lost) return fired;
        current = null; blocked = null;
      } else {
        missing = null;
        current = current && holds(current, x, y) ? current : targets(x, y);
        if (blocked !== null && (!current || current.id !== blocked)) blocked = null;
      }
      const live = current && current.id !== blocked ? current.id : null;
      for (const [id, p] of progress) if (id !== live) { const q = p - dt / drain; if (q <= 0) progress.delete(id); else progress.set(id, q); }
      if (live !== null) {
        const p = (progress.get(live) || 0) + dt / time;
        if (p >= 1) { progress.delete(live); blocked = live; fired.push(current); }
        else progress.set(live, p);
      }
      return fired;
    }
    return {
      sample,
      get current() { return current; }, get blocked() { return blocked; },
      progress: id => progress.get(id) || 0,
      rings: () => [...progress],
      set time(v) { time = v; },
      // Treat the point as already resting on this target, fired: it must
      // leave before the target can fill. Used after calibration and a new board.
      hold(target) { current = target || null; blocked = target ? target.id : null; },
      // A board change or a mode switch starts every ring afresh; the target
      // under the point stays blocked so a held look does not fire on what replaced it.
      reset(keepBlock = false) { progress.clear(); if (!keepBlock) { blocked = null; current = null; } else if (current) blocked = current.id; last = null; missing = null; }
    };
  }
  // Landmark indices in MediaPipe's 478-point face mesh.
  const MESH = { nose: 1, forehead: 10, chin: 152, cheekR: 234, cheekL: 454, mouthTop: 13, mouthBottom: 14,
    eyeR: { a: 33, b: 133, up: 159, down: 145, iris: 468 }, eyeL: { a: 362, b: 263, up: 386, down: 374, iris: 473 } };
  const P = (lm, i, aspect) => ({ x: lm[i].x * aspect, y: lm[i].y });
  // On a real face looking straight ahead the nose tip sits about 57.5 percent
  // of the way from the brow landmark to the chin, so a still head reads as a
  // 5 to 18 degree nod (the Eye Gaze review). Every use here is relative to a
  // calibrated rest, which takes that offset out, and the asin's slope 18
  // degrees off level differs by under 5 percent, so the reading stays halfway
  // (NOSE_REST): moving it would change every saved eyes calibration for no
  // gain in play.
  const NOSE_REST = .5;
  // Where the irises sit in the eyes, as a fraction of eye width, averaged
  // over both eyes and measured along each eye's own corner line, so a tilted
  // head does not read as a look sideways. Up and down are measured from the
  // corners' midpoint, which stays put, not from the lids, which follow the
  // iris up and down and so hid most of the eyes' vertical movement (as
  // gazenav's irisOffset found).
  // An eye whose iris reads further than this from its socket's centre (in
  // eye widths) is a detection gone wrong, often a half blink; it is left out
  // rather than trusted, and with both out the look is the head's alone.
  const IMPLAUSIBLE = .8;
  function irisOffset(lm, aspect = 4 / 3) {
    let ex = 0, ey = 0, used = 0;
    for (const e of [MESH.eyeR, MESH.eyeL]) {
      const a = P(lm, e.a, aspect), b = P(lm, e.b, aspect), iris = P(lm, e.iris, aspect);
      const w = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / w, uy = (b.y - a.y) / w;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const x = ((iris.x - mid.x) * ux + (iris.y - mid.y) * uy) / w, y = ((iris.x - mid.x) * -uy + (iris.y - mid.y) * ux) / w;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > IMPLAUSIBLE || Math.abs(y) > IMPLAUSIBLE) continue;
      ex += x; ey += y; used++;
    }
    return used ? { ex: ex / used, ey: ey / used, used } : { ex: 0, ey: 0, used: 0 };
  }
  // The look: head turn plus the eyes' turn within the head, both in image
  // terms and roughly in radians. The nose tip stands about a third of a face
  // width proud of the cheeks; the iris moves about two fifths of an eye width
  // per radian.
  function lookAngles(lm, aspect = 4 / 3) {
    const h = landmarkPose(lm, aspect), e = irisOffset(lm, aspect);
    return { ax: Math.sin(h.yaw) * .5 / .35 + e.ex / .4, ay: Math.sin(h.pitch) * .5 / .35 + e.ey / .4 };
  }
  // The five calibration places, in page units: -1 to 1 across the reach of
  // the page inside its edge band, left to right and top to bottom.
  const SPOTS = [{ u: 0, v: 0 }, { u: -.8, v: 0 }, { u: .8, v: 0 }, { u: 0, v: -.8 }, { u: 0, v: .8 }];
  // Up and down must not be far touchier than left and right. Most people
  // reach the top and bottom dots with their eyes and barely nod, so the
  // nod a calibration measures can be tiny, and mapped as it stands it made a
  // degree of head move the dot many times further up and down than across.
  // So the reach up and down is kept to at least the reach across over
  // BALANCE: a degree moves the dot at most BALANCE times as far across the
  // page's height as across its width. `invertY` flips up and down for a
  // player who wants it the other way.
  const BALANCE = 2;
  function balance(own, other) { const floor = Math.abs(other) / BALANCE; return Math.sign(own) * Math.max(Math.abs(own), floor) || floor; }
  function headMap(cal, pose, { invertY = false } = {}) {
    const along = (d, s) => .8 * (d * s.hi > 0 ? d / s.hi : -d / s.lo);
    const across = Math.min(Math.abs(cal.yaw.lo), Math.abs(cal.yaw.hi)), p = { lo: balance(cal.pitch.lo, across), hi: balance(cal.pitch.hi, across) };
    const v = clamp(along(pose.pitch - cal.centre.pitch, p), -1.25, 1.25);
    return { u: clamp(along(pose.yaw - cal.centre.yaw, cal.yaw), -1.25, 1.25), v: invertY ? -v : v };
  }
  // Eyes: a straight line per axis from the look to the page, fitted to the
  // five places by least squares.
  function eyesCalibration(looks) {
    const fit = (xs, ys) => {
      const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
      let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
      if (sxx < 1e-6) return null;
      const k = sxy / sxx; return { k, b: my - k * mx };
    };
    const u = fit(looks.map(l => l.ax), SPOTS.map(s => s.u)), v = fit(looks.map(l => l.ay), SPOTS.map(s => s.v));
    if (!u || !v || Math.abs(u.k) < .2 || Math.abs(v.k) < .2) return null;
    return { kind: 'eyes', e: 2, u, v };
  }
  function eyesMap(cal, look, { invertY = false } = {}) {
    // A gain is page units per unit of look: the larger, the touchier.
    const most = Math.abs(cal.u.k) * BALANCE, kv = Math.abs(cal.v.k) > most ? Math.sign(cal.v.k) * most : cal.v.k;
    // Turned about the look that lands mid-page, so the middle stays put.
    const v = clamp(kv * (look.ay + cal.v.b / cal.v.k), -1.25, 1.25);
    return { u: clamp(cal.u.b + cal.u.k * look.ax, -1.25, 1.25), v: invertY ? -v : v };
  }
  // Holding still: every recent reading lies close to their mean.
  function stillness(window, keys, tolerance) {
    if (!window.length) return { still: false };
    const mean = Object.fromEntries(keys.map(k => [k, window.reduce((s, w) => s + w[k], 0) / window.length]));
    const spread = Math.max(...window.map(w => Math.max(...keys.map(k => Math.abs(w[k] - mean[k])))));
    return { still: spread <= tolerance, mean, spread };
  }
  // An eyes calibration made before the eyes' up and down were measured from
  // the corners (no `e: 2`) still loads, but asks for a full calibration
  // again; a head calibration is unchanged.
  const current = c => !!c && (c.kind !== 'eyes' || c.e === 2);
  // Head yaw, pitch and roll in radians. From the facial transformation
  // matrix (column-major, as MediaPipe gives it): the face's forward axis is
  // its third column and its sideways axis its first, whose slope in the
  // image is the roll. Without a matrix, from the nose against the cheeks and
  // brow, and the slope of the line between the outer eye corners.
  function headPose(landmarks, matrix, aspect = 4 / 3) {
    if (matrix && matrix.data && matrix.data.length === 16) {
      const m = matrix.data, fx = m[8], fy = m[9], fz = m[10];
      return { yaw: Math.atan2(fx, fz), pitch: Math.atan2(fy, Math.hypot(fx, fz)), roll: Math.atan2(m[1], m[0]) };
    }
    return landmarkPose(landmarks, aspect);
  }
  function landmarkPose(lm, aspect = 4 / 3) {
    const n = P(lm, MESH.nose, aspect), r = P(lm, MESH.cheekR, aspect), l = P(lm, MESH.cheekL, aspect), top = P(lm, MESH.forehead, aspect), chin = P(lm, MESH.chin, aspect);
    const a = P(lm, MESH.eyeR.a, aspect), b = P(lm, MESH.eyeL.b, aspect);
    const width = Math.hypot(l.x - r.x, l.y - r.y) || 1, height = Math.hypot(chin.x - top.x, chin.y - top.y) || 1;
    return { yaw: Math.asin(clamp((n.x - (l.x + r.x) / 2) / (width * .5), -1, 1)), pitch: Math.asin(clamp((n.y - (top.y + (chin.y - top.y) * NOSE_REST)) / (height * .5), -1, 1)), roll: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  const MIN = .035;
  // Head: the centre sets the resting pose and each edge the comfortable
  // movement that way. Left and right are learnt as directions in turn and
  // roll together, so a player who tilts an ear toward a shoulder and one who
  // turns the face both play the way they calibrated; up and down are the
  // nod. A side moved too little to measure borrows the other side's reach.
  function headCalibration(poses) {
    const [c, l, r, t, b] = poses;
    const vec = p => ({ yaw: p.yaw - c.yaw, roll: (p.roll || 0) - (c.roll || 0) }), len = d => Math.hypot(d.yaw, d.roll), neg = d => ({ yaw: -d.yaw, roll: -d.roll });
    let left = vec(l), right = vec(r);
    if (len(left) < MIN && len(right) < MIN) return null;
    const same = left.yaw * right.yaw + left.roll * right.roll > 0;
    if (len(left) < MIN || (same && len(left) <= len(right))) left = neg(right);
    else if (len(right) < MIN || same) right = neg(left);
    let lo = t.pitch - c.pitch, hi = b.pitch - c.pitch;
    if (Math.abs(lo) < MIN && Math.abs(hi) < MIN) return null;
    if (Math.abs(lo) < MIN || Math.sign(lo) === Math.sign(hi)) lo = -hi;
    if (Math.abs(hi) < MIN) hi = -lo;
    return { kind: 'head', centre: { yaw: c.yaw, pitch: c.pitch, roll: c.roll || 0 }, left, right, pitch: { lo, hi } };
  }
  // The head's point: 1 at the calibrated reach in each direction, 0 at rest,
  // x to the right and y downward.
  function headPoint(cal, pose) {
    const d = { yaw: pose.yaw - cal.centre.yaw, roll: (pose.roll || 0) - cal.centre.roll };
    const along = v => (d.yaw * v.yaw + d.roll * v.roll) / (v.yaw * v.yaw + v.roll * v.roll);
    const r = Math.max(0, along(cal.right)), l = Math.max(0, along(cal.left)), dp = pose.pitch - cal.centre.pitch, s = cal.pitch;
    return { x: clamp(r >= l ? r : -l, -1.6, 1.6), y: clamp(dp * s.hi > 0 ? dp / s.hi : -dp / s.lo, -1.6, 1.6) };
  }
  // A fresh start keeps the reach and moves only the rest to where the
  // player sits now.
  function recentre(cal, rest) {
    if (cal.kind === 'head') return { ...cal, centre: { yaw: rest.yaw, pitch: rest.pitch, roll: rest.roll || 0 } };
    return { ...cal, u: { k: cal.u.k, b: -cal.u.k * rest.ax }, v: { k: cal.v.k, b: -cal.v.k * rest.ay } };
  }
  function validCalibration(c) {
    const num = v => typeof v === 'number' && Number.isFinite(v), vec = v => !!v && num(v.yaw) && num(v.roll) && Math.hypot(v.yaw, v.roll) >= MIN * .999;
    if (!c || typeof c !== 'object') return false;
    if (c.kind === 'head') return num(c.centre?.yaw) && num(c.centre?.pitch) && num(c.centre?.roll) && vec(c.left) && vec(c.right) && num(c.pitch?.lo) && num(c.pitch?.hi) && c.pitch.lo * c.pitch.hi < 0;
    if (c.kind === 'eyes') return ['u', 'v'].every(k => num(c[k]?.k) && num(c[k]?.b) && Math.abs(c[k].k) >= .2);
    if (c.kind === 'tracker') return num(c.dx) && num(c.dy);
    return false;
  }
  // ---- The tilt recogniser: continuous head movement made into discrete
  // decisions. The point (x, y) is 1 at the calibrated reach. While it rests
  // inside the rest ring the recogniser is armed, and the rest follows a slow
  // drift of posture there. A tilt that leaves the ring and passes the
  // threshold toward one edge, quickly enough to be meant, starts to build;
  // held there for the hold time it fires one tip. Then nothing more fires
  // until the point has come back inside the ring. A slow creep past the
  // threshold fires nothing and also waits for the return, as does a face
  // lost for longer than a moment. The two upper corners, reached further
  // out, are undo (upper left) and hint (upper right).
  const AXES = { R: 0, D: 90, L: 180, U: -90 }, CORNERS = { UL: -135, UR: -45 };
  const gap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  function zoneOf(x, y, cone = 30, cornerCone = 12) {
    const m = Math.hypot(x, y); if (m < 1e-9) return null;
    const a = Math.atan2(y, x) * 180 / Math.PI;
    for (const [dir, axis] of Object.entries(AXES)) if (gap(a, axis) <= cone) return { dir, along: dir === 'R' ? x : dir === 'L' ? -x : dir === 'D' ? y : -y, corner: false };
    for (const [dir, axis] of Object.entries(CORNERS)) if (gap(a, axis) <= cornerCone) return { dir, along: m, corner: true };
    return null;
  }
  function gesture({ hold = 500, fire = .5, rest = .3, corner = .8, rise = 1500, lost = 300, follow = 6000, cone = 30, cornerCone = 12 } = {}) {
    let phase = 'spent', reason = 'start', dir = null, since = 0, leftAt = -Infinity, last = null, missing = null;
    let offset = { x: 0, y: 0 }, point = null, shown = { dir: null, value: 0 }, fired = null;
    const threshold = z => z.corner ? corner : fire;
    function sample(t, p) {
      const dt = last === null ? 0 : clamp(t - last, 0, 120), out = [];
      last = t;
      if (!p) {
        if (missing === null) missing = t;
        if (t - missing >= lost) {
          if (phase !== 'spent') { phase = 'spent'; reason = 'lost'; dir = null; fired = null; }
          point = null;
        }
        shown = phase === 'spent' && fired ? { dir: fired, value: 1 } : phase === 'build' ? shown : { dir: null, value: 0 };
        return out;
      }
      missing = null;
      const q = { x: p.x - offset.x, y: p.y - offset.y }, m = Math.hypot(q.x, q.y);
      point = q;
      if (phase === 'spent') {
        if (m <= rest) { phase = 'armed'; reason = null; leftAt = t; fired = null; }
        else { shown = fired ? { dir: fired, value: 1 } : { dir: null, value: 0 }; return out; }
      }
      if (phase === 'build') {
        const z = zoneOf(q.x, q.y, cone + 8, cornerCone + 6);
        if (z && z.dir === dir && z.along >= threshold(z) * .8) {
          if (t - since >= hold) { phase = 'spent'; reason = 'fired'; fired = dir; out.push({ dir, corner: !!CORNERS[dir] }); shown = { dir, value: 1 }; dir = null; return out; }
          shown = { dir, value: .5 + .5 * (t - since) / hold }; return out;
        }
        phase = 'armed'; dir = null;
      }
      // Armed.
      if (m <= rest) {
        leftAt = t;
        // At rest, the rest itself follows a slow change of posture.
        const k = 1 - Math.exp(-dt / follow); offset = { x: offset.x + (p.x - offset.x) * k, y: offset.y + (p.y - offset.y) * k };
        shown = { dir: null, value: 0 }; return out;
      }
      const z = zoneOf(q.x, q.y, cone, cornerCone);
      if (!z) { shown = { dir: null, value: 0 }; return out; }
      const need = threshold(z);
      if (z.along >= need) {
        if (t - leftAt <= rise) { phase = 'build'; dir = z.dir; since = t; shown = { dir, value: .5 }; }
        else { phase = 'spent'; reason = 'drift'; fired = null; shown = { dir: null, value: 0 }; }
        return out;
      }
      shown = { dir: z.dir, value: .5 * clamp((z.along - rest) / (need - rest), 0, 1) };
      return out;
    }
    return {
      sample,
      get phase() { return phase; }, get reason() { return reason; }, get point() { return point && { ...point }; }, get offset() { return { ...offset }; },
      get shown() { return { ...shown }; },
      set hold(v) { hold = v; }, get hold() { return hold; },
      get settings() { return { hold, fire, rest, corner, rise, lost, follow, cone, cornerCone }; },
      // A new board or a return from a hidden page: wait for the head to come
      // back to rest before the next tip. A new calibration also forgets the
      // followed posture.
      reset(fresh = false) { phase = 'spent'; reason = 'start'; dir = null; fired = null; last = null; missing = null; if (fresh) offset = { x: 0, y: 0 }; shown = { dir: null, value: 0 }; }
    };
  }
  return { clamp, oneEuro, dwell, MESH, headPose, landmarkPose, irisOffset, lookAngles, SPOTS, headCalibration, headMap, eyesCalibration, eyesMap, recentre, stillness, validCalibration, current, headPoint, zoneOf, gesture };
});
