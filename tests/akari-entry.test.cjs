const {test,after}=require('node:test');const assert=require('node:assert/strict');
const h=require('./parity-fixtures/browser.cjs');let browser;after(async()=>browser?.close());
for(const theme of ['light','system'])test('Akari tile opens stylized with '+theme+' preferences',async t=>{
 browser||=await h.launch();const ctx=await h.context(browser,{width:390,height:844},{scheme:'light',seed:{localStorage:{'lukesteuber.minimal.akari:akari.settings.v1':JSON.stringify({version:1,theme,motion:'reduce',zoom:'fit',difficulty:'Hard'})}}});t.after(()=>ctx.close());
 const {page,frame}=await h.shell(ctx,h.games.find(g=>g.id==='akari'));await page.clock.resume();
 assert.equal(await frame.locator('html').getAttribute('data-look'),'dark');
 await frame.locator('#settings-btn').click();await frame.locator('#look-other').click();
 await page.waitForFunction(()=>document.querySelector('#player iframe')?.contentDocument?.documentElement?.dataset.look==='light');
 const classic=await (await page.locator('#player iframe').elementHandle()).contentFrame();await h.ready(classic,true);
 await classic.locator('#minimal-home').click();await page.locator('#library:visible').waitFor();await page.locator('.tile[data-game="akari"]').click();
 await page.waitForFunction(()=>document.querySelector('#player iframe')?.contentDocument?.documentElement?.dataset.look==='dark');
 const back=await (await page.locator('#player iframe').elementHandle()).contentFrame();await h.ready(back,true);await h.restored(back);assert.deepEqual(ctx.parity.errors,[]);
});
