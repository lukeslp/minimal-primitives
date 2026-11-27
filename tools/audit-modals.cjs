#!/usr/bin/env node
'use strict';

/*
 * Sheet inventory for the built library and its games.
 * Run after python3 tools/build.py: node tools/audit-modals.cjs
 * AUDIT_ONLY=<id,id> limits the games; AUDIT_OUT=<folder> sets the output folder (default ../out).
 * Real taps open each surface; a confirm is recorded and cancelled, never accepted.
 * Null means not measured, not passed. Native dialogs have no screenshot.
 * Each game has a 60-second budget per viewport, including the pages it links to.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');

// launch() writes its environment receipt here, never to the helper's default directory.
const receipt = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-modal-audit-'));
process.env.MINIMAL_PARITY_EVIDENCE = receipt;
const h = require('../tests/parity-fixtures/browser.cjs');
const ROOT = h.ROOT;
const OUT = process.env.AUDIT_OUT ? path.resolve(process.env.AUDIT_OUT) : path.resolve(ROOT, '../out');
const SHOTS = path.join(OUT, 'shots');
const BASE = h.ORIGIN + '/export/';
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/html/catalog.json'), 'utf8'));
const report = {
  generatedAt: new Date().toISOString(),
  build: {manifestSHA256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'build/html/BUILD_MANIFEST.json'))).digest('hex')},
  surfaces: [], unopened: [], errors: [], pages: [], probes: [],
};
const checks = ['focusMovesInside', 'tabStaysInside', 'shiftTabStaysInside', 'escapeCloses', 'backdropCloses', 'focusReturnsToOpener', 'backgroundDoesNotScroll'];
const result = (value, note, evidence) => ({value, note, ...(evidence === undefined ? {} : {evidence})});
const unmeasured = note => Object.fromEntries(checks.map(key => [key, result(null, note)]));
const slug = s => String(s).replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-|-$/g, '') || 'surface';
const digest = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
const identity = s => [s.game, s.mode || '', s.variant || '', s.entry || '', s.surfaceId, s.state || ''].join('|');
const errorText = e => String(e.message || e).split('\n').slice(0, 4).join(' ');
function canonical(raw) {
  const u = new URL(raw, BASE);
  u.hash = '';
  u.searchParams.delete('minimal');
  u.searchParams.sort();
  return u.href;
}
function localPage(raw) {
  const u = new URL(raw, BASE);
  if (u.origin !== h.ORIGIN || !u.pathname.startsWith('/export/games/')) return false;
  const rel = decodeURIComponent(u.pathname.slice('/export/'.length));
  const file = path.resolve(ROOT, 'build/html', rel.endsWith('/') ? rel + 'index.html' : rel);
  return file.startsWith(path.join(ROOT, 'build/html') + path.sep) && /\.html$/.test(file) && fs.existsSync(file);
}
function kindOf(s) {
  const text = `${s.surfaceId} ${s.container?.heading?.text || ''} ${s.opener?.accessibleName || ''}`;
  if (s.native || s.container?.role==='alertdialog' || /confirm|erase|are you sure/i.test(text)) return 'confirm';
  if (/settings|preferences|\bmenu\b/i.test(text)) return 'Settings';
  if (/help|how to play/i.test(text)) return 'Help';
  if (/levels|catalog|choose.*board/i.test(text)) return 'levels';
  if (/scores|leaderboard/i.test(text)) return 'scores';
  return 'other';
}

// Runs in the page or game frame. Selectors are stable CSS paths, not injected IDs.
function dom({op, selector, extra}) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const all = (s, root = document) => [...root.querySelectorAll(s)];
  const css = e => {
    if (!e || e.nodeType !== 1) return null;
    if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) return '#' + CSS.escape(e.id);
    const parts = [];
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      const siblings = n.parentElement ? [...n.parentElement.children].filter(x => x.tagName === n.tagName) : [n];
      parts.unshift(n.localName + ':nth-of-type(' + (siblings.indexOf(n) + 1) + ')');
    }
    return parts.join(' > ');
  };
  const text = e => clean(e?.textContent);
  const labeled = e => clean((e?.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(document.getElementById(id))).join(' '));
  const name = e => labeled(e) || clean(e?.getAttribute('aria-label')) || clean(e?.labels && [...e.labels].map(text).join(' ')) || clean(e?.getAttribute('alt')) || text(e) || clean(e?.getAttribute('title'));
  const box = e => { const r = e.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; };
  const visible = e => {
    if (!e || !e.getClientRects().length) return false;
    for (let n = e; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (n.hidden || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || (n.tagName === 'DIALOG' && !n.open)) return false;
      if (n.tagName === 'DETAILS' && !n.open && !n.querySelector('summary')?.contains(e)) return false;
    }
    const r = box(e); return r.width > 0 && r.height > 0;
  };
  const desc = e => e ? {selector:css(e), accessibleName:name(e), tag:e.localName, visibleText:visible(e) ? clean(e.innerText) : '', hidden:!visible(e), disabled:!!e.disabled || e.getAttribute('aria-disabled') === 'true'} : null;
  const controls = 'button,a[href],input,select,textarea,[role="button"],[role="switch"],[role="checkbox"],summary';
  const semantic = 'dialog,[role="dialog"],[role="alertdialog"],[aria-modal]';
  const pattern = /sheet|modal|overlay|dialog|levels|catalog|help|settings|scores|confirm/i;
  const surfaces = () => {
    const nodes = all('*').filter(e => {
      if (e.matches(semantic)) return true;
      if (extra?.library && e.id === 'accessible') return true;
      if (extra?.library && e.parentElement === document.body && !['player','duo-pane','library'].includes(e.id) && !visible(e) && ['fixed','absolute'].includes(getComputedStyle(e).position)) return true;
      if (!pattern.test(e.id + ' ' + e.getAttribute('class'))) return false;
      return ['fixed', 'absolute'].includes(getComputedStyle(e).position) && (!visible(e)||extra?.includeVisible) && !e.matches(controls);
    });
    // A panel inside its overlay is one surface; semantic nested dialogs remain distinct.
    return nodes.filter(e => e.matches(semantic) || !nodes.some(p => p !== e && p.contains(e)));
  };
  const panel = root => root.matches('dialog') ? root : root.querySelector('.modal-content,.help-panel,.dialog-panel,.sheet-in,[data-panel]') || root;
  const focusables = root => all(controls + ',[tabindex],[contenteditable="true"]', root)
    .filter(e => visible(e) && !e.disabled && e.tabIndex >= 0 && !e.closest('[inert]'))
    .map((e,i) => ({e,i})).sort((a,b) => (a.e.tabIndex > 0 ? a.e.tabIndex : Infinity) - (b.e.tabIndex > 0 ? b.e.tabIndex : Infinity) || a.i-b.i).map(x => x.e);
  if (op === 'scan') {
    const nodes = surfaces();
    return nodes.map(e => ({selector:css(e), id:e.id || css(e), hiddenAtLoad:!visible(e), semantic:e.matches(semantic), tag:e.localName,
      surfaceType:e.id === 'accessible' ? 'view' : 'modal', heading:text(e.querySelector('h1,h2,h3,[role="heading"]')), parent:nodes.find(p => p !== e && p.contains(e)) ? css(nodes.find(p => p !== e && p.contains(e))) : null}));
  }
  const root = document.querySelector(selector);
  if (!root) return null;
  if (op === 'visible') return visible(root);
  if (op === 'describe') return desc(root);
  if (op === 'active') return {inside:document.hasFocus() && root.contains(document.activeElement), element:desc(document.activeElement)};
  if (op === 'isActive') return document.hasFocus() && document.activeElement === root;
  if (op === 'focusables') return focusables(root).map(desc);
  if (op === 'opener') {
    const simplify = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const id = root.id;
    const title = simplify(labeled(root) || text(root.querySelector('h1,h2,h3')));
    const stem = simplify(id.replace(/(?:-?(?:overlay|modal|dialog|sheet|confirm))+/gi, ''));
    return all(controls).filter(e => !root.contains(e) && !e.hasAttribute('data-minimal-collection')).map(e => {
      const n = simplify(name(e)), eid = e.id;
      let score = 0;
      if ((e.getAttribute('aria-controls') || '').split(/\s+/).includes(id) && id) score = 100;
      if (id && [id+'-btn',id+'-button',id+'-open'].includes(eid)) score = Math.max(score,95);
      if ((stem && n === stem) || (title && n === title)) score = Math.max(score,85);
      if (stem && n.includes(stem) && !/close|cancel/.test(n)) score = Math.max(score,75);
      if (/help/.test(id) && /^(help|how to play)$/.test(n)) score = Math.max(score,85);
      if (/levels|catalog/.test(id) && (eid === 'readout' || /choose.*level|level list/.test(n))) score = Math.max(score,90);
      if (id === 'accessible' && eid === 'access-open') score = 100;
      if (/confirm/.test(id) && /erase|reset|clear|restart|new/.test(n) && !/cancel|close/.test(n)) score = Math.max(score, title.includes(n) || n.includes(title) ? 90 : 45);
      const parent = extra?.surfaces?.find(s => s.selector !== selector && document.querySelector(s.selector)?.contains(e));
      return {...desc(e), score, parent:parent?.selector || null};
    }).filter(e => e.score > 0 && !e.disabled).sort((a,b) => b.score-a.score || Number(a.hidden)-Number(b.hidden));
  }
  if (op === 'details') {
    const parents = []; for (let n = root.parentElement; n; n=n.parentElement) if(n.matches('details:not([open])')) parents.unshift(css(n.querySelector('summary')));
    return parents;
  }
  if (op === 'links') return all('a[href]', root).map(a => ({...desc(a), href:a.href, rawHref:a.getAttribute('href'), target:a.target}));
  if (op === 'actions') return all('button,[role="button"]',root).filter(e => !e.disabled && (/…\s*$|\.\.\.\s*$/.test(text(e)) || /\b(Erase|Reset|Clear|Restart|New)\b/i.test(text(e)))).map(desc);
  if (op === 'tabs') return all('[role="tab"]',root).filter(visible).map(desc);
  if (op === 'collectionScores') return desc(root.querySelector('[data-minimal-collection="scores"]'));
  if (op === 'close') {
    const candidates = all(controls,root).filter(e => visible(e) && !e.disabled && !/\b(erase|reset|delete|clear|restart|new)\b/i.test(name(e)) && (/^(close|cancel|done|dismiss|keep playing)\b/i.test(name(e)) || e.matches('.sheet-x,.close,.close-btn,.help-close') || /^[×✕✖]$/.test(text(e)) || root.id==='accessible' && e.id==='access-back'));
    const e = candidates.sort((a,b) => Number(/^cancel$/i.test(name(b))) - Number(/^cancel$/i.test(name(a))))[0];
    if (!e) return null;
    const r=box(e), p=box(panel(root));
    return {...desc(e), box:r, position:r.y+r.height/2>p.y+p.height*.7 ? 'bottom' : r.x+r.width/2<p.x+p.width/2 ? 'top-left' : 'top-right'};
  }
  if (op === 'backdrop') {
    const p = box(panel(root));
    const points = [[2,2],[innerWidth-3,2],[2,innerHeight-3],[innerWidth-3,innerHeight-3],[innerWidth/2,2],[innerWidth/2,innerHeight-3]];
    for(const [x,y] of points) {
      if (x >= p.x && x <= p.x+p.width && y >= p.y && y <= p.y+p.height) continue;
      const hit=document.elementFromPoint(x,y);
      if(root.matches(':modal') || hit === root) return {x,y};
    }
    return null;
  }
  if (op === 'background') return [document.scrollingElement,...all('*').filter(e => visible(e) && !root.contains(e) && /auto|scroll/.test(getComputedStyle(e).overflowY))]
    .filter((e,i,a) => e && a.indexOf(e) === i && e !== root && e.scrollHeight > e.clientHeight+1)
    .map(e => ({selector:css(e),top:e.scrollTop,left:e.scrollLeft,range:e.scrollHeight-e.clientHeight}));
  if (op === 'scrollPanel') {
    const nodes = [root,...all('*',root)].filter(e => e.scrollHeight>e.clientHeight+1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    if (extra?.restore) { for(const p of extra.restore) {const e=document.querySelector(p.selector);if(e)e.scrollTop=p.top;} return; }
    const old=nodes.map(e=>({selector:css(e),top:e.scrollTop}));
    for(const e of nodes)e.scrollTop=extra?.end ? e.scrollHeight : 0;
    return old;
  }
  if (op !== 'inspect') return null;
  const p = panel(root), pbox=box(p);
  const heading = e => ({text:text(e), level:e.hasAttribute('aria-level') ? Number(e.getAttribute('aria-level')) : /^H[1-6]$/.test(e.tagName) ? Number(e.tagName[1]) : null, selector:css(e), hidden:!visible(e)});
  const headings = all('h1,h2,h3,h4,h5,h6,[role="heading"],.group,.modal-section-label,.catalog-title',root);
  const first = headings.find(e=>e.matches('h1,h2,[role="heading"]')) || headings[0];
  const rows = all(controls,root).map((e,order) => {
    const row = e.closest('.row,.modal-row,.access-row,.control-row,label,fieldset,[role="group"],li') || e.parentElement;
    const clone=row?.cloneNode(true);
    if(clone)for(const c of clone.querySelectorAll(controls+',script,style,svg'))c.remove();
    const r=box(e), role=e.getAttribute('role');
    const label=clean(e.labels && [...e.labels].map(l=>{const c=l.cloneNode(true);c.querySelectorAll(controls).forEach(n=>n.remove());return c.textContent;}).join(' ')) || labeled(e) || clean(e.getAttribute('aria-label')) || clean(clone?.textContent) || name(e);
    return {...desc(e), label, kind:role==='switch'?'switch':e.localName==='input'?'input '+e.type:e.localName==='a'?'link':e.localName==='summary'?'button':role||e.localName,
      value:e.localName==='input' && /checkbox|radio/.test(e.type)?e.checked:'value' in e ? e.value : e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed'),
      options:e.localName==='select'?[...e.options].map(o=>({label:o.label,value:o.value,disabled:o.disabled,selected:o.selected})):undefined,
      optionLabels:e.localName==='select'?[...e.options].map(o=>o.label):undefined,
      href:e.localName==='a'?e.href:undefined,box:r,domOrder:order};
  });
  for(const row of all('.row,.modal-row,.access-row,.control-row,[role="row"]',root).filter(e=>!e.querySelector(controls)))rows.push({...desc(row),label:text(row),kind:null,value:null,box:box(row),domOrder:rows.length});
  rows.sort((a,b)=>Number(a.hidden)-Number(b.hidden) || (a.hidden ? a.domOrder-b.domOrder : a.box.y-b.box.y || a.box.x-b.box.x || a.domOrder-b.domOrder));
  const footers = all('footer,.sheet-foot,.modal-footer,.dialog-footer,.menu-links,.help-footer',root);
  const interactive = rows.filter(r=>!r.hidden&&r.kind);
  const small = threshold => interactive.filter(r=>r.box.width<threshold || r.box.height<threshold).map(r=>({selector:r.selector,name:r.accessibleName,width:r.box.width,height:r.box.height}));
  const clipped=[]; let smallest=null;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
    const n=walker.currentNode,e=n.parentElement;
    if(!clean(n.textContent)||!visible(e)||e.closest('script,style,option,svg,.sr-only,[aria-hidden="true"]'))continue;
    const style=getComputedStyle(e),range=document.createRange();range.selectNodeContents(n);
    if(style.clipPath!=='none' || (style.clip!=='auto' && /absolute|fixed/.test(style.position)))continue;
    const rects=[...range.getClientRects()].filter(r=>r.width&&r.height);
    if(!rects.length)continue;
    const size=parseFloat(style.fontSize);if(smallest===null||size<smallest.size)smallest={size,text:clean(n.textContent),selector:css(e)};
    let scrollParent=false;
    for(let a=e;a&&root.contains(a);a=a.parentElement)if(a.scrollHeight>a.clientHeight+1&&/auto|scroll/.test(getComputedStyle(a).overflowY))scrollParent=true;
    for(const r of rects) {
      const edges=[];
      if(r.left<pbox.x-1)edges.push('left');if(r.right>pbox.x+pbox.width+1)edges.push('right');
      if(!scrollParent&&r.top<pbox.y-1)edges.push('top');if(!scrollParent&&r.bottom>pbox.y+pbox.height+1)edges.push('bottom');
      const clippedBy=[];
      for(let a=e;a&&root.contains(a);a=a.parentElement) {
        const style=getComputedStyle(a),q=a.getBoundingClientRect();
        const x=/hidden|clip|auto|scroll/.test(style.overflowX)&&(r.left<q.left-1||r.right>q.right+1);
        const y=/hidden|clip/.test(style.overflowY)&&(r.top<q.top-1||r.bottom>q.bottom+1);
        if(x||y)clippedBy.push({selector:css(a),horizontal:x,vertical:y});
      }
      if(edges.length||clippedBy.length)clipped.push({selector:css(e),text:clean(n.textContent),edges,clippedBy,box:{x:r.x,y:r.y,width:r.width,height:r.height}});
    }
  }
  const scrollContainers=[root,...all('*',root)].filter(e=>visible(e)&&e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(getComputedStyle(e).overflowY)).map(e=>({selector:css(e),scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));
  const overflowing=[root,...all('*',root)].filter(e=>visible(e)&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>({selector:css(e),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
  return {
    container:{tag:root.localName,role:root.getAttribute('role') || (root.localName==='dialog'?'dialog':null),ariaModal:root.getAttribute('aria-modal'),ariaLabelledby:{ids:root.getAttribute('aria-labelledby'),text:labeled(root)},ariaLabel:root.getAttribute('aria-label'),showModal:root.matches(':modal'),heading:first?heading(first):null},
    sections:headings.filter(e=>e!==first).map(heading),rows,
    footer:{text:clean(footers.map(e=>e.innerText).join(' ')),links:footers.flatMap(f=>all('a[href]',f).map(a=>({text:text(a),href:a.href})))},
    visibleText:clean(root.innerText),
    layout:{viewport:{width:innerWidth,height:innerHeight},panelSelector:css(p),panelBox:pbox,panelScrollsVertically:p.scrollHeight>p.clientHeight,scrollContainers,
      horizontalOverflow:overflowing.length>0 || pbox.x<0 || pbox.x+pbox.width>innerWidth+1,horizontalOverflowElements:overflowing,
      controlsUnder24:small(24),controlsUnder44:small(44),clippedOrEdgeOverlappingText:clipped,
      bodyFontSize:parseFloat(getComputedStyle(document.body).fontSize),smallestText:smallest,
      bodyTextFontSize:parseFloat(getComputedStyle(all('.sheet-body p,p,.sheet-body',root).find(visible)||p).fontSize),
      textCheckNote:'Text range rectangles against panel edges and clipping ancestors; expected vertical clipping in scroll containers and screen-reader-only text excluded.'},
  };
}

class Audit {
  constructor(ctx, game, viewport, light) {
    Object.assign(this,{ctx,game,viewport,light});
    this.queue=[];this.queued=new Set();this.visited=new Set();this.surfaceKeys=new Set();this.events=[];this.active=null;this.currentOpener=null;this.cancelled=false;
  }
  meta() { return {game:this.game.id,mode:this.target?.mode || null,variant:this.target?.variant || null,entry:this.target?.url || this.frame?.url() || BASE+'index.html'}; }
  err(e, extra={}) {report.errors.push({...this.meta(),viewport:this.viewport.width,message:errorText(e),...extra});}
  async read(op,selector='body',extra={}) {return this.frame.evaluate(dom,{op,selector,extra:{...extra,library:this.game.id==='library'}});}
  async settle() {await this.frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
  async ready() {
    // The helper's ready() requires a resume adapter; accessible games have none.
    if(h.games.some(g=>g.id===this.game.id))await h.ready(this.frame,true);
    else {
      await this.frame.locator('#minimal-home').waitFor({state:'attached'});
      await this.frame.waitForFunction(()=>document.readyState==='complete');
      await this.frame.evaluate(()=>document.fonts.ready);
    }
  }
  check() {if(this.cancelled)throw Error('Per-game timeout (60 seconds)');}
  addTarget(t) {
    const key=canonical(t.url);
    if(this.queued.has(key))return;
    this.queued.add(key);this.queue.push(t);
  }
  async click(selector) {
    this.check();
    for(const summary of await this.read('details',selector) || [])await this.frame.locator(summary).click({timeout:700});
    this.currentOpener=await this.read('describe',selector);
    await this.frame.locator(selector).click({timeout:900});
    await this.settle();
  }
  async openLibrary() {
    if(this.page)await this.page.close();
    this.page=await this.ctx.newPage();this.frame=this.page.mainFrame();
    this.events=[];
    this.page.on('console',m=>{if(m.type()==='error')this.events.push({type:'console',message:m.text(),url:m.location().url,at:Date.now()});});
    this.page.on('pageerror',e=>this.events.push({type:'pageerror',message:e.message,at:Date.now()}));
    this.page.on('dialog',d=>{
      const record={...this.meta(),surfaceId:'native-'+d.type()+'-'+digest(d.message()),kind:'confirm',native:true,nativeType:d.type(),message:d.message(),defaultValue:d.defaultValue(),opener:this.currentOpener,
        container:null,sections:[],rows:[],footer:null,closeControl:null,visibleText:d.message(),behavior:unmeasured('Native browser dialog; dismissed immediately, never accepted.'),
        screenshots:{},layouts:{},notes:['Native browser chrome is not present in renderer screenshots.'],consoleErrors:[],pageErrors:[]};
      const key=identity(record);
      if(!this.light&&!report.surfaces.some(s=>identity(s)===key))report.surfaces.push(record);
      this.nativeCount=(this.nativeCount||0)+1;
      d.dismiss().catch(e=>this.err(e,{surface:record.surfaceId}));
    });
    await this.page.goto(BASE+'index.html',{waitUntil:'domcontentloaded'});
    // A fresh context is used for each game; clear again between entries within it.
    await this.page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
    await this.page.reload({waitUntil:'domcontentloaded'});
    await this.page.locator('#tiles .tile').first().waitFor();
  }
  async load(t) {
    this.target=t;this.active=null;
    await this.openLibrary();
    if(this.game.id!=='library') {
      if(this.game.group==='accessible') {
        // On a touch screen the first tap on the accessible tile shows its card; the second opens the list.
        await this.page.locator('#access-open').click();
        if(!await this.page.locator('#accessible').isVisible())await this.page.locator('#access-open').click();
        await this.page.locator('#accessible:visible').waitFor();
        await this.page.locator('#access-tiles .tile[data-game='+JSON.stringify(this.game.id)+']').click();
      } else await h.open(this.page,this.game.id+(t.mode?':'+t.mode:''));
      await this.page.locator('#player iframe').waitFor();
      this.frame=await (await this.page.locator('#player iframe').elementHandle()).contentFrame();
      await this.ready();
      for(const step of t.steps || []) {
        await this.click(step.selector);
        if(step.navigation) {
          await this.frame.waitForURL(u=>canonical(u.href)===canonical(step.navigation),{timeout:3000});
          await this.ready();
        }
      }
      const play=this.frame.getByRole('button',{name:'Play',exact:true});
      if(await play.count()===1&&await play.isVisible())await play.click({timeout:700});
    }
    await this.settle();
    this.surfaces=await this.read('scan');
    this.openers=new Map();
    this.target.url=canonical(this.frame.url());
  }
  async opener(s,stack=[]) {
    if(this.openers.has(s.selector))return this.openers.get(s.selector);
    if(stack.includes(s.selector))return null;
    const candidates=await this.read('opener',s.selector,{surfaces:this.surfaces}) || [];
    for(const c of candidates) {
      if(c.hidden&&!c.parent&&!(await this.read('details',c.selector))?.length)continue;
      if(c.parent) {
        const parent=this.surfaces.find(x=>x.selector===c.parent);
        if(!parent || !await this.opener(parent,[...stack,s.selector]))continue;
      }
      this.openers.set(s.selector,c);return c;
    }
    return null;
  }
  async ensure(s) {
    if(await this.read('visible',s.selector))return true;
    if(s.reopen) {await s.reopen();return !!await this.read('visible',s.selector);}
    const opener=await this.opener(s);
    if(!opener)return false;
    if(opener.parent) {
      const parent=this.surfaces.find(x=>x.selector===opener.parent);
      if(!parent || !await this.ensure(parent))return false;
    }
    await this.click(opener.selector);
    await this.frame.waitForFunction(dom,{op:'visible',selector:s.selector},{timeout:800}).then(handle=>handle.dispose()).catch(()=>{});
    return !!await this.read('visible',s.selector);
  }
  async close(s) {
    if(!await this.read('visible',s.selector))return true;
    const close=await this.read('close',s.selector);
    if(close)await this.click(close.selector);
    else {await this.page.keyboard.press('Escape');await this.settle();}
    return !await this.read('visible',s.selector);
  }
  async clean() {
    for(const s of [...this.surfaces].reverse())if(await this.read('visible',s.selector)) {
      if(!await this.close(s))return false;
    }
    return true;
  }
  async routeFor(s,seen=[]) {
    if(seen.includes(s.selector))return [];
    const o=await this.opener(s);
    if(!o)return [];
    const p=this.surfaces.find(x=>x.selector===o.parent);
    return [...(p?await this.routeFor(p,[...seen,s.selector]):[]),{selector:o.selector}];
  }
  async links(s) {
    const kind=kindOf({surfaceId:s.id,container:{heading:{text:s.heading}}});
    if(!['Settings','Help'].includes(kind))return;
    const route=await this.routeFor(s);
    for(const link of await this.read('links',s.selector)) {
      const address=new URL(link.href);
      if(address.origin!==h.ORIGIN||!address.pathname.startsWith('/export/games/')||canonical(link.href)===canonical(this.frame.url()))continue;
      if(!localPage(link.href)) {
        if(/\.html$|\/$/.test(address.pathname))report.unopened.push({...this.meta(),href:link.href,opener:link,viewport:this.viewport.width,reason:'Linked package page is missing from build/html.'});
        continue;
      }
      const url=canonical(link.href);
      const variant=(this.game.variants||[]).find(v=>new URL(url).pathname===new URL('games/'+v.entry,BASE).pathname)?.id || this.target.variant || null;
      report.pages.push({...this.meta(),viewport:this.viewport.width,href:url,link,status:'discovered'});
      this.addTarget({url,mode:this.target.mode,variant,steps:[...(this.target.steps||[]),...route,{selector:link.selector,navigation:url}],via:{entry:this.target.url,surface:s.id,link}});
    }
  }
  shotName(s) {
    const detail=[this.target.mode,this.target.variant,this.target.steps?.length?'page-'+digest(this.target.url):null].filter(Boolean).join('-');
    return `${slug(this.game.id)}--${slug([detail,s.id,s.state].filter(Boolean).join('--'))}--${this.viewport.width}.png`;
  }
  async capture(s, opener, start) {
    const data=await this.read('inspect',s.selector);
    const record={...this.meta(),surfaceId:s.id,selector:s.selector,state:s.state||null,surfaceType:s.state?'modal-state':s.surfaceType,hiddenAtLoad:s.hiddenAtLoad,native:false,opener:opener?{selector:opener.selector,accessibleName:opener.accessibleName,tag:opener.tag}:null,
      ...data,opened:true,closeControl:await this.read('close',s.selector),behavior:unmeasured('Not measured yet.'),layouts:{},screenshots:{},consoleErrors:[],pageErrors:[]};
    if(s.openerFrame)record.opener.frame=s.openerFrame.url();
    record.frame=this.frame===this.page.mainFrame()?'library':'player';
    record.kind=s.state&&/settings/i.test(s.state)?'Settings':kindOf(record);
    const shot=this.shotName(s);
    await this.page.screenshot({path:path.join(SHOTS,shot),fullPage:false,timeout:1500});
    record.layouts[this.viewport.width]={...data.layout,colorScheme:this.light?'light':'dark'};
    delete record.layout;
    record.screenshots[this.viewport.width]='shots/'+shot;
    const key=identity(record);
    let saved=report.surfaces.find(x=>identity(x)===key);
    if(saved&&!saved.opened&&!saved.native) {
      const previousLayouts=saved.layouts,previousShots=saved.screenshots;
      Object.assign(saved,record,{layouts:{...previousLayouts,...record.layouts},screenshots:{...previousShots,...record.screenshots}});
      saved.notes=['An earlier opener attempt failed; this surface was subsequently opened.'];
    }
    if(this.light&&saved) {
      saved.layouts[this.viewport.width]=record.layouts[this.viewport.width];saved.screenshots[this.viewport.width]=record.screenshots[this.viewport.width];
    } else if(!saved) {
      if(this.light)record.behavior=unmeasured('Only discovered during the 320px layout pass.');
      report.surfaces.push(record);saved=record;
    }
    this.active=saved;
    this.surfaceKeys.add(key);
    if(!this.light&&!s.state)await this.behavior(s,saved);
    else if(s.state&&!this.light)saved.behavior=unmeasured('Tab state of an already measured container; see its base surface.');
    const errors=this.events.filter(e=>e.at>=start);
    if(!this.light) {
      saved.consoleErrors.push(...errors.filter(e=>e.type==='console'));
      saved.pageErrors.push(...errors.filter(e=>e.type==='pageerror'));
    }
    this.active=null;
    return saved;
  }
  async unopened(s,opener,reason) {
    const data=await this.read('inspect',s.selector);
    const item={...this.meta(),surfaceId:s.id,selector:s.selector,opener:null,candidate:opener,viewport:this.viewport.width,reason};
    report.unopened.push(item);
    const key=identity(item);
    if(!report.surfaces.some(x=>identity(x)===key)) {
      delete data.layout;
      report.surfaces.push({...this.meta(),surfaceId:s.id,selector:s.selector,state:null,surfaceType:s.surfaceType,hiddenAtLoad:s.hiddenAtLoad,native:false,opened:false,opener:null,candidateOpener:opener,
        ...data,visibleText:'',kind:kindOf({surfaceId:s.id,...data}),closeControl:null,behavior:unmeasured(reason),layouts:{},screenshots:{},consoleErrors:[],pageErrors:[],notes:[reason,'DOM metadata only; layout and visible text require opening the surface.']});
    }
  }
  async behavior(s,record) {
    const b=record.behavior;
    const measure=async(key,fn)=>{try{b[key]=await fn();}catch(e){b[key]=result(null,errorText(e));}};
    await measure('focusMovesInside',async()=>{
      const a=await this.read('active',s.selector);
      return result(s.hiddenAtLoad?a.inside:null,s.hiddenAtLoad?'Focus immediately after real opener click.':'Surface already visible at load; no opening transition to measure.',a.element);
    });
    await measure('tabStaysInside',async()=>{
      const list=await this.read('focusables',s.selector);
      if(!list.length)return result(null,'No tabbable descendants.');
      const last=list.at(-1);await this.frame.locator(last.selector).focus();
      const visited=[];
      for(let i=0;i<60;i++) {
        await this.page.keyboard.press('Tab');
        const a=await this.read('active',s.selector);visited.push(a.element);
        if(!a.inside)return result(false,`Focus escaped on Tab ${i+1}, starting at the last tabbable control.`,visited);
        if(i===0&&a.element?.selector===last.selector || i>0&&a.element?.selector===visited[0]?.selector)return result(true,`Focus stayed inside through a cycle of ${i+1} Tab presses.`,visited);
      }
      return result(true,'Focus stayed inside for 60 Tab presses from the last control; traversal capped at 60.',visited);
    });
    await measure('shiftTabStaysInside',async()=>{
      const first=(await this.read('focusables',s.selector))[0];
      if(!first)return result(null,'No tabbable descendants.');
      await this.frame.locator(first.selector).focus();await this.page.keyboard.press('Shift+Tab');
      const a=await this.read('active',s.selector);return result(a.inside,'Shift+Tab from the first tabbable control.',a.element);
    });
    await measure('backgroundDoesNotScroll',async()=>{
      const before=await this.read('background',s.selector);
      const outer=this.frame===this.page.mainFrame()?[]:await this.page.mainFrame().evaluate(dom,{op:'background',selector:'#player'});
      if(!before.length&&!outer.length)return result(null,'No scrollable background; scroll locking cannot be distinguished from page geometry.');
      const p=record.layouts[this.viewport.width].panelBox;
      const offset=this.frame===this.page.mainFrame()?{x:0,y:0}:await (await this.frame.frameElement()).boundingBox();
      await this.page.mouse.move(offset.x+Math.max(2,Math.min(this.viewport.width-3,p.x+p.width/2)),offset.y+Math.max(2,Math.min(this.viewport.height-3,p.y+p.height/2)));
      const old=await this.read('scrollPanel',s.selector,{end:true});
      await this.page.mouse.wheel(0,600);await this.page.waitForTimeout(60);
      const afterDown=await this.read('background',s.selector);
      const outerDown=this.frame===this.page.mainFrame()?[]:await this.page.mainFrame().evaluate(dom,{op:'background',selector:'#player'});
      await this.read('scrollPanel',s.selector,{end:false});await this.page.mouse.wheel(0,-600);await this.page.waitForTimeout(60);
      const afterUp=await this.read('background',s.selector);
      const outerUp=this.frame===this.page.mainFrame()?[]:await this.page.mainFrame().evaluate(dom,{op:'background',selector:'#player'});
      await this.read('scrollPanel',s.selector,{restore:old});
      const same=(a,b)=>a.every(x=>b.some(y=>x.selector===y.selector&&x.top===y.top&&x.left===y.left));
      return result(same(before,afterDown)&&same(before,afterUp)&&same(outer,outerDown)&&same(outer,outerUp),'Real wheel input in both directions at the panel scroll boundaries.',{before,afterDown,afterUp,outer,outerDown,outerUp});
    });
    await measure('escapeCloses',async()=>{
      const first=(await this.read('focusables',s.selector))[0];if(first)await this.frame.locator(first.selector).focus();
      await this.page.keyboard.press('Escape');await this.settle();
      return result(!await this.read('visible',s.selector),'One Escape key press.');
    });
    await measure('focusReturnsToOpener',async()=>{
      if(await this.read('visible',s.selector)&&!await this.close(s))return result(null,'Escape and safe close control did not close the surface.');
      if(!record.opener)return result(null,'No opener for comparison.');
      const f=s.openerFrame||this.frame;
      const active=await f.evaluate(dom,{op:'isActive',selector:record.opener.selector});
      return result(!!active,'Active element after Escape or a safe close click.',await f.evaluate(dom,{op:'active',selector:'body'}));
    });
    await measure('backdropCloses',async()=>{
      if(!await this.ensure(s))return result(null,'Could not reopen for backdrop test.');
      const point=await this.read('backdrop',s.selector);
      if(!point)return result(null,'No exposed backdrop outside the panel at this viewport.');
      const offset=this.frame===this.page.mainFrame()?{x:0,y:0}:await (await this.frame.frameElement()).boundingBox();
      await this.page.mouse.click(offset.x+point.x,offset.y+point.y);await this.settle();
      return result(!await this.read('visible',s.selector),'Real click outside the panel on its backdrop.',point);
    });
    record.androidBack={value:null,note:'Out of scope.'};
  }
  async probeActions(s) {
    if(kindOf({surfaceId:s.id,container:{heading:{text:s.heading}}})!=='Settings')return;
    if(!await this.ensure(s))return;
    const actions=await this.read('actions',s.selector);
    for(const a of actions) {
      this.check();
      const log={...this.meta(),viewport:this.viewport.width,parent:s.id,opener:a};
      try {
        if(!await this.ensure(s))throw Error('Could not reopen Settings for action probe');
        if(a.disabled) {log.result='disabled';continue;}
        const before=this.nativeCount||0,start=Date.now();
        const oldVisible=new Set();for(const known of this.surfaces)if(await this.read('visible',known.selector))oldVisible.add(known.selector);
        await this.click(a.selector);
        const scan=await this.read('scan','body',{includeVisible:true});
        for(const found of scan)if(!this.surfaces.some(x=>x.selector===found.selector))this.surfaces.push(found);
        const opened=[];
        for(const found of this.surfaces)if(!oldVisible.has(found.selector)&&await this.read('visible',found.selector))opened.push(found);
        for(const found of opened) {
          this.openers.set(found.selector,{...a,parent:s.selector});
          await this.capture(found,a,start);
          if(!await this.close(found))throw Error('Could not cancel '+found.id);
        }
        log.result=opened.length?'opened DOM surface':(this.nativeCount||0)>before?'native dialog dismissed':'no further surface appeared';
        log.surfaces=opened.map(x=>x.id);
      } catch(e) {log.result='could not probe';log.message=errorText(e);}
      finally {report.probes.push(log);}
    }
  }
  async collectionScores(parent) {
    if(this.game.id==='library')return;
    const button=await this.read('collectionScores',parent.selector);
    if(!button||button.hidden||button.disabled)return;
    const s={id:'library-scores',selector:'#scores',hiddenAtLoad:true,surfaceType:'modal',openerFrame:this.frame};
    if(this.surfaceKeys.has(identity({...this.meta(),surfaceId:s.id})))return;
    const gameFrame=this.frame,libraryFrame=this.page.mainFrame();
    const tab=await gameFrame.locator('[role="tab"][aria-selected="true"]').first().count()?await gameFrame.locator('[role="tab"][aria-selected="true"]').first().evaluate(e=>e.id?'#'+CSS.escape(e.id):null):null;
    s.reopen=async()=>{
      this.frame=gameFrame;
      try {
        if(!await this.ensure(parent))throw Error('Could not reopen game sheet for Collection scores');
        if(tab)await this.click(tab);
        await this.click(button.selector);
        await libraryFrame.locator('#scores').waitFor({state:'visible',timeout:1000});
      } finally {this.frame=libraryFrame;}
    };
    try {
      const start=Date.now();await s.reopen();
      await this.capture(s,button,start);
      if(!await this.close(s))throw Error('Could not close library scores over the game');
    } catch(e) {
      this.err(e,{surface:s.id});
      report.unopened.push({...this.meta(),surfaceId:s.id,viewport:this.viewport.width,opener:button,reason:errorText(e)});
    } finally {this.frame=gameFrame;}
  }
  async auditTarget(t) {
    await this.load(t);
    report.pages.push({...this.meta(),viewport:this.viewport.width,status:'opened',via:t.via||'library tile'});
    this.visited.add(canonical(this.frame.url()));
    // All declared surfaces are retained, including failures and those without an opener.
    for(let i=0;i<this.surfaces.length;i++) {
      this.check();const s=this.surfaces[i];
      const key=identity({...this.meta(),surfaceId:s.id});
      if(this.surfaceKeys.has(key))continue;
      let opener=null;
      try {
        if(s.hiddenAtLoad && !await this.clean()) {await this.load(t);}
        opener=await this.opener(s);
        const start=Date.now();
        if(!await this.ensure(s)) {
          await this.unopened(s,opener,opener?'Candidate opener did not reveal the surface.':'No opener found.');continue;
        }
        await this.links(s);
        await this.capture(s,opener,start);
        if(await this.ensure(s)) {
          for(const tab of await this.read('tabs',s.selector)) {
            await this.click(tab.selector);
            await this.capture({...s,state:tab.accessibleName},tab,Date.now());
            await this.collectionScores(s);
          }
          await this.collectionScores(s);
        }
        await this.probeActions(s);
      } catch(e) {
        this.err(e,{surface:s.id});
        await this.unopened(s,opener,errorText(e)).catch(()=>report.unopened.push({...this.meta(),surfaceId:s.id,opener,viewport:this.viewport.width,reason:errorText(e)}));
      }
    }
  }
  async run() {
    if(this.game.id==='library')this.addTarget({url:BASE+'index.html',steps:[]});
    else for(const m of this.game.modes?.length?this.game.modes:[null])this.addTarget({url:new URL('games/'+(m?.entry||this.game.entry),BASE).href,mode:m?.id||null,steps:[]});
    while(this.queue.length) {
      this.check();const t=this.queue.shift();
      if(this.visited.has(canonical(t.url)))continue;
      try {await this.auditTarget(t);}catch(e){this.err(e);report.unopened.push({...this.meta(),href:t.url,viewport:this.viewport.width,reason:errorText(e),opener:null});}
    }
    for(const v of this.game.variants||[])if(![...this.visited].some(url=>new URL(url).pathname===new URL('games/'+v.entry,BASE).pathname)) {
      report.unopened.push({game:this.game.id,variant:v.id,entry:v.entry,viewport:this.viewport.width,opener:null,reason:'Catalog variant was not reached by an in-package Settings or Help link.'});
    }
  }
}

function markdown() {
  const cell=s=>String(s??'—').replace(/\|/g,'\\|').replace(/\s+/g,' ').trim();
  const lines=['# Modal inventory','',`Generated ${report.generatedAt}. Manifest SHA-256: \`${report.build.manifestSHA256}\`.`,
    '', '390×844 dark: full inventory and behavior. 320×568 light: layout and screenshots only. Android Back is out of scope. Null means unmeasured; see the note. Accessible games is a library view, not a modal.', ''];
  for(const kind of ['Settings','Help','levels','scores','confirm','other']) {
    lines.push('## '+kind,'','| Game / mode / variant / page | Surface | Title | Sections | Close | Footer | Focus inside | Tab | Shift+Tab | Escape | Backdrop | Focus return | Scroll lock |','|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for(const s of report.surfaces.filter(s=>s.kind===kind)) {
      const label=[s.game,s.mode,s.variant,s.entry?.replace(BASE+'games/',''),s.state].filter(Boolean).join(' / ');
      const close=s.closeControl;
      const cells=[label,s.surfaceId,s.container?.heading?.text||s.message||'',s.sections?.filter(h=>!h.hidden).map(h=>h.text).join(' · '),close?`${close.accessibleName} (${close.position}; ${Math.round(close.box.width)}×${Math.round(close.box.height)})`:'none',s.footer?.text||'',...checks.map(k=>`${s.behavior[k]?.value??'null'}: ${s.behavior[k]?.note||'unmeasured'}`)];
      lines.push('| '+cells.map(cell).join(' | ')+' |');
    }
    lines.push('');
  }
  lines.push('## Unopened and unclassified','');
  for(const u of report.unopened)lines.push(`- ${cell([u.game,u.mode,u.variant,u.surfaceId,u.entry||u.href,u.viewport].filter(Boolean).join(' / '))}: ${cell(u.reason)}`);
  for(const s of report.surfaces.filter(s=>s.kind==='other'))lines.push(`- ${cell(s.game+' / '+s.surfaceId)}: classified as other (${cell(s.container?.heading?.text||s.surfaceType||'no heading')}).`);
  lines.push('','## Pages found','');
  for(const p of report.pages)lines.push(`- ${cell(p.game)} (${p.viewport}): ${p.status} ${cell(p.href||p.entry)}`);
  lines.push('','## Errors','');
  for(const e of report.errors)lines.push(`- ${cell(e.game)} (${e.viewport||'launch'}): ${cell(e.message)}`);
  return lines.join('\n')+'\n';
}
function save() {
  fs.writeFileSync(path.join(OUT,'modals.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,'modals.md'),markdown());
}
async function main() {
  let browser;
  try {
    // Launch before touching ../out so a sandbox launch failure stops immediately.
    browser=await h.launch();
    fs.mkdirSync(SHOTS,{recursive:true});
    const only=(process.env.AUDIT_ONLY||'').split(',').filter(Boolean);
    const jobs=[{id:'library',modes:[],variants:[]},...catalog].filter(g=>!only.length||only.includes(g.id));
    for(const pass of [{width:390,height:844,scheme:'dark'},{width:320,height:568,scheme:'light'}]) {
      for(const game of jobs) {
        const ctx=await h.context(browser,{width:pass.width,height:pass.height},{scheme:pass.scheme});
        ctx.setDefaultTimeout(1500);ctx.setDefaultNavigationTimeout(5000);
        if(ctx.routeWebSocket)await ctx.routeWebSocket('**/*',socket=>socket.close());
        const audit=new Audit(ctx,game,pass,pass.width===320);
        let timer;
        const run=audit.run();
        try {
          await Promise.race([run,new Promise((_,reject)=>{timer=setTimeout(()=>{audit.cancelled=true;reject(Error('Per-game timeout (60 seconds)'));},60000);})]);
        } catch(e) {
          audit.err(e);
          for(const t of audit.queue)report.unopened.push({game:game.id,mode:t.mode,variant:t.variant,entry:t.url,viewport:pass.width,opener:null,reason:'Not reached within the per-game budget.'});
        } finally {
          clearTimeout(timer);audit.cancelled=true;
          await ctx.close();await run.catch(()=>{});
        }
        save();
        console.log(`${game.id} ${pass.width} ${pass.scheme}: ${audit.surfaceKeys.size} surfaces; ${report.unopened.filter(x=>x.game===game.id&&x.viewport===pass.width).length} unopened; ${report.errors.filter(x=>x.game===game.id&&x.viewport===pass.width).length} errors`);
      }
    }
    for(const game of catalog)for(const width of [390,320]) {
      const expected=[...(game.modes.length?game.modes.map(m=>({mode:m.id,entry:m.entry})):[{entry:game.entry}]),...game.variants.map(v=>({variant:v.id,entry:v.entry}))];
      for(const target of expected) {
        const found=report.pages.some(p=>p.game===game.id&&p.viewport===width&&p.status==='opened'&&new URL(p.entry).pathname===new URL('games/'+target.entry,BASE).pathname);
        if(!found&&!report.unopened.some(u=>u.game===game.id&&u.viewport===width&&u.entry===target.entry))report.unopened.push({game:game.id,...target,viewport:width,opener:null,reason:'Catalog entry was not opened; see page discoveries, opener failures, and per-game errors.'});
      }
    }
    // A failed default-pass opener may have been found through an action probe later.
    report.unopened=report.unopened.filter(u=>!u.surfaceId||!report.surfaces.some(s=>s.game===u.game&&s.mode===u.mode&&s.variant===u.variant&&s.entry===u.entry&&s.surfaceId===u.surfaceId&&s.screenshots[u.viewport]));
    save();
    const counts=Object.fromEntries(['Settings','Help','levels','scores','confirm','other'].map(k=>[k,report.surfaces.filter(s=>s.kind===k).length]));
    console.log(JSON.stringify({surfacesByKind:counts,unopened:report.unopened.length,errors:report.errors.length,output:OUT}));
  } finally {if(browser)await browser.close();fs.rmSync(receipt,{recursive:true,force:true});}
}
main().catch(e=>{console.error('Modal audit stopped: '+String(e.stack||e));process.exitCode=1;});
