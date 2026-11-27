'use strict';
// Wins after the campaign (game-riffs 57d75298): each game keeps them under `<save prefix>.plus.v1`. Here, in the
// built package: Tilt, Tilt · 3D and Cube Maze report a New Game+ board as mode 'plus' (a repeat once won there),
// never as a first-time campaign finish; their snapshots carry the count and a restore never takes a win back.
// Weaves' snapshot of an endless cloth (id g and its seed) restores in a fresh document, as mode 'endless'.
// Balance (game-riffs PR 283) deals generated boards after its campaign, reported as mode 'endless'; Spiral Galaxies
// (PR 282) deals a New Game+ board fresh when its saved marks already solve it.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs');
const ROOT=h.ROOT,ns=(game,key)=>`lukesteuber.minimal.${game}:${key}`;
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
const viewport={width:390,height:844};
const gameOf=id=>h.games.find(g=>g.id===id);
const load=rel=>require(path.join(ROOT,'imports',rel));
// The parent's last 'open' for this game, once its identity is ready.
async function lastOpen(page,game){
  await page.waitForFunction(g=>window.__parityMessages.some(m=>m.game===g&&m.type==='open'),game);
  return page.evaluate(g=>window.__parityMessages.filter(m=>m.game===g&&m.type==='open').at(-1).payload,game);
}
const plusOf=(frame,key)=>frame.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);

const tilts=[
  {id:'tilt',all:load('tilt/levels.js'),campaign:load('tilt/campaign.js'),plusStore:'tilt-levels-grok.plus.v1',
    save:(board,done)=>['tilt-levels-grok.v1',{campaign:2,order:3,reached:24,board,done,theme:'dark',motion:'reduce',pool:[]}]},
  {id:'tilt-3d',all:load('tilt-3d/levels.js'),campaign:load('tilt-3d/campaign.js'),plusStore:'tilt-3d.plus.v1',
    save:(board,done)=>['tilt-3d.v1',{version:1,order:3,board,moves:[],done,reached:24,pool:[],settings:{theme:'dark',motion:'reduce'}}]},
  {id:'cube-maze',all:load('cube-maze/boards.js'),campaign:load('cube-maze/campaign.js'),plusStore:'cube-maze.plus.v1',
    save:(board,completed)=>['cube-maze.v1',{version:1,board,moves:[],completed,settings:{motion:'reduce'},pool:[]}]},
];
for(const g of tilts)test(`${g.id}: a New Game+ board is reported as one, and its wins survive snapshot and restore`,async t=>{
  const pool=g.all.map(b=>b.id).filter(id=>!g.campaign.includes(id));
  assert.equal(g.campaign.length,25);assert.equal(pool.length,25);
  const [key,save]=g.save(pool[0],g.campaign.slice());
  const seeded={version:1,wins:3,held:pool[1],set:[pool[1]]};
  const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:{[ns(g.id,key)]:JSON.stringify(save),[ns(g.id,g.plusStore)]:JSON.stringify(seeded)}}});
  t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,gameOf(g.id));
  const opened=await lastOpen(page,g.id);
  assert.equal(opened.identity.puzzleId,pool[0]);
  assert.equal(opened.identity.mode,'plus','a pool board is New Game+, not the campaign');
  assert.equal(opened.repeat,false,'not won since the count began');
  const state=await h.snapshot(frame);
  assert.deepEqual(state.plus,seeded,'the snapshot carries the count');
  // A snapshot from 0.5.13 has no count: restoring it leaves the game's own.
  const old={...state};delete old.plus;
  await frame.evaluate(s=>MinimalAdapter.restore(s),old);
  assert.deepEqual((await h.snapshot(frame)).plus,seeded);
  // A newer count is taken; an older one never takes a win back, and solved boards are never forgotten.
  await frame.evaluate(s=>MinimalAdapter.restore(s),{...state,plus:{version:1,wins:5,held:pool[2],set:[pool[2]]}});
  const merged={version:1,wins:5,held:pool[2],set:[pool[1],pool[2]]};
  assert.deepEqual((await h.snapshot(frame)).plus,merged);
  assert.deepEqual(await plusOf(frame,g.plusStore),merged,'written to the game\'s own key');
  await frame.evaluate(s=>MinimalAdapter.restore(s),{...state,plus:{version:1,wins:1,held:pool[3],set:[pool[3]]}});
  assert.deepEqual((await h.snapshot(frame)).plus,{...merged,set:[pool[1],pool[2],pool[3]]});
  // An unreadable count refuses the snapshot, as any unreadable field does, and the game is left as it was.
  await assert.rejects(frame.evaluate(s=>MinimalAdapter.restore(s),{...state,plus:{version:1,wins:-1,held:'',set:[]}}));
  assert.equal((await h.snapshot(frame)).plus.wins,5);
  // A pool board already won there opens as a repeat; a campaign board is still the campaign.
  await frame.evaluate(s=>MinimalAdapter.restore(s),{...state,board:pool[1]});
  const again=await lastOpen(page,g.id);
  assert.equal(again.identity.puzzleId,pool[1]);assert.equal(again.identity.mode,'plus');assert.equal(again.repeat,true);
  await frame.evaluate(s=>MinimalAdapter.restore(s),{...state,board:g.campaign[3]});
  const campaign=await lastOpen(page,g.id);
  assert.equal(campaign.identity.puzzleId,g.campaign[3]);assert.equal(campaign.identity.mode,'campaign');assert.equal(campaign.repeat,true);
  assert.deepEqual(ctx.parity.errors,[]);
});

test('weaves: an endless cloth\'s snapshot restores in a fresh document',async t=>{
  const E=load('weaves/engine.js'),course=load('weaves/course.js'),game=gameOf('weaves');
  const main=course.main.map(b=>b.id);assert.equal(main.length,16);
  const save={board:main[0],grid:E.start(course.main[0]),hits:0,history:[],kept:[],finished:main,settings:{theme:'dark',motion:'reduce'},campaign:1,reached:0,course:1,courseReached:15,pool:[]};
  const seed={[ns('weaves','weave-minimal.v1')]:JSON.stringify(save)};
  const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:seed}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  assert.equal(await frame.evaluate(()=>window.__weave.go('g12345')),true,'endless cloths open once the sixteen are done');
  await frame.evaluate(()=>MinimalAdapter.settle?.());
  const opened=await lastOpen(page,'weaves');
  assert.equal(opened.identity.puzzleId,'g12345');assert.equal(opened.identity.mode,'endless');assert.equal(opened.repeat,false);
  // A flip, so the snapshot has history to carry (the snapshot waits for the motion to end).
  await frame.locator('#board').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  const state=await h.snapshot(frame);
  assert.equal(state.board,'g12345');
  assert.deepEqual(state.plus,{version:1,wins:0,held:'',set:[]});
  const fresh=await h.context(await getBrowser(),viewport,{seed:{localStorage:{...seed,'lukesteuber.minimal.collection.v1:saves':JSON.stringify({weaves:{source:game.commit,state}})}}});
  t.after(()=>fresh.close());
  const restored=await h.shell(fresh,game);
  assert.equal(await restored.frame.evaluate(()=>window.__weave.board),'g12345');
  h.sameSnapshot(await h.snapshot(restored.frame),state);
  assert.equal((await lastOpen(restored.page,'weaves')).identity.mode,'endless');
  // An id that is neither a board nor a seed is still refused.
  await assert.rejects(restored.frame.evaluate(s=>MinimalAdapter.restore(s),{...state,board:'g01'}));
  assert.deepEqual([...ctx.parity.errors,...fresh.parity.errors],[]);
});

// Balance (game-riffs PR 283): after its 39 boards, Next deals generated boards (endless.js), kept under
// balance.generated.v1, with their wins under balance.plus.v1. The adapter reports one as mode 'endless' under its size
// and seed, never as a campaign finish; the snapshot carries both records.
const hintUntilSolved=frame=>frame.evaluate(()=>{for(let n=0;!__balance.S.solved&&n<400;n++)document.querySelector('#hint-btn').click();return __balance.S.solved;});
const balanceTile=page=>page.locator('#tiles .tile.balance').evaluate(e=>e.classList.contains('won'));
async function reopen(page,game){
  await h.open(page,game.id);await page.waitForSelector('#player iframe');
  const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();
  await h.ready(frame,true);await page.clock.runFor(100);await h.restored(frame);
  return frame;
}
async function home(page){
  await page.locator('#player iframe').contentFrame().locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
}
test('balance: the campaign finished in the shell, Next deals generated boards; a win counts once and the board resumes',async t=>{
  const L=load('balance/levels.js'),game=gameOf('balance'),ids=L.campaign.map(p=>p.id),last=ids.at(-1);
  assert.equal(ids.length,39);
  const SAVES='lukesteuber.minimal.collection.v1:saves',RESULTS='lukesteuber.minimal.collection.v1:results';
  const seed={[ns('balance','balance.opening.v1')]:'1',[ns('balance','balance.progress.v1')]:JSON.stringify({version:1,completed:ids.slice(0,-1)}),
    [ns('balance','balance.current.v1')]:JSON.stringify({version:1,at:last,boards:{}})};
  const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:seed}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  const board=await lastOpen(page,'balance');
  assert.deepEqual([board.identity.puzzleId,board.identity.mode],[last,'campaign']);
  // The last campaign board, solved here by Hint, finishes the campaign.
  assert.equal(await hintUntilSolved(frame),true,last+' solves by Hint');
  assert.equal(await frame.locator('#ending').innerText(),'All 39 boards solved.');
  assert.equal(await frame.locator('#next-btn').getAttribute('aria-label'),'Start New Game+');
  // Next deals a generated board. A deal can fail ("Try Next again"), so Next is pressed until one comes.
  for(let n=0;n<6&&await frame.evaluate(()=>__balance.at)!=='generated';n++)await frame.locator('#next-btn').click();
  const dealt=await frame.evaluate(()=>({at:__balance.at,generated:__balance.generated,plus:__balance.plus,completed:__balance.progress.completed.length,version:__balance.puzzle.version}));
  assert.equal(dealt.at,'generated','Next deals a generated board');
  assert.deepEqual([dealt.generated.version,dealt.generated.playing,dealt.completed],[1,true,39]);
  assert.ok([6,8].includes(dealt.generated.n));
  const id=`endless:${dealt.generated.n}:${dealt.generated.seed}`,held=`${dealt.version}:${dealt.generated.n}:${dealt.generated.seed}`;
  // The deal is reported a moment after the board changes: wait for that report, not for the last one seen.
  await page.waitForFunction(want=>window.__parityMessages.some(m=>m.game==='balance'&&m.type==='open'&&m.payload.identity.puzzleId===want),id);
  let opened=await lastOpen(page,'balance');
  assert.deepEqual([opened.identity.puzzleId,opened.identity.mode,opened.repeat],[id,'endless',false],'reported as an endless board, not a campaign one');
  let state=await h.snapshot(frame);
  assert.equal(state.at,'generated');assert.deepEqual(state.generated,dealt.generated,'the snapshot carries the board record');
  assert.deepEqual(state.plus,{version:1,wins:0,held:''},'and the count of wins after the campaign');
  // Solved by Hint: one win, one finished result in the library, and the proof names the board's size and seed.
  assert.equal(await hintUntilSolved(frame),true,'the generated board solves by Hint');
  const plus={version:1,wins:1,held};
  assert.deepEqual(await plusOf(frame,'balance.plus.v1'),plus,'one win, held by this board');
  const completions=()=>page.evaluate(()=>window.__parityMessages.filter(m=>m.game==='balance'&&m.type==='complete').map(m=>m.payload));
  await page.waitForFunction(()=>window.__parityMessages.filter(m=>m.game==='balance'&&m.type==='complete').length>=2);
  const done=(await completions()).at(-1);
  assert.deepEqual(done.proof.generated,{n:dealt.generated.n,seed:dealt.generated.seed,version:dealt.version});
  assert.deepEqual(done.progress,{completed:39},'the campaign count does not move');
  // Undo and solve again: the same board does not count twice.
  await frame.locator('#undo-btn').click();assert.equal(await frame.evaluate(()=>__balance.S.solved),false);
  assert.equal(await hintUntilSolved(frame),true);
  assert.deepEqual(await plusOf(frame,'balance.plus.v1'),plus,'the win counts once');
  const solvedCells=await frame.evaluate(()=>__balance.S.cells.slice());
  // Home: the library keeps the generated board, and Balance's finished tile stays finished.
  await home(page);
  const results=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).filter(r=>r.game==='balance'),RESULTS);
  assert.deepEqual(results.map(r=>[r.identity.puzzleId,r.identity.mode]),[[last,'campaign'],[id,'endless']],'one finished result for each board');
  const saved=await page.evaluate(([k,id])=>JSON.parse(localStorage.getItem(k))[id].state,[SAVES,'balance']);
  assert.deepEqual([saved.at,saved.generated.seed,saved.plus],['generated',dealt.generated.seed,plus]);
  assert.equal(await balanceTile(page),true,'the campaign is finished on the library tile');
  // Reopened, the game resumes on the generated board, solved, with its marks; now a repeat.
  const again=await reopen(page,game);
  assert.deepEqual(await again.evaluate(()=>[__balance.at,__balance.generated.seed,__balance.S.solved,__balance.S.cells.slice()]),['generated',dealt.generated.seed,true,solvedCells]);
  opened=await lastOpen(page,'balance');
  assert.deepEqual([opened.identity.puzzleId,opened.identity.mode,opened.repeat],[id,'endless',true]);
  assert.deepEqual(await plusOf(again,'balance.plus.v1'),plus);
  // Next deals another board, then Home: the tile is still finished.
  for(let n=0;n<6&&await again.evaluate(()=>__balance.generated.seed)===dealt.generated.seed;n++)await again.locator('#next-btn').click();
  assert.notEqual(await again.evaluate(()=>__balance.generated.seed),dealt.generated.seed,'a new board');
  await home(page);
  assert.equal(await balanceTile(page),true,'still finished');
  assert.deepEqual(ctx.parity.errors,[]);
});

// Spiral Galaxies (game-riffs PR 282): New Game+ deals a left-out board fresh when its saved marks already solve it.
// The snapshot carries the boards' marks (store.boards). Restoring one taken before a deal, which still holds the solved
// marks, does not bring the fault back: the next deal drops them again, as the game does.
test('galaxies: boards solved in the old campaign are dealt fresh, before and after a restore',async t=>{
  const E=load('galaxies/engine.js'),L=load('galaxies/levels.js'),C=load('galaxies/campaign.js'),game=gameOf('galaxies');
  const OLD=L.seedPool.map(p=>p.id),answer=id=>E.logical(L.find(p=>p.id===id)).solution;
  const boards=Object.fromEntries(OLD.map(id=>[id,answer(id)]));
  const seed={[ns('galaxies','galaxies.primer.v1')]:'1',[ns('galaxies','galaxies.progress.v3')]:JSON.stringify({version:1,completed:OLD}),
    [ns('galaxies','galaxies.current.v3')]:JSON.stringify({version:1,at:'g50',boards,generated:null})};
  const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:seed}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  const now=()=>frame.evaluate(()=>({at:__galaxies.at,solved:__galaxies.S.solved}));
  assert.deepEqual(await now(),{at:'g50',solved:true},'the finished save opens on g50, solved');
  const before=await h.snapshot(frame);
  const dealOne=async()=>{await frame.locator('#next-btn').click();const s=await now();assert.ok(!C.includes(s.at)&&s.at!=='g50'&&s.at!=='generated','a left-out board: '+s.at);return s;};
  const first=await dealOne();
  assert.equal(first.solved,false,'dealt fresh, to be played');
  const after=await h.snapshot(frame);
  assert.notDeepEqual(after.store.boards[first.at],boards[first.at],'the snapshot no longer holds the solved marks');
  // A fresh document restored from the snapshot taken after the deal: the board is still there to play.
  const fresh=await h.context(await getBrowser(),viewport,{seed:{localStorage:{...seed,'lukesteuber.minimal.collection.v1:saves':JSON.stringify({galaxies:{source:game.commit,state:after}})}}});
  t.after(()=>fresh.close());
  const restored=await h.shell(fresh,game);
  assert.deepEqual(await restored.frame.evaluate(()=>({at:__galaxies.at,solved:__galaxies.S.solved})),first);
  // The snapshot from before the deal puts the solved marks back; the next deal drops them again, every time.
  for(let n=0;n<3;n++){
    await frame.evaluate(s=>MinimalAdapter.restore(s),before);
    assert.deepEqual(await now(),{at:'g50',solved:true});
    assert.deepEqual((await h.snapshot(frame)).store.boards[first.at],boards[first.at],'restored as it was saved');
    assert.equal((await dealOne()).solved,false,'the deal is fresh');
  }
  assert.deepEqual([...ctx.parity.errors,...fresh.parity.errors],[]);
});
