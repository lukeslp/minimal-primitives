/* Cast · why a hint's height is forced. By Luke Steuber. */
(function (root, factory) {
  const reason = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.CastEngine);
  if (typeof module === 'object' && module.exports) module.exports = reason;
  else root.CastReason = reason;
})(typeof globalThis === 'object' ? globalThis : this, function (E) {
  'use strict';
  // The stepwise solver of development/campaign.cjs (walls to a fixed point, then one tray step, then one
  // trial), which records the step that leaves each square a single height. The hint names that step:
  //   floor  the floor shows no shadow on this square, so it stays empty
  //   cap    the lower wall shadow caps this square at one cube, and the floor needs one
  //   wall   a wall shadow's height can stand only on this square in its row or column
  //   tray   the tray count leaves this square one height
  //   trial  another height here reaches a contradiction: a wall shadow out of reach, the tray count, or a
  //          square left with no height
  // Each reason carries `marks`: the walls ({side: 'left', i: row} or {side: 'right', i: column}), the tray
  // ({tray: true}) and squares ({r, c}) the page outlines.
  const copy = dom => dom.map(row => row.map(d => d.slice()));
  const single = d => d.length === 1;
  // Why a set of heights cannot stand, or null when it still can.
  function broken(b, dom) {
    const n = b.n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!dom[r][c].length) return {kind: 'square', marks: [{r, c}]};
    for (let r = 0; r < n; r++) if (!dom[r].some(d => d.includes(b.left[r]))) return {kind: 'wall', marks: [{side: 'left', i: r}]};
    for (let c = 0; c < n; c++) if (!dom.some(row => row[c].includes(b.right[c]))) return {kind: 'wall', marks: [{side: 'right', i: c}]};
    let lo = 0, hi = 0; for (const row of dom) for (const d of row) { lo += d[0]; hi += d[d.length - 1]; }
    return lo <= b.cubes && hi >= b.cubes ? null : {kind: 'tray', marks: [{tray: true}]};
  }
  function walls(b, dom, why) {
    const n = b.n;
    for (let changed = true; changed;) {
      changed = false;
      for (let r = 0; r < n; r++) { const k = []; for (let c = 0; c < n; c++) if (dom[r][c].includes(b.left[r])) k.push(c); if (k.length === 1 && dom[r][k[0]].length > 1) { dom[r][k[0]] = [b.left[r]]; changed = true; if (why) why(r, k[0], {kind: 'wall', marks: [{side: 'left', i: r}]}); } }
      for (let c = 0; c < n; c++) { const k = []; for (let r = 0; r < n; r++) if (dom[r][c].includes(b.right[c])) k.push(r); if (k.length === 1 && dom[k[0]][c].length > 1) { dom[k[0]][c] = [b.right[c]]; changed = true; if (why) why(k[0], c, {kind: 'wall', marks: [{side: 'right', i: c}]}); } }
      if (broken(b, dom)) return;
    }
  }
  function tray(b, dom, why) {
    const n = b.n; let lo = 0, hi = 0, changed = false;
    for (const row of dom) for (const d of row) { lo += d[0]; hi += d[d.length - 1]; }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const d = dom[r][c], mn = b.cubes - (hi - d[d.length - 1]), mx = b.cubes - (lo - d[0]), f = d.filter(v => v >= mn && v <= mx);
      if (f.length !== d.length) { dom[r][c] = f; changed = true; if (why && single(f)) why(r, c, {kind: 'tray', marks: [{tray: true}]}); }
    }
    return changed;
  }
  // Walls and tray until nothing changes; returns what broke, or null.
  function settle(b, dom) {
    for (;;) { walls(b, dom); let x = broken(b, dom); if (x) return x; if (!tray(b, dom)) return null; x = broken(b, dom); if (x) return x; }
  }
  // Every square in the order the solver pins it, each with its reason.
  function steps(b) {
    const n = b.n, out = [], seen = new Set();
    const why = (r, c, reason) => { const k = r * n + c; if (seen.has(k)) return; seen.add(k); out.push({r, c, to: dom[r][c][0], reason}); };
    const dom = b.plan.map((row, r) => row.map((p, c) => { const cap = Math.min(b.left[r], b.right[c]); return p ? Array.from({length: cap}, (_, i) => i + 1) : [0]; }));
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!b.plan[r][c]) why(r, c, {kind: 'floor', marks: [{r, c, floor: true}]});
      else if (single(dom[r][c])) why(r, c, {kind: 'cap', marks: [b.left[r] <= b.right[c] ? {side: 'left', i: r} : null, b.right[c] <= b.left[r] ? {side: 'right', i: c} : null].filter(Boolean)});
    }
    const done = () => dom.every(row => row.every(single));
    for (let guard = 0; guard < 400 && !done(); guard++) {
      walls(b, dom, why);
      if (done()) break;
      if (tray(b, dom, why)) continue;
      let found = false;
      for (let r = 0; r < n && !found; r++) for (let c = 0; c < n && !found; c++) if (dom[r][c].length > 1) for (const v of dom[r][c]) {
        const trial = copy(dom); trial[r][c] = [v];
        const x = settle(b, trial);
        if (x) { dom[r][c] = dom[r][c].filter(y => y !== v); found = true; if (single(dom[r][c])) why(r, c, {kind: 'trial', tried: v, broke: x.kind, marks: x.marks}); break; }
      }
      if (!found) break;
    }
    return out;
  }
  // The hint: the first square, in the solver's order, whose stack differs from the answer, with its reason.
  // A square the stepwise solver never pins falls back to the exact solver's answer with no reason.
  function hint(b, h) {
    const {count, solution} = E.solve(b, 2);
    if (count !== 1) return null;
    for (const s of steps(b)) if (h[s.r][s.c] !== solution[s.r][s.c]) return {r: s.r, c: s.c, to: solution[s.r][s.c], reason: s.reason};
    const plain = E.hint(b, h);
    return plain && {...plain, reason: null};
  }
  // The reason in words, for the live region.
  function words(b, x) {
    const r = x && x.reason;
    if (!r) return '';
    const wall = m => m.side === 'left' ? `Row ${m.i + 1}’s shadow on the left wall` : `Column ${m.i + 1}’s shadow on the right wall`;
    const w = r.marks.find(m => m.side);
    if (r.kind === 'floor') return 'The floor shows no shadow there.';
    if (r.kind === 'cap') return `${wall(w)} is one cube high, so it caps this stack at one.`;
    if (r.kind === 'wall') return `${wall(w)} is ${x.to} high, and only this square can reach it.`;
    if (r.kind === 'tray') return 'The cubes in the tray leave this one height.';
    if (r.kind === 'trial') {
      const tried = `Height ${r.tried} here`;
      if (r.broke === 'wall') return `${tried} leaves ${wall(w).replace(/^R/, 'r').replace(/^C/, 'c')} out of reach, so it is ${x.to}.`;
      if (r.broke === 'tray') return `${tried} makes the tray count impossible, so it is ${x.to}.`;
      const s = r.marks[0];
      return `${tried} leaves row ${s.r + 1}, column ${s.c + 1} no height that fits, so it is ${x.to}.`;
    }
    return '';
  }
  return {steps, hint, words};
});
