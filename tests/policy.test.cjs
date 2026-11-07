const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MINIMAL_PLAYWRIGHT||'/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const chrome=process.env.MINIMAL_CHROME||'/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const root=path.resolve(__dirname,'../build/html'),origin='https://minimal-policy.test';
let browser;test.before(async()=>browser=await chromium.launch({executablePath:chrome}));test.after(()=>browser.close());
async function setup(sharing){
 const context=await browser.newContext({reducedMotion:'reduce'}),requests=[];let run=0;
 await context.addInitScript(sharing=>{if(!localStorage.getItem('policy-fixture')){localStorage.setItem('lukesteuber.minimal.collection.v1:profile',JSON.stringify({secret:'a'.repeat(64),nickname:'Test Player',sharing,scores:[]}));localStorage.setItem('policy-fixture','1');}},sharing);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/settings.json')return route.fulfill({json:{apiBase:origin+'/api/v1/'}});
  if(url.pathname.startsWith('/api/v1/')){
   const body=request.postDataJSON();requests.push({path:url.pathname,method:request.method(),body});
   if(url.pathname==='/api/v1/runs')return route.fulfill({status:201,json:{run:'run-'+(++run),startedAt:Date.now()}});
   if(url.pathname.endsWith('/finish'))return route.fulfill({json:{ranked:true,score:{id:'score-'+run,run:'run-'+run,category:body.assisted?'assisted':body.repeat?'repeat':'unassisted',value:1000,elapsedMs:1000}}});
   return route.fulfill({json:{entries:[],removed:true}});
  }
  const file=path.resolve(root,url.pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep))return route.abort();
  try{return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();await page.goto(origin+'/');await page.getByRole('button',{name:'Notan',exact:true}).click();const frame=page.frames()[1];await frame.waitForFunction(()=>!!window.__notan&&!!window.MinimalAdapter);await page.waitForTimeout(100);
 return{context,page,frame,requests};
}
async function cell(f,n){await f.locator('#board .cell').nth(n).focus();await f.page().keyboard.press('Enter');}
async function solve(f){for(let n=0;n<4;n++)if(await f.evaluate(n=>__notan.S.cells[n]!==1,n))await cell(f,n);await f.waitForFunction(()=>__notan.S.solved);await f.page().waitForTimeout(100);}
const starts=r=>r.filter(v=>v.path==='/api/v1/runs');const finishes=r=>r.filter(v=>v.path.endsWith('/finish'));

test('sharing defaults local and opting in never promotes the current attempt',async()=>{
 const f=await setup(false);try{
  await cell(f.frame,0);await f.frame.locator('#settings-btn').click();await f.frame.getByRole('button',{name:'Collection scores',exact:true}).click();await f.page.locator('#share-opt-in').check();await f.page.locator('#save-profile').click();await f.page.locator('#scores .close').click();await f.frame.locator('#settings').evaluate(d=>d.close());
  await solve(f.frame);assert.equal(starts(f.requests).length,0);assert.equal(finishes(f.requests).length,0);
 }finally{await f.context.close();}
});
test('a fresh opted-in solve publishes exactly once',async()=>{
 const f=await setup(true);try{await solve(f.frame);assert.equal(starts(f.requests).length,1);assert.equal(finishes(f.requests).length,1);assert.equal(finishes(f.requests)[0].body.publish,true);assert.equal(finishes(f.requests)[0].body.assisted,false);}finally{await f.context.close();}
});
test('Hint eligibility survives Undo',async()=>{
 const f=await setup(true);try{await cell(f.frame,0);await f.frame.locator('#hint-btn').click();await f.frame.locator('#undo-btn').click();await solve(f.frame);assert.equal(finishes(f.requests).length,1);assert.equal(finishes(f.requests)[0].body.assisted,true);}finally{await f.context.close();}
});
test('reload of an unfinished attempt is local even after Undo returns it to blank',async()=>{
 const f=await setup(true);try{await cell(f.frame,0);await f.frame.locator('#hint-btn').click();await f.frame.locator('#undo-btn').click();await f.page.reload();await f.page.locator('#player iframe').waitFor();const next=f.page.frames()[1];await next.waitForFunction(()=>!!window.MinimalAdapter);await f.page.waitForTimeout(100);await solve(next);assert.equal(starts(f.requests).length,1);assert.equal(finishes(f.requests).length,0);}finally{await f.context.close();}
});
test('Undo across Restart restores practice rather than a newly ranked prepared position',async()=>{
 const f=await setup(true);try{await cell(f.frame,0);await f.frame.locator('#settings-btn').click();await f.frame.locator('#reset-level').click();await f.page.waitForTimeout(100);await f.frame.locator('#undo-btn').click();await solve(f.frame);
  assert.equal(starts(f.requests).length,2);assert.equal(starts(f.requests)[1].body.repeat,true);assert.equal(finishes(f.requests).length,0);
 }finally{await f.context.close();}
});

test('refresh keeps the selected game, unfinished board, Undo and settings; Home keeps the library selected',async()=>{
 const f=await setup(false);try{
  await cell(f.frame,0);await f.frame.locator('#settings-btn').click();
  const before=await f.frame.evaluate(()=>MinimalAdapter.checkpoint());
  assert.equal(new URL(f.page.url()).hash,'#game=notan');
  await f.page.reload();await f.page.locator('#player iframe').waitFor();
  const next=f.page.frames()[1];await next.waitForFunction(()=>!!window.MinimalAdapter&&document.querySelector('#settings').open);
  const after=await next.evaluate(()=>MinimalAdapter.checkpoint());
  assert.deepEqual(after.state.cells,before.state.cells);assert.deepEqual(after.state.undo,before.state.undo);
  await next.locator('#settings').evaluate(d=>d.close());await next.locator('#undo-btn').click();
  assert.equal(await next.evaluate(()=>__notan.S.cells[0]),0);
  await next.locator('#minimal-home').click();await f.page.locator('#library:visible').waitFor();
  assert.equal(new URL(f.page.url()).hash,'');
  await f.page.reload();await f.page.locator('.tile').first().waitFor();assert.equal(f.page.frames().length,1);
  assert.equal(await f.page.locator('footer a').getAttribute('href'),'https://oneimpossiblethingatatime.com/');
 }finally{await f.context.close();}
});


test('unified scores modal validates explicit sharing and retains preferences on reopen',async()=>{
 const f=await setup(false);try{
  await f.frame.locator('#minimal-home').click();await f.page.locator('#library:visible').waitFor();
  await f.page.locator('#scores-button').click();await f.page.locator('#nickname').fill('');
  await f.page.locator('#share-opt-in').check();await f.page.locator('#save-profile').click();
  assert.match(await f.page.locator('#profile-status').textContent(),/Use 1–20/);assert.equal(starts(f.requests).length,0);
  await f.page.locator('#nickname').fill('Trophy Player');await f.page.locator('#save-profile').click();
  assert.equal(await f.page.locator('#profile-status').textContent(),'Saved.');
  await f.page.locator('#scores .close').click();await f.page.locator('#scores-button').click();
  assert.equal(await f.page.locator('#nickname').inputValue(),'Trophy Player');assert.equal(await f.page.locator('#share-opt-in').isChecked(),true);
  await f.page.locator('#share-opt-in').uncheck();await f.page.locator('#save-profile').click();
  assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('lukesteuber.minimal.collection.v1:profile')).sharing),false);
  assert.equal(starts(f.requests).length,0);assert.equal(finishes(f.requests).length,0);
 }finally{await f.context.close();}
});
