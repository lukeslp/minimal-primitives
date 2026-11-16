'use strict';
// Cube Maze (game-riffs cube-maze/) draws a glass cube in a WebGL canvas (#scene). The arrow keys roll the cube
// through window listeners, so a control in the game frame takes focus first; it has no arrow-key behavior of its
// own. A one-finger tap off the cube rolls it too; the game's own __cubeMaze.offCubePoint reads where such a
// tap can land (read only, nothing is changed through it). Board cm01 is solved by a roll to the left, so the
// key and tap here roll right, which leaves it unsolved. Hint searches in a Web Worker on the first press and
// plays the move on the second, so solve() also runs the worker inside the generated page.
async function offset(f){
  if(typeof f.frameElement!=='function')return {x:0,y:0};
  return (await (await f.frameElement()).boundingBox())||{x:0,y:0};
}
module.exports={
  storageKey:'cube-maze.v1',
  creditsBoard:true,
  // The ring that finds the marble on opening runs 700 ms on the performance clock (a still ring for one second
  // under reduced motion); let it finish so both pages show the same frame.
  openingMs:1100,
  async keyMove(f,{tick,pageOf}){
    await f.locator('#settings-btn').focus();
    await pageOf(f).keyboard.press('ArrowRight');
    await tick(pageOf(f),900);
  },
  async touch(f,{tick,pageOf}){
    // A tap off the cube leans it briefly and rolls it toward the side nearest the tap.
    const p=await f.evaluate(()=>window.__cubeMaze.offCubePoint('right')),box=await offset(f);
    await pageOf(f).touchscreen.tap(box.x+p.x,box.y+p.y);
    await tick(pageOf(f),900);
  },
  async preferences(f,{settings,tick,pageOf}){
    await settings(f,'cube-maze',async()=>{await f.locator('#motion').selectOption('reduce');});
    await tick(pageOf(f),1100);
  },
  // The first press searches in a worker; wait for its answer so a snapshot taken next holds the shown hint.
  async hint(f,{tick,pageOf}){
    await f.locator('#hint-btn').click();
    await f.waitForFunction(()=>!window.__cubeMaze.state.searching);
    await tick(pageOf(f));
  },
  async solve(f,{tick,pageOf,assert}){
    for(let i=0;i<12;i++){
      if(await f.locator('#next-btn').isVisible())return;
      await f.locator('#hint-btn').click();
      await f.waitForFunction(()=>!window.__cubeMaze.state.searching&&!!window.__cubeMaze.state.hint);
      await f.locator('#hint-btn').click();await tick(pageOf(f),3200);
    }
    assert(await f.locator('#next-btn').isVisible(),'cube-maze: original controls did not complete first board');
  },
  async nextBoard(f,{tick,solve}){
    await solve(f,'cube-maze');
    await f.locator('#next-btn').click();await tick(f.page(),1200);
  },
  history:s=>s.history,
  position:s=>s.history,
  otherBoards(state,assert){
    assert(state.completed.includes('cm01'),'first board finished');
    assert.equal(state.board,'cm02');
  },
};
