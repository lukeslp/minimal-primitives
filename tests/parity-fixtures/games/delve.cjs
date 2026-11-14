'use strict';
// Delve: a roguelike run on a seeded floor. No Undo, no Hint. The steps read
// the floor from the page (window.__delve) to choose a way, and act only
// through keys and taps.
const KEY={'1,0':'ArrowRight','-1,0':'ArrowLeft','0,1':'ArrowDown','0,-1':'ArrowUp','-1,-1':'q','1,-1':'e','-1,1':'z','1,1':'c'};
// The next step toward the nearest enemy (or the stairs when no enemy can be
// reached), or null when an enemy is already next to the player.
const plan=f=>f.evaluate(()=>{
  const {run,engine:D}=window.__delve,fl=run.floor,p=run.player;
  if(fl.enemies.some(e=>Math.max(Math.abs(e.x-p.x),Math.abs(e.y-p.y))===1))return null;
  const at=(x,y)=>y*fl.w+x,prev=new Map([[at(p.x,p.y),-1]]),q=[at(p.x,p.y)];
  const goal=i=>fl.enemies.some(e=>at(e.x,e.y)===i);
  const stairs=at(fl.stairs[0],fl.stairs[1]);
  const search=want=>{
    prev.clear();prev.set(at(p.x,p.y),-1);q.length=0;q.push(at(p.x,p.y));
    for(let h=0;h<q.length;h++){
      const i=q[h],x=i%fl.w,y=(i/fl.w)|0;
      for(const [dx,dy] of D.DIRS){
        const nx=x+dx,ny=y+dy;if(!D.passable(fl,nx,ny))continue;const n=at(nx,ny);if(prev.has(n))continue;
        prev.set(n,i);
        if(want(n)){let k=n;while(prev.get(k)!==at(p.x,p.y))k=prev.get(k);return [(k%fl.w)-p.x,((k/fl.w)|0)-p.y];}
        if(n!==stairs&&!goal(n))q.push(n);
      }
    }
    return undefined;
  };
  return search(goal)||search(n=>n===stairs)||[1,0];
});
const live=f=>f.locator('#live').textContent();
async function step(f,h){
  const d=await plan(f),page=h.pageOf(f);
  await page.keyboard.press(d?KEY[d.join(',')]:'.');
}
// Keys until the run says something new: a strike marked, a hit, a floor.
async function keyMove(f,h){
  await f.locator('#board').focus();
  const before=await live(f);
  for(let i=0;i<40&&await live(f)===before;i++)await step(f,h);
  await h.tick(h.pageOf(f),800);
}
// The same with taps on the square next to the player in the chosen way.
async function touch(f,h){
  const before=await live(f),page=h.pageOf(f);
  for(let i=0;i<40&&await live(f)===before;i++){
    const d=await plan(f)||[0,0];
    const [x,y]=await f.evaluate(([dx,dy])=>{const {run,screenOf}=window.__delve;return screenOf(run.player.x+dx,run.player.y+dy);},d);
    const r=await f.locator('#board').evaluate(()=>{const b=frameElement?.getBoundingClientRect();return b?{x:b.x,y:b.y}:{x:0,y:0};});
    await page.touchscreen.tap(r.x+x,r.y+y);
  }
  await h.tick(page,800);
}
// Completion is the end of a run: walk to an enemy and stand there.
async function solve(f,h){
  await f.locator('#board').focus();
  for(let i=0;i<300&&!(await f.locator('#completion').isVisible());i++)await step(f,h);
  await h.tick(h.pageOf(f),800);
  h.assert(await f.locator('#next-btn').isVisible(),'delve: the run did not end');
}
module.exports={
  // The only preference is the seed: Random instead of Daily.
  preferences:(f,h)=>h.settings(f,'delve',async()=>{await f.locator('#mode-random').click();}),
  keyMove,touch,solve,
  hint:async(f,h)=>{await h.tick(h.pageOf(f));},
  history:s=>s.log,
  position:s=>({depth:s.run.depth,player:s.run.player,turn:s.run.turn}),
  storageKey:'delve.v1',
  creditsBoard:true,
  skip:{undo:'Delve has no Undo: every turn is final.'},
  async nextBoard(f,{tick,solve}){
    await solve(f,'delve');
    await f.locator('#next-btn').click();await tick(f.page(),1200);
  },
  otherBoards(state,assert){
    assert.equal(state.ended.length,1,'the finished run is kept');
    assert(state.save.daily.best>=1,'best depth today kept');
    assert.equal(state.run.turn>0,true,'the new run has turns');
  },
};
