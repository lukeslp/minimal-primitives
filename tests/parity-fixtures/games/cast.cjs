'use strict';
// Cast: an SVG board with keyboard focus on the board itself, a Board picker
// (#board-select) and no theme setting. A board keeps one save at a time, so
// "other boards" means the finished first board carried into the second.
module.exports={
  storageKey:'cast.v1',
  creditsBoard:true,
  async keyMove(f,{tick,pageOf}){
    await f.locator('#board').focus();await pageOf(f).keyboard.press('Enter');
    await tick(pageOf(f),800);
  },
  async touch(f,{tick,tapAt,pageOf}){
    await tapAt(f,'#board .square');
    await tick(pageOf(f),800);
  },
  history:s=>s.history,
  position:s=>s.heights,
  async nextBoard(f,{tick,solve}){
    await solve(f,'cast');
    await f.locator('#next-btn').click();await tick(f.page(),1200);
  },
  otherBoards(state,assert){
    assert(state.finished.length>=1,'first board finished');
    assert(!state.finished.includes(state.board),'now on an unfinished board');
  },
};
