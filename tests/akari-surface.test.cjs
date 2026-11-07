'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());

async function completionNearBoard(frame) {
  const geometry=await frame.evaluate(()=>{const board=document.querySelector('#board').getBoundingClientRect(),next=document.querySelector('#next-btn').getBoundingClientRect();return{gap:next.y-board.bottom,next:[next.x,next.y,next.width,next.height],viewport:[innerWidth,innerHeight]};});
  assert.ok(geometry.gap>=8&&geometry.gap<=24,'Next stays close to the finished board: '+JSON.stringify(geometry));
  assert.deepEqual(geometry.next.slice(2),[48,48]);
  assert.ok(geometry.next[1]+48<=geometry.viewport[1],'Next remains in the viewport');
  assert.equal(await frame.locator('#completion button:visible').count(),1,'completion has only Next');
}

for(const [size,viewport] of Object.entries({phone:{width:390,height:844},landscape:{width:844,height:390},tall:{width:587,height:1330}}))test(`Akari ${size}: smooth panels distinguish rule coverage from natural light spill`,async t=>{
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
