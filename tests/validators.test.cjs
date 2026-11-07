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
