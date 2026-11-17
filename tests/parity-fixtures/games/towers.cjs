'use strict';
// Towers parity steps. A first visit opens on the opening boards; the campaign
// select leads to the numbered boards, which keep their own saves. While an
// opening board is on the page the list names it first (data-here); the steps
// below pick among the numbered boards only.
const numbered='#campaign option:not([data-here])';
const pick=index=>async(f,h)=>h.settings(f,'towers',async()=>{
  const value=await f.locator(numbered).nth(index).getAttribute('value');
  await f.locator('#campaign').selectOption(value);
});
module.exports={
  storageKey:'towers.current.v1',
  campaign:pick(0),
  async keyMove(f,h){
    // The first painted cell is row 1, column 1 at rest; Enter raises it by one.
    await f.locator('#board .cell').first().focus();await h.pageOf(f).keyboard.press('Enter');
    await h.tick(h.pageOf(f),800);
  },
  async solve(f,h){
    // The first opening board is one square: a single raise completes it.
    await f.locator('#board .cell').first().focus();await h.pageOf(f).keyboard.press('Enter');
    await h.tick(h.pageOf(f),800);
    h.assert(await f.locator('#next-btn').isVisible(),'towers: original controls did not complete first board');
  },
  async nextBoard(f,{keyMove,settings,tick}){
    await keyMove(f,'towers');
    await settings(f,'towers',async()=>{
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
