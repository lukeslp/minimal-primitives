'use strict';
// An app update moves games to a newer source commit. A player's unfinished board and progress live in the
// library's saves, made by the older build; the update must still open them. The fixture holds one save per
// game, taken in the build pinned at game-riffs 2ba8a67 (0.5.5): a few taps on the first board, then Home.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs');
const KEY='lukesteuber.minimal.collection.v1:saves';
const fixture=fs.readFileSync(path.join(__dirname,'upgrade-fixtures/saves-2ba8a67.json'),'utf8'),old=JSON.parse(fixture);
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
for(const game of h.games.filter(g=>old[g.id]))test(`${game.id}: a save from the 0.5.5 build opens after the update`,async t=>{
  assert.notEqual(old[game.id].source,game.commit,'the fixture is from an older source commit');
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{[KEY]:fixture}}});t.after(()=>ctx.close());
  // shell() waits for the restore and fails on a restore error.
  const {page,frame}=await h.shell(ctx,game);
  assert.equal(await page.locator('#notice:not([hidden])').count(),0,'no notice is shown');
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  const now=await page.evaluate(([k,id])=>JSON.parse(localStorage.getItem(k))[id],[KEY,game.id]);
  assert.equal(now.source,game.commit,'the save is kept, now from this build');
});
