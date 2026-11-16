/* Validate against pinned rules, never against a browser-supplied rule module. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('sources.json',root),'utf8'));
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const fields={akari:['w','h','cells'],galaxies:['w','h','centres'],bridges:['w','h','islands'],slant:['w','h','clues'],fold:['w','h','pairs'],horologist:['W','H','drive','clocks','pillars','tray'],tilt:['levels'],cast:['n','maxH','left','right','plan','cubes'],'shoo-minimal':['cells','walls'],'tilt-3d':['levels'],'cube-maze':['n','masks','spout','marble','g'],tangles:['tiles','start','links','rings','offsets'],weaves:['rows','cols','pins']};
// Games scored by a count, and the file that holds each game's boards.
const POLICY={horologist:'hits-v1',tilt:'moves-v1',fold:'folds-v1',cast:'hits-v1','shoo-minimal':'hits-v1','tilt-3d':'moves-v1','cube-maze':'moves-v1',tangles:'hits-v1',weaves:'hits-v1'};
const BOARDS={horologist:'boards.js',cast:'boards.js','shoo-minimal':'boards.js','cube-maze':'boards.js',tangles:'boards.js',weaves:'boards.js'};
const cache=new Map();
function load(game,path){
  const key=game+'/'+path;
  if(cache.has(key))return cache.get(key);
  const source=manifest.games.find(g=>g.id===game)?.files.find(f=>f.path===key);
  if(!source)throw Error('Unpinned rule file');
  const file=new URL('imports/'+key,root),data=readFileSync(file);
  if(createHash('sha256').update(data).digest('hex')!==source.sha256)throw Error('Rule source mismatch');
  const result=require(fileURLToPath(file));cache.set(key,result);return result;
}
// Shoo · Minimal describes a board with no walls as walls: [].
const layout=(game,p)=>Object.fromEntries(fields[game].filter(k=>p[k]!==undefined||game==='shoo-minimal'&&k==='walls').map(k=>[k,k==='walls'&&game==='shoo-minimal'?p[k]||[]:p[k]]));
const bounded=(a,max)=>Array.isArray(a)&&a.length<=max;
const point=p=>({level:p.level,row:p.row,col:p.col});
function tiltValue(E,p,proof){
  const states=proof.states;
  if(!bounded(states,512)||states.length<2)return null;
  if(!same(point(states[0]),E.start(p))||states[0].moves!==0)return null;
  for(let n=1;n<states.length;n++){
    const a=states[n-1],b=states[n];
    if(b.moves===0&&same(point(b),E.start(p)))continue; // Existing Restart is undoable.
    if(!Number.isSafeInteger(b.moves)||b.moves!==a.moves+1)return null;
    if(!E.ORDER.some(dir=>{const next=E.slide(p,a,dir);return next.moved&&same(point(next),point(b))&&!!next.solved===!!b.solved;}))return null;
  }
  const last=states.at(-1);
  return last.solved?last.moves:null;
}
function horologistValue(E,p,proof){
  if(!bounded(proof.history,500)||!E.valid(p,proof.placed)||proof.hits!==proof.history.length||!E.inspect(p,proof.placed).solved)return null;
  const states=[...proof.history,{placed:proof.placed,hits:proof.hits}];
  if(states[0].hits!==0||states[0].placed.length)return null;
  for(let n=1;n<states.length;n++){
    const a=states[n-1],b=states[n];
    if(b.hits!==n||!E.valid(p,b.placed))return null;
    const removed=a.placed.filter(w=>!b.placed.some(v=>same(v,w)));
    const added=b.placed.filter(w=>!a.placed.some(v=>same(v,w)));
    if(removed.length>1||added.length>1||removed.length+added.length===0||removed.length&&added.length&&removed[0].size!==added[0].size)return null;
  }
  return proof.hits;
}
// Cast: every hit sets one column or carries one cube; the value is the hit count.
function castValue(E,p,proof){
  const states=Array.isArray(proof.history)?[...proof.history,proof.heights]:null;
  if(!states||!bounded(states,1024)||states.length<2||!Number.isSafeInteger(proof.hits)||proof.hits!==states.length-1)return null;
  const grid=h=>Array.isArray(h)&&h.length===p.n&&h.every(row=>Array.isArray(row)&&row.length===p.n&&row.every(v=>Number.isInteger(v)&&v>=0&&v<=p.maxH));
  if(!states.every(grid)||!same(states[0],E.start(p)))return null;
  for(let n=1;n<states.length;n++){
    const a=states[n-1],b=states[n],changed=[];
    for(let r=0;r<p.n;r++)for(let c=0;c<p.n;c++)if(a[r][c]!==b[r][c])changed.push([r,c]);
    if(changed.length===1){const [r,c]=changed[0];if(!same(E.set(p,a,r,c,b[r][c]),b))return null;}
    else if(changed.length===2){
      const [[r1,c1],[r2,c2]]=changed,from=a[r1][c1]>b[r1][c1]?[r1,c1]:[r2,c2],to=from===changed[0]?[r2,c2]:[r1,c1];
      const lifted=E.set(p,a,from[0],from[1],a[from[0]][from[1]]-1);
      if(!lifted||!same(E.set(p,lifted,to[0],to[1],a[to[0]][to[1]]+1),b))return null;
    }else return null;
  }
  return E.solved(p,proof.heights)?proof.hits:null;
}
// Shoo · Minimal: every tap moves at least one bee; Restart is undoable. The value is the tap count.
function shooValue(E,p,proof){
  const states=proof.states;
  if(!bounded(states,1024)||states.length<2)return null;
  const start=E.start(p),ok=s=>s&&Number.isSafeInteger(s.bees)&&s.bees>=0&&Number.isSafeInteger(s.hits)&&s.hits>=0;
  if(!states.every(ok)||states[0].bees!==start||states[0].hits!==0)return null;
  const n=E.layout(p).n;
  for(let k=1;k<states.length;k++){
    const a=states[k-1],b=states[k];
    if(b.hits===0&&b.bees===start)continue;
    if(b.hits!==a.hits+1||b.bees===a.bees)return null;
    let found=false;for(let i=0;i<n&&!found;i++)found=E.shoo(p,a.bees,i).mask===b.bees;
    if(!found)return null;
  }
  const last=states.at(-1);
  return E.solved(last.bees)?last.hits:null;
}
// Tilt · 3D: every move slides the marble; the value is the move count.
function tilt3dValue(E,p,proof){
  const moves=proof.moves;
  if(!bounded(moves,512)||!moves.length)return null;
  let state=E.start(p),solved=false;
  for(const dir of moves){
    if(solved||typeof dir!=='string'||!Object.prototype.hasOwnProperty.call(E.DIRS,dir))return null;
    const r=E.slide(p,state,dir);if(!r.moved)return null;
    state={level:r.level,row:r.row,col:r.col};solved=r.solved;
  }
  return solved?moves.length:null;
}
// Cube Maze: every tip or turn counts, even one that changes nothing; the marble must leave by the spout.
function cubeMazeValue(E,p,proof){
  const moves=proof.moves;
  if(!bounded(moves,512)||!moves.length)return null;
  const move=m=>Array.isArray(m)&&(m.length===2?m[0]==='tip'&&Number.isInteger(m[1]):m.length===3&&typeof m[0]==='string'&&Number.isInteger(m[1])&&Number.isInteger(m[2]));
  let state=E.normalize(p);
  for(const m of moves){
    if(state.out||!move(m)||!E.validMove(state,m))return null;
    state=E.apply(state,m).state;
  }
  return state.out?moves.length:null;
}
// Tangles: a move turns a tile with its linked group ([tile, steps], one hit whatever the steps) or a ring
// (['ring', k, steps], a hit for every step). No move follows the one that closes every line.
function tanglesValue(E,p,proof){
  const moves=proof.moves;
  if(!bounded(moves,2048)||!moves.length)return null;
  let rots=p.start.slice(),offsets=p.rings?p.offsets.slice():undefined,hits=0;
  const closed=()=>E.solved(E.arrange(p,offsets),rots);
  for(const m of moves){
    if(closed()||!Array.isArray(m))return null;
    if(m.length===3){
      const [kind,k,steps]=m;
      if(kind!=='ring'||!(p.rings||[]).includes(k)||!Number.isInteger(steps)||!steps||Math.abs(steps)>36)return null;
      ({rots,offsets}=E.turnRing(p,rots,offsets,k,steps));hits+=Math.abs(steps);
    }else if(m.length===2){
      const [i,steps]=m;
      if(!Number.isInteger(i)||!p.tiles[i]||!Number.isInteger(steps)||steps<1||steps>6)return null;
      rots=E.turnUnit(p,rots,i,steps);hits++;
    }else return null;
  }
  return closed()?hits:null;
}
// Weaves: every hit flips one free crossing, and flipping one back counts too; the cloth must hold at the end.
// The fifty fixed boards are the only ones: the game makes no boards of its own, so any other id finds no board.
function weavesValue(E,p,proof){
  const moves=proof.moves;
  if(!bounded(moves,4096)||!moves.length)return null;
  let grid=E.start(p);
  for(const m of moves){
    if(!Array.isArray(m)||m.length!==2||!Number.isInteger(m[0])||!Number.isInteger(m[1]))return null;
    grid=E.flip(p,grid,m[0],m[1]);
    if(!grid)return null;
  }
  return E.solved(p,grid)?moves.length:null;
}
function generated(E,game,g,levels){
  if(!g||!Number.isInteger(g.seed)||g.seed<0||g.seed>4294967295||!['Easy','Normal','Hard'].includes(g.difficulty)||g.version!==E.VERSION)return null;
  if(game==='akari'||game==='galaxies')return E.generate(g.seed,g.difficulty,{pool:levels});
  if(game==='slant')return E.generate(g.seed,g.difficulty,{pool:levels.seedPool});
  if(game==='bridges')return E.generate(g.seed,g.difficulty,levels);
  return E.generate(g.seed,g.difficulty);
}

export async function validateProof(request){
  const {identity:i,proof,elapsedMs}=request;
  try{
    if(!i||!proof||!Number.isSafeInteger(elapsedMs)||elapsedMs<0)return{valid:false};
    if(i.game==='hexsweeper'){
      const {validateHexProof}=await import('./hex-validator.mjs');
      return {valid:true,...await validateHexProof(request)};
    }
    const pin=manifest.games.find(g=>g.id===i.game);if(!pin)return{valid:false};
    const policy=POLICY[i.game]||'time-v1';
    const rulePath=i.game==='bending'?'well.mjs':'engine.js';
    const rules=pin.files.find(f=>f.path===i.game+'/'+rulePath)?.sha256.slice(0,16);
    if(i.rulesVersion!==rules||i.scoringPolicy!==policy)return{valid:false};
    const modes={slant:['standard','hard'],bridges:['classic','circuits'],notan:['campaign','plus','endless']}[i.game]||['campaign'];
    if(!modes.includes(i.mode))return{valid:false};
    let p,E,value=elapsedMs,puzzleLayout;
    if(i.game==='bending'){
      const {boards}=await import('../imports/bending/boards.mjs');
      const {placed}=await import('../imports/bending/well.mjs');
      p=boards.find((p,n)=>String(p.id||n+1)===i.puzzleId);
      if(!p||!bounded(proof.planets,p.answer.length)||proof.planets.length!==p.answer.length||proof.planets.some(n=>!Number.isInteger(n))||new Set(proof.planets).size!==proof.planets.length||!placed(p,proof.planets).solved)return{valid:false};
      puzzleLayout=p;
    }else{
      E=load(i.game,'engine.js');
      // Tangles' fifty boards are its first twelve (boards.js) and the campaign's thirty-eight (campaign.js).
      const L=i.game==='tangles'?[...load('tangles','boards.js'),...load('tangles','campaign.js')]:load(i.game,BOARDS[i.game]||'levels.js');
      if(i.game==='notan'){
        const lists=i.mode==='plus'?load('notan','plus-levels.js'):L;
        const entry=lists.find(p=>p.id===i.puzzleId);
        p=entry?E.fromArt(entry.art):null;
        if(i.mode==='endless'&&proof.generated&&Number.isInteger(proof.generated.seed)&&[5,8,10,12,15].includes(proof.generated.size)&&i.puzzleId===`endless:${proof.generated.size}:${proof.generated.seed}`)p=E.generate(proof.generated.seed,proof.generated.size,proof.generated.size);
        if(!p||!bounded(proof.cells,p.w*p.h)||proof.cells.length!==p.w*p.h||proof.cells.some(n=>![0,1,2].includes(n)))return{valid:false};
        const clues=E.cluesOf(p.sol,p.w,p.h),actual=E.cluesOf(proof.cells.map(v=>v===1?1:0),p.w,p.h);
        if(!same(clues,actual))return{valid:false};puzzleLayout={w:p.w,h:p.h,...clues};
      }else{
        p=i.puzzleId==='generated'?generated(E,i.game,proof.generated,L):L.find(p=>p.id===i.puzzleId);
        if(!p)return{valid:false};puzzleLayout=layout(i.game,p);
        if(i.game==='fold'){
          if(!bounded(proof.path,32))return{valid:false};let state=E.initial(p);
          for(const move of proof.path){if(!move||!['h','v'].includes(move.axis)||!Number.isSafeInteger(move.k))return{valid:false};state=E.fold(state,move,move.side);if(!state)return{valid:false};}
          if(!E.inspect(p,state).solved)return{valid:false};value=state.folds;
        }else if(i.game==='horologist')value=horologistValue(E,p,proof);
        else if(i.game==='tilt')value=tiltValue(E,p,proof);
        else if(i.game==='cast')value=castValue(E,p,proof);
        else if(i.game==='shoo-minimal')value=shooValue(E,p,proof);
        else if(i.game==='tilt-3d')value=tilt3dValue(E,p,proof);
        else if(i.game==='cube-maze')value=cubeMazeValue(E,p,proof);
        else if(i.game==='tangles')value=tanglesValue(E,p,proof);
        else if(i.game==='weaves')value=weavesValue(E,p,proof);
        else if(!E.stateValid(p,proof.cells)||!E.inspect(p,proof.cells).solved)return{valid:false};
      }
    }
    if(value===null||digest(puzzleLayout)!==i.layoutHash)return{valid:false};
    return{valid:true,value};
  }catch{return{valid:false};}
}

export const validatorInternals={canonical,digest,layout,load,horologistValue,tiltValue,castValue,shooValue,tilt3dValue,cubeMazeValue,tanglesValue,weavesValue,POLICY};
