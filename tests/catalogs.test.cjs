const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const source=require('../sources.json'),receipt=require('../release/original-campaigns.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('all four fifty-board catalogs equal the accepted original releases byte for byte',async()=>{
 for(const row of receipt.catalogs){
  const file=row.game+'/'+row.catalog;
  assert.equal(sha(fs.readFileSync(new URL('../imports/'+file,'file://'+__filename))),row.sha256);
  assert.equal(sha(fs.readFileSync(new URL('../build/html/games/'+file,'file://'+__filename))),row.sha256);
  assert.equal(source.games.find(g=>g.id===row.game).files.find(f=>f.path===file).sha256,row.sha256);
  const levels=row.game==='bending'?(await import('../imports/bending/boards.mjs')).boards:require('../imports/'+file);
  assert.equal(levels.length,50);assert.equal(row.verifiedHosts.length,2);
 }
 assert.equal(receipt.catalogs.reduce((n,r)=>n+r.boards-r.originalBoards,0),132);
});
