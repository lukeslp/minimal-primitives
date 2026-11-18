/* Tilt: the twenty-five boards played, in order, by id. Luke Steuber.
   levels.js keeps all fifty, as development/generate.cjs writes and proves them, so every saved board and
   finished mark stays valid; the page plays and counts only these. The twelve original boards come first,
   in their own order. Then thirteen of the 38 additions, by par (8, 9, 10, 11, then 15), and within a par
   by lures, the moving tilts beside the shortest path that bring the exit no closer, then by the positions
   the marble can reach. No two kept additions are near copies (same par, lures within 2, positions within 4,
   dead share within 0.1). On November 17, 2026 the campaign went from thirty to twenty-five: l46, l47, l26,
   l31 and l30 left, each the closer of the nearest pair at its par by lures, positions and dead share (l45,
   l42, l25, l39 and l18 stayed). l41, by far the hardest board, closes the campaign. The other twenty-five
   come back at random after the finish, each once before any repeats. Tilt 3D plays this same list (its copy
   of this file must stay byte for byte equal). */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.TiltCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10', 'l11', 'l12',
  'l23', 'l15', 'l25',
  'l37', 'l18', 'l33',
  'l45', 'l38', 'l42', 'l40',
  'l50', 'l39',
  'l41'
]);
