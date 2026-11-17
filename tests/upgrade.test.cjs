'use strict';
// An app update moves games to a newer source commit. A player's unfinished board and progress live in the
// library's saves, made by the older build; the update must still open them. Each fixture holds one save per
// game, taken in a shipped build: a move on the first board, then Home. saves-2ba8a67.json is from 0.5.5
// (game-riffs 2ba8a67), saves-c965c4f.json from 0.5.7 (c965c4f, with Cube Maze, Tangles and Weaves). Add one
// from each shipped build before its games are pinned again.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
const KEY='lukesteuber.minimal.collection.v1:saves';
const FIXTURES=[['0.5.5','saves-2ba8a67.json'],['0.5.7','saves-c965c4f.json']].map(([build,name])=>{const fixture=fs.readFileSync(path.join(__dirname,'upgrade-fixtures',name),'utf8');return{build,fixture,old:JSON.parse(fixture)};});
const {old}=FIXTURES[0];
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
for(const {build,fixture,old} of FIXTURES)for(const game of h.games.filter(g=>old[g.id]))test(`${game.id}: a save from the ${build} build opens after the update`,async t=>{
  assert.notEqual(old[game.id].source,game.commit,'the fixture is from an older source commit');
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{[KEY]:fixture}}});t.after(()=>ctx.close());
  // shell() waits for the restore and fails on a restore error.
  const {page,frame}=await h.shell(ctx,game);
  assert.equal(await page.locator('#notice:not([hidden])').count(),0,'no notice is shown');
  // The board, its Undo history, progress and settings are the ones the old build saved, not a fresh game's.
  h.sameSnapshot(await h.snapshot(frame),old[game.id].state,game.id+' restores the saved state');
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  const now=await page.evaluate(([k,id])=>JSON.parse(localStorage.getItem(k))[id],[KEY,game.id]);
  assert.equal(now.source,game.commit,'the save is kept, now from this build');
});

test('a save this build cannot read is kept aside, the player is told, and the game starts new',async t=>{
  const game=h.games.find(g=>g.id==='slant'),broken={...old.slant,state:{at:'no-such-board'}};
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{[KEY]:JSON.stringify({slant:broken})}}});t.after(()=>ctx.close());
  const page=await ctx.newPage();
  await page.goto(h.ORIGIN+'/export/index.html');await h.open(page,'slant');
  await page.waitForSelector('#player iframe');
  await page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#notice').innerText(),'A board saved by an earlier version could not be opened. It has been kept, and this game starts new.');
  const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  const stored=await page.evaluate(k=>({saves:JSON.parse(localStorage.getItem(k)),refused:JSON.parse(localStorage.getItem(k.replace(':saves',':refused')))}),KEY);
  assert.deepEqual(stored.refused.slant.state,broken.state,'the refused save is kept as it was');
  assert.equal(stored.refused.slant.source,old.slant.source);
  assert.equal(stored.saves.slant.source,game.commit,'Home saved the new board in its place');
});

// An update does not move every game to a new source commit, and a save can be damaged in the build that made it.
// A save this same build refuses is kept aside as well, so neither the next move nor Home writes over it.
const REFUSED=KEY.replace(':saves',':refused');
const stored=page=>page.evaluate(([saves,refused])=>({saves:JSON.parse(localStorage.getItem(saves)),refused:JSON.parse(localStorage.getItem(refused))}),[KEY,REFUSED]);
async function refusedOpen(t,id,state){
  const game=h.games.find(g=>g.id===id),ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{[KEY]:JSON.stringify({[id]:{source:game.commit,state,savedAt:1}})}}});t.after(()=>ctx.close());
  const page=await ctx.newPage();
  await page.clock.install({time:new Date('2026-11-16T12:00:00Z')});await page.clock.pauseAt(new Date('2026-11-16T12:00:01Z'));
  await page.goto(h.ORIGIN+'/export/index.html');await h.open(page,id);
  await page.waitForSelector('#player iframe');
  await page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#notice').innerText(),'A saved board could not be opened. It has been kept, and this game starts new.');
  const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();
  const kept=(await stored(page)).refused[id];
  assert.deepEqual(kept.state,state,'the refused save is kept as it was');
  assert.deepEqual([kept.source,kept.by],[game.commit,game.commit]);
  return {game,ctx,page,frame};
}
test('a save from this same build that cannot be read is kept aside too: the next move and Home leave it alone',async t=>{
  const state={at:'no-such-board'},{game,ctx,page,frame}=await refusedOpen(t,'slant',state);
  // The next move saves the new board in the library's own record.
  await a.keyMove(frame,'slant');
  await page.waitForFunction(([key])=>JSON.parse(localStorage.getItem(key)).slant.state.at!=='no-such-board',[KEY]);
  assert.deepEqual((await stored(page)).refused.slant.state,state);
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  const after=await stored(page);
  assert.deepEqual(after.refused.slant.state,state,'still there after Home');
  assert.equal(after.saves.slant.source,game.commit);assert.notEqual(after.saves.slant.state.at,'no-such-board');
  assert.deepEqual(ctx.parity.errors,[]);
});

test('Cast: a damaged Undo history on the waiting board is refused at restore, not met at a later Undo',async t=>{
  const game=h.games.find(g=>g.id==='cast'),ctx=await h.context(await getBrowser(),{width:390,height:844});t.after(()=>ctx.close());
  const {frame}=await h.shell(ctx,game);
  const live=await h.snapshot(frame);
  // The board that waits while the other is played (the free board here), empty, with nothing to undo.
  const parked=await frame.evaluate(()=>{const board=CastFree.board(7);return{board:board.id,seed:board.seed,heights:Array.from({length:board.n},()=>Array(board.n).fill(0)),hits:0,history:[]};});
  await frame.evaluate(state=>MinimalAdapter.restore(state),{...live,parked});
  const sound=await h.snapshot(frame);
  assert.deepEqual(sound.parked,parked,'a waiting board with a sound history is restored');
  // The same board with one Undo step the engine cannot read: its heights are an empty grid.
  const damaged={...live,parked:{...parked,history:[{heights:[],hits:0}]}};
  await assert.rejects(frame.evaluate(state=>MinimalAdapter.restore(state),damaged),/Invalid Cast snapshot/);
  for(const step of [null,{heights:parked.heights},{heights:parked.heights,hits:-1}])
    await assert.rejects(frame.evaluate(state=>MinimalAdapter.restore(state),{...live,parked:{...parked,history:[step]}}),/Invalid Cast snapshot/,JSON.stringify(step));
  h.sameSnapshot(await h.snapshot(frame),sound,'the open board and the waiting one are as they were');
  assert.deepEqual(ctx.parity.errors,[]);
  // Opened from the library, that save is refused when the game opens, kept aside, and the player is told.
  const opened=await refusedOpen(t,'cast',damaged);
  assert.equal((await h.snapshot(opened.frame)).parked,null,'the game starts new');
  assert.deepEqual(opened.ctx.parity.errors,[]);
});

// A device with no room: the copy of a refused save cannot be written. The save itself is then the only copy, so it
// stays where it is (no move, Home or reload writes over it), the player is told that and not that it "has been
// kept", and the copy is made, and play saved again, as soon as there is room.
test('a refused save the device has no room to set aside is left in place, said truthfully, and set aside when room returns',async t=>{
  const game=h.games.find(g=>g.id==='slant'),state={at:'no-such-board',pad:'x'.repeat(60000)};
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{[KEY]:JSON.stringify({slant:{source:game.commit,state,savedAt:1}})}}});t.after(()=>ctx.close());
  // The library's own storage holds 100,000 characters in all: the save (60,000) fits, a second copy of it does not,
  // and a new small board in its place would.
  await ctx.addInitScript(()=>{
    if(parent!==window)return;
    window.__room=100000;
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(this===window.localStorage){let used=String(value).length;for(let n=0;n<this.length;n++){const other=this.key(n);if(other!==key)used+=this.getItem(other).length;}
        if(used>window.__room)throw new DOMException('Fixture storage full','QuotaExceededError');}
      return set.call(this,key,value);
    };
  });
  const NO_ROOM='A saved board could not be opened, and this device has no room to set it aside. It is left as it was, and new moves in this game are not saved for now.';
  const page=await ctx.newPage();
  await page.clock.install({time:new Date('2026-11-16T12:00:00Z')});await page.clock.pauseAt(new Date('2026-11-16T12:00:01Z'));
  await page.goto(h.ORIGIN+'/export/index.html');
  const open=async()=>{await h.open(page,'slant');await page.waitForSelector('#player iframe');await page.locator('#notice:not([hidden])').waitFor();
    const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();await h.ready(frame,true);return frame;};
  const original=async why=>{const now=await stored(page);assert.deepEqual(now.saves.slant.state,state,why);assert.equal(now.refused,null,why+': no copy could be written');};
  let frame=await open();
  assert.equal(await page.locator('#notice').innerText(),NO_ROOM);
  await original('at the refusal');
  await a.keyMove(frame,'slant');await page.clock.runFor(500);await original('after a move');
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));await original('after Home');
  // Opened again with still no room: the same, and closing the app with the game open changes nothing either.
  await page.clock.runFor(5100);frame=await open();
  assert.equal(await page.locator('#notice').innerText(),NO_ROOM);
  await a.keyMove(frame,'slant');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await original('after closing with the game open');
  // Room returns: the next move sets the refused save aside, and only then saves the new board in its place.
  await page.evaluate(()=>{window.__room=1e9;});
  await a.keyMove(frame,'slant');
  await page.waitForFunction(([key])=>JSON.parse(localStorage.getItem(key)).slant.state.at!=='no-such-board',[KEY]);
  let now=await stored(page);
  assert.deepEqual(now.refused.slant.state,state,'the refused save, whole, set aside first');
  assert.deepEqual([now.refused.slant.source,now.refused.slant.by],[game.commit,game.commit]);
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  now=await stored(page);assert.deepEqual(now.refused.slant.state,state);assert.notEqual(now.saves.slant.state.at,'no-such-board');
  assert.deepEqual(ctx.parity.errors,[]);
});
