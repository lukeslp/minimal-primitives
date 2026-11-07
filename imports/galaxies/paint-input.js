/* Galaxies paired painting, shared by the board and isolated Help lessons. */
(function(){'use strict';
function bind(o){const root=o.root;let drag=null,rejected=null,pending=null;
function point(e){const r=root.getBoundingClientRect(),p=o.puzzle();return{x:Math.max(0,Math.min(p.w-1e-6,(e.clientX-r.left)/r.width*p.w)),y:Math.max(0,Math.min(p.h-1e-6,(e.clientY-r.top)/r.height*p.h))};}
const index=p=>Math.floor(p.y)*o.puzzle().w+Math.floor(p.x);
// The diamond a press belongs to: the nearest one that is not already a finished single square, as a tap on it chooses.
function nearest(e){const p=o.puzzle(),r=root.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*p.w,y=(e.clientY-r.top)/r.height*p.h,fixed=new Set(Galaxies.singletonGivens(p).filter(g=>g>=0));let best=-1,least=Infinity;p.centres.forEach(([cx,cy],g)=>{const d=Math.hypot(cx/2-x,cy/2-y);if(!fixed.has(g)&&d<least){least=d;best=g;}});return best;}
function paint(i){if(drag.visited.has(i))return;drag.visited.add(i);const j=Galaxies.topology(o.puzzle()).pairs[drag.g][i];if(j>=0)drag.visited.add(j);o.action(i,drag.g,drag.to);o.focus(i);o.preview();}
function move(e){if(!drag||e.pointerId!==drag.id)return;const a=drag.point,b=point(e),ts=[0,1];for(const axis of['x','y']){const delta=b[axis]-a[axis];if(!delta)continue;for(let n=Math.floor(Math.min(a[axis],b[axis]))+1;n<Math.max(a[axis],b[axis]);n++)ts.push((n-a[axis])/delta);}ts.sort((a,b)=>a-b);for(let k=1;k<ts.length;k++)if(ts[k]-ts[k-1]>1e-10)paint(index({x:a.x+(b.x-a.x)*(ts[k]+ts[k-1])/2,y:a.y+(b.y-a.y)*(ts[k]+ts[k-1])/2}));paint(index(b));drag.point=b;}
// A mouse can lose capture a moment before its pointerup: when a move with no button held lands first, the browser lets go early. That is a release; capture lost with a button still down is a cancel.
const released=e=>e.type==='pointerup'||(e.type==='lostpointercapture'&&!e.buttons);
// A touch that began on a diamond is held by the diamond until the board takes it over; the diamond letting go is not the drag ending.
function end(e){if(e.type==='lostpointercapture'&&e.target!==root)return;if(pending&&(e.pointerId==null||e.pointerId===pending.id))pending=null;if(!drag||(e.pointerId!=null&&e.pointerId!==drag.id))return;if(e.type==='pointerup')move(e);const d=drag;drag=null;if(released(e))o.commit(d.before);else o.restore(d.before);try{root.releasePointerCapture(d.id);}catch(_){} }
const cancel=()=>end({type:'pointercancel'});
root.addEventListener('pointerdown',e=>{if(drag){if(e.pointerId!==drag.id){rejected=e.pointerId;cancel();}return;}rejected=null;pending=null;if(!e.isPrimary||![0,2].includes(e.button)||!o.accept(e))return;
// A press on a diamond may become a drag that pulls its galaxy outward; until it moves it is still a tap.
if(e.target.closest('.centre')){const g=e.button?-1:nearest(e);if(g>=0)pending={id:e.pointerId,g,point:point(e),x:e.clientX,y:e.clientY};return;}
// Touching a galaxy picks it up: a press on a square of another galaxy chooses that galaxy, and dragging on grows it.
const s=o.state(),pt=point(e),i=index(pt),own=s.cells[i],pick=e.button===0&&own>=0&&own!==s.selected&&Galaxies.singletonGivens(o.puzzle())[i]<0;if(!pick&&s.selected<0){o.noSelection();return;}const before=o.snapshot(),g=pick?own:s.selected;e.preventDefault();if(pick)o.select(g);drag={id:e.pointerId,point:pt,g,to:!pick&&(e.button===2||own===g)?-1:g,before,visited:new Set()};o.start();try{root.setPointerCapture(e.pointerId);}catch(_){}
if(pick){drag.visited.add(i);const j=Galaxies.topology(o.puzzle()).pairs[g][i];if(j>=0)drag.visited.add(j);o.focus(i);o.preview();}else paint(i);});
root.addEventListener('click',e=>{if(e.pointerId===rejected){e.preventDefault();e.stopImmediatePropagation();rejected=null;}},true);
// Once a press on a diamond has travelled, the squares touching the diamond fill and the drag paints from there.
function pull(e){const cell=root.getBoundingClientRect().width/o.puzzle().w;if(Math.hypot(e.clientX-pending.x,e.clientY-pending.y)<Math.max(10,Math.min(cell*.45,28)))return;const{id,g,point:from}=pending;pending=null;if(!o.accept(e))return;const before=o.snapshot();o.select(g);drag={id,point:from,g,to:g,before,visited:new Set()};rejected=id;o.start();try{root.setPointerCapture(id);}catch(_){}for(const i of Galaxies.topology(o.puzzle()).cores[g])paint(i);}
root.addEventListener('pointermove',e=>{if(pending&&!drag&&e.pointerId===pending.id)pull(e);for(const sample of e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])move(sample);});for(const type of['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,end);for(const type of['pointerup','pointercancel'])document.addEventListener(type,end);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});root.addEventListener('contextmenu',e=>e.preventDefault());return{cancel,get active(){return!!drag;}};}
window.GalaxiesPaint={bind};})();
