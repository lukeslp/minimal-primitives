/* Cube Maze — Luke Steuber. Rules, moves and exact search, usable in Node, a browser or a worker. */
(function(root,factory){const E=factory();if(typeof module==='object'&&module.exports)module.exports=E;else root.CubeMazeEngine=E;
if(typeof WorkerGlobalScope!=='undefined'&&root instanceof WorkerGlobalScope)root.onmessage=e=>{const {id,state,maxDepth}=e.data;const r=E.search(state,{maxDepth,maxStates:4e6});root.postMessage({id,path:r&&r.path});};
})(typeof self!=='undefined'?self:globalThis,function(){'use strict';

// Directions are indexed +x, -x, +y, -y, +z, -z. The opposite of d is d ^ 1. A cell's tube is a
// six-bit mask of the directions it opens toward. +y is up in a board's starting position.
const DIRS=['+x','-x','+y','-y','+z','-z'],VEC=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],AXES=['x','y','z'];
const bit=d=>1<<d,opp=d=>d^1,dirOf=v=>VEC.findIndex(u=>u[0]===v[0]&&u[1]===v[1]&&u[2]===v[2]);
const cache=new Map();

// The same right-hand quarter turn as Cube · Minimal: positions are doubled integers from -(n-1) to n-1.
function rotate(v,axis,dir=1){const [x,y,z]=v;return (axis==='x'?[x,-dir*z,dir*y]:axis==='y'?[dir*z,y,-dir*x]:[-dir*y,dir*x,z]).map(v=>v||0);}

function setup(n){
 if(cache.has(n))return cache.get(n);
 if(n!==2&&n!==3)throw Error('Size must be 2 or 3');
 const count=n*n*n,cell=s=>[s%n,Math.floor(s/n)%n,Math.floor(s/n/n)],slot=(i,j,k)=>i+n*(j+n*k);
 const pos=s=>cell(s).map(c=>2*c-(n-1)),fromPos=p=>slot(...p.map(v=>(v+n-1)/2));
 const turns=[],rotDir={},rotMask={};
 for(const axis of AXES)for(const dir of [1,-1]){
  const t=DIRS.map((_,d)=>dirOf(rotate(VEC[d],axis,dir)));rotDir[axis+dir]=t;
  const m=new Uint8Array(64);for(let mask=0;mask<64;mask++){let out=0;for(let d=0;d<6;d++)if(mask&bit(d))out|=bit(t[d]);m[mask]=out;}rotMask[axis+dir]=m;
 }
 for(const axis of AXES)for(let layer=0;layer<n;layer++)for(const dir of [1,-1]){
  const a=AXES.indexOf(axis),dest=new Int8Array(count),inLayer=new Uint8Array(count);
  for(let s=0;s<count;s++){inLayer[s]=cell(s)[a]===layer?1:0;dest[s]=inLayer[s]?fromPos(rotate(pos(s),axis,dir)):s;}
  turns.push({move:[axis,layer,dir],dest,inLayer,rotDir:rotDir[axis+dir],rotMask:rotMask[axis+dir]});
 }
 // neighbour[s*6+d] is the cell beside s in direction d, or -1 past the shell.
 const neighbour=new Int8Array(count*6);
 for(let s=0;s<count;s++){const c=cell(s);for(let d=0;d<6;d++){const q=c.map((v,i)=>v+VEC[d][i]);neighbour[s*6+d]=q.every(v=>v>=0&&v<n)?slot(...q):-1;}}
 const info={n,count,cell,slot,pos,turns,neighbour,turnIndex:new Map(turns.map((t,i)=>[t.move.join(','),i]))};
 cache.set(n,info);return info;
}

// A state: { n, masks, spout:[cell, dir], marble, g, out }. g is the cube direction gravity points along.
function normalize(b){
 const n=b.n,info=setup(n);
 if(!Array.isArray(b.masks)||b.masks.length!==info.count||!b.masks.every(m=>Number.isInteger(m)&&m>=0&&m<64))throw Error('Bad masks');
 const [sc,sd]=b.spout||[];
 if(!(Number.isInteger(sc)&&sc>=0&&sc<info.count&&Number.isInteger(sd)&&sd>=0&&sd<6&&(b.masks[sc]&bit(sd))))throw Error('Bad spout');
 if(!(Number.isInteger(b.marble)&&b.marble>=0&&b.marble<info.count&&b.masks[b.marble]))throw Error('Marble must sit in a tube');
 const g=b.g===undefined?3:b.g;if(!(Number.isInteger(g)&&g>=0&&g<6))throw Error('Bad gravity');
 return {n,masks:b.masks.slice(),spout:[sc,sd],marble:b.marble,g,out:!!b.out};
}

// The marble falls straight along g while its tube opens that way and the next tube opens back.
// It leaves the cube only through the spout when the spout faces out along g.
function fall(s){
 const info=setup(s.n),path=[s.marble];let m=s.marble,out=false;
 while(s.masks[m]&bit(s.g)){
  const q=info.neighbour[m*6+s.g];
  if(q<0){out=s.spout[0]===m&&s.spout[1]===s.g;break;}
  if(!(s.masks[q]&bit(opp(s.g))))break;
  m=q;path.push(m);
 }
 return {marble:m,out,path,atEnd:!out&&!!(s.masks[m]&bit(s.g))};
}

function moves(s){const info=setup(s.n),out=[];for(let d=0;d<6;d++)if((d>>1)!==(s.g>>1))out.push(['tip',d]);for(const t of info.turns)out.push(t.move.slice());return out;}
function validMove(s,m){if(!Array.isArray(m))return false;if(m[0]==='tip')return m.length===2&&Number.isInteger(m[1])&&m[1]>=0&&m[1]<6&&(m[1]>>1)!==(s.g>>1);return m.length===3&&setup(s.n).turnIndex.has(m.join(','));}

// Applies one move and the fall that follows. Returns the new state and what moved, for drawing.
function apply(state,m){
 const s=normalize(state);
 if(s.out)throw Error('The marble has already left');
 if(!validMove(s,m))throw Error('Invalid move');
 let carried=false;
 if(m[0]==='tip')s.g=m[1];
 else{
  const t=setup(s.n).turns[setup(s.n).turnIndex.get(m.join(','))],masks=s.masks.slice();
  // Every cubie in the layer turns, including one on the axis that keeps its place.
  for(let c=0;c<masks.length;c++)if(t.inLayer[c])masks[t.dest[c]]=t.rotMask[s.masks[c]];
  if(t.inLayer[s.spout[0]])s.spout=[t.dest[s.spout[0]],t.rotDir[s.spout[1]]];
  if(t.inLayer[s.marble]){s.marble=t.dest[s.marble];carried=true;}
  s.masks=masks;
 }
 const f=fall(s);s.marble=f.marble;s.out=f.out;
 return {state:s,trace:{move:m.slice(),carried,path:f.path,out:f.out,atEnd:f.atEnd}};
}
function run(state,list){let s=normalize(state);for(const m of list)s=apply(s,m).state;return s;}
function settled(state){const s=normalize(state),f=fall(s);return f.marble===s.marble&&!f.out;}

const key=s=>s.out?'OUT':String.fromCharCode(...s.masks.map(v=>48+v))+String.fromCharCode(48+s.spout[0],48+s.spout[1],48+s.marble,48+s.g);

// Breadth-first search to the first layer where the marble can leave. Counts every shortest move
// sequence, and how many use tips only, so boards can require the verb they teach. The search works
// on compact byte states: the masks, then spout cell, spout direction, marble and gravity.
function compactMoves(n){const info=setup(n);if(info.compact)return info.compact;const list=[];for(let d=0;d<6;d++)list.push(['tip',d]);for(const t of info.turns)list.push(t.move.slice());return info.compact=list;}
function step(info,S,mi,R){
 const C=info.count;R.set(S);
 if(mi<6){if((mi>>1)===(S[C+3]>>1))return -1;R[C+3]=mi;}
 else{const t=info.turns[mi-6];for(let c=0;c<C;c++)if(t.inLayer[c])R[t.dest[c]]=t.rotMask[S[c]];
  if(t.inLayer[S[C]]){R[C]=t.dest[S[C]];R[C+1]=t.rotDir[S[C+1]];}
  if(t.inLayer[S[C+2]])R[C+2]=t.dest[S[C+2]];}
 const g=R[C+3],back=1<<(g^1),nb=info.neighbour;let m=R[C+2];
 while(R[m]&(1<<g)){const q=nb[m*6+g];if(q<0){if(R[C]===m&&R[C+1]===g)return 1;break;}if(!(R[q]&back))break;m=q;}
 R[C+2]=m;return 0;
}
function search(state,{maxDepth=8,maxStates=3e6}={}){
 const start=normalize(state);if(start.out)return {par:0,path:[],total:1,tipsOnly:1,states:1};
 const n=start.n,info=setup(n),C=info.count,list=compactMoves(n),S=new Uint8Array(C+4),R=new Uint8Array(C+4);
 S.set(start.masks);S[C]=start.spout[0];S[C+1]=start.spout[1];S[C+2]=start.marble;S[C+3]=start.g;
 const keyOf=a=>String.fromCharCode.apply(null,a),index=new Map(),keys=[],depth=[],parent=[],move=[],total=[],tips=[];
 const add=(k,d,p,m,t,o)=>{index.set(k,keys.length);keys.push(k);depth.push(d);parent.push(p);move.push(m);total.push(t);tips.push(o);return keys.length-1;};
 let frontier=[add(keyOf(S),0,-1,-1,1,1)];
 for(let d=0;d<maxDepth;d++){
  const next=[];let goalTotal=0,goalTips=0,goalParent=-1,goalMove=-1;
  for(const id of frontier){const k=keys[id];for(let i=0;i<k.length;i++)S[i]=k.charCodeAt(i);
   for(let mi=0;mi<list.length;mi++){const r=step(info,S,mi,R);if(r<0)continue;const o=mi<6?tips[id]:0;
    if(r===1){if(!goalTotal){goalParent=id;goalMove=mi;}goalTotal+=total[id];goalTips+=o;continue;}
    const rk=keyOf(R),w=index.get(rk);
    if(w===undefined){next.push(add(rk,d+1,id,mi,total[id],o));if(keys.length>maxStates)return null;}
    else if(depth[w]===d+1){total[w]+=total[id];tips[w]+=o;}
   }
  }
  if(goalTotal){const path=[list[goalMove].slice()];for(let id=goalParent;parent[id]>=0;id=parent[id])path.push(list[move[id]].slice());path.reverse();return {par:d+1,path,total:goalTotal,tipsOnly:goalTips,states:keys.length};}
  if(!next.length)break;frontier=next;
 }
 return {par:null,path:null,total:0,tipsOnly:0,states:keys.length};
}

function random(seed){let a=Number(seed)>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

return {DIRS,VEC,AXES,bit,opp,rotate,setup,normalize,fall,moves,validMove,apply,run,settled,key,search,random};
});
