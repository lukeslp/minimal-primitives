/* Noon: the twenty boards of the campaign, in order, by id (2026-11-17). By Luke Steuber.
   This is the game as taught; after its last board the game is finished, and Next offers New Game+, which deals
   the other thirty boards at random (noon.js). boards.js keeps all fifty, as development/search.cjs writes and
   proves them, so every saved board and finished mark stays valid; only these twenty count.
   The twelve teaching pictures come first, as drawn. Then a short climb of eight (two, three and three from the three tiers): area never
   goes down, and within a size the sweeps of line logic never drop. Tier 1: n13 (5 x 5, three sweeps), n17
   (6 x 5, three). Tier 2: n25 (6 x 6, three), n31 and n27 (7 x 6, three then four). Tier 3: n40 and n38 (8 x 6,
   four then six, the deepest chain of deductions in the game) and n47 (9 x 6, the largest size), the finale.
   The thirty left out add no rule; each press waits for its clock, so they wait in New Game+. */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.NoonCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'n01', 'n02', 'n03', 'n04', 'n05', 'n06', 'n07', 'n08', 'n09', 'n10', 'n11', 'n12',
  'n13', 'n17', 'n25', 'n31', 'n27', 'n40', 'n38', 'n47'
]);
