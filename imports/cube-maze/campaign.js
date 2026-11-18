/* Cube Maze: the twenty-five boards of the campaign, in order, by id. Luke Steuber.
   boards.js keeps all fifty, as development/search.cjs writes and proves them, so every saved board and
   solved mark stays valid; the page plays and counts only these. cm01 to cm09 come first, as published:
   the tip, the turn, the 3×3×3 cube and, from cm09, both verbs in every shortest answer. Then sixteen of the
   other forty-one in a steady climb by the structural difficulty of development/campaign.md (par + turns +
   switches + pieces that matter / 2 + lures / 5), from 10.1 to 16.2, never falling, par 5 then 6 then 7:
   cm10, cm11 and cm12, the rest of the first twelve, stand where their difficulty puts them, and cm50, the
   hardest board, closes the campaign. No two kept boards share par, piece count and turns within half a point
   of difficulty. The other twenty-five come back as New Game+ once the campaign is finished,
   at random, each once before any repeats; they are not campaign progress. */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.CubeMazeCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'cm01', 'cm02', 'cm03', 'cm04', 'cm05', 'cm06', 'cm07', 'cm08', 'cm09',
  'cm19', 'cm21', 'cm24', 'cm10', 'cm29', 'cm11',
  'cm31', 'cm33', 'cm35', 'cm36', 'cm12',
  'cm41', 'cm43', 'cm44', 'cm48', 'cm50'
]);
