#!/usr/bin/env node
// App Store panels from the built collection. Luke Steuber.
// Usage: node tools/capture-store-panels.cjs EXTRACTED_ZIP_DIR OUT_DIR iphone|ipad [panel,panel]
// Fresh storage per panel; later boards open through each game's own ?level= link; hints, taps and keys are real input.
// Uses the same external Playwright and Chrome as the browser tests.
const {chromium}=require(process.env.MINIMAL_PLAYWRIGHT||'/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const http=require('http'),fs=require('fs'),path=require('path');
const [dir,out,devName]=process.argv.slice(2);
const DEV={iphone:{viewport:{width:440,height:956},scale:3},ipad:{viewport:{width:1032,height:1376},scale:2}}[devName];
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg'};
const wait=(p,ms)=>p.waitForTimeout(ms);
async function hints(p,f,n){for(let i=0;i<n;i++){if(await f.locator('#next-btn').isVisible().catch(()=>false))return;await f.locator('#hint-btn').click();await wait(p,500);}}
async function solve(p,f,max=120){for(let i=0;i<max&&!(await f.locator('#next-btn').isVisible().catch(()=>false));i++){await f.locator('#hint-btn').click();await wait(p,350);}}
async function level(p,f,n){const u=new URL(f.url());u.searchParams.set('level',String(n));await f.goto(u.href);await f.waitForSelector('#board');await wait(p,1500);}
async function next(p,f){await f.locator('#next-btn').click();await wait(p,1500);}
async function clicks(p,pts){const v=DEV.viewport;for(const [x,y] of pts){await p.mouse.click(v.width*x,v.height*y);await wait(p,450);}}
const ACCESS='lukesteuber.minimal.shared:minimal-access.v1:default';
const panels={
 'hex-sphere-light':{game:'hexsweeper',mode:'sphere',scheme:'light',act:(p)=>clicks(p,[[.5,.45],[.42,.5],[.58,.52]])},
 'hex-sphere-dark':{game:'hexsweeper',mode:'sphere',scheme:'dark',act:(p)=>clicks(p,[[.5,.47],[.55,.42]])},
 'hex-classic-light':{game:'hexsweeper',mode:'classic',scheme:'light',act:(p)=>clicks(p,[[.5,.5],[.3,.35],[.7,.65]])},
 'hex-infinite-dark':{game:'hexsweeper',mode:'infinite',scheme:'dark',act:(p)=>clicks(p,[[.5,.5],[.35,.42],[.62,.6],[.45,.7]])},
 'hex-infinite-light':{game:'hexsweeper',mode:'infinite',scheme:'light',act:(p)=>clicks(p,[[.5,.45],[.6,.35]])},
 'slant-color-light':{game:'slant',scheme:'light',act:async(p,f)=>{await level(p,f,24);await hints(p,f,22);}},
 'slant-color-dark':{game:'slant',scheme:'dark',act:async(p,f)=>{await level(p,f,12);await solve(p,f,200);await wait(p,1500);}},
 'akari-dark':{game:'akari',scheme:'dark',act:async(p,f)=>{await level(p,f,30);await hints(p,f,8);}},
 'bridges-dark':{game:'bridges',scheme:'dark',act:async(p,f)=>{await level(p,f,30);await hints(p,f,10);}},
 'galaxies-dark':{game:'galaxies',scheme:'dark',act:async(p,f)=>{await level(p,f,25);await hints(p,f,8);}},
 'delve-dark':{game:'delve',scheme:'dark',act:async(p)=>{await clicks(p,[[.5,.62],[.5,.55]]);await wait(p,1500);}},
 'notan-light':{game:'notan',scheme:'light',act:async(p,f)=>{await level(p,f,20);await hints(p,f,10);}},
 'towers-light':{game:'towers',scheme:'light',act:async(p,f)=>{await level(p,f,15);await hints(p,f,8);}},
 'tents-light':{game:'tents',scheme:'light',act:async(p,f)=>{await level(p,f,15);await hints(p,f,8);}},
 'balance-light':{game:'balance',scheme:'light',act:async(p,f)=>{await level(p,f,15);await hints(p,f,10);}},
 'tilt3d-dark':{game:'tilt-3d',scheme:'dark',act:async(p,f)=>{await f.evaluate(()=>{document.activeElement&&document.activeElement.blur();});await p.keyboard.press('ArrowRight');await wait(p,1800);}},
 'shoo-solved':{game:'shoo-minimal',scheme:'light',act:async(p,f)=>{await solve(p,f,6);await wait(p,1500);}},
 'cast-solved':{game:'cast',scheme:'light',act:async(p,f)=>{await solve(p,f,6);await next(p,f);await hints(p,f,6);}},
 'horologist-light':{game:'horologist',scheme:'light',act:async(p,f)=>{await hints(p,f,2);await wait(p,1200);}},
 'constellations-dark':{game:'constellations',scheme:'dark',act:async(p,f)=>{await solve(p,f,8);await next(p,f);await hints(p,f,5);}},
 'access-look-akari':{game:'akari',scheme:'light',seed:{[ACCESS]:JSON.stringify({mode:'look',look:'pointer',hold:800,speed:'normal'})},act:async(p,f)=>{await level(p,f,12);await wait(p,1200);}},
 'access-switch-bridges':{game:'bridges',scheme:'dark',seed:{[ACCESS]:JSON.stringify({mode:'switch',look:'pointer',hold:800,speed:'normal'})},act:async(p,f)=>{await level(p,f,12);await wait(p,1500);}},
 'glance':{game:'glance',scheme:'light',accessible:true,act:async(p)=>{await wait(p,1200);}},
 'nod':{game:'nod',scheme:'dark',accessible:true,act:async(p)=>{await wait(p,1200);}},
 'library-light':{game:null,scheme:'light'},
 'library-dark':{game:null,scheme:'dark'},
};
const only=process.argv[5]?process.argv[5].split(','):Object.keys(panels);
const server=http.createServer((q,r)=>{const f=path.join(dir,decodeURIComponent(new URL(q.url,'http://x').pathname));if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.writeHead(404).end();r.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(r);}).listen(5016+(devName==='ipad'?1:0),'127.0.0.1',async()=>{
 const port=server.address().port;
 const b=await chromium.launch({executablePath:process.env.MINIMAL_CHROME||'/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
 fs.mkdirSync(out,{recursive:true});
 for(const name of only){const s=panels[name];
  const ctx=await b.newContext({viewport:DEV.viewport,deviceScaleFactor:DEV.scale,isMobile:true,hasTouch:false,colorScheme:s.scheme,reducedMotion:'reduce'});
  await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  if(s.seed)await ctx.addInitScript(seed=>{for(const [k,v] of Object.entries(seed))try{localStorage.setItem(k,v);}catch(_){}},s.seed);
  const p=await ctx.newPage();await p.goto(`http://127.0.0.1:${port}/index.html`);await p.waitForSelector('.tile');
  try{
   if(s.game){
    if(s.accessible){await p.locator('#access-open').click();await wait(p,400);}
    await p.locator(`[data-open="${s.game}${s.mode?':'+s.mode:''}"]`).evaluate(a=>a.click());await wait(p,2500);
    const f=await (await p.locator('#player iframe').elementHandle()).contentFrame();
    if(s.act)await s.act(p,f);
   }else await wait(p,1500);
  }catch(e){console.log(name,'step failed:',e.message.split('\n')[0]);}
  await p.mouse.move(-5,-5);await wait(p,300);
  await p.screenshot({path:path.join(out,name+'.png')});console.log('ok',name);await ctx.close();
 }
 await b.close();server.close();});
