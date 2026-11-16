'use strict';
// Tangles (game-riffs loop/) draws its board as one SVG (#board) and takes every turn through it: Enter turns the
// focused tile, which starts as the middle one, and a tap turns the tile under it. Board L01 is closed by turning
// tile 4, so a turn of the middle tile (3) leaves it open. Hint marks a tile on the first press and turns it on the
// second; the base solve presses Hint until Next shows.
const MIDDLE=3;
module.exports={
  storageKey:'loop.v1',
  creditsBoard:true,
  async keyMove(f,{tick,pageOf}){
    await f.locator('#board').focus();await pageOf(f).keyboard.press('Enter');
    await tick(pageOf(f),800);
  },
  async touch(f,{tick,tapAt,pageOf}){
    await tapAt(f,'#board .tile-hit',MIDDLE);
    await tick(pageOf(f),800);
  },
  // A lock is a player's mark on a tile they are sure of: kept per board, outside the undo list.
  async locks(f,{tick,pageOf}){
    await f.locator('#board').focus();await pageOf(f).keyboard.press('ArrowRight');await pageOf(f).keyboard.press('l');
    await tick(pageOf(f),400);
  },
  async nextBoard(f,{tick,solve}){
    await solve(f,'tangles');
    await f.locator('#next-btn').click();await tick(f.page(),1200);
  },
  history:s=>s.history,
  position:s=>s.rots,
  otherBoards(state,assert){
    assert(state.finished.includes('L01'),'first board finished');
    assert.equal(state.board,'L02');
    assert(state.reached>=1,'second board opened for good');
  },
};
