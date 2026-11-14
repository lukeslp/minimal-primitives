/* Cast · drawing, interaction and saves. By Luke Steuber. */
(function () {
  'use strict';
  const E = CastEngine, boards = CastBoards, $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg', KEY = 'cast.v1', D = .78;
  const board = $('#board'), reducedQuery = matchMedia('(prefers-reduced-motion:reduce)');
  const copy = h => h.map(row => row.slice());
  const validHeights = (h, b) => Array.isArray(h) && h.length === b.n && h.every(row => Array.isArray(row) && row.length === b.n && row.every(v => Number.isInteger(v) && v >= 0 && v <= b.maxH)) && E.used(h) <= b.cubes;
  const validHits = v => Number.isSafeInteger(v) && v >= 0;
  let saved = null, preserveSave = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const v = JSON.parse(raw), b = boards.find(b => b.id === v?.board);
      if (!v || !b || !validHeights(v.heights, b) || !validHits(v.hits) || !Array.isArray(v.finished) || !v.finished.every(id => boards.some(b => b.id === id)) || !['system','light','dark'].includes(v.theme) || !['system','reduce'].includes(v.motion) || !Array.isArray(v.history) || !v.history.every(s => validHeights(s.heights,b) && validHits(s.hits))) throw new Error('Invalid save');
      saved = v;
    }
  } catch (_) { preserveSave = true; }
  let puzzle = boards.find(b => b.id === saved?.board) || boards[0], heights = saved ? copy(saved.heights) : E.start(puzzle), hits = saved?.hits || 0;
  let history = saved?.history || [], finished = new Set(saved?.finished || []), prefs = { theme: 'light', motion: saved?.motion || 'system' };
  let hint = null, focus = [0,0], keyboard = false, hover = null, gesture = null, carry = null, wheel = null;
  let busy = false, queue = [], epoch = 0, animation = null, light = E.solved(puzzle,heights) ? 1 : 0, paintedFaces = [];
  const reduced = () => prefs.motion === 'reduce' || reducedQuery.matches;
  const point = (r,c,z=0) => [c-r,(r+c)/2-z*D];
  const square = (r,c,z=0,inset=.08) => [[r+inset,c+inset],[r+inset,c+1-inset],[r+1-inset,c+1-inset],[r+1-inset,c+inset]].map(([r,c]) => point(r,c,z));
  const points = p => p.map(p => p.join(',')).join(' ');
  function svg(tag, attrs, parent=board) { const node=document.createElementNS(NS,tag); for(const [k,v] of Object.entries(attrs)) node.setAttribute(k,v); parent.append(node); return node; }
  const poly = (p,cls,parent=board,attrs={}) => svg('polygon',{points:points(p),class:cls,...attrs},parent);
  function announce(message) { $('#announcement').textContent=message; }
  function save() {
    if(preserveSave) return;
    try { localStorage.setItem(KEY,JSON.stringify({board:puzzle.id,heights,hits,history,finished:[...finished],...prefs})); } catch (_) {}
  }
  function snapshot() { return {n:puzzle.n,maxH:puzzle.maxH,heights:copy(heights),tray:E.compare(puzzle,heights).tray,solved:E.solved(puzzle,heights),hits,par:E.par(puzzle),match:E.compare(puzzle,heights)}; }
  function fit() {
    const n=puzzle.n, top=-(puzzle.maxH+.25)*D-.06, bottom=n+1.08, w=2*n+.04, h=bottom-top;
    board.setAttribute('viewBox',`${-n-.02} ${top} ${w} ${h}`);
    const shell=$('#board-shell'), scale=Math.min(shell.clientWidth/w,(shell.clientHeight-$('#completion').offsetHeight)/h);
    board.style.width=w*scale+'px'; board.style.height=h*scale+'px';
  }
  function strip(axis,i,h) {
    const p=(a,z) => axis==='left'?point(a,0,z):point(0,a,z);
    return [p(i,0),p(i+1,0),p(i+1,h),p(i,h)];
  }
  function cube(r,c,z,parent,inset=.15,small=false) {
    const a=r+inset,b=c+inset,s=1-2*inset;
    const top=[point(a,b,z+1),point(a,b+s,z+1),point(a+s,b+s,z+1),point(a+s,b,z+1)];
    const left=[top[3],top[2],point(a+s,b+s,z),point(a+s,b,z)];
    const right=[top[2],top[1],point(a,b+s,z),point(a+s,b+s,z)];
    for(const [p,face] of [[left,'left'],[right,'right'],[top,'top']]) {
      poly(p,'cube-face cube-'+face,parent);
      if(!small) paintedFaces.push({p,r,c});
    }
  }
  function wall(axis,view,parent) {
    const n=puzzle.n, plane=strip(axis,0,puzzle.maxH+.25); plane[1]=strip(axis,n-1,puzzle.maxH+.25)[1]; plane[2]=strip(axis,n-1,puzzle.maxH+.25)[2];
    poly(plane,'wall',parent);
    for(let i=1;i<n;i++) { const p=strip(axis,i,puzzle.maxH+.25); svg('line',{class:'wall-grid',x1:p[0][0],y1:p[0][1],x2:p[3][0],y2:p[3][1]},parent); }
    for(let i=0;i<n;i++) {
      const target=puzzle[axis][i], current=view[axis][i];
      if(target) poly(strip(axis,i,target),'target',parent,{'data-wall':axis,'data-index':i});
      if(current) poly(strip(axis,i,current),'cast-shadow',parent,{'data-wall':axis,'data-index':i});
      svg('g',{'data-preview-wall':axis,'data-index':i},parent);
      if(target) poly(strip(axis,i,target),'target-outline',parent);
      if(target && !carry && E.solved(puzzle,heights)) poly(strip(axis,i,target),'finish-ink completion-ink',parent,{opacity:light});
    }
  }
  function rings() {
    $('#rings')?.remove();
    const g=svg('g',{id:'rings','aria-hidden':'true'},$('#scene'));
    if(hint) {
      poly(square(hint.r,hint.c,heights[hint.r][hint.c]+.03,.06),'hint-ring',g);
      poly(square(hint.r,hint.c,hint.to,.15),'hint-ghost',g);
      for(const [r,c] of [[hint.r+.15,hint.c+.15],[hint.r+.85,hint.c+.85]]) { const a=point(r,c,0),b=point(r,c,hint.to);svg('line',{class:'hint-ghost',x1:a[0],y1:a[1],x2:b[0],y2:b[1]},g); }
    }
    if(hover && !gesture && !E.solved(puzzle,heights)) poly(square(...hover,heights[hover[0]][hover[1]]+.02,.08),'hover-ring',g);
    if(keyboard) poly(square(...focus,heights[focus[0]][focus[1]]+.035,.04),'focus-ring',g);
    drawCarry(g);
    const v=E.views(heights),m=E.compare(puzzle,heights),status=E.solved(puzzle,heights)?' Solved.':'';
    board.setAttribute('aria-label',`Board ${boards.indexOf(puzzle)+1} of ${boards.length}, ${puzzle.n} by ${puzzle.n}. Heights by row: ${heights.map(row=>row.join(', ')).join('; ')}. Left shadows ${v.left.join(', ')}; targets ${puzzle.left.join(', ')}. Right shadows ${v.right.join(', ')}; targets ${puzzle.right.join(', ')}. Footprints by row: ${puzzle.plan.map(row=>row.join(', ')).join('; ')}. ${m.tray} cubes in tray. ${hits} hits, par ${E.par(puzzle)}. Focus row ${focus[0]+1}, column ${focus[1]+1}, height ${heights[focus[0]][focus[1]]}.${carry?' Carrying one cube. Arrows carry, Space drops, Escape cancels.':''}${status}`);
  }
  function carriedBase() {
    return carry?.source ? E.set(puzzle,heights,...carry.source,heights[carry.source[0]][carry.source[1]]-1) || heights : heights;
  }
  const trayLayout = () => ({step:Math.min(.48,(2*puzzle.n-.4)/Math.max(1,puzzle.cubes)),y:puzzle.n+.76});
  function trayPosition(slot) {
    const {step,y}=trayLayout();return {x:(slot-(puzzle.cubes-1)/2)*step,y,scale:step*.38};
  }
  function contact(cell,z,parent,cls='contact-shadow') {poly(square(...cell,z,.12),cls,parent);}
  function drawCarry(parent) {
    document.querySelectorAll('[data-preview-wall]').forEach(node=>node.replaceChildren());
    if(!carry)return;
    const base=carriedBase(),target=carry.target;
    if(carry.source)contact(carry.source,base[carry.source[0]][carry.source[1]]+.015,parent,'source-shadow');
    const next=target?E.set(puzzle,base,...target,base[target[0]][target[1]]+1):null;
    if(next) {
      const view=E.views(next),real=E.views(base);
      for(const node of document.querySelectorAll('[data-preview-wall]')) {
        const axis=node.dataset.previewWall,i=Number(node.dataset.index);
        if(view[axis][i]>real[axis][i]) {
          const region=strip(axis,i,view[axis][i]),bottom=strip(axis,i,real[axis][i]);region[0]=bottom[3];region[1]=bottom[2];
          poly(region,'preview-shadow',node);
        }
        if(puzzle[axis][i])poly(strip(axis,i,puzzle[axis][i]),'target preview-hatch',node);
      }
      const z=base[target[0]][target[1]];
      contact(target,z+.025,parent);
      poly(square(...target,z+.035,.06),'landing-ring',parent);
      const ghost=svg('g',{class:'landing-ghost'},parent);cube(...target,z,ghost,.15,true);
    } else if(target)poly(square(...target,base[target[0]][target[1]]+.035,.06),'landing-ring refused-ring',parent);
    const p=target?(()=>{const [x,y]=point(target[0]+.5,target[1]+.5,base[target[0]][target[1]]+.5);return{x,y};})():carry.pointer;
    const lifted=svg('g',{class:'carried-cube',transform:`translate(${p.x} ${p.y+D/2-.18})`},parent);
    cube(-.5,-.5,0,lifted,.15,true);
  }
  function render() {
    board.replaceChildren(); paintedFaces=[];
    const defs=svg('defs',{}),pattern=svg('pattern',{id:'hatch',width:.16,height:.16,patternUnits:'userSpaceOnUse'},defs);
    svg('path',{d:'M-.04 .04 .04-.04M0 .16 .16 0M.12 .20 .20 .12',class:'hatch-line'},pattern);
    const scene=svg('g',{id:'scene','aria-hidden':'true'}),display=carriedBase(),v=E.views(display),n=puzzle.n;
    wall('left',v,scene);wall('right',v,scene);
    poly([point(n,0),point(n,n),point(n,n,-.15),point(n,0,-.15)],'plinth-side',scene);
    poly([point(n,n),point(0,n),point(0,n,-.15),point(n,n,-.15)],'plinth-side',scene);
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) {
      poly(square(r,c,0,0),'square',scene,{'data-r':r,'data-c':c});
      if(puzzle.plan[r][c]) {
        poly(square(r,c,0,.06),'footprint'+(display[r][c]?' filled':''),scene,{'data-r':r,'data-c':c});
        if(!carry&&E.solved(puzzle,heights))poly(square(r,c,0,.06),'finish-ink completion-ink',scene,{opacity:light});
      }
    }
    const cells=[];for(let r=0;r<n;r++)for(let c=0;c<n;c++)cells.push([r,c]);
    cells.sort((a,b)=>a[0]+a[1]-b[0]-b[1]||a[0]-b[0]);
    for(const [r,c] of cells) if(heights[r][c]) {
      const group=svg('g',{class:'column','data-r':r,'data-c':c},scene);
      for(let z=0;z<heights[r][c];z++) {
        const lifted=carry?.source?.[0]===r&&carry.source[1]===c&&z===heights[r][c]-1;
        const layer=svg('g',{class:lifted?'lifted-source':'stack-cube'},group);
        cube(r,c,z,layer);
      }
      if(!puzzle.plan[r][c]&&display[r][c]) {
        poly(square(r,c,0,.03),'wrong-base',group);
        const [x,y]=point(r+.5,c+.5);svg('path',{class:'wrong-cross',d:`M${x-.065} ${y+.355}l.13 .07m-.13 0 .13-.07`},group);
      }
    }
    const tray=svg('g',{class:'tray'},scene),{step,y:trayY}=trayLayout();
    svg('path',{class:'tray-line',d:`M${-n+.12} ${trayY+.2}H${n-.12}m${-2*n+.24}-.12v.12m${2*n-.24}-.12v.12`},tray);
    const remaining=E.compare(puzzle,heights).tray;
    for(let i=0;i<remaining;i++) {
      const lifted=carry&&!carry.source&&carry.slot===i;
      const g=svg('g',{class:lifted?'tray-slot':'tray-cube','data-slot':i,transform:`translate(${(i-(puzzle.cubes-1)/2)*step} ${trayY}) scale(${step*.38})`},tray);
      cube(-.5,-.5,0,g,0,true);
    }
    rings();
    board.dataset.busy=String(busy);board.dataset.solved=String(E.solved(puzzle,heights));
    $('#readout').textContent=`${boards.indexOf(puzzle)+1} / ${boards.length} · ${hits} / ${E.par(puzzle)}`;
    $('#readout').setAttribute('aria-label',`Board ${boards.indexOf(puzzle)+1} of ${boards.length}; ${hits} hits; par ${E.par(puzzle)}`);
    $('#next-btn').hidden=!(!carry&&E.solved(puzzle,heights)&&light===1);
    $('#undo-btn').disabled=!history.length;$('#hint-btn').disabled=E.solved(puzzle,heights);$('#board-select').value=puzzle.id;fit();
  }
  function tween(duration,frame) {
    if(reduced()||document.hidden) {frame(1);return Promise.resolve();}
    return new Promise(resolve=>{
      const start=performance.now();let id;
      const finish=()=>{cancelAnimationFrame(id);frame(1);animation=null;resolve();};
      const tick=now=>{const t=Math.min(1,(now-start)/duration);frame(t);if(t===1||reduced())finish();else id=requestAnimationFrame(tick);};
      animation={finish};id=requestAnimationFrame(tick);
    });
  }
  async function refuse(r,c,to) {
    const tray=to>heights[r][c]&&to<=puzzle.maxH&&E.compare(puzzle,heights).tray===0;
    const target=tray?$('.tray'):$(`.column[data-r="${r}"][data-c="${c}"]`)||$(`.square[data-r="${r}"][data-c="${c}"]`);
    target.classList.add('refused');
    announce(tray?'The tray is empty. Remove a cube first.':`Height refused at row ${r+1}, column ${c+1}. Maximum height ${puzzle.maxH}.`);
    await tween(200,t=>target.setAttribute('transform',`translate(${Math.sin(t*Math.PI*4)*(1-t)*.06} 0)`));
    target.removeAttribute('transform');
    // With reduced motion the heavier edge stays until the next action.
    if(!reduced())target.classList.remove('refused');
  }
  async function perform(action) {
    const run=epoch;
    if(action.type==='return'){await returnToTray(action.from,action.slot);return;}
    if(action.type==='hint') {
      if(E.solved(puzzle,heights))return;
      if(hint){const h=hint;hint=null;return perform({type:'set',r:h.r,c:h.c,to:h.to});}
      hint=E.hint(puzzle,heights);render();
      if(hint)announce(`Hint: row ${hint.r+1}, column ${hint.c+1}, height ${hint.to}. Press Hint again to place it.`);
      return;
    }
    const {r,c}=action,validCell=(r,c)=>Number.isInteger(r)&&Number.isInteger(c)&&r>=0&&c>=0&&r<puzzle.n&&c<puzzle.n;
    if(!validCell(r,c))return;
    let next,to;
    const before=E.compare(puzzle,heights).tray;
    if(action.type==='move') {
      if(!validCell(action.r2,action.c2)||r===action.r2&&c===action.c2||!heights[r][c])return;
      const lifted=E.set(puzzle,heights,r,c,heights[r][c]-1);
      to=heights[action.r2][action.c2]+1;
      next=lifted&&E.set(puzzle,lifted,action.r2,action.c2,to);
      if(!next){await refuse(action.r2,action.c2,to);return;}
    } else {
      to=action.type==='step'?heights[r][c]+action.delta:action.to;
      if(!Number.isInteger(to))return;
      next=E.set(puzzle,heights,r,c,to);
      if(!next){if(to!==heights[r][c])await refuse(r,c,to);return;}
    }
    carry=null;
    history.push({heights:copy(heights),hits});heights=next;hits++;hint=null;hover=null;focus=action.type==='move'?[action.r2,action.c2]:[r,c];
    const solved=E.solved(puzzle,heights);light=solved?0:1;
    if(solved)finished.add(puzzle.id);
    render();save();
    if(E.compare(puzzle,heights).tray>before)await returnToTray(action.returnPoint || (()=>{const [x,y]=point(r+.5,c+.5,to+.5);return{x,y};})(),before);
    if(run!==epoch)return;
    if(solved) {
      await tween(640,t=>{light=t;document.querySelectorAll('.completion-ink').forEach(node=>node.setAttribute('opacity',t));});
      if(run!==epoch)return;
      $('#next-btn').hidden=false;
      announce(`All shadows match. Board solved in ${hits} hits. Par ${E.par(puzzle)}. Next board is available.`);
    } else {
      const target=$(`.column[data-r="${focus[0]}"][data-c="${focus[1]}"]`);
      await tween(140,t=>{if(target)target.style.opacity=String(.6+.4*t);});
      if(run!==epoch)return;
      announce(`${action.type==='move'?`Cube moved from row ${r+1}, column ${c+1} to row ${focus[0]+1}, column ${focus[1]+1}.`:`Row ${r+1}, column ${c+1}, height ${to}.`} ${E.compare(puzzle,heights).tray} cubes in the tray. ${hits} hits.`);
    }
  }
  async function returnToTray(from,slot) {
    if(reduced()||document.hidden)return;
    const target=$(`.tray-cube[data-slot="${slot}"]`),end=trayPosition(slot);
    if(!target)return;
    target.style.visibility='hidden';
    const flight=svg('g',{class:'returning-cube','aria-hidden':'true'},$('#scene'));cube(-.5,-.5,0,flight,.15,true);
    await tween(220,t=>{const k=1-(1-t)**3,scale=1+(end.scale-1)*k;flight.setAttribute('transform',`translate(${from.x+(end.x-from.x)*k} ${from.y+D/2+(end.y-from.y-D/2)*k}) scale(${scale})`);});
    target.style.visibility='';flight.remove();
  }
  async function drain() {
    if(busy)return;busy=true;board.dataset.busy='true';const run=epoch;
    while(queue.length) {
      const job=queue.shift();await perform(job.action);job.resolve();if(run!==epoch)return;
    }
    busy=false;board.dataset.busy='false';
  }
  function enqueue(action) {return new Promise(resolve=>{queue.push({action,resolve});drain();});}
  function clearPending() {
    epoch++;queue.splice(0).forEach(job=>job.resolve());animation?.finish();busy=false;
    clearTimeout(wheel?.timer);wheel=null;
    const g=gesture;gesture=null;carry=null;if(g)try{board.releasePointerCapture(g.id);}catch(_){}
  }
  function undo() {
    clearPending();const previous=history.pop();
    if(previous){heights=copy(previous.heights);hits=previous.hits;announce(`Move undone. ${hits} hits. ${E.compare(puzzle,heights).tray} cubes in the tray.`);}
    hint=null;hover=null;light=E.solved(puzzle,heights)?1:0;render();save();
  }
  function restart() {clearPending();heights=E.start(puzzle);hits=0;history=[];hint=null;hover=null;light=0;render();save();announce('Board restarted.');}
  function go(id) {
    const next=boards.find(b=>b.id===id);if(!next)return;
    clearPending();puzzle=next;heights=E.start(puzzle);hits=0;history=[];hint=null;hover=null;focus=[0,0];light=0;render();save();announce(`Board ${boards.indexOf(puzzle)+1} of ${boards.length}.`);
  }
  const set=(r,c,to)=>enqueue({type:'set',r,c,to}),add=(r,c)=>enqueue({type:'step',r,c,delta:1});
  const move=(r,c,r2,c2)=>enqueue({type:'move',r,c,r2,c2}),remove=(r,c)=>enqueue({type:'step',r,c,delta:-1});
  function local(e) {return new DOMPoint(e.clientX,e.clientY).matrixTransform(board.getScreenCTM().inverse());}
  function contains(p,polygon) {
    let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];if((a[1]>p.y)!==(b[1]>p.y)&&p.x<(b[0]-a[0])*(p.y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  }
  function hit(e) {
    const p=local(e);
    for(let i=paintedFaces.length-1;i>=0;i--)if(contains(p,paintedFaces[i].p))return [paintedFaces[i].r,paintedFaces[i].c];
    let nearest=[0,0],distance=Infinity;
    for(let r=0;r<puzzle.n;r++)for(let c=0;c<puzzle.n;c++){const [x,y]=point(r+.5,c+.5),d=(x-p.x)**2+(y-p.y)**2;if(d<distance){distance=d;nearest=[r,c];}}
    return nearest;
  }
  function faceHit(e) {
    const p=local(e);
    for(let i=paintedFaces.length-1;i>=0;i--)if(contains(p,paintedFaces[i].p))return [paintedFaces[i].r,paintedFaces[i].c];
    return null;
  }
  function overTray(e) {
    const p=local(e);return p.y>puzzle.n+.3&&p.y<puzzle.n+1.08&&Math.abs(p.x)<puzzle.n;
  }
  function trayHit(e) {
    if(!overTray(e))return null;
    const p=local(e),remaining=E.compare(puzzle,heights).tray,{step,y}=trayLayout();
    for(let i=0;i<remaining;i++){const slot=trayPosition(i);if(Math.abs(p.x-slot.x)<=Math.max(step/2,.18)&&Math.abs(p.y-(y-slot.scale*D/2))<.28)return i;}
    return null;
  }
  function landing(e) {
    if(overTray(e))return null;
    const face=faceHit(e);if(face)return face;
    return contains(local(e),[point(0,0),point(0,puzzle.n),point(puzzle.n,puzzle.n),point(puzzle.n,0)])?hit(e):null;
  }
  function cancelCarry() {
    const g=gesture;gesture=null;carry=null;
    if(g)try{board.releasePointerCapture(g.id);}catch(_){}
    render();
  }
  function moveGesture(e) {
    if(gesture?.id!==e.pointerId)return;
    const g=gesture;g.last={clientX:e.clientX,clientY:e.clientY};
    if(!g.drag&&Math.hypot(g.startX-e.clientX,g.startY-e.clientY)>10) {
      g.drag=true;
      if(!queue.length&&(g.slot!==null||g.source)) {
        animation?.finish();
        carry={source:g.source,slot:g.slot,target:landing(e),pointer:local(e)};hint=null;render();
      }
    }
    if(carry){carry.pointer=local(e);carry.target=landing(e);rings();}
  }
  function release(e) {
    if(gesture?.id!==e.pointerId)return;
    if(e.type!=='lostpointercapture')moveGesture(e);
    const g=gesture,held=carry;gesture=null;carry=null;
    try{board.releasePointerCapture(g.id);}catch(_){}
    render();
    if(held) {
      const target=held.target;
      if(target) {
        focus=target;
        if(held.source)move(...held.source,...target);else add(...target);
      } else if(held.source)enqueue({type:'step',r:held.source[0],c:held.source[1],delta:-1,returnPoint:held.pointer});
      else enqueue({type:'return',from:held.pointer,slot:held.slot});
    } else if(!g.drag&&g.cell){focus=g.cell;add(...g.cell);}
  }
  board.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||e.button!==0||gesture||carry||$('dialog[open]'))return;
    const slot=trayHit(e),cell=slot===null?landing(e):null;
    if(slot===null&&!cell)return;
    e.preventDefault();keyboard=false;hover=null;
    gesture={id:e.pointerId,cell,slot,source:slot===null?faceHit(e):null,startX:e.clientX,startY:e.clientY,last:{clientX:e.clientX,clientY:e.clientY},drag:false};
    board.focus({preventScroll:true});board.setPointerCapture(e.pointerId);rings();
  });
  window.addEventListener('pointermove',e=>{
    if(gesture?.id===e.pointerId){moveGesture(e);if(e.buttons===0&&e.pointerType!=='touch')release(e);}
    else if(e.pointerType==='mouse'&&e.target.closest?.('#board')){hover=landing(e);rings();}
  });
  window.addEventListener('pointerup',release);
  board.addEventListener('lostpointercapture',e=>{if(gesture?.id===e.pointerId){if(!e.buttons)release(e);else cancelCarry();}});
  window.addEventListener('pointercancel',e=>{if(gesture?.id===e.pointerId)cancelCarry();});
  board.addEventListener('pointerleave',()=>{hover=null;rings();});
  board.addEventListener('focus',()=>{if(!gesture){keyboard=true;rings();}});
  board.addEventListener('blur',()=>{keyboard=false;if(carry&&!gesture)cancelCarry();else rings();});
  board.addEventListener('wheel',e=>{
    if($('dialog[open]')||carry||!landing(e))return;e.preventDefault();
    if(!wheel)wheel={cell:landing(e),sum:0,stepped:false,timer:null};
    clearTimeout(wheel.timer);wheel.sum+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?board.clientHeight:1);
    if(!wheel.stepped&&Math.abs(wheel.sum)>=40){wheel.stepped=true;enqueue({type:'step',r:wheel.cell[0],c:wheel.cell[1],delta:wheel.sum<0?1:-1});}
    wheel.timer=setTimeout(()=>{wheel=null;},180);
  },{passive:false});
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||$('dialog[open]')||e.target.matches('select,input,textarea'))return;
    const key=e.key.length===1?e.key.toLowerCase():e.key;
    if(['z','u','Backspace'].includes(key)){e.preventDefault();undo();return;}
    if(key==='Escape'&&carry){e.preventDefault();cancelCarry();announce('Cube returned to its source.');return;}
    if(key==='h'&&!carry){e.preventDefault();enqueue({type:'hint'});return;}
    const delta={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[key];
    if(delta){e.preventDefault();focus=focus.map((v,i)=>Math.max(0,Math.min(puzzle.n-1,v+delta[i])));keyboard=true;hover=null;board.focus({preventScroll:true});if(carry)carry.target=focus.slice();rings();announce(`${carry?'Carrying cube. ':''}Row ${focus[0]+1}, column ${focus[1]+1}, height ${heights[focus[0]][focus[1]]}.`);}
    if(key==='Enter'&&e.target===board&&!carry){e.preventDefault();enqueue({type:'step',r:focus[0],c:focus[1],delta:e.shiftKey?-1:1});}
    if(key===' '&&e.target===board) {
      e.preventDefault();if(e.repeat||gesture||queue.length)return;
      animation?.finish();
      if(carry){const source=carry.source,target=focus.slice();carry=null;render();move(...source,...target);}
      else if(heights[focus[0]][focus[1]]){carry={source:focus.slice(),target:focus.slice(),pointer:null};hint=null;render();announce(`Top cube lifted from row ${focus[0]+1}, column ${focus[1]+1}. Arrows carry; Space drops; Escape cancels.`);}
    }
  });
  for(const name of ['selectstart','dragstart','contextmenu'])board.addEventListener(name,e=>e.preventDefault());
  const icons={restart:'M5 7a8 8 0 1 1-1 9M5 3v5h5',undo:'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',hint:'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z',next:'M5 12h14M13 6l6 6-6 6',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',help:'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2'};
  for(const [id,d] of Object.entries(icons))$('#'+id+'-btn').innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  $('#undo-btn').onclick=undo;$('#restart-btn').onclick=restart;$('#hint-btn').onclick=()=>enqueue({type:'hint'});
  $('#next-btn').onclick=()=>{if(E.solved(puzzle,heights)&&light===1)go(boards[(boards.indexOf(puzzle)+1)%boards.length].id);};
  for(const id of ['settings','help']) {
    $('#'+id+'-btn').onclick=()=>{cancelCarry();hover=null;rings();$('#'+id).showModal();};
    $('#'+id).addEventListener('close',()=>$('#'+id+'-btn').focus({preventScroll:true}));
  }
  for(const [i,b] of boards.entries()){const option=document.createElement('option');option.value=b.id;option.textContent=String(i+1);$('#board-select').append(option);}
  $('#board-select').onchange=e=>{go(e.target.value);$('#settings').close();};
  function applyPrefs() {
    document.documentElement.dataset.theme=prefs.theme;document.documentElement.dataset.motion=prefs.motion;
    $('#motion').value=prefs.motion;
    $('meta[name="theme-color"]').content='#ffffff';
    if(reduced())animation?.finish();
  }
  $('#motion').onchange=e=>{prefs.motion=e.target.value;applyPrefs();save();};
  reducedQuery.addEventListener('change',applyPrefs);window.addEventListener('resize',fit);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)animation?.finish();});
  window.__cast={boards,get board(){return puzzle.id;},get state(){return snapshot();},set,add,undo,restart,go,move,remove,trayPoint(){const p=trayPosition(0),q=new DOMPoint(p.x,p.y-p.scale*D/2).matrixTransform(board.getScreenCTM());return{x:q.x,y:q.y};}};
  window.__minimalize={bounds(){const b=$('#scene').getBBox(),m=board.getScreenCTM(),a=new DOMPoint(b.x,b.y).matrixTransform(m),z=new DOMPoint(b.x+b.width,b.y+b.height).matrixTransform(m);return{x:a.x,y:a.y,width:z.x-a.x,height:z.y-a.y};}};
  applyPrefs();render();save();if(preserveSave)announce('Saved board could not be read. Starting fresh.');
})();
