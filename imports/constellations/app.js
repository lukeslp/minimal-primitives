/* Constellations. Luke Steuber. All play and persistence stay on this device. */
(() => {
 'use strict';
 const E=Constellations,B=ConstellationBoards,$=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg',KEY='constellations.v2',OLD='constellations.v1';
 const icons={restart:'M4 10a8 8 0 1 1 1 8M4 4v6h6',undo:'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',hint:'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z',next:'M5 12h14M13 6l6 6-6 6',replay:'M4 11V9a3 3 0 0 1 3-3h12m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H5m3 3-3-3 3-3',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',help:'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2',close:'M6 6l12 12M18 6 6 18'};
 const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+icons[name]+'"/></svg>';
 for(const [id,name]of[['restart-btn','restart'],['undo-btn','undo'],['hint-btn','hint'],['next-btn','next'],['settings-btn','settings'],['help-btn','help']])$(id).innerHTML=icon(name);
 document.querySelectorAll('.close').forEach(n=>n.innerHTML=icon('close'));
 const clone=value=>JSON.parse(JSON.stringify(value));
 // The game is always night. Older saves carry theme and Twinkle settings; they still load, the theme reads as dark and Twinkle is kept.
 let blocked=false,warning='',store={version:1,revision:2,current:B[0].id,records:{},completed:[],settings:{theme:'dark',motion:'system'}};
 function recordValid(p,r){return r&&E.stateValid(p,r.weights)&&Array.isArray(r.locks)&&r.locks.length===r.weights.length&&r.locks.every(v=>typeof v==='boolean')&&Array.isArray(r.undo)&&r.undo.length<=200&&r.undo.every(m=>E.stateValid(p,m.weights)&&Array.isArray(m.locks)&&m.locks.length===r.weights.length&&m.locks.every(v=>typeof v==='boolean'));}
 // The twelve boards became real constellations with version 2. Progress on the old boards cannot carry over, so an
 // old save is copied into recovery (and then removed once the copy reads back) and play starts clean.
 try{const old=localStorage.getItem(OLD);if(old!==null){const recovery=OLD+'.recovery.'+Date.now()+'.'+crypto.randomUUID();localStorage.setItem(recovery,old);if(localStorage.getItem(recovery)===old)localStorage.removeItem(OLD);}}catch(_){}
 try {
  const raw=localStorage.getItem(KEY);
  if(raw!==null){
   try {
    const v=JSON.parse(raw);
    if(!v||v.version!==1||!B.some(p=>p.id===v.current)||!v.records||typeof v.records!=='object'||Array.isArray(v.records)||!Array.isArray(v.completed)||!v.completed.every(id=>B.some(p=>p.id===id))||!['system','dark','light'].includes(v.settings?.theme)||!(v.settings.motion===undefined||['system','still'].includes(v.settings.motion))||!(v.settings.twinkle===undefined||typeof v.settings.twinkle==='boolean')||Object.entries(v.records).some(([id,r])=>!B.some(p=>p.id===id&&recordValid(p,r))))throw Error('Unreadable save');
    store=v;store.settings.theme='dark';store.settings.motion??='system';
    // Revision 2 doubled Canis Minor's one line, so each of its stars needs two threads. Threads saved on it before
    // then belong to the old board and would open half-done, so that record goes and the board opens empty; its
    // completed mark stays, since the player did finish it. Every other board and record loads as saved.
    if(store.revision!==2){delete store.records['canis-minor'];store.revision=2;}
   }catch(_){
    try{const recovery=KEY+'.recovery.'+Date.now()+'.'+crypto.randomUUID();localStorage.setItem(recovery,raw);if(localStorage.getItem(recovery)!==raw)throw Error();warning='An unreadable save was kept in recovery.';}
    catch(_){blocked=true;warning='The unreadable save is protected. This session will not replace it.';}
   }
  }
 }catch(_){blocked=true;warning='Storage is unavailable. You can play without saving.';}
 let p,t,s,layout,paths=[],buttons=[],drag=null,preview=null,hover=null,refused=new Set(),refusalTimer,keyboard=false,finishTimer=null,wasSolved=false;
 // Drawing geometry in board pixels, set by fit(): disc radius, tick reach, tick and thread widths,
 // where threads stop short of a disc, the gap between double threads, the selection ring and the painted reach.
 let G={R:7,reach:13.3,tick:1.75,thread:2,trim:12,offset:2.5,ring:17.3,outer:24},bearings=[],spokes=[],colors=null,fieldKey='';
 // Each star's disc follows its brightness a little: its radius, its ticks' reach and where threads stop short of it.
 let radii=[];const reachOf=i=>radii[i]*1.9,trimOf=i=>radii[i]+Math.max(5,radii[i]*.55);
 // Every route's handle: its place on the route (board pixels), arc length and direction there.
 let handles=[],arcs=[];
 function fresh(p){const weights=E.topology(p).edges.map(()=>0);return{weights,locks:weights.map(()=>false),undo:[],selected:null,focus:0,hint:null};}
 function say(message){$('status').textContent=message;}
 function save(){
  store.current=p.id;store.records[p.id]={weights:s.weights.slice(),locks:s.locks.slice(),undo:clone(s.undo)};
  if(blocked)return;
  try{localStorage.setItem(KEY,JSON.stringify(store));}catch(_){blocked=true;warning='Storage is unavailable. You can keep playing without saving.';say(warning);}
 }
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
 function still(){return reducedMotion.matches||store.settings.motion==='still';}
 function prefs(){
  document.documentElement.dataset.motion=still()?'still':'full';$('motion').value=store.settings.motion;
  if(still()&&finishTimer!==null)finish();
  night.still(still());
 }
 // finale: true from the solve that finished the last open board until another board opens.
 let finale=false;
 const allDone=()=>B.every(b=>store.completed.includes(b.id));
 // The end: every board finished, shown on the last board, or on the one whose solve finished them all.
 const ending=()=>E.inspect(p,s.weights).solved&&allDone()&&(finale||B.indexOf(p)===B.length-1);
 const endLine=()=>`All ${B.length} boards solved.`;
 // At the end one line shows under the name, and the arrow becomes Replay.
 function endShown(){
  const end=!$('next-btn').hidden&&ending(),kind=end?'replay':'next',nb=$('next-btn');
  $('end-line').hidden=!end;$('end-line').textContent=end?endLine():'';
  if(nb.dataset.kind!==kind){nb.dataset.kind=kind;nb.innerHTML=icon(kind);}
  nb.setAttribute('aria-label',ending()?'Replay from board 1':'Next board');
 }
 // Next is already showing: it comes at the solve, while the figure celebrates, and focus stays where it was.
 function finish(){
  clearTimeout(finishTimer);finishTimer=null;$('board').classList.remove('celebrating');
  $('next-btn').hidden=!E.inspect(p,s.weights).solved;endShown();
 }
 function completion(solved){
  if(solved===wasSolved)return;
  wasSolved=solved;clearTimeout(finishTimer);finishTimer=null;
  if(solved){s.selected=null;s.hint=null;cancel();if(buttons.includes(document.activeElement))document.activeElement.blur();}
  $('board').classList.toggle('solved',solved);document.documentElement.classList.toggle('night',solved);
  // The constellation's name appears only once its figure is complete, so the shape is found, not announced.
  $('sky-name').textContent=solved?p.name:'';$('sky-name').hidden=!solved;$('board').classList.remove('celebrating');$('next-btn').hidden=!solved;endShown();
  if(solved){if(still()||document.hidden)finish();else{$('board').classList.add('celebrating');finishTimer=setTimeout(finish,1200);}}
 }
 function finishedStars(report){
  const errors=new Set(report.errors.flatMap(error=>error.stars));
  return new Set(report.groups.filter(group=>group.every(i=>report.degrees[i]===p.stars[i].need&&!errors.has(i))).flat());
 }
 function point(i){return layout.point(i);}
 // Where a star sits on the board, in thirds across and down, so a screen reader can find it: "top left", "center".
 function place(i){
  const xs=p.stars.map(a=>a.x),ys=p.stars.map(a=>a.y),a=p.stars[i],third=(v,lo,hi)=>hi-lo<1e-9?1:Math.min(2,Math.floor((v-lo)/(hi-lo)*3));
  const v=['top','middle','bottom'][third(a.y,Math.min(...ys),Math.max(...ys))],h=['left','center','right'][third(a.x,Math.min(...xs),Math.max(...xs))];
  return v==='middle'?h:h==='center'?v:v+' '+h;
 }
 const starName=i=>`star ${i+1}, ${place(i)}`;
 // A star over its need is named in the announcement, as its own label names it.
 function overMessage(r){
  const over=r.degrees.flatMap((d,i)=>d>p.stars[i].need?[i]:[]);
  return 'Too many connections: '+over.map(i=>`${starName(i)}, has ${r.degrees[i]} of ${p.stars[i].need}`).join('; ')+'.';
 }
 const f2=v=>(+v).toFixed(2),apart=(a,b)=>{const d=Math.abs(a-b)%360;return Math.min(d,360-d);};

 // ---- Stars ----
 // The bearing at which a route leaves a star, read where the star's ticks end.
 function bearing(i,e){
  const points=t.edges[e].a===i?paths[e]:paths[e].slice().reverse(),c=points[0];let q=points.at(-1);
  for(const a of points)if(Math.hypot(a.x-c.x,a.y-c.y)>=reachOf(i)){q=a;break;}
  return(Math.atan2(q.y-c.y,q.x-c.x)*180/Math.PI+360)%360;
 }
 // A star's ticks sit at even angles, turned as far as they go from every route the star has; a tie points one tick up.
 function spread(n,routes){
  const step=360/n;let best=null;
  for(let h=0;h<step;h+=.25){
   const angles=Array.from({length:n},(_,k)=>(h+k*step)%360),clear=routes.length?Math.min(...angles.flatMap(a=>routes.map(r=>apart(a,r)))):180,up=Math.min(...angles.map(a=>apart(a,270)));
   if(!best||clear>best.clear+1e-6||Math.abs(clear-best.clear)<=1e-6&&up<best.up-1e-6)best={clear,up,angles};
  }
  return best.angles;
 }
 // Each arriving thread spends the tick nearest its own bearing; a star with its need, or more, keeps none.
 function spent(i,need,degree){
  const met=Array(need).fill(degree>=need);
  if(degree===0||degree>=need)return met;
  const units=[],pairs=[],used=new Set();
  for(const e of t.adj[i])for(let w=0;w<s.weights[e];w++)units.push(bearings[i].get(e));
  units.forEach((u,j)=>spokes[i].forEach((a,k)=>pairs.push({j,k,d:apart(u,a)})));
  pairs.sort((x,y)=>x.d-y.d||x.k-y.k||x.j-y.j);
  for(const q of pairs)if(!used.has(q.j)&&!met[q.k]){met[q.k]=true;used.add(q.j);}
  return met;
 }
 function paintStar(i,target){
  const c=target/2,R=radii[i],reach=reachOf(i),box=Math.min(c-1,reach+7),at=`cx="${f2(c)}" cy="${f2(c)}"`;
  const ticks=spokes[i].map(a=>{const r=a*Math.PI/180,x=Math.cos(r),y=Math.sin(r);return `<line class="tick" x1="${f2(c+x*(R-.5))}" y1="${f2(c+y*(R-.5))}" x2="${f2(c+x*reach)}" y2="${f2(c+y*reach)}"/>`;}).join('');
  return `<svg viewBox="0 0 ${f2(target)} ${f2(target)}" aria-hidden="true"><rect class="focus-mark" x="${f2(c-box)}" y="${f2(c-box)}" width="${f2(2*box)}" height="${f2(2*box)}"/><circle class="state-ring" ${at} r="${f2(Math.min(c-1,reach+4))}"/><g class="ticks">${ticks}</g><circle class="over-ring" ${at} r="${f2(R+2.25)}"/><circle class="disc" ${at} r="${f2(R)}"/></svg>`;
 }
 function tint(node,c){const color=c?c.color:'',delay=c?c.delay+'ms':'';if(node.style.getPropertyValue('--c')!==color){if(c){node.style.setProperty('--c',color);node.style.setProperty('--d',delay);}else{node.style.removeProperty('--c');node.style.removeProperty('--d');}}}

 // ---- The solve's colors ----
 // Slant's four solve colors, all at least 4.4:1 against black.
 const SOLVE=['#1768ff','#ffe000','#ed6500','#da5cce'];
 // How far apart each pair reads: the lesser OKLab distance under normal vision and simulated deuteranopia,
 // plus their grayscale lightness gap. Orange and magenta share a gray; blue and magenta are close for deuteranopia.
 const APART=[[0,.89,.48,.27],[.89,0,.49,.62],[.48,.49,0,.23],[.27,.62,.23,0]];
 function solveColors(report){
  const groups=report.groups.map(g=>g.slice().sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]),n=groups.length;
  const gap=groups.map(a=>groups.map(b=>{let d=Infinity;if(a!==b)for(const i of a)for(const j of b)d=Math.min(d,Math.hypot(p.stars[i].x-p.stars[j].x,p.stars[i].y-p.stars[j].y));return d;}));
  const weight=(i,j,a,b)=>1/(gap[i][j]*gap[i][j]*(a===b?.05:APART[a][b]));
  let pick=[];
  if(n<=SOLVE.length){
   const all=[];(function walk(c){if(c.length===n){all.push(c.slice());return;}for(let k=0;k<SOLVE.length;k++)if(!c.includes(k)){c.push(k);walk(c);c.pop();}})([]);
   // Groups within two cells of each other must read well apart, or failing that groups within a diagonal step.
   // Among the choices that allow it the board's own seed picks one, so boards differ; otherwise the least
   // confusable choice wins.
   let fair=[];
   for(const reach of [2,1.5]){fair=all.filter(c=>{for(let i=0;i<n;i++)for(let j=0;j<i;j++)if(gap[i][j]<=reach&&APART[c[i]][c[j]]<.45)return false;return true;});if(fair.length)break;}
   const cost=c=>{let sum=0;for(let i=0;i<n;i++)for(let j=0;j<i;j++)sum+=weight(i,j,c[i],c[j]);return sum;};
   pick=fair.length?fair[Math.floor(ConstellationSky.randomFor('colors:'+p.id)()*fair.length)]:all.reduce((a,b)=>cost(b)<cost(a)?b:a);
  }else for(let i=0;i<n;i++){
   // More groups than colors: each takes the color whose nearest groups already wearing it, or a lookalike, are farthest.
   let best=0,score=Infinity;
   for(let k=0;k<SOLVE.length;k++){let sum=0;for(let j=0;j<i;j++)sum+=weight(i,j,k,pick[j]);if(sum<score-1e-12){score=sum;best=k;}}
   pick[i]=best;
  }
  const out=p.stars.map(()=>null);
  groups.forEach((g,k)=>{for(const i of g)out[i]={color:SOLVE[pick[k]],delay:150*k};});
  return out;
 }

 // ---- Routes and threads ----
 // Every possible route is drawn from the start as a dotted line with a handle at its middle: an open ring for no
 // thread, one dot for one, two dots across the doubled line for two. A route crossing a thread is blocked: its
 // handle becomes a small cross and its dots break where the thread passes. The layer is kept in step by key, so
 // a thread that changes state keeps its element and can ease to its new color.
 const HANDLE=5,REACH=22;
 // The points of a route between two arc lengths.
 function slice(e,from,to){
  const P=paths[e],L=arcs[e],at=d=>{let i=1;while(i<L.length-1&&L[i]<d)i++;const f=(d-L[i-1])/(L[i]-L[i-1]||1);return{x:P[i-1].x+(P[i].x-P[i-1].x)*f,y:P[i-1].y+(P[i].y-P[i-1].y)*f};};
  return[at(from),...P.filter((_,i)=>L[i]>from&&L[i]<to),at(to)];
 }
 // Where on a route (arc length) it passes nearest a point.
 function nearestArc(e,q){let best=0,d=Infinity;paths[e].forEach((a,i)=>{const h=Math.hypot(a.x-q.x,a.y-q.y);if(h<d){d=h;best=arcs[e][i];}});return best;}
 const barred=e=>!s.weights[e]&&t.cross[e].some(f=>s.weights[f]);
 // Where two crossing routes meet, on the board.
 function crossingPoint(e,f){const A=point(t.edges[e].a),Z=point(t.edges[e].b),C=point(t.edges[f].a),D=point(t.edges[f].b),r={x:Z.x-A.x,y:Z.y-A.y},q={x:D.x-C.x,y:D.y-C.y},den=r.x*q.y-r.y*q.x||1,u=((C.x-A.x)*q.y-(C.y-A.y)*q.x)/den;return{x:A.x+r.x*u,y:A.y+r.y*u};}
 // The arc lengths along a route where its threads start and stop, short of each star's disc.
 const ends=e=>[trimOf(t.edges[e].a),arcs[e].at(-1)-trimOf(t.edges[e].b)];
 function drawThreads(report){
  const want=[],add=(key,tag,attrs)=>want.push({key,tag,attrs}),solved=report.solved,complete=finishedStars(report);
  const route=(e,count,key,classes,style='')=>{const [from,to]=ends(e),points=slice(e,from,Math.max(from+1,to));(count===2?[-G.offset,G.offset]:[0]).forEach((o,k)=>add(key+e+'.'+k+'.'+count,'path',{d:layout.path(points,o),'data-edge':e,class:'thread '+classes+(count===2?' double':''),style}));};
  const hue=e=>{const c=colors?.[t.edges[e].a];return c?`--c:${c.color};--d:${c.delay}ms`:'';};
  const tone=e=>complete.has(t.edges[e].a)?' complete':'';
  if(!solved){
   // The routes of the star being dragged from, chosen or focused by keyboard, and a route under the mouse, read brighter.
   const from=new Set([s.selected,drag?.source,keyMode&&buttons[s.focus]===document.activeElement?s.focus:null].filter(i=>Number.isInteger(i))),lit=new Set([...from].flatMap(i=>t.adj[i]));
   if(hover!==null)lit.add(hover);
   for(let e=0;e<t.edges.length;e++){
    if(s.weights[e])continue;
    const shut=barred(e),gaps=shut?[...t.cross[e].filter(f=>s.weights[f]).map(f=>nearestArc(e,crossingPoint(e,f))),handles[e].s].sort((x,y)=>x-y):[];
    const [start,stop]=ends(e);let from=start,k=0;
    for(const g of [...gaps,stop+HANDLE+3]){const to=Math.min(g-HANDLE-3,stop);if(to-from>2)add('r'+e+'.'+k++,'path',{d:layout.path(slice(e,from,to)),'data-edge':e,class:'route'+(lit.has(e)?' lit':'')+(shut?' blocked':'')});from=Math.max(from,g+HANDLE+3);}
   }
  }
  const crossing=new Set(report.errors.filter(v=>v.rule==='crossing').flatMap(v=>v.edges));
  // A press that will clear a route fades its threads until release, so the coming removal shows before it happens.
  const leaving=preview?.edge!==undefined&&!s.locks[preview.edge]&&!nextCount(preview.edge)?preview.edge:null;
  s.weights.forEach((v,e)=>{if(v)route(e,v,'w',tone(e)+(crossing.has(e)?' crossing':'')+(s.locks[e]?' locked':'')+(e===leaving?' leaving':''),hue(e));});
  if(s.hint?.edge!==undefined&&!solved)route(s.hint.edge,s.hint.count,'n','hint-line');
  if(preview?.edge!==undefined&&!s.locks[preview.edge]){const value=nextCount(preview.edge);route(preview.edge,value||s.weights[preview.edge],'p','pending'+(!value?' removing':''));}
  const x=Math.max(4,G.R*.7);
  for(const e of crossing)for(const f of t.cross[e])if(f<e&&crossing.has(f)){const at=crossingPoint(e,f);add('x'+e+'.'+f,'path',{d:`M${f2(at.x-x)} ${f2(at.y-x)}l${f2(2*x)} ${f2(2*x)}m0 ${f2(-2*x)}l${f2(-2*x)} ${f2(2*x)}`,class:'cross-mark'});}
  if(!solved)for(let e=0;e<t.edges.length;e++){
   // The handle tells the route's count by shape; a lock adds a bar on each side of it, across the thread.
   const h=handles[e],v=s.weights[e],nx=-h.ty,ny=h.tx,c=f2(h.x),d=f2(h.y);
   if(!v&&barred(e)){const q=HANDLE*.7;add('k'+e,'path',{d:`M${f2(h.x-q)} ${f2(h.y-q)}l${f2(2*q)} ${f2(2*q)}m0 ${f2(-2*q)}l${f2(-2*q)} ${f2(2*q)}`,'data-edge':e,class:'handle blocked'});continue;}
   if(!v){add('k'+e,'circle',{cx:c,cy:d,r:HANDLE,'data-edge':e,class:'handle open'+(hover===e||drag?.edge===e?' lit':'')});continue;}
   if(v===1)add('k'+e,'circle',{cx:c,cy:d,r:HANDLE*.8,'data-edge':e,class:'handle one'+tone(e)});
   else{const o=G.offset+1.1;add('k'+e,'circle',{cx:f2(h.x-nx*o),cy:f2(h.y-ny*o),r:HANDLE*.62,'data-edge':e,class:'handle two'+tone(e)});add('k'+e+'.b','circle',{cx:f2(h.x+nx*o),cy:f2(h.y+ny*o),r:HANDLE*.62,'data-edge':e,class:'handle two'+tone(e)});}
   if(s.locks[e]){const len=(v===2?G.offset:0)+G.R*.7;for(const side of [-1,1]){const bx=h.x+h.tx*side*(HANDLE+4),by=h.y+h.ty*side*(HANDLE+4);add('l'+e+'.'+side,'path',{d:`M${f2(bx-nx*len)} ${f2(by-ny*len)}L${f2(bx+nx*len)} ${f2(by+ny*len)}`,class:'lock-mark'+tone(e)});}}
  }
  if(preview?.invalid&&Number.isInteger(drag?.source)){
   const A=point(drag.source),r=$('board').getBoundingClientRect(),px=drag.lastX-r.left,py=drag.lastY-r.top;
   add('i0','line',{x1:f2(A.x),y1:f2(A.y),x2:f2(px),y2:f2(py),class:'thread pending removing'});
   add('i1','path',{d:`M${f2(px-x)} ${f2(py-x)}l${f2(2*x)} ${f2(2*x)}m0 ${f2(-2*x)}l${f2(-2*x)} ${f2(2*x)}`,class:'cross-mark'});
  }
  const layer=$('threads'),keys=new Set(want.map(w=>w.key)),have=new Map();
  for(const n of [...layer.children]){if(keys.has(n.dataset.key)&&!have.has(n.dataset.key))have.set(n.dataset.key,n);else n.remove();}
  want.forEach((w,k)=>{
   let n=have.get(w.key);
   if(n&&n.tagName!==w.tag){n.remove();n=null;}
   if(!n){n=document.createElementNS(NS,w.tag);n.dataset.key=w.key;}
   for(const [name,value]of Object.entries(w.attrs))if(n.getAttribute(name)!==String(value))n.setAttribute(name,value);
   if(layer.children[k]!==n)layer.insertBefore(n,layer.children[k]||null);
  });
 }

 // ---- The night sky ----
 // At the solve a starfield fills the screen behind the finished figure (starfield.js). It thins toward the
 // playable stars, the threads, the readout, the toolbar and the arrow so they read first.
 // The center of the 64 px Next disc, worked out as the control frame (controls.js) places it: in the gap
 // between the board and the toolbar when the gap holds it, else on the toolbar's row; beside the board in
 // short landscape. The frame only moves the disc as it appears, after the sky is drawn.
 function arrowSpot(b){
  const size=64,clear=size+16,tools=[...document.querySelectorAll('.toolbar button')].filter(n=>n.offsetParent!==null).map(n=>n.getBoundingClientRect());
  const center=c=>innerHeight-Math.max(6,Math.round(innerHeight-c-size/2))-size/2,side=matchMedia('(max-height:520px) and (min-width:560px)').matches;
  if(!tools.length)return{x:innerWidth/2,y:innerHeight-(side?12:64)-size/2};
  if(side){const room=Math.min(...tools.map(r=>r.left))-b.right,x=room>=clear?b.right+room/2:b.left>=clear?b.left/2:null;return x===null?{x:innerWidth/2,y:innerHeight-12-size/2}:{x:Math.round(x),y:center((Math.max(0,b.top)+Math.min(innerHeight,b.bottom))/2)};}
  const top=Math.min(...tools.map(r=>r.top)),row=(top+Math.max(...tools.map(r=>r.bottom)))/2,gap=top-b.bottom;
  return{x:innerWidth/2,y:center(gap>=clear?b.bottom+gap/2:row)};
 }
 const skyCanvas=document.createElement('canvas');skyCanvas.id='field';skyCanvas.setAttribute('aria-hidden','true');
 const night=ConstellationStarfield.create(skyCanvas);
 // revealed: whether this solve's sky has already been shown, so a resize redraws it without playing it in again.
 let revealed=false;
 function field(){
  if(!wasSolved){if(night.shown)night.hide();skyCanvas.remove();fieldKey='';revealed=false;return;}
  const W=innerWidth,H=innerHeight,board=$('board').getBoundingClientRect(),arrow=arrowSpot(board),boxes=[{l:arrow.x-44,t:arrow.y-44,r:arrow.x+44,b:arrow.y+44}];
  for(const n of document.querySelectorAll('#restart-btn,#readout,#sky-name,#end-line,.toolbar button')){const r=n.getBoundingClientRect();if(r.width)boxes.push({l:r.left,t:r.top,r:r.right,b:r.bottom});}
  const key=[p.id,W,H,devicePixelRatio,Math.round(board.left),Math.round(board.top),Math.round(board.width),...boxes.flatMap(k=>[k.l,k.t].map(Math.round))].join(' ');
  if(night.shown&&key===fieldKey)return;
  fieldKey=key;
  const discs=p.stars.map((_,i)=>{const a=point(i);return{x:board.left+a.x,y:board.top+a.y,r:radii[i]};});
  const lines=s.weights.flatMap((w,e)=>w?[paths[e].map(a=>({x:board.left+a.x,y:board.top+a.y}))]:[]);
  if(!skyCanvas.isConnected)document.body.prepend(skyCanvas);
  // The real sky goes through the board's own projection: its center, and the board's origin and scale on the page.
  const zero=layout.project(0,0);
  night.show({seed:p.id,width:W,height:H,dpr:devicePixelRatio||1,center:p.sky,origin:{x:board.left+zero.x,y:board.top+zero.y},scale:layout.scale,figureStars:p.stars.map(a=>a.k),figure:{discs,lines,boxes,near:5,ramp:36},reveal:!revealed&&!still()&&!document.hidden,still:still()});
  revealed=true;
 }

 function render(){
  const report=E.inspect(p,s.weights),errors=new Set(report.errors.flatMap(v=>v.stars)),complete=finishedStars(report);
  const hinted=new Set(s.hint?.fix?s.hint.fix.stars:s.hint?.edge!==undefined?[t.edges[s.hint.edge].a,t.edges[s.hint.edge].b]:s.hint?.error?.stars||[]),target=parseFloat($('board').style.getPropertyValue('--target'));
  colors=report.solved?solveColors(report):null;
  buttons.forEach((b,i)=>{
   const a=p.stars[i],degree=report.degrees[i];
   b.className='star'+(complete.has(i)?' complete':'')+(degree===a.need?' satisfied':'')+(degree>a.need?' overfull':'')+(s.selected===i?' selected':'')+(errors.has(i)?' conflict':'')+(hinted.has(i)?' hint-target':'')+(refused.has(i)?' refused':'');
   b.tabIndex=!report.solved&&i===s.focus?0:-1;b.setAttribute('aria-pressed',String(s.selected===i));b.setAttribute('aria-disabled',String(report.solved));b.setAttribute('aria-label',`Star ${i+1}, ${place(i)}: ${degree} of ${a.need} connections${degree>a.need?', too many':errors.has(i)?', conflict':''}`);
   const key=[target,radii[i],spokes[i].join(',')].join(':');
   if(b.dataset.paint!==key){b.dataset.paint=key;b.innerHTML=paintStar(i,target);b.ticks=[...b.querySelectorAll('.tick')];}
   const met=spent(i,a.need,degree);b.ticks.forEach((n,k)=>{if(n.classList.contains('spent')!==met[k])n.classList.toggle('spent',met[k]);});
   tint(b,colors?.[i]);
  });
  drawThreads(report);$('undo-btn').disabled=!s.undo.length;$('hint-btn').disabled=report.solved;
  completion(report.solved);
  endShown();
  $('readout').textContent=`${B.indexOf(p)+1} / ${B.length} · ${s.weights.reduce((a,b)=>a+b,0)} / ${p.stars.reduce((sum,a)=>sum+a.need,0)/2}`;
  $('readout').setAttribute('aria-label',`Board ${B.indexOf(p)+1} of ${B.length}. ${s.weights.reduce((a,b)=>a+b,0)} of ${p.stars.reduce((sum,a)=>sum+a.need,0)/2} threads. Choose board`);
  field();
 }
 function fit(){
  // The figure keeps its true shape: one scale for both axes, fitted to the stage (sky-layout.js), with each star's
  // disc following its brightness a little and every route's handle placed clear of the others.
  const r=$('stage').getBoundingClientRect(),L=ConstellationSky.fit(p,r.width,r.height);
  layout={project:L.project,point:L.point,route:L.route,path:L.path,scale:L.scale};
  radii=L.radii;const disc=L.R;
  G={R:disc,reach:disc*1.9,tick:Math.max(1.6,Math.min(2,disc*.25)),thread:2,trim:disc+Math.max(5,disc*.55),offset:Math.max(2.5,disc*.3),ring:disc*1.9+4,outer:L.outer};
  const board=$('board');board.style.setProperty('--target',L.target+'px');board.style.setProperty('--tick',f2(G.tick)+'px');board.style.setProperty('--thread',G.thread+'px');board.style.width=L.width+'px';board.style.height=L.height+'px';
  paths=t.edges.map(e=>layout.route(e));
  arcs=paths.map(P=>{const A=[0];for(let i=1;i<P.length;i++)A.push(A[i-1]+Math.hypot(P[i].x-P[i-1].x,P[i].y-P[i-1].y));return A;});
  handles=ConstellationSky.placeHandles(paths,t.edges,radii,p.id);
  bearings=p.stars.map((_,i)=>new Map(t.adj[i].map(e=>[e,bearing(i,e)])));
  spokes=p.stars.map((a,i)=>spread(a.need,[...bearings[i].values()]));
  buttons.forEach((b,i)=>{const a=point(i);b.style.left=a.x+'px';b.style.top=a.y+'px';});render();
 }
 function load(id){
  cancel();clearTimeout(refusalTimer);refused.clear();clearTimeout(finishTimer);finishTimer=null;wasSolved=false;finale=false;document.documentElement.classList.remove('night');$('board').classList.remove('solved','celebrating');$('next-btn').hidden=true;$('end-line').hidden=true;$('sky-name').hidden=true;$('sky-name').textContent='';if(p)save();p=B.find(b=>b.id===id)||B[0];t=E.topology(p);s=fresh(p);
  if(store.records[p.id])Object.assign(s,clone(store.records[p.id]));
  $('stars').replaceChildren();$('threads').replaceChildren();buttons=p.stars.map((a,i)=>{const b=document.createElement('button');b.type='button';b.className='star';b.dataset.star=i;b.addEventListener('focus',()=>s.focus=i);$('stars').append(b);return b;});
  store.current=p.id;prefs();fit();save();
 }
 function snapshot(){return{weights:s.weights.slice(),locks:s.locks.slice()};}
 function commit(edge,value){
  if(!Number.isInteger(edge)||!t.edges[edge]||!Number.isInteger(value)||value<0||value>2||s.weights[edge]===value||E.inspect(p,s.weights).solved)return;
  if(s.locks[edge]){refuse([t.edges[edge].a,t.edges[edge].b],'This thread is locked. Hold it to unlock.');return;}
  const before=s.weights[edge];s.undo.push(snapshot());if(s.undo.length>200)s.undo.shift();s.weights[edge]=value;s.selected=null;s.hint=null;preview=null;hover=null;
  const r=E.inspect(p,s.weights);if(r.solved){if(!store.completed.includes(p.id)){store.completed.push(p.id);if(allDone())finale=true;}say(`Complete: ${p.name}.`+(ending()?' '+endLine():''));}else if(r.errors.length)say(r.errors[0].rule==='crossing'?'Threads cross. Undo or clear a thread.':overMessage(r));else say(moveMessage(before,value));
  render();save();
 }
 // What a change did to its route, then the board's total as the readout counts it, so the number said is never
 // the route's count standing in for the board's.
 function moveMessage(before,value){
  const what=value>before?'Thread added.':before-value===2?'Both threads removed.':'Thread removed.',hits=s.weights.reduce((a,b)=>a+b,0),par=p.stars.reduce((sum,a)=>sum+a.need,0)/2;
  return `${what} ${hits} of ${par} threads.`;
 }
 // What the next tap, drag or key on a route makes of it: none, one, two, none again. A second thread goes on only
 // while both stars still have a tick for it; otherwise the tap clears the route, so a second tap never overfills a star.
 function nextCount(e){
  const n=(s.weights[e]+1)%3;if(n!==2)return n;
  const full=i=>t.adj[i].reduce((sum,f)=>sum+s.weights[f],0)>=p.stars[i].need;
  return full(t.edges[e].a)||full(t.edges[e].b)?0:2;
 }
 // A route crossing a thread cannot be used; trying it is refused like any other refused move.
 function cycle(e){if(!t.edges[e])return;if(barred(e)&&!E.inspect(p,s.weights).solved){refuse([t.edges[e].a,t.edges[e].b],'That route crosses a thread.');return;}commit(e,nextCount(e));}
 function refuse(stars,message){refused=new Set(stars);clearTimeout(refusalTimer);render();say(message);refusalTimer=setTimeout(()=>{refused.clear();render();},650);}
 function pair(a,b){const e=t.edges.findIndex(e=>e.a===a&&e.b===b||e.a===b&&e.b===a);if(e<0){refuse([a,b],'Choose one of this star’s visible paths.');return;}cycle(e);}
 function tap(i){if(E.inspect(p,s.weights).solved)return;if(s.selected===null){s.selected=i;s.hint=null;render();}else if(s.selected===i){s.selected=null;render();}else pair(s.selected,i);}
 function undo(){cancel();const previous=s.undo.pop();if(previous){Object.assign(s,previous);s.selected=null;s.hint=null;render();save();say('Undone.');}}
 function lock(e){if(!s.weights[e])return;s.undo.push(snapshot());if(s.undo.length>200)s.undo.shift();s.locks[e]=!s.locks[e];render();save();say(s.locks[e]?'Thread locked.':'Thread unlocked.');}
 // Hint: the first press marks the next step and says why. Pressing again while that same step still stands plays
 // it as one move, through the path a tap takes: one thread onto a route the needs force, or one thread off a route
 // that has too many. Any change to the board clears a showing hint, so the next press shows the next step.
 function hintPress(){
  cancel();if(E.inspect(p,s.weights).solved)return;
  const next=E.hint(p,s.weights,s.locks),step=h=>h?(h.error?h.fix:h):null,was=step(s.hint),now=step(next);
  if(was&&now&&!!s.hint.error===!!next.error&&was.edge===now.edge&&was.count===now.count){if(next.error)commit(now.edge,s.weights[now.edge]-1);else cycle(now.edge);return;}
  s.hint=next;
  if(!next)say('No step follows from the stars’ needs yet.');
  else if(next.fix){const why={degree:'a star has too many threads',crossing:'threads cross'}[next.error.rule]||'the stars’ needs rule it out';say(`One thread between the marked stars has to go: ${why}.${s.locks[next.fix.edge]?' It is locked; hold it to unlock.':' Press Hint again to take it off.'}`);}
  else if(next.error){refuse(next.error.stars,'These marks conflict. Try Undo.');return;}
  else say(`This route needs ${next.count} ${next.count===1?'thread':'threads'}. The marked star’s need forces it.${s.locks[next.edge]?' It is locked; hold it to unlock.':' Press Hint again to add one.'}`);
  render();
 }
 function cancel(){if(drag)clearTimeout(drag.timer);drag=null;preview=null;hover=null;}
 const shows=e=>!barred(e)&&!s.locks[e];
 function pickStar(x,y){const r=$('board').getBoundingClientRect();let best=-1,distance=buttons[0].offsetWidth/2;for(let i=0;i<p.stars.length;i++){const a=point(i),d=Math.hypot(x-r.left-a.x,y-r.top-a.y);if(d<=distance){distance=d;best=i;}}return best;}
 function pickEdge(x,y){
  const r=$('board').getBoundingClientRect(),hits=[];
  if(x<r.left||x>r.right||y<r.top||y>r.bottom||pickStar(x,y)>=0)return null;
  paths.forEach((points,e)=>{
   let closest=Infinity;
   for(let i=1;i<points.length;i++){const A=points[i-1],Z=points[i],dx=Z.x-A.x,dy=Z.y-A.y,ratio=Math.max(0,Math.min(1,((x-r.left-A.x)*dx+(y-r.top-A.y)*dy)/(dx*dx+dy*dy)));closest=Math.min(closest,Math.hypot(x-r.left-A.x-ratio*dx,y-r.top-A.y-ratio*dy));}
   if(closest<=18)hits.push({e,d:closest});
  });
  hits.sort((a,b)=>a.d-b.d);return hits.length&&(!hits[1]||hits[1].d-hits[0].d>=8)?hits[0].e:null;
 }
 // What a press lands on: a star or a route's handle, whichever center is nearer (a star within its target,
 // a handle within 22 px), else a route's line.
 function pickDown(x,y){
  const r=$('board').getBoundingClientRect(),i=pickStar(x,y);let edge=null,d=REACH;
  handles.forEach((h,e)=>{const g=Math.hypot(x-r.left-h.x,y-r.top-h.y);if(g<=d){d=g;edge=e;}});
  if(edge!==null&&(i<0||d<Math.hypot(x-r.left-point(i).x,y-r.top-point(i).y)))return{edge};
  if(i>=0)return{star:i};
  const line=pickEdge(x,y);return line===null?null:{edge:line};
 }
 const board=$('board');
 board.addEventListener('pointerdown',e=>{
  if(!e.isPrimary){cancel();render();return;}if(e.button!==0||E.inspect(p,s.weights).solved)return;
  const hit=pickDown(e.clientX,e.clientY),source=hit?.star??-1,edge=hit?.edge??null;
  if(source<0&&edge===null){s.selected=null;render();return;}
  cancel();keyboard=false;drag={id:e.pointerId,source:source<0?null:source,edge,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,target:source,held:false};
  if(source>=0){s.focus=source;buttons[source].focus({preventScroll:true});}
  // Past the lock threshold release locks (or does nothing on an empty route), so the add/clear preview goes.
  if(edge!==null)drag.timer=setTimeout(()=>{if(!drag||drag.moved)return;drag.held=true;preview=null;render();},550);
  board.setPointerCapture(e.pointerId);
  // A press on a route shows at once what releasing will do: a dashed thread to add, faded threads to clear.
  // A locked thread only refuses on release, so it shows nothing.
  if(edge!==null&&shows(edge)){preview={edge};render();}
 });
 function updateDrag(e){
  if(!drag||drag.id!==e.pointerId)return;
  drag.lastX=e.clientX;drag.lastY=e.clientY;
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){drag.moved=true;clearTimeout(drag.timer);}
  if(drag.source!==null&&drag.moved){
   drag.target=pickStar(e.clientX,e.clientY);const edge=t.edges.findIndex(v=>v.a===drag.source&&v.b===drag.target||v.b===drag.source&&v.a===drag.target);
   preview=edge>=0?(s.locks[edge]?null:{edge}):{invalid:drag.target!==drag.source};
  }else if(drag.edge!==null&&!drag.moved)preview=drag.held||!shows(drag.edge)?null:{edge:drag.edge};
  else preview=null;
 }
 function end(e,cancelled=false){
  if(!drag||drag.id!==e.pointerId)return;
  if(!cancelled&&e.type==='pointerup')updateDrag(e);
  const d=drag;clearTimeout(d.timer);drag=null;preview=null;
  if(board.hasPointerCapture(e.pointerId))board.releasePointerCapture(e.pointerId);
  if(cancelled){render();return;}
  if(d.held){lock(d.edge);render();return;}
  if(d.source!==null){if(d.moved){if(d.target>=0&&d.target!==d.source)pair(d.source,d.target);else refuse([d.source],'Connection cancelled.');}else tap(d.source);}
  else if(!d.moved&&pickDown(e.clientX,e.clientY)?.edge===d.edge)cycle(d.edge);
  render();
 }
 board.addEventListener('pointermove',e=>{
  if(drag){updateDrag(e);if(e.pointerType==='mouse'&&e.buttons===0){end(e);return;}render();}
  else if(e.pointerType==='mouse'){const edge=pickDown(e.clientX,e.clientY)?.edge??null;if(hover!==edge){hover=edge;render();}}
 });
 board.addEventListener('pointerup',e=>end(e));board.addEventListener('pointercancel',e=>end(e,true));
 board.addEventListener('lostpointercapture',e=>{if(drag&&drag.id===e.pointerId)end(e,!!e.buttons);});
 board.addEventListener('pointerleave',()=>{if(!drag){hover=null;render();}});board.addEventListener('contextmenu',e=>e.preventDefault());
 // Assistive activation produces click without a preceding pointer gesture.
 board.addEventListener('click',e=>{if(e.detail===0&&e.target.closest('.star'))tap(Number(e.target.closest('.star').dataset.star));});
 // Keyboard focus draws a square around its star and shows the star's empty routes as guides. The page tracks
 // which input was used last, since a star tapped or clicked is also focused, by script.
 let keyMode=false;
 document.addEventListener('keydown',e=>{if(!keyMode&&!['Shift','Control','Alt','Meta'].includes(e.key)){keyMode=true;document.documentElement.dataset.input='keys';}},true);
 document.addEventListener('pointerdown',()=>{if(keyMode){keyMode=false;document.documentElement.dataset.input='pointer';}},true);
 for(const type of ['focusin','focusout'])$('stars').addEventListener(type,()=>{if(keyMode)requestAnimationFrame(()=>{if(p)render();});});
 document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||e.target.matches('select,input,textarea'))return;
  if(e.key.toLowerCase()==='z'){e.preventDefault();keyboard=true;undo();return;}
  // The shared frame puts the arrow after the toolbar; on a solved board a forward Tab from the top of the page goes to it first.
  if(e.key==='Tab'&&!e.shiftKey&&!$('next-btn').hidden&&(e.target===document.body||e.target.matches('#restart-btn,#readout'))){e.preventDefault();$('next-btn').focus();return;}
  if(e.target.closest('button')&&!e.target.closest('.star'))return;
  if(E.inspect(p,s.weights).solved)return;
  const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},dir=dirs[e.key],origin=p.stars[s.focus];
  if(!dir&&!['Enter',' ','Escape','Home','End','z','Z','l','L'].includes(e.key))return;
  e.preventDefault();keyboard=true;cancel();
  if(dir){
   // Shift + arrow changes the route leaving the focused star closest to the arrow's direction, within 67.5 degrees.
   if(e.shiftKey){let edge,best=Math.cos(67.5*Math.PI/180);for(const r of t.adj[s.focus]){const v=t.edges[r],a=p.stars[v.a===s.focus?v.b:v.a],dx=a.x-origin.x,dy=a.y-origin.y,c=(dx*dir[0]+dy*dir[1])/(Math.hypot(dx,dy)||1);if(c>best){best=c;edge=r;}}if(edge!==undefined)cycle(edge);else refuse([s.focus],'No star in that direction.');}
   else{let best=Infinity,next=s.focus;p.stars.forEach((a,i)=>{const dx=a.x-origin.x,dy=a.y-origin.y,forward=dx*dir[0]+dy*dir[1],side=Math.abs(dx*dir[1]-dy*dir[0]);if(forward>0&&forward+side*4<best){best=forward+side*4;next=i;}});s.focus=next;buttons[next].focus({preventScroll:true});}
  }else if(e.key==='Enter'||e.key===' ')tap(s.focus);
  else if(e.key==='Escape')s.selected=null;
  else if(e.key.toLowerCase()==='z')undo();
  else if(e.key==='Home'||e.key==='End'){s.focus=e.key==='Home'?0:buttons.length-1;buttons[s.focus].focus({preventScroll:true});}
  else if(e.key.toLowerCase()==='l'){const es=t.adj[s.focus].filter(e=>s.weights[e]);for(const edge of es)lock(edge);}
  render();
 });
 $('undo-btn').onclick=undo;
 function restart(){cancel();if(s.weights.some(Boolean)||s.locks.some(Boolean)){s.undo.push(snapshot());if(s.undo.length>200)s.undo.shift();s.weights=s.weights.map(()=>0);s.locks=s.locks.map(()=>false);}s.selected=null;s.hint=null;render();save();say('Board restarted. Undo restores it.');}
 $('restart-btn').onclick=restart;
 $('hint-btn').onclick=hintPress;
 // The board list draws each board's stars; a board shows its constellation's name only once it has been solved.
 function inventory(){
  $('boards').replaceChildren();B.forEach((b,n)=>{
   const done=store.completed.includes(b.id),xs=b.stars.map(a=>a.x),ys=b.stars.map(a=>a.y),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0||1,h=Math.max(...ys)-y0||1,k=80/Math.max(w,h),vw=w*k+20,vh=h*k+20;
   const button=document.createElement('button');button.setAttribute('aria-label',`Board ${n+1}${done?', '+b.name+', completed':''}`);button.setAttribute('aria-current',String(b.id===p.id));
   button.innerHTML='<svg viewBox="0 0 '+f2(vw)+' '+f2(vh)+'" aria-hidden="true">'+b.stars.map(a=>`<circle cx="${f2((a.x-x0)*k+10)}" cy="${f2((a.y-y0)*k+10)}" r="${f2(Math.max(2.2,4.2-.5*(a.mag??3)))}"/>`).join('')+'</svg><span></span>'+(done?'<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>':'');
   const label=button.querySelector('span');label.textContent=done?b.name:String(n+1);label.classList.toggle('named',done);
   button.onclick=()=>{load(b.id);$('settings').close();};$('boards').append(button);
  });
 }
 function openSheet(id){cancel();s.selected=null;render();if(id==='settings'){inventory();prefs();$('storage-warning').hidden=!warning;$('storage-warning').textContent=warning;}$(id).showModal();}
 $('settings-btn').onclick=() =>openSheet('settings');$('readout').onclick=()=>openSheet('settings');$('help-btn').onclick=()=>openSheet('help');
 $('motion').onchange=()=>{store.settings.motion=$('motion').value;prefs();save();};
 // Next: the following board; after the last, the first board not yet solved. When every board is solved it is
 // Replay: the boards start again from board 1, cleared, and every solved mark stays.
 function replay(){store.records={};s=fresh(p);load(B[0].id);}
 $('next-btn').onclick=()=>{if(ending()){replay();return;}const n=B.indexOf(p),open=B.find(b=>!store.completed.includes(b.id));load(n<B.length-1?B[n+1].id:(open||B[0]).id);};
 // The control frame moves the arrow's place on resize in the next frame, so the field is checked again after it.
 window.addEventListener('resize',()=>{cancel();fit();requestAnimationFrame(()=>requestAnimationFrame(field));});window.addEventListener('pagehide',save);
 document.addEventListener('visibilitychange',()=>{document.documentElement.classList.toggle('page-hidden',document.hidden);night.pause(document.hidden);if(document.hidden){cancel();if(finishTimer!==null)finish();render();save();}});
 load(store.current);
 requestAnimationFrame(()=>requestAnimationFrame(field));
 reducedMotion.addEventListener('change',prefs);
 function bounds(){const r=$('board').getBoundingClientRect();return p.stars.map((_,i)=>{const a=point(i);return{x:r.left+a.x-G.outer,y:r.top+a.y-G.outer,width:G.outer*2,height:G.outer*2};});}
 function paintedBounds(){const boxes=bounds(),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.width)),bottom=Math.max(...boxes.map(b=>b.y+b.height));return{x,y,width:right-x,height:bottom-y};}
 Object.defineProperty(window,'__constellations',{value:Object.freeze({
  get boards(){return clone(B);},get board(){return p.id;},
  get state(){const r=E.inspect(p,s.weights);return clone({weights:s.weights,degrees:r.degrees,solved:r.solved,hits:s.weights.reduce((a,b)=>a+b,0),par:p.stars.reduce((sum,a)=>sum+a.need,0)/2,groups:r.groups});},
  cycle,set:commit,undo,restart,go:load,replay,get ending(){return!$('next-btn').hidden&&ending();},get completed(){return store.completed.slice();},topology:()=>clone(t),
  sky:()=>({night:wasSolved,seed:wasSolved?p.id:'',...(night.info||{stars:0}),colors:colors?colors.map(c=>c?.color??null):null}),
  position:index=>{const a=point(index),r=$('board').getBoundingClientRect();return{x:r.left+a.x,y:r.top+a.y};},bounds,
  snapshot:()=>clone({id:p.id,weights:s.weights,locks:s.locks,undo:s.undo,selected:s.selected,focus:s.focus,report:E.inspect(p,s.weights),settings:store.settings}),
  puzzle:()=>clone(p),routes:()=>clone(paths),geometry:()=>({...G,radii:radii.slice(),spokes:clone(spokes)}),
  handles:()=>{const r=$('board').getBoundingClientRect(),solved=E.inspect(p,s.weights).solved;return handles.map((h,e)=>({edge:e,x:r.left+h.x,y:r.top+h.y,tx:h.tx,ty:h.ty,reach:REACH,state:solved?'gone':barred(e)?'blocked':['open','one','two'][s.weights[e]],locked:s.locks[e]}));}
 })});
 window.__minimalize=Object.freeze({bounds:paintedBounds});
})();
