'use strict';
// Constellations: stars are buttons in #stars, routes are cycled with Shift + arrow
// or by tapping a route's handle; boards are chosen from the #boards list in Settings.
const ID='constellations';
const current=s=>s.store.records[s.store.current];
module.exports={
  creditsBoard:true,
  storageKey:'constellations.v2',
  history:s=>current(s).undo,
  position:s=>current(s).weights,
  // Board 1 is two stars and one route, so one move solves it. Resume fixtures
  // start on board 2, where a move leaves real play and Undo history.
  async campaign(f,{settings}){await settings(f,ID,async()=>{await f.locator('#boards button').nth(1).click();});},
  async preferences(f,{settings}){await settings(f,ID,async()=>{await f.locator('#motion').selectOption('still');});},
  // Shift + arrow from a star cycles the route leaving it nearest that direction.
  // Read the pinned board to choose a star and arrow that reach an open route.
  async keyMove(f,{pageOf,tick,assert}){
    const pick=await f.evaluate(()=>{
      const C=window.__constellations,p=C.puzzle(),t=C.topology(),w=C.state.weights,limit=Math.cos(67.5*Math.PI/180);
      const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      for(let i=0;i<p.stars.length;i++)for(const [key,dir] of Object.entries(dirs)){
        const o=p.stars[i];let edge,best=limit;
        for(const r of t.adj[i]){const v=t.edges[r],a=p.stars[v.a===i?v.b:v.a],dx=a.x-o.x,dy=a.y-o.y,c=(dx*dir[0]+dy*dir[1])/(Math.hypot(dx,dy)||1);if(c>best){best=c;edge=r;}}
        if(edge!==undefined&&w[edge]===0&&!t.cross[edge].some(e=>w[e]))return{i,key};
      }
      return null;
    });
    assert(pick,'an open route reachable by Shift + arrow');
    await f.locator('#stars .star').nth(pick.i).focus();await pageOf(f).keyboard.press('Shift+'+pick.key);
    await tick(pageOf(f),800);
  },
  async touch(f,{tapAt,pageOf,tick}){await tapAt(f,'#threads circle.handle.open');await tick(pageOf(f),800);},
  async nextBoard(f,{keyMove,settings}){
    await keyMove(f,ID);
    await settings(f,ID,async()=>{await f.locator('#boards button').nth(2).click();});
  },
  otherBoards(state,assert){
    const records=Object.entries(state.store.records);
    assert(records.length>=2,'two board saves');
    assert(records.some(([id,r])=>id!==state.store.current&&r.weights.some(Boolean)),'first board keeps its threads');
  }
};
