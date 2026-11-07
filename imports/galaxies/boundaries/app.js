/* Galaxies boundary study. Luke Steuber. */
(function(){'use strict';
const E=GalaxyBoundaries,$=s=>document.querySelector(s),root=$('#board'),levels=[...E.intros,...GalaxiesLevels],saveName='galaxies.boundaries.v1',NS='http://www.w3.org/2000/svg';
let store={version:1,at:levels[0].id,boards:{},completed:[],motion:'system'},storageOK=true;
try{const raw=localStorage.getItem(saveName);if(raw){const v=JSON.parse(raw);if(v.version!==1||!levels.some(p=>p.id===v.at)||!v.boards||typeof v.boards!=='object'||!Array.isArray(v.completed)||!v.completed.every(id=>levels.some(p=>p.id===id))||!['system','reduce'].includes(v.motion)||!Object.entries(v.boards).every(([id,w])=>{const p=levels.find(p=>p.id===id);return p&&E.valid(p,w);}))throw Error('Invalid save');store=v;}}
catch(_){try{const raw=localStorage.getItem(saveName);if(raw!==null)localStorage.setItem(saveName+'.recovery.'+Date.now(),raw);}catch(_){storageOK=false;}}
let at=levels.findIndex(p=>p.id===store.at),p=levels[at],t=E.topology(p),walls=[],history=[],drag=null,result=null,focus=0,ghost=null,animation=null,message='';
const svg=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const paths={restart:'M5 7a8 8 0 1 1-1 9M5 3v5h5',undo:'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',next:'M5 12h14m-6-6 6 6-6 6',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',help:'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2'};
for(const [id,name]of[['restart','restart'],['undo','undo'],['next','next'],['settings-button','settings'],['help-button','help']])$('#'+id).innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
function save(){if(!storageOK)return;store.at=p.id;store.boards[p.id]=walls.slice();try{localStorage.setItem(saveName,JSON.stringify(store));}catch(_){storageOK=false;message='This browser could not save your progress.';}}
function clearGhost(){animation?.cancel();animation=null;ghost?.remove();ghost=null;root.querySelectorAll('.square').forEach(n=>n.classList.remove('inspected','mismatch'));}
// Paired spiral arms echo the puzzle's half-turn symmetry. Decoration never
// reports regional success: the full field appears only on a solved partition.
function stars(solved){
 const state=p.id+':'+solved,previous=root.querySelector('.galaxy-field');
 if(previous?.dataset.state===state)return;
 previous?.remove();
 const field=svg('svg',{class:'galaxy-field'+(solved?' stars':''),viewBox:`0 0 ${p.w} ${p.h}`,'aria-hidden':'true'});
 field.dataset.state=state;
 const defs=svg('defs',{}),glow=svg('radialGradient',{id:'galaxy-glow'});
 for(const [offset,opacity]of[[0,.3],[.2,.12],[.55,.035],[1,0]])glow.append(svg('stop',{offset,'stop-color':'white','stop-opacity':opacity}));
 defs.append(glow);field.append(defs);
 p.centres.forEach(([x,y],g)=>{
  const cx=x/2,cy=y/2,region=solved?result.regions.find(r=>r.g===g):null;
  const radius=region?Math.max(...region.cells.map(i=>Math.hypot(i%p.w+.5-cx,Math.floor(i/p.w)+.5-cy)))+.8:.42;
  const outer=svg('g',{class:'galaxy'}),orbit=svg('g',{class:'orbit'});
  if(region){const clip=svg('clipPath',{id:'galaxy-region-'+g});for(const i of region.cells)clip.append(svg('rect',{x:i%p.w,y:Math.floor(i/p.w),width:1,height:1}));defs.append(clip);outer.setAttribute('clip-path',`url(#galaxy-region-${g})`);}
  outer.append(svg('circle',{cx,cy,r:solved?Math.min(radius,1.7):.4,fill:'url(#galaxy-glow)'}));
  orbit.style.transformOrigin=`${cx/p.w*100}% ${cy/p.h*100}%`;
  orbit.style.animationDuration=(64+g%5*9)+'s';
  const count=solved?Math.min(110,24+region.cells.length*9):18,phase=g*2.399;
  for(let k=0;k<count;k++){
   const t=(k+.5)/count,r=.055+radius*t,angle=phase+t*Math.PI*1.75;
   // Stable paired dust, no random flicker and no animation restart on resize.
   const spread=solved?.045+.13*t:.012,noise=Math.sin(k*12.989+g*7.3),jitter=Math.cos(k*8.17+g);
   for(const sign of[-1,1])orbit.append(svg('circle',{class:'galaxy-dust',cx:cx+sign*(Math.cos(angle)*r+noise*spread),cy:cy+sign*(Math.sin(angle)*r+jitter*spread),r:(solved?.012:.007)+(k%7===0?.009:0),opacity:(solved?.3:.13)+(1-t)*(solved?.55:.16)}));
  }
  if(solved){for(const sign of[-1,1]){let d='';for(let k=0;k<=48;k++){const t=k/48,r=.04+radius*t,a=phase+t*Math.PI*1.75;d+=(k?'L':'M')+(cx+sign*Math.cos(a)*r)+' '+(cy+sign*Math.sin(a)*r)+' ';}orbit.append(svg('path',{d,class:'galaxy-arm'}));}}
  outer.append(orbit);field.append(outer);
 });
 root.append(field);
}
function render(){result=E.inspect(p,walls);const solved=result.solved&&!drag;$('#stage').classList.toggle('solved',solved);$('#next').hidden=!solved;$('#next').disabled=at===levels.length-1;$('#undo').disabled=!history.length;$('#readout').textContent=(at+1)+' / '+levels.length+' · '+store.completed.length+' ✓';
 root.querySelectorAll('.seam').forEach(n=>{const e=+n.dataset.edge;n.setAttribute('aria-pressed',String(!!walls[e]));n.classList.toggle('redundant',result.redundant.includes(e));n.setAttribute('aria-label',(walls[e]?'Remove':'Add')+' '+(t.edges[e].vertical?'vertical':'horizontal')+' boundary at row '+(t.edges[e].y+1)+', column '+(t.edges[e].x+1));});
 $('#prompt').textContent=message||(solved?'':p.prompt||'One dot per shape. Each shape matches after a half-turn.');
 if(solved)clearGhost();stars(solved);
}
function finish(before,keyboard=false){if(before.some((v,i)=>v!==walls[i])){history.push(before);if(history.length>200)history.shift();}clearGhost();message='';result=E.inspect(p,walls);if(result.solved&&!store.completed.includes(p.id))store.completed.push(p.id);save();render();if(result.solved&&keyboard)$('#next').focus({preventScroll:true});}
function fit(){const sh=$('#shell'),cell=Math.max(48,Math.min(100,(sh.clientWidth-26)/p.w,(sh.clientHeight-96)/p.h));root.style.setProperty('--cell',cell+'px');}
function load(index){cancel();at=index;p=levels[at];t=E.topology(p);walls=store.boards[p.id]?.slice()||t.edges.map(()=>0);history=[];focus=0;message='';clearGhost();root.replaceChildren();root.style.setProperty('--w',p.w);root.style.setProperty('--h',p.h);
 for(let i=0;i<p.w*p.h;i++){const n=document.createElement('button');n.className='square';n.style.setProperty('--x',i%p.w);n.style.setProperty('--y',Math.floor(i/p.w));n.tabIndex=-1;n.setAttribute('aria-label','Check shape at row '+(Math.floor(i/p.w)+1)+', column '+(i%p.w+1));n.addEventListener('click',()=>inspect(i));root.append(n);}
 t.edges.forEach((edge,e)=>{if(edge.locked)return;const n=document.createElement('button');n.className='seam '+(edge.vertical?'vertical':'horizontal');n.dataset.edge=e;n.style.setProperty('--x',edge.x);n.style.setProperty('--y',edge.y);n.addEventListener('click',event=>{if(event.detail!==0)return;const before=walls.slice();walls[e]=1-walls[e];finish(before,true);});n.addEventListener('keydown',event=>{const nodes=[...root.querySelectorAll('.seam')],i=nodes.indexOf(n);if(event.key.startsWith('Arrow')){event.preventDefault();nodes[Math.max(0,Math.min(nodes.length-1,i+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)))].focus();}else if(event.key.toLowerCase()==='r'){event.preventDefault();inspect(edge.a);}});root.append(n);});
 p.centres.forEach(([x,y],g)=>{const n=document.createElement('span');n.className='dot';n.style.setProperty('--cx',x/2);n.style.setProperty('--cy',y/2);n.setAttribute('role','img');n.setAttribute('aria-label','Centre '+(g+1));root.append(n);});
 $('#level').value=p.id;$('#shell').scrollTo(0,0);fit();render();save();}
function inspect(i){clearGhost();const r=result.regions[result.owner[i]];if(!r)return;r.cells.forEach(c=>root.querySelectorAll('.square')[c].classList.add('inspected'));if(r.g<0){message=r.centres.length?'This shape has '+r.centres.length+' dots. Separate them.':'This shape needs a dot.';$('#prompt').textContent=message;return;}
 const mismatches=new Set(r.mismatch);r.mismatch.forEach(c=>{if(t.pairs[r.g][c]>=0)mismatches.add(t.pairs[r.g][c]);});mismatches.forEach(c=>root.querySelectorAll('.square')[c].classList.add('mismatch'));
 ghost=svg('svg',{class:'shape-ghost',viewBox:`0 0 ${p.w} ${p.h}`,'aria-hidden':'true'});const g=svg('g',{}),[cx,cy]=p.centres[r.g];g.style.transformBox='view-box';g.style.transformOrigin=`${cx/(2*p.w)*100}% ${cy/(2*p.h)*100}%`;r.cells.forEach(c=>g.append(svg('rect',{x:c%p.w,y:Math.floor(c/p.w),width:1,height:1})));ghost.append(g);root.append(ghost);
 if(store.motion==='reduce'||matchMedia('(prefers-reduced-motion:reduce)').matches)g.style.transform='rotate(180deg)';else animation=g.animate([{transform:'rotate(0)'},{transform:'rotate(180deg)'}],{duration:1100,easing:'ease-in-out',fill:'forwards'});
 message=r.mismatch.length?'The striped squares do not match after a half-turn.':'This shape matches. Every shape needs to match.';$('#prompt').textContent=message;}
function hit(event){const r=root.getBoundingClientRect(),cell=r.width/p.w,x=(event.clientX-r.x)/cell,y=(event.clientY-r.y)/cell;let best=-1,distance=Math.min(.45,22/cell);t.edges.forEach((edge,e)=>{if(edge.locked)return;const along=edge.vertical?y-edge.y:x-edge.x,across=Math.abs(edge.vertical?x-edge.x:y-edge.y);if(along<0||along>1||across>=distance)return;best=e;distance=across;});return best;}
root.addEventListener('pointerdown',e=>{if(!e.isPrimary||e.button!==0||!e.target.closest('.seam'))return;cancel();e.preventDefault();const edge=hit(e);if(edge<0)return;drag={id:e.pointerId,before:walls.slice(),value:1-walls[edge],seen:new Set([edge]),x:e.clientX,y:e.clientY};walls[edge]=drag.value;clearGhost();render();root.setPointerCapture(e.pointerId);});
root.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const steps=Math.max(1,Math.ceil(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)/8));for(let k=1;k<=steps;k++){const edge=hit({clientX:drag.x+(e.clientX-drag.x)*k/steps,clientY:drag.y+(e.clientY-drag.y)*k/steps});if(edge>=0&&!drag.seen.has(edge)){drag.seen.add(edge);walls[edge]=drag.value;}}drag.x=e.clientX;drag.y=e.clientY;render();});
function end(e){if(!drag||drag.id!==e.pointerId)return;const before=drag.before;drag=null;try{root.releasePointerCapture(e.pointerId);}catch(_){}finish(before);}
function cancel(){if(!drag)return;const d=drag;drag=null;walls=d.before;try{root.releasePointerCapture(d.id);}catch(_){}render();}
root.addEventListener('pointerup',end);root.addEventListener('pointercancel',cancel);root.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
function undo(){cancel();const previous=history.pop();if(previous){walls=previous;message='';clearGhost();save();render();}}
$('#undo').onclick=undo;$('#restart').onclick=()=>{cancel();const before=walls.slice();walls.fill(0);finish(before);};$('#next').onclick=()=>{if(result.solved&&at<levels.length-1)load(at+1);};
for(const [i,l]of levels.entries()){const o=document.createElement('option');o.value=l.id;o.textContent=i<3?'Introduction '+(i+1):'Puzzle '+(i-2);$('#level').append(o);}$('#level').onchange=e=>{load(levels.findIndex(l=>l.id===e.target.value));$('#settings').close();};
for(const id of ['settings','help']){$('#'+id+'-button').onclick=()=>{cancel();$('#'+id).showModal();};$('#'+id).addEventListener('close',()=>{if(!document.activeElement.closest('#board,#next'))$('#'+id+'-button').focus({preventScroll:true});});}
$('#motion').value=store.motion;document.documentElement.dataset.motion=store.motion;$('#motion').onchange=e=>{store.motion=e.target.value;document.documentElement.dataset.motion=store.motion;clearGhost();save();};
document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();if(e.key.toLowerCase()==='z'&&!document.querySelector('dialog[open]')){e.preventDefault();undo();}});document.addEventListener('visibilitychange',()=>{document.documentElement.classList.toggle('page-hidden',document.hidden);if(document.hidden)cancel();});window.addEventListener('resize',()=>{cancel();fit();});
load(at);window.__boundaries={get walls(){return walls.slice();},get puzzle(){return p;},get result(){return result;},get undoCount(){return history.length;}};
})();
