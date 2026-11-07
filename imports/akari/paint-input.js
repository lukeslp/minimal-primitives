/* Adapted from Notan's shared pointer painter: same action path in Help/play. */
(function(){'use strict';
const toggle=(v,mark)=>v===(mark?2:1)?0:(mark?2:1);
const cycle=v=>(v+1)%3;
function bind(o){const root=o.root;let drag=null,hold=null;
function clearHold(){clearTimeout(hold);hold=null;}
function point(e){const r=root.getBoundingClientRect();return{x:Math.max(0,Math.min(o.puzzle().w-1e-6,(e.clientX-r.left)/r.width*o.puzzle().w)),y:Math.max(0,Math.min(o.puzzle().h-1e-6,(e.clientY-r.top)/r.height*o.puzzle().h))};}
const index=p=>Math.floor(p.y)*o.puzzle().w+Math.floor(p.x);
function paint(i){if(o.puzzle().cells[i]!==-2||drag.painted.has(i))return;drag.painted.add(i);o.state().cells[i]=drag.to;o.focus(i);o.preview();}
function move(e){if(!drag||e.pointerId!==drag.id)return;const a=drag.point,b=point(e),ts=[0,1];if(index(b)!==drag.start||Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>10)clearHold();for(const axis of ['x','y']){const delta=b[axis]-a[axis];if(!delta)continue;for(let n=Math.floor(Math.min(a[axis],b[axis]))+1;n<Math.max(a[axis],b[axis]);n++)ts.push((n-a[axis])/delta);}ts.sort((a,b)=>a-b);for(let n=1;n<ts.length;n++)if(ts[n]-ts[n-1]>1e-10)paint(index({x:a.x+(b.x-a.x)*(ts[n]+ts[n-1])/2,y:a.y+(b.y-a.y)*(ts[n]+ts[n-1])/2}));paint(index(b));drag.point=b;}
// A mouse can lose capture a moment before its pointerup: when a move with no button held lands first, the browser lets go early. That is a release; capture lost with a button still down is a cancel.
const released=e=>e.type==='pointerup'||(e.type==='lostpointercapture'&&!e.buttons);
function end(e){if(!drag||(e.pointerId!=null&&e.pointerId!==drag.id))return;clearHold();if(e.type==='pointerup')move(e);const d=drag;drag=null;if(!released(e)){o.state().cells=d.before;o.restore?.(d.meta);o.preview();}else o.commit(d.before);try{root.releasePointerCapture(d.id);}catch(_){} }
function cancel(){end({type:'pointercancel'});}
root.addEventListener('pointerdown',e=>{if(drag){if(e.pointerId!==drag.id)cancel();return;}if(!e.isPrimary||![0,2].includes(e.button)||o.mode()==='pan')return;const pt=point(e),i=index(pt);if(o.puzzle().cells[i]!==-2)return;e.preventDefault();const meta=o.snapshot?.(),mark=o.mode()==='exclude';o.start();drag={meta,id:e.pointerId,start:i,x:e.clientX,y:e.clientY,point:pt,to:e.button===2?toggle(o.state().cells[i],!mark):mark?toggle(o.state().cells[i],true):cycle(o.state().cells[i]),before:o.state().cells.slice(),painted:new Set()};try{root.setPointerCapture(e.pointerId);}catch(_){}paint(i);
// Match Notan's hold: replace the tap preview, then commit once on release.
if(e.pointerType==='touch'&&e.button===0){const d=drag;hold=setTimeout(()=>{hold=null;if(drag!==d)return;d.to=toggle(d.before[i],!mark);d.painted.delete(i);paint(i);},380);}
});
root.addEventListener('pointermove',e=>{for(const sample of e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])move(sample);});for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,end);for(const type of ['pointerup','pointercancel'])document.addEventListener(type,end);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>e.preventDefault());return{cancel};}
window.AkariPaint={bind,toggle,cycle};})();
