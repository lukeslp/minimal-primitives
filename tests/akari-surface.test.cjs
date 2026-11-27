'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());

// Since game-riffs PR 204 the dark Akari's Next is the control frame's continue disc, as in Weaves: 64 px, shown at the
// solve, in the gap under the board or on the toolbar's row, never over the board or a control. Since game-riffs PR 261
// (8fe53efb) the Light look (game-riffs akari-classic, the package's akari-light) finishes the same way, as on the web.
async function completionNearBoard(frame) {
  const geometry=await frame.evaluate(()=>{
    const box=n=>{const r=n.getBoundingClientRect();return[r.left,r.top,r.right,r.bottom];};
    return{look:document.body.dataset.controlFrame,board:box(document.querySelector('#board')),next:box(document.querySelector('#next-btn')),controls:[...document.querySelectorAll('.control-toolbar button,.control-restart')].filter(n=>n.offsetParent!==null).map(box),viewport:[innerWidth,innerHeight]};
  });
  const meets=(a,b)=>Math.min(a[2],b[2])-Math.max(a[0],b[0])>0&&Math.min(a[3],b[3])-Math.max(a[1],b[1])>0;
  const size=[Math.round(geometry.next[2]-geometry.next[0]),Math.round(geometry.next[3]-geometry.next[1])];
  assert.deepEqual(size,[64,64],'Next is the 64 px disc: '+JSON.stringify(geometry));
  assert.ok(geometry.next[0]>=0&&geometry.next[1]>=0&&geometry.next[2]<=geometry.viewport[0]&&geometry.next[3]<=geometry.viewport[1],'Next remains in the viewport');
  assert.ok(!meets(geometry.next,geometry.board),'Next does not cover the board: '+JSON.stringify(geometry));
  for(const c of geometry.controls)assert.ok(!meets(geometry.next,c),'Next does not cover a control: '+JSON.stringify({next:geometry.next,control:c}));
  assert.equal(await frame.locator('#next-btn:visible').count(),1,'Next shows');
  assert.equal(await frame.locator('#share-btn:visible').count(),0,'completion has only Next (Share stays out of the package)');
}

// Landscape is the iPhone Duo's open inner screen held sideways (951 x 669): a phone held sideways shows Akari's upright
// prompt instead (game-riffs PR 271), and in the app a phone stays upright.
for(const [size,viewport] of Object.entries({phone:{width:390,height:844},landscape:{width:951,height:669},tall:{width:587,height:1330}}))test(`Akari ${size}: smooth panels distinguish rule coverage from natural light spill`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,h.games.find(g=>g.id==='akari'));
  const press=async i=>{await frame.locator('#board .cell').nth(i).focus();await page.keyboard.press('Enter');await a.tick(page,800);};
  // Reach the native 2x2 opening board through actual play, without saved marks.
  await press(0);await completionNearBoard(frame);await frame.locator('#next-btn').click();await a.tick(page);
  await press(0);await press(4);await frame.locator('#next-btn').click();await a.tick(page);
  assert.deepEqual(await frame.evaluate(()=>[__akari.puzzle.w,__akari.puzzle.h]),[2,2]);
  await press(0);
  assert.equal(await frame.locator('#board .cell.lit').count(),3);
  assert.match(await frame.locator('#board .cell').nth(3).getAttribute('aria-label'),/empty, unlit/);
  const surface=await frame.locator('#board .cell').nth(3).evaluate(el=>{
    const style=getComputedStyle(el,'::after'),canvas=document.querySelector('.light-field'),rect=el.getBoundingClientRect(),board=document.querySelector('#board').getBoundingClientRect();
    const raw=canvas.getContext('2d').getImageData(Math.floor((rect.x+rect.width/2-board.x)/board.width*canvas.width),Math.floor((rect.y+rect.height/2-board.y)/board.height*canvas.height),1,1).data;
    return{texture:style.backgroundImage,spill:Array.from(raw).slice(0,3)};
  });
  assert.equal(surface.texture,'none','the normal surface has no decorative hatch');
  assert.ok(surface.spill[0]>20,'natural diagonal illumination is still rendered');
  const centers=await frame.locator('#board .cell').evaluateAll(cells=>cells.map(el=>{const r=el.getBoundingClientRect();return{x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2)};}));
  const png=await page.screenshot({animations:'disabled',path:path.join(h.EVIDENCE,'akari-smooth-'+size+'.png')});
  const colors=await frame.evaluate(async({png,centers})=>{
    const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return centers.map(({x,y})=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3));
  },{png:png.toString('base64'),centers});
  assert.deepEqual(colors[0],[255,255,255],'white lamp center');
  for(const rgb of colors)assert.ok(Math.max(...rgb)-Math.min(...rgb)<=1,'neutral monochrome floor');
  assert.ok(colors[3][0]>=60,'unlit floor stays visible instead of sinking into black');
  assert.ok(colors[1][0]-colors[3][0]>=40,'lit/unlit panels remain visibly distinct');
  fs.writeFileSync(path.join(h.EVIDENCE,'akari-smooth-'+size+'-pixels.json'),JSON.stringify({colors,diagonalLight:surface.spill}));
  await press(1);assert.equal(await frame.locator('.cell.conflict').count(),2);
  assert.equal(await frame.locator('.cell.conflict .lamp').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 59, 48)');
  await frame.locator('#undo-btn').click();await a.tick(page);assert.equal(await frame.locator('.cell.conflict').count(),0);
  await page.emulateMedia({forcedColors:'active'});await a.tick(page);
  assert.equal(await frame.locator('.light-field').evaluate(e=>getComputedStyle(e).display),'none');
  assert.match(await frame.locator('#board .cell').nth(3).evaluate(e=>getComputedStyle(e).backgroundImage),/repeating-linear-gradient/,'forced-colors preserves its pattern fallback');
  await page.emulateMedia({forcedColors:'none'});await press(3);await completionNearBoard(frame);
  await page.screenshot({path:path.join(h.EVIDENCE,'akari-completion-'+size+'.png'),animations:'disabled'});
  await a.preferences(frame,'akari');
  const answer=await frame.evaluate(()=>Akari.count(__akari.puzzle,1).solution);
  for(let i=0;i<answer.length;i++)if(answer[i]===1)await frame.locator('#board .cell').nth(i).press('Enter');
  await a.tick(page,800);await completionNearBoard(frame);
  await frame.locator('#settings-btn').click();assert.equal(await frame.locator('#share').isVisible(),false,'no embedded puzzle-share link');
  assert.deepEqual(ctx.parity.errors,[]);
});
