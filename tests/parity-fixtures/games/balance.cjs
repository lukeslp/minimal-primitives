'use strict';
// Balance: a first visit opens on the short opening boards; the campaign
// picker sits in Settings. Moves go to the first square that is not fixed.
const open='#board .cell:not([aria-readonly])';
// While an opening board is on the page the campaign list names it first (data-opening); the steps pick numbered boards.
const numbered='#campaign option:not([data-opening])';
module.exports={
  storageKey:'balance.current.v1',
  async campaign(f,{settings}){
    await settings(f,'balance',async()=>{
      const first=await f.locator(numbered).first().getAttribute('value');
      await f.locator('#campaign').selectOption(first);
    });
  },
  async keyMove(f,{tick,pageOf}){
    await f.locator(open).first().focus();await pageOf(f).keyboard.press('Enter');
    await tick(pageOf(f),800);
  },
  async touch(f,{tick,tapAt,pageOf}){
    await tapAt(f,open);
    await tick(pageOf(f),800);
  },
  otherBoards(state,assert){
    const boards=Object.keys(state.store.boards);
    assert(boards.length>=2,'other board save present');
    assert(boards.some(id=>id!==state.at),'a board other than the current one is saved');
  },
};
