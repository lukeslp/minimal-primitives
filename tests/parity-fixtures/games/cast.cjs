'use strict';
// Cast (game-riffs cast-3d/) draws a lit room in a WebGL canvas (#scene) inside
// #board, which takes keyboard focus. A tap on a floor square adds a cube there;
// the game's own __cast3d.squarePoint reads where a square is on screen (read
// only, nothing is changed through it). A board keeps one save at a time, so
// "other boards" means the finished first board carried into the second.
async function offset(f){
  if(typeof f.frameElement!=='function')return {x:0,y:0};
  return (await (await f.frameElement()).boundingBox())||{x:0,y:0};
}
module.exports={
  storageKey:'cast-3d.v1',
  creditsBoard:true,
  // The room compiles its shaders before the first frame; wait for it.
  openingMs:1500,
  async keyMove(f,{tick,pageOf}){
    await f.locator('#board').focus();await pageOf(f).keyboard.press('Enter');
    await tick(pageOf(f),900);
  },
  async touch(f,{tick,pageOf}){
    const p=await f.evaluate(()=>window.__cast3d.squarePoint(0,0)),box=await offset(f);
    await pageOf(f).touchscreen.tap(box.x+p.x,box.y+p.y);
    await tick(pageOf(f),900);
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
