/* Slant pointer painting: play and lessons share the same transaction.
   A press on a drawn diagonal waits to tell a tap from a lock-hold, unless
   o.locking() says this board has no locks (free draw); then it paints at once. */
(function(){'use strict';
const cycle=v=>(v+1)%3;
function value(v,mode){return mode==='slash'?1:mode==='backslash'?2:cycle(v);}
const capture=s=>({cells:s.cells.slice(),locks:s.locks.slice()}),restore=(s,b)=>{s.cells=b.cells.slice();s.locks=b.locks.slice();},changed=(b,s)=>b.cells.some((v,i)=>v!==s.cells[i]||b.locks[i]!==s.locks[i]);
function bind(o){const root=o.root;let drag=null;
function point(e){const r=root.getBoundingClientRect(),p=o.puzzle();return{x:Math.max(0,Math.min(p.w-1e-6,(e.clientX-r.left)/r.width*p.w)),y:Math.max(0,Math.min(p.h-1e-6,(e.clientY-r.top)/r.height*p.h))};}
const index=p=>Math.floor(p.y)*o.puzzle().w+Math.floor(p.x);
function paint(i){if(drag.painted.has(i))return;drag.painted.add(i);if(!o.state().locks[i]&&!o.state().settled?.[i])o.state().cells[i]=drag.to;o.focus(i);o.preview();}
function begin(){clearTimeout(drag.timer);drag.pending=false;o.start();paint(drag.i);}
function move(e){if(!drag||e.pointerId!==drag.id||drag.held)return;if(drag.pending){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<=10)return;begin();}const a=drag.point,b=point(e),ts=[0,1];for(const axis of ['x','y']){const delta=b[axis]-a[axis];if(!delta)continue;for(let n=Math.floor(Math.min(a[axis],b[axis]))+1;n<Math.max(a[axis],b[axis]);n++)ts.push((n-a[axis])/delta);}ts.sort((a,b)=>a-b);for(let n=1;n<ts.length;n++)if(ts[n]-ts[n-1]>1e-10)paint(index({x:a.x+(b.x-a.x)*(ts[n]+ts[n-1])/2,y:a.y+(b.y-a.y)*(ts[n]+ts[n-1])/2}));paint(index(b));drag.point=b;}
// A mouse can lose capture a moment before its pointerup: when a move with no button held lands first, the browser lets go early. That is a release; capture lost with a button still down is a cancel.
const released=e=>e.type==='pointerup'||(e.type==='lostpointercapture'&&!e.buttons);
function end(e){if(!drag||(e.pointerId!=null&&e.pointerId!==drag.id))return;if(released(e)){if(e.type==='pointerup')move(e);if(drag.pending){if(o.lockTool?.()){drag.pending=false;drag.held=true;o.focus(drag.i);o.lock(drag.i);}else begin();}}const d=drag;drag=null;clearTimeout(d.timer);if(!d.held){if(!released(e)){restore(o.state(),d.before);o.restore?.(d.meta);o.preview();}else o.commit(d.before);}try{root.releasePointerCapture(d.id);}catch(_){} }
function cancel(){end({type:'pointercancel'});}
root.addEventListener('pointerdown',e=>{if(drag){if(e.pointerId!==drag.id)cancel();return;}if(!e.isPrimary||![0,2].includes(e.button)||!e.target.closest('.cell'))return;e.preventDefault();const pt=point(e),i=index(pt);if(e.button===2){o.focus(i);if(o.state().cells[i])o.lock(i);return;}if(o.mode()==='pan')return;const meta=o.snapshot?.(),before=capture(o.state());drag={meta,id:e.pointerId,point:pt,i,x:e.clientX,y:e.clientY,to:value(before.cells[i],o.mode()),before,painted:new Set(),pending:!!before.cells[i]&&o.locking?.()!==false};try{root.setPointerCapture(e.pointerId);}catch(_){}if(drag.pending){const d=drag;d.timer=setTimeout(()=>{if(drag!==d)return;if(o.lockTool?.()){d.to=cycle(d.before.cells[i]);begin();}else{d.pending=false;d.held=true;o.focus(i);o.lock(i);}},500);}else begin();});
root.addEventListener('pointermove',e=>{const samples=e.getCoalescedEvents?.();for(const sample of samples?.length?samples:[e])move(sample);});for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,end);for(const type of ['pointerup','pointercancel'])document.addEventListener(type,end);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});root.addEventListener('contextmenu',e=>e.preventDefault());root.addEventListener('selectstart',e=>e.preventDefault());return{cancel,get active(){return !!drag;}};}
window.SlantPaint={bind,cycle,value,capture,restore,changed};})();
