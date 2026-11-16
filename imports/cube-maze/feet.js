/* Cube Maze — Luke Steuber. The glass feet the cube stands on, and how it moves on them, shared by the page and its
   clearance test.

   These are the feet of the first build (release cube-maze-0aabc4a): four short round posts of frosted glass, one
   centred under each bottom corner of whichever face is down, 0.2 tall and 0.085 in radius, the same in the room on
   both board sizes. The corner rests on the middle of a foot's flat top, and the gap they leave under the base lets a
   marble that leaves by a spout facing down drop to the floor and roll out between them.

   A tip is a real roll, as it was then. The cube turns over its leading bottom edge, which stays on the two feet
   under it, through a quarter turn that starts slowly and gathers speed like a falling weight (θ = 0.3 r + 0.7 r²
   of a quarter, r the time up to the landing), so it lands heavily on the face it rolled onto. While it rolls, the
   pair of feet it lifts off sinks into the floor and a pair rises under the far corners as they come down, and from
   a fifth of the way through, cube and feet slide back together so that the cube settles where it started, on four
   feet, a quarter turned. Nothing ever goes below its pivot edge, which sits on the feet's tops, so a roll never
   enters a foot or comes near the floor.

   A lean tilts the cube on the feet on that side (or one corner's foot), about the same edge a roll turns over.

   A slice turned about a level axis dips below the base: by up to (√2 − 1)·h in the middle, more than the feet are
   tall, and at the very start of the turn its lowest edge is still over the two feet it stood on. So the whole cube
   rises with it: first just enough to keep that edge on top of those feet, then, past them, just enough to keep the
   swinging slice off the floor; it sets back down as the slice squares up. A slice turned about the upright axis
   slides across the feet's tops and lifts nothing.

   Coordinates are the resting cube's own, centre at the origin, base at y = −h, floor at y = −h − height. */
(function (root, factory) {
  const S = factory();
  if (typeof module === 'object' && module.exports) module.exports = S; else root.CubeMazeFeet = S;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const SEAT = 0.05, MARBLE = 0.08;
  // FOOT and FR of the first build.
  const HEIGHT = 0.2, WIDTH = 0.085;
  // CLEAR: how far a lifted turn keeps the glass off the floor. KEEP: how far it keeps the edge over a foot above it.
  const CLEAR = 0.04, KEEP = 0.01, SOFT = 0.02;
  // The roll: 470 ms in all, landing at 380 ms; the slide back to the middle starts a fifth of the way in.
  const ROLL_MS = 470, LAND_MS = 380, RECENTRE = 0.18;
  const ease = t => t * t * (3 - 2 * t), clamp01 = t => Math.max(0, Math.min(1, t));
  // h: half the glass edge; height: the base above the floor; width: a foot's radius; reach: how far the feet stand
  // out from the centre along each level axis; out: where the marble comes to rest at the finish, beyond the feet.
  function size(n) {
    const h = n / 2 - SEAT, reach = h + WIDTH;
    return { h, edge: 2 * h, height: HEIGHT, width: WIDTH, marble: MARBLE, clear: CLEAR, reach, out: reach + MARBLE + 0.24 };
  }
  const foot = (h, x, z, k = 1) => ({ corner: [x, z], r: WIDTH, k, top: k === 1 ? -h : -h - HEIGHT + k * HEIGHT, bottom: -h - HEIGHT });
  // The four feet at rest, one centred under each bottom corner.
  function all(n) { const { h } = size(n), out = []; for (const sz of [-1, 1]) for (const sx of [-1, 1]) out.push(foot(h, sx * h, sz * h)); return out; }
  // Signed distance from a point to a foot (negative inside): an upright round post from the floor to its top.
  function distance(p, f) {
    const d = Math.hypot(p[0] - f.corner[0], p[2] - f.corner[1]) - f.r, dy = Math.max(p[1] - f.top, f.bottom - p[1]);
    return Math.hypot(Math.max(d, 0), Math.max(dy, 0)) + Math.min(Math.max(d, dy), 0);
  }
  // How far below its centre's level a square of half side h reaches, turned by t, beyond its own half side.
  const dip = (h, t) => h * (Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)) - 1);
  const smax = (a, b, k) => Math.max(a, b) + Math.max(k - Math.abs(a - b), 0) ** 2 / (4 * k);
  const smin = (a, b, k) => Math.min(a, b) - Math.max(k - Math.abs(a - b), 0) ** 2 / (4 * k);
  // Where a turning slice's lowest edge leaves the feet it stood on: the turn at which that edge, swinging in from the
  // corner, passes the feet's inner rims (h − r out from the axis), and its dip there.
  function overFeet(n) { const { h } = size(n), u = Math.acos((1 - WIDTH / h) / Math.SQRT2) - Math.PI / 4; return { u, dip: dip(h, u) }; }
  // The lift for a slice turned t about a level axis. While the slice's lowest edge is over its feet the cube rises a
  // quarter faster than the edge dips, so the edge stays above their tops, up to KEEP past the dip at which it leaves
  // them; it holds there until the swing needs more to stay CLEAR of the floor, and then follows that. It rises with
  // the turn to 45 degrees and falls back the same way, and the joins are rounded.
  function turnLift(n, t) {
    const { h } = size(n); let u = Math.abs(t) % (Math.PI / 2); u = Math.min(u, Math.PI / 2 - u);
    const D = dip(h, u), on = smin(1.25 * D, overFeet(n).dip + KEEP, SOFT), off = D - (HEIGHT - CLEAR);
    return Math.max(0, smax(on, off, SOFT));
  }
  // A roll at progress t (0 to 1) toward a level direction, starting from a lean of th0 over the same edge: the angle
  // turned about the leading bottom edge, and how far cube and feet have slid back toward the middle (0 to 1; at the
  // end the slide is 2h, a whole face's width, back against the roll).
  function rollPose(n, t, th0 = 0) {
    const r = clamp01(t * ROLL_MS / LAND_MS), theta = th0 + (Math.PI / 2 - th0) * (0.3 * r + 0.7 * r * r), recentre = ease(clamp01((t - RECENTRE) / (1 - RECENTRE)));
    return { theta, recentre, shift: -2 * size(n).h * recentre };
  }
  // The feet during a roll toward the level direction w = [wx, 0, wz]: the pair under the leading edge holds it, the pair
  // the cube lifts off sinks into the floor, and a pair rises under the far corners as they come down; all slide back
  // with the cube. Without a roll, the four at rest. Each has its share k (0 to 1) of the full height.
  function feetAt(n, roll) {
    if (!roll) return all(n);
    const { h } = size(n), { theta, recentre, th0 = 0 } = roll, wx = roll.w[0], wz = roll.w[2], shift = -2 * h * recentre;
    const sink = 1 - clamp01((theta - th0) / 0.7), rise = clamp01((theta - 1.15) / 0.42), out = [];
    for (const [along, k] of [[h, 1], [-h, sink], [3 * h, rise]]) for (const s of [h, -h]) out.push(foot(h, wx * (along + shift) - wz * s, wz * (along + shift) + wx * s, k));
    return out;
  }
  // The point a lean toward the level direction (wx, wz) tilts about: the base's furthest point that way, a corner,
  // or anywhere along the bottom edge when the lean is square to it (the edge is then the axis). A roll turns over the
  // same edge.
  function leanPivot(n, wx, wz) {
    const { h } = size(n), s = v => Math.abs(v) < 1e-9 ? 0 : Math.sign(v);
    return [s(wx) * h, -h, s(wz) * h];
  }
  return { size, all, distance, dip, overFeet, turnLift, rollPose, feetAt, leanPivot, SEAT, MARBLE, ROLL_MS, LAND_MS };
});
