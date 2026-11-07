/* Glyph rules. By Luke Steuber.
   A board is a square of n by n points (n is 2 or 3), numbered in reading
   order, and a figure: lines that each join two neighbouring points, across,
   down or corner to corner. A board's lines are written as pairs of point
   numbers, '01 13' for the top and right sides of the four-point square.
   The pen visits points. Set down on a point, it starts a stroke there; every
   point it then moves to is a visit, and the line from the point before is
   inked if it belongs to the figure and is not inked yet. Any other move is a
   miss: it inks nothing and still counts. The pen moves in straight lines, so
   a move between two points with a third between them passes that point and
   visits it. Lifting the pen is free, and setting it down where it rested
   carries on the stroke; set down anywhere else it starts a new stroke, one
   visit. The board is finished when every line is inked.
   The fewest visits that finish a figure follow from Euler (1736): each
   connected part of the lines left needs one stroke for every two points
   where an odd number of them meet, and at least one; every stroke costs its
   first point and one visit per line. A pen resting on a point of a part it
   could start from saves that part's first visit. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlyphEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const cache = new WeakMap();
  const rc = (n, p) => [Math.floor(p / n), p % n];
  // Two points are neighbours when they are one step apart across, down or diagonally.
  function neighbours(n, a, b) {
    const [ra, ca] = rc(n, a), [rb, cb] = rc(n, b);
    return a !== b && Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
  }
  // Every line the square allows: on four points six, on nine points twenty.
  function allLines(n) {
    const out = [];
    for (let a = 0; a < n * n; a++) for (let b = a + 1; b < n * n; b++) if (neighbours(n, a, b)) out.push([a, b]);
    return out;
  }
  // The points strictly between a and b on the straight line joining them.
  function between(n, a, b) {
    const [ra, ca] = rc(n, a), [rb, cb] = rc(n, b), dr = rb - ra, dc = cb - ca, steps = gcd(Math.abs(dr), Math.abs(dc)), out = [];
    for (let k = 1; k < steps; k++) out.push((ra + dr / steps * k) * n + ca + dc / steps * k);
    return out;
  }
  function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
  // The board's lines, their lookup and their count, kept once per board.
  function parse(board) {
    let B = cache.get(board);
    if (B) return B;
    const n = board.n, lines = board.lines.trim().split(/\s+/).map(s => [+s[0], +s[1]]), index = new Map();
    lines.forEach(([a, b], i) => index.set(a * 16 + b, i).set(b * 16 + a, i));
    B = { n, count: n * n, lines, index, E: lines.length, full: lines.length >= 31 ? -1 : (1 << lines.length) - 1 };
    cache.set(board, B); return B;
  }
  const lineOf = (board, a, b) => { const i = parse(board).index.get(a * 16 + b); return i === undefined ? -1 : i; };
  const start = () => ({ drawn: 0, last: -1, pen: false });
  const copy = s => ({ drawn: s.drawn, last: s.last, pen: s.pen });
  const solved = (board, s) => s.drawn === parse(board).full;
  // One point registered. Returns the state after it, what kind of move it
  // was, the line inked (or -1), and whether it was a visit:
  //   'same'   the pen is down and already there: nothing happens;
  //   'resume' the pen was lifted and is set down where it rested: free;
  //   'start'  the pen is set down anywhere else: a new stroke, one visit;
  //   'draw'   the pen moves along a figure line not yet inked: one visit;
  //   'miss'   any other move: an inked line again ('inked'), a line not in
  //            the figure ('outside'), or a jump to a point that is not a
  //            neighbour ('jump'): one visit, nothing inked.
  // A finished board lifts the pen.
  function step(board, s, q) {
    const B = parse(board);
    if (!Number.isInteger(q) || q < 0 || q >= B.count) return null;
    if (s.pen && q === s.last) return { state: copy(s), kind: 'same', line: -1, visit: 0 };
    if (!s.pen) {
      if (q === s.last) return { state: { drawn: s.drawn, last: q, pen: true }, kind: 'resume', line: -1, visit: 0 };
      return { state: { drawn: s.drawn, last: q, pen: true }, kind: 'start', line: -1, visit: 1 };
    }
    const i = neighbours(B.n, s.last, q) ? lineOf(board, s.last, q) : -1;
    if (i >= 0 && !(s.drawn >> i & 1)) {
      const drawn = s.drawn | 1 << i;
      return { state: { drawn, last: q, pen: drawn !== B.full }, kind: 'draw', line: i, visit: 1 };
    }
    const reason = !neighbours(B.n, s.last, q) ? 'jump' : i >= 0 ? 'inked' : 'outside';
    return { state: { drawn: s.drawn, last: q, pen: true }, kind: 'miss', reason, line: -1, visit: 1 };
  }
  // The points a registration of q visits in order: with the pen down, any
  // point the straight line from the pen passes, then q.
  function path(board, s, q) {
    const B = parse(board);
    return s.pen && s.last >= 0 && q !== s.last ? [...between(B.n, s.last, q), q] : [q];
  }
  const lift = s => ({ drawn: s.drawn, last: s.last, pen: false });
  // The fewest visits that finish the figure from here (see the note above).
  function remaining(board, drawn, last) {
    const B = parse(board), deg = new Array(B.count).fill(0), up = [...Array(B.count).keys()];
    const find = x => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
    let left = 0;
    B.lines.forEach(([a, b], i) => { if (!(drawn >> i & 1)) { left++; deg[a]++; deg[b]++; up[find(a)] = find(b); } });
    if (!left) return 0;
    const parts = new Map();
    const part = p => { const k = find(p); if (!parts.has(k)) parts.set(k, { lines: 0, odd: 0 }); return parts.get(k); };
    B.lines.forEach(([a], i) => { if (!(drawn >> i & 1)) part(a).lines++; });
    for (let p = 0; p < B.count; p++) if (deg[p] % 2) part(p).odd++;
    let cost = 0;
    for (const c of parts.values()) cost += c.lines + Math.max(1, c.odd / 2);
    if (last >= 0 && deg[last] > 0) { const c = part(last); if (deg[last] % 2 || c.odd === 0) cost--; }
    return cost;
  }
  const par = board => remaining(board, 0, -1);
  // Every move worth making from here, each a single visit or a free resume,
  // with what it costs and leaves; the best come first. With the pen down a
  // point the straight line would pass on its way is not a single move, so
  // its start is offered instead (lift, then set down).
  const ORDER = { draw: 0, resume: 1, start: 2, miss: 3 };
  function options(board, s) {
    const B = parse(board), out = [];
    if (solved(board, s)) return out;
    for (let q = 0; q < B.count; q++) {
      if (s.pen && q !== s.last && !between(B.n, s.last, q).length) {
        const r = step(board, s, q);
        out.push({ point: q, kind: r.kind, lift: false, cost: r.visit, total: r.visit + remaining(board, r.state.drawn, r.state.last), state: r.state });
      }
      if (!s.pen || q !== s.last) {
        const r = step(board, lift(s), q);
        if (s.pen && r.kind === 'resume') continue;
        out.push({ point: q, kind: r.kind, lift: s.pen, cost: r.visit, total: r.visit + remaining(board, r.state.drawn, r.state.last), state: r.state });
      }
    }
    // Ties go to a move that inks, then a free resume, then a fresh start.
    return out.sort((a, b) => a.total - b.total || ORDER[a.kind] - ORDER[b.kind] || a.lift - b.lift || a.point - b.point);
  }
  // The next move of a fewest-visits finish from here.
  function hint(board, s) {
    const o = options(board, s);
    if (!o.length) return null;
    const best = o[0];
    return { point: best.point, kind: best.kind, lift: best.lift };
  }
  // The intended answer: the hints followed from the start, as the points
  // visited in order, each marked when it begins a new stroke.
  function answer(board) {
    let s = start(); const out = [];
    for (let guard = 0; !solved(board, s) && guard < 200; guard++) {
      const h = hint(board, s), r = step(board, h.lift ? lift(s) : s, h.point);
      if (r.visit) out.push({ point: h.point, stroke: r.kind === 'start' });
      s = r.state;
    }
    return out;
  }
  // The points where an odd number of the figure's lines meet.
  function oddPoints(board) {
    const B = parse(board), deg = new Array(B.count).fill(0);
    for (const [a, b] of B.lines) { deg[a]++; deg[b]++; }
    return deg.map((d, p) => d % 2 ? p : -1).filter(p => p >= 0);
  }
  return { neighbours, allLines, between, parse, lineOf, start, copy, solved, step, path, lift, remaining, par, options, hint, answer, oddPoints, rc };
});
