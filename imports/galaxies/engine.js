/* Original Spiral Galaxies boards and rules. Luke Steuber. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.Galaxies=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const VERSION='galaxies-2',DIFFICULTIES=['Easy','Normal','Hard'];
function integer(v){return Number.isSafeInteger(v)&&v>=0;}
function meter(limit=2000000){if(!integer(limit))throw TypeError('Budget must be a finite nonnegative integer');return{limit,used:0,tick(n=1){if(!integer(n))throw TypeError('Invalid operation count');if(n>this.limit-this.used){this.used=this.limit;throw EXHAUSTED;}this.used+=n;}};}
const EXHAUSTED=Object.freeze({exhausted:true});
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function valid(p){return p&&Number.isInteger(p.w)&&Number.isInteger(p.h)&&p.w>=1&&p.h>=1&&p.w<=9&&p.h<=9&&Array.isArray(p.centres)&&p.centres.length>0&&p.centres.length<=p.w*p.h&&p.centres.every(c=>Array.isArray(c)&&c.length===2&&c.every(Number.isInteger)&&c[0]>0&&c[0]<2*p.w&&c[1]>0&&c[1]<2*p.h)&&new Set(p.centres.map(c=>c.join(','))).size===p.centres.length;}
function stateValid(p,s){return valid(p)&&Array.isArray(s)&&s.length===p.w*p.h&&s.every(v=>Number.isInteger(v)&&v>=-1&&v<p.centres.length);}
function topology(p,b=meter()){if(!valid(p))throw TypeError('Invalid board');const n=p.w*p.h,adj=[],pairs=[],cores=[];for(let i=0;i<n;i++){b.tick();const x=i%p.w,y=Math.floor(i/p.w);adj[i]=[x>0?i-1:-1,x<p.w-1?i+1:-1,y>0?i-p.w:-1,y<p.h-1?i+p.w:-1].filter(j=>j>=0);}
for(const[cx,cy]of p.centres){const pair=[],core=[];for(let i=0;i<n;i++){b.tick();const x=i%p.w,y=Math.floor(i/p.w),xx=cx-x-1,yy=cy-y-1;pair[i]=xx>=0&&xx<p.w&&yy>=0&&yy<p.h?yy*p.w+xx:-1;if(Math.abs(2*x+1-cx)<=1&&Math.abs(2*y+1-cy)<=1)core.push(i);}pairs.push(pair);cores.push(core);}return{n,adj,pairs,cores};}
function reach(t,allowed,start,b){const seen=new Set();if(!allowed(start))return seen;const q=[start];seen.add(start);for(let k=0;k<q.length;k++){b.tick();for(const j of t.adj[q[k]]){b.tick();if(!seen.has(j)&&allowed(j)){seen.add(j);q.push(j);}}}return seen;}
// Only pre-fill a single-cell centre with no connected legal opposite pair.
// Reserve other centres' cores, then prune disconnected/asymmetric reach.
// This uses geometry alone, not the solved partition or deduction trace.
const givenCache=new WeakMap();
function singletonGivens(p){if(givenCache.has(p))return givenCache.get(p).slice();const t=topology(p),cells=Array(t.n).fill(-1);for(let g=0;g<p.centres.length;g++){const core=t.cores[g];if(core.length!==1)continue;const forbidden=new Set(t.cores.flatMap((a,h)=>h===g?[]:a));let allowed=new Set(t.pairs[g].flatMap((j,i)=>j>=0&&!forbidden.has(i)&&!forbidden.has(j)?[i]:[])),seen;do{const size=allowed.size;seen=reach(t,i=>allowed.has(i),core[0],meter());allowed=new Set([...seen].filter(i=>seen.has(t.pairs[g][i])));if(allowed.size===size)break;}while(allowed.size);if(allowed.size===1&&allowed.has(core[0]))cells[core[0]]=g;}givenCache.set(p,cells);return cells.slice();}
function inspect(p,s,b=meter()){if(!stateValid(p,s))return{solved:false,errors:[],invalid:true};const t=topology(p,b),errors=new Set();for(let g=0;g<p.centres.length;g++){b.tick();const owned=[];for(let i=0;i<s.length;i++){b.tick();if(s[i]===g)owned.push(i);}const seen=reach(t,i=>s[i]===g,t.cores[g][0],b);for(const i of owned)if(t.pairs[g][i]<0||s[t.pairs[g][i]]!==g||!seen.has(i))errors.add(i);for(const i of t.cores[g])if(s[i]!==-1&&s[i]!==g)errors.add(i);}
return{solved:s.every(v=>v>=0)&&errors.size===0&&t.cores.every((a,g)=>a.every(i=>s[i]===g)),errors:[...errors]};}
function initial(p,t,b){const d=Array.from({length:t.n},()=>new Set());for(let g=0;g<p.centres.length;g++)for(let i=0;i<t.n;i++){b.tick();if(t.pairs[g][i]>=0)d[i].add(g);}return d;}
// Every step removes impossible ownership or establishes forced ownership.
// No branch, answer lookup, recursive search, or speculative solver call.
function logical(p,state=null,options={}){const b=options.meter||meter(options.budget),trace=[];let domains,t;try{t=topology(p,b);domains=initial(p,t,b);
const remove=(i,g,rule,support,other=null)=>{b.tick();if(!domains[i].has(g))return false;domains[i].delete(g);trace.push({kind:'remove',i,g,rule,support,other});return true;};
const force=(i,g,rule,support)=>{for(const h of [...domains[i]]){b.tick();if(h!==g)remove(i,h,rule,support,g);}};
for(let g=0;g<p.centres.length;g++)for(const i of t.cores[g]){b.tick();force(i,g,'centre',t.cores[g]);}
if(state){if(!stateValid(p,state))throw TypeError('Invalid state');for(let i=0;i<t.n;i++){b.tick();if(state[i]>=0)force(i,state[i],'mark',[i]);}}
let changed=true;while(changed){b.tick();changed=false;if(domains.some(a=>a.size===0))return{status:'contradiction',trace,domains,operations:b.used};
for(let i=0;i<t.n;i++){b.tick();if(domains[i].size===1){const g=[...domains[i]][0],j=t.pairs[g][i];if(j>=0&&domains[j].size>1){force(j,g,'pair',[i,j]);changed=true;}}}
for(let g=0;g<p.centres.length;g++){
b.tick();for(let i=0;i<t.n;i++){b.tick();if(domains[i].has(g)&&!domains[t.pairs[g][i]]?.has(g))changed=remove(i,g,'rotation',[i,t.pairs[g][i]].filter(j=>j>=0))||changed;}
const seen=reach(t,i=>domains[i].has(g),t.cores[g][0],b);for(let i=0;i<t.n;i++){b.tick();if(domains[i].has(g)&&!seen.has(i))changed=remove(i,g,'connectivity',[...seen])||changed;}
}
if(changed)continue;
if(domains.every(a=>a.size===1)){const solution=domains.map(a=>[...a][0]);return{status:inspect(p,solution,b).solved?'solved':'contradiction',solution,trace,domains,operations:b.used};}
// A region must retain a route from its centre to all mandatory cells.
// Removing a rotational pair tests a geometric cut, never a solution branch.
for(let h=0;h<p.centres.length&&!changed;h++){
b.tick();const mandatory=[];for(let i=0;i<t.n;i++){b.tick();if(domains[i].size===1&&domains[i].has(h))mandatory.push(i);}
for(let i=0;i<t.n&&!changed;i++){
b.tick();if(!domains[i].has(h)||domains[i].size===1)continue;const j=t.pairs[h][i];if(j<i)continue;const seen=reach(t,k=>k!==i&&k!==j&&domains[k].has(h),t.cores[h][0],b);
const missing=mandatory.find(k=>!seen.has(k));if(missing!==undefined){force(i,h,'bridge',[t.cores[h][0],missing,i,j]);force(j,h,'bridge',[t.cores[h][0],missing,i,j]);changed=true;}
}}
if(changed)continue;if(options.advanced===false)break;
// Global shared corridor: giving this pair to g blocks another region h.
for(let g=0;g<p.centres.length&&!changed;g++)for(let i=0;i<t.n&&!changed;i++){
b.tick();if(!domains[i].has(g)||domains[i].size===1)continue;const j=t.pairs[g][i];if(j<i)continue;
for(let h=0;h<p.centres.length&&!changed;h++){
b.tick();if(h===g||(!domains[i].has(h)&&!domains[j].has(h)))continue;
const mandatory=[];for(let k=0;k<t.n;k++){b.tick();if(domains[k].size===1&&domains[k].has(h))mandatory.push(k);}
const blocked=new Set([i,j,t.pairs[h][i],t.pairs[h][j]]);const seen=reach(t,k=>!blocked.has(k)&&domains[k].has(h),t.cores[h][0],b),missing=mandatory.find(k=>!seen.has(k));
if(missing!==undefined){const support=[t.cores[h][0],missing,...blocked].filter(k=>k>=0);remove(i,g,'corridor',support,h);remove(j,g,'corridor',support,h);changed=true;}
}}
}
return{status:'stalled',trace,domains,operations:b.used};
}catch(e){if(e!==EXHAUSTED)throw e;return{status:'exhausted',trace,domains,operations:b.used};}}
function next(p,state){const r=logical(p,state);if(r.status==='contradiction')return{contradiction:true,text:'These regions cannot all connect symmetrically. Undo or clear uncertain cells.'};if(r.status==='exhausted')return null;
const t=topology(p);for(let i=0;i<state.length;i++)if(state[i]===-1&&r.domains[i].size===1){const g=[...r.domains[i]][0],j=t.pairs[g][i],proof=r.trace.filter(m=>m.i===i),last=proof.at(-1);const text={centre:'The cells touching a center belong to that galaxy.',pair:'A cell and its half-turn partner must have the same center.',rotation:'A cell and its half-turn partner must have the same center.',connectivity:'Only this center can reach this pair.',bridge:'This pair is the only connection to a required cell.',corridor:'Another galaxy needs this corridor; this pair must belong here.'}[last?.rule]||'Only this center can own this rotational pair.';return{i,g,pair:[...new Set([i,j])],support:[...new Set(proof.flatMap(m=>m.support).concat(t.cores[g]))],rule:last?.rule||'domain',text};}return null;}
function paint(p,s,i,g,to=g){if(!stateValid(p,s)||!Number.isInteger(i)||i<0||i>=s.length||!Number.isInteger(g)||g<0||g>=p.centres.length)return false;const j=topology(p).pairs[g][i],givens=singletonGivens(p);if(j<0||givens[i]>=0||givens[j]>=0)return false;s[i]=to;s[j]=to;return true;}
// Independent exact-cover enumerator: enumerate each connected symmetric
// region by orbit subsets, then join disjoint regions covering the board.
// It shares no domain propagation or deduction implementation.
function enumerate(p,options={}){const b=meter(options.budget===undefined?4000000:options.budget),solutions=[],cap=options.cap===undefined?2:options.cap;if(!integer(cap)||cap<1)throw TypeError('Invalid solution cap');let complete=false;try{
if(!valid(p))throw TypeError('Invalid board');const n=p.w*p.h,regions=[];const neighbors=i=>{const x=i%p.w,y=Math.floor(i/p.w);return[x?i-1:-1,x+1<p.w?i+1:-1,y?i-p.w:-1,y+1<p.h?i+p.w:-1].filter(j=>j>=0);};
for(let g=0;g<p.centres.length;g++){b.tick();const[cx,cy]=p.centres[g],orbits=[],required=new Set(),forbidden=new Set();for(let i=0;i<n;i++){b.tick();const x=i%p.w,y=Math.floor(i/p.w),xx=cx-x-1,yy=cy-y-1;if(xx<0||xx>=p.w||yy<0||yy>=p.h)continue;const j=yy*p.w+xx;if(i>j)continue;const a=[...new Set([i,j])];orbits.push(a);}
for(let h=0;h<p.centres.length;h++){const[a,c]=p.centres[h];for(let i=0;i<n;i++){b.tick();if(Math.abs(2*(i%p.w)+1-a)<=1&&Math.abs(2*Math.floor(i/p.w)+1-c)<=1)(h===g?required:forbidden).add(i);}}
const base=new Set(),optional=[];for(const a of orbits){b.tick();if(a.some(i=>forbidden.has(i))){if(a.some(i=>required.has(i)))return{count:0,complete:true,solutions,operations:b.used};continue;}if(a.some(i=>required.has(i)))a.forEach(i=>base.add(i));else optional.push(a);}
const candidates=[];function subsets(k){b.tick();if(k===optional.length){const seen=new Set(),queue=[[...required][0]];if(!base.has(queue[0]))return;seen.add(queue[0]);for(let q=0;q<queue.length;q++){b.tick();for(const j of neighbors(queue[q])){b.tick();if(base.has(j)&&!seen.has(j)){seen.add(j);queue.push(j);}}}if(seen.size===base.size)candidates.push([...base]);return;}subsets(k+1);for(const i of optional[k])base.add(i);subsets(k+1);for(const i of optional[k])base.delete(i);}
subsets(0);regions[g]=candidates;}
const order=regions.map((a,g)=>g).sort((a,c)=>regions[a].length-regions[c].length),state=Array(n).fill(-1);
function join(k){b.tick();if(solutions.length>=cap)return;if(k===order.length){if(state.every(v=>v>=0))solutions.push(state.slice());return;}const g=order[k];for(const a of regions[g]){b.tick();let free=true;for(const i of a){b.tick();if(state[i]>=0){free=false;break;}}if(!free)continue;for(const i of a){b.tick();state[i]=g;}join(k+1);for(const i of a){b.tick();state[i]=-1;}if(solutions.length>=cap)return;}}
join(0);complete=solutions.length<cap;
}catch(e){if(e!==EXHAUSTED)throw e;}return{count:solutions.length,complete,solutions,operations:b.used};}
function transform(p,v,b=meter()){if(!integer(v)||v>7)throw TypeError('Invalid transform');let w=p.w,h=p.h,cs=p.centres.map(c=>{b.tick();return c.slice();});if(v&1)cs=cs.map(([x,y])=>{b.tick();return[2*w-x,y];});if(v&2)cs=cs.map(([x,y])=>{b.tick();return[x,2*h-y];});if(v&4){cs=cs.map(([x,y])=>{b.tick();return[y,x];});[w,h]=[h,w];}return{w,h,centres:cs,difficulty:p.difficulty};}
// Construct a fresh partition by symmetry-preserving growth. Unclaimed
// cells become centres only when growth cannot safely consume them.
function candidate(seed,difficulty,b=meter()){const random=rng(seed),sizes={Easy:[4,5],Normal:[5,6,7],Hard:[6,7,8,9]}[difficulty];if(!sizes)throw TypeError('Invalid difficulty');const w=sizes[Math.floor(random()*sizes.length)],h=sizes[Math.floor(random()*sizes.length)],state=Array(w*h).fill(-1),centres=[];
const adj=i=>[i%w?i-1:-1,i%w<w-1?i+1:-1,i>=w?i-w:-1,i<w*(h-1)?i+w:-1].filter(j=>j>=0);
for(let round=0;round<w*h;round++){b.tick(1+state.length);const blanks=state.flatMap((v,i)=>v<0?[i]:[]);if(!blanks.length)break;const start=blanks[Math.floor(random()*blanks.length)],x=start%w,y=Math.floor(start/w);let cx=2*x+1,cy=2*y+1;
const modes=[0,1,2,3];for(let k=3;k>0;k--){const j=Math.floor(random()*(k+1));[modes[k],modes[j]]=[modes[j],modes[k]];}let core;for(const mode of modes){b.tick();const a=cx+(mode&1),c=cy+(mode&2?1:0);core=[];for(let i=0;i<state.length;i++){b.tick();if(Math.abs(2*(i%w)+1-a)<=1&&Math.abs(2*Math.floor(i/w)+1-c)<=1)core.push(i);}if(a<2*w&&c<2*h&&core.every(i=>state[i]<0)){cx=a;cy=c;break;}}
const g=centres.length;centres.push([cx,cy]);for(const i of core){b.tick();state[i]=g;}
for(let pass=0;pass<10;pass++){b.tick();const choices=[];for(let i=0;i<state.length;i++){b.tick();if(state[i]>=0||!adj(i).some(j=>state[j]===g))continue;const xx=cx-i%w-1,yy=cy-Math.floor(i/w)-1,j=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&state[j]<0&&adj(j).some(k=>state[k]===g))choices.push([i,j]);}if(!choices.length||random()<.04)break;const pair=choices[Math.floor(random()*choices.length)];for(const i of pair)state[i]=g;}
}const counts=Array(centres.length).fill(0);for(const g of state){b.tick();counts[g]++;}return{w,h,centres,difficulty,singletons:counts.filter(n=>n===1).length};}
function generate(seed,difficulty,options={}){if(!integer(seed)||seed>4294967295||!DIFFICULTIES.includes(difficulty))throw TypeError('Invalid seed identity');const attempts=options.attempts===undefined?(difficulty==='Hard'?120:40):options.attempts;if(!integer(attempts))throw TypeError('Invalid attempt budget');const b=meter(options.budget===undefined?1600000:options.budget),pool=options.pool||[],stats={attempts:0,operations:0};let fallback=null;try{const eligible=[];for(const p of pool){b.tick();if(p.difficulty===difficulty)eligible.push(p);}if(eligible.length){b.tick();const random=rng(seed^0xC0FFEE),base=eligible[Math.floor(random()*eligible.length)],variant=Math.floor(random()*8);fallback={...transform(base,variant,b),seed,version:VERSION,fallback:true,fallbackId:base.id,variant};}for(let k=0;k<attempts;k++){b.tick();stats.attempts++;const p=candidate((seed+Math.imul(k+1,0x9e3779b9))>>>0,difficulty,b);if(p.singletons>Math.floor(p.centres.length*(difficulty==='Hard'?.4:.25)))continue;const r=logical(p,null,{meter:b});if(r.status!=='solved')continue;
if(difficulty==='Hard'){const basic=logical(p,null,{meter:b,advanced:false});if(basic.status==='exhausted')break;if(basic.status==='solved'||!r.trace.some(m=>m.rule==='corridor'))continue;}
const en=enumerate(p,{budget:Math.min(500000,b.limit-b.used)});b.tick(en.operations);if(en.count!==1||!en.complete)continue;stats.operations=b.used;return{...p,seed,version:VERSION,fallback:false,stats};}
}catch(e){if(e!==EXHAUSTED)throw e;}stats.operations=b.used;
return fallback?{...fallback,stats}:{status:'exhausted',stats};}
return{VERSION,DIFFICULTIES,meter,rng,valid,stateValid,topology,singletonGivens,inspect,logical,next,paint,enumerate,transform,candidate,generate};
});
