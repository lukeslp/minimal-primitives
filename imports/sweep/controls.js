/* Shared Minimal control presentation. Luke Steuber. */
(function () {
  'use strict';
  const config = {"id":"sweep","bar":".toolbar","undo":"undo-btn","hint":"hint-btn","settings":"settings-btn","help":"help-btn","levels":"#board-catalog","restart":"restart-btn","completion":["next-btn"],"required":["undo-btn","hint-btn"],"keys":["press"],"modes":["off","look"]};
  // Native payloads have their own release/acceptance contract.
  if (window.HEXSWEEPER_SPHERE_APP) return;
  // Where this file was loaded from; an inlined copy (a one-page build) has no
  // address, so it cannot load Access and leaves its row out on purpose.
  const here = document.currentScript && document.currentScript.src;
  const byId = id => id && document.getElementById(id);
  const cross = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const restart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  let observer;
  // The readout (#readout, fixed and centered on the top row) keeps clear of
  // the controls at the row's left: the restart button and any button a host
  // page sets beside it (Minimal Primitives puts its Home there). It stays
  // centered while it fits, moves right only as far as it must, and wraps
  // before it would run under a control on either side.
  function clearOfTopLeft(reset, bar) {
    const read = byId('readout');
    if (!read) return;
    const gap = 8;
    const fit = () => {
      for (const k of ['margin-left', 'width', 'white-space', 'text-align']) read.style.removeProperty(k);
      if (!read.getClientRects().length || getComputedStyle(read).position !== 'fixed' || !read.textContent.trim()) return;
      const row = read.getBoundingClientRect(), mid = innerWidth / 2;
      const beside = n => { if (n === read || read.contains(n) || !n.getClientRects().length) return null; const q = n.getBoundingClientRect(); return q.bottom > row.top && q.top < row.bottom ? q : null; };
      let left = 0, right = innerWidth - gap;
      for (let n = reset; n; n = n.nextElementSibling) { const q = n.matches('button') ? beside(n) : null; if (q && q.left < mid) left = Math.max(left, q.right + gap); }
      for (const n of bar.querySelectorAll('button')) { const q = beside(n); if (q && q.right > mid) right = Math.min(right, q.left - gap); }
      if (!left || row.left >= left) return;
      // Too wide for the room between the controls: it takes that room's width and wraps there.
      if (row.width > right - left) { read.style.setProperty('width', Math.max(0, right - left) + 'px'); read.style.setProperty('white-space', 'normal'); read.style.setProperty('text-align', 'center'); }
      const now = read.getBoundingClientRect();
      if (now.left < left) read.style.setProperty('margin-left', Math.round(left - now.left) + 'px');
    };
    let frame = 0;
    const again = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    new MutationObserver(again).observe(read, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    // A host page that adds its own control beside the restart button.
    if (reset.parentElement) new MutationObserver(again).observe(reset.parentElement, { childList: true });
    addEventListener('resize', again);
    if (document.fonts) document.fonts.ready.then(again);
    again();
  }
  // The readout opens the level list. A game that names its list of boards in
  // games.json (levels: its select, or the list that holds a button per
  // board) takes a tap, a click, Enter or Space on #readout as a press of its
  // Settings button, so the game opens and fills its sheet as it always does;
  // the list is then brought into view and focused (the select itself, or the
  // current board's button). The readout looks exactly as it did: only the
  // pointer turns to a hand over it, and a keyboard focus ring shows where
  // Tab reaches it. Its name stays what it shows (or the game's own label for
  // it); its description says what a press does ("Choose a board"). An empty
  // or hidden readout is left out of the Tab order.
  function readoutOpensLevels() {
    const read = byId('readout'), opener = byId(config.settings), sheet = byId(config.sheet || 'settings');
    if (!config.levels || !read || !opener || !sheet || read.dataset.controlReadout || read.closest('button,a,[role="button"]')) return;
    read.dataset.controlReadout = 'levels';
    const role0 = read.getAttribute('role'), note = document.createElement('span');
    note.id = 'control-readout-action'; note.hidden = true; note.textContent = 'Choose a ' + (config.levelsName || 'board');
    document.body.append(note);
    const sync = () => {
      if ((read.getAttribute('aria-label') || read.textContent || '').trim() && !read.hidden) {
        if (read.getAttribute('role') !== 'button') read.setAttribute('role', 'button');
        if (read.getAttribute('tabindex') !== '0') read.setAttribute('tabindex', '0');
        if (read.getAttribute('aria-describedby') !== note.id) read.setAttribute('aria-describedby', note.id);
      } else {
        if (role0) { if (read.getAttribute('role') !== role0) read.setAttribute('role', role0); } else read.removeAttribute('role');
        read.removeAttribute('tabindex'); read.removeAttribute('aria-describedby');
      }
    };
    new MutationObserver(sync).observe(read, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    sync();
    const target = () => {
      const list = sheet.querySelector(config.levels);
      if (!list) return null;
      if (list.matches('select,input,button')) return list;
      return list.querySelector('[aria-current]:not([aria-current="false"])') || list.querySelector('button:not(:disabled),[tabindex="0"]');
    };
    const open = detail => {
      if (read.getAttribute('role') !== 'button' || sheet.open || opener.disabled) return;
      opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail }));
      // A sheet the game opens a frame later is met there.
      const show = () => { const n = sheet.open && target(); if (!n) return; n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'center', inline: 'nearest' }); };
      if (sheet.open) show(); else requestAnimationFrame(show);
    };
    read.addEventListener('click', e => { if (read.getAttribute('role') === 'button') open(e.detail || 1); });
    // Enter acts as it goes down; Space, as on a button, when it comes up, so
    // the key is not still down on the list it focused.
    let space = false;
    read.addEventListener('keydown', e => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey || e.altKey || read.getAttribute('role') !== 'button') return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === ' ') space = true; else if (!e.repeat) open(0);
    });
    read.addEventListener('keyup', e => {
      if (e.key !== ' ' || !space) return;
      space = false; e.preventDefault(); e.stopPropagation(); open(0);
    });
    read.addEventListener('blur', () => { space = false; });
  }
  function apply() {
    if (document.body.dataset.controlFrame === config.id) return true;
    const existing = (config.required || []).map(byId);
    if (existing.some(n => !n)) return false;
    const root = config.root ? byId(config.root) : document.body;
    const bar = document.querySelector(config.bar);
    if (!root || !bar) return false;
    let reset = byId(config.restart);
    if (!reset && config.restartProxy && byId(config.restartProxy)) {
      reset = document.createElement('button');reset.type='button';reset.id='control-restart';
      reset.setAttribute('aria-label','Restart puzzle');reset.innerHTML=restart;
      reset.addEventListener('click',()=>byId(config.restartProxy)?.click());
    }
    if (reset) {
      reset.classList.add('control-icon','control-restart');
      // Preserve an existing header's input boundary and delegated handlers.
      if(!reset.isConnected || bar.contains(reset))root.prepend(reset);
    }
    if (reset) clearOfTopLeft(reset, bar);
    const actions=document.createElement('div'),meta=document.createElement('div');
    actions.className='control-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Game actions');
    meta.className='control-meta';meta.setAttribute('role','group');meta.setAttribute('aria-label','Settings and help');
    const actionIds=[config.undo,config.hint,...(config.tools||[])].filter(Boolean);
    const metaIds=[config.settings,config.help].filter(Boolean);
    for(const id of actionIds){const n=byId(id);if(n){n.classList.add('control-icon');actions.append(n);}}
    for(const id of metaIds){const n=byId(id);if(n){n.classList.add('control-icon');meta.append(n);}}
    const kept = new Set([...actions.children,...meta.children]);
    // All toolbar functions are explicitly declared. An unknown control stays
    // in its own action slot rather than being lost during a presentation pass.
    for(const node of [...bar.querySelectorAll('button')]){
      if(node===reset||kept.has(node)||(config.completion||[]).includes(node.id))continue;
      node.classList.add('control-icon');actions.append(node);
    }
    const completionNodes=(config.completion||[]).map(id=>byId(id)).filter(Boolean);
    // Move the existing completion containers intact: their engines still own
    // visibility, state, focus and recovery. A standalone Next keeps its own hidden flag.
    if(config.completionRoot)document.body.dataset.completionRoot=config.completionRoot;
    for(const node of completionNodes){
      if(node===bar||node.contains(bar))continue;
      node.classList.add('control-completion');(byId(config.completionRoot)||root).append(node);
      for(const button of node.matches('button')?[node]:node.querySelectorAll('button')){
        if(!button.querySelector('svg')&&button.id==='share-btn'){
          if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',button.textContent.trim());
          button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 11v10h14V11" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
        }
        button.classList.add('control-icon');
      }
    }
    // A game's end lines (class control-end-line, placed below) stand on the
    // page, ahead of the toolbar, not inside a row the game moves or animates.
    for(const n of document.querySelectorAll('.control-end-line'))if(n.parentElement!==document.body)document.body.insertBefore(n,bar.parentElement===document.body?bar:null);
    // A standalone Next (the disc) sits centered in the gap between the board
    // and the toolbar when the gap holds it, otherwise on the toolbar's row,
    // centered in the free span between its two groups, so it never covers the
    // board or a control. In landscape, where the toolbar stands at the side,
    // it sits beside the board.
    const nexts=completionNodes.filter(n=>n.matches('button'));
    let spot=null,place=null;
    if(nexts.length){
      const shown=n=>!!n&&n.isConnected&&!n.hidden&&n.getClientRects().length>0;
      // An SVG is measured by what it draws, so a page-sized drawing still leaves its gap.
      const boxOf=n=>{
        if(n instanceof SVGSVGElement)try{const box=n.getBBox(),m=n.getScreenCTM();if(m&&box.width&&box.height){const p=[new DOMPoint(box.x,box.y).matrixTransform(m),new DOMPoint(box.x+box.width,box.y+box.height).matrixTransform(m)];return {left:Math.min(p[0].x,p[1].x),right:Math.max(p[0].x,p[1].x),top:Math.min(p[0].y,p[1].y),bottom:Math.max(p[0].y,p[1].y)};}}catch(_){}
        const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};
      };
      const union=(a,b)=>a?{left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)}:b;
      // What the game has painted, in this order: the game's own measure
      // (__minimalize.bounds()), the drawing games.json names (bounds: a
      // selector, or a canvas and the hook that holds its view), then the
      // board element (board, or #board). An element larger than its drawing
      // would leave the disc on the toolbar row with an empty gap above it.
      // Where the painted box and the board element agree to a pixel (a
      // hairline's half pixel, say), the element's box stands, so a board
      // that already is its drawing keeps its disc where it was.
      const drawn=()=>{
        let painted=null;const d=config.bounds,all=sel=>{let u=null;for(const n of document.querySelectorAll(sel)){if(!shown(n))continue;const r=boxOf(n);if(r.right-r.left>=1||r.bottom-r.top>=1)u=union(u,r);}return u;};
        const own=all(config.board||'#board');
        try{const b=window.__minimalize&&window.__minimalize.bounds();if(b&&b.width>0&&b.height>0)painted={left:b.x,top:b.y,right:b.x+b.width,bottom:b.y+b.height};}catch(_){}
        if(!painted&&d&&typeof d==='object'){const n=document.querySelector(d.element),g=d.view.split('.').reduce((o,k)=>o&&o[k],window);if(n&&g&&g.scale){const r=n.getBoundingClientRect();painted={left:r.left+g.x,top:r.top+g.y,right:r.left+g.x+d.size[0]*g.scale,bottom:r.top+g.y+d.size[1]*g.scale};}}
        if(!painted&&typeof d==='string')painted=all(d);
        return painted&&own&&['left','top','right','bottom'].every(k=>Math.abs(painted[k]-own[k])<=1)?own:painted||own;
      };
      // Where the disc stands: its center's left (undefined for the CSS
      // center) and its bottom, or null for the stylesheet's own place. Access
      // reads it too, so its pad keeps clear of the disc before it appears.
      spot=()=>{
        const size=64,clear=size+16,visible=b=>b.offsetParent!==null;
        const tools=[...bar.querySelectorAll('button')].filter(visible).map(n=>n.getBoundingClientRect()),b=drawn();
        if(!b||!tools.length)return null;
        const bottom=centre=>Math.max(6,Math.round(innerHeight-centre-size/2));
        if(matchMedia('(max-height:520px) and (min-width:560px)').matches){
          // A game with nextBelow keeps its disc under the board, centred on
          // the board, when the room below fits it; otherwise it goes beside.
          if(config.nextBelow){const under=innerHeight-b.bottom;if(under>=size+20)return {left:Math.round((b.left+b.right)/2),bottom:bottom(b.bottom+under/2)};}
          const side=Math.min(...tools.map(r=>r.left))-b.right,x=side>=clear?b.right+side/2:b.left>=clear?b.left/2:null;
          if(x===null)return null;
          return {left:Math.round(x),bottom:bottom((Math.max(0,b.top)+Math.min(innerHeight,b.bottom))/2)};
        }
        const top=Math.min(...tools.map(r=>r.top)),gap=top-b.bottom;
        if(gap>=clear)return {bottom:bottom(b.bottom+gap/2)};
        // On the toolbar's row: the disc's bottom on the toolbar's bottom, its
        // center midway between the last action and the first of Settings and
        // Help, at least 8 px from each. Where the row has no such room it
        // stands just above the toolbar, as a completion row does.
        const group=sel=>[...bar.querySelectorAll(sel+' button')].filter(visible).map(n=>n.getBoundingClientRect());
        const acts=group('.control-actions'),meta=group('.control-meta'),frame=bar.getBoundingClientRect();
        const from=acts.length?Math.max(...acts.map(r=>r.right)):frame.left,to=meta.length?Math.min(...meta.map(r=>r.left)):frame.right;
        if(to-from<size+16)return {bottom:Math.round(innerHeight-top+10)};
        const x=(from+to)/2;
        return {left:Math.abs(x-innerWidth/2)<1?undefined:Math.round(x),bottom:Math.max(6,Math.round(innerHeight-Math.max(...tools.map(r=>r.bottom))))};
      };
      // A game's line about the finish ("All 50 boards solved.", "That's
      // ten.", "Folded in 3."), given the class control-end-line, stands 8 px
      // above the disc and centered on it; with more than one, the last in the
      // page is nearest the disc. Where that would meet the board, a control,
      // the readout or the edge of the page, the lines stand under the readout.
      const placeLines=()=>{
        const body=document.body,lines=[...document.querySelectorAll('.control-end-line')].filter(n=>shown(n)&&n.textContent.trim());
        delete body.dataset.endLine;
        if(!lines.length)return;
        let shift=0;for(const n of [...lines].reverse()){n.style.setProperty('--control-end-shift',shift+'px');shift+=n.getBoundingClientRect().height+4;}
        const avoid=[drawn(),...[...document.querySelectorAll('.control-toolbar button,.control-restart,#readout,.control-completion')].filter(shown).map(n=>n.getBoundingClientRect())].filter(Boolean);
        const meets=(r,q)=>Math.min(r.right,q.right)-Math.max(r.left,q.left)>0&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>0;
        if(!lines.some(n=>{const r=n.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||avoid.some(q=>meets(r,q));}))return;
        const read=byId('readout'),under=shown(read)?read.getBoundingClientRect():null;
        body.style.setProperty('--control-end-top',Math.round(under?under.bottom+6:16)+'px');
        if(under)body.style.setProperty('--control-end-left',Math.round((under.left+under.right)/2)+'px');else body.style.removeProperty('--control-end-left');
        body.dataset.endLine='top';
        let drop=0;for(const n of lines){n.style.setProperty('--control-end-drop',drop+'px');drop+=n.getBoundingClientRect().height+4;}
      };
      place=()=>{
        const style=document.body.style,s=spot();style.removeProperty('--control-next-left');
        if(!s)style.removeProperty('--control-next-bottom');
        else{if(s.left!==undefined)style.setProperty('--control-next-left',s.left+'px');style.setProperty('--control-next-bottom',s.bottom+'px');}
        placeLines();
      };
      // Placed again whenever a completion appears, an end line changes, or the page resizes.
      const again=()=>requestAnimationFrame(place);
      for(const n of completionNodes)new MutationObserver(()=>{if(!n.hidden)again();}).observe(n,{attributes:true,attributeFilter:['hidden']});
      for(const n of new Set([...document.querySelectorAll('.control-end-line'),...(config.endLine||[]).map(byId).filter(Boolean)]))new MutationObserver(again).observe(n,{attributes:true,attributeFilter:['hidden','class'],childList:true,characterData:true,subtree:true});
      addEventListener('resize',again);again();
    }
    for(const n of [...bar.children])if(!n.matches('button')&&!n.contains(reset)&&!n.querySelector('button'))n.remove();
    bar.classList.add('control-toolbar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Game controls');
    bar.append(actions,meta);
    for(const n of document.querySelectorAll('dialog,[role="dialog"],.modal-overlay')){
      n.classList.add('control-sheet');
      for(const close of n.querySelectorAll('button[aria-label^="Close"],button[aria-label^="close"]')){
        close.classList.add('control-close');close.innerHTML=cross;
      }
    }
    readoutOpensLevels();
    // Safari on iOS applies :active, the press band, only beneath a touch listener.
    document.addEventListener('touchstart',()=>{},{passive:true});
    if(config.keys&&here)try{access(completionNodes,nexts,spot,place);}catch(_){}
    document.body.dataset.controlFrame=config.id;
    observer?.disconnect();
    window.addEventListener('pagehide',()=>observer?.disconnect(),{once:true});
    return true;
  }
  // ---- Access: one switch, or look and hold, for every framed game. It is
  // off until a player turns it on in Settings, where the frame adds its rows.
  // Only those rows and the saved choice live here; the pad, the scan and the
  // look and hold are in access.js beside this file, loaded the first time
  // Access is on, so a game played without it carries none of that.
  // The camera needs a page that lets WebAssembly compile and fetch run.
  function cameraAllowed(){
    const m=document.querySelector('meta[http-equiv="Content-Security-Policy" i]');if(!m)return true;
    const d={};for(const part of m.content.split(';')){const [name,...v]=part.trim().split(/\s+/);if(name)d[name.toLowerCase()]=v;}
    const script=d['script-src']||d['default-src'],connect=d['connect-src']||d['default-src'];
    if(script&&!script.some(v=>v==="'wasm-unsafe-eval'"||v==="'unsafe-eval'"))return false;
    return !connect||connect.some(v=>v==="'self'"||v==='*');
  }
  // An eye tracker comes through the gaze bridge on this computer
  // (gaze-bridge/PROTOCOL.md), so the page must let it connect to 127.0.0.1.
  function trackerAllowed(){
    if(typeof WebSocket!=='function')return false;
    const m=document.querySelector('meta[http-equiv="Content-Security-Policy" i]');if(!m)return true;
    const d={};for(const part of m.content.split(';')){const [name,...v]=part.trim().split(/\s+/);if(name)d[name.toLowerCase()]=v;}
    const connect=d['connect-src']||d['default-src'];
    return !connect||connect.some(v=>v==='*'||/^ws:\/\/127\.0\.0\.1(:(\*|\d+))?$/.test(v));
  }

  function access(completionNodes,nexts,spot,place){
    const KEY='minimal-access.v1:'+config.id;
    const DEFAULT_KEY='minimal-access.v1:default';
    // Up and down, flipped or not: the player's own, for every game on this site
    // and each camera game's camera too (read by their gaze code).
    const FLIP='minimal-gaze.v1:invert-y',cameraGame=!!document.querySelector('video#camera');
    const flipped=()=>{try{return localStorage.getItem(FLIP)==='1'?'on':'off';}catch(_){return 'off';}};
    const MODES=config.modes||['off','switch','look'],SPEEDS={slowest:6000,slower:3000,slow:1600,normal:1100,fast:700},HOLDS=[600,800,1000,1400];
    const camOK=cameraAllowed(),trackOK=trackerAllowed(),pointing=config.keys.some(k=>k==='point'||k==='drag'||k.id==='point'||k.id==='drag');
    // Every choice and its first value, which is the default. Press time is
    // how long a press must last to count; release time is how long after a
    // press another is taken as a bounce (a tenth of a second unless chosen,
    // short enough for a player who presses twice quickly on purpose). Long
    // press takes back a step (off unless chosen); rest stops the scan after
    // so many silent passes (never unless chosen). Speed reaches down to a
    // step every 6 s for a player who needs that long to press.
    const CHOICES={mode:MODES,speed:['normal','slow','slower','slowest','fast'],scan:['groups','keys'],press:[0,200,500,1000],release:[100,300,600,1000,1500],long:[0,1000,1500,2000],rest:[0,2,4,8],highlight:['invert','outline'],brake:['off','on'],look:camOK?['head','eyes','pointer','tracker']:['pointer','head','eyes','tracker'],hold:[800,600,1000,1400]};
    let prefs=Object.fromEntries(Object.entries(CHOICES).map(([k,v])=>[k,v[0]])),engine=null;
    // A game never set keeps the player's choice from the collection's
    // Accessibility page, where it fits this game; its own setting, once
    // made, wins from then on.
    try{if(localStorage.getItem(KEY)===null){const d=JSON.parse(localStorage.getItem(DEFAULT_KEY)||'null');if(d&&typeof d==='object')for(const k in CHOICES)if(CHOICES[k].includes(d[k]))prefs[k]=d[k];}}catch(_){}
    // The setting is kept per game. Each value is read on its own: one this
    // game does not know (an old choice, a damaged save) falls back to its
    // default and the rest are kept, and the next change saves a whole, valid
    // setting. A save that is not readable at all starts from the defaults.
    // One bad value used to turn Access off and stop saving for good.
    try{const raw=localStorage.getItem(KEY);if(raw!==null){const s=JSON.parse(raw);if(s&&typeof s==='object')for(const k in CHOICES)if(CHOICES[k].includes(s[k]))prefs[k]=s[k];}}catch(_){}
    // A look this page cannot offer (Head or Eyes where the camera's code may
    // not run, Eye tracker where the bridge may not be reached) plays by
    // pointer here, but the player's own choice stays saved for the pages
    // that can, until they choose another look here.
    let keptLook=null;
    if(!camOK&&prefs.look!=='tracker'&&prefs.look!=='pointer'||prefs.look==='tracker'&&!trackOK){keptLook=prefs.look;prefs.look='pointer';}
    const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(keptLook?{...prefs,look:keptLook}:prefs));}catch(_){}};
    const sheet=byId(config.sheet||'settings');
    // The Access rows follow the sheet's Motion or Theme row, or, where a game
    // names one, its own control (config.anchor) and that control's row
    // (config.anchorRow, when the row is not a label or a .row).
    const anchor=sheet&&((config.anchor&&sheet.querySelector(config.anchor))||sheet.querySelector('#motion')||sheet.querySelector('#theme,#theme-btn'));
    const row0=anchor&&anchor.closest('label,.row,.setting-row,.setting'+(config.anchorRow?','+config.anchorRow:''));
    if(!row0)return;
    // Each row copies the sheet's own: a labelled select, or a text button
    // that steps through its choices where the sheet uses those.
    const picker=anchor.matches('select'),rows={};
    function row(id,label,options){
      const r={options};let n;
      if(picker){
        const c=document.createElement('select');c.id='access-'+id;if(anchor.className)c.className=anchor.className;
        for(const [v,t,off] of options){const o=document.createElement('option');o.value=v;o.textContent=t;o.disabled=!!off;c.append(o);}
        if(row0.tagName==='LABEL'){n=document.createElement('label');const t=row0.firstChild;n.append(label+(t&&t.nodeType===3&&/\s$/.test(t.textContent)?' ':''),c);if(row0.htmlFor)n.htmlFor=c.id;}
        else{n=document.createElement('div');const s=document.createElement('span');s.id=c.id+'-label';s.textContent=label;c.setAttribute('aria-labelledby',s.id);n.append(s,c);}
        c.addEventListener('change',()=>change(id,c.value,true));r.paint=v=>{c.value=String(v);};
      }else{
        n=document.createElement('div');const s=document.createElement('span'),c=document.createElement('button'),st=document.createElement('span');
        s.id='access-'+id+'-label';s.textContent=label;c.type='button';c.id='access-'+id;if(anchor.className)c.className=anchor.className;
        st.id=c.id+'-state';c.append(st);c.setAttribute('aria-labelledby',s.id+' '+st.id);n.append(s,c);
        c.addEventListener('click',()=>{const on=options.filter(o=>!o[2]).map(o=>o[0]),i=on.indexOf(String(id==='flip'?flipped():prefs[id]));change(id,on[(i+1)%on.length],true);});
        r.paint=v=>{st.textContent=(options.find(o=>o[0]===String(v))||options[0])[1];};
      }
      n.className=(row0.className?row0.className+' ':'')+'access-row';n.dataset.access=id;r.node=n;rows[id]=r;return n;
    }
    const names={off:'Off',switch:'One switch',look:'Look and hold'};
    const cal=document.createElement('div'),calName=document.createElement('span'),calButton=document.createElement('button');
    cal.className=(row0.className&&row0.tagName!=='LABEL'?row0.className:picker?row0.className||'row':'setting-row')+' access-row';cal.dataset.access='calibrate';
    calName.textContent='Calibration';calButton.type='button';calButton.id='access-calibrate';calButton.className=picker?'access-action':anchor.className||'access-action';calButton.textContent='Calibrate';cal.append(calName,calButton);
    calButton.addEventListener('click',()=>{if(sheet.open&&sheet.close)sheet.close();ensure(e=>e.calibrate());});
    const secs=v=>v?v/1000+' s':'Off';
    // A sheet grouped under headings (h3.group) takes the Access rows as a
    // section of their own, after the section the anchor row is in; any other
    // sheet keeps them straight after the anchor row, with no heading.
    let last=row0,head=null;
    if(sheet.querySelector('h3.group')){
      while(last.nextElementSibling&&!last.nextElementSibling.matches('h3,section,[role="status"]'))last=last.nextElementSibling;
      head=document.createElement('h3');head.className='group access-group';head.textContent='Access';
    }
    last.after(row('mode','Access',MODES.map(m=>[m,names[m]])),row('speed','Speed',[['slowest','Slowest (6 s)'],['slower','Slower (3 s)'],['slow','Slow'],['normal','Normal'],['fast','Fast']]),
      row('scan','Scan',[['groups','Groups'],['keys','Keys']]),row('press','Press time',CHOICES.press.map(v=>[String(v),secs(v)])),
      row('release','Release time',CHOICES.release.map(v=>[String(v),secs(v)])),row('long','Long press',CHOICES.long.map(v=>[String(v),secs(v)])),
      row('rest','Rest after',[['0','Never'],['2','2 passes'],['4','4 passes'],['8','8 passes']]),row('highlight','Highlight',[['invert','Invert'],['outline','Outline']]),
      row('brake','Brake',[['off','Off'],['on','On']]),
      row('look','Look with',[['head','Head',!camOK],['eyes','Eyes',!camOK],['pointer','Pointer'],['tracker','Eye tracker',!trackOK]]),row('hold','Hold',HOLDS.map(h=>[String(h),h/1000+' s'])),row('flip','Up and down',[['off','As I move'],['on','Flipped']]),cal);
    // A clinician's lock (minimal-access.v1:locked, set by the accessible app):
    // the Access rows show their values but cannot be changed here.
    const locked=()=>{try{return localStorage.getItem('minimal-access.v1:locked')==='1';}catch(_){return false;}};
    const lockNote=document.createElement('p');lockNote.className='access-row access-locked';lockNote.dataset.access='locked';lockNote.textContent='Set by your clinician.';lockNote.hidden=true;
    rows.mode.node.before(lockNote);if(head)lockNote.before(head);
    // Why a look is greyed out, said beside it rather than left to guess.
    const lookNote=document.createElement('p');lookNote.className='access-row access-note';lookNote.dataset.access='look-note';
    lookNote.textContent=[!camOK&&'Head and Eyes need the camera, which this page does not allow.',!trackOK&&'Eye tracker needs the gaze bridge on this computer, which this page cannot reach.'].filter(Boolean).join(' ');
    rows.look.node.after(lookNote);
    // Access that could not load (offline, a blocked file) says so where it was chosen.
    const loadNote=document.createElement('p');loadNote.className='access-row access-error';loadNote.dataset.access='load-error';loadNote.setAttribute('role','alert');loadNote.textContent='Access could not load. Check the connection, then choose it again.';loadNote.hidden=true;
    rows.mode.node.after(loadNote);
    // The lock can change while the page is open (the app sets it); Settings shows the current one.
    byId(config.settings)?.addEventListener('click',()=>paintRows(),true);
    // Exact timings from the accessible app (minimal-access.v1:exact): read live by
    // the engine, each held to its range there; an unreadable one is ignored.
    const exact=()=>{try{const e=JSON.parse(localStorage.getItem('minimal-access.v1:exact')||'null');return e&&typeof e==='object'?e:null;}catch(_){return null;}};
    function paintRows(){
      for(const id in rows)rows[id].paint(id==='flip'?flipped():prefs[id]);
      const lock=locked();lockNote.hidden=!lock;for(const id in rows){const c=rows[id].node.querySelector('select,button');if(c)c.disabled=lock;}calButton.disabled=lock;
      for(const id of ['speed','scan','press','release','long','rest','highlight'])rows[id].node.hidden=prefs.mode!=='switch';
      rows.brake.node.hidden=prefs.mode!=='switch'||!pointing;
      rows.look.node.hidden=rows.hold.node.hidden=prefs.mode!=='look';lookNote.hidden=prefs.mode!=='look'||!lookNote.textContent;rows.flip.node.hidden=!cameraGame&&(prefs.mode!=='look'||prefs.look==='pointer');cal.hidden=prefs.mode!=='look'||prefs.look==='pointer';
    }
    function change(id,v,user){
      if(locked()){paintRows();return;}
      if(id==='flip'){try{if(v==='on')localStorage.setItem(FLIP,'1');else localStorage.removeItem(FLIP);}catch(_){}paintRows();return;}
      prefs[id]=typeof CHOICES[id][0]==='number'?+v:v;if(id==='look')keptLook=null;save();paintRows();
      if(prefs.mode!=='off'||engine)ensure(e=>e.set(user));
    }
    // access.js, once: it hands back the engine, which keeps reading these prefs.
    let loading=null;
    function ensure(then){
      if(engine){then(engine);return;}
      loading=loading||new Promise((done,fail)=>{const n=document.createElement('script');n.src=new URL('./access.js?v=7317f8e2',here).href;n.onload=()=>window.MinimalAccessEngine?done():fail();n.onerror=fail;document.head.append(n);});
      loading.then(()=>{loadNote.hidden=true;engine=engine||window.MinimalAccessEngine({config,prefs,save,paintRows,completionNodes,nexts,spot,place,here,SPEEDS,exact});then(engine);},()=>{loading=null;loadNote.hidden=false;document.body.dataset.accessError='load';});
    }
    paintRows();
    if(prefs.mode!=='off')requestAnimationFrame(()=>ensure(e=>e.set(false)));

  }
  if(!apply()){
    observer=new MutationObserver(()=>{if(apply())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    // A failed game boot must not leave a whole-playfield observer behind.
    setTimeout(()=>observer?.disconnect(),30000);
  }
})();
