/* Explicit wire contacts for the local Bridges circuit study. */
(function(){'use strict';
const icon=(count,vertical=false)=>'<svg viewBox="0 0 24 24" aria-hidden="true"'+(vertical?' style="transform:rotate(90deg)"':'')+'><path d="'+(count===2?'M4 8h16M4 16h16':'M4 12h16')+'"/></svg>';
const overlap=(a,b,gap=2)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
function bind(root,p,s,change){
 const topology=Bridges.topology(p),edges=topology.edges,groups=[];
 let active=-1,invoker=null,locked=false;
 const picker=document.createElement('div');picker.className='circuit-picker';picker.id=root.id+'-wire-choices';picker.hidden=true;picker.setAttribute('role','group');
 const description=e=>{const {a,b}=edges[e],A=p.islands[a],B=p.islands[b];return 'Route from row '+(A.y+1)+', column '+(A.x+1)+' to row '+(B.y+1)+', column '+(B.x+1);};
 const choose=(e,value,event)=>{if(s.solved||locked||s.locks[e])return;const count=s.cells[e]===value?0:value,origin=active>=0?invoker:null;close(false);change(e,count,event);if(origin&&!s.solved)origin.focus({preventScroll:true});};
 function button(value,e,vertical){const n=document.createElement('button');n.type='button';n.className='circuit-contact';n.dataset.value=value;n.innerHTML=icon(value,vertical);n.addEventListener('click',event=>{event.stopPropagation();choose(typeof e==='function'?e():e,value,event);});return n;}
 const one=button(1,()=>active),two=button(2,()=>active),dismiss=document.createElement('button');dismiss.type='button';dismiss.className='circuit-close';dismiss.setAttribute('aria-label','Close wire controls');dismiss.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';dismiss.addEventListener('click',()=>close(true));picker.append(one,two,dismiss);root.append(picker);
 function close(restore=false){const old=invoker;active=-1;invoker=null;picker.hidden=true;groups.forEach(g=>g.launch.setAttribute('aria-expanded','false'));root.querySelectorAll('.wire-selected').forEach(n=>n.classList.remove('wire-selected'));if(restore)old?.focus({preventScroll:true});}
 function open(e,origin){if(s.solved||locked)return;close();active=e;invoker=origin||(groups[e].box.classList.contains('compact')?groups[e].launch:groups[e].single);picker.hidden=false;picker.dataset.edge=e;picker.setAttribute('aria-label',description(e));const r=invoker.getBoundingClientRect();picker.style.left=Math.max(8,Math.min(innerWidth-152,r.x+r.width/2-72))+'px';picker.style.top=Math.max(52,Math.min(innerHeight-118,r.y+r.height+8))+'px';groups[e].box.classList.add('wire-selected');groups[e].launch.setAttribute('aria-expanded','true');syncPicker();one.focus({preventScroll:true});}
 function updateButton(n,e,value){const selected=s.cells[e]===value;n.setAttribute('aria-pressed',String(selected));n.dataset.edge=e;n.setAttribute('aria-label',description(e)+'. '+(selected?'Remove '+value+' bridge'+(value===2?'s':''):'Set '+value+' bridge'+(value===2?'s':''))+(s.locks[e]?'. Locked. Hold or press L to unlock':''));}
 function syncPicker(){if(active<0)return;for(const n of [one,two]){updateButton(n,active,Number(n.dataset.value));n.innerHTML=icon(Number(n.dataset.value),p.islands[edges[active].a].x===p.islands[edges[active].b].x);}}
 edges.forEach(({a,b},e)=>{const vertical=p.islands[a].x===p.islands[b].x,box=document.createElement('div');box.className='circuit-route'+(vertical?' vertical':'');box.dataset.edge=e;box.setAttribute('role','group');box.setAttribute('aria-label',description(e));const single=button(1,e,vertical),double=button(2,e,vertical),launch=document.createElement('button');launch.type='button';launch.className='circuit-launch';launch.dataset.edge=e;launch.setAttribute('aria-controls',picker.id);launch.setAttribute('aria-expanded','false');launch.addEventListener('click',event=>{event.stopPropagation();open(e,launch);});box.append(single,double,launch);root.append(box);groups.push({box,single,double,launch,vertical});});
 const dismissOutside=e=>{if(active>=0&&!picker.contains(e.target)&&!e.target.closest('.circuit-launch'))close();};
 document.addEventListener('pointerdown',dismissOutside);
 picker.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key.toLowerCase()==='z'){close(true);}else if(e.key==='Tab'){const next=e.shiftKey?e.target.previousElementSibling:e.target.nextElementSibling;if(!next){e.preventDefault();close(true);}}});
 root.classList.add('circuits');
 function layout(disabled=false){
  locked=disabled;
  const nodes=[...root.querySelectorAll('.island')],w=root.clientWidth,h=root.clientHeight,placed=[];
  const blocks=p.islands.map((a,i)=>({x:(a.x+.5)*w/p.w-nodes[i].offsetWidth/2,y:(a.y+.5)*h/p.h-nodes[i].offsetHeight/2,w:nodes[i].offsetWidth,h:nodes[i].offsetHeight}));
  groups.forEach((g,e)=>{const {a,b}=edges[e],A=p.islands[a],B=p.islands[b];g.box.classList.toggle('locked',s.locks[e]);g.box.hidden=s.solved||locked;if(s.solved||locked)return;const ax=(A.x+.5)*w/p.w,ay=(A.y+.5)*h/p.h,bx=(B.x+.5)*w/p.w,by=(B.y+.5)*h/p.h;
   let choice=null;const length=Math.ceil(Math.hypot(bx-ax,by-ay)),positions=Array.from({length:length+1},(_,i)=>i/length).sort((a,b)=>Math.abs(a-.5)-Math.abs(b-.5));
   // Start near the centre, move along the wire to avoid intersections and nodes.
   for(const [gw,gh,compact]of[[g.vertical?44:92,g.vertical?92:44,false],[32,32,true],[24,24,true]]){
    for(const t of positions){const x=ax+(bx-ax)*t,y=ay+(by-ay)*t,r={x:x-gw/2,y:y-gh/2,w:gw,h:gh};
     const crossing=topology.cross[e].some(f=>{const F=edges[f],C=p.islands[F.a],px=(g.vertical?A.x:C.x)+.5,py=(g.vertical?C.y:A.y)+.5;return overlap(r,{x:px*w/p.w-8,y:py*h/p.h-8,w:16,h:16});});
     if(r.x>=0&&r.y>=0&&r.x+gw<=w&&r.y+gh<=h&&!crossing&&![...blocks,...placed].some(b=>overlap(r,b))){choice={...r,compact};break;}}
    if(choice)break;
   }
   if(!choice){g.box.hidden=true;g.box.dataset.unplaced='true';return;}delete g.box.dataset.unplaced;placed.push(choice);
   g.box.style.left=choice.x+'px';g.box.style.top=choice.y+'px';g.box.style.width=choice.w+'px';g.box.style.height=choice.h+'px';g.box.classList.toggle('compact',choice.compact);
   for(const [n,value]of[[g.single,1],[g.double,2]])updateButton(n,e,value);
   g.launch.innerHTML=s.cells[e]?icon(s.cells[e],g.vertical):'<svg viewBox="0 0 24 24" aria-hidden="true"'+(g.vertical?' style="transform:rotate(90deg)"':'')+'><path d="M3 12h5m8 0h5M8 12l7-5"/></svg>';
   g.launch.setAttribute('aria-label',description(e)+', '+s.cells[e]+' bridges. Choose single or double wire');
  });
  if(s.solved||locked)close();else syncPicker();
 }
 return {layout,open,close,destroy(){document.removeEventListener('pointerdown',dismissOutside);close();}};
}
window.BridgesCircuits={bind};
})();
