/* Glance · looking, holding and choosing. By Luke Steuber.
   Pure parts of the input, shared by the page and its tests: a one-euro
   filter, the look-and-hold machine, the features read from face landmarks,
   and the calibrations that turn them into a point on the page. No camera,
   page or clock lives here; every call is given its time.
   Its body is generated from tools/input/gaze-core.js by tools/sync-gaze.py;
   edit the core or tools/input/extras/, never this file. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlanceGaze = api;
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
  // Head yaw and pitch in radians. From the facial transformation matrix
  // (column-major, as MediaPipe gives it): the face's forward axis is its
  // third column. Without a matrix, from the nose against the cheeks and
  // brow, which gives the same signs in image terms.
  function headPose(landmarks, matrix, aspect = 4 / 3) {
    if (matrix && matrix.data && matrix.data.length === 16) {
      const m = matrix.data, fx = m[8], fy = m[9], fz = m[10];
      return { yaw: Math.atan2(fx, fz), pitch: Math.atan2(fy, Math.hypot(fx, fz)) };
    }
    return landmarkPose(landmarks, aspect);
  }
  const P = (lm, i, aspect) => ({ x: lm[i].x * aspect, y: lm[i].y });
  // On a real face looking straight ahead the nose tip sits about 57.5 percent
  // of the way from the brow landmark to the chin, so a still head reads as a
  // 5 to 18 degree nod (the Eye Gaze review). Every use here is relative to a
  // calibrated rest, which takes that offset out, and the asin's slope 18
  // degrees off level differs by under 5 percent, so the reading stays halfway
  // (NOSE_REST): moving it would change every saved eyes calibration for no
  // gain in play.
  const NOSE_REST = .5;
  function landmarkPose(lm, aspect = 4 / 3) {
    const n = P(lm, MESH.nose, aspect), r = P(lm, MESH.cheekR, aspect), l = P(lm, MESH.cheekL, aspect), top = P(lm, MESH.forehead, aspect), chin = P(lm, MESH.chin, aspect);
    const width = Math.hypot(l.x - r.x, l.y - r.y) || 1, height = Math.hypot(chin.x - top.x, chin.y - top.y) || 1;
    return { yaw: Math.asin(clamp((n.x - (l.x + r.x) / 2) / (width * .5), -1, 1)), pitch: Math.asin(clamp((n.y - (top.y + (chin.y - top.y) * NOSE_REST)) / (height * .5), -1, 1)) };
  }
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
  // Head: the centre sets the resting pose, each edge the comfortable turn
  // that way; between them the page follows the turn in proportion. A side
  // turned too little to measure borrows the other side's reach.
  function headCalibration(poses) {
    const [c, l, r, t, b] = poses, min = .035;
    const side = (lo, hi, key) => {
      let a = lo[key] - c[key], z = hi[key] - c[key];
      if (Math.abs(a) < min && Math.abs(z) < min) return null;
      if (Math.abs(a) < min || Math.sign(a) === Math.sign(z)) a = -z;
      if (Math.abs(z) < min) z = -a;
      return { lo: a, hi: z };
    };
    const yaw = side(l, r, 'yaw'), pitch = side(t, b, 'pitch');
    if (!yaw || !pitch) return null;
    return { kind: 'head', centre: { yaw: c.yaw, pitch: c.pitch }, yaw, pitch };
  }
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
  // A fresh start keeps the reach and moves only the rest to where the
  // player sits now.
  function recentre(cal, rest) {
    if (cal.kind === 'head') return { ...cal, centre: { yaw: rest.yaw, pitch: rest.pitch } };
    return { ...cal, u: { k: cal.u.k, b: -cal.u.k * rest.ax }, v: { k: cal.v.k, b: -cal.v.k * rest.ay } };
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
  function validCalibration(c) {
    const num = v => typeof v === 'number' && Number.isFinite(v);
    if (!c || typeof c !== 'object') return false;
    if (c.kind === 'head') return num(c.centre?.yaw) && num(c.centre?.pitch) && ['yaw', 'pitch'].every(k => num(c[k]?.lo) && num(c[k]?.hi) && c[k].lo * c[k].hi < 0);
    if (c.kind === 'eyes') return ['u', 'v'].every(k => num(c[k]?.k) && num(c[k]?.b) && Math.abs(c[k].k) >= .2);
    // An eye tracker's one-dot correction for the window's place on the screen.
    if (c.kind === 'tracker') return num(c.dx) && num(c.dy);
    return false;
  }
  return { clamp, oneEuro, dwell, MESH, headPose, landmarkPose, irisOffset, lookAngles, SPOTS, headCalibration, headMap, eyesCalibration, eyesMap, recentre, stillness, validCalibration, current };
});
