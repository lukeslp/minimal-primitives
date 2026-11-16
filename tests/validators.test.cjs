const test=require('node:test');
const assert=require('node:assert/strict');
const sources=require('../sources.json');
const root=require('node:path').resolve(__dirname,'..');

test('pinned engines accept real campaign solutions and reject changed layouts/results',async()=>{
 const {validateProof,validatorInternals:{digest,layout}}=await import('../adapters/validators.mjs');
 let count=0;
 for(const game of ['notan','akari','galaxies','bridges','slant','fold','horologist','tilt','bending']){
  const E=game==='bending'?null:require(root+'/imports/'+game+'/engine.js');
  const levels=game==='bending'?(await import('../imports/bending/boards.mjs')).boards:require(root+'/imports/'+game+'/'+(game==='horologist'?'boards.js':'levels.js'));
  for(const p of levels){
   let proof,l,mode={bridges:'classic',slant:'standard'}[game]||'campaign';
   if(game==='bending'){proof={planets:p.answer};l=p;}
   else if(game==='notan'){const q=E.fromArt(p.art);proof={cells:Array.from(q.sol)};l={w:q.w,h:q.h,...E.cluesOf(q.sol,q.w,q.h)};}
   else{
    l=layout(game,p);
    if(game==='fold')proof={path:E.solve(p)};
    else if(game==='tilt'){
     let state={...E.start(p),moves:0,solved:false};const states=[state];
     for(const dir of E.solve(p)){const r=E.slide(p,state,dir);state={level:r.level,row:r.row,col:r.col,moves:state.moves+1,solved:r.solved};states.push(state);}proof={states};
    }else if(game==='horologist'){
     const placed=[],history=[];for(const wheel of E.search(p).best){history.push({placed:structuredClone(placed),hits:placed.length});placed.push(wheel);}proof={placed,history,hits:placed.length};
    }else{const answer=E.logical(p);proof={cells:answer.state||answer.solution||answer.lo};}
   }
   const identity={game,mode,puzzleId:p.id||String(levels.indexOf(p)+1),layoutHash:digest(l),rulesVersion:sources.games.find(g=>g.id===game).files.find(f=>f.path===game+'/'+(game==='bending'?'well.mjs':'engine.js')).sha256.slice(0,16),scoringPolicy:{fold:'folds-v1',horologist:'hits-v1',tilt:'moves-v1'}[game]||'time-v1'};
   assert.equal((await validateProof({identity,proof,elapsedMs:4000})).valid,true,game+' '+identity.puzzleId);
   assert.equal((await validateProof({identity:{...identity,layoutHash:'0'.repeat(64)},proof,elapsedMs:4000})).valid,false);
   assert.equal((await validateProof({identity:{...identity,rulesVersion:'unsupported'},proof,elapsedMs:4000})).valid,false);
   assert.equal((await validateProof({identity,proof:{},elapsedMs:4000})).valid,false);
   count++;
  }
 }
 assert.ok(count>=450,'all fixed catalogs, including the four expanded campaigns');
});

test('replay move counts cannot be supplied independently of the moves',async()=>{
 const {validatorInternals:{horologistValue,tiltValue}}=await import('../adapters/validators.mjs');
 const E=require('../imports/horologist/engine.js'),p=require('../imports/horologist/boards.js')[0];
 assert.equal(horologistValue(E,p,{placed:E.search(p).best,hits:0,history:[]}),null);
 const T=require('../imports/tilt/engine.js'),b=require('../imports/tilt/levels.js')[0];
 assert.equal(tiltValue(T,b,{states:[{...T.start(b),moves:0,solved:false},{level:1,row:1,col:1,moves:1,solved:true}]}),null);
});

test('Cast, Shoo · Minimal, Tilt · 3D, Cube Maze, Tangles and Weaves are scored by their counts from replayed proofs',async()=>{
 const {validateProof,validatorInternals:{digest,layout}}=await import('../adapters/validators.mjs');
 const rules=game=>sources.games.find(g=>g.id===game).files.find(f=>f.path===game+'/engine.js').sha256.slice(0,16);
 const identity=(game,p,policy)=>({game,mode:'campaign',puzzleId:p.id,layoutHash:digest(layout(game,p)),rulesVersion:rules(game),scoringPolicy:policy});
 const C=require('../imports/cast/engine.js');let count=0;
 for(const p of require('../imports/cast/boards.js')){
  const answer=C.solve(p).solution,history=[];let h=C.start(p);
  for(let r=0;r<p.n;r++)for(let c=0;c<p.n;c++)while(h[r][c]<answer[r][c]){history.push(h);h=C.set(p,h,r,c,h[r][c]+1);}
  const proof={board:p.id,heights:h,hits:history.length,history};
  assert.deepEqual(await validateProof({identity:identity('cast',p,'hits-v1'),proof,elapsedMs:5000}),{valid:true,value:history.length},'cast '+p.id);
  assert.equal((await validateProof({identity:identity('cast',p,'hits-v1'),proof:{...proof,hits:history.length+1},elapsedMs:5000})).valid,false,'cast hits must match the replay');
  assert.equal((await validateProof({identity:identity('cast',p,'time-v1'),proof,elapsedMs:5000})).valid,false);count++;
 }
 const S=require('../imports/shoo-minimal/engine.js');
 for(const p of require('../imports/shoo-minimal/boards.js').slice(0,20)){
  let bees=S.start(p);const states=[{bees,hits:0}];
  // The game's own hint gives the next look; solve() returns sorted sets, not tap order.
  for(let guard=0;!S.solved(bees)&&guard<64;guard++){const i=S.hint(p,bees).look;bees=S.shoo(p,bees,i).mask;states.push({bees,hits:states.length});}
  assert.deepEqual(await validateProof({identity:identity('shoo-minimal',p,'hits-v1'),proof:{states},elapsedMs:5000}),{valid:true,value:states.length-1},'shoo '+p.id);
  assert.equal((await validateProof({identity:identity('shoo-minimal',p,'hits-v1'),proof:{states:[states[0],{...states.at(-1),hits:1}].concat(states.length>2?[]:[{...states.at(-1),hits:2}])},elapsedMs:5000})).valid,false,'a skipped tap is refused');count++;
 }
 const T=require('../imports/tilt-3d/engine.js');
 for(const p of require('../imports/tilt-3d/levels.js')){
  const moves=T.solve(p);
  assert.deepEqual(await validateProof({identity:identity('tilt-3d',p,'moves-v1'),proof:{board:p.id,moves},elapsedMs:5000}),{valid:true,value:moves.length},'tilt-3d '+p.id);
  assert.equal((await validateProof({identity:identity('tilt-3d',p,'moves-v1'),proof:{board:p.id,moves:moves.slice(0,-1)},elapsedMs:5000})).valid,false,'an unfinished replay is refused');count++;
 }
 // Cube Maze stores one shortest answer per board; a move after the marble leaves, or a move list cut short, is refused.
 const M=require('../imports/cube-maze/engine.js');
 for(const p of require('../imports/cube-maze/boards.js')){
  const moves=p.solution;
  assert.equal(M.run(p,moves).out,true,'cube-maze '+p.id+' stored answer');
  assert.deepEqual(await validateProof({identity:identity('cube-maze',p,'moves-v1'),proof:{board:p.id,moves},elapsedMs:5000}),{valid:true,value:moves.length},'cube-maze '+p.id);
  assert.equal((await validateProof({identity:identity('cube-maze',p,'moves-v1'),proof:{board:p.id,moves:moves.slice(0,-1)},elapsedMs:5000})).valid,false,'an unfinished replay is refused');
  assert.equal((await validateProof({identity:identity('cube-maze',p,'moves-v1'),proof:{board:p.id,moves:[...moves,moves[0]]},elapsedMs:5000})).valid,false,'no move after the marble leaves');
  assert.equal((await validateProof({identity:identity('cube-maze',p,'time-v1'),proof:{board:p.id,moves},elapsedMs:5000})).valid,false);count++;
 }
 // Tangles: the engine's one answer gives a par replay for every board: each ring to its turn the short way round,
 // then one turn for each tile or linked group off its answer. Hits are counted from the replay, never supplied.
 const G=require('../imports/tangles/engine.js'),tangles=[...require('../imports/tangles/boards.js'),...require('../imports/tangles/campaign.js')];
 assert.equal(tangles.length,50);
 for(const p of tangles){
  const special=!!(p.links||p.rings),moves=[];
  if(special){
   const {solution}=G.solveAll(p,p.start,p.offsets,1);
   for(const k of p.rings||[]){const s=((solution.offsets[k]||0)-(p.offsets[k]||0)+6)%6;if(s)moves.push(['ring',k,s<=3?s:s-6]);}
   for(const u of solution.units)if(!u.turns.includes(0))moves.push([u.tiles[0],Math.min(...u.turns)]);
   assert.equal(moves.reduce((n,m)=>n+(m.length===3?Math.abs(m[2]):1),0),G.parAll(p),'tangles '+p.id+' replay is par');
  }else{
   const {solution}=G.solve(p,1);
   p.tiles.forEach((t,i)=>{const s=Math.min(...solution[i].map(r=>(r-p.start[i]+6)%6));if(s)moves.push([i,s]);});
   assert.equal(moves.length,G.par(p),'tangles '+p.id+' replay is par');
  }
  const value=moves.reduce((n,m)=>n+(m.length===3?Math.abs(m[2]):1),0),id=identity('tangles',p,'hits-v1');
  assert.deepEqual(await validateProof({identity:id,proof:{board:p.id,moves},elapsedMs:5000}),{valid:true,value},'tangles '+p.id);
  assert.equal((await validateProof({identity:id,proof:{board:p.id,moves:moves.slice(0,-1)},elapsedMs:5000})).valid,false,'an unfinished replay is refused');
  assert.equal((await validateProof({identity:id,proof:{board:p.id,moves:[...moves,[0,1]]},elapsedMs:5000})).valid,false,'no move after every line closes');
  assert.equal((await validateProof({identity:id,proof:{board:p.id,moves:[[0,6],...moves]},elapsedMs:5000})).value,value+1,'a full turn changes nothing and still counts');
  assert.equal((await validateProof({identity:id,proof:{board:p.id,moves:[[0,0],...moves]},elapsedMs:5000})).valid,false,'a turn of no steps is not a move');
  assert.equal((await validateProof({identity:id,proof:{board:p.id,moves:[['ring',99,1],...moves]},elapsedMs:5000})).valid,false,'only a turning ring turns');
  assert.equal((await validateProof({identity:identity('tangles',p,'time-v1'),proof:{board:p.id,moves},elapsedMs:5000})).valid,false);count++;
 }
 // Weaves: the hits from the unwoven start to the one answer are the board's par; every hit is replayed.
 const W=require('../imports/weaves/engine.js'),weaves=require('../imports/weaves/boards.js');
 assert.equal(weaves.length,50);
 for(const p of weaves){
  const start=W.start(p),answer=W.solve(p,1).solution,moves=[];
  for(let r=0;r<p.rows;r++)for(let c=0;c<p.cols;c++)if(start[r][c]!==answer[r][c])moves.push([r,c]);
  const id=identity('weaves',p,'hits-v1'),check=async proof=>validateProof({identity:id,proof,elapsedMs:5000});
  assert.equal(moves.length,W.par(p),'weaves '+p.id+' par');
  assert.deepEqual(await check({board:p.id,moves}),{valid:true,value:moves.length},'weaves '+p.id);
  assert.deepEqual(await check({board:p.id,moves:[moves[0],moves[0],...moves]}),{valid:true,value:moves.length+2},'flipping back counts too');
  assert.equal((await check({board:p.id,moves:moves.slice(0,-1)})).valid,false,'an unfinished cloth is refused');
  assert.equal((await check({board:p.id,moves:[...moves,moves[0]]})).valid,false,'a cloth unwoven again is refused');
  assert.equal((await check({board:p.id,moves:[p.pins[0].slice(0,2),...moves]})).valid,false,'a pinned crossing cannot be flipped');
  assert.equal((await check({board:p.id,moves:[[p.rows,0],...moves]})).valid,false,'a crossing off the cloth is refused');
  assert.equal((await check({board:p.id,moves:[]})).valid,false);
  assert.equal((await check({board:p.id,moves,hits:1})).value,moves.length,'a count sent beside the moves is ignored');
  assert.equal((await validateProof({identity:identity('weaves',p,'time-v1'),proof:{board:p.id,moves},elapsedMs:5000})).valid,false);
  // Weaves has no free play: a board that is not one of the fifty has no lane, whatever its layout hash says.
  for(const puzzleId of ['generated','w51'])assert.equal((await validateProof({identity:{...id,puzzleId},proof:{board:puzzleId,moves,generated:{seed:1,difficulty:'Easy'}},elapsedMs:5000})).valid,false,puzzleId);
  assert.equal((await validateProof({identity:{...id,mode:'free'},proof:{board:p.id,moves},elapsedMs:5000})).valid,false,'no free-play mode');
  count++;
 }
 assert.ok(count>=220);
});
