'use strict';
// Tents parity steps. A first visit opens on the opening boards; the campaign
// select leads to the numbered boards, which keep their own saves. Trees take
// no input, so every gesture aims at the first cell without one. Since game-riffs
// PR 259 (58c8772b) the list names an opening board first while it is on the page
// (data-here), as Towers does; the steps pick among the numbered boards only.
const open='#board .cell:not(.tree)',numbered='#campaign option:not([data-here])';
const pick=index=>async(f,h)=>h.settings(f,'tents',async()=>{
  const value=await f.locator(numbered).nth(index).getAttribute('value');
  await f.locator('#campaign').selectOption(value);
});
module.exports={
  storageKey:'tents.current.v1',
  campaign:pick(0),
  async keyMove(f,h){
    await f.locator(open).first().focus();await h.pageOf(f).keyboard.press('Enter');
    await h.tick(h.pageOf(f),800);
  },
  async touch(f,h){
    await h.tapAt(f,open);
    await h.tick(h.pageOf(f),800);
  },
  async solve(f,h){
    // The first opening board is a tree and one empty cell: one tent beside it completes it.
    await f.locator(open).first().focus();await h.pageOf(f).keyboard.press('Enter');
    await h.tick(h.pageOf(f),800);
    h.assert(await f.locator('#next-btn').isVisible(),'tents: original controls did not complete first board');
  },
  async nextBoard(f,{keyMove,settings,tick}){
    await keyMove(f,'tents');
    await settings(f,'tents',async()=>{
      const value=await f.locator(numbered).nth(1).getAttribute('value');
      await f.locator('#campaign').selectOption(value);
    });
    await tick(typeof f.page==='function'?f.page():f);
  },
  otherBoards(state,assert){
    assert(Object.keys(state.store.boards).length>=2,'other board save present');
    assert.equal(state.at,state.store.at,'current board is a campaign board');
  },
  history:s=>s.S.undo,
  position:s=>s.S.cells,
};
