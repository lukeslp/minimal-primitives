/* Glyph · corners from a moving look. By Luke Steuber.
   Pure parts of the drawing input, shared by the page and its tests: which
   point zones a moving look (or finger) enters, in order, and when a look
   rests off the points long enough to lift the pen. As in EdgeWrite, only the
   order of the points entered matters, never the exact path. No page or
   clock lives here; every call is given its time and the zones.
   A zone is { id, x, y, r } in page pixels. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlyphTrace = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  // How far along the straight step from (x0, y0) to (x1, y1), from 0 to 1,
  // the step first comes within the zone's radius; null if it never does.
  function contact(x0, y0, x1, y1, z) {
    const dx = x1 - x0, dy = y1 - y0, fx = x0 - z.x, fy = y0 - z.y, a = dx * dx + dy * dy, c = fx * fx + fy * fy - z.r * z.r;
    if (c <= 0) return 0;
    if (a === 0) return null;
    const b = 2 * (fx * dx + fy * dy), disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }
  // Entering zones. Each sample is joined to the one before by a straight
  // step, so a quick look that crosses a zone between two readings still
  // enters it, and zones crossed in one step are entered in the order the
  // step meets them. A zone counts as entered when the look comes within its
  // radius, and as left only once the look is more than `dead` pixels beyond
  // it, so jitter at a zone's edge never enters it twice. A look lost for less
  // than `lost` milliseconds is joined across the gap; after a longer loss,
  // or after `place`, the zone the look lands in is not entered (it must be
  // left and entered again).
  function tracer({ dead = 10, lost = 300 } = {}) {
    let prev = null, inside = null, seen = null, gap = null;
    const find = (zones, id) => zones.find(z => z.id === id) || null;
    function settle(x, y, zones, last) {
      if (last && dist(x, y, last.x, last.y) <= last.r + dead) return last.id;
      const held = inside === null ? null : find(zones, inside);
      if (!last && held && dist(x, y, held.x, held.y) <= held.r + dead) return held.id;
      const z = zones.find(z => dist(x, y, z.x, z.y) <= z.r);
      return z ? z.id : null;
    }
    return {
      sample(t, x, y, zones) {
        const entered = [];
        if (x === null || x === undefined) {
          if (gap === null) gap = seen !== null ? seen : t;
          if (t - gap >= lost) { prev = null; inside = null; }
          return entered;
        }
        seen = t; gap = null;
        let last = null;
        if (prev) {
          const met = [];
          for (const z of zones) { if (z.id === inside) continue; const s = contact(prev.x, prev.y, x, y, z); if (s !== null) met.push([s, z]); }
          met.sort((a, b) => a[0] - b[0]);
          for (const [, z] of met) entered.push(z.id);
          if (met.length) last = met[met.length - 1][1];
        }
        inside = prev ? settle(x, y, zones, last) : (zones.find(z => dist(x, y, z.x, z.y) <= z.r) || { id: null }).id;
        prev = { x, y };
        return entered;
      },
      // Treat the look as already resting here: the zone under it is not entered.
      place(x, y, zones) { prev = { x, y }; seen = null; gap = null; const z = zones.find(z => dist(x, y, z.x, z.y) <= z.r); inside = z ? z.id : null; },
      reset() { prev = null; inside = null; seen = null; gap = null; },
      get inside() { return inside; },
      set dead(v) { dead = v; }
    };
  }
  // Resting: the look stays within `radius` pixels of the mean of where it
  // has been since the rest began, on open ground, for `time` milliseconds,
  // so jitter and a slow drift still count as resting. Fires once per rest;
  // moving further, onto a zone, or losing the look begins again.
  function rest({ time = 800, radius = 18 } = {}) {
    let anchor = null, sum = null, since = 0, done = false, progress = 0;
    const begin = (t, x, y) => { anchor = { x, y }; sum = { x, y, n: 1 }; since = t; progress = 0; done = false; };
    return {
      sample(t, x, y, open) {
        if (x === null || x === undefined || !open) { anchor = null; progress = 0; done = false; return false; }
        if (!anchor || dist(x, y, anchor.x, anchor.y) > radius) { begin(t, x, y); return false; }
        sum.x += x; sum.y += y; sum.n++; anchor = { x: sum.x / sum.n, y: sum.y / sum.n };
        if (done) return false;
        progress = Math.min(1, (t - since) / time);
        if (progress >= 1) { done = true; progress = 0; return true; }
        return false;
      },
      reset() { anchor = null; progress = 0; done = false; },
      get anchor() { return anchor && { ...anchor }; },
      get progress() { return done ? 0 : progress; },
      set time(v) { time = v; },
      set radius(v) { radius = v; }
    };
  }
  return { contact, tracer, rest };
});
