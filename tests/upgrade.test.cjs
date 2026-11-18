'use strict';
// An app update moves games to a newer source commit. A player's unfinished board and progress live in the
// library's saves, made by the older build; the update must still open them. Each fixture holds one save per
// game, taken in a shipped build: a move on the first board, then Home. saves-2ba8a67.json is from 0.5.5
// (game-riffs 2ba8a67), saves-c965c4f.json from 0.5.7 (c965c4f, with Cube Maze, Tangles and Weaves),
// saves-261303e.json from 0.5.8 (261303e), saves-d3d9b9e.json from 0.5.9 (d3d9b9e), saves-29b29ad.json from 0.5.10
// (29b29ad). Add one from each shipped build
// before its games are pinned again.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
const KEY='lukesteuber.minimal.collection.v1:saves';
const FIXTURES=[['0.5.5','saves-2ba8a67.json'],['0.5.7','saves-c965c4f.json'],['0.5.8','saves-261303e.json'],['0.5.9','saves-d3d9b9e.json'],['0.5.10','saves-29b29ad.json']].map(([build,name])=>{const fixture=fs.readFileSync(path.join(__dirname,'upgrade-fixtures',name),'utf8');return{build,fixture,old:JSON.parse(fixture)};});
const {old}=FIXTURES[0];
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
// Bending's saves changed shape in game-riffs d3d9b9e (0.5.9): progress is kept under each board's name (v3), and
// an older record, kept by place, is converted once. Its saves from earlier builds cannot come back unchanged, so
// they are checked as the reordered games' midway saves are, below: against the game's own reading of the same save.
const CONVERTED={bending:old=>({'rimlight.dark.v2':JSON.stringify(old.record)})};
// Fields this build's saves carry that earlier ones did not. Since game-riffs d3d9b9e: `pool` lists the New Game+ or
// pool boards dealt. Since 9ad63d8 (0.5.10): `order: 3` (Tilt, Tilt 3D, Cast, Horologist) or `order: 2` (Tangles) says
// reached counts in the twenty-five-board campaign; Tangles keeps the boards it had open outside the course (`more`);
// Folding's progress is v3, counted in the campaign; Weaves keeps settled marks (`kept`, also on each Undo step), the
// mark mode and how far its sixteen-board course is open. Since game-riffs PR 201 (0.5.11) Weaves also keeps the
// optional cloths dealt after its course (`pool`). A save on a first board restores with them added.
const ADDED={tilt:s=>({...s,order:3,pool:s.pool||[]}),'tilt-3d':s=>({...s,order:3,pool:s.pool||[]}),cast:s=>({...s,order:3}),horologist:s=>({...s,order:3,pool:[]}),
  // Shoo's page left `wasSolved` behind in game-riffs PR 206 (it only moved focus to Next); the snapshot no longer carries it.
  'shoo-minimal':({wasSolved,...s})=>({...s,store:{...s.store,pool:s.store.pool||[]}}),'cube-maze':s=>({...s,pool:[]}),tangles:s=>({...s,order:2,more:[]}),
  fold:s=>({...s,progress:{version:3,completed:s.progress.completed,available:s.progress.available,newGamePlus:s.progress.newGamePlus,pool:[]}}),
  weaves:s=>({...s,history:s.history.map(h=>({...h,kept:h.kept||[]})),kept:s.kept||[],keepMode:!!s.keepMode,course:1,courseReached:s.course===1?s.courseReached:Math.max(0,...s.finished.map(id=>['w01','w02','w03','c01','c02','w04'].indexOf(id)+1)),pool:[]})};
// Where a save leaves the player, in this build's terms: the board, what is finished, how far the campaign is open,
// and for Bending the stage on the saved board.
function where(id,s){
  if(id==='bending'){const r=s.named;return{board:r.board,done:r.done,open:r.open};}
  const finished=s.progress?.completed??s.done??s.finished??s.completed;
  return{at:s.at??null,board:s.store?.at??s.board??null,finished:[...(finished||[])].sort(),reached:s.reached??s.progress?.available??null,order:s.order??null,
    // Weaves' course and Tangles' More boards (game-riffs 9ad63d8).
    ...(id==='weaves'?{courseReached:s.courseReached}:{}),...(id==='tangles'?{more:[...(s.more||[])].sort()}:{})};
}
async function opened(t,game,localStorage){
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  assert.equal(await page.locator('#notice:not([hidden])').count(),0,'no notice is shown');
  return {ctx,page,frame,state:await h.snapshot(frame)};
}
async function home(page,game){
  await page.locator('#player iframe').contentFrame().locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  const now=await page.evaluate(([k,id])=>JSON.parse(localStorage.getItem(k))[id],[KEY,game.id]);
  assert.equal(now.source,game.commit,'the save is kept, now from this build');
  return now;
}
for(const {build,fixture,old} of FIXTURES)for(const game of h.games.filter(g=>old[g.id]))test(`${game.id}: a save from the ${build} build opens after the update`,async t=>{
  assert.notEqual(old[game.id].source,game.commit,'the fixture is from an older source commit');
  // shell() waits for the restore and fails on a restore error.
  const {page,state}=await opened(t,game,{[KEY]:fixture});
  if(CONVERTED[game.id]){
    // The library's save opens where the game itself opens the same record kept natively by the old build.
    const native=Object.fromEntries(Object.entries(CONVERTED[game.id](old[game.id].state)).map(([k,v])=>[`lukesteuber.minimal.${game.id}:${k}`,v]));
    const own=await opened(t,game,native);
    assert.deepEqual(where(game.id,state),where(game.id,own.state),game.id+' opens where the game opens its own old save');
  }
  // The board, its Undo history, progress and settings are the ones the old build saved, not a fresh game's.
  else h.sameSnapshot(state,(ADDED[game.id]||(s=>s))(old[game.id].state),game.id+' restores the saved state');
  await home(page,game);
});

// Midway saves from the shipped 0.5.8 build, for every game whose board order or save shape changes in 0.5.9
// (game-riffs d3d9b9e): Shoo, Tilt, Tilt 3D and Cast play thirty boards (Shoo of eighty, the others of fifty) and
// count how far the campaign is open in campaign places; Bending keeps thirty stages, by name; Horologist, Akari,
// Bridges and Spiral Galaxies play their boards in a new order; Towers, Tents and Balance gain boards. Each game's
// 0.5.8 page was opened on its own native save part way through (`native`), and the library save 0.5.8 made from it
// is `saves`. The library save must open where this build's game opens that native save: the game's own reading is
// the upstream migration, tested there. Several saves sit on a board the new campaign leaves out.
const MIDWAY=JSON.parse(fs.readFileSync(path.join(__dirname,'upgrade-fixtures','saves-261303e-midway.json'),'utf8'));
for(const game of h.games.filter(g=>MIDWAY.saves[g.id]))test(`${game.id}: a midway save from the 0.5.8 build opens where the game opens its own`,async t=>{
  const saved=MIDWAY.saves[game.id];
  assert.equal(saved.source.slice(0,7),'261303e');
  const library=await opened(t,game,{[KEY]:JSON.stringify({[game.id]:saved})});
  const own=await opened(t,game,MIDWAY.native[game.id]);
  const got=where(game.id,library.state),want=where(game.id,own.state);
  assert.deepEqual(got,want,game.id+' opens where the game opens its own 0.5.8 save');
  // Nothing finished is lost: every board the old save had finished that this build still has stays finished.
  if(game.id!=='bending')assert.ok(got.finished.length>=Math.min(where(game.id,saved.state).finished.length,want.finished.length),'finished boards kept');
  // Bending's save is on a stage the thirty keep: the planet placed there in 0.5.8 is still on it.
  else{const r=saved.state.record;assert.deepEqual(library.state.named.stages[got.board].planets,r.stages[r.board].planets,'the stage keeps its planets');}
  await home(library.page,game);
});

// Upgrade cases from the shipped 0.5.9 build, for every game whose campaign or save shape changes in 0.5.10 (game-riffs
// 9ad63d8): Tilt, Tilt 3D, Cast, Cube Maze, Folding, Spiral Galaxies, Horologist, Shoo and Tangles play twenty-five
// boards, Bending's campaign loses five stages to New Game+, and Weaves becomes a sixteen-board course with optional
// cloths. Each case started 0.5.9 from the game's own save (`seed`): part way through (`mid`), on a board the new
// campaign drops (`drop`), with 0.5.9's campaign finished and the player on a board the new campaign drops (`fin`),
// and for Weaves on a large optional cloth with a move made (`opt`). One move, then Home: `save` is the library save,
// `native` every key the 0.5.9 game itself held then. Opened from the library save, from the game's own keys, or from
// both (as on a phone that played 0.5.9), the game opens in the same place, as this build's game reads its own save.
const CASES=JSON.parse(fs.readFileSync(path.join(__dirname,'upgrade-fixtures','saves-d3d9b9e-cases.json'),'utf8')).cases;
for(const c of CASES)test(`${c.game}: a 0.5.9 save (${c.case}) opens where the game opens its own`,async t=>{
  const game=h.games.find(g=>g.id===c.game);
  assert.equal(c.save.source.slice(0,7),'d3d9b9e');
  const library=await opened(t,game,{[KEY]:JSON.stringify({[c.game]:c.save})});
  const own=await opened(t,game,c.native);
  const both=await opened(t,game,{...c.native,[KEY]:JSON.stringify({[c.game]:c.save})});
  const got=where(c.game,library.state),want=where(c.game,own.state);
  assert.deepEqual(got,want,c.game+' '+c.case+' opens where the game opens its own 0.5.9 save');
  assert.deepEqual(where(c.game,both.state),want,c.game+' '+c.case+' with both saves on the device');
  // Nothing finished is lost: every board the 0.5.9 save had finished stays finished (Bending keeps a stage that left
  // the campaign under its name).
  const done=w=>w.finished||w.done,before=done(where(c.game,c.save.state));
  assert.ok(before.length>0||c.case==='mid');
  for(const id of before)assert.ok(done(got).includes(id),`${c.game} ${c.case}: ${id} stays finished`);
  await home(library.page,game);
});

// Upgrade cases from the shipped 0.5.10 build (game-riffs 29b29ad), for the two games whose saves change in 0.5.11.
// Towers (PR 202) puts a fixed tower on eleven campaign boards; the cases hold marks of another height where the new
// towers stand, on the board in hand and on boards kept in the store (`mid`, `fin`), and on a board that also gains
// clues (`clues`). Weaves (PR 201) deals its optional cloths after the sixteen-board course and keeps the round in
// `pool`: part way through the course (`mid`), on an optional cloth before it is done (`opt`), and on an optional
// cloth with the course done (`fin`, an endless cloth now). Opened from the library save, the game's own keys or both,
// the game opens in the same place with the same marks, and nothing finished is lost.
const CASES_0510=JSON.parse(fs.readFileSync(path.join(__dirname,'upgrade-fixtures','saves-29b29ad-cases.json'),'utf8')).cases;
const marks=(id,s)=>id==='towers'?{cells:s.S.cells,boards:s.store.boards}:{grid:s.grid,pool:s.pool};
for(const c of CASES_0510)test(`${c.game}: a 0.5.10 save (${c.case}) opens where the game opens its own`,async t=>{
  const game=h.games.find(g=>g.id===c.game);
  assert.equal(c.save.source.slice(0,7),'29b29ad');
  const library=await opened(t,game,{[KEY]:JSON.stringify({[c.game]:c.save})});
  const own=await opened(t,game,c.native);
  const both=await opened(t,game,{...c.native,[KEY]:JSON.stringify({[c.game]:c.save})});
  const want=where(c.game,own.state);
  assert.deepEqual(where(c.game,library.state),want,c.game+' '+c.case+' opens where the game opens its own 0.5.10 save');
  assert.deepEqual(where(c.game,both.state),want,c.game+' '+c.case+' with both saves on the device');
  assert.deepEqual(marks(c.game,library.state),marks(c.game,own.state),c.game+' '+c.case+': the same marks as the game reads');
  assert.deepEqual(marks(c.game,both.state),marks(c.game,own.state),c.game+' '+c.case+': the same marks with both saves');
  for(const id of where(c.game,c.save.state).finished)assert.ok(want.finished.includes(id),`${c.game} ${c.case}: ${id} stays finished`);
  if(c.game==='towers'){
    // Every fixed tower stands at its height in the board in hand, and the marks elsewhere are the saved ones.
    const s=library.state,saved=c.save.state.S.cells,given=require(path.join(__dirname,'..','imports','towers','levels.js')).find(p=>p.id===s.at).given;
    s.S.cells.forEach((v,i)=>assert.equal(v,given[i]||saved[i],`${c.case}: cell ${i}`));
  }
  await home(library.page,game);
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
