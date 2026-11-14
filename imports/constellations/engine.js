/* Constellations rules. Luke Steuber. A board is a set of stars at explicit positions and a list of routes
   between them; a route carries zero, one or two threads, threads cannot cross, and every star must receive
   exactly its need. Independent groups are valid and no global connectivity deduction is used. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Constellations=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 function valid(p){
  if(!p||typeof p.id!=='string'||!Array.isArray(p.stars)||p.stars.length<2||p.stars.length>100||!Array.isArray(p.routes)||p.routes.length<1||p.routes.length>400)return false;
  if(!p.stars.every((s,i)=>s&&finite(s.x)&&finite(s.y)&&Number.isInteger(s.need)&&s.need>=1&&s.need<=8&&!p.stars.slice(0,i).some(t=>t.x===s.x&&t.y===s.y)))return false;
  const seen=new Set();
  return p.routes.every(r=>{if(!Array.isArray(r)||r.length!==2||!r.every(i=>Number.isInteger(i)&&i>=0&&i<p.stars.length)||r[0]===r[1])return false;const key=Math.min(...r)+','+Math.max(...r);if(seen.has(key))return false;seen.add(key);return true;});
 }
 // Two routes cross when their segments properly intersect; routes that share a star never cross.
 function crosses(A,B,C,D){const o=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);const d1=o(C,D,A),d2=o(C,D,B),d3=o(A,B,C),d4=o(A,B,D);return(d1>0&&d2<0||d1<0&&d2>0)&&(d3>0&&d4<0||d3<0&&d4>0);}
 const cache=new WeakMap();
 function topology(p){
  if(!valid(p))throw Error('Invalid constellation');
  if(cache.has(p))return cache.get(p);
  const edges=p.routes.map(([a,b])=>({a:Math.min(a,b),b:Math.max(a,b)})),adj=p.stars.map(()=>[]);
  edges.forEach(({a,b},e)=>{adj[a].push(e);adj[b].push(e);});
  const cross=edges.map(()=>[]);
  for(let i=0;i<edges.length;i++)for(let j=0;j<i;j++){
   const e=edges[i],f=edges[j];if(e.a===f.a||e.a===f.b||e.b===f.a||e.b===f.b)continue;
   if(crosses(p.stars[e.a],p.stars[e.b],p.stars[f.a],p.stars[f.b])){cross[i].push(j);cross[j].push(i);}
  }
  const t={edges,adj,cross};cache.set(p,t);return t;
 }
 function stateValid(p,weights){return valid(p)&&Array.isArray(weights)&&weights.length===topology(p).edges.length&&weights.every(w=>Number.isInteger(w)&&w>=0&&w<=2);}
 function inspect(p,weights){
  if(!stateValid(p,weights))return{valid:false,solved:false,errors:[{rule:'state',stars:[],edges:[]}],degrees:[],groups:[]};
  const t=topology(p),degrees=t.adj.map(es=>es.reduce((s,e)=>s+weights[e],0)),errors=[];
  degrees.forEach((d,i)=>{if(d>p.stars[i].need)errors.push({rule:'degree',stars:[i],edges:t.adj[i]});});
  t.cross.forEach((fs,e)=>{if(weights[e])for(const f of fs)if(f<e&&weights[f])errors.push({rule:'crossing',stars:[t.edges[e].a,t.edges[e].b,t.edges[f].a,t.edges[f].b],edges:[e,f]});});
  const seen=new Set(),groups=[];
  p.stars.forEach((_,i)=>{if(seen.has(i))return;const group=[i];seen.add(i);for(let k=0;k<group.length;k++)for(const e of t.adj[group[k]])if(weights[e]){const {a,b}=t.edges[e],next=a===group[k]?b:a;if(!seen.has(next)){seen.add(next);group.push(next);}}groups.push(group);});
  return{valid:true,solved:!errors.length&&degrees.every((d,i)=>d===p.stars[i].need),degrees,groups,errors};
 }
 function bounds(p,weights){
  const report=inspect(p,weights);if(!report.valid||report.errors.length)return{contradiction:report.errors[0]};
  const t=topology(p),lo=weights.slice(),hi=weights.map(()=>2),trace=[];
  for(let n=0;n<1000;n++){
   let changed=false;
   for(let e=0;e<lo.length;e++)if(lo[e])for(const f of t.cross[e])if(hi[f]){if(lo[f])return{contradiction:{rule:'crossing',edges:[e,f],stars:[]}};hi[f]=0;changed=true;}
   for(let i=0;i<p.stars.length;i++){
    const low=t.adj[i].reduce((s,e)=>s+lo[e],0),high=t.adj[i].reduce((s,e)=>s+hi[e],0),need=p.stars[i].need;
    if(low>need||high<need)return{contradiction:{rule:'degree',stars:[i],edges:t.adj[i]}};
    for(const e of t.adj[i]){
     const l=Math.max(lo[e],need-high+hi[e]),h=Math.min(hi[e],need-low+lo[e]);
     if(l>h)return{contradiction:{rule:'degree',stars:[i],edges:[e]}};
     if(l>lo[e])trace.push({edge:e,count:l,stars:[i]});
     if(l!==lo[e]||h!==hi[e]){lo[e]=l;hi[e]=h;changed=true;}
    }
   }
   if(!changed)return{lo,hi,trace};
  }
  throw Error('Deduction budget exceeded');
 }
 // The next step, from the stars' needs and the crossing rule alone, never a stored answer.
 // - What those force from an empty board: on every board here, the whole solution, which is then the only one.
 // - While every placed thread is within that, the next step is a route the deduction from the placed threads
 //   raises: { edge, count, stars }, the count it needs and the star whose need forces it. It is part of the solution.
 // - A placed thread beyond it is a mistake: { error, fix: { edge, count, stars } }, where the fix takes one thread
 //   off a route that has too many, preferring a route the error names (an overfull star's, or a crossing pair).
 // - Where the deduction from empty does not finish a board, Hint keeps to what follows from the placed threads:
 //   a forced step, or { error, fix: null } when they conflict.
 // Routes marked in avoid (locked ones) are passed over while another choice remains.
 function hint(p,weights,avoid=[]){
  const report=inspect(p,weights);if(!report.valid||report.solved)return null;
  const whole=bounds(p,weights.map(()=>0)),known=!whole.contradiction&&inspect(p,whole.lo).solved?whole.lo:null;
  const b=bounds(p,weights),over=weights.map((w,e)=>!!known&&w>known[e]);
  if(!b.contradiction&&!over.some(Boolean)){const steps=b.trace.filter(x=>x.count>weights[x.edge]);return steps.find(x=>!avoid[x.edge])||steps[0]||null;}
  const error=report.errors[0]||b.contradiction||{rule:'way',stars:[],edges:[]};
  if(!known)return{error,fix:null};
  const t=topology(p),named=new Set([...error.edges,...error.stars.flatMap(i=>t.adj[i])]),order=[...weights.keys()].filter(e=>over[e]).sort((x,y)=>(named.has(y)-named.has(x))||(!!avoid[x]-!!avoid[y])||x-y),e=order[0];
  return{error,fix:{edge:e,count:weights[e]-1,stars:[t.edges[e].a,t.edges[e].b]}};
 }
 return{VERSION:'constellations-2',valid,topology,crosses,stateValid,inspect,bounds,hint};
});
