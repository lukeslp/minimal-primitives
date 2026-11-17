'use strict';
// Shoo · Minimal: the default steps fit (cells, #campaign, #theme, #motion);
// only the save shape differs.
module.exports={
  creditsBoard:true,
  storageKey:'shoo-minimal.current.v2',
  history:s=>s.history,
  // A tap on the first cell moves nothing on some boards (since game-riffs d3d9b9e the second board is s03): then
  // Hint twice plays the hinted move ("Hint again plays it").
  async keyMove(f,{tick,pageOf}){
    const taps=()=>f.evaluate(async()=>window.MinimalAdapter?(await MinimalAdapter.snapshot()).history.length:-1),before=await taps();
    await f.locator('#board .cell').first().focus();await pageOf(f).keyboard.press('Enter');await tick(pageOf(f),800);
    if(before>=0&&await taps()===before){await f.locator('#hint-btn').click();await tick(pageOf(f));await f.locator('#hint-btn').click();await tick(pageOf(f),800);}
  },
  position:s=>s.bees,
  otherBoards(state,assert){
    const saved=Object.entries(state.store.boards);
    assert(saved.length>=2,'two board saves');
    assert(saved.some(([id,b])=>id!==state.store.at&&b.hits>0),'first board keeps its taps');
  }
};
