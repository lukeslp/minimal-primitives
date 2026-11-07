/* Adapted from Notan's shared pointer painter: same action path in Help/play. */
(function(){'use strict';
const toggle=(v,mark)=>v===(mark?2:1)?0:(mark?2:1);
function bind(o){const root=o.root;let drag=null;
function point(e){const r=root.getBoundingClientRect();return{x:Math.max(0,Math.min(o.puzzle().w-1e-6,(e.clientX-r.left)/r.width*o.puzzle().w)),y:Math.max(0,Math.min(o.puzzle().h-1e-6,(e.clientY-r.top)/r.height*o.puzzle().h))};}
const index=p=>Math.floor(p.y)*o.puzzle().w+Math.floor(p.x);
function paint(i){if(o.puzzle().cells[i]!==-2||drag.painted.has(i))return;drag.painted.add(i);o.state().cells[i]=drag.to;o.focus(i);o.preview();}
function move(e){if(!drag||e.pointerId!==drag.id)return;const a=drag.point,b=point(e),ts=[0,1];for(const axis of ['x','y']){const delta=b[axis]-a[axis];if(!delta)continue;for(let n=Math.floor(Math.min(a[axis],b[axis]))+1;n<Math.max(a[axis],b[axis]);n++)ts.push((n-a[axis])/delta);}ts.sort((a,b)=>a-b);for(let n=1;n<ts.length;n++)if(ts[n]-ts[n-1]>1e-10)paint(index({x:a.x+(b.x-a.x)*(ts[n]+ts[n-1])/2,y:a.y+(b.y-a.y)*(ts[n]+ts[n-1])/2}));paint(index(b));drag.point=b;}
// A mouse can lose capture a moment before its pointerup: when a move with no button held lands first, the browser lets go early. That is a release; capture lost with a button still down is a cancel.
const released=e=>e.type==='pointerup'||(e.type==='lostpointercapture'&&!e.buttons);
function end(e){if(!drag||(e.pointerId!=null&&e.pointerId!==drag.id))return;if(e.type==='pointerup')move(e);const d=drag;drag=null;if(!released(e)){o.state().cells=d.before;o.restore?.(d.meta);o.preview();}else o.commit(d.before);try{root.releasePointerCapture(d.id);}catch(_){} }
function cancel(){end({type:'pointercancel'});}
root.addEventListener('pointerdown',e=>{if(drag){if(e.pointerId!==drag.id)cancel();return;}if(!e.isPrimary||![0,2].includes(e.button)||o.mode()==='pan')return;const pt=point(e),i=index(pt);if(o.puzzle().cells[i]!==-2)return;e.preventDefault();const meta=o.snapshot?.();o.start();drag={meta,id:e.pointerId,point:pt,to:toggle(o.state().cells[i],e.button===2||o.mode()==='exclude'),before:o.state().cells.slice(),painted:new Set()};try{root.setPointerCapture(e.pointerId);}catch(_){}paint(i);});
root.addEventListener('pointermove',e=>{for(const sample of e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])move(sample);});for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,end);for(const type of ['pointerup','pointercancel'])document.addEventListener(type,end);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});root.addEventListener('contextmenu',e=>e.preventDefault());return{cancel};}
window.AkariPaint={bind,toggle};})();
