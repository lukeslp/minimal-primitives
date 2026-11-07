/* Shared Minimal control presentation. Luke Steuber. */
(function () {
  'use strict';
  const config = {"id":"nod","bar":".toolbar","undo":"undo-btn","hint":"hint-btn","tools":["camera-btn"],"unscanned":["camera-btn"],"settings":"settings-btn","help":"help-btn","restart":"restart-btn","completion":["next-btn"],"required":["undo-btn","hint-btn"],"keys":["arrows"],"modes":["off","switch"],"avoid":["#camera-start"]};
  // Native payloads have their own release/acceptance contract.
  if (window.HEXSWEEPER_SPHERE_APP) return;
  // Where this file was loaded from; an inlined copy (a one-page build) has no
  // address, so it cannot load Access and leaves its row out on purpose.
  const here = document.currentScript && document.currentScript.src;
  const byId = id => id && document.getElementById(id);
  const cross = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const restart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  let observer;
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
    // A standalone Next sits centred in the gap between the board and the
    // toolbar when the gap holds it, otherwise centred on the toolbar's row
    // between its two groups, so it never covers the board or a control. In
    // landscape, where the toolbar stands at the side, it sits beside the board.
    const nexts=completionNodes.filter(n=>n.matches('button'));
    let spot=null,place=null;
    if(nexts.length){
      const board=document.querySelector(config.board||'#board');
      // Where the disc stands: its left (undefined for the CSS centre) and its
      // bottom, or null for the stylesheet's own place. Access reads it too, so
      // its pad keeps clear of the disc before the disc appears.
      spot=()=>{
        const size=64,clear=size+16;
        const tools=[...bar.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>b.getBoundingClientRect());
        if(!board||!tools.length)return null;
        // An SVG board is measured by what it draws, so a page-sized drawing still leaves its gap.
        let b=board.getBoundingClientRect();
        if(board instanceof SVGSVGElement)try{const box=board.getBBox(),m=board.getScreenCTM();if(m&&box.width&&box.height){const p=[new DOMPoint(box.x,box.y).matrixTransform(m),new DOMPoint(box.x+box.width,box.y+box.height).matrixTransform(m)];b={left:Math.min(p[0].x,p[1].x),right:Math.max(p[0].x,p[1].x),top:Math.min(p[0].y,p[1].y),bottom:Math.max(p[0].y,p[1].y)};}}catch(_){}
        const bottom=centre=>Math.max(6,Math.round(innerHeight-centre-size/2));
        if(matchMedia('(max-height:520px) and (min-width:560px)').matches){
          const side=Math.min(...tools.map(r=>r.left))-b.right,x=side>=clear?b.right+side/2:b.left>=clear?b.left/2:null;
          if(x===null)return null;
          return {left:Math.round(x),bottom:bottom((Math.max(0,b.top)+Math.min(innerHeight,b.bottom))/2)};
        }
        const top=Math.min(...tools.map(r=>r.top)),row=(top+Math.max(...tools.map(r=>r.bottom)))/2,gap=top-b.bottom;
        return {bottom:bottom(gap>=clear?b.bottom+gap/2:row)};
      };
      place=()=>{
        const style=document.body.style,s=spot();style.removeProperty('--control-next-left');
        if(!s){style.removeProperty('--control-next-bottom');return;}
        if(s.left!==undefined)style.setProperty('--control-next-left',s.left+'px');
        style.setProperty('--control-next-bottom',s.bottom+'px');
      };
      for(const n of nexts)new MutationObserver(()=>{if(!n.hidden)requestAnimationFrame(place);}).observe(n,{attributes:true,attributeFilter:['hidden']});
      addEventListener('resize',()=>requestAnimationFrame(place));requestAnimationFrame(place);
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
    const MODES=config.modes||['off','switch','look'],SPEEDS={slow:1600,normal:1100,fast:700},HOLDS=[600,800,1000,1400];
    const camOK=cameraAllowed(),trackOK=trackerAllowed(),pointing=config.keys.some(k=>k==='point'||k==='drag'||k.id==='point'||k.id==='drag');
    // Every choice and its first value, which is the default. Press time is
    // how long a press must last to count; release time is how long after a
    // press another is taken as a bounce. Long press takes back a step (off
    // unless chosen); rest stops the scan after so many silent passes (never
    // unless chosen).
    const CHOICES={mode:MODES,speed:['normal','slow','fast'],scan:['groups','keys'],press:[0,200,500,1000],release:[300,600,1000,1500],long:[0,1000,1500,2000],rest:[0,2,4,8],highlight:['invert','outline'],brake:['off','on'],look:camOK?['head','eyes','pointer','tracker']:['pointer','head','eyes','tracker'],hold:[800,600,1000,1400]};
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
    if(!camOK&&prefs.look!=='tracker'||prefs.look==='tracker'&&!trackOK)prefs.look='pointer';
    const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}};
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
    row0.after(row('mode','Access',MODES.map(m=>[m,names[m]])),row('speed','Speed',[['slow','Slow'],['normal','Normal'],['fast','Fast']]),
      row('scan','Scan',[['groups','Groups'],['keys','Keys']]),row('press','Press time',CHOICES.press.map(v=>[String(v),secs(v)])),
      row('release','Release time',CHOICES.release.map(v=>[String(v),secs(v)])),row('long','Long press',CHOICES.long.map(v=>[String(v),secs(v)])),
      row('rest','Rest after',[['0','Never'],['2','2 passes'],['4','4 passes'],['8','8 passes']]),row('highlight','Highlight',[['invert','Invert'],['outline','Outline']]),
      row('brake','Brake',[['off','Off'],['on','On']]),
      row('look','Look with',[['head','Head',!camOK],['eyes','Eyes',!camOK],['pointer','Pointer'],['tracker','Eye tracker',!trackOK]]),row('hold','Hold',HOLDS.map(h=>[String(h),h/1000+' s'])),row('flip','Up and down',[['off','As I move'],['on','Flipped']]),cal);
    // A clinician's lock (minimal-access.v1:locked, set by the accessible app):
    // the Access rows show their values but cannot be changed here.
    const locked=()=>{try{return localStorage.getItem('minimal-access.v1:locked')==='1';}catch(_){return false;}};
    const lockNote=document.createElement('p');lockNote.className='access-row access-locked';lockNote.dataset.access='locked';lockNote.textContent='Set by your clinician.';lockNote.hidden=true;
    rows.mode.node.before(lockNote);
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
      rows.look.node.hidden=rows.hold.node.hidden=prefs.mode!=='look';rows.flip.node.hidden=!cameraGame&&(prefs.mode!=='look'||prefs.look==='pointer');cal.hidden=prefs.mode!=='look'||prefs.look==='pointer';
    }
    function change(id,v,user){
      if(locked()){paintRows();return;}
      if(id==='flip'){try{if(v==='on')localStorage.setItem(FLIP,'1');else localStorage.removeItem(FLIP);}catch(_){}paintRows();return;}
      prefs[id]=typeof CHOICES[id][0]==='number'?+v:v;save();paintRows();
      if(prefs.mode!=='off'||engine)ensure(e=>e.set(user));
    }
    // access.js, once: it hands back the engine, which keeps reading these prefs.
    let loading=null;
    function ensure(then){
      if(engine){then(engine);return;}
      loading=loading||new Promise((done,fail)=>{const n=document.createElement('script');n.src=new URL('./access.js?v=b25ce723',here).href;n.onload=()=>window.MinimalAccessEngine?done():fail();n.onerror=fail;document.head.append(n);});
      loading.then(()=>{engine=engine||window.MinimalAccessEngine({config,prefs,save,paintRows,completionNodes,nexts,spot,place,here,SPEEDS,exact});then(engine);},()=>{loading=null;});
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
