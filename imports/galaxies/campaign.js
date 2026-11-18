/* Spiral Galaxies: the twenty-five boards of the campaign, in order, by id (2026-11-17). This is the game as
   taught; after its last board the game is finished, and New Game+ deals the other twenty-five boards of levels.js
   at random (those not yet solved first), then fresh generated boards (galaxies.js). levels.js keeps all fifty in
   play order (play-order.cjs), so every saved board, mark and finished board stays valid; only these count.
   Every rule's first board stays: rotation (g02), connectivity (g09) and the bridge (g33, on a 7x8 already
   played). Intro keeps nine of its ten, Developing eleven of its twenty and Advanced five of its twenty: three on
   7x8, then g40 and g45, two 8x8 boards that use the bridge again, as the finale. The order is play order with
   boards left out, so area never goes down, each tier opens easier than the last ended, deeper steps rise
   inside each size, and any four boards in a row show four kinds of sky. Left out, each repeating a rule
   already taught at a size already played: g08 g14 g11 g17 g16 g20 g22 g25 g24 g27 g32 g34, and the 8x8 tail
   g37 g47 g46 g41 g43 g50 g48 g44 g49 g38 g36 g39 g42 (the deepest late logic, with no new rule). test-order.cjs
   checks all of this. Luke Steuber. */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.GalaxiesCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'g01', 'g03', 'g02', 'g04', 'g05', 'g06', 'g07', 'g09', 'g10',
  'g13', 'g12', 'g15', 'g18', 'g19', 'g21', 'g26', 'g23', 'g30', 'g28', 'g29',
  'g33', 'g31', 'g35',
  'g40', 'g45'
]);
