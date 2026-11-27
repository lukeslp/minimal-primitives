/* Cast: the twenty-five boards played, in order, by id. By Luke Steuber.
   boards.js keeps all fifty, as development/campaign.cjs writes and proves them, so every saved board and
   finished mark stays valid; the page plays and counts only these. The minimal Cast's ten come first, in
   their own order. Then fifteen of the forty additions by rung of the deduction ladder and trial steps: two
   that need only the walls and the tray, four with one trial, five with two, two with three, one with four,
   and c50, the only board with five, whose finish is the end. Within a step the boards run from the smaller
   room and tray up, except where the tallest stacks would stand on the same side as on the board before (the
   side still changes from one board to the next), and an outline returns at most once, eight or more boards
   on. No two kept boards are near copies (the same room, rung and trial steps, with cubes and the slack below
   the walls each within one). On November 17, 2026 the campaign went from thirty to twenty-five: c13, c12,
   c11, c43 and c48 left, the five closest to a kept board of their step (c16, the minimal Cast's c09, c16,
   c36 and c41) by room, cubes and slack, among the drops that keep the side and outline rules. On November 19,
   2026 c25 left too: its floor outline, the pinwheel, drew a swastika. c27, its near twin (the same room, rung
   and trial steps, 24 cubes, and the only left-out board of that step that is not a near copy of a kept one),
   took its place as board 21. Left out: c11 c12 c13 c14 c15 c23 c24 c25 c26 c28 c30 c31 c32 c33 c34 c37 c39 c40
   c43 c44 c45 c46 c47 c48 c49. */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.CastCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  'c01', 'c02', 'c04', 'c03', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10',
  'c16', 'c17',
  'c18', 'c42', 'c19', 'c38',
  'c22', 'c21', 'c20', 'c35', 'c27',
  'c36', 'c29',
  'c41',
  'c50'
]);
