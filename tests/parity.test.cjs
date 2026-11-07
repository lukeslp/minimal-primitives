'use strict';
// Run: node --test tests/parity.test.cjs. Build first with python3 tools/build.py.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs');
const a=require('./parity-fixtures/actions.cjs');
const selected=h.games.filter(g=>!process.env.MINIMAL_PARITY_GAMES||process.env.MINIMAL_PARITY_GAMES.split(',').includes(g.id));
let browser;
const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>{await browser?.close();});
test('pinned standalone imports retain manifest hashes',()=>h.verifyImports());
const sizes={phone:{width:390,height:844},landscape:{width:844,height:390},desktop:{width:1280,height:900}};
for(const game of selected)for(const [size,viewport] of Object.entries(sizes)) {
  if(process.env.MINIMAL_PARITY_SIZES&&!process.env.MINIMAL_PARITY_SIZES.split(',').includes(size))continue;
  test(`${game.id} ${size}: standalone/generated pixels and keyboard/touch`,async t=>{
    for(const phase of ['opening','keyboard','touch'])await t.test(phase,async st=>{
      const b=await getBrowser(),gen=await h.context(b,viewport),base=await h.context(b,viewport);
      st.after(async()=>{await gen.close();await base.close();});
      const {page,frame}=await h.shell(gen,game),rect=await page.locator('#player iframe').boundingBox();
      assert.deepEqual(rect,{x:0,y:0,...viewport},'game uses the full viewport');
      const original=await h.standalone(base,game);
      assert.equal(await page.evaluate(()=>document.activeElement.tagName),'IFRAME','launch must focus game');
      if(phase!=='opening'){
        const before=await h.surface(original);
        await a[phase==='keyboard'?'keyMove':'touch'](original,game.id);
        await a[phase==='keyboard'?'keyMove':'touch'](frame,game.id);
        assert.notDeepEqual(await h.surface(original),before,phase+' must change observable game state');
      }
      assert.deepEqual(await h.surface(frame),await h.surface(original));
      assert.deepEqual(await h.layout(frame),await h.layout(original),'exact game layout and computed colors');
      await h.pixels(original,page,rect,`${game.id}-${size}-${phase}`);
      assert.deepEqual(gen.parity.errors,[],'generated page errors');assert.deepEqual(base.parity.errors,[],'standalone page errors');
    });
  });
}
for(const game of selected) {
  test(`${game.id}: lossless resume, Undo, hints, preferences and storage isolation`,async t=>{
    const viewport=sizes.phone,b=await getBrowser();
    const seed={localStorage:{'unrelated.save':'local sentinel','ink.v1':'standalone sentinel'},sessionStorage:{'unrelated.save':'session sentinel'}};
    const ctx=await h.context(b,viewport,{seed});t.after(()=>ctx.close());
    let {page,frame}=await h.shell(ctx,game);
    await a.campaign(frame,game.id);await a.preferences(frame,game.id);await a.keyMove(frame,game.id);
    await a.locks(frame,game.id);
    if(['notan','akari','galaxies','slant'].includes(game.id)){
      await frame.locator('#board .cell').last().focus();await page.keyboard.press('ArrowLeft');
    }
    const moved=await h.snapshot(frame);
    assert(a.history(moved,game.id).length>0,'resume fixture must have actual Undo history');
    await a.hint(frame,game.id);
    const state=await h.snapshot(frame);
    if(game.id==='notan')assert(state.state.locks.row.some(Boolean),'fixture has actual clue locks');
    if(game.id==='slant')assert(state.state.locks.some(Boolean),'fixture has actual diagonal locks');
    if(game.id==='bridges')assert(state.state.locks.some(Boolean),'fixture has actual bridge locks');
    await frame.evaluate(()=>sessionStorage.setItem('parity.session','own session sentinel'));
    fs.writeFileSync(path.join(h.EVIDENCE,game.id+'-snapshot.json'),JSON.stringify(state,null,2));
    const before=await h.surface(frame);
    await page.screenshot({clip:await page.locator('iframe').boundingBox(),path:path.join(h.EVIDENCE,game.id+'-before-switch.png')});
    // Library destroys the iframe. Relaunch must use the snapshot, not upstream disk save.
    await frame.locator('#minimal-home').click();await page.mouse.move(-1,-1);await page.locator('.tile').filter({hasText:game.title}).focus();await page.keyboard.press('Enter');
    frame=await (await page.locator('iframe').elementHandle()).contentFrame();await h.ready(frame,true);await h.restored(frame);await a.tick(page);
    await page.screenshot({clip:await page.locator('iframe').boundingBox(),path:path.join(h.EVIDENCE,game.id+'-after-switch.png')});
    await t.test('fresh iframe snapshot equality',async()=>h.sameSnapshot(await h.snapshot(frame),state));
    async function resumedSurface(target) {
      if(game.id==='akari') {
        // Tile entry deliberately returns to the stylized renderer; snapshot
        // equality above still checks every mark, Undo entry and preference.
        assert.equal(await target.locator('html').getAttribute('data-look'),'dark');
        assert.equal(await target.locator('#board .cell').count(),state.state.cells.length);
      } else assert.deepEqual(await h.surface(target),before);
    }
    await t.test('fresh iframe observable state',async()=>resumedSurface(frame));
    await t.test('fresh storage restores from collection snapshot alone',async st=>{
      const fresh=await h.context(b,viewport,{seed:{localStorage:{'lukesteuber.minimal.collection.v1:saves':JSON.stringify({[game.id]:{source:game.commit,state}})}}});
      st.after(()=>fresh.close());
      const restored=await h.shell(fresh,game);await a.tick(restored.page);
      await restored.page.screenshot({path:path.join(h.EVIDENCE,game.id+'-snapshot-only.png')});
      h.sameSnapshot(await h.snapshot(restored.frame),state,'no upstream disk save may repair an incomplete snapshot');
      await resumedSurface(restored.frame);
    });
    await t.test('namespaced session survives iframe replacement',async()=>assert.equal(await frame.evaluate(()=>sessionStorage.getItem('parity.session')),'own session sentinel'));
    await t.test('Undo operates on restored history',async()=>{
      const saved=await h.snapshot(frame);await a.undo(frame,game.id);const undone=await h.snapshot(frame);
      assert.equal(a.history(undone,game.id).length,a.history(saved,game.id).length-1);
      // Undo may undo a lock change while leaving marks in place.
      assert.notDeepEqual(undone,saved);
    });
    await t.test('reload retains snapshot and Undo',async()=>{
      // Save a nontrivial state again, reload shell, then restore its actual stored entry.
      await frame.evaluate(s=>MinimalAdapter.restore(s),state);await frame.locator('#minimal-home').click();
      // Home waits for an asynchronous snapshot before selecting the library.
      await page.locator('#library:visible').waitFor();
      await page.reload();await page.mouse.move(-1,-1);await page.locator('.tile').filter({hasText:game.title}).focus();await page.keyboard.press('Enter');
      frame=await (await page.locator('iframe').elementHandle()).contentFrame();await h.ready(frame,true);await h.restored(frame);await a.tick(page);
      h.sameSnapshot(await h.snapshot(frame),state,game.id+' stored snapshot after Home and reload');
      assert.equal(await frame.evaluate(()=>sessionStorage.getItem('parity.session')),'own session sentinel');
    });
    if(game.id==='notan')await t.test('restored board still accepts real touch',async()=>{
      // Hint focuses the second row. Unlock the first row, then tap an empty cell.
      await frame.locator('#board .cell').first().focus();await page.keyboard.press('l');
      const before=await h.snapshot(frame);await a.tapAt(frame,'#board .cell',1);await a.tick(page,500);
      assert.notDeepEqual((await h.snapshot(frame)).state.cells,before.state.cells,'restored geometry must permit pointer hit-testing');
    });
    await t.test('standalone local/session saves never read or changed',async()=>{
      const raw=await page.evaluate(()=>({local:localStorage.getItem('unrelated.save'),ink:localStorage.getItem('ink.v1'),session:sessionStorage.getItem('unrelated.save')}));
      assert.deepEqual(raw,{local:'local sentinel',ink:'standalone sentinel',session:'session sentinel'});
      const visible=await frame.evaluate(()=>({local:localStorage.getItem('unrelated.save'),ink:localStorage.getItem('ink.v1'),session:sessionStorage.getItem('unrelated.save')}));
      assert.equal(visible.local,null);assert.equal(visible.session,null);assert.notEqual(visible.ink,'standalone sentinel');
    });
    await t.test('generated entry makes no original score API requests',()=>assert.deepEqual(ctx.parity.requests.filter(r=>/scores-api/.test(r.url)),[]));
    assert.deepEqual(ctx.parity.errors,[]);
  });
  for(const scheme of ['dark','light'])test(`${game.id}: ${scheme} system theme, motion and explicit preferences match standalone`,async t=>{
    const gen=await h.context(await getBrowser(),sizes.phone,{scheme,motion:'no-preference'}),base=await h.context(await getBrowser(),sizes.phone,{scheme,motion:'no-preference'});
    t.after(async()=>{await gen.close();await base.close();});
    const {page,frame}=await h.shell(gen,game),original=await h.standalone(base,game),rect=await page.locator('iframe').boundingBox();
    await t.test('system appearance with normal motion',async()=>{
      assert.deepEqual(await h.surface(frame),await h.surface(original));await h.pixels(original,page,rect,`${game.id}-${scheme}-motion-system`);
    });
    await t.test('explicit appearance and reduced-motion preferences',async()=>{
      await a.preferences(original,game.id);await a.preferences(frame,game.id);
      await a.tick(original.page());await a.tick(page);
      assert.deepEqual(await h.surface(frame),await h.surface(original));await h.pixels(original,page,rect,`${game.id}-${scheme}-preferences`);
    });
    assert.deepEqual(gen.parity.errors,[]);assert.deepEqual(base.parity.errors,[]);
  });
  test(`${game.id}: actual first-board completion and bridge event`,async t=>{
    const ctx=await h.context(await getBrowser(),sizes.phone),base=await h.context(await getBrowser(),sizes.phone);t.after(async()=>{await ctx.close();await base.close();});
    const {page,frame}=await h.shell(ctx,game);
    const original=await h.standalone(base,game);
    await a.solve(original,game.id);await a.solve(frame,game.id);
    await page.waitForFunction(()=>window.__parityMessages.some(e=>e.type==='complete'));
    const events=await page.evaluate(()=>window.__parityMessages.filter(e=>e.type==='complete'));
    await t.test('completion and appearance match original',async()=>{
      assert.deepEqual(await h.surface(frame),await h.surface(original));
      await h.pixels(original,page,await page.locator('iframe').boundingBox(),game.id+'-completion');
    });
    await t.test('single proof-bearing completion event',()=>{assert.equal(events.length,1,'one completion event from real input');assert(events[0].payload.proof,'completion proof present');});
    if(['notan','horologist','tilt','bending'].includes(game.id))await t.test('completed board credited in collection',()=>assert.equal(events[0].payload.progress.completed,1));
    assert.equal(ctx.parity.requests.filter(r=>r.kind!=='analytics').length,0,'no original score API attempts');
  });
  for(const storage of ['unavailable','corrupt'])test(`${game.id}: ${storage} storage keeps actual entry playable`,async t=>{
    const current={notan:'ink.v1',akari:'akari.current.v1',galaxies:'galaxies.current.v1',bridges:'bridges.current.v1',slant:'slant.current.v1',fold:'fold.current.v1',bending:'rimlight.dark.v2',tilt:'tilt-levels-grok.v1',horologist:'horologist-plate.v1'}[game.id];
    const ctx=await h.context(await getBrowser(),sizes.phone,{storage,seed:storage==='corrupt'?{localStorage:{['lukesteuber.minimal.'+game.id+':'+current]:'{damaged'}}:{}});t.after(()=>ctx.close());
    const {page,frame}=await h.shell(ctx,game);const before=await h.snapshot(frame);await a.keyMove(frame,game.id);
    assert.notDeepEqual(a.position(await h.snapshot(frame),game.id),a.position(before,game.id),'actual move despite storage failure');
    assert.deepEqual(ctx.parity.errors,[]);
    await page.screenshot({path:path.join(h.EVIDENCE,`${game.id}-${storage}.png`)});
  });
}
