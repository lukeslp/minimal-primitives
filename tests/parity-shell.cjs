'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
let browser;const getBrowser=async()=>browser||(browser=await h.launch());
after(async()=>browser?.close());
for(const [size,viewport] of Object.entries({narrow:{width:320,height:568},phone:{width:390,height:844},landscape:{width:844,height:390},desktop:{width:1280,height:900}}))test(`library ${size}: layout, keyboard dialog focus and game isolation`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:{'lukesteuber.minimal.hexsweeper:keep':'other game'},sessionStorage:{'unrelated':'session'}}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,h.games[0]);
  assert.equal(await page.locator('iframe').count(),1,'only selected game runs');
  await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  assert.equal(await page.locator('#tiles .tile').count(),h.mainTiles);
  assert.equal(await page.locator('#access-tiles .tile').count(),8,'the motor-accessible puzzles wait behind the last tile');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'library has no horizontal overflow');
  const footer=await page.locator('#library footer').evaluate(el=>{const link=el.querySelector('a').getBoundingClientRect(),button=el.querySelector('button').getBoundingClientRect();return{linkCenter:link.x+link.width/2,width:innerWidth,overlap:link.right>button.left,buttons:el.querySelectorAll('button').length};});
  assert.ok(Math.abs(footer.linkCenter-footer.width/2)<1,'footer URL centered on viewport');
  assert.equal(footer.overlap,false,'URL does not overlap trophy');assert.equal(footer.buttons,1);
  assert.equal(await page.locator('#scores-button svg').count(),1,'trophy is the single footer control');
  await page.locator('#scores-button').focus();await page.keyboard.press('Enter');
  assert(await page.locator('#scores').evaluate(d=>d.open));
  assert.equal(await page.locator('dialog[open]').count(),1,'scores and sharing use one modal');
  assert.equal(await page.locator('#scores select, #scores input').count(),3,'the scores sheet holds the attempts, nickname and sharing controls');
  // This build has no score service: the sheet says scores stay here and offers nothing to share.
  assert.equal(await page.locator('#scores-local').innerText(),'Scores stay on this device.');
  assert.equal(await page.locator('#scores .sharing').isVisible(),false,'no sharing controls without a score service');
  assert.equal(await page.locator('#nickname').isVisible(),false);assert.equal(await page.locator('#share-opt-in').isChecked(),false);
  assert(await page.locator('#scores').evaluate(d=>d.scrollWidth<=d.clientWidth),'modal has no horizontal overflow');
  assert(await page.evaluate(()=>document.activeElement.closest('dialog')?.id==='scores'),'focus enters modal');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'scores-button','modal restores opener focus');
  // Accessibility: the last tile opens the motor-accessible puzzles inside the package, as the tile on lukesteuber.com/minimal/ opens them on the web.
  const band=await page.evaluate(()=>{const e=document.querySelector('#access-open'),last=[...document.querySelectorAll('#tiles .tile')].pop();return{last:e.parentElement===last,tile:last.classList.contains('accessible'),label:e.getAttribute('aria-label'),tag:e.tagName};});
  assert.deepEqual(band,{last:true,tile:true,label:'Eye, head & switch games',tag:'A'});
  await page.locator('#access-open').focus();await page.keyboard.press('Enter');
  assert.ok(await page.locator('#accessible').isVisible(),'the tile opens the accessible grid');assert.ok(await page.locator('#library').isHidden());
  assert.deepEqual(await page.locator('#access-tiles .tile').evaluateAll(t=>t.map(e=>e.dataset.game)),['glance','glyph','pursuit','shoo','nod','noon','sweep','ticker']);
  assert.equal(await page.evaluate(()=>location.hash),'#view=accessible');
  await page.locator('#access-back').click();
  assert.ok(await page.locator('#library').isVisible(),'Home returns to all games');assert.equal(await page.evaluate(()=>location.hash),'');
  // Android's Back runs the shell's BACK_SCRIPT: from the accessible grid it returns to all games, from all games it leaves.
  const backScript=fs.readFileSync(path.join(__dirname,'..','android/app/src/main/java/minimalprimitives/android/MainActivity.kt'),'utf8').match(/BACK_SCRIPT = """([\s\S]*?)"""/)[1];
  await page.locator('#access-open').evaluate(a=>a.click());
  assert.equal(await page.evaluate(backScript),'grid','Android Back on the accessible grid goes to all games');
  assert.ok(await page.locator('#library').isVisible());assert.ok(await page.locator('#accessible').isHidden());assert.equal(await page.evaluate(()=>location.hash),'');
  assert.equal(await page.evaluate(backScript),'library','Android Back on all games leaves the app');
  assert.equal(await page.locator('dialog#access').count(),0,'no separate settings sheet: each game has Settings > Access');
  await page.evaluate(()=>localStorage.setItem('lukesteuber.minimal.shared:minimal-access.v1:default',JSON.stringify({mode:'switch',look:'pointer',hold:800,speed:'normal'})));
  await page.locator('.tile').filter({hasText:'Akari'}).locator('.go').focus();await page.keyboard.press('Enter');
  const second=await (await page.locator('iframe').elementHandle()).contentFrame();await h.ready(second,true);await a.keyMove(second,'akari');
  const raw=await page.evaluate(()=>({other:localStorage.getItem('lukesteuber.minimal.hexsweeper:keep'),session:sessionStorage.getItem('unrelated')}));
  assert.deepEqual(raw,{other:'other game',session:'session'});
  assert.equal(await second.evaluate(()=>localStorage.getItem('keep')),null,'other game namespace invisible');
  assert.equal(JSON.parse(await second.evaluate(()=>localStorage.getItem('minimal-access.v1:default'))).mode,'switch','the Accessibility choice is shared with every game');
  await page.screenshot({path:path.join(h.EVIDENCE,'shell-'+size+'.png')});assert.deepEqual(ctx.parity.errors,[]);
});
for(const kind of ['malformed','wrong-type','unavailable'])test(`library ${kind} storage: launch, stash and resume remain usable`,async t=>{
  const seed={localStorage:Object.fromEntries(['profile','saves','progress','results'].map(k=>['lukesteuber.minimal.collection.v1:'+k,kind==='wrong-type'?'true':'{damaged']))};
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{storage:kind==='unavailable'?'unavailable':'normal',seed:kind==='unavailable'?{}:seed});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,h.games[0]);await a.keyMove(frame,'notan');const state=await h.snapshot(frame);
  // With storage unavailable the library says once that it could not save, so a notice alone is no sign of failure here.
  await frame.locator('#minimal-home').click();await page.locator('#library:visible').waitFor().catch(()=>{});
  assert.equal(await page.locator('iframe').count(),0,'Library failed: '+await page.locator('#notice').textContent());
  if(kind==='unavailable')assert.equal(await page.locator('#notice').textContent(),'Could not save on this device. Progress may not be kept.');
  await page.locator('.tile').filter({hasText:'Notan'}).locator('.go').focus();await page.keyboard.press('Enter');
  const restored=await (await page.locator('iframe').elementHandle()).contentFrame();await h.ready(restored,true);await h.restored(restored);
  h.sameSnapshot(await h.snapshot(restored),state);assert.deepEqual(ctx.parity.errors,[]);
});
test('Access: Home and Scores are in the switch scan and on the look pad',async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{'lukesteuber.minimal.shared:minimal-access.v1:default':JSON.stringify({mode:'switch',look:'pointer',hold:800,speed:'normal'})}}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,h.games.find(g=>g.id==='akari'));
  await frame.waitForFunction(()=>window.__access&&window.__access.state.mode==='switch');
  const groups=await frame.evaluate(()=>__access.state.groups);
  assert.deepEqual(groups.at(-1),{id:'group:collection',keys:['home','scores']},'the collection keys are the last group');
  const press=async()=>{await page.clock.runFor(600);await page.keyboard.down('x');await page.keyboard.up('x');await page.clock.runFor(50);};
  const reach=async id=>{for(let n=0;n<24&&await frame.evaluate(()=>__access.state.scan)!==id;n++)await frame.evaluate(()=>__access.step());assert.equal(await frame.evaluate(()=>__access.state.scan),id);};
  await reach('group:collection');await press();await reach('scores');await press();
  await page.waitForFunction(()=>document.querySelector('#scores')?.open);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#scores').open);
  await frame.evaluate(()=>{document.activeElement?.blur();window.focus();});
  await reach('group:collection');await press();await reach('home');await press();
  await page.waitForFunction(()=>!document.querySelector('iframe'));
  // Look and hold, in a game not opened yet (a game keeps its own choice once made): both are keys on the pad, away from the board.
  await page.evaluate(()=>localStorage.setItem('lukesteuber.minimal.shared:minimal-access.v1:default',JSON.stringify({mode:'look',look:'pointer',hold:800,speed:'normal'})));
  await page.locator('.tile').filter({hasText:'Spiral Galaxies'}).locator('.go').focus();await page.keyboard.press('Enter');
  const look=await (await page.locator('#player iframe').elementHandle()).contentFrame();await h.ready(look,true);
  await page.clock.runFor(500);
  await look.waitForFunction(()=>window.__access&&window.__access.state.mode==='look');
  const keys=await look.evaluate(()=>{const s=__access.state,b=document.querySelector('#board').getBoundingClientRect();return s.keys.filter(k=>['home','scores'].includes(k.id)).map(k=>({id:k.id,shown:!!k.rect,clear:!!k.rect&&(k.rect.y>=b.bottom||k.rect.y+k.rect.height<=b.top||k.rect.x>=b.right||k.rect.x+k.rect.width<=b.left)}));});
  assert.deepEqual(keys,[{id:'home',shown:true,clear:true},{id:'scores',shown:true,clear:true}]);
  assert.deepEqual(ctx.parity.errors,[]);
});
test('library cards: each Also link opens its own game; links the package does not carry are left off',async t=>{
  const index=JSON.parse(fs.readFileSync(path.join(h.ROOT,'index.json'))),catalog=JSON.parse(fs.readFileSync(path.join(h.ROOT,'build/html/catalog.json')));
  const links=index.tiles.filter(tile=>!tile.notBundled).flatMap(tile=>tile.also.map(link=>({tile,link})));
  assert.deepEqual(links.map(({tile,link})=>tile.name+': '+link.label),['Hexsweeper: Flat','Hexsweeper: Endless','Bridges: Constellations','Tilt: 3D','Tilt: Cube Maze']);
  const ctx=await h.context(await getBrowser(),{width:390,height:844});t.after(()=>ctx.close());
  const page=await ctx.newPage();await page.goto(h.ORIGIN+'/export/index.html');await page.mouse.move(-1,-1);
  const card=name=>page.locator('#tiles .tile').filter({has:page.locator('.cap',{hasText:new RegExp('^'+name+'$')})});
  for(const {tile,link} of links){
    const key=link.game+(link.mode?':'+link.mode:''),game=catalog.find(g=>g.id===link.game),mode=game.modes.find(m=>m.id===link.mode);
    await t.test(`${tile.name} card: ${link.label} opens ${game.title}${mode?' · '+mode.title:''}`,async()=>{
      // The link is on its tile's card, with the index's label and description, and opens from the keyboard.
      const a=card(tile.name).locator(`.also [data-open="${key}"]`);
      assert.equal(await a.textContent(),link.label);assert.equal(await a.getAttribute('aria-label'),link.aria);
      await h.open(page,key);
      const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();
      await frame.waitForFunction(()=>document.readyState==='complete'&&!!window.MinimalAdapter&&!!document.querySelector('#minimal-home'));
      assert.equal(await page.locator('#player iframe').getAttribute('title'),game.title+(mode?' · '+mode.title:''));
      assert.equal(new URL(frame.url()).pathname,'/export/games/'+(mode?mode.entry:game.entry));
      assert.equal(await frame.evaluate(()=>MinimalBridge.config.game),link.game);
      assert.equal(await page.evaluate(()=>location.hash),'#'+new URLSearchParams({game:key}));
      await frame.locator('#minimal-home').click();await page.locator('#library:visible').waitFor();
    });
  }
  await t.test('Quipu and Hands on are left off their cards',async()=>{
    assert.deepEqual(index.notBundled.filter(n=>n.on).map(n=>n.on+': '+n.name),['Notan: Quipu','Simple Machines: Hands on']);
    assert.equal(await card('Notan').locator('.also').count(),0,'Notan shows no Also row');
    assert.equal(await card('Simple Machines').count(),0,'the Simple Machines card is not in the package');
    assert.equal(await page.locator('#tiles a',{hasText:/Quipu|Hands on/}).count(),0);
  });
  assert.deepEqual(ctx.parity.errors,[]);
});
// Themes: the library follows the phone's light or dark setting, as the Minimal index does; Settings (the gear
// beside the title) offers Follow phone, Checkerboard, Light and Dark, and a choice is kept ahead of the phone's. Dark and Light show the index's line drawings where it has them.
const THEME_KEY='lukesteuber.minimal.collection.v1:library',OPENING_KEY='lukesteuber.minimal.collection.v1:opening';
async function library(ctx,{clock=false}={}){
  const page=await ctx.newPage();
  if(clock){await page.clock.install({time:new Date('2026-10-14T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-14T12:00:01Z'));}
  // What the page holds as soon as its body exists, before collection.js draws a tile: the theme is already set.
  await page.addInitScript(()=>{new MutationObserver((_,o)=>{if(document.body){window.__firstLook=document.documentElement.getAttribute('data-look')||'checkerboard';window.__firstGround=document.querySelector('meta[name="theme-color"]').content;window.__firstOpening=document.documentElement.classList.contains('opening');o.disconnect();}}).observe(document,{childList:true,subtree:true});});
  await page.goto(h.ORIGIN+'/export/index.html');await page.mouse.move(-1,-1);
  await page.locator('#tiles .tile').first().waitFor({state:'attached'});
  return page;
}
const shown=page=>page.evaluate(()=>{
  const tiles=[...document.querySelectorAll('#tiles .tile')],ground=n=>getComputedStyle(n).backgroundColor,pic=t=>{const i=t.querySelector('.art img');return i?new URL(i.getAttribute('src'),location.href).pathname.split('/').pop():t.querySelector('.art svg')?'svg':null;};
  return {look:document.documentElement.getAttribute('data-look'),meta:document.querySelector('meta[name="theme-color"]').content,page:getComputedStyle(document.body).backgroundColor,
    gap:getComputedStyle(document.querySelector('#tiles')).gap,grounds:[...new Set(tiles.map(ground))],first:ground(tiles[0]),second:ground(tiles[1]),
    pictures:Object.fromEntries(tiles.map(t=>[t.querySelector('.cap').textContent,pic(t)])),lines:tiles.filter(t=>t.classList.contains('lines')).length,
    castSource:document.querySelectorAll('#tiles .cast-3d .art source').length,footer:getComputedStyle(document.querySelector('#library footer a')).color,
    boot:{look:window.__firstLook,ground:window.__firstGround}};
});
for(const [size,viewport] of Object.entries({phone:{width:390,height:844},tablet:{width:820,height:1180}}))test(`library themes at ${size} width: the phone's by default, Dark, Light and Checkerboard from Settings, kept across a reload`,async t=>{
  const index=JSON.parse(fs.readFileSync(path.join(h.ROOT,'index.json'))),tiles=index.tiles.filter(x=>!x.notBundled);
  const drawn=Object.fromEntries(tiles.map(x=>[x.name,x.lines?x.lines.file.split('/').pop():x.svg?'svg':x.art.file.split('/').pop()]));
  const art=Object.fromEntries(tiles.map(x=>[x.name,x.svg?'svg':x.art.file.split('/').pop()]));
  assert.deepEqual(tiles.filter(x=>!x.lines&&!x.svg).map(x=>x.name),['Hexsweeper','Spiral Galaxies','Tangles'],'only these keep their pictures in Dark and Light');
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  let page=await library(ctx);
  const choose=async theme=>{await page.locator('#gear').click();await page.locator('#set-look').selectOption(theme);await page.locator('#settings .sheet-x').click();};
  await t.test('a phone set to dark opens Dark, set before the first paint',async()=>{
    const s=await shown(page);
    assert.deepEqual(s.boot,{look:'dark',ground:'#000000'},'set while the body was still empty');
    assert.deepEqual([s.look,s.meta,s.page,s.gap,s.grounds,s.lines,s.castSource,s.footer],['dark','#000000','rgb(0, 0, 0)','0px',['rgb(0, 0, 0)'],tiles.filter(x=>x.lines).length,0,'rgb(153, 153, 153)']);
    assert.deepEqual(s.pictures,drawn);
    assert.equal(await page.locator('#set-look').inputValue(),'system');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),THEME_KEY),null,'nothing is kept until a theme is chosen');
  });
  await t.test('it follows the phone while the setting is System',async()=>{
    await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.getAttribute('data-look')==='light');
    const s=await shown(page);assert.deepEqual([s.meta,s.grounds],['#ffffff',['rgb(255, 255, 255)']]);assert.deepEqual(s.pictures,drawn);
    await page.reload();await page.locator('#tiles .tile').first().waitFor({state:'attached'});
    assert.equal((await shown(page)).boot.look,'light','a phone set to light opens Light');
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.getAttribute('data-look')==='dark');
  });
  await t.test('Light: every tile on white, the same line drawings',async()=>{
    await choose('light');const s=await shown(page);
    assert.deepEqual([s.look,s.meta,s.page,s.gap,s.grounds,s.castSource],['light','#ffffff','rgb(255, 255, 255)','0px',['rgb(255, 255, 255)'],0]);
    assert.deepEqual(s.pictures,drawn);
    assert.deepEqual(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),THEME_KEY)),{theme:'light'});
    await page.reload();await page.locator('#tiles .tile').first().waitFor({state:'attached'});
    const again=await shown(page);assert.deepEqual([again.boot.look,again.look,again.grounds],['light','light',['rgb(255, 255, 255)']],'Light is kept across a reload, on a phone set to dark');
    assert.equal(await page.locator('#set-look').inputValue(),'light');
  });
  await t.test('Checkerboard: the alternating grounds, gaps and the usual pictures',async()=>{
    await choose('checkerboard');const s=await shown(page);
    assert.deepEqual([s.look,s.meta,s.page,s.gap,s.first,s.second,s.lines],[null,'#e6e6e6','rgb(230, 230, 230)',viewport.width>=720?'10px':'6px','rgb(255, 255, 255)','rgb(0, 0, 0)',0]);
    assert.deepEqual(s.pictures,art);
    assert.equal(s.castSource,1,"Cast keeps its wide-screen picture");
    await page.reload();await page.locator('#tiles .tile').first().waitFor({state:'attached'});
    assert.deepEqual((await shown(page)).boot.look,'checkerboard','Checkerboard is kept across a reload');
    await page.emulateMedia({colorScheme:'light'});await page.waitForTimeout(100);
    assert.equal((await shown(page)).look,null,'a chosen theme stays put when the phone changes');
    await page.emulateMedia({colorScheme:'dark'});
  });
  await t.test('Follow phone goes back to following the phone',async()=>{
    await choose('system');assert.equal((await shown(page)).look,'dark');
    assert.deepEqual(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),THEME_KEY)),{},'nothing kept');
    await page.reload();await page.locator('#tiles .tile').first().waitFor({state:'attached'});
    assert.equal((await shown(page)).boot.look,'dark');assert.equal(await page.locator('#set-look').inputValue(),'system');
  });
  await t.test("each game's name sits right below its picture; screen readers hear it once, from the link; the title is the name",async()=>{
    // The index at luke-portfolio dfb83d1: the name under the picture replaces "no name at rest" (2026-11-15).
    const caps=await page.locator('#tiles .tile').evaluateAll(tiles=>tiles.filter(t=>t.offsetParent).map(t=>{const cap=t.querySelector('.cap'),art=t.querySelector('.art');const c=cap.getBoundingClientRect(),a=art.getBoundingClientRect();
      return{display:getComputedStyle(cap).display,hidden:cap.getAttribute('aria-hidden'),text:cap.textContent.trim(),under:c.top>=a.top+a.height*0.8&&c.height>0};}));
    assert.ok(caps.length>=19,'every bundled tile has a name');
    for(const cap of caps){assert.notEqual(cap.display,'none');assert.equal(cap.hidden,'true');assert.ok(cap.text.length>0);assert.ok(cap.under,cap.text+' sits under its picture');}
    assert.equal(await page.locator('#tiles .tile a.go:not([aria-label])').count(),0,'every tile link is named for screen readers');
    const head=page.locator('#library h1');assert.equal(await head.textContent(),'minimal primitives');assert.equal(await head.isVisible(),true);
    const box=await page.locator('#masthead-text').boundingBox();assert.ok(Math.abs(box.x+box.width/2-viewport.width/2)<2,'the title is centered');
    assert.equal(index.tiles.at(-1).label,await page.locator('#access-open').getAttribute('aria-label'),"the last tile carries the index's name");
    assert.deepEqual(await page.locator('#access-tiles .cap').evaluateAll(n=>[...new Set(n.map(e=>getComputedStyle(e).display))]),['block']);
  });
  await t.test('the accessible grid follows the theme',async()=>{
    await choose('dark');await page.locator('#access-open').focus();await page.keyboard.press('Enter');await page.locator('#accessible:visible').waitFor();
    const grounds=await page.locator('#access-tiles .tile').evaluateAll(n=>[...new Set(n.map(e=>getComputedStyle(e).backgroundColor))]);
    assert.deepEqual(grounds,['rgb(0, 0, 0)']);
    await page.locator('#access-back').click();
  });
  await t.test("Settings is the index's sheet, Display, Access and About, with the package's Privacy row; the trophy sheet keeps scores and sharing",async()=>{
    await page.locator('#gear').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#settings').evaluate(e=>e.open),true,'the gear opens it from the keyboard');
    assert.deepEqual(await page.locator('#settings .group').allTextContents(),['Display','Access','Privacy','About']);
    assert.equal(await page.locator('#set-access').inputValue(),'off');
    await page.locator('#set-access').selectOption('switch');
    assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('lukesteuber.minimal.shared:minimal-access.v1:default'))).mode,'switch','the games\' shared starting choice');
    await page.locator('#set-access').selectOption('off');
    assert.deepEqual(await page.locator('#settings a').evaluateAll(n=>n.map(a=>[a.target,a.rel])),[['_blank','noopener noreferrer']],'its link leaves the app');
    await page.screenshot({path:path.join(h.EVIDENCE,`settings-${size}.png`)});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'gear','focus returns to the gear');
    await page.locator('#scores-button').click();
    assert.equal(await page.locator('#scores select').count(),1,'only the attempts list');assert.equal(await page.locator('#scores-button').getAttribute('aria-label'),'Scores and sharing');
    await page.locator('#scores .close').click();
  });
  await page.screenshot({path:path.join(h.EVIDENCE,`themes-${size}.png`)});assert.deepEqual(ctx.parity.errors,[]);
});
// The opening: the first time the app opens, in any look, and again from Play in Settings; skipped by any key, tap or click, never on return from a game,
// never with reduced motion. These contexts run with normal motion and the page clock.
const intro=page=>page.evaluate(()=>{const e=document.getElementById('intro');return e?{shown:!e.hidden,leaving:e.classList.contains('landing'),words:e.querySelectorAll('li.on').length,name:e.querySelector('p').classList.contains('on'),focusable:e.querySelectorAll('a,button,input,select,[tabindex]').length,hiddenFromReaders:e.getAttribute('aria-hidden')}:null;});
const motion=(theme)=>({scheme:'dark',motion:'no-preference',seed:theme?{localStorage:{[THEME_KEY]:JSON.stringify(theme)}}:{}});
test('the opening plays the first time, in its own timing, and not again on return from a game, on reload or at the next launch',async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},motion());t.after(()=>ctx.close());
  const page=await library(ctx,{clock:true});
  // The app's loader: the opening's ground is drawn from the first paint, before collection.js has the catalog.
  assert.equal(await page.evaluate(()=>window.__firstOpening),true,'decided before the first paint');
  await page.clock.runFor(100);
  assert.deepEqual(await intro(page),{shown:true,leaving:false,words:0,name:true,focusable:0,hiddenFromReaders:'true'});
  assert.notEqual(await page.evaluate(()=>document.activeElement.closest('#intro')),true,'the opening holds no focus');
  assert.equal(await page.locator('#masthead').isVisible(),false,'the title waits for the name');assert.equal(await page.locator('#gear').isVisible(),false);
  await page.clock.runFor(1650);assert.equal((await intro(page)).words,0);
  await page.clock.runFor(100);assert.equal((await intro(page)).words,1,'the first word at 1.8 seconds');
  await page.clock.runFor(500*7);assert.equal((await intro(page)).words,8,'a word every 500 ms');
  await page.clock.runFor(2150);assert.equal((await intro(page)).leaving,false,'the full list rests');
  await page.clock.runFor(200);assert.equal((await intro(page)).leaving,true,'then the name moves up, 7.6 seconds in');
  await page.clock.runFor(900);assert.equal(await intro(page),null,'gone once the name has landed');
  assert.equal(await page.locator('#masthead').isVisible(),true,'the title takes over');
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('opening')),false);
  // Return from a game: no opening.
  await h.open(page,'notan');const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();await h.ready(frame,true);
  await frame.locator('#minimal-home').click();await page.locator('#library:visible').waitFor();
  assert.equal(await intro(page),null,'not on return from a game');
  // A reload, or the next launch (a new page with the same storage): no opening.
  await page.reload();await page.locator('#tiles .tile').first().waitFor({state:'attached'});await page.clock.runFor(100);
  assert.equal(await intro(page),null,'not on reload');
  const next=await library(ctx,{clock:true});await next.clock.runFor(100);assert.equal(await intro(next),null,'not at the next launch');await next.close();
  // Play in Settings shows it again, and it ends as before.
  await page.locator('#gear').click();await page.locator('#set-opening').click();await page.clock.runFor(100);
  assert.equal((await intro(page)).shown,true,'Play shows it again');assert.equal(await page.locator('#settings').evaluate(e=>e.open),false);
  await page.keyboard.press('x');await page.clock.runFor(300);assert.equal(await intro(page),null);assert.equal(await page.locator('#masthead').isVisible(),true);
  assert.deepEqual(ctx.parity.errors,[]);
});
for(const [how,press] of [
  ['a key (a switch sends one)',async page=>{await page.keyboard.press('x');}],
  ['Tab, which skips and moves no focus',async page=>{await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body),true);}],
  ['a tap',async page=>{const r=await page.locator('#tiles .tile').nth(2).boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);}],
  ['a click (pointer, head mouse or dwell click)',async page=>{const r=await page.locator('#tiles .tile').first().boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);}],
  ["Android's Back",async page=>{const back=fs.readFileSync(path.join(__dirname,'..','android/app/src/main/java/minimalprimitives/android/MainActivity.kt'),'utf8').match(/BACK_SCRIPT = """([\s\S]*?)"""/)[1];assert.equal(await page.evaluate(back),'opening');}],
])test(`the opening is skipped by ${how}, and that press does nothing else`,async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},motion());t.after(()=>ctx.close());
  const page=await library(ctx,{clock:true});await page.clock.runFor(100);
  assert.equal((await intro(page)).shown,true);
  await press(page);await page.clock.runFor(50);
  assert.equal((await intro(page))?.leaving??true,true,'skipped');
  assert.deepEqual(await page.evaluate(()=>({frames:document.querySelectorAll('#player iframe').length,cards:document.querySelectorAll('.tile.show').length,dialogs:document.querySelectorAll('dialog[open]').length})),{frames:0,cards:0,dialogs:0},'nothing opened');
  await page.clock.runFor(300);assert.equal(await intro(page),null,'a skip lands the name quickly');
  assert.equal(await page.locator('#masthead').isVisible(),true);
  // The next press works as usual.
  await h.open(page,'slant');await page.waitForSelector('#player iframe');
  assert.deepEqual(ctx.parity.errors,[]);
});
test('a scripted open (the app shells, the capture tools) ends the opening and goes through',async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},motion());t.after(()=>ctx.close());
  const page=await library(ctx,{clock:true});await page.clock.runFor(100);
  assert.equal((await intro(page)).shown,true);
  await page.locator('[data-open="cube-maze"]').evaluate(a=>a.click());
  await page.waitForSelector('#player iframe');assert.equal(await intro(page),null);
  assert.deepEqual(ctx.parity.errors,[]);
});
// Signs of life: a tile takes its color when every board of its game is finished (the game's own record, read from its
// namespace), and a still library gets a passing shine after ten seconds, then every twenty.
// A set is [storage key, field, the campaign's ids]; done(name,n) is a record with that game's first n campaign ids finished.
const LIFE=JSON.parse(fs.readFileSync(path.join(h.ROOT,'index.json'))),ids=name=>LIFE.tiles.find(x=>x.name===name).set[2],done=(name,n)=>JSON.stringify({version:1,completed:ids(name).slice(0,n)});
const seen={[OPENING_KEY]:'1'};
// What a tile shows: its picture's file, whether it arrived, the tile's dress, and the corner check and words that say "finished" without color.
const tileState=(page,cls)=>page.locator('#tiles .tile.'+cls).evaluate(e=>{const img=e.querySelector('.art img'),art=getComputedStyle(e.querySelector('.art')),check=getComputedStyle(e,'::after');
  return{won:e.classList.contains('won'),pictured:e.classList.contains('pictured'),solved:e.classList.contains('solved'),src:img.getAttribute('src').split('?')[0].split('/').pop(),wide:img.naturalWidth,fill:e.style.getPropertyValue('--fill'),
    ground:art.backgroundColor,blend:getComputedStyle(img).mixBlendMode,filter:getComputedStyle(img).filter,fade:getComputedStyle(img).animationName,
    check:check.content!=='none'&&check.width==='18px'&&check.backgroundColor!==getComputedStyle(e).backgroundColor,words:e.querySelector('.more .line .done')?.textContent||''};});
const RAMP=require(path.join(h.ROOT,'imports/notan/levels.js')).map(b=>b.id),PLUS=require(path.join(h.ROOT,'imports/notan/plus-levels.js')).map(b=>b.id);
const ink=list=>JSON.stringify({solved:Object.fromEntries(list.map(id=>[id,30])),boards:{[RAMP[0]]:{cells:[]}}}),NOTAN=RAMP;
const file=art=>art.file.split('/').pop();
test('a finished game shows its solved board in color, or one color where it has no picture; an unfinished tile reads no picture',async t=>{
  const sets=Object.fromEntries(LIFE.tiles.filter(x=>x.set).map(x=>[x.name,x]));
  assert.deepEqual([sets.Slant.set,sets.Notan.set,sets.Cast.set,sets.Tilt.set,sets.Horologist.set].map(([key,field,list])=>[key,field,list.length]),
    [['slant.progress.v1','completed',54],['ink.v1','solved',53],['cast-3d.v1','finished',25],['tilt-levels-grok.v1','done',25],['horologist-plate.v1','solved',25]],"the index's own table, with Notan's from the package");
  assert.deepEqual(sets.Notan.set[2],RAMP,"Notan's campaign is its ramp; New Game+ is not part of it");
  assert.deepEqual(LIFE.tiles.filter(x=>x.solved).map(x=>x.name),['Slant','Notan','Bridges','Akari','Spiral Galaxies','Cast','Folding','Towers','Weaves','Tents','Shoo','Balance']);
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{...seen,
    'lukesteuber.minimal.slant:slant.progress.v1':done('Slant',54),'lukesteuber.minimal.notan:ink.v1':ink(RAMP.concat(PLUS)),'lukesteuber.minimal.akari:akari.progress.v1':done('Akari',50),
    'lukesteuber.minimal.bridges:bridges.progress.v1':done('Bridges',49),'lukesteuber.minimal.tilt:tilt-levels-grok.v1':JSON.stringify({done:ids('Tilt').slice(0,-1)}),
    // Cast: every campaign board, and boards the campaign has dropped, which neither help nor hurt.
    'lukesteuber.minimal.cast:cast-3d.v1':JSON.stringify({finished:['c14','c15'].concat(ids('Cast'))}),'lukesteuber.minimal.towers:slant.progress.v1':done('Slant',54)}}});t.after(()=>ctx.close());
  const fetched=[];ctx.on('request',r=>{if(/-solved[^/]*\.webp/.test(r.url()))fetched.push(new URL(r.url()).pathname.split('/').pop());});
  // Cast's picture cannot be had here: the tile keeps the one-color mark and its own drawing.
  await ctx.route(/cast-3d-solved/,route=>route.fulfill({status:404,body:'Missing'}));
  const page=await library(ctx);
  await page.locator('#tiles .tile.slant.solved').waitFor();await page.locator('#tiles .tile.notan.solved').waitFor();
  await page.waitForFunction(()=>document.querySelector('#tiles .tile.cast-3d')._broken===true);
  assert.deepEqual(await page.locator('#tiles .tile.won').evaluateAll(n=>n.map(e=>e.dataset.game)),['slant','notan','akari','cast'],'only whole sets, each from its own game\'s record');
  const shown={won:true,pictured:true,solved:true,wide:1200,ground:'rgba(0, 0, 0, 0)',blend:'normal',filter:'none',fade:'none',check:true,words:' All boards finished.'};
  assert.deepEqual(await tileState(page,'slant'),{...shown,src:file(sets.Slant.solved.dark),fill:'0.64'},'Slant: its solved board, unfiltered, with the check and the words');
  assert.deepEqual(await tileState(page,'notan'),{...shown,src:file(sets.Notan.solved.dark),fill:'0.68'},'Notan: the lion solved, from the record the package can read');
  const tint={won:true,pictured:false,solved:false,fill:'',blend:'multiply',check:true,words:' All boards finished.'};
  const akari=await tileState(page,'akari'),cast=await tileState(page,'cast-3d');
  // Akari shows its own solved board since the index at 95debc8 (luke-portfolio PR 41).
  assert.deepEqual([akari.won,akari.pictured,akari.solved,akari.check,akari.words,akari.src,akari.fill],[true,true,true,true,' All boards finished.',file(sets.Akari.solved.dark),String(sets.Akari.solved.fill)],'Akari: its solved board, with the check and the words');
  assert.deepEqual({...cast,wide:0,ground:'',filter:'',fade:''},{...tint,src:'cast-lines.svg',wide:0,ground:'',filter:'',fade:''},'a picture that cannot be had leaves the one-color mark');
  for(const name of ['bridges','tilt','towers']){const plain=await tileState(page,name);assert.deepEqual([plain.won,plain.pictured,plain.solved,plain.check,plain.words,plain.src],[false,false,false,false,'',name+'-lines.svg'],name+' is not finished');}
  assert.deepEqual(fetched.sort(),[file(sets.Akari.solved.dark),file(sets.Cast.solved.dark),file(sets.Notan.solved.dark),file(sets.Slant.solved.dark)].sort(),'a solved picture is read only for a finished tile');
  assert.equal(await page.locator('#tiles .tile.glint').count(),0);
  await page.screenshot({path:path.join(h.EVIDENCE,'finished-tiles-dark.png')});assert.deepEqual(ctx.parity.errors,[]);
});
// Old saves and partial records: a count of finished boards is not enough. Tilt's and Cast's former campaigns were
// l01–l30 and c01–c30 (16 and 19 of the current twenty-five, since game-riffs 9ad63d8); a repeat, a recovery copy of a record, or Notan's New Game+
// never stands in for a missing campaign board.
test('a tile is finished only when every current campaign id is in its game\'s own record',async t=>{
  const pad=n=>String(n).padStart(2,'0'),old=letter=>Array.from({length:30},(_,i)=>letter+pad(i+1));
  assert.deepEqual([old('l').filter(id=>ids('Tilt').includes(id)).length,old('c').filter(id=>ids('Cast').includes(id)).length],[16,19]);
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{seed:{localStorage:{...seen,
    'lukesteuber.minimal.tilt:tilt-levels-grok.v1':JSON.stringify({done:old('l')}),
    'lukesteuber.minimal.cast:cast-3d.v1':JSON.stringify({finished:old('c')}),
    'lukesteuber.minimal.horologist:horologist-plate.v1':JSON.stringify({solved:ids('Horologist').slice(0,-1).concat(ids('Horologist')[0])}),
    'lukesteuber.minimal.slant:slant.progress.v1.recovery.1':done('Slant',54),
    'lukesteuber.minimal.notan:ink.v1':ink(RAMP.slice(1).concat(PLUS)),
    'lukesteuber.minimal.tents:tents.progress.v1':JSON.stringify({version:1,completed:ids('Tents').length})}}});t.after(()=>ctx.close());
  const page=await library(ctx);await page.waitForTimeout(300);
  assert.deepEqual(await page.locator('#tiles .tile.won').evaluateAll(n=>n.map(e=>e.dataset.game)),[],'no old, short, repeated or misplaced record finishes a tile');
  // The same Tilt record with every current campaign board finished.
  await page.evaluate(list=>localStorage.setItem('lukesteuber.minimal.tilt:tilt-levels-grok.v1',JSON.stringify({done:['l13'].concat(list)})),ids('Tilt'));
  await page.reload();await page.locator('#tiles .tile.tilt.won').waitFor();
  assert.deepEqual(await page.locator('#tiles .tile.won').evaluateAll(n=>n.map(e=>e.dataset.game)),['tilt']);
  assert.deepEqual(ctx.parity.errors,[]);
});
test('a solved picture follows the tile\'s ground, fades in, and holds still under reduced motion',async t=>{
  const sets=Object.fromEntries(LIFE.tiles.filter(x=>x.solved).map(x=>[x.name,x]));
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{scheme:'dark',motion:'no-preference',seed:{localStorage:{...seen,[THEME_KEY]:JSON.stringify({theme:'light'}),
    'lukesteuber.minimal.notan:ink.v1':ink(RAMP),'lukesteuber.minimal.slant:slant.progress.v1':done('Slant',53)}}});t.after(()=>ctx.close());
  const page=await library(ctx);await page.locator('#tiles .tile.notan.solved').waitFor();
  const light=await tileState(page,'notan');
  assert.deepEqual([light.src,light.fade,light.wide,light.check],[file(sets.Notan.solved.light),'solved-in',1200,true],'on white, the picture made for white, fading in');
  assert.equal((await tileState(page,'slant')).won,false,'one board short');
  // The library's own Motion setting stills it, as the phone's does.
  await page.locator('#gear').click();await page.locator('#set-motion').selectOption('reduce');await page.keyboard.press('Escape');
  assert.deepEqual([(await tileState(page,'notan')).fade,(await tileState(page,'notan')).solved],['none',true]);
  // Dark: the tiles are drawn again, and Notan takes the picture made for black.
  await page.locator('#gear').click();await page.locator('#set-look').selectOption('dark');await page.keyboard.press('Escape');
  await page.locator('#tiles .tile.notan.solved').waitFor();
  assert.equal((await tileState(page,'notan')).src,file(sets.Notan.solved.dark));
  // Checkerboard: Notan's tile is on black there too, and an unfinished record takes the picture away at the next drawing.
  await page.evaluate(()=>localStorage.removeItem('lukesteuber.minimal.notan:ink.v1'));
  await page.locator('#gear').click();await page.locator('#set-look').selectOption('checkerboard');await page.keyboard.press('Escape');
  await page.locator('#tiles .tile.notan').waitFor();
  const plain=await tileState(page,'notan');assert.deepEqual([plain.won,plain.pictured,plain.src,plain.check],[false,false,'notan.png',false]);
  assert.deepEqual(ctx.parity.errors,[]);
});
test('the phone\'s reduced motion keeps the solved picture and drops its fade',async t=>{
  const ctx=await h.context(await getBrowser(),{width:1280,height:900},{scheme:'light',motion:'reduce',seed:{localStorage:{...seen,'lukesteuber.minimal.slant:slant.progress.v1':done('Slant',54)}}});t.after(()=>ctx.close());
  const page=await library(ctx);await page.locator('#tiles .tile.slant.solved').waitFor();
  const slant=await tileState(page,'slant');assert.deepEqual([slant.fade,slant.wide,slant.check,slant.words],['none',1200,true,' All boards finished.']);
  await page.screenshot({path:path.join(h.EVIDENCE,'finished-tiles-light-desktop.png')});assert.deepEqual(ctx.parity.errors,[]);
});
test("the library's own Reduced motion keeps the solved picture and drops its fade, where the phone asks for nothing",async t=>{
  // The index's stylesheet stills everything under html[data-motion="reduce"] (one rule, after the picture's own),
  // which library-theme.js sets before the first paint. The phone's setting is left at normal motion here.
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{scheme:'dark',motion:'no-preference',seed:{localStorage:{...seen,[THEME_KEY]:JSON.stringify({motion:'reduce'}),'lukesteuber.minimal.slant:slant.progress.v1':done('Slant',54)}}});t.after(()=>ctx.close());
  const page=await library(ctx);await page.locator('#tiles .tile.slant.solved').waitFor();
  assert.deepEqual(await page.evaluate(()=>[matchMedia('(prefers-reduced-motion: reduce)').matches,document.documentElement.getAttribute('data-motion')]),[false,'reduce']);
  const slant=await tileState(page,'slant');assert.deepEqual([slant.fade,slant.solved,slant.wide,slant.check],['none',true,1200,true]);
  assert.equal(await page.locator('#tiles .tile.slant .art img').evaluate(img=>img.getAnimations().length),0,'nothing is running on the picture');
  // Back to the phone's setting, the next picture drawn fades in again.
  await page.locator('#gear').click();await page.locator('#set-motion').selectOption('system');await page.locator('#set-look').selectOption('light');await page.keyboard.press('Escape');
  await page.locator('#tiles .tile.slant.solved').waitFor();
  assert.equal((await tileState(page,'slant')).fade,'solved-in');
  assert.deepEqual(ctx.parity.errors,[]);
});
test('a still library shines once after ten seconds and again every twenty; input, a sheet or reduced motion holds it',async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},{scheme:'dark',motion:'no-preference',seed:{localStorage:seen}});t.after(()=>ctx.close());
  const page=await library(ctx,{clock:true});const glint=()=>page.locator('#tiles .tile.glint').count();
  assert.equal(await intro(page),null);
  await page.clock.runFor(9500);assert.equal(await glint(),0,'nothing before ten seconds');
  await page.clock.runFor(900);assert.ok(await glint()>0,'the shine starts at the first tiles');
  await page.clock.runFor(6000);assert.equal(await glint(),0,'and passes');
  await page.clock.runFor(14500);assert.ok(await glint()>0,'again twenty seconds later');
  await page.clock.runFor(6000);
  await page.keyboard.press('Shift');await page.clock.runFor(9500);assert.equal(await glint(),0,'a key starts the wait again');
  await page.locator('#gear').click();await page.clock.runFor(12000);assert.equal(await glint(),0,'not behind Settings');
  await page.locator('#set-motion').selectOption('reduce');await page.locator('#settings .sheet-x').click();
  await page.clock.runFor(30000);assert.equal(await glint(),0,'not with the library\'s Reduced motion');
  assert.deepEqual(ctx.parity.errors,[]);
});
test('the opening plays in the Checkerboard look too',async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},motion({theme:'checkerboard'}));t.after(()=>ctx.close());
  const page=await library(ctx,{clock:true});await page.clock.runFor(100);
  assert.equal((await intro(page)).shown,true);assert.deepEqual(ctx.parity.errors,[]);
});
for(const [why,options] of [['system reduced motion',{scheme:'dark',motion:'reduce'}],["the library's Motion set to Reduced",motion({theme:'dark',motion:'reduce'})]])
  test(`no opening with ${why}`,async t=>{
    const ctx=await h.context(await getBrowser(),{width:390,height:844},options);t.after(()=>ctx.close());
    const page=await library(ctx,{clock:true});await page.clock.runFor(100);
    assert.equal(await intro(page),null);
    assert.deepEqual(await page.evaluate(()=>[window.__firstOpening,document.documentElement.classList.contains('opening')]),[false,false],'no opening ground at any point');
    assert.equal(await page.locator('#masthead').isVisible(),true,'the title from the start');
    assert.deepEqual(ctx.parity.errors,[]);
  });
test("the library's Motion setting is kept and stops an opening under way",async t=>{
  const ctx=await h.context(await getBrowser(),{width:390,height:844},motion());t.after(()=>ctx.close());
  const page=await library(ctx,{clock:true});await page.clock.runFor(100);
  assert.equal((await intro(page)).shown,true);
  await page.evaluate(()=>MinimalOpening.end());
  await page.locator('#gear').click();await page.locator('#set-motion').selectOption('reduce');
  assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-motion')),'reduce');
  assert.deepEqual(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),THEME_KEY)),{motion:'reduce'});
  assert.deepEqual(ctx.parity.errors,[]);
});
