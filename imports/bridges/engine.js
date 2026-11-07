/* Bridges rules and interval deductions. Original boards by Luke Steuber. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.Bridges=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const VERSION='bridges-1',DIFFICULTIES=['Easy','Normal','Hard'];
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function topology(p){const edges=[],adj=p.islands.map(()=>[]),cross=[];for(let a=0;a<p.islands.length;a++)for(let b=a+1;b<p.islands.length;b++){const A=p.islands[a],B=p.islands[b];if(A.x!==B.x&&A.y!==B.y)continue;if(p.islands.some((C,i)=>i!==a&&i!==b&&((A.x===B.x&&C.x===A.x&&C.y>Math.min(A.y,B.y)&&C.y<Math.max(A.y,B.y))||(A.y===B.y&&C.y===A.y&&C.x>Math.min(A.x,B.x)&&C.x<Math.max(A.x,B.x)))))continue;const i=edges.length;edges.push({a,b});adj[a].push(i);adj[b].push(i);cross.push([]);}
for(let i=0;i<edges.length;i++)for(let j=0;j<i;j++){const e=edges[i],f=edges[j],A=p.islands[e.a],B=p.islands[e.b],C=p.islands[f.a],D=p.islands[f.b];let H,V;if(A.y===B.y&&C.x===D.x){H=[A,B];V=[C,D];}else if(A.x===B.x&&C.y===D.y){H=[C,D];V=[A,B];}else continue;if(V[0].x>Math.min(H[0].x,H[1].x)&&V[0].x<Math.max(H[0].x,H[1].x)&&H[0].y>Math.min(V[0].y,V[1].y)&&H[0].y<Math.max(V[0].y,V[1].y)){cross[i].push(j);cross[j].push(i);}}
return{edges,adj,cross};}
function valid(p){if(!p||!Number.isInteger(p.w)||!Number.isInteger(p.h)||p.w<2||p.h<2||p.w>9||p.h>9||!Array.isArray(p.islands)||p.islands.length<2||p.islands.length>81)return false;const seen=new Set();for(const i of p.islands){if(!i||!Number.isInteger(i.x)||!Number.isInteger(i.y)||i.x<0||i.x>=p.w||i.y<0||i.y>=p.h||!Number.isInteger(i.n)||i.n<1||i.n>8||seen.has(i.x+','+i.y))return false;seen.add(i.x+','+i.y);}return true;}
function stateValid(p,s){return valid(p)&&Array.isArray(s)&&s.length===topology(p).edges.length&&s.every(v=>Number.isInteger(v)&&v>=0&&v<=2);}
function components(p,t,weights,skip=-1){const groups=[],seen=new Set();for(let i=0;i<p.islands.length;i++)if(!seen.has(i)){const a=[i];seen.add(i);for(let k=0;k<a.length;k++)for(const e of t.adj[a[k]])if(e!==skip&&weights[e]>0){const E=t.edges[e],j=E.a===a[k]?E.b:E.a;if(!seen.has(j)){seen.add(j);a.push(j);}}groups.push(a);}return groups;}
function inspect(p,s){if(!stateValid(p,s))return{valid:false,solved:false,violations:[{rule:'state',text:'Invalid board marks.',islands:[],edges:[]}],degrees:[],groups:[]};const t=topology(p),degrees=t.adj.map(a=>a.reduce((n,e)=>n+s[e],0)),violations=[];degrees.forEach((n,i)=>{if(n>p.islands[i].n)violations.push({rule:'degree',text:'This island has too many bridges.',islands:[i],edges:t.adj[i]});});t.cross.forEach((a,i)=>{if(s[i]>0)for(const j of a)if(j<i&&s[j]>0)violations.push({rule:'crossing',text:'Bridges cannot cross.',islands:[t.edges[i].a,t.edges[i].b,t.edges[j].a,t.edges[j].b],edges:[i,j]});});const exact=degrees.every((n,i)=>n===p.islands[i].n),groups=components(p,t,s);if(exact&&groups.length>1)violations.push({rule:'connectivity',text:'Every clue is filled, but the network is disconnected.',islands:groups[0],edges:s.flatMap((v,e)=>v?[e]:[])});return{valid:true,solved:exact&&groups.length===1&&!violations.length,degrees,groups,violations};}
/* No branches, trial placements or solution lookup: each interval change has a rule witness. */
function logical(p,initial=null,options={}){const limit=options.budget??2000000;let operations=0;const tick=()=>{if(operations>=limit)throw Error('budget');operations++;};if(!valid(p))return{status:'invalid',trace:[],operations};const t=topology(p),s=initial||t.edges.map(()=>0);if(!stateValid(p,s))return{status:'invalid',trace:[],operations};const lo=s.slice(),hi=s.map(()=>2),trace=[];let contradiction=null;
function change(e,l,h,rule,islands,edges,side,text){tick();l=Math.max(lo[e],l);h=Math.min(hi[e],h);if(l>h){contradiction={rule,islands,edges,text:'These marks contradict '+text.toLowerCase()};return false;}if(l===lo[e]&&h===hi[e])return false;lo[e]=l;hi[e]=h;trace.push({edge:e,lo:l,hi:h,rule,islands: [...islands],edges:[...edges],side:side?[...side]:[],text});return true;}
try{while(!contradiction){let changed=false;for(let i=0;i<p.islands.length&&!changed;i++){tick();const a=t.adj[i],low=a.reduce((n,e)=>n+lo[e],0),high=a.reduce((n,e)=>n+hi[e],0),n=p.islands[i].n;if(low>n||high<n){contradiction={rule:'degree',islands:[i],edges:a.slice(),text:'This clue cannot be met by the remaining bridge counts.'};break;}for(const e of a)if(change(e,n-(high-hi[e]),n-(low-lo[e]),'degree',[i],a,null,'Clue '+n+' bounds the bridges at this island.')){changed=true;break;}}
if(contradiction)break;if(changed)continue;
for(let e=0;e<t.edges.length&&!changed;e++)if(lo[e]>0)for(const f of t.cross[e])if(change(f,0,0,'crossing',[t.edges[e].a,t.edges[e].b],[e,f],null,'A required bridge blocks the crossing route.')){changed=true;break;}
if(contradiction)break;if(changed)continue;if(options.basic)break;
const possible=components(p,t,hi);if(possible.length>1){contradiction={rule:'connectivity',islands:possible[0],edges:[],text:'The remaining routes cannot connect every island.'};break;}
// A bridge of the possible graph is the only exit from a whole region.
for(let e=0;e<t.edges.length&&!changed;e++)if(hi[e]>0){tick();const groups=components(p,t,hi,e);if(groups.length!==2)continue;const side=groups[0],sum=side.reduce((n,i)=>n+p.islands[i].n,0),min=sum%2?1:2;changed=change(e,min,2,'cut',side,[e],side,'This region has only one exit. It needs '+min+' bridge'+(min===1?'':'s')+' to stay connected with its clue total.');}
if(contradiction)break;if(changed)continue;
// The cut of a confirmed region has the parity of its clue total. Internal
// bridges contribute twice; at least one exit must remain for connectivity.
for(const side of components(p,t,lo))if(side.length<p.islands.length&&!changed){tick();const set=new Set(side),inside=[],exits=[];t.edges.forEach(({a,b},e)=>{if(set.has(a)&&set.has(b))inside.push(e);else if(set.has(a)!==set.has(b))exits.push(e);});const sum=side.reduce((n,i)=>n+p.islands[i].n,0),parity=sum%2;let min=Math.max(1,sum-2*inside.reduce((n,e)=>n+hi[e],0),exits.reduce((n,e)=>n+lo[e],0)),max=Math.min(sum-2*inside.reduce((n,e)=>n+lo[e],0),exits.reduce((n,e)=>n+hi[e],0));if(min%2!==parity)min++;if(max%2!==parity)max--;if(min>max){contradiction={rule:'cut',islands:side,edges:exits,side,text:'This region cannot keep an exit with the parity of its clue total.'};break;}for(const e of exits){const l=min-exits.filter(f=>f!==e).reduce((n,f)=>n+hi[f],0),h=max-exits.filter(f=>f!==e).reduce((n,f)=>n+lo[f],0);if(change(e,l,h,'region-cut',side,[...inside,...exits],side,'Bridges inside this region count twice; its exits must match the clue total and keep the network connected.')){changed=true;break;}}}
if(contradiction)break;if(changed)continue;
// Closing a proper confirmed component would strand the rest of the network.
const groups=components(p,t,lo),groupOf=p.islands.map((_,i)=>groups.findIndex(a=>a.includes(i))),degree=t.adj.map(a=>a.reduce((n,e)=>n+lo[e],0));
for(let e=0;e<t.edges.length&&!changed;e++)if(hi[e]>lo[e]){tick();const {a,b}=t.edges[e],side=[...new Set([...groups[groupOf[a]],...groups[groupOf[b]]])];if(side.length===p.islands.length)continue;for(let v=lo[e]+1;v<=hi[e];v++){const extra=v-lo[e];if(side.every(i=>degree[i]+((i===a||i===b)?extra:0)===p.islands[i].n)){changed=change(e,lo[e],v-1,'isolation',side,[e],side,'Filling this route would close a separate network; leave an exit for the other islands.');break;}}}
if(!changed)break;}
}catch(err){if(err.message!=='budget')throw err;return{status:'exhausted',trace,lo,hi,operations};}
return{status:contradiction?'contradiction':lo.every((v,e)=>v===hi[e])&&inspect(p,lo).solved?'solved':'stalled',trace,lo,hi,contradiction,operations};}
function next(p,s){const v=inspect(p,s);if(v.violations.length)return{contradiction:v.violations[0],...v.violations[0]};const r=logical(p,s);if(r.contradiction)return{contradiction:r.contradiction,...r.contradiction};const k=r.trace.findIndex(m=>m.lo>s[m.edge]);if(k<0)return null;const m=r.trace[k],proof=r.trace.slice(0,k+1),global=proof.slice(0,-1).reverse().find(a=>['cut','region-cut','isolation'].includes(a.rule));if(global)return{...m,rule:global.rule,side:global.side,islands:[...new Set([...m.islands,...global.islands])],edges:[...new Set([...m.edges,...global.edges])],text:global.rule==='isolation'?'This route needs '+m.lo+' to keep the region connected to the other islands.':'This route needs '+m.lo+'; region exits must connect and match the parity of its clue total.',proof};return{...m,proof};}
function transform(p,variant){const rotate=variant%4,flip=variant>=4;let w=p.w,h=p.h;const islands=p.islands.map(a=>{let x=flip?p.w-1-a.x:a.x,y=a.y,W=p.w,H=p.h;for(let i=0;i<rotate;i++){[x,y]=[H-1-y,x];[W,H]=[H,W];}w=W;h=H;return{x,y,n:a.n};}).sort((a,b)=>a.y-b.y||a.x-b.x);return{w,h,islands,difficulty:p.difficulty};}
// Build one planar connected network, then discard its construction weights.
function candidate(r,size,tick){
 const islands=[];for(let y=0;y<size;y++)for(let x=0;x<size;x++){tick();if(r()<.34)islands.push({x,y,n:1});}if(islands.length<5)return null;
 const p={w:size,h:size,islands},t=topology(p),s=t.edges.map(()=>0),order=t.edges.map((_,i)=>i);
 for(let i=order.length-1;i>0;i--){tick();const j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 const parent=islands.map((_,i)=>i),find=i=>{while(parent[i]!==i){tick();i=parent[i];}return i;};
 for(const e of order){tick();const {a,b}=t.edges[e],A=find(a),B=find(b);if(A===B||t.cross[e].some(f=>s[f]>0))continue;s[e]=r()<.5?2:1;parent[A]=B;}
 if(new Set(islands.map((_,i)=>find(i))).size!==1)return null;
 for(const e of order){tick();if(!s[e]&&!t.cross[e].some(f=>s[f]>0)&&r()<.25)s[e]=r()<.4?2:1;}
 for(let i=0;i<islands.length;i++){tick();islands[i].n=t.adj[i].reduce((n,e)=>n+s[e],0);}return p;
}
function generate(seed,difficulty,pool=[],options={}){
 if(!Number.isInteger(seed)||seed<0||seed>4294967295||!DIFFICULTIES.includes(difficulty))throw Error('Invalid seed identity');
 const limit=options.budget??1200000;if(!Number.isSafeInteger(limit)||limit<0)throw Error('Invalid operation budget');
 const r=rng(seed),range={Easy:[4,5],Normal:[5,6,7],Hard:[6,7,8,9]}[difficulty];let operations=0,attempted=0,reason='attempt limit';
 const tick=()=>{if(operations>=limit)throw Error('budget');operations++;};
 try{while(attempted<48){if(operations>=limit){reason='operation budget';break;}attempted++;const size=range[Math.floor(r()*range.length)],p=candidate(r,size,tick);if(!p)continue;
  const full=logical(p,null,{budget:limit-operations});operations+=full.operations;if(full.status==='exhausted'){reason='operation budget';break;}if(full.status!=='solved')continue;
  const basic=logical(p,null,{basic:true,budget:limit-operations});operations+=basic.operations;if(basic.status==='exhausted'){reason='operation budget';break;}
  if(difficulty==='Easy'&&basic.status!=='solved'||difficulty==='Hard'&&(basic.status!=='stalled'||!full.trace.some(m=>['cut','region-cut','isolation'].includes(m.rule)&&m.side.length>=3&&m.side.length<p.islands.length-1)))continue;
  return{...p,seed,difficulty,version:VERSION,fallback:false,operations,attempted,method:'fresh layout'};
 }}catch(err){if(err.message!=='budget')throw err;reason='operation budget';}
 if(operations>=limit)reason='operation budget';
 // Fallback identity is fixed by the seed, independent of search exhaustion.
 const fallbackRng=rng(seed),bases=pool.filter(p=>p.difficulty===difficulty).slice().sort((a,b)=>a.id.localeCompare(b.id)),base=bases[Math.floor(fallbackRng()*bases.length)],variant=Math.floor(fallbackRng()*8);
 if(!base)return{status:'exhausted',operations,attempted,seed,difficulty,version:VERSION,method:'fresh layout',reason};
 return{...transform(base,variant),seed,difficulty,version:VERSION,fallback:true,fallbackId:base.id,variant,operations,attempted,method:'campaign variation',reason};
}
return{VERSION,DIFFICULTIES,rng,valid,stateValid,topology,components,inspect,logical,next,transform,generate};});
