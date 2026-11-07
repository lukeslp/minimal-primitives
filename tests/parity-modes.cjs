'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
let browser;const getBrowser=async()=>browser||(browser=await h.launch());after(async()=>browser?.close());
const cases=[['notan','plus','plus=1'],['notan','endless','endless=5&seed=271828'],['bridges','circuits','controls=circuits']];
for(const [id,mode,query] of cases) {
  if(process.env.MINIMAL_PARITY_GAMES&&!process.env.MINIMAL_PARITY_GAMES.split(',').includes(id))continue;
  test(`${id} ${mode}: actual entry parity and snapshot-only mode restore`,async t=>{
    const game=h.games.find(g=>g.id===id),viewport={width:390,height:844};
    const gen=await h.context(await getBrowser(),viewport),base=await h.context(await getBrowser(),viewport);t.after(async()=>{await gen.close();await base.close();});
    const original=await h.standalone(base,game,{query}),generated=await h.standalone(gen,game,{query,generated:true});
    await a.keyMove(original,id);await a.keyMove(generated,id);
    await t.test('same controls, rules presentation and exact image',async()=>{
      assert.deepEqual(await h.surface(generated),await h.surface(original));assert.deepEqual(await h.layout(generated),await h.layout(original));
      await h.pixels(original,generated.page(),await generated.page().locator('iframe').boundingBox(),id+'-'+mode);
    });
    const state=await h.snapshot(generated);assert(a.history(state,id).length>0,'real mode-specific history');
    if(id==='notan')assert(mode==='plus'?state.puzzle.plus:state.puzzle.endless,'fixture entered requested mode');
    else assert(await generated.locator('.circuit-route,.route-control').count()>0,'actual circuit controls present');
    const before=await h.surface(generated),clean=await h.context(await getBrowser(),viewport);t.after(()=>clean.close());
    const fresh=await h.standalone(clean,game,{generated:true});
    await fresh.evaluate(s=>MinimalAdapter.restore(s),state);
    await t.test('complete snapshot state',async()=>h.sameSnapshot(await h.snapshot(fresh),state));
    await t.test('mode controls and current position',async()=>assert.deepEqual(await h.surface(fresh),before));
  });
}
