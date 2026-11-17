/* Tilt: the thirty boards played, in order, by id. Luke Steuber.
   levels.js keeps all fifty, as development/generate.cjs writes and proves them, so every saved board and
   finished mark stays valid; the page plays and counts only these. The twelve original boards come first,
   in their own order. Then eighteen of the 38 additions, by par (8, 9, 10, 11, then 15), and within a par
   by lures, the moving tilts beside the shortest path that bring the exit no closer, then by the positions
   the marble can reach. In each par the kept boards are the ones furthest apart in lures, positions and
   dead ends, so no two are near copies (same par, lures within 2, positions within 4, dead share within
   0.1); l41, by far the hardest board, closes the campaign. The other twenty (l13 l14 l16 l17 l19 l20 l21
   l22 l24 l27 l28 l29 l32 l34 l35 l36 l43 l44 l48 l49) are each a near copy of a kept board or surplus at
   their par. After the thirty they come back at random, each once before any repeats. Tilt 3D plays this
   same list (its copy of this file must stay byte for byte equal). */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.TiltCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10', 'l11', 'l12',
  'l23', 'l15', 'l26', 'l25',
  'l37', 'l18', 'l33', 'l30',
  'l47', 'l45', 'l38', 'l46', 'l42', 'l40',
  'l31', 'l50', 'l39',
  'l41'
]);
