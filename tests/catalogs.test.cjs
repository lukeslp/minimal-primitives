const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const source=require('../sources.json'),receipt=require('../release/original-campaigns.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Two catalogs have moved on upstream since the accepted original releases, each by its own reviewed change at the
// pin (game-riffs d3d9b9e, 0.5.9): Horologist plays the same fifty plates easiest first (7a2e367a: every plate keeps
// its id and data), and Bending keeps thirty stages, eighteen more dealt as New Game+ (305b76cf); at game-riffs
// 9ad63d8 (0.5.10, PR 196) five of Bending's thirty moved to New Game+, twenty-five and twenty-three (067f676d).
// Any other change to these four files still fails here.
const MOVED={horologist:'f77fd929ae2224d88584e999dcd94a654ce8ac853ac8a7e361cc4466b050ade1',bending:'067f676d36a922522eb7b14aac382e73f779c1a63343e381f0ef335c040e8694'};
test('all four fifty-board catalogs equal the accepted original releases byte for byte, or their reviewed successor',async()=>{
 for(const row of receipt.catalogs){
  const file=row.game+'/'+row.catalog,want=MOVED[row.game]||row.sha256;
  assert.equal(sha(fs.readFileSync(new URL('../imports/'+file,'file://'+__filename))),want);
  assert.equal(sha(fs.readFileSync(new URL('../build/html/games/'+file,'file://'+__filename))),want);
  assert.equal(source.games.find(g=>g.id===row.game).files.find(f=>f.path===file).sha256,want);
  if(row.game==='bending'){const m=await import('../imports/bending/boards.mjs');assert.equal(m.boards.length,25);assert.equal(m.pool.length,23);}
  else assert.equal(require('../imports/'+file).length,50);
  assert.equal(row.verifiedHosts.length,2);
 }
 assert.equal(receipt.catalogs.reduce((n,r)=>n+r.boards-r.originalBoards,0),132);
});
