'use strict';
// Tilt · 3D draws its trays in a WebGL canvas (#scene). The arrow keys and swipes
// reach the game through window listeners, so a control inside the game frame
// takes focus first; it has no arrow-key behavior of its own.
async function keyMove(f,{tick,pageOf}) {
  await f.locator('#settings-btn').focus();
  await pageOf(f).keyboard.press('ArrowRight');
  await tick(pageOf(f),800);
}
async function touch(f,{tick,pageOf}) {
  const r=await f.locator('#scene').boundingBox(),page=pageOf(f);
  const cdp=await page.context().newCDPSession(page);
  const x=r.x+r.width*.3,y=r.y+r.height*.5;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+90,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  await tick(page,800);
}
async function preferences(f,{settings,tick,pageOf}) {
  await settings(f,'tilt-3d',async()=>{
    await f.locator('#theme').selectOption('light');
    await f.locator('#motion').selectOption('reduce');
  });
  // The ring of light that finds the marble on opening runs 700 ms on the
  // performance clock; let it finish so both pages show the same frame.
  await tick(pageOf(f),1000);
}
async function solve(f,{tick,pageOf,assert}) {
  // Hint shows the next tip of a shortest finish; a second press plays it.
  for(let i=0;i<60;i++) {
    if(await f.locator('#next-btn').isVisible())return;
    await f.locator('#hint-btn').click();await tick(pageOf(f),800);
  }
  assert(await f.locator('#next-btn').isVisible(),'tilt-3d: original controls did not complete first board');
}
async function nextBoard(f,{tick,solve}) {
  await solve(f,'tilt-3d');
  await f.locator('#next-btn').click();await tick(f.page(),1200);
}
module.exports={
  keyMove,touch,preferences,solve,nextBoard,creditsBoard:true,
  // The opening ring runs 700 ms on the performance clock, which drifts a few
  // ms between documents; the shared test waits this long before comparing.
  openingMs:1000,storageKey:'tilt-3d.v1',
  history:s=>s.undoStack,
  position:s=>({board:s.board,history:s.history}),
  otherBoards(state,assert){assert(state.reached>=1);assert(state.done.length>=1);assert.equal(state.board,'l02');}
};
