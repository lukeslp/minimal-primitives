/* Folding: the twenty-five boards of the campaign, in order, by id. Luke Steuber.
   levels.js keeps all fifty, as build-levels.cjs writes them, so every saved sheet and finished mark stays valid;
   the page plays and counts only these. The eighteen boards of the original release come first, as published:
   each of their five chapters brings one idea (land it, turn it back, in order, make room, all together). Nothing
   new arrives after them, so seven of the thirty-two later boards follow, one fold more per chapter and, by the
   states a full search reaches up to par, never easier than the board before: Carry through f19 (243 states) and
   f20 (375); Clear a path f28 (789) and f30 (1,857); Final turns f39 (3,901), f40 (12,964) and f50 (22,779), a
   36-cell sheet, the largest. Once all twenty-five are finished, New Game+ deals the other twenty-five first, at
   random, each once; after them it builds new boards at the chosen difficulty, as before. They are never campaign
   progress. */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.FoldCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10', 'f11', 'f12', 'f13', 'f14', 'f15', 'f16', 'f17', 'f18',
  'f19', 'f20',
  'f28', 'f30',
  'f39', 'f40', 'f50'
]);
