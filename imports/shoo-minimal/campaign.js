/* Shoo (Minimal): the twenty-five boards of the campaign, in order, by id. This
   is the game as taught; after its last board the game is finished, and New
   Game+ deals the other fifty-five boards at random (shoo.js). boards.js keeps
   all eighty, as development/search.cjs writes and proves them, so every saved
   board, position and completion stays valid.
   Six teaching boards (one tap; a flower; a wall; two hives; the bee in front
   goes first and a tapped bee dodges; the edge), then nineteen by par from
   4 to 13, never dropping, no shape twice in a row, and boards a naive player
   cannot solve at par wherever a par has one (a naive player always taps
   where the bees end up nearest home in sum); within a par, by how far it
   falls short (stuck counts last), then by the positions reachable within
   par. Two boards have gaps: s29 first, whose answer never pushes a bee
   into its gap, then s53. The finale is s63, at par 13. The five boards at
   par 14 to 16 that once ended the campaign (s67 s59 s76 s70 s78) need long
   lookahead and no new idea, so they joined New Game+ (2026-11-17). */
(function (root, order) {
  if (typeof module === 'object' && module.exports) module.exports = order;
  else root.ShooCampaign = order;
})(typeof globalThis === 'object' ? globalThis : this, [
  's01', 's03', 's04', 's10', 's05', 's07',
  's14', 's17', 's21', 's22', 's25', 's27', 's31', 's29', 's34', 's32', 's37', 's39',
  's51', 's52', 's61', 's53', 's54', 's64', 's63'
]);
