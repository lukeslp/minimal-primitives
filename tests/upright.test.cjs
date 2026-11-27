'use strict';
// Akari asks for the phone upright when it is held sideways (game-riffs PR 271, portrait.js): a touch screen whose
// short side is under 600 px, wider than tall and at most 500 px tall. In the app a phone stays upright
// (MainActivity, CollectionViewController since PR 105), so the prompt is only reached where the app turns: it must
// not show on a tablet, on the iPhone Duo's open inner screen, or on a phone held upright, and where it does show
// (a phone sideways on the web, or Android split screen) the collection's Home stays in reach.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const h=require('./parity-fixtures/browser.cjs');
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
const akari=h.games.find(g=>g.id==='akari');

test('Akari and its light look carry the upright prompt',()=>{
  assert.deepEqual(h.games.filter(g=>h.upright(g.id)).map(g=>g.id),['akari']);
  assert.ok(akari.variants.some(v=>v.id==='light'&&v.files.includes('portrait.js')),'the light look (akari-classic) brings its own');
});
const cases={'phone upright':[{width:390,height:844},false],'phone sideways':[{width:844,height:390},true],
  'Duo inner, sideways':[{width:951,height:669},false],'Duo inner, upright':[{width:669,height:951},false],
  'iPad, sideways':[{width:1180,height:820},false]};
for(const [name,[viewport,prompt]] of Object.entries(cases))test(`Akari, ${name}: the upright prompt ${prompt?'shows, with Home':'stays away'}`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {frame}=await h.shell(ctx,akari);
  assert.equal(h.phoneSideways(viewport),prompt);
  assert.equal(await frame.evaluate(()=>document.documentElement.hasAttribute('data-portrait-turn')),prompt);
  assert.equal(await frame.locator('#board').isVisible(),!prompt,'the board is out of sight only under the prompt');
  assert.equal(await frame.locator('#minimal-home').isVisible(),true,'Home is always in reach');
  assert.deepEqual(ctx.parity.errors,[]);
});
