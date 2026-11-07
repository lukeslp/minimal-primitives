/* Fold rules and seeded search. Luke Steuber. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Fold=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='fold-4',DIFFICULTIES=['Easy','Normal','Hard'];
const integer=Number.isInteger;
function valid(p){if(!p||!integer(p.w)||!integer(p.h)||p.w<1||p.h<1||p.w>6||p.h>6||!Array.isArray(p.pairs)||p.pairs.length<1||p.pairs.length>4)return false;const seen=new Set();return p.pairs.every(q=>Array.isArray(q)&&q.length===2&&q.every(i=>integer(i)&&i>=0&&i<p.w*p.h&&!seen.has(i)&&seen.add(i)));}
function initial(p){if(!valid(p))throw Error('Invalid board');return{bounds:[0,0,p.w,p.h],pos:Array.from({length:p.w*p.h},(_,i)=>[i%p.w,Math.floor(i/p.w)]),z:Array(p.w*p.h).fill(0),folds:0};}
function shape(s){if(!s||!Array.isArray(s.bounds)||s.bounds.length!==4||!s.bounds.every(integer)||!Array.isArray(s.pos)||!s.pos.length||!integer(s.folds)||s.folds<0||s.folds>10)return false;const[x0,y0,x1,y1]=s.bounds;if(x0<0||y0<0||x1>6||y1>6||x0>=x1||y0>=y1)return false;if(!s.pos.every(q=>Array.isArray(q)&&q.length===2&&q.every(integer)&&q[0]>=x0&&q[0]<x1&&q[1]>=y0&&q[1]<y1))return false;if(!Array.isArray(s.z)||s.z.length!==s.pos.length||!s.z.every(v=>integer(v)&&v>=0))return false;
// Layers at one position are numbered from the bottom with no gaps.
const stacks=new Map();s.pos.forEach((q,i)=>{const k=q[0]+','+q[1];if(!stacks.has(k))stacks.set(k,[]);stacks.get(k).push(s.z[i]);});for(const zs of stacks.values()){zs.sort((a,b)=>a-b);if(zs.some((v,i)=>v!==i))return false;}return true;}
function stateValid(p,s){return valid(p)&&shape(s)&&s.pos.length===p.w*p.h&&s.bounds[2]<=p.w&&s.bounds[3]<=p.h;}
function creases(s){if(!shape(s))return[];const[x0,y0,x1,y1]=s.bounds,out=[];for(let k=x0+1;k<x1;k++)out.push({axis:'v',k});for(let k=y0+1;k<y1;k++)out.push({axis:'h',k});return out;}
function sides(s,c){if(!shape(s)||!c||!['v','h'].includes(c.axis)||!integer(c.k))return[];const a=c.axis==='v'?0:1,lo=s.bounds[a],hi=s.bounds[a+2];if(c.k<=lo||c.k>=hi)return[];const n=c.k-lo,m=hi-c.k;return[n<=m?(a===0?'left':'top'):null,m<=n?(a===0?'right':'bottom'):null].filter(Boolean);}
function moves(s){return creases(s).flatMap(c=>sides(s,c).map(side=>({...c,side})));}
// The folded side turns over as one piece: each of its stacks lands upside down on top of whatever lies there.
function fold(s,c,side){if(!sides(s,c).includes(side))return null;const a=c.axis==='v'?0:1,low=side==='left'||side==='top',bounds=s.bounds.slice();bounds[a+(low?0:2)]=c.k;
const moving=q=>low?q[a]<c.k:q[a]>=c.k,at=q=>q[0]+','+q[1],height=new Map(),resting=new Map();
s.pos.forEach(q=>{const m=moving(q)?height:resting,k=at(q);m.set(k,(m.get(k)||0)+1);});
const pos=[],z=[];s.pos.forEach((q,i)=>{const r=q.slice();if(!moving(q)){pos.push(r);z.push(s.z[i]);return;}r[a]=2*c.k-1-r[a];pos.push(r);z.push((resting.get(at(r))||0)+height.get(at(q))-1-s.z[i]);});
return{bounds,pos,z,folds:s.folds+1};}
// A ring is a hole punched in the sheet; a dot is ink printed on the front. Turned over, the ink only shows through the paper.
// Looking down at one square: through any holes on top you see the first layer that is not a hole, or the table.
function stack(s,x,y){const out=[];s.pos.forEach((q,i)=>{if(q[0]===x&&q[1]===y)out.push(i);});return out.sort((i,j)=>s.z[j]-s.z[i]);}
// Every reflection turns a square over and moves it an odd number of columns or rows, so a square lies
// face down exactly when it has travelled an odd distance from where it started.
function turned(p,s,i){return((s.pos[i][0]-i%p.w+s.pos[i][1]-Math.floor(i/p.w))&1)===1;}
// `overHole` says the paper on top lies straight on a hole in the sheet beneath: covered, but the paper is thin enough to tell.
// `back` says the paper on top shows its back and `underBack` that the sheet seen through a hole does. They need the state;
// `below` reads the faces from underneath, for the reverse of a flap in the air.
function look(p,cells,s,below){const dots=new Set(p.pairs.map(q=>q[0])),holes=new Set(p.pairs.map(q=>q[1]));let n=0;while(n<cells.length&&holes.has(cells[n]))n++;
const back=i=>!!s&&i!==undefined&&turned(p,s,i)!==!!below,under=n===cells.length?'table':dots.has(cells[n])?'dot':'paper',buried=cells.slice(n+(under==='dot'?1:0)).some(i=>dots.has(i)||holes.has(i)),underBack=n>0&&back(cells[n]);
return{kind:n?'hole':under==='dot'?'dot':'paper',holes:n,under:n?under:null,layers:cells.length,buried,seated:n===1&&under==='dot'&&!buried&&!underBack,back:back(cells[0]),underBack,overHole:n===0&&cells.length>1&&holes.has(cells[1])};}
function view(p,s){const[x0,y0,x1,y1]=s.bounds,out=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)out.push({x,y,...look(p,stack(s,x,y),s)});return out;}
// Solved when a dot shows through every hole: each marked square is one hole lying on one dot that is face up, with nothing else marked beneath.
function inspect(p,s){if(!stateValid(p,s))return{solved:false,seated:0};const v=view(p,s),seated=v.filter(c=>c.seated).length;
return{solved:seated===p.pairs.length&&v.every(c=>c.seated||(c.kind==='paper'&&!c.buried)),seated};}
// Original cell indices give the position map its stable order; equal stacks retain every identity.
function key(s){return s.bounds.join(',')+'|'+s.pos.map((q,i)=>i+':'+q.join(',')+','+s.z[i]).join(';');}
// Breadth-first over whole states. `limit` stops after that many folds; `budget` stops after that many states (complete is then false).
function search(p,s=initial(p),limit=12,budget=400000){if(!stateValid(p,s))return{min:null,count:0,solution:null,complete:true};let frontier=[{s,ways:1,path:[]}],depth=0;const seen=new Set([key(s)]);
while(frontier.length){const winners=frontier.filter(n=>inspect(p,n.s).solved);if(winners.length)return{min:depth,count:Math.min(2,winners.reduce((n,v)=>n+v.ways,0)),solution:winners[0].path,complete:true};if(depth>=limit)return{min:null,count:0,solution:null,complete:false};
const next=new Map();for(const n of frontier)for(const m of moves(n.s)){const t=fold(n.s,m,m.side),k=key(t);if(seen.has(k))continue;const old=next.get(k);if(old)old.ways=Math.min(2,old.ways+n.ways);else next.set(k,{s:t,ways:n.ways,path:[...n.path,m]});}
frontier=[...next.values()];for(const k of next.keys())seen.add(k);if(seen.size>budget)return{min:null,count:0,solution:null,complete:false};depth++;}return{min:null,count:0,solution:null,complete:true};}
function solve(p,s=initial(p)){return search(p,s).solution;}
function count(p,s=initial(p)){const{min,count}=search(p,s);return{min,count};}
// True only when no sequence of folds can finish from here; null when the search was cut short.
function dead(p,s){const r=search(p,s,12,60000);return r.solution?false:r.complete?true:null;}
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// [smallest side, largest side, fewest folds, most folds]
const PROFILE={Easy:[2,4,1,2],Normal:[3,5,2,3],Hard:[4,6,4,5]};
// Most scatterings of holes and dots cannot be finished, so a board is built backwards: fold a blank sheet at random,
// then punch a hole in the top layer and ink the layer beneath it where that layer is face up, at as many squares as there are pairs.
function build(r,w,h,pairs,folds){const pick=n=>Math.floor(r()*n);let s=initial({w,h,pairs:[[0,1]]});for(let k=0;k<folds;k++){const mv=moves(s);if(!mv.length)return null;const m=mv[pick(mv.length)];s=fold(s,m,m.side);}
const[x0,y0,x1,y1]=s.bounds,spots=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const st=stack(s,x,y);if(st.length>1&&!turned({w,h},s,st[1]))spots.push(st);}
if(spots.length<pairs)return null;for(let k=spots.length-1;k>0;k--){const j=pick(k+1);[spots[k],spots[j]]=[spots[j],spots[k]];}
return{w,h,pairs:spots.slice(0,pairs).map(st=>[st[1],st[0]])};}
function candidate(r,d){const[lo,hi,fmin,fmax]=PROFILE[d],pick=n=>Math.floor(r()*n),w=lo+pick(hi-lo+1),h=lo+pick(hi-lo+1),folds=fmin+pick(fmax-fmin+1);return{board:build(r,w,h,d==='Easy'?1+pick(2):2+pick(2),folds),folds};}
function generate(seed,difficulty='Hard'){if(!integer(seed)||seed<0||seed>4294967295||!DIFFICULTIES.includes(difficulty))throw Error('Invalid seed or difficulty');const r=rng(seed),[, ,lo]=PROFILE[difficulty];
for(let tries=1;tries<=4000;tries++){const{board:p,folds}=candidate(r,difficulty);if(!p)continue;const a=search(p,initial(p),folds);if(a.min!==null&&a.min>=lo)return{...p,min:a.min,seed,difficulty,version:VERSION};}throw Error('No board found');}
return{VERSION,DIFFICULTIES,valid,initial,stateValid,creases,sides,moves,fold,stack,turned,look,view,inspect,key,search,solve,count,dead,rng,build,generate};
});
