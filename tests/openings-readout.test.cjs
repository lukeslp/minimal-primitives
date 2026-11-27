'use strict';
// game-riffs ceb20e42 (0.5.15), in the built package:
// - Horologist (PR 262) opens a first visit on its three opening boards, o1 to o3, as the web does. They record
//   nothing in solved or reached, a save on one restores, and the twenty-five-board campaign is unchanged.
// - The top readout opens Settings with the level list focused (PR 263) in every game whose control frame names a
//   level list. The collection's Home button sits beside the restart button and never covers the readout. On an
//   iPhone the top safe-area inset moves the readout down where the board's box took its press until game-riffs PR
//   264 raised it on touch screens: the 'iphone' size (402x874, a 59 px top inset set through the DevTools protocol)
//   taps it there.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
const ROOT=h.ROOT,KEY='lukesteuber.minimal.collection.v1:saves';
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
const phone={width:390,height:844},landscape={width:844,height:390},iphone={width:402,height:874};
const gameOf=id=>h.games.find(g=>g.id===id);
const configOf=id=>JSON.parse(fs.readFileSync(path.join(ROOT,'build/html/games',id,'controls.js'),'utf8').match(/const config = (\{.*?\});/)[1]);
async function lastOpen(page,game){
  await page.waitForFunction(g=>window.__parityMessages.some(m=>m.game===g&&m.type==='open'),game);
  return page.evaluate(g=>window.__parityMessages.filter(m=>m.game===g&&m.type==='open').at(-1).payload,game);
}
const box=(frame,selector)=>frame.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return[r.left,r.top,r.right,r.bottom];});
const meets=(p,q)=>Math.min(p[2],q[2])-Math.max(p[0],q[0])>0&&Math.min(p[3],q[3])-Math.max(p[1],q[1])>0;

test('horologist: a first visit opens on the opening boards, which record nothing and restore',async t=>{
  const game=gameOf('horologist');
  const ctx=await h.context(await getBrowser(),phone);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  assert.deepEqual(await frame.evaluate(()=>[__horologist.board,__horologist.opening.map(b=>b.id),__horologist.boards.length]),['o1',['o1','o2','o3'],25]);
  assert.equal(await frame.locator('#board-number').textContent(),'Opening 1 of 3');
  const opened=await lastOpen(page,'horologist');
  assert.equal(opened.identity.puzzleId,'o1');assert.equal(opened.identity.mode,'opening','an opening board is never a campaign board');
  assert.equal(await frame.locator('#readout').textContent(),'','the readout is empty on an opening board');
  assert.equal(await frame.locator('#readout').getAttribute('role'),null,'an empty readout is not a button');
  await a.solve(frame,'horologist');
  await page.waitForFunction(()=>window.__parityMessages.some(e=>e.type==='complete'));
  const done=await page.evaluate(()=>window.__parityMessages.filter(e=>e.type==='complete').at(-1).payload);
  assert.equal(done.progress.completed,0,'the opening records nothing');
  let state=await h.snapshot(frame);
  assert.deepEqual([state.board,state.completed,state.reached,state.opening,state.resume],['o1',[],0,false,null]);
  await frame.locator('#next-btn').click();await a.tick(page,1200);
  assert.equal(await frame.evaluate(()=>__horologist.board),'o2','Next goes to the second opening board');
  await a.keyMove(frame,'horologist');
  state=await h.snapshot(frame);
  assert.equal(state.board,'o2');assert.ok(state.model.placed.length>0,'a wheel is on the second opening board');
  // A save on an opening board opens there in a fresh document, wheels and all.
  const fresh=await h.context(await getBrowser(),phone,{seed:{localStorage:{[KEY]:JSON.stringify({horologist:{source:game.commit,state}})}}});
  t.after(()=>fresh.close());
  const restored=await h.shell(fresh,game);
  h.sameSnapshot(await h.snapshot(restored.frame),state);
  assert.equal(await restored.frame.locator('#board-number').textContent(),'Opening 2 of 3');
  // Leaving the openings for board 1 marks them done, and the snapshot carries the mark.
  await a.campaign(restored.frame,'horologist');
  const left=await h.snapshot(restored.frame);
  assert.equal(left.opening,true);assert.equal(left.board,await restored.frame.evaluate(()=>__horologist.boards[0].id));
  assert.equal(await restored.frame.evaluate(()=>localStorage.getItem('horologist-plate.opening.v1')),'1');
  assert.deepEqual([...ctx.parity.errors,...fresh.parity.errors],[]);
});

test('horologist: a 0.5.14 save opens on its own board, not the openings',async t=>{
  const game=gameOf('horologist');
  const old=JSON.parse(fs.readFileSync(path.join(__dirname,'upgrade-fixtures/saves-e9331aaa.json'),'utf8')).horologist;
  const ctx=await h.context(await getBrowser(),phone,{seed:{localStorage:{[KEY]:JSON.stringify({horologist:old})}}});t.after(()=>ctx.close());
  const {frame}=await h.shell(ctx,game);
  assert.equal(await frame.evaluate(()=>__horologist.board),old.state.board);
  const state=await h.snapshot(frame);
  assert.equal(state.opening,false,'an older save leaves the game\'s own mark alone');
  assert.equal(await frame.evaluate(()=>localStorage.getItem('horologist-plate.opening.v1')),null);
  // The adapter refuses a board that is neither an opening nor one of the fifty.
  await assert.rejects(frame.evaluate(s=>MinimalAdapter.restore(s),{...state,board:'o4'}));
  assert.deepEqual(ctx.parity.errors,[]);
});

const levelGames=h.games.filter(g=>configOf(g.id).levels);
test('every game but Notan, Constellations and Tilt · 3D names a level list',()=>assert.deepEqual(levelGames.map(g=>g.id).sort(),
  ['akari','balance','bending','bridges','cast','cube-maze','fold','galaxies','horologist','shoo-minimal','slant','tangles','tents','tilt','towers','weaves']));
for(const game of levelGames)for(const [name,viewport] of Object.entries({phone,landscape,iphone}))test(`${game.id} ${name}: the readout opens the level list and stays clear of Home`,async t=>{
  const config=configOf(game.id);
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game);
  if(h.upright(game.id)&&h.phoneSideways(viewport)){
    // Akari asks for the phone upright here (game-riffs PR 271): the board and its readout are out of sight, Home stays.
    assert.equal(await frame.evaluate(()=>document.documentElement.hasAttribute('data-portrait-turn')),true,'the upright prompt shows');
    assert.equal(await frame.locator('#minimal-home').isVisible(),true,'Home stays');
    return;
  }
  // An opening board shows no readout; the campaign step goes to the first numbered board.
  await a.campaign(frame,game.id);
  if(name==='iphone'){
    // The inset applies to the library page and the game frame within it; the frame lays the readout out again.
    const cdp=await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:59,topMax:59,bottom:34,bottomMax:34}});
    await a.tick(page,300);
    assert.ok((await box(frame,'#readout'))[1]>=59,'the readout sits below the inset');
  }
  const hit=await frame.locator('#readout').evaluate(n=>{const r=n.getBoundingClientRect(),e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===n||n.contains(e)?'readout':e&&(e.id||e.tagName);});
  assert.equal(hit,'readout','nothing covers the readout');
  const read=frame.locator('#readout');
  assert.ok((await read.textContent()).trim(),'the readout shows text');
  assert.equal(await read.getAttribute('role'),'button');assert.equal(await read.getAttribute('tabindex'),'0');
  const home=await box(frame,'#minimal-home'),readout=await box(frame,'#readout');
  assert.ok(!meets(home,readout),'Home does not cover the readout: '+JSON.stringify({home,readout}));
  await a.tapAt(frame,'#readout');
  await frame.waitForFunction(()=>document.querySelector('#settings')?.open);
  await frame.waitForFunction(levels=>{const a=document.activeElement,l=document.querySelector('#settings '+levels);return !!(l&&a&&(a===l||l.contains(a)));},config.levels);
  assert.equal(await frame.locator('dialog[open]').count(),1,'one sheet, Settings');
  await page.screenshot({path:path.join(h.EVIDENCE,`readout-${game.id}-${name}.png`)});
  assert.deepEqual(ctx.parity.errors,[]);
});
