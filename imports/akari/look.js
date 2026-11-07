/* I join the saves before choosing the board's look. Luke Steuber. */
(function(){'use strict';
const root=document.documentElement,here=root.dataset.look,other=root.dataset.other,marker='akari.look.v1',settings='akari.settings.v1',scheme=matchMedia('(prefers-color-scheme:dark)'),object=v=>v&&typeof v==='object'&&!Array.isArray(v),keys=(v,a)=>object(v)&&Object.keys(v).length===a.length&&a.every(k=>Object.hasOwn(v,k)),themes=['system','light','dark'],diffs=['Easy','Normal','Hard'],id=v=>typeof v==='string'&&/^a(0[1-9]|[1-4][0-9]|50)$/.test(v),cells=v=>Array.isArray(v)&&v.length<=81&&v.every(n=>Number.isInteger(n)&&n>=0&&n<=2);
const valid={progress:v=>keys(v,['version','completed'])&&v.version===1&&Array.isArray(v.completed)&&v.completed.every(id),settings:v=>keys(v,['version','theme','motion','zoom','difficulty'])&&v.version===1&&themes.includes(v.theme)&&['system','reduce'].includes(v.motion)&&['fit','large'].includes(v.zoom)&&diffs.includes(v.difficulty),current:v=>keys(v,['version','at','boards','generated'])&&v.version===1&&(id(v.at)||v.at==='generated')&&object(v.boards)&&Object.entries(v.boards).every(([k,s])=>id(k)&&cells(s))&&(v.generated===null||(keys(v.generated,['seed','difficulty','version','state'])&&Number.isInteger(v.generated.seed)&&v.generated.seed>=0&&v.generated.seed<=4294967295&&diffs.includes(v.generated.difficulty)&&v.generated.version==='akari-1'&&cells(v.generated.state)))&&(v.at!=='generated'||v.generated!==null)};
try{if(localStorage.getItem(marker)!=='1'){const writes=[];for(const name of ['progress','current','settings']){const key='akari.'+name+'.v1',raw=localStorage.getItem(key),old=localStorage.getItem('akari.classic.'+name+'.v1');let a,b;try{a=raw===null?null:JSON.parse(raw);b=old===null?null:JSON.parse(old);if((raw!==null&&!valid[name](a))||(old!==null&&!valid[name](b)))continue;}catch(_){continue;}if(!a&&!b)continue;let value;if(name==='progress')value={version:1,completed:[...new Set([...(a?.completed||[]),...(b?.completed||[])])]};else if(name==='current')value=a?{...a,boards:{...b?.boards,...a.boards}}:b;else value={...(a||b),theme:b?b.theme:'system'};writes.push([key,JSON.stringify(value)]);}for(const [key,value]of writes)localStorage.setItem(key,value);localStorage.setItem(marker,'1');}}catch(_){}
const can=!!other&&['lukesteuber.com','dr.eamer.dev','staging.datapoems.io'].includes(location.hostname)&&location.pathname.startsWith('/games/');
function theme(){try{const v=JSON.parse(localStorage.getItem(settings));if(valid.settings(v))return v.theme;}catch(_){}return 'system';}
let explicitLook=new URLSearchParams(location.search).get('look');if(!['light','dark'].includes(explicitLook))explicitLook=null;
function want(){const t=explicitLook||theme();return t==='system'?(scheme.matches?'dark':'light'):t;}
// The limit of two hops in five seconds is a guard against two pages sending each other back and forth on their own. A change made by hand in Settings is not that: it always goes, and clears the count.
function go(byHand){if(api.leaving)return true;if(byHand===true&&explicitLook){explicitLook=null;const url=new URL(location.href);url.searchParams.delete('look');history.replaceState(null,'',url.pathname+url.search+url.hash);}if(!can||want()===here)return false;const key='akari.look.hops.v1';if(byHand===true){try{sessionStorage.removeItem(key);}catch(_){}}else{try{const now=Date.now(),raw=sessionStorage.getItem(key);let hops;try{hops=JSON.parse(raw);}catch(_){hops=[];}hops=Array.isArray(hops)?hops.filter(t=>Number.isFinite(t)&&t<=now&&now-t<5000):[];if(hops.length>=2)return false;sessionStorage.setItem(key,JSON.stringify([...hops,now]));}catch(_){return false;}}root.style.visibility='hidden';api.leaving=true;location.replace(other+location.search+location.hash);return true;}
const api=window.AkariLook={here,can,want,go,leaving:false};go();scheme.addEventListener('change',()=>{if(theme()==='system')go();});
document.addEventListener('DOMContentLoaded',()=>{
 const link=document.getElementById('look-other');if(!link||!other)return;const target=here==='dark'?'light':'dark';
 function refresh(){const url=new URL(other,location.href);url.search=location.search;url.hash=location.hash;url.searchParams.set('look',target);link.href=url.href;}
 refresh();link.addEventListener('focus',refresh);link.addEventListener('pointerdown',refresh);
 link.addEventListener('click',event=>{
  refresh();if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const select=document.getElementById('theme');if(select){select.value=target;select.dispatchEvent(new Event('change',{bubbles:true}));}
  if(api.leaving)event.preventDefault();
 });
});

})();
