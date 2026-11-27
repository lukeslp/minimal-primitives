/* Weaves · endless cloths, one for each seed. By Luke Steuber. */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(require('./engine.js'));
  else root.WeaveGenerate = make(root.WeaveEngine);
})(typeof globalThis === 'object' ? globalThis : this, function (E) {
  'use strict';
  // The carve of development/search.cjs, run from a seed: a random valid
  // cloth, then its knots taken away in a random order while the engine's
  // solver still finds exactly one answer (E.solve(board, 2).count === 1). The seed (a 32-bit unsigned
  // integer) picks the size, from 6 x 6 to 8 x 8, the cloth and the order, so
  // the same seed always gives the same board. A cloth stays at most eight
  // warps wide, so its crossings keep 44 pixels apart on a phone.
  // mulberry32, the stream the campaign search uses.
  const stream = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const valid = seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF;
  // A board id is g and the seed in decimal, with no leading zeros.
  const id = seed => 'g' + seed;
  const seedOf = text => typeof text === 'string' && /^g(0|[1-9]\d{0,9})$/.test(text) && valid(+text.slice(1)) ? +text.slice(1) : null;
  function cloth(seed) {
    if (!valid(seed)) throw Error('Invalid seed');
    const rand = stream(seed), mix = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const rows = 6 + Math.floor(rand() * 3), cols = 6 + Math.floor(rand() * 3);
    const g = Array.from({ length: rows }, () => Array(cols).fill(0));
    const go = k => {
      if (k === rows * cols) return true;
      const r = Math.floor(k / cols), c = k % cols;
      for (const v of mix([1, -1])) {
        g[r][c] = v;
        if (c >= 2 && g[r][c - 1] === v && g[r][c - 2] === v) continue;
        if (r >= 2 && g[r - 1][c] === v && g[r - 2][c] === v) continue;
        if (go(k + 1)) return true;
      }
      return false;
    };
    go(0);
    const all = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([r, c, g[r][c]]);
    // Two bounds keep a phone's carve to a few milliseconds: a knot whose loss the
    // two sight rules still settle (E.propagate fills the cloth) needs no search,
    // and knots stop going once three in ten are left, where the search grows.
    let pins = all.slice();
    const floor = Math.ceil(.3 * rows * cols);
    for (const p of mix(all.slice())) {
      if (pins.length <= floor) break;
      const trial = pins.filter(q => q !== p), b = { rows, cols, pins: trial };
      if (E.propagate(b).size === rows * cols || E.solve(b, 2).count === 1) pins = trial;
    }
    return { id: id(seed), seed, rows, cols, pins: pins.map(p => p.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
  }
  // A new seed for a new cloth.
  const fresh = () => globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
  return { version: 1, cloth, id, seedOf, fresh, valid };
});
