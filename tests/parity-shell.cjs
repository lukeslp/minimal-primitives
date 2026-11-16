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
  assert.equal(await page.locator('#nickname').isVisible(),true);assert.equal(await page.locator('#share-opt-in').isChecked(),false);
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
  await frame.locator('#minimal-home').click();await page.waitForFunction(()=>!document.querySelector('iframe')||!document.querySelector('#notice').hidden);
  assert.equal(await page.locator('iframe').count(),0,'Library failed: '+await page.locator('#notice').textContent());
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
  assert.deepEqual(tiles.filter(x=>!x.lines&&!x.svg).map(x=>x.name),['Hexsweeper','Spiral Galaxies'],'only these keep their pictures in Dark and Light');
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
  await t.test('no names at rest in the library; the title is the name; the accessible grid keeps its names',async()=>{
    assert.deepEqual(await page.locator('#tiles .cap').evaluateAll(n=>[...new Set(n.map(e=>getComputedStyle(e).display))]),['none']);
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
  await t.test("Settings is the index's sheet: Display, Access and About; the trophy sheet keeps scores and sharing",async()=>{
    await page.locator('#gear').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#settings').evaluate(e=>e.open),true,'the gear opens it from the keyboard');
    assert.deepEqual(await page.locator('#settings .group').allTextContents(),['Display','Access','About']);
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
