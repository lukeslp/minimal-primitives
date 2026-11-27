'use strict';
// An app update moves games to a newer source commit. A player's unfinished board and progress live in the
// library's saves, made by the older build; the update must still open them. Each fixture holds one save per
// game, taken in a shipped build: a move on the first board, then Home. saves-2ba8a67.json is from 0.5.5
// (game-riffs 2ba8a67), saves-c965c4f.json from 0.5.7 (c965c4f, with Cube Maze, Tangles and Weaves),
// saves-261303e.json from 0.5.8 (261303e), saves-d3d9b9e.json from 0.5.9 (d3d9b9e), saves-29b29ad.json from 0.5.10
// (29b29ad), saves-4a9c688.json from 0.5.13 (4a9c688; Spiral Galaxies at 476d1b9d and Cast at 5fea7b69, each save
// names its own source), saves-e9331aaa.json from 0.5.14 (e9331aaa), saves-48f0b354.json from 0.5.19 (48f0b354; no
// save shape changed from 0.5.15 to 0.5.19, so those builds have none). Add one from each shipped build before its
// games are pinned again.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
const KEY='lukesteuber.minimal.collection.v1:saves';
const FIXTURES=[['0.5.5','saves-2ba8a67.json'],['0.5.7','saves-c965c4f.json'],['0.5.8','saves-261303e.json'],['0.5.9','saves-d3d9b9e.json'],['0.5.10','saves-29b29ad.json'],['0.5.13','saves-4a9c688.json'],['0.5.14','saves-e9331aaa.json'],['0.5.19','saves-48f0b354.json']].map(([build,name])=>{const fixture=fs.readFileSync(path.join(__dirname,'upgrade-fixtures',name),'utf8');return{build,fixture,old:JSON.parse(fixture)};});
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
// optional cloths dealt after its course (`pool`). Since game-riffs 57d75298 (0.5.14) Tilt, Tilt 3D, Cube Maze and
// Weaves carry their wins after the campaign (`plus`), none in an older save. Since game-riffs 69ee5cb3 (0.5.15)
// Horologist's snapshot says whether the opening boards were left (`opening`, its own opening.v1 mark, never set by
// an older build) and which board they go back to (`resume`, none outside them). Since game-riffs PR 283 (0.5.20)
// Balance's snapshot carries its generated board (`generated`, none in a fresh game) and its wins after the campaign
// (`plus`, a count with the board last counted and no list). A save on a first board restores with them added.
const PLUS={plus:{version:1,wins:0,held:'',set:[]}};
const BALANCE_ADDED=s=>({...s,generated:null,plus:{version:1,wins:0,held:''}});
const ADDED={balance:BALANCE_ADDED,tilt:s=>({...s,order:3,pool:s.pool||[],...PLUS}),'tilt-3d':s=>({...s,order:3,pool:s.pool||[],...PLUS}),cast:s=>({...s,order:3}),horologist:s=>({...s,order:3,pool:s.pool||[],opening:false,resume:null}),
  // Shoo's page left `wasSolved` behind in game-riffs PR 206 (it only moved focus to Next); the snapshot no longer carries it.
  'shoo-minimal':({wasSolved,...s})=>({...s,store:{...s.store,pool:s.store.pool||[]}}),'cube-maze':s=>({...s,pool:[],...PLUS}),tangles:s=>({...s,order:2,more:[]}),
  fold:s=>({...s,progress:{version:3,completed:s.progress.completed,available:s.progress.available,newGamePlus:s.progress.newGamePlus,pool:[]}}),
  weaves:s=>({...s,history:s.history.map(h=>({...h,kept:h.kept||[]})),kept:s.kept||[],keepMode:!!s.keepMode,course:1,courseReached:s.course===1?s.courseReached:Math.max(0,...s.finished.map(id=>['w01','w02','w03','c01','c02','w04'].indexOf(id)+1)),pool:[],...PLUS})};
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

// Board 21 changed in game-riffs 5fea7b69: c25, whose floor outline drew a swastika, left the campaign and c27 took its
// place. A library save standing on c25 opens c27 fresh, where the game opens its own save there, and a finished c25
// also marks c27.
test('cast: a save on c25 opens c27, where the game opens its own',async t=>{
  const c=CASES.find(x=>x.game==='cast'&&x.case==='drop'),game=h.games.find(g=>g.id==='cast');
  const zero=Array.from({length:5},()=>Array(5).fill(0)),key=Object.keys(c.native).find(k=>k.endsWith(':cast-3d.v1'));
  const finished=[...new Set([...c.save.state.finished.filter(id=>id!=='c27'),'c25'])];
  const state={...c.save.state,board:'c25',heights:zero,hits:0,history:[],hint:null,finished};
  const native={[key]:JSON.stringify({...JSON.parse(c.native[key]),board:'c25',heights:zero,hits:0,history:[],finished})};
  const library=await opened(t,game,{[KEY]:JSON.stringify({cast:{...c.save,state}})});
  const own=await opened(t,game,native);
  const got=where('cast',library.state),want=where('cast',own.state);
  assert.deepEqual(got,want,'the library save opens where the game opens its own');
  assert.equal(got.board,'c27','board 21 is c27');
  assert.ok(got.finished.includes('c25')&&got.finished.includes('c27'),'a finished c25 also marks c27');
  assert.deepEqual([library.state.heights,library.state.hits],[zero,0],'c27 opens fresh');
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

// Balance in 0.5.20 (game-riffs PR 283): after its 39 boards Next deals generated boards, kept under the game's own
// balance.generated.v1 ({version, n, seed, marks, playing}), and counts their wins under balance.plus.v1 ({version, wins,
// held}). The upgrade cases come from the shipped 0.5.19 build (game-riffs 48f0b354): part way through the campaign
// (`mid`: b01 to b04 finished, on b05 with marks) and with the campaign just finished on b39 (`fin`); one move, then
// Home. `save` is the library save, `native` every key the 0.5.19 game itself held then.
const CASES_0519=JSON.parse(fs.readFileSync(path.join(__dirname,'upgrade-fixtures','saves-48f0b354-cases.json'),'utf8')).cases;
const balanceGame=()=>h.games.find(g=>g.id==='balance');
const balanceOpen=async page=>{await page.waitForFunction(()=>window.__parityMessages.some(m=>m.game==='balance'&&m.type==='open'));return page.evaluate(()=>window.__parityMessages.filter(m=>m.game==='balance'&&m.type==='open').at(-1).payload);};
// Next until a generated board is dealt: a deal can fail, and the game then asks for Next again.
const dealGenerated=async frame=>{for(let n=0;n<6&&await frame.evaluate(()=>__balance.at)!=='generated';n++)await frame.locator('#next-btn').click();assert.equal(await frame.evaluate(()=>__balance.at),'generated','Next deals a generated board');};
for(const c of CASES_0519)test(`balance: a 0.5.19 save (${c.case}) restores unchanged`,async t=>{
  const game=balanceGame();
  assert.equal(c.save.source.slice(0,8),'48f0b354');
  const library=await opened(t,game,{[KEY]:JSON.stringify({balance:c.save})});
  // Every field the 0.5.19 snapshot had comes back as it was saved; the two new records are a fresh game's.
  h.sameSnapshot(library.state,BALANCE_ADDED(c.save.state),'balance '+c.case+' restores the saved state');
  const own=await opened(t,game,c.native);
  const both=await opened(t,game,{...c.native,[KEY]:JSON.stringify({balance:c.save})});
  const want=where('balance',own.state);
  assert.deepEqual(where('balance',library.state),want,'balance '+c.case+' opens where the game opens its own 0.5.19 save');
  assert.deepEqual(where('balance',both.state),want,'balance '+c.case+' with both saves on the device');
  for(const id of c.save.state.progress.completed)assert.ok(want.finished.includes(id),`balance ${c.case}: ${id} stays finished`);
  const opened0519=await balanceOpen(library.page);
  assert.deepEqual([opened0519.identity.puzzleId,opened0519.identity.mode],[c.save.state.at,'campaign']);
  if(c.case==='fin'){
    // The campaign finished in 0.5.19 now goes on: Next deals a generated board, reported as one.
    assert.equal(await library.frame.locator('#next-btn').getAttribute('aria-label'),'Start New Game+');
    await dealGenerated(library.frame);
    const g=await library.frame.evaluate(()=>__balance.generated);
    const now=await balanceOpen(library.page);
    assert.deepEqual([now.identity.puzzleId,now.identity.mode,now.repeat],[`endless:${g.n}:${g.seed}`,'endless',false]);
    assert.equal((await h.snapshot(library.frame)).progress.completed.length,39,'the campaign count does not move');
  }
  await home(library.page,game);
});

test('balance: a snapshot taken on a generated board restores to that board, with its marks and Undo, in a fresh document',async t=>{
  const game=balanceGame(),fin=CASES_0519.find(c=>c.case==='fin');
  const {ctx,page,frame}=await opened(t,game,fin.native);
  await dealGenerated(frame);
  // One move on the new board, so there are marks and an Undo step to carry.
  await frame.locator('#board .cell:not([aria-readonly])').first().focus();await page.keyboard.press('Enter');await page.clock.runFor(100);
  const state=await h.snapshot(frame);
  assert.equal(state.at,'generated');assert.equal(state.state.solved,false);assert.equal(state.state.undo.length,1);
  assert.deepEqual(state.generated.marks,state.state.cells,'the board record holds the marks');
  const id=`endless:${state.generated.n}:${state.generated.seed}`;
  // Only the library's save on the device, and then the library's save beside the game's own 0.5.19 keys.
  for(const [name,seed] of [['library only',{}],['beside the 0.5.19 keys',fin.native]]){
    const fresh=await opened(t,game,{...seed,[KEY]:JSON.stringify({balance:{source:game.commit,state,savedAt:1}})});
    h.sameSnapshot(fresh.state,state,name+': the same board, marks, Undo and records');
    assert.deepEqual(await fresh.frame.evaluate(()=>[__balance.at,__balance.generated.seed,__balance.S.cells.slice()]),['generated',state.generated.seed,state.state.cells],name);
    const now=await balanceOpen(fresh.page);
    assert.deepEqual([now.identity.puzzleId,now.identity.mode],[id,'endless'],name+': reported as the endless board');
    // The game's own key now holds the board too, so the game alone would open it again.
    assert.deepEqual(JSON.parse(await fresh.frame.evaluate(()=>localStorage.getItem('balance.generated.v1'))),state.generated,name);
    await home(fresh.page,game);
  }
  assert.deepEqual(ctx.parity.errors,[]);
});

test('balance: a restore never takes a win back, keeps the game\'s own records under an older snapshot, and refuses what it cannot read',async t=>{
  const game=balanceGame(),mid=CASES_0519.find(c=>c.case==='mid'),fin=CASES_0519.find(c=>c.case==='fin');
  const G=require(path.join(h.ROOT,'imports/balance/endless.js')),E=require(path.join(h.ROOT,'imports/balance/engine.js'));
  const p=G.deal(4242,new Set());assert.ok(p,'a board from seed 4242');
  const record={version:1,n:p.n,seed:p.seed,marks:E.start(p),playing:true};
  const plusName='lukesteuber.minimal.balance:balance.plus.v1',genName='lukesteuber.minimal.balance:balance.generated.v1';
  const {ctx,frame}=await opened(t,game,{...fin.native,[genName]:JSON.stringify(record),[plusName]:JSON.stringify({version:1,wins:5,held:'h5'})});
  const records=()=>frame.evaluate(()=>({plus:{...__balance.plus},generated:__balance.generated&&{...__balance.generated},stored:JSON.parse(localStorage.getItem('balance.plus.v1'))}));
  const base=await h.snapshot(frame);
  assert.deepEqual([base.at,base.generated,base.plus],['generated',record,{version:1,wins:5,held:'h5'}],'the game resumes its own generated board');
  const restore=s=>frame.evaluate(s=>MinimalAdapter.restore(s),s);
  // A lower count leaves the higher one; a higher one is taken with the board it counted last, and written.
  await restore({...base,plus:{version:1,wins:3,held:'h3'}});
  assert.deepEqual((await records()).plus,{version:1,wins:5,held:'h5'},'a lower count never takes a win back');
  await restore({...base,plus:{version:1,wins:7,held:'h7'}});
  assert.deepEqual(await records(),{plus:{version:1,wins:7,held:'h7'},generated:record,stored:{version:1,wins:7,held:'h7'}});
  // A 0.5.19 snapshot has neither record: the count stays, and the game's generated board stays, set aside while the
  // player is on the campaign board the snapshot names.
  await restore(mid.save.state);
  const after=await records(),now=await h.snapshot(frame);
  assert.deepEqual(after.plus,{version:1,wins:7,held:'h7'});
  assert.deepEqual(after.generated,{...record,playing:false},'the generated board is kept, not played');
  h.sameSnapshot({...now,generated:null,plus:{version:1,wins:0,held:''}},BALANCE_ADDED(mid.save.state),'the 0.5.19 snapshot restores unchanged');
  // What cannot be read is refused, and the game is left as it was.
  const good=await h.snapshot(frame);
  for(const [why,bad] of [['a negative count',{...good,plus:{version:1,wins:-1,held:''}}],['a count with a list',{...good,plus:{version:1,wins:9,held:'',set:[]}}],
    ['a generated board with no record',{...good,at:'generated',generated:null}],['a generated board from an older snapshot',(({generated,plus,...s})=>({...s,at:'generated'}))(good)],
    ['marks that do not fit the board',{...good,generated:{...record,marks:record.marks.slice(1)}}],['a size the game does not deal',{...good,generated:{...record,n:4}}],
    ['marks off the board in hand',{...good,at:'generated',generated:record,state:{...good.state,cells:record.marks.slice(1)}}]]){
    await assert.rejects(restore(bad),/Invalid Balance snapshot/,why);
    h.sameSnapshot(await h.snapshot(frame),good,why+': nothing changed');
  }
  assert.deepEqual(ctx.parity.errors,[]);
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
