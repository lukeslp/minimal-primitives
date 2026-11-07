/* Exercise the actual archive in a cross-origin, explicit-filename embed. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.MINIMAL_PLAYWRIGHT||'/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const chrome=process.env.MINIMAL_CHROME||'/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const root=path.resolve(__dirname,'..'),prefix='/html/4815162/';
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};

test('archive runs every title inside an itch-style embed without outside requests', {timeout:180000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'minimal-zip-'));
 execFileSync('python3',['-m','zipfile','-e',path.join(root,'build/minimal-primitives-browser.zip'),dir]);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'BUILD_MANIFEST.json')));
 const {createHash}=require('node:crypto');
 for(const [file,hash]of Object.entries(manifest))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),hash,file);
 let port;const errors=[],outside=[],failures=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://test');
  if(req.headers.host.startsWith('localhost')){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embed fixture</title><body style="margin:0"><iframe id="collection" src="http://127.0.0.1:${port}${prefix}index.html" width="960" height="720" scrolling="no" allow="autoplay;fullscreen *;web-share" allowfullscreen style="border:0;max-width:100vw;max-height:100dvh"></iframe></body></html>`);return;}
  if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  // Reproduce the hosted CDN's stale 404s; versioned URLs serve the real files.
  if(/\/assets\/(akari|bridges|bending)\.png$/.test(url.pathname)&&!url.searchParams.has('v')){res.writeHead(404).end('Cached missing image');return;}
  const target=path.resolve(dir,decodeURIComponent(url.pathname.slice(prefix.length)));
  if(!target.startsWith(dir+path.sep)||!fs.existsSync(target)||fs.statSync(target).isDirectory()){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
 });
 for(let candidate=5011;candidate<=5019;candidate++){
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(candidate,resolve);});port=candidate;break;}catch(error){if(error.code!=='EADDRINUSE')throw error;server.removeAllListeners('error');}
 }
 assert.ok(port,'available permitted test port');
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1000,height:800},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)&&Number(url.port)===port)return route.continue();if(!['data:','blob:'].includes(url.protocol))outside.push(url.href);return route.abort();});
  await context.addInitScript(()=>{if(location.hostname==='127.0.0.1'&&!sessionStorage.getItem('fixture-seeded')){localStorage.setItem('ink.v1','foreign-notan');localStorage.setItem('save','foreign-game');sessionStorage.setItem('sphere-run','foreign-session');sessionStorage.setItem('fixture-seeded','1');}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))failures.push(r.status()+' '+r.url());});
  await page.goto(`http://localhost:${port}/`);
  let collection=await (await page.locator('#collection').elementHandle()).contentFrame();await collection.waitForSelector('.tile');
  assert.equal(await collection.locator('#tiles .tile').count(),12);assert.equal(await collection.locator('#access-tiles .tile').count(),8);
  assert.equal(await collection.locator('.collection-bar,#modes').count(),0);
  assert.equal(await collection.locator('#library header,.tile-title,.tile-resume').count(),0);
  const assertTileArtwork=async collection=>{
   const scroll=await collection.locator('#library').evaluate(e=>e.scrollTop);
   for(const image of await collection.locator('#tiles .tile img').all())await image.evaluate(async i=>{
    const library=document.querySelector('#library');
    library.scrollTop+=i.getBoundingClientRect().top-library.getBoundingClientRect().top;
    await new Promise(requestAnimationFrame);await i.decode();
   });
   await collection.locator('#library').evaluate((e,top)=>{e.scrollTop=top;},scroll);
   await collection.evaluate(()=>new Promise(requestAnimationFrame));
   await collection.waitForFunction(()=>[...document.querySelectorAll('#tiles .tile img')].every(i=>i.complete&&i.naturalWidth>0),{},{timeout:4000}).catch(async()=>{throw new Error('Tile images failed: '+JSON.stringify(await collection.locator('#tiles .tile img').evaluateAll(imgs=>imgs.map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth})))));});
   const images=await collection.locator('#tiles .tile img').evaluateAll(imgs=>imgs.map(i=>i.currentSrc));
   assert.equal(images.length,12,'every title/mode has artwork');
   for(const src of images){
    const url=new URL(src),file=decodeURIComponent(url.pathname.slice(prefix.length));
    assert.equal(url.searchParams.get('v'),manifest[file].slice(0,12),'artwork URL carries its content hash');
   }
  };
  await assertTileArtwork(collection);
  // itch disables document scrolling on its iframe. Use real wheel/touch input,
  // rather than a locator click that silently scrolls inaccessible tiles into view.
  const scrollLibrary=async(page,collection,touch=false)=>{
   const frame=await page.locator('#collection').boundingBox();
   if(touch){
    const input=await page.context().newCDPSession(page),x=frame.x+frame.width/2,y=frame.y+frame.height*.8;
    try{
     for(let swipe=0;swipe<6;swipe++){
      if(await collection.locator('#library footer').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1))break;
      await input.send('Input.synthesizeScrollGesture',{x,y,yDistance:-frame.height*.65,gestureSourceType:'touch',speed:600});
     }
    }finally{await input.detach();}
   }else{
    await page.mouse.move(frame.x+frame.width/2,frame.y+frame.height/2);
    await page.mouse.wheel(0,3000);
   }
   await collection.waitForFunction(()=>{const r=document.querySelector('#library footer').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;},{},{timeout:4000});
   assert.ok(await collection.locator('#library').evaluate(e=>e.scrollTop>0),'library scrolls inside scrolling=no embed');
   assert.equal(await collection.evaluate(()=>document.scrollingElement.scrollTop),0,'outer document does not need to scroll');
  };
  await scrollLibrary(page,collection);
  const allGames=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json')));
  // The motor-accessible puzzles open from the last tile and keep their own saves.
  const catalog=allGames.filter(g=>!g.group),accessibleGames=allGames.filter(g=>g.group==='accessible');
  assert.deepEqual(accessibleGames.map(g=>g.id),['glance','glyph','pursuit','shoo','nod','noon','sweep','ticker']);
  for(const game of catalog){
   for(const mode of game.modes.length?game.modes:[null]){
    console.log('Embed:',game.id,mode?.id||'campaign');
    await collection.locator('.tile[data-game="'+game.id+'"]'+(mode?'[data-mode="'+mode.id+'"]':'')).click();
    let child=collection.childFrames()[0];await child.waitForFunction(()=>!!window.MinimalAdapter);
    await child.waitForTimeout(150);
    const play=child.getByRole('button',{name:'Play',exact:true});if(await play.isVisible())await play.click();
    assert.ok(child.url().includes(prefix+'games/'),game.id+' explicit local page');
    const selectedHash=await collection.evaluate(()=>location.hash);
    await collection.evaluate(()=>location.reload());await collection.waitForSelector('#player iframe');
    const reopened=collection.childFrames()[0];await reopened.waitForFunction(()=>!!window.MinimalAdapter);
    assert.equal(await collection.evaluate(()=>location.hash),selectedHash,'refresh keeps title/mode');
    assert.equal(await collection.locator('iframe').getAttribute('title'),game.title+(mode?' · '+mode.title:''));
    child=reopened;
    assert.ok(await child.evaluate(()=>typeof MinimalAdapter.snapshot==='function'));
    assert.equal(await child.locator('.app-back,.web-games-back').count(),0,'no legacy Games pill');
    assert.ok(await child.evaluate(()=>!!document.body.dataset.controlFrame),'shared native control frame');
    assert.equal(await child.locator('[data-minimal-collection=scores]').count(),1,'Scores remains in native settings/menu');
    await child.locator('#minimal-home').click();await collection.waitForSelector('#library:visible',{timeout:8000}).catch(async error=>{throw new Error(game.id+': '+await collection.locator('#notice').textContent()+' '+error.message);});
    await assertTileArtwork(collection);
    assert.equal(collection.childFrames().length,0,'inactive renderer unloaded');
   }
  }
  for(const game of accessibleGames){
   console.log('Embed:',game.id,'accessible');
   await collection.locator('#access-open').click();await collection.locator('#accessible:visible').waitFor();
   await collection.locator('#access-tiles .tile[data-game="'+game.id+'"]').click();
   const child=collection.childFrames()[0];await child.locator('#minimal-home').waitFor();
   assert.ok(child.url().includes(prefix+'games/'+game.id+'/'),game.id+' explicit local page');
   assert.ok(await child.evaluate(()=>!!document.body.dataset.controlFrame),game.id+' shared native control frame');
   assert.equal(await child.locator('[data-minimal-collection=scores]').count(),0,game.id+' keeps no collection scores');
   await child.locator('#minimal-home').click();await collection.waitForSelector('#accessible:visible',{timeout:8000}).catch(async error=>{throw new Error(game.id+': '+await collection.locator('#notice').textContent()+' '+error.message);});
   assert.equal(collection.childFrames().length,0,'inactive renderer unloaded');
   await collection.locator('#access-back').click();await collection.locator('#library:visible').waitFor();
  }
  // Reload itch's outer page: the new iframe src has no selected-game fragment.
  await collection.locator('.tile[data-game="hexsweeper"][data-mode="classic"]').click();
  await collection.childFrames()[0].locator('#minimal-home').waitFor();
  await page.reload();collection=await (await page.locator('#collection').elementHandle()).contentFrame();
  await collection.waitForSelector('#player iframe');
  assert.equal(await collection.locator('#player iframe').getAttribute('title'),'Hexsweeper · Classic','outer-page refresh keeps the selected mode');
  await collection.childFrames()[0].locator('#minimal-home').click();await collection.locator('#library:visible').waitFor();
  await page.reload();collection=await (await page.locator('#collection').elementHandle()).contentFrame();await collection.waitForSelector('.tile');
  assert.equal(collection.childFrames().length,0,'Home clears per-tab selection before outer refresh');
  const sentinels=await collection.evaluate(()=>[localStorage.getItem('ink.v1'),localStorage.getItem('save'),sessionStorage.getItem('sphere-run')]);
  assert.deepEqual(sentinels,['foreign-notan','foreign-game','foreign-session']);
  await collection.evaluate(()=>document.getElementById('scores-button').addEventListener('click',()=>document.documentElement.requestFullscreen(),{once:true}));
  await collection.locator('#scores-button').click();await collection.waitForFunction(()=>!!document.fullscreenElement);
  assert.ok(await collection.evaluate(()=>innerWidth>=960));await collection.evaluate(()=>document.exitFullscreen());
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(outside,[]);
  const shots=path.join('/Users/luke/craft/reports/by-date/2026-10-14/minimal-build','release');fs.mkdirSync(shots,{recursive:true});
  await page.screenshot({path:path.join(shots,'minimal-embed.png')});
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){
   const embed=await browser.newPage({viewport,hasTouch:true,isMobile:true});
   await embed.goto(`http://localhost:${port}/`);
   const mobileCollection=await (await embed.locator('#collection').elementHandle()).contentFrame();await mobileCollection.waitForSelector('.tile');
   await scrollLibrary(embed,mobileCollection,true);
   await assertTileArtwork(mobileCollection);
   await embed.screenshot({path:path.join(shots,'minimal-scroll-'+viewport.width+'.png')});
   await mobileCollection.locator('#scores-button').tap();await mobileCollection.locator('#scores').waitFor({state:'visible',timeout:4000});
   await mobileCollection.locator('#scores .close').click();
   await mobileCollection.locator('.tile[data-game="horologist"]').click();
   await mobileCollection.childFrames()[0].locator('#minimal-home').click();await mobileCollection.locator('#library:visible').waitFor();
   assert.ok(await mobileCollection.locator('#library').evaluate(e=>e.scrollTop>0),'Home retains library scroll position');
   await embed.close();
   const phone=await browser.newPage({viewport,hasTouch:true,isMobile:true});await phone.goto(`http://127.0.0.1:${port}${prefix}index.html`);await phone.waitForSelector('.tile');
   assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await phone.screenshot({path:path.join(shots,'minimal-'+viewport.width+'.png')});
   for(const game of catalog)for(const mode of game.modes.length?game.modes:[null]){
    await phone.locator('.tile[data-game="'+game.id+'"]'+(mode?'[data-mode="'+mode.id+'"]':'')).click();
    const child=phone.frames()[1];await child.locator('#minimal-home').waitFor();
    const geometry=await child.evaluate(()=>{
     const home=document.querySelector('#minimal-home').getBoundingClientRect(),reset=(document.querySelector('#qc-reset')||document.querySelector('#restart-btn,#restart,#reset-btn,#control-restart')).getBoundingClientRect();
     return {home:[home.x,home.y,home.width,home.height],reset:[reset.x,reset.y,reset.width,reset.height]};
    });
    assert.ok(Math.abs(geometry.home[0]-(geometry.reset[0]+geometry.reset[2]))<1,game.id+' Home beside Restart');
    assert.ok(Math.abs(geometry.home[1]-geometry.reset[1])<1,game.id+' shared row');
    assert.deepEqual(geometry.home.slice(2),[48,48],game.id+' 48px Home target');
    const rect=await phone.locator('iframe').boundingBox();assert.deepEqual(rect,{x:0,y:0,...viewport},'full game viewport');
    await child.locator('#minimal-home').click();await phone.locator('#library:visible').waitFor();
   }
   await phone.close();
  }
  const direct=await context.newPage();await direct.goto(`http://127.0.0.1:${port}${prefix}games/horologist/index.html`);await direct.locator('#minimal-home').click();await direct.waitForURL(`http://127.0.0.1:${port}${prefix}index.html`);await direct.waitForSelector('.tile');assert.equal(await direct.locator('#tiles .tile').count(),12,'Home also works from a directly opened local share link');await direct.close();
  await context.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
