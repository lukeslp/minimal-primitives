'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(process.env.MINIMAL_ROOT || path.join(__dirname, '../..'));
const PW = process.env.MINIMAL_PLAYWRIGHT || '/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core';
const CHROME = process.env.MINIMAL_CHROME || '/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const EVIDENCE = process.env.MINIMAL_PARITY_EVIDENCE || '/Users/luke/craft/reports/by-date/2026-10-14/minimal-build/parity-review';
const ORIGIN = 'https://lukesteuber.com';
// The motor-accessible puzzles have no resume or score adapter; package.test.cjs opens each one.
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'))).games.filter(g => g.id !== 'hexsweeper' && g.group !== 'accessible');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg'};
// The same reference change, or the source already carrying it upstream.
function adopt(source,anchor,next,label){
  if(!source.includes(anchor)&&source.split(next).length===2)return source;
  assert.equal(source.split(anchor).length,2,label);
  return source.replace(anchor,next);
}
async function launch() {
  fs.mkdirSync(EVIDENCE, {recursive:true});
  const browser=await require(PW).chromium.launch({executablePath:CHROME, headless:true});
  fs.writeFileSync(path.join(EVIDENCE,'environment.json'),JSON.stringify({root:ROOT,chromium:browser.version(),executable:CHROME,sourceGames:games.map(({id,commit})=>({id,commit})),generatedManifestSHA256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'build/html/BUILD_MANIFEST.json'))).digest('hex')},null,2));
  return browser;
}
async function context(browser, viewport, {scheme='dark', motion='reduce', storage='normal', seed={}}={}) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor:1, hasTouch:true, colorScheme:scheme, reducedMotion:motion, serviceWorkers:'block'});
  ctx.setDefaultTimeout(4000);
  const requests = [], errors = [];
  ctx.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  await ctx.route('**/*', async route => {
    const req=route.request(), u=new URL(req.url());
    if (u.origin !== ORIGIN || /\/scores-api\/|\/api\//.test(u.pathname) || req.method() !== 'GET') {
      requests.push({url:u.href,method:req.method(),kind:/goatcounter|stats\.dr\.eamer/.test(u.href)?'analytics':'blocked'});
      return route.abort();
    }
    if(u.pathname==='/standalone.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'standalone.html'))});
    const base=u.pathname.startsWith('/games/')?'imports':u.pathname.startsWith('/export/')?'build/html':null;
    if (!base) return route.fulfill({status:404,body:'No fixture'});
    let rel=decodeURIComponent(u.pathname.replace(/^\/(games|export)\//,''));
    if(base==='imports')rel=rel.replace(/^akari-(?:classic|preview)\//,'akari-light/');
    const file=path.resolve(ROOT,base,rel.endsWith('/')?rel+'index.html':rel);
    if(!file.startsWith(path.resolve(ROOT,base)+path.sep))return route.abort();
    try {
      let body=fs.readFileSync(file);
      // Explicit presentation exception: white lamp cores with a tighter halo.
      // The reference applies the accepted midpoint floor brightness and
      // tighter lamp shadow. Source hashes remain checked.
      if(base==='imports'&&rel==='akari/akari.css') {
        let source=body.toString();
        source=adopt(source,'box-shadow:0 0 4px 2px #fff,0 0 14px 5px #ffffff66,0 0 32px 9px #ffffff20','box-shadow:0 0 2px 1px #fff,0 0 8px 2px #ffffff66,0 0 16px 4px #ffffff14','Akari lamp reference anchor');
        source=adopt(source,'background:repeating-linear-gradient(135deg,transparent 0 7px,#ffffff28 7px 8px),#0003','background:#484848cc','Akari panel reference anchor');
        source=adopt(source,'animation:next-reveal .45s .4s both','animation:next-reveal .18s .7s both','Akari next reveal');
        body=Buffer.from(adopt(source,'@keyframes next-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}','@keyframes next-reveal{from{opacity:0}to{opacity:1}}','Akari next keyframes'));
      }
      if(base==='imports'&&rel==='akari/akari.js')body=Buffer.from(adopt(body.toString(),"const firstVisit=!location.search&&","const firstVisit=!['puzzle','seed','level'].some(key=>new URLSearchParams(location.search).has(key))&&",'Akari first visit'));
      if(base==='imports'&&rel==='akari/index.html') {
        body=Buffer.from(body.toString().replace('Smooth squares are lit; hatched squares still need light.','Lighter panels are lit; darker panels still need light.'));
      }
      if(base==='imports'&&['akari/index.html','akari-light/index.html'].includes(rel)) {
        body=Buffer.from(body.toString().replace('<div class="row"><span>Share</span><button id="share">Copy link</button></div>','<div class="row" hidden><span>Share</span><button id="share">Copy link</button></div>'));
      }
      if(base==='imports'&&['akari/controls.js','akari-light/controls.js'].includes(rel)) {
        // Upstream now places Akari's Next in its board stage itself (completionRoot).
        const source=body.toString(),anchor="node.classList.add('control-completion');root.append(node);";
        if(rel==='akari-light/controls.js'&&source.includes('config.completionRoot')&&!source.includes('"completionRoot"'))body=Buffer.from(source.replace('{"id":"akari-light",','{"id":"akari-light","completionRoot":"board-stage",'));
        if(!source.includes('config.completionRoot')){
          assert.equal(source.split(anchor).length,2,'Akari completion parent reference anchor');
          body=Buffer.from(source.replace(anchor,"node.classList.add('control-completion');(byId('board-stage')||root).append(node);"));
        }
      }
      if(base==='imports'&&['akari/controls.css','akari-light/controls.css'].includes(rel)) {
        let source=body.toString();
        const anchor='position:fixed!important;left:50%!important;right:auto!important;top:auto!important;bottom:max(64px,calc(env(safe-area-inset-bottom) + 64px))!important;\n  transform:translateX(-50%)!important;z-index:50;';
        if(!source.includes('data-completion-root="board-stage"')){
        assert.equal(source.split(anchor).length,2,'Akari completion reference anchor');
        source=source.replace(anchor,'position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;\n  transform:none!important;z-index:50;');
        }
        source=source.replace('body[data-control-frame] .control-completion:not(button)','body[data-control-frame] #share-btn,body[data-control-frame] .row:has(> #share) {display:none!important;}\nbody[data-control-frame] #completion:has(.milestone:not(:empty)) {grid-template-columns:48px!important;}\nbody[data-control-frame] .control-completion:not(button)');
        body=Buffer.from(source);
      }
      if(base==='imports'&&rel==='akari/light-field.js') {
        body=Buffer.from(adopt(body.toString(),'const mapped=.31*(1-Math.exp(-e*.7))','const mapped=.585*(1-Math.exp(-e*.7))','Akari midpoint light reference anchor'));
      }
      return await route.fulfill({status:200,contentType:mime[path.extname(file)]||'application/octet-stream',body});
    }
    catch(e) { if(e.code!=='ENOENT')throw e; return route.fulfill({status:404,body:'Missing fixture: '+rel}); }
  });
  await ctx.addInitScript(({storage,seed}) => {
    if(location.origin!=='https://lukesteuber.com')return;
    // Same random stream in each document; no game code, rules or controls replaced.
    let n=0x51ab; Math.random=()=>((n=(Math.imul(1664525,n)+1013904223)>>>0)/4294967296);
    window.__parityMessages=[];
    window.addEventListener('message',e=>window.__parityMessages.push(e.data));
    for(const kind of ['localStorage','sessionStorage']) {
      for(const [key,value] of Object.entries(seed[kind]||{}))if(window[kind].getItem(key)===null)window[kind].setItem(key,value);
    }
    if(storage==='unavailable')for(const kind of ['localStorage','sessionStorage'])Object.defineProperty(window,kind,{configurable:true,get(){throw new DOMException('Fixture storage unavailable','SecurityError');}});
  },{storage,seed});
  ctx.parity={requests,errors};
  return ctx;
}
async function ready(frame, generated=false) {
  await frame.waitForFunction(g=>document.readyState==='complete'&&document.querySelector('#board,#well')&&(!g||window.MinimalAdapter),generated);
  await frame.evaluate(()=>document.fonts.ready);
}
async function restored(frame) {
  const nonce=await frame.evaluate(()=>MinimalBridge.nonce);
  await frame.page().waitForFunction(n=>window.__parityMessages.some(e=>e.nonce===n&&['restored','error'].includes(e.type)),nonce);
  const error=await frame.page().evaluate(n=>window.__parityMessages.find(e=>e.nonce===n&&e.type==='error'),nonce);
  assert(!error,error?.payload?.message);
}
async function shell(ctx,game) {
  const page=await ctx.newPage();
  await page.clock.install({time:new Date('2026-10-14T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-14T12:00:01Z'));
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00Z'));
  await page.goto(ORIGIN+'/export/index.html');
  await page.mouse.move(-1,-1);
  await page.locator('.tile').filter({hasText:game.title}).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#player iframe');
  const frame=await (await page.locator('#player iframe').elementHandle()).contentFrame();
  await ready(frame,true);
  await page.clock.runFor(100);
  const saved=await page.evaluate(id=>{try{return !!JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:saves')||'{}')[id];}catch(_){return false;}},game.id);
  if(saved)await restored(frame);
  return {page,frame};
}
async function standalone(ctx,game,{query='',generated=false}={}) {
  if(game.id==='akari'&&!query)query='look=dark'; // Tile entry explicitly selects the stylized board.
  const page=await ctx.newPage();
  await page.clock.install({time:new Date('2026-10-14T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-14T12:00:01Z'));
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00Z'));
  await page.goto(ORIGIN+'/standalone.html?entry='+encodeURIComponent(game.entry+(query?'?'+query:''))+(generated?'&kind=generated':''));
  const frame=await (await page.locator('iframe').elementHandle()).contentFrame();
  await ready(frame,generated);
  await page.clock.runFor(100);
  return frame;
}
async function snapshot(frame) { return frame.evaluate(()=>MinimalAdapter.snapshot()); }
async function surface(frame) {
  return frame.evaluate(()=>({
    viewport:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motion,
    board:[...document.querySelectorAll('#board [aria-label],#planet-buttons [aria-label]')].map(n=>[n.className?.baseVal??n.className,n.getAttribute('aria-label'),n.getAttribute('aria-selected'),n.getAttribute('aria-pressed'),n.tabIndex]),
    readout:document.querySelector('#readout,#lvl-text')?.textContent,
    feedback:document.querySelector('#feedback,#live')?.textContent,
    controls:[...document.querySelectorAll('button,select,input')].filter(n=>!n.closest('dialog:not([open])')&&!n.dataset.minimalCollection).map(n=>[n.id,n.getAttribute('aria-label'),n.disabled,n.hidden,n.value,n.getAttribute('aria-pressed')]),
    dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.id),
    complete:document.querySelector('#completion,#caption,#next-btn')?.hidden
  }));
}
async function layout(frame) {
  return frame.evaluate(()=>[...document.querySelectorAll('#board,#board-shell,#well,#works,#grid,#caption,.toolbar,body>header,#board .cell,#board .island')].map(n=>{
    const r=n.getBoundingClientRect(),s=getComputedStyle(n);
    return [n.id,n.className?.baseVal??n.className,r.x,r.y,r.width,r.height,s.color,s.backgroundColor,s.fontFamily,s.fontSize];
  }));
}
async function pixels(pageA,pageB,clipB,label) {
  const clipA=await (await pageA.frameElement()).boundingBox();
  const targetFrame=pageB.frames().find(f=>f.parentFrame()===pageB.mainFrame());
  const home=targetFrame?.locator('#minimal-home');
  let maskA=[],maskB=[];
  if(home&&await home.count()){
    const rect=await home.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
    await pageA.evaluate(r=>{const marker=document.createElement('div');marker.id='parity-home-region';Object.assign(marker.style,{position:'fixed',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',pointerEvents:'none'});document.body.append(marker);},rect);
    maskA=[pageA.locator('#parity-home-region')];maskB=[home];
  }
  const a=await pageA.page().screenshot({clip:clipA,mask:maskA,animations:'disabled',path:path.join(EVIDENCE,label+'-standalone.png')}), b=await pageB.screenshot({clip:clipB,mask:maskB,animations:'disabled',path:path.join(EVIDENCE,label+'-generated.png')});
  const delta=await pageA.evaluate(async ([a,b])=>{
    const read=async s=>{const img=new Image();img.src='data:image/png;base64,'+s;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return {w:c.width,h:c.height,data:x.getImageData(0,0,c.width,c.height).data};};
    const x=await read(a),y=await read(b);if(x.w!==y.w||x.h!==y.h)return {dimensions:[[x.w,x.h],[y.w,y.h]]};
    let changed=0,max=0;for(let i=0;i<x.data.length;i+=4){let d=0;for(let j=0;j<4;j++)d=Math.max(d,Math.abs(x.data[i+j]-y.data[i+j]));if(d)changed++;max=Math.max(d,max);}return {changed,max,total:x.w*x.h};
  },[a.toString('base64'),b.toString('base64')]);
  await pageA.locator('#parity-home-region').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));
  fs.writeFileSync(path.join(EVIDENCE,label+'-pixels.json'),JSON.stringify(delta));
  assert.ok(delta.changed===0 || delta.max<=1,`${label}: pixel difference ${JSON.stringify(delta)}`);
}
function verifyImports() {
  for(const g of games)for(const f of g.files)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'imports',f.path))).digest('hex'),f.sha256,'Modified baseline '+f.path);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT,'build/html/SOURCE_MANIFEST.json'))),JSON.parse(fs.readFileSync(path.join(ROOT,'sources.json'))),'rebuild target: generated source manifest is stale');
  const built=JSON.parse(fs.readFileSync(path.join(ROOT,'build/html/BUILD_MANIFEST.json')));
  for(const [file,sha] of Object.entries(built))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'build/html',file))).digest('hex'),sha,'Generated file changed after build: '+file);
}
function sameSnapshot(actual,expected,message) {
  actual=structuredClone(actual);expected=structuredClone(expected);
  if(actual.clockRunning&&expected.clockRunning){
    const elapsed=(actual.state.time-expected.state.time)*1000+expected.clockRemaining-actual.clockRemaining;
    assert.ok(elapsed>=0&&elapsed<=300,'controlled resume clock advances by at most the fixture 300ms: '+elapsed);
    actual.clockRemaining=expected.clockRemaining;actual.state.time=expected.state.time;
  }
  assert.deepEqual(actual,expected,message);
}
module.exports={sameSnapshot,ROOT,EVIDENCE,ORIGIN,games,launch,context,ready,restored,shell,standalone,snapshot,surface,layout,pixels,verifyImports};
