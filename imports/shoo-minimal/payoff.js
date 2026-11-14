/* Shoo (Minimal): color for the finish. Play stays paper and ink; color
   arrives only with the solve, and it belongs to the bees: the solved board
   becomes honeycomb, deep amber by the hive the last bee entered to pale
   honey at the far edge, the hive goes dark brown with a lit door and its
   bees as honey dots, and the flowers turn pink. The colors are custom
   properties in shoo.css, with their own values for light and dark; this
   file says which of the three comb tones each cell takes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShooPayoff = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const TONES = 3;
  // A cell d steps from the hive, on a board whose farthest cell is most steps away.
  const tone = (d, most) => Math.min(TONES - 1, Math.floor(TONES * d / (most + 1)));
  return { TONES, tone };
});
