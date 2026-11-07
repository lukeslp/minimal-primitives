'use strict';
const assert=require('node:assert/strict');
const pageOf=f=>typeof f.page==='function'?f.page():f;
async function tick(page,ms=100) {
  const now=await page.evaluate(()=>Date.now());await page.clock.setFixedTime(new Date(now+ms));await page.clock.runFor(ms);
}
async function tapAt(f,selector,index=0) {
  const r=await f.locator(selector).nth(index).boundingBox();assert(r,'touch target has geometry');
  await pageOf(f).touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
}
async function settings(f,id,fn) {
  await f.locator(id==='bending'?'#settings-button':'#settings-btn').click();
  await fn();
  const dialog=f.locator('#settings');
  if(await dialog.evaluate(d=>d.open))await dialog.locator('form button').first().click();
  // Native dialog close events restore focus in a later task. Let that finish
  // before the next keyboard gesture chooses its own board target.
  await tick(pageOf(f));
}
async function campaign(f,id) {
  if(['akari','galaxies','bridges','slant','fold'].includes(id))await settings(f,id,async()=>{
    const first=await f.locator('#campaign option').first().getAttribute('value');
    await f.locator('#campaign').selectOption(first);
  });
}
async function preferences(f,id) {
  await settings(f,id,async()=>{
    if(id==='notan')await f.locator('#theme-btn').click();
    else if(id==='bending'){await f.locator('#motion').click();}
    else {
      if(id==='akari'&&await f.evaluate(()=>document.documentElement.dataset.look==='dark')){
        await Promise.all([f.waitForURL(url=>/akari-(light|classic|preview)\//.test(url.pathname)),f.locator('#theme').selectOption('light')]);
        await f.waitForFunction(()=>document.readyState==='complete'&&!!document.querySelector('#board .cell'));
        await f.locator('#settings-btn').click();
      } else if(await f.locator('#theme').isVisible())await f.locator('#theme').selectOption('light');
      await f.locator('#motion').selectOption('reduce');
      if(id==='slant')await f.locator('#mode').selectOption('Hard');
    }
  });
}
async function locks(f,id) {
  if(id==='notan'){await f.locator('#board .cell').first().focus();await pageOf(f).keyboard.press('l');}
  if(id==='slant'){
    await f.locator('#board .cell').first().focus();await pageOf(f).keyboard.press('l');
    await f.locator('#mark-btn').click();
  }
  if(id==='bridges'){
    await f.locator('#board .island').first().focus();await pageOf(f).keyboard.press('Enter');
    await pageOf(f).keyboard.press('ArrowRight');await pageOf(f).keyboard.press('l');
  }
}
async function keyMove(f,id) {
  if(id==='bending') { await f.locator('.planet-button').first().focus();await pageOf(f).keyboard.press('Enter'); }
  else if(id==='tilt') { await f.locator('#board').focus();await pageOf(f).keyboard.press('ArrowRight'); }
  else if(id==='horologist') { await f.locator('.piece-target[data-hole]').first().focus();await pageOf(f).keyboard.press('Enter'); }
  else {
    const first=f.locator(id==='bridges'?'#board .island':id==='akari'?'#board .cell:not(.wall)':'#board .cell').first();
    await first.focus();
    if(id==='bridges'){
      const direction=await f.locator('#board .island').evaluateAll(nodes=>{
        const a=nodes[0].getBoundingClientRect(),near=nodes.slice(1).map(n=>n.getBoundingClientRect()).find(b=>Math.abs(b.x-a.x)<1||Math.abs(b.y-a.y)<1);
        if(!near)throw Error('No visible aligned island');
        return Math.abs(near.y-a.y)<1?(near.x>a.x?'ArrowRight':'ArrowLeft'):(near.y>a.y?'ArrowDown':'ArrowUp');
      });
      await pageOf(f).keyboard.press('Shift+'+direction);
    }
    else if(id==='fold'){await first.press('Enter');const handle=f.locator('#handles button').first();await handle.press('Enter');if(await f.locator('#handles .choice').count())await f.locator('#handles .choice').first().press('Enter');}
    else { if(id==='galaxies')await pageOf(f).keyboard.press('c');await pageOf(f).keyboard.press('Enter'); }
  }
  await tick(pageOf(f),800);
}
async function touch(f,id) {
  if(id==='tilt'||id==='fold') {
    const r=await f.locator('#board').boundingBox(),page=pageOf(f);
    const cdp=await page.context().newCDPSession(page);
    const x=r.x+r.width*.25,y=r.y+r.height*.5;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:id==='fold'?r.x+r.width*.75:x+90,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  } else if(id==='horologist')await tapAt(f,'.piece-target[data-hole]');
  else if(id==='bending')await f.locator('#well').tap({position:{x:(await f.locator('#well').boundingBox()).width/2,y:(await f.locator('#well').boundingBox()).height/2}});
  else if(id==='bridges') {await tapAt(f,'#board .island');await tapAt(f,'#board .island',1);}
  else await tapAt(f,'#board .cell');
  await tick(pageOf(f),800);
}
async function hint(f,id) {await f.locator(id==='bending'?'#hint':'#hint-btn').click();await tick(pageOf(f));}
async function undo(f,id) {await f.locator(id==='bending'?'#undo':'#undo-btn').click();await tick(pageOf(f),800);}
function history(s,id) {return id==='horologist'?s.model.history:id==='tilt'?s.undoStack:id==='bending'?s.history:s.state.undo;}
function position(s,id) {return id==='horologist'?s.model.placed:id==='tilt'?s.place:id==='bending'?s.record.stages[s.record.board].planets:id==='fold'?s.state.path:s.state.cells;}
async function solve(f,id) {
  if(id==='notan') {
    // First original board is a solid 2x2. Use real keyboard actions.
    for(let i=0;i<4;i++){await f.locator('#board .cell').nth(i).focus();await pageOf(f).keyboard.press('Enter');}
    await tick(pageOf(f),1200);
  } else if(['akari','galaxies','bridges'].includes(id)) {
    await keyMove(f,id);
  } else if(id==='bending') {
    // Read the pinned board answer; place through the keyboard, never mutate game state.
    const target=await f.evaluate(async()=>{const {boards}=await import('./boards.mjs?v=7924441f');return boards[0].answer[0];});
    await f.locator('.planet-button').first().focus();await pageOf(f).keyboard.press('Enter');
    // A first-board planet moves along the discrete lattice with the arrow keys.
    const {spots}=await f.evaluate(async()=>{const e=await import('./well.mjs?v=0f8ac9d7');const {boards}=await import('./boards.mjs?v=7924441f');return {spots:e.spots(boards[0])};});
    let at=await f.evaluate(async()=>{const e=await import('./well.mjs?v=0f8ac9d7');const {boards}=await import('./boards.mjs?v=7924441f');return e.nearestDot(300,300,[],boards[0].size);});
    for(const [axis,pos,neg] of [['col','ArrowRight','ArrowLeft'],['row','ArrowDown','ArrowUp']]) {
      const n=spots[target][axis]-spots[at][axis];for(let i=0;i<Math.abs(n);i++)await pageOf(f).keyboard.press(n>0?pos:neg);
      at=spots.findIndex(p=>p.col===(axis==='col'?spots[target].col:spots[at].col)&&p.row===(axis==='row'?spots[target].row:spots[at].row));
    }
    await tick(pageOf(f),1200);
  } else if(id==='tilt') {
    for(let i=0;i<30;i++) {
      if(await f.locator('#next-btn').isVisible())return;
      await hint(f,id);
      // Direction is announced by the original hint marker's rotation.
      const rotation=await f.locator('#hint-mark').getAttribute('transform');
      const angle=Number(rotation.match(/rotate\(([-\d.]+)/)[1]);
      await f.locator('#board').focus();await pageOf(f).keyboard.press(({0:'ArrowUp',90:'ArrowRight',180:'ArrowDown','-90':'ArrowLeft'})[angle]);await tick(pageOf(f),1000);
    }
  } else {
    for(let i=0;i<100;i++) {
      if(await f.locator('#next-btn').isVisible())return;
      await hint(f,id);await tick(pageOf(f),800);
    }
  }
  const next=f.locator(id==='bending'?'#next':'#next-btn');
  assert(await next.isVisible(),`${id}: original controls did not complete first board`);
}
module.exports={tick,settings,campaign,preferences,locks,keyMove,touch,hint,undo,history,position,solve,tapAt};
