'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
const games=h.games.filter(g=>!process.env.MINIMAL_PARITY_GAMES||process.env.MINIMAL_PARITY_GAMES.split(',').includes(g.id));
const viewport={width:390,height:844};
for(const game of games)test(`${game.id}: other boards and earned access survive snapshot-only restore`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game),id=game.id;
  await a.campaign(frame,id);
  if(['fold','bending','tilt','horologist'].includes(id)) {
    await a.solve(frame,id);
    await frame.locator(id==='bending'?'#next':'#next-btn').click();await a.tick(page,1200);
  } else if(id==='notan') {
    await a.keyMove(frame,id);await frame.locator('#lvl-btn').click();
    await frame.locator('#lv-grid .lv').nth(1).click();
  } else {
    await a.keyMove(frame,id);
    await a.settings(frame,id,async()=>{
      const next=await frame.locator('#campaign option').nth(1).getAttribute('value');
      await frame.locator('#campaign').selectOption(next);
    });
  }
  await a.keyMove(frame,id);await a.hint(frame,id);
  const state=await h.snapshot(frame);
  assert(a.history(state,id).length>0,'second board has real history');
  if(id==='notan')assert(Object.keys(state.save.boards).length>=2,'two unfinished boards');
  else if(['akari','galaxies','bridges','slant','fold'].includes(id))assert(Object.keys(state.store.boards).length>=2,'other board save present');
  else if(id==='bending'){assert(state.record.stages[0].solved);assert(state.record.available>=2);assert.equal(state.record.board,1);}
  else {assert(state.reached>=1);assert((state.done||state.completed).length>=1);}
  const before=await h.surface(frame);
  const clean=await h.context(await getBrowser(),viewport,{seed:{localStorage:{'lukesteuber.minimal.collection.v1:saves':JSON.stringify({[id]:{source:game.commit,state}})}}});t.after(()=>clean.close());
  const restored=await h.shell(clean,game);
  await t.test('all boards, current position, history and unlocks restored',async()=>h.sameSnapshot(await h.snapshot(restored.frame),state));
  await t.test('restored selectors, hint and current board presentation',async()=>assert.deepEqual(await h.surface(restored.frame),before));
});

for(const game of games)test(`${game.id}: open settings dialog restores in a fresh document`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {frame}=await h.shell(ctx,game);
  await frame.locator(game.id==='bending'?'#settings-button':'#settings-btn').click();
  const state=await h.snapshot(frame),before=await h.surface(frame);
  assert.deepEqual(before.dialogs,['settings'],'fixture has a real open dialog');
  const clean=await h.context(await getBrowser(),viewport,{seed:{localStorage:{'lukesteuber.minimal.collection.v1:saves':JSON.stringify({[game.id]:{source:game.commit,state}})}}});t.after(()=>clean.close());
  const restored=await h.shell(clean,game);
  assert.deepEqual((await h.surface(restored.frame)).dialogs,['settings']);
  assert.deepEqual((await h.surface(restored.frame)).controls,before.controls,'restored visible dialog controls');
});

if(games.some(g=>g.id==='slant'))test('Slant free-draw size and drawing survive a fresh document',async t=>{
  const game=games.find(g=>g.id==='slant'),ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  await a.campaign(frame,'slant');await frame.locator('#free-btn').click();await frame.locator('#free-size').selectOption('16');
  await a.keyMove(frame,'slant');const state=await h.snapshot(frame),before=await h.surface(frame);
  assert.equal(state.at,'free');assert.equal(state.state.cells.length,256);
  const clean=await h.context(await getBrowser(),viewport,{seed:{localStorage:{'lukesteuber.minimal.collection.v1:saves':JSON.stringify({slant:{source:game.commit,state}})}}});t.after(()=>clean.close());
  const restored=await h.shell(clean,game);
  h.sameSnapshot(await h.snapshot(restored.frame),state);assert.deepEqual(await h.surface(restored.frame),before);
});

if(games.some(g=>g.id==='notan'))test('Notan restores the remaining timer fraction before the next tick',async t=>{
 const game=games.find(g=>g.id==='notan'),ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
 const frame=await h.standalone(ctx,game,{generated:true});await a.keyMove(frame,'notan');
 const saved=await h.snapshot(frame);assert(saved.clockRunning);assert(saved.clockRemaining>0&&saved.clockRemaining<1000);
 const clean=await h.context(await getBrowser(),viewport);t.after(()=>clean.close());
 const fresh=await h.standalone(clean,game,{generated:true});await fresh.evaluate(s=>MinimalAdapter.restore(s),saved);
 assert.equal((await h.snapshot(fresh)).clockRemaining,saved.clockRemaining);
 await fresh.page().clock.runFor(saved.clockRemaining-1);assert.equal((await h.snapshot(fresh)).state.time,saved.state.time);
 await fresh.page().clock.runFor(2);assert.equal((await h.snapshot(fresh)).state.time,saved.state.time+1);
});
