'use strict';
// The app package offers only what works, and recovers instead of going blank. Run: node --test tests/shell-review.test.cjs
// (build first with python3 tools/build.py). Each test drives the built library in headless Chrome at phone size.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const h=require('./parity-fixtures/browser.cjs'),a=require('./parity-fixtures/actions.cjs');
const viewport={width:390,height:844};
let browser;const getBrowser=async()=>browser||(browser=await h.launch());after(async()=>browser?.close());
const game=id=>h.games.find(g=>g.id===id);
const inner=page=>page.frames().find(f=>f.parentFrame()===page.mainFrame());
// The library by itself, on a clock the test moves.
async function library(ctx,{wait=true}={}){
  const page=await ctx.newPage();
  await page.clock.install({time:new Date('2026-11-16T12:00:00Z')});await page.clock.pauseAt(new Date('2026-11-16T12:00:01Z'));
  await page.goto(h.ORIGIN+'/export/index.html');
  if(wait)await page.locator('#tiles .tile').first().waitFor();
  return page;
}
const named=locator=>locator.evaluate(node=>node.getAttribute('aria-label')||node.textContent.trim());

test('Cast: no link to the old Cast, and the page without WebGL leads back to the library',async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game('cast'));
  await frame.locator('#settings-btn').click();
  assert.equal(await frame.locator('#settings .sheet-foot').innerText(),'All games · lukesteuber.com');
  assert.equal(await frame.locator('a[href="../cast/"]').count(),0,'nothing leads back into Cast without the collection');
  // All games still answers: the collection's handshake is the one this page was opened with.
  await frame.locator('#settings .sheet-foot a',{hasText:'All games'}).focus();await page.keyboard.press('Enter');
  await page.locator('#library:visible').waitFor();assert.equal(await page.locator('#player iframe').count(),0);

  const bare=await h.context(await getBrowser(),viewport);t.after(()=>bare.close());
  await bare.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...rest){return /webgl/.test(type)?null:get.call(this,type,...rest);};});
  const second=await library(bare);await h.open(second,'cast');await second.waitForSelector('#player iframe');
  const fallback=inner(second).locator('#fallback');await fallback.waitFor({state:'visible'});
  assert.equal(await fallback.innerText(),'This lit room needs WebGL, which this browser has turned off. Back to all games.');
  await fallback.locator('a').focus();await second.keyboard.press('Enter');
  await second.locator('#library:visible').waitFor();assert.equal(await second.locator('#player iframe').count(),0,'the fallback leads Home');
});

test('Slant, Bridges, Spiral Galaxies and Fold: Settings offers no Share, Copy link or Download',async t=>{
  for(const id of ['slant','bridges','galaxies','fold']){
    const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
    const {page,frame}=await h.shell(ctx,game(id));
    await frame.locator('#settings-btn').click();
    const groups=await frame.locator('#settings h3.group').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).map(n=>n.textContent));
    assert.ok(groups.includes('Display')&&!groups.includes('Share'),id+': '+groups.join(', '));
    for(const control of ['#share','#share-picture','#download','#share-btn','#download-btn'])
      if(await frame.locator(control).count())assert.equal(await frame.locator(control).isVisible(),false,id+' '+control);
    if(id!=='slant')continue;
    // Free draw kept a Download drawing button on the board; it is the same download.
    const first=await frame.locator('#campaign option').first().getAttribute('value');await frame.locator('#campaign').selectOption(first);await page.clock.runFor(300);
    if(await frame.locator('#settings').evaluate(d=>d.open))await frame.locator('#settings').evaluate(d=>d.close());
    await frame.locator('#free-btn').click();await page.clock.runFor(300);
    assert.equal(await frame.locator('#download-btn').evaluate(b=>b.hidden),false,'the game itself would show it');
    assert.equal(await frame.locator('#download-btn').isVisible(),false,'the package does not');
  }
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const quick=await h.standalone(ctx,game('notan'),{query:'endless=5&seed=271828',generated:true});
  assert.equal(await quick.locator('#share-btn').isVisible(),false,'Notan quick play: no Share blank');
});

// A picture leaves a game only through the system's share sheet. Without one (Android's web view has none) the other
// way out is a download the apps drop while the game says "Image saved", so the buttons are not shown there.
for(const sheet of [true,false])test(`Tangles' Save the picture and Sphere's Share image ${sheet?'show where the system can share a picture':'are not shown where it cannot'}`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  await ctx.addInitScript(sheet=>{
    for(const name of ['share','canShare'])Object.defineProperty(Navigator.prototype,name,{configurable:true,value:sheet?(name==='share'?async()=>{}:()=>true):undefined});
  },sheet);
  const {page,frame}=await h.shell(ctx,game('tangles'));
  assert.equal(await frame.evaluate(()=>'minimalShare' in document.documentElement.dataset),sheet);
  await a.solve(frame,'tangles');
  await frame.locator('#settings-btn').click();
  const save=frame.locator('#settings .save');
  assert.equal(await save.count(),1,'the finished board carries its button');
  assert.equal(await named(save),'Save the picture of board 1');
  assert.equal(await save.isVisible(),sheet);
  // The same in Tangles' Experiments, and for the picture Hexsweeper's sphere offers when a board is cleared.
  const shown=(target,selector)=>target.evaluate(sel=>{const probe=document.querySelector(sel)||document.body.appendChild(Object.assign(document.createElement('button'),{className:sel.slice(1)}));return getComputedStyle(probe).display!=='none';},selector);
  await page.goto(h.ORIGIN+'/export/games/tangles/experiments.html');
  assert.equal(await shown(page,'.save'),sheet,'Experiments');
  await page.goto(h.ORIGIN+'/export/games/hexsweeper/sphere/index.html');
  assert.equal(await page.locator('#share-win-btn').count(),1);
  assert.equal(await shown(page,'#share-win-btn'),sheet,'Sphere');
});

test('a save the device refuses is read back as written, and the library says so once',async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  // The device's own storage, refusing writes while __full is set (a full disk).
  await ctx.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__full)throw new DOMException('Fixture storage full','QuotaExceededError');return set.call(this,key,value);};});
  const {page,frame}=await h.shell(ctx,game('notan'));
  const seen=await frame.evaluate(()=>{
    localStorage.setItem('probe','older');
    window.__full=true;localStorage.setItem('probe','newer');localStorage.setItem('fresh','1');
    const pending=[localStorage.getItem('probe'),localStorage.getItem('fresh'),Object.keys(MinimalBridge.storage()).includes('fresh')];
    localStorage.removeItem('fresh');const removed=localStorage.getItem('fresh');
    window.__full=false;const still=localStorage.getItem('probe');
    localStorage.setItem('probe','newest');
    return {pending,removed,still,stored:localStorage.getItem('probe')};
  });
  assert.deepEqual(seen,{pending:['newer','1',true],removed:null,still:'newer',stored:'newest'});
  await page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#notice').textContent(),'Could not save on this device. Progress may not be kept.');
  assert.equal(await page.locator('#notice').getAttribute('role'),'status');
  await page.clock.runFor(5100);assert.equal(await page.locator('#notice').isHidden(),true);
  await frame.evaluate(()=>{window.__full=true;localStorage.setItem('again','1');window.__full=false;});
  await page.clock.runFor(100);assert.equal(await page.locator('#notice').isHidden(),true,'said once, not at every write');
  assert.deepEqual(ctx.parity.errors,[]);

  // A game whose very first save is refused, before it has reported ready: the library still hears of it.
  const full=await h.context(await getBrowser(),viewport);t.after(()=>full.close());
  await full.addInitScript(()=>{if(parent===window)return;Storage.prototype.setItem=function(){throw new DOMException('Fixture storage full','QuotaExceededError');};});
  const early=await h.shell(full,game('notan'));
  await early.frame.locator('#board .cell').first().focus();await early.page.keyboard.press('Enter');
  await early.page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await early.page.locator('#notice').textContent(),'Could not save on this device. Progress may not be kept.');
});

test('scores: plain wording without a service, and recent results at the library',async t=>{
  const identity=(id,puzzleId,scoringPolicy)=>({game:id,mode:'campaign',puzzleId,layoutHash:'0'.repeat(64),rulesVersion:'fixture',scoringPolicy});
  const kept=[['slant','p3','time-v1',0,83000],['tangles','7','hits-v1',12,40000],['tilt','4','moves-v1',1,9000],['delve','daily','depth-v1',6,200000],['gone','1','time-v1',0,1000]]
    .map(([id,puzzle,policy,value,elapsedMs],n)=>({game:id,identity:identity(id,puzzle,policy),value,elapsedMs,localAt:n+1,practice:true,assisted:false,repeat:false}));
  const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:{'lukesteuber.minimal.collection.v1:results':JSON.stringify(kept)}}});t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game('notan'));
  for(let n=0;n<4;n++)if(await frame.evaluate(n=>__notan.S.cells[n]!==1,n)){await frame.locator('#board .cell').nth(n).focus();await page.keyboard.press('Enter');}
  await frame.waitForFunction(()=>__notan.S.solved);await page.clock.runFor(200);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:results')).length===6);
  // Inside a game, with no score service: this board's results on this device, and no word of a preview.
  await frame.locator('#settings-btn').click();await frame.getByRole('button',{name:'Collection scores',exact:true}).click();
  await page.locator('#scores[open]').waitFor();await page.locator('#score-list .score-row').first().waitFor();
  assert.match(await page.locator('#score-context').textContent(),/^Notan · /);
  assert.equal(await page.locator('#scores-local').innerText(),'Scores stay on this device.');
  assert.equal(await page.locator('#score-category').isVisible(),false,'no picker of shared boards without a service');
  assert.deepEqual((await page.locator('#score-list .score-row').first().innerText()).split('\n').slice(0,2),['1','Unassisted']);
  assert.doesNotMatch(await page.locator('#scores').innerText(),/preview|Practice/i);
  await page.locator('#scores .close').click();await frame.locator('#settings').evaluate(d=>d.close());
  // The game's own request for a shared board gets the same plain sentence.
  assert.match(await page.evaluate(()=>fetch('collection.js').then(r=>r.text())),/throw new Error\('Scores stay on this device\.'\)/);
  // At the library the trophy lists the last boards finished, newest first, each with what it was scored by.
  await frame.locator('#minimal-home').click();await page.locator('#library:visible').waitFor();
  await page.locator('#scores-button').focus();await page.keyboard.press('Enter');await page.locator('#scores[open]').waitFor();
  assert.equal(await page.locator('#score-context').textContent(),'Recently finished on this device');
  const rows=(await page.locator('#score-list .score-row').allInnerTexts()).map(row=>row.split('\n'));
  assert.equal(rows[0][0],'Notan');
  assert.deepEqual(rows.slice(1),[['Delve','daily','depth 6'],['Tilt','4','1 move'],['Tangles','7','12 hits'],['Slant','p3','83s']],'a game the package no longer carries is left out');
  assert.equal(await page.locator('#score-category').isVisible(),false);
  assert.doesNotMatch(await page.locator('#scores').innerText(),/Choose a game|preview/i);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#scores').evaluate(d=>d.open),false);

  const fresh=await h.context(await getBrowser(),viewport);t.after(()=>fresh.close());
  const empty=await library(fresh);await empty.locator('#scores-button').click();
  assert.equal(await empty.locator('#score-context').textContent(),'No finished boards yet. Finish one and it is listed here.');
  assert.equal(await empty.locator('#score-list .score-row').count(),0);
});

test('a library that cannot load clears the opening and offers Retry',async t=>{
  // Normal motion and a first launch: the opening's ground is up before the catalog is read.
  const ctx=await h.context(await getBrowser(),viewport,{motion:'no-preference'});t.after(()=>ctx.close());
  let failing=true;
  await ctx.route('**/export/catalog.json',route=>failing?route.fulfill({status:500,body:'unavailable'}):route.fallback());
  const page=await library(ctx,{wait:false});
  await page.locator('#load-failed').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('opening')),false,'the opening state is cleared');
  assert.equal(await page.locator('#intro').count(),0,'its ground is gone');
  assert.equal(await page.locator('#load-failed').innerText(),'The games could not load.\n\nRetry');
  assert.equal(await page.locator('#load-failed').getAttribute('role'),'alert');
  await page.clock.runFor(60000);assert.equal(await page.locator('#load-failed').isVisible(),true,'the message stays');
  // By keyboard: Retry is the next stop after Settings, and it is a button named Retry.
  await page.locator('#gear').focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'load-retry');
  assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.getElementById('load-failed').hidden&&document.querySelectorAll('#tiles .tile').length===0);
  // That failed read may still be under way, and a press during it does nothing: press until the library is drawn.
  failing=false;
  for(let i=0;i<30&&!(await page.locator('#tiles .tile').count());i++){await page.keyboard.press('Enter');await page.waitForTimeout(100);}
  await page.locator('#tiles .tile').first().waitFor({state:'attached'});
  assert.equal(await page.locator('#load-failed').isHidden(),true);
  assert.equal(await page.locator('#tiles .tile').count(),h.mainTiles);
  assert.deepEqual(ctx.parity.errors,[]);
});

test('a game that never reports ready gets the collection\'s own way Home',async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  await ctx.route('**/export/games/towers/**',route=>route.fulfill({status:404,body:''}));
  const page=await library(ctx);
  await h.open(page,'towers');await page.waitForSelector('#player iframe');
  await page.clock.runFor(7900);assert.equal(await page.locator('#stalled').isVisible(),false,'not before eight seconds');
  await page.clock.runFor(200);await page.locator('#stalled').waitFor({state:'visible'});
  assert.equal(await page.locator('#stalled').innerText(),'This game has not finished opening.\n\nHome');
  assert.equal(await page.locator('#stalled').getAttribute('role'),'alert');
  assert.equal(await page.getByRole('button',{name:'Home',exact:true}).count(),1);
  await page.locator('#stalled-home').focus();await page.keyboard.press('Enter');
  await page.locator('#library:visible').waitFor();
  assert.equal(await page.locator('#player iframe').count(),0);assert.equal(await page.locator('#stalled').isVisible(),false);
  assert.equal(new URL(page.url()).hash,'','the stalled game is no longer selected');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.open),'towers','focus returns to its tile');
  // A game that opens normally never shows it.
  await h.open(page,'notan');await page.waitForSelector('#player iframe');await h.ready(inner(page),true);
  await page.clock.runFor(9000);assert.equal(await page.locator('#stalled').isVisible(),false);
});

test('Privacy policy: a Settings row that opens the bundled page, by keyboard',async t=>{
  for(const scheme of ['dark','light']){
    const ctx=await h.context(await getBrowser(),viewport,{scheme});t.after(()=>ctx.close());
    const page=await library(ctx);
    await page.locator('#gear').focus();await page.keyboard.press('Enter');await page.locator('#settings[open]').waitFor();
    assert.deepEqual(await page.locator('#settings h3.group').allTextContents(),['Display','Access','Privacy','About']);
    const row=page.locator('#set-privacy');
    assert.equal(await row.evaluate(b=>b.parentElement.textContent),'Privacy policyRead');
    assert.equal(await named(row),'Read the privacy policy');assert.equal(await row.evaluate(b=>b.tagName),'BUTTON');
    await page.locator('#set-access').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'set-privacy','the row is the next stop after Access');
    await page.keyboard.press('Enter');await page.locator('#privacy[open]').waitFor();
    assert.equal(await page.locator('#privacy').getAttribute('aria-labelledby'),'privacy-title');
    assert.equal(await page.locator('#privacy-title').textContent(),'Privacy policy');
    assert.equal(await named(page.locator('#privacy .sheet-x')),'Close Privacy policy');
    assert.deepEqual(await page.locator('#privacy-body h3').allTextContents(),['Data collection','Saved games and scores','Camera','Permissions','Links','Children and families','Contact']);
    const text=await page.locator('#privacy-body').innerText();
    assert.match(text,/does not collect personal data or usage data/);assert.match(text,/never saved, uploaded or shared/);
    assert.equal(await page.locator('#privacy-body a').count(),0,'the sheet has its own Close; nothing in it leaves the app');
    // The sheet takes the library's theme.
    const ground=await page.locator('#privacy').evaluate(d=>getComputedStyle(d).backgroundColor);
    assert.equal(ground,scheme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');
    // Escape closes the page and returns to its row in Settings, which is still open.
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>[document.getElementById('privacy').open,document.getElementById('settings').open,document.activeElement.id]),[false,true,'set-privacy']);
    // The page itself, opened directly: same text, the library's theme, and a way back.
    const direct=await ctx.newPage();await direct.goto(h.ORIGIN+'/export/privacy.html');
    assert.equal(await direct.evaluate(()=>getComputedStyle(document.body).backgroundColor),ground);
    assert.equal(await direct.locator('h1').textContent(),'Privacy policy');
    await direct.keyboard.press('Tab');assert.equal(await direct.evaluate(()=>document.activeElement.textContent),'All games');
    await direct.keyboard.press('Enter');await direct.waitForURL(/\/export\/index\.html$/);
    assert.deepEqual(ctx.parity.errors,[]);
  }
});

test('the camera waits for a press in the game that is open',async t=>{
  // Camera permission was granted earlier (another game, another day). Opening a game must not start the camera.
  const look={'lukesteuber.minimal.shared:minimal-access.v1:default':JSON.stringify({mode:'look',look:'head',hold:800,speed:'normal'})};
  for(const id of ['glance','glyph','pursuit','shoo','nod','noon']){
    const ctx=await h.context(await getBrowser(),viewport,{seed:id==='noon'?{localStorage:look}:{}});t.after(()=>ctx.close());
    await ctx.grantPermissions(['camera'],{origin:h.ORIGIN});
    await ctx.addInitScript(()=>{window.__cameraAsked=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.__cameraAsked++;return Promise.reject(new DOMException('Fixture has no camera','NotFoundError'));};});
    const page=await ctx.newPage();await page.goto(h.ORIGIN+'/export/index.html#game='+id);
    await page.waitForSelector('#player iframe');const frame=inner(page);
    await frame.waitForFunction(()=>document.readyState==='complete');
    assert.equal(await frame.evaluate(async()=>(await navigator.permissions.query({name:'camera'})).state),'granted',id);
    const key=frame.locator(id==='noon'?'.access-pad [data-key="camera"]':'#camera-start');
    await key.waitFor({state:'visible'});await page.waitForTimeout(600);
    assert.equal(await frame.evaluate(()=>window.__cameraAsked),0,id+': no camera on opening');
    const box=await key.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.up();
    await frame.waitForFunction(()=>window.__cameraAsked===1);
  }
});

// ---- Found by two outside reviews of 0.5.8 before submission (2026-11-16). ----
const fs=require('node:fs'),path=require('node:path');
// The game frame once it has loaded a page and the collection's Home is in it. A frame keeps its handle across pages.
const arrived=async(frame,url)=>{await frame.waitForURL(url);await frame.waitForFunction(()=>document.readyState==='complete'&&!!document.getElementById('minimal-home'));};
async function enter(page,key,url){await h.open(page,key);await page.waitForSelector('#player iframe');const frame=inner(page);await arrived(frame,url);return frame;}
async function goHome(page,frame,list='#library'){await frame.locator('#minimal-home').focus();await page.keyboard.press('Enter');await page.locator(list+':visible').waitFor();assert.equal(await page.locator('#player iframe').count(),0);}
// Every board of Tangles' own fifty finished, as its own record says it: that is what opens New Game+.
const beatTangles=frame=>frame.evaluate(()=>{const save=JSON.parse(localStorage.getItem('loop.v1')||'{}');save.finished=[...new Set([...(save.finished||[]),'L50'])];localStorage.setItem('loop.v1',JSON.stringify(save));});
const TANGLES=/\/games\/tangles\/index\.html$/;

test("a link to another packaged page keeps Home: Tangles' Experiments, the way back, and New Game+",async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game('tangles'));
  // Settings, Experiments, a tiling. The game's own link names the page and nothing else.
  await frame.locator('#settings-btn').click();
  const tiling=frame.locator('#experiments a.experiment[href$="set=488"]');
  assert.equal(await tiling.getAttribute('href'),'./experiments.html?set=488');
  await tiling.click();await arrived(frame,/\/games\/tangles\/experiments\.html\?set=488$/);
  assert.equal(await frame.evaluate(()=>document.title),'Tangles · Octagons and squares');
  assert.equal(await frame.evaluate(()=>typeof MinimalBridge.nonce),'string','the handshake went with the link');
  await goHome(page,frame);
  // Help names the same tilings. From one of them, Settings leads back to Tangles, and Home answers there too.
  let again=await enter(page,'tangles',TANGLES);
  await again.locator('#help-btn').click();
  await again.locator('#help .experiments-help a[href$="set=square"]').click();await arrived(again,/experiments\.html\?set=square$/);
  await again.locator('#settings-btn').click();
  await again.locator('#experiments a.experiment',{hasText:'Fifty boards'}).click();await arrived(again,TANGLES);
  assert.equal(await again.evaluate(()=>typeof MinimalBridge.nonce),'string');
  await goHome(page,again);
  // New Game+, offered after board 50: in Settings, and as the disc on that board.
  again=await enter(page,'tangles',TANGLES);
  await beatTangles(again);await again.locator('#settings-btn').click();
  const plus=again.locator('#experiments a.experiment',{hasText:'New Game+'});
  assert.equal(await plus.getAttribute('href'),'./experiments.html?plus');
  await plus.click();await arrived(again,/experiments\.html\?plus=?$/);
  assert.equal(await again.evaluate(()=>document.title),'Tangles · New Game+');
  await goHome(page,again);
  again=await enter(page,'tangles',TANGLES);
  assert.equal(await again.locator('#plus-btn').getAttribute('href'),'./experiments.html?plus');
  await again.locator('#plus-btn').evaluate(a=>{a.hidden=false;a.click();});await arrived(again,/experiments\.html\?plus=?$/);
  await goHome(page,again);
  assert.equal(new URL(page.url()).hash,'','Home left no game selected');
  // The handshake is carried in one place for every game (adapters/bootstrap.js), so a link a game gains later
  // cannot strand a player: a bare link to a packaged page, made up here inside Notan, lands in a page whose Home
  // answers. A link to a place in the same page, and a link the game handles itself, are left as they are.
  const other=await enter(page,'notan',/\/games\/notan\/index\.html$/);
  await other.evaluate(()=>{
    window.__same=true;
    for(const [id,href] of [['fixture-bare','./index.html?endless=5&seed=271828'],['fixture-place','#board'],['fixture-own','./index.html?own=1']]){const a=document.createElement('a');a.id=id;a.href=href;a.textContent=id;document.body.append(a);}
    document.getElementById('fixture-own').addEventListener('click',event=>event.preventDefault());
  });
  await other.locator('#fixture-place').evaluate(a=>a.click());await other.locator('#fixture-own').evaluate(a=>a.click());
  assert.deepEqual(await other.evaluate(()=>[window.__same,location.hash,document.getElementById('fixture-place').getAttribute('href'),document.getElementById('fixture-own').getAttribute('href')]),[true,'#board','#board','./index.html?own=1']);
  await other.locator('#fixture-bare').evaluate(a=>a.click());await arrived(other,/\/games\/notan\/index\.html\?endless=5&seed=271828$/);
  assert.deepEqual(await other.evaluate(()=>[window.__same,typeof MinimalBridge.nonce]),[undefined,'string'],'a new page, with the handshake');
  await goHome(page,other);
  assert.deepEqual(ctx.parity.errors,[]);
});

// The Android shell's Back runs these scripts in the library page (MainActivity.kt). They are read from the source
// and run here as the shell runs them.
const KOTLIN=fs.readFileSync(path.join(h.ROOT,'android/app/src/main/java/minimalprimitives/android/MainActivity.kt'),'utf8');
const shellScript=name=>{const found=KOTLIN.match(new RegExp('const val '+name+' = """([\\s\\S]*?)"""'));assert.ok(found,name);return found[1];};
test("Android's Back counts Home only once the library shows, for the one game it was pressed in, and never drops a board",async t=>{
  const BACK=shellScript('BACK_SCRIPT'),LEAVE=shellScript('LEAVE_SCRIPT'),leaveScript=opened=>LEAVE.replace('OPENED_HANDSHAKE',opened?`'${opened}'`:'null');
  // The glue around the scripts: a press of Home starts one check, named by that game's handshake; nothing reloads a game.
  assert.match(KOTLIN,/answer\.startsWith\("home:"\) -> awaitHome\(answer\.removePrefix\("home:"\)\)/);
  assert.match(KOTLIN,/if \(!HANDSHAKE\.matches\(opened\) \|\| pendingHome == opened\) return\s+forgetHome\(\)\s+pendingHome = opened\s+webView\.postDelayed\(confirmHome, HOME_LIMIT_MS\)/);
  assert.match(KOTLIN,/webView\.evaluateJavascript\(LEAVE_SCRIPT\.replace\(OPENED, "'\$opened'"\), null\)/);
  assert.ok(Number(KOTLIN.match(/const val HOME_LIMIT_MS = (\d+)L/)[1])>5000,"longer than the library's own wait for a game's board");
  assert.equal(KOTLIN.split('location.replace(').length,2,'the one reload left is for a library that never started');
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  const {page,frame}=await h.shell(ctx,game('tangles'));
  const handshake=()=>page.evaluate(()=>new URL(document.querySelector('#player iframe').src).searchParams.get('minimal'));
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:saves')||'{}').tangles||null);
  const still=async()=>{await page.evaluate(()=>{window.__same=true;});return ()=>page.evaluate(()=>window.__same===true);};
  let same=await still();
  // An ordinary game: Back presses its Home, and the library shows. The check that follows finds nothing to do.
  const first=await handshake();
  assert.equal(await page.evaluate(BACK),'home:'+first);await page.locator('#library:visible').waitFor();
  assert.equal(await page.evaluate(leaveScript(first)),'library');
  assert.equal(await page.evaluate(BACK),'library','from the library Back leaves the app');
  // A page reached by a link carries the handshake, so Back works there as well.
  let again=await enter(page,'tangles',TANGLES);
  await again.locator('#settings-btn').click();
  await again.locator('#experiments a.experiment[href$="set=triangle"]').click();await arrived(again,/experiments\.html\?set=triangle$/);
  const linked=await handshake();
  assert.equal(await page.evaluate(BACK),'home:'+linked);await page.locator('#library:visible').waitFor();
  // The check belongs to one game. Back in a first game, then a second game opened before the first one's check
  // comes due: that check says nothing about the second game, which stays open.
  again=await enter(page,'tangles',TANGLES);const second=await handshake();assert.notEqual(second,first);
  assert.equal(await page.evaluate(leaveScript(first)),'library');
  assert.equal(await page.locator('#player').isVisible(),true,'the second game is untouched');
  // A game that does not hand over its board: Home is pressed, the library waits five seconds and gives up. The
  // shell's check then has the library take the board as it stands, store it, and show itself. Nothing reloads.
  await a.keyMove(again,'tangles');const moved=await h.snapshot(again);
  await again.evaluate(()=>{MinimalAdapter.snapshot=()=>new Promise(()=>{});});
  assert.equal(await page.evaluate(BACK),'home:'+second);
  await page.clock.runFor(5100);await page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#notice').textContent(),'The game did not respond. Your current board is still open.');
  assert.equal(await page.locator('#player').isVisible(),true);
  assert.equal(await page.evaluate(leaveScript(second)),'saved');
  await page.locator('#library:visible').waitFor();assert.equal(await page.locator('#player iframe').count(),0);
  h.sameSnapshot((await saved()).state,moved,'the board as it stood is what was stored');
  assert.equal(await same(),true,'the library was not loaded again');
  // A board that cannot be saved at all (the game will not give it up, or the device will not store it): the
  // player is asked, over the game. Back leaves the question up. Keep playing closes it; Leave anyway leaves.
  for(const broken of ['game','device']){
    again=await enter(page,'tangles',TANGLES);const opened=await handshake();
    if(broken==='game')await again.evaluate(()=>{MinimalAdapter.snapshot=()=>new Promise(()=>{});MinimalAdapter.checkpoint=()=>{throw new Error('Fixture: no board');};});
    else{await again.evaluate(()=>{MinimalAdapter.snapshot=()=>new Promise(()=>{});});await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__full&&String(key).endsWith(':saves'))throw new DOMException('Fixture storage full','QuotaExceededError');return set.call(this,key,value);};window.__full=true;});}
    const before=await page.evaluate(()=>localStorage.getItem('lukesteuber.minimal.collection.v1:saves'));
    assert.equal(await page.evaluate(BACK),'home:'+opened);await page.clock.runFor(5100);
    assert.equal(await page.evaluate(leaveScript(opened)),'asked',broken);
    assert.equal(await page.locator('#unsaved').innerText(),'This board could not be saved.\n\nKeep playing\nLeave anyway',broken);
    assert.equal(await page.locator('#unsaved').getAttribute('role'),'alertdialog');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'unsaved-stay','the safe answer has the focus');
    assert.equal(await page.locator('#player').isVisible(),true,'the game is still there');
    assert.equal(await page.evaluate(BACK),'asked');assert.equal(await page.locator('#unsaved').isVisible(),true);
    await page.keyboard.press('Enter');
    assert.deepEqual([await page.locator('#unsaved').isVisible(),await page.locator('#player').isVisible()],[false,true],'Keep playing');
    assert.equal(await page.evaluate(leaveScript(null)),'asked');
    await page.locator('#unsaved-leave').focus();await page.keyboard.press('Enter');
    await page.locator('#library:visible').waitFor();assert.equal(await page.locator('#player iframe').count(),0);
    assert.equal(await page.locator('#unsaved').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.open),'tangles','focus returns to its tile');
    assert.equal(await page.evaluate(()=>localStorage.getItem('lukesteuber.minimal.collection.v1:saves')),before,'what the device held is as it was');
    await page.evaluate(()=>{window.__full=false;});
  }
  // A page loaded without the handshake (a script's own navigation, which no link handler sees): its Home is drawn
  // and does nothing. Back says so at once, and the library leaves it: an Experiments page keeps its own boards.
  again=await enter(page,'tangles',TANGLES);
  await again.evaluate(()=>{location.assign('./experiments.html?set=488');});await arrived(again,/experiments\.html\?set=488$/);
  assert.equal(await again.evaluate(()=>MinimalBridge.nonce),null);
  await again.locator('#minimal-home').click();await page.clock.runFor(1000);
  assert.equal(await page.locator('#player').isVisible(),true,'Home cannot answer in that page');
  assert.equal(await page.evaluate(BACK),'stuck');
  assert.equal(await page.evaluate(leaveScript(null)),'left');
  await page.locator('#library:visible').waitFor();assert.equal(await page.locator('#player iframe').count(),0);
  // The same for a game's own page that lost the handshake: its board is saved on the way out.
  again=await enter(page,'tangles',TANGLES);
  await again.evaluate(()=>{window.__old=true;location.assign('./index.html');}).catch(()=>{});
  await again.waitForFunction(()=>!window.__old&&document.readyState==='complete'&&!!document.getElementById('minimal-home')&&!!window.MinimalAdapter);
  assert.equal(await again.evaluate(()=>MinimalBridge.nonce),null);
  const bare=await h.snapshot(again);
  assert.equal(await page.evaluate(BACK),'stuck');
  assert.equal(await page.evaluate(leaveScript(null)),'saved');
  await page.locator('#library:visible').waitFor();h.sameSnapshot((await saved()).state,bare);
  assert.equal(await same(),true,'no step of this loaded the library again');
  // With nothing open the script does nothing, and a library that never started is the one thing loaded again.
  assert.equal(await page.evaluate(leaveScript(null)),'library');
  await page.evaluate(()=>{delete window.MinimalLibrary;});
  assert.equal(await page.evaluate(leaveScript(null)).catch(()=>'reloaded'),'reloaded');
  await page.waitForURL(url=>url.pathname.endsWith('/export/index.html')&&!url.hash);await page.locator('#tiles .tile').first().waitFor();
  assert.deepEqual(ctx.parity.errors,[]);
});

test('Hexsweeper: Help links to no other mode, the Water Wheel has no door, and the history line is plain words',async t=>{
  for(const [mode,file] of [['sphere','sphere/index.html'],['infinite','infinite.html'],['classic','bounded.html']]){
    const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
    const page=await library(ctx),frame=await enter(page,'hexsweeper:'+mode,url=>url.pathname.endsWith('/games/hexsweeper/'+file));
    // Every link the page holds, whatever sheet it sits in: the author's two sites and nothing inside the package.
    const links=await frame.evaluate(()=>[...document.querySelectorAll('a[href]')].filter(a=>!a.hasAttribute('data-minimal-library')).map(a=>a.getAttribute('href')));
    assert.deepEqual([...new Set(links)].sort(),['https://datapoems.io','https://lukesteuber.com'],mode);
    assert.equal(await frame.locator('.help-more').count(),0,mode+': no "Also" row');
    assert.doesNotMatch(await frame.evaluate(()=>document.body.textContent),/Water Wheel/,mode);
    if(mode!=='sphere'){await goHome(page,frame);continue;}
    assert.equal(await frame.locator('#help-wheel-btn,#qc-wheel,.help-egg-row,.qc-egg-door').count(),0,'no door in Help, on the mine count or for a screen reader');
    // Since 0.5.9 the history row (the screenshot of Microsoft Minesweeper and its line) is out of every build.
    assert.equal(await frame.locator('.help-history-row,.help-history-cap,#history-lightbox,img[src*="classic-minesweeper"]').count(),0,'no history picture or line');
    assert.match(await frame.locator('#help-theme-credit').evaluate(p=>p.textContent),/^Photographs: Ion Storm by Felix Mittermeier, Galaxy by Jose G\. Ortega Castro, Heat Lightning by Max LaRochelle, on Unsplash \(Unsplash License\)\.$/);
    // Holding the mine count is no gesture now: no fill, no announcement, the timer is left alone, the page stays.
    await frame.evaluate(()=>{window.__paused=0;const sphere=window.HEXSWEEPER_SPHERE_GAME,pause=sphere.pauseTimer;sphere.pauseTimer=function(){window.__paused++;return pause.apply(this,arguments);};
      document.querySelector('.qc-mines').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));});
    await page.clock.runFor(2500);
    assert.deepEqual(await frame.evaluate(()=>{const mines=document.querySelector('.qc-mines');return[window.__paused,mines.className,document.querySelector('.qc-live').textContent,location.pathname.split('/').slice(-2).join('/')];}),
      [0,'qc-stat qc-mines','','sphere/index.html']);
    await goHome(page,frame);
    assert.deepEqual(ctx.parity.errors,[]);
  }
});

for(const worker of [true,false])test(`Cube Maze: Hint shows a move ${worker?'from its background search':'where a worker cannot be made'}`,async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  if(!worker)await ctx.addInitScript(()=>{window.__refused=0;window.Worker=function(){window.__refused++;throw new DOMException('Fixture refuses workers','SecurityError');};});
  const {page,frame}=await h.shell(ctx,game('cube-maze'));
  await frame.locator('#hint-btn').click();
  for(let n=0;n<80&&!(await frame.evaluate(()=>/Hint shown|Undo is the way back/.test(document.getElementById('announcement').textContent)));n++){await page.clock.runFor(100);await page.waitForTimeout(50);}
  assert.equal(await frame.locator('#announcement').textContent(),'Hint shown; press Hint again to play it.');
  assert.equal(await frame.locator('#hint-btn').getAttribute('aria-pressed'),'true');
  if(!worker)assert.equal(await frame.evaluate(()=>window.__refused),1,'the worker was asked for and refused');
  // The second press plays the move that was shown.
  const before=(await h.snapshot(frame)).history.length;
  await frame.locator('#hint-btn').click();
  for(let n=0;n<80&&(await h.snapshot(frame).catch(()=>({history:[]}))).history.length===before;n++){await page.clock.runFor(100);await page.waitForTimeout(20);}
  assert.equal((await h.snapshot(frame)).history.length,before+1);
  assert.deepEqual(ctx.parity.errors,[]);
});

test('a picture the share sheet does not take is said in words, kept for the next press, and never downloaded',async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  // A share sheet that refuses (the press ran out while the picture was drawn), that is dismissed, or that takes it.
  await ctx.addInitScript(()=>{
    window.__share={calls:0,answer:'refuse',names:[]};window.__downloads=0;
    // The sheet takes an empty picture (the page is marked by such a probe) and, on request, not the real one.
    Object.defineProperty(Navigator.prototype,'canShare',{configurable:true,value:data=>window.__share.answer!=='not this picture'||data.files[0].size===0});
    const opening=window.open;window.open=function(){window.__downloads++;return opening.apply(this,arguments);};
    Object.defineProperty(Navigator.prototype,'share',{configurable:true,value:async data=>{
      window.__share.calls++;window.__share.names.push(data.files[0].name);
      if(window.__share.answer==='refuse')throw new DOMException('Fixture: must be handling a user gesture','NotAllowedError');
      if(window.__share.answer==='dismiss')throw new DOMException('Fixture: dismissed','AbortError');
    }});
    const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download'))window.__downloads++;return click.call(this);};
  });
  const NOTICE='The picture could not be shared. Try again.';
  const waitFor=async(page,frame,test,arg)=>{for(let n=0;n<100&&!(await frame.evaluate(test,arg));n++){await page.clock.runFor(50);await page.waitForTimeout(20);}assert.equal(await frame.evaluate(test,arg),true);};
  const quiet=async page=>{await page.clock.runFor(5100);assert.equal(await page.locator('#notice').isHidden(),true);};
  const {page,frame}=await h.shell(ctx,game('tangles'));
  await a.solve(frame,'tangles');await frame.locator('#settings-btn').click();
  const save=frame.locator('#settings .save');
  await save.click();await waitFor(page,frame,()=>window.__share.calls===1);
  await page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#notice').textContent(),NOTICE);
  assert.deepEqual(await frame.evaluate(()=>[window.__downloads,document.getElementById('announcement').textContent==='Image saved.']),[0,false],'nothing is downloaded and nothing is called saved');
  await quiet(page);
  // The picture that was drawn is kept: the next press hands it over with no drawing in between (the clock is still).
  await frame.evaluate(()=>{window.__kept=window.__minimalPicture.image;window.__share.answer='take';});
  await save.click();await frame.waitForFunction(()=>window.__share.calls===2);
  await frame.waitForFunction(()=>document.getElementById('announcement').textContent==='Image shared.');
  assert.deepEqual(await frame.evaluate(()=>[window.__minimalPicture.image===window.__kept,window.__share.names,window.__downloads]),[true,['loop-L01.png','loop-L01.png'],0]);
  assert.equal(await page.locator('#notice').isHidden(),true);
  // A player who turns the sheet away is told nothing.
  await frame.evaluate(()=>{window.__share.answer='dismiss';});
  await save.click();await frame.waitForFunction(()=>window.__share.calls===3);await page.clock.runFor(200);
  assert.equal(await page.locator('#notice').isHidden(),true);
  // A sheet that will not take this picture (the probe that marked the page used an empty one): the same words,
  // and still no download, no window and no "Image saved." The sheet is not even tried.
  for(const kept of [true,false]){
    await frame.evaluate(kept=>{window.__share.answer='not this picture';if(!kept)window.__minimalPicture=null;document.getElementById('announcement').textContent='';},kept);
    await save.click();
    for(let n=0;n<100&&await page.locator('#notice').isHidden();n++){await page.clock.runFor(50);await page.waitForTimeout(20);}
    assert.equal(await page.locator('#notice').textContent(),NOTICE);
    assert.deepEqual(await frame.evaluate(()=>[window.__share.calls,window.__downloads,document.getElementById('announcement').textContent]),[3,0,''],'kept picture: '+kept);
    await quiet(page);
  }
  // The same in Tangles' Experiments.
  await frame.evaluate(()=>{window.__share.answer='refuse';});
  await frame.locator('#experiments a.experiment[href$="set=square"]').click();await arrived(frame,/experiments\.html\?set=square$/);
  await frame.evaluate(()=>{window.__share.answer='refuse';});
  for(const script of ['experiments.js','loop.js']){
    const text=fs.readFileSync(path.join(h.ROOT,'build/html/games/tangles',script),'utf8');
    assert.match(text,/catch \(error\) \{ if \(error\.name !== 'AbortError'\) window\.MinimalBridge\.shareFailed\(\); return; \}\n    window\.MinimalBridge\.shareFailed\(\);\n  \}/,script);
    assert.doesNotMatch(text,/\.download\s*=|window\.open\(|createObjectURL|Image saved/,script+': no download, no window and no "saved" are left');
  }
  await goHome(page,frame);

  // Hexsweeper's sphere: its Share button is on the banner a cleared board shows; the picture is made on the press here.
  const sphere=await enter(page,'hexsweeper:sphere',url=>url.pathname.endsWith('/games/hexsweeper/sphere/index.html'));
  await sphere.evaluate(()=>{window.__share.answer='refuse';document.getElementById('share-win-btn').click();});
  await waitFor(page,sphere,()=>window.__share.calls===1);
  await page.locator('#notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#notice').textContent(),NOTICE);
  assert.deepEqual(await sphere.evaluate(()=>[window.__downloads,document.getElementById('share-win-btn').dataset.state,document.getElementById('share-win-btn').getAttribute('aria-label')]),[0,'error',"Couldn't share"]);
  await quiet(page);
  await sphere.evaluate(()=>{window.__share.answer='dismiss';});
  await page.clock.runFor(2000);
  await sphere.evaluate(()=>document.getElementById('share-win-btn').click());await waitFor(page,sphere,()=>window.__share.calls===2);
  await page.clock.runFor(200);assert.equal(await page.locator('#notice').isHidden(),true);
  assert.equal(await sphere.evaluate(()=>window.__downloads),0);
  assert.deepEqual(ctx.parity.errors,[]);

  // A browser with a share sheet and no canShare: the page is marked, the button shows, and Tangles shares, as the
  // bootstrap's probe and the sphere already allowed.
  const plain=await h.context(await getBrowser(),viewport);t.after(()=>plain.close());
  await plain.addInitScript(()=>{window.__shared=0;Object.defineProperty(Navigator.prototype,'canShare',{configurable:true,value:undefined});Object.defineProperty(Navigator.prototype,'share',{configurable:true,value:async()=>{window.__shared++;}});});
  const older=await h.shell(plain,game('tangles'));
  assert.equal(await older.frame.evaluate(()=>'minimalShare' in document.documentElement.dataset&&navigator.canShare===undefined),true);
  await a.solve(older.frame,'tangles');await older.frame.locator('#settings-btn').click();
  assert.equal(await older.frame.locator('#settings .save').isVisible(),true);
  await older.frame.locator('#settings .save').click();await waitFor(older.page,older.frame,()=>window.__shared===1);
  assert.equal(await older.page.locator('#notice').isHidden(),true);
  assert.deepEqual(plain.parity.errors,[]);
});

test('Look with: Eye tracker is shown unavailable, a saved choice of it becomes Pointer, and nothing looks for its helper',async t=>{
  const tracker={'lukesteuber.minimal.shared:minimal-access.v1:default':JSON.stringify({mode:'look',look:'tracker',hold:800,speed:'normal'})};
  for(const key of ['slant','hexsweeper:classic']){
    const ctx=await h.context(await getBrowser(),viewport,{seed:{localStorage:tracker}});t.after(()=>ctx.close());
    await ctx.addInitScript(()=>{window.__sockets=[];const Native=window.WebSocket;window.WebSocket=function(url,...rest){window.__sockets.push(String(url));return new Native(url,...rest);};window.WebSocket.prototype=Native.prototype;});
    const page=await library(ctx),frame=await enter(page,key,/\/games\//);
    await page.clock.runFor(11000); // the helper was looked for every five seconds
    assert.deepEqual(await frame.evaluate(()=>window.__sockets),[],key);
    if(key==='slant'){
      await frame.locator('#settings-btn').click();
      const look=frame.locator('#access-look');
      assert.equal(await frame.locator('#access-mode').inputValue(),'look');
      assert.equal(await look.inputValue(),'pointer');
      assert.deepEqual(await look.evaluate(s=>[...s.options].map(o=>[o.value,o.textContent,o.disabled])),[['head','Head',false],['eyes','Eyes',false],['pointer','Pointer',false],['tracker','Eye tracker',true]]);
      assert.equal(await frame.locator('p[data-access="look-note"]').evaluate(p=>!p.hidden&&p.textContent),'Eye tracker needs the gaze bridge on this computer, which this page cannot reach.');
      assert.equal(await frame.locator('p[data-access="look-note"]').isVisible(),true);
    }else{
      // Hexsweeper's flat boards carry the same frame with buttons that step through the choices.
      const states=[await frame.locator('#access-mode-state').textContent(),await frame.locator('#access-look-state').textContent()];
      for(let n=0;n<4;n++){await frame.locator('#access-look').evaluate(b=>b.click());states.push(await frame.locator('#access-look-state').textContent());}
      assert.deepEqual(states,['Look and hold','Pointer','Head','Eyes','Pointer','Head'],'Eye tracker is never reached');
    }
    // The page's own policy, where it has one, no longer lets a page reach the helper.
    const policy=await frame.evaluate(()=>document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content||'');
    assert.doesNotMatch(policy,/ws:|127\.0\.0\.1/,key);
    assert.deepEqual(ctx.parity.errors,[],key);
  }
});

test('Bridges and Slant: Scores for this puzzle shows this device\'s own results and offers nothing to share without a score service',async t=>{
  const hidden=['#score-submit','#score-alias','#scores-category','#score-remove','#scores details'];
  for(const id of ['bridges','slant']){
    const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
    const {page,frame}=await h.shell(ctx,game(id));
    const sheet=async()=>{
      await frame.locator('#settings-btn').click();
      const open=frame.getByRole('button',{name:'Scores for this puzzle',exact:true});
      // Slant keeps the row for its numbered boards; Bridges shows it on every board.
      if(!(await open.isVisible())){await frame.locator('#settings').evaluate(d=>d.close());await a.tick(page);return null;}
      await open.click();await frame.locator('#scores[open]').waitFor();
      await frame.waitForFunction(()=>/Scores stay on this device\.$/.test(document.querySelector('#scores-status').textContent));
      for(const part of hidden)assert.equal(await frame.locator(part).isVisible(),false,id+' '+part);
      const text=await frame.locator('#scores').innerText();
      assert.doesNotMatch(text,/Share|Nickname|public|score service|Runs|Loading/,id);
      return {text,status:await frame.locator('#scores-status').textContent(),result:await frame.locator('#scores-result').textContent(),
        rows:await frame.locator('#scores-list li').evaluateAll(rows=>rows.map(li=>[...li.children].map(span=>span.textContent)))};
    };
    const shut=()=>frame.locator('#scores .sheet-x').click();
    // The opening board is not one of the numbered ones: nothing is kept for it.
    const opening=await sheet();
    if(opening){assert.deepEqual([opening.status,opening.result,opening.rows],['Scores stay on this device.','',[]],id);await shut();}
    else assert.equal(id,'slant');
    // A numbered board, not yet finished.
    await a.campaign(frame,id);
    const fresh=await sheet();
    assert.deepEqual([fresh.status,fresh.result,fresh.rows],['No finished attempts at this board yet. Scores stay on this device.','',[]],id);
    assert.match(fresh.text,/^Scores\n+Puzzle 1[^\n]*\n+No finished attempts at this board yet\. Scores stay on this device\.\n+lukesteuber\.com$/,id+': '+JSON.stringify(fresh.text));
    // The form cannot be sent by a script either: the library refuses a sharing preference it could never honor.
    await frame.locator('#score-alias').evaluate(input=>{input.value='Player';input.form.requestSubmit();});
    await page.clock.runFor(300);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:profile')).sharing),false,id);
    await shut();
    // Finished (with the game's own hints, here): the player's time for the board is shown, and listed.
    for(let n=0;n<100&&!(await frame.locator('#next-btn').isVisible());n++){await a.hint(frame,id);await a.tick(page,800);}
    assert.equal(await frame.locator('#next-btn').isVisible(),true,id+' finished');
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:results')||'[]').some(r=>r.game===id),id);
    const kept=await page.evaluate(id=>JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:results')).filter(r=>r.game===id),id);
    assert.equal(kept.length,1);const seconds=Math.max(1,Math.floor(kept[0].elapsedMs/1000)),time=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
    const done=await sheet();
    assert.deepEqual([done.status,done.result,done.rows],['Scores stay on this device.',`Your time ${time} · With hints · Saved on this device`,[['1','With hints',time]]],id);
    assert.match(done.text,/^Scores\n+Puzzle 1[^\n]*\n+Your time \d+:\d\d · With hints · Saved on this device\n+Scores stay on this device\.\n+1\s+With hints\s+\d+:\d\d\n+lukesteuber\.com$/,id+': '+JSON.stringify(done.text));
    await shut();
    assert.deepEqual(ctx.parity.errors,[],id);
  }
});

// One pass through the built package as a player would make it: the library and its sheets, a camera game played
// without its camera, Hexsweeper's sphere, and Tangles with its Experiments. Every address asked for is recorded as
// the browser reports it, of every kind (pages, scripts, pictures, fonts, workers, fetches, sockets, beacons), and
// each one must be the package's own. The fixture's server would refuse anything else; nothing may even be asked.
test('nothing the library or a game asks for leaves the package',async t=>{
  const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
  await ctx.grantPermissions(['camera'],{origin:h.ORIGIN});
  const asked=[],sockets=[];
  ctx.on('request',request=>asked.push(request.url()));
  ctx.on('page',page=>page.on('websocket',socket=>sockets.push(socket.url())));
  await ctx.addInitScript(()=>{
    window.__cameraAsked=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.__cameraAsked++;return Promise.reject(new DOMException('Fixture has no camera','NotFoundError'));};
    // Calls that reach a network without a request the page can be seen making.
    window.__reached=[];
    for(const name of ['WebSocket','EventSource','RTCPeerConnection']){const Native=window[name];if(!Native)continue;window[name]=function(...args){window.__reached.push(name+' '+String(args[0]));return new Native(...args);};window[name].prototype=Native.prototype;}
    const beacon=navigator.sendBeacon;if(beacon)Navigator.prototype.sendBeacon=function(url,...rest){window.__reached.push('sendBeacon '+url);return beacon.call(this,url,...rest);};
  });
  const reached=async target=>assert.deepEqual(await target.evaluate(()=>window.__reached),[]);
  // The library: its tiles, Settings with the privacy policy, and Scores.
  const page=await library(ctx);
  await page.locator('#gear').click();await page.locator('#set-privacy').click();await page.locator('#privacy[open]').waitFor();
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.locator('#scores-button').click();await page.locator('#scores[open]').waitFor();await page.keyboard.press('Escape');
  await page.locator('#library').evaluate(node=>{node.scrollTop=node.scrollHeight;});await page.clock.runFor(31000); // a shine passes
  // Glance, a camera game, played with the pointer: its camera key is on screen and is not pressed.
  await page.locator('#access-open').focus();await page.keyboard.press('Enter');await page.locator('#accessible:visible').waitFor();
  await page.locator('#access-tiles [data-open="glance"]').focus();await page.keyboard.press('Enter');await page.waitForSelector('#player iframe');
  let frame=inner(page);await arrived(frame,/\/games\/glance\/index\.html$/);
  await frame.locator('#camera-start').waitFor({state:'visible'});
  const board=await frame.locator('#board').boundingBox();
  for(const [x,y] of [[.3,.3],[.7,.3],[.5,.7]]){await page.mouse.click(board.x+board.width*x,board.y+board.height*y);await page.clock.runFor(700);}
  await frame.locator('#settings-btn').click();await page.clock.runFor(300);await frame.locator('#settings').evaluate(d=>d.close());
  await frame.locator('#help-btn').click();await page.clock.runFor(300);await frame.locator('#help').evaluate(d=>d.close());
  await page.clock.runFor(6000);
  assert.equal(await frame.evaluate(()=>window.__cameraAsked),0,'the camera was never asked for');
  await reached(frame);await goHome(page,frame,'#accessible');
  await page.locator('#access-back').click();await page.locator('#library:visible').waitFor();
  // Hexsweeper's sphere: a dig, Help, a new sphere.
  frame=await enter(page,'hexsweeper:sphere',url=>url.pathname.endsWith('/games/hexsweeper/sphere/index.html'));
  await page.clock.runFor(1500);
  await page.mouse.click(viewport.width/2,viewport.height/2);await page.clock.runFor(1500);
  await frame.locator('#qc-help').click();await page.clock.runFor(500);await page.keyboard.press('Escape');
  await frame.locator('#qc-reset').click();await page.clock.runFor(6000);
  await reached(frame);await goHome(page,frame);
  // Tangles: a board solved, its Settings, a tiling from Experiments, and Home from there.
  frame=await enter(page,'tangles',TANGLES);
  await a.solve(frame,'tangles');await page.clock.runFor(3000);
  await frame.locator('#settings-btn').click();
  await frame.locator('#experiments a.experiment[href$="set=3636"]').click();await arrived(frame,/experiments\.html\?set=3636$/);
  await page.clock.runFor(6000);
  await reached(frame);await goHome(page,frame);await reached(page);
  // What was asked for, by kind of address: the package's own files, and pictures the pages made themselves.
  const origin=url=>{const address=new URL(url);return ['data:','blob:'].includes(address.protocol)?address.protocol:address.origin;};
  const outside=[...new Set(asked.filter(url=>!['data:','blob:',h.ORIGIN].includes(origin(url))))];
  assert.deepEqual(outside,[],'asked for outside the package');
  assert.deepEqual(asked.filter(url=>origin(url)===h.ORIGIN&&!new URL(url).pathname.startsWith('/export/')),[],'asked for outside the package folder');
  assert.deepEqual(sockets,[]);assert.deepEqual(ctx.parity.requests,[],'nothing had to be refused');
  for(const part of ['/export/catalog.json','/export/privacy.html','/export/games/glance/','/export/games/hexsweeper/sphere/','/export/games/tangles/experiments.html'])
    assert.ok(asked.some(url=>url.includes(part)),'the pass loaded '+part);
  assert.ok(asked.length>150,'requests were recorded: '+asked.length);
  assert.deepEqual(ctx.parity.errors,[]);
});

// Reported: Slant, Bridges, Spiral Galaxies and Fold take a first visit only from an address with no query, and the
// library opens every game with its handshake in the query, so a new player would skip each opening board. Not so:
// adapters/bootstrap.js reads the handshake and takes it out of the address before any of the game's scripts run.
// This holds every game that decides a first visit to that: empty storage, opened from the library.
test('a new player starts each game on its opening board, with the handshake out of the address',async t=>{
  const opens={slant:'p1',bridges:'p1',galaxies:'p1',fold:'p1',akari:'p1',balance:'o1',towers:'o1',tents:'o1'};
  // Every packaged script that decides a first visit is in the list above; a new one must be added on purpose.
  const deciding=[];
  for(const id of fs.readdirSync(path.join(h.ROOT,'build/html/games')))for(const file of fs.readdirSync(path.join(h.ROOT,'build/html/games',id)).filter(f=>/\.(js|mjs)$/.test(f)&&f!=='access.js')){
    if(/\bfirstVisit\b/.test(fs.readFileSync(path.join(h.ROOT,'build/html/games',id,file),'utf8')))deciding.push(id);
  }
  assert.deepEqual([...new Set(deciding)].sort(),Object.keys(opens).sort());
  for(const [id,board] of Object.entries(opens)){
    const ctx=await h.context(await getBrowser(),viewport);t.after(()=>ctx.close());
    // What the address held when the page's first own script was about to run.
    await ctx.addInitScript(()=>{if(parent===window)return;new MutationObserver((_,watch)=>{if([...document.scripts].some(s=>/\/games\/[^/]+\/[^/]+\.m?js/.test(s.src)&&!/bootstrap\.js/.test(s.src))){window.__searchAtStart=location.search;watch.disconnect();}}).observe(document,{childList:true,subtree:true});});
    const {page,frame}=await h.shell(ctx,game(id));
    assert.match(await page.evaluate(()=>document.querySelector('#player iframe').src),/[?&]minimal=[0-9a-f-]{36}/,id+': the library sent the handshake in the address');
    assert.equal(await frame.evaluate(()=>window.__searchAtStart),id==='akari'?'?look=dark':'',id+': gone before the game read the address');
    const state=await h.snapshot(frame);
    assert.equal(state.at??state.store?.at,board,id+' opens on its opening board');
    assert.deepEqual(ctx.parity.errors,[],id);
  }
});
