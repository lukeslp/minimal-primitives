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
const fields={akari:['w','h','cells'],galaxies:['w','h','centres'],bridges:['w','h','islands'],slant:['w','h','clues'],fold:['w','h','pairs'],horologist:['W','H','drive','clocks','pillars','tray'],tilt:['levels']};
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
const layout=(game,p)=>Object.fromEntries(fields[game].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
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
    const policy={horologist:'hits-v1',tilt:'moves-v1',fold:'folds-v1'}[i.game]||'time-v1';
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
      const L=load(i.game,i.game==='horologist'?'boards.js':'levels.js');
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
        else if(!E.stateValid(p,proof.cells)||!E.inspect(p,proof.cells).solved)return{valid:false};
      }
    }
    if(value===null||digest(puzzleLayout)!==i.layoutHash)return{valid:false};
    return{valid:true,value};
  }catch{return{valid:false};}
}

export const validatorInternals={canonical,digest,layout,load,horologistValue,tiltValue};
