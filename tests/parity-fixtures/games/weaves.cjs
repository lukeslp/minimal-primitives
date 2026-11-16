'use strict';
// Weaves (game-riffs weave-minimal/) draws its cloth in one SVG (#board) that takes the keyboard itself: arrows
// move the crossing ring and Enter flips the crossing under it. A fresh save opens board 1 only, a single row of
// three crossings with the two outer ones pinned, so the one move there is also its answer. The steps that need
// an unfinished board with Undo history and a hint to show (resume, other boards) therefore finish board 1 with
// that move and take Next to board 2, where the same key move flips one of two loose crossings.
const pageOf=f=>typeof f.page==='function'?f.page():f;
const onBoard=async(f,n)=>(await f.locator('#readout').textContent()).startsWith(n+' /');
async function flip(f,h){
  await f.locator('#board').focus();
  await pageOf(f).keyboard.press('ArrowRight');await pageOf(f).keyboard.press('Enter');
  await h.tick(pageOf(f),800);
}
// The beat and the dye follow a solve at normal motion; Next arrives after them.
async function finish(f,h){
  await flip(f,h);await h.tick(pageOf(f),2400);
  h.assert(await f.locator('#next-btn').isVisible(),'weaves: original controls did not complete first board');
}
async function second(f,h){
  if(!await onBoard(f,1))return;
  await finish(f,h);
  await f.locator('#next-btn').click();await h.tick(pageOf(f),800);
  h.assert(await onBoard(f,2),'weaves: Next opens board 2');
}
module.exports={
  storageKey:'weave-minimal.v1',
  creditsBoard:true,
  campaign:second,
  keyMove:flip,
  async touch(f,h){
    // A tap inside the cloth takes the nearest free crossing; on board 1 that is the middle one.
    await h.tapAt(f,'#board');
    await h.tick(pageOf(f),800);
  },
  solve:finish,
  // parity-state hands its own helper set; campaign() has already reached board 2 by then.
  async nextBoard(f,{tick}){await second(f,{tick,assert:require('node:assert/strict')});},
  history:s=>s.history,
  position:s=>s.grid,
  otherBoards(state,assert){
    assert(state.finished.includes('w01'),'first board finished');
    assert.equal(state.board,'w02');
    assert(state.reached>=1,'board 2 stays open');
  },
};
