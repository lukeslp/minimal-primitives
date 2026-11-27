/* Balance's bounded seeded deals. No UI or storage; the engine proves each carve unique. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.BalanceEndless = factory(root.Balance);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  const WORK = 12000, TRIES = 3;
  const identity = p => E.VERSION + ':' + p.n + ':' + p.seed;
  function fromSeed(seed, n) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || ![6, 8].includes(n)) return null;
    const p = E.generate(seed, n, 'Normal', WORK);
    return p && !E.inspect(p, E.start(p)).solved ? p : null;
  }
  // Always try the campaign's largest size first: three seeds at 8x8, then three at 6x6.
  // Each attempt has its own work budget, so one click spends at most 6 * WORK units.
  function deal(seed, seen) {
    for (const n of [8, 6]) for (let k = 0; k < TRIES; k++, seed = (seed + 1) >>> 0) {
      const key = identity({ n, seed });
      if (seen.has(key)) continue;
      const p = fromSeed(seed, n);
      if (p) return p;
    }
    return null;
  }
  return { WORK, TRIES, identity, fromSeed, deal };
});
