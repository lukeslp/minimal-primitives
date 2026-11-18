/* Horologist: the twenty-five plates of the campaign, in order, by id. Luke Steuber.
   boards.js keeps all fifty in the play order of November 16, 2026, so every saved plate and solved mark stays valid;
   the page plays and counts only these, in that same order. All fourteen hand-made plates are kept: the eight
   teaching plates open it, and p09 to p14 bring the large wheel (p10), three clock sizes (p14) and the widest original
   searches. Nothing new arrives after p14, so eleven of the 36 generated plates join them in a steady climb by par
   (fewest loose wheels), then by the connected wheel sets the search visits: par 4 p21, p19, p15; par 5 p27, then
   p10, p31, p09, p14, p11; par 6 p48, p50, p43, p49, p39, p13, p12 and p46, the widest search in the game, last. No two
   neighbors share their clocks and wheel stock. The other twenty-five come back after the finish,
   at random, each once before any repeats; they are not campaign progress. */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.HorologistCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08',
  'p21', 'p19', 'p15',
  'p27', 'p10', 'p31', 'p09', 'p14', 'p11',
  'p48', 'p50', 'p43', 'p49', 'p39', 'p13', 'p12', 'p46'
]);
