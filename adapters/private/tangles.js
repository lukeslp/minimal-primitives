// Tangles (game-riffs loop/) keeps a board as each tile's turn, the ring turns, the hits and an undo list of positions.
// A turn in motion is finished before a snapshot, as the page itself does when it is hidden; the finish picture is
// redrawn from the solved board, never saved.
async function __minimalSettle(){
  for(let n=0;n<200&&(queue.length||animation&&!animation.trace);n++){if(animation&&!animation.trace)animation.finish();await null;}
}
const __minimalPosition=()=>({rots:rots.slice(),hits,...(current.rings?{offsets:offsets.slice()}:{})});
// The undo list holds positions, so the moves are read back from it: [tile, steps] turns a tile and its linked
// group by one to five sixths (six is a full turn, which still counts), ['ring', k, steps] turns ring k, each step a hit.
function __minimalMoves(){
  const moves=[],states=[...history,__minimalPosition()];
  for(let n=1;n<states.length;n++){
    const a=states[n-1],b=states[n],d=b.hits-a.hits,k=(current.rings||[]).find(k=>(a.offsets[k]||0)!==(b.offsets[k]||0));
    if(k!==undefined)moves.push(['ring',k,mod(d)===mod(b.offsets[k]-a.offsets[k])?d:-d]);
    else{
      const i=a.rots.findIndex((r,j)=>r!==b.rots[j]);
      if(i<0&&d!==1&&current.rings)moves.push(['ring',current.rings[0],d]);
      else moves.push([Math.max(i,0),i<0?6:mod(b.rots[i]-a.rots[i])]);
    }
  }
  return moves;
}
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){
    const solved=E.solved(arranged(),rots);
    return{id:current.id,mode:'campaign',layout:Object.fromEntries(['tiles','start','links','rings','offsets'].filter(k=>current[k]!==undefined).map(k=>[k,current[k]])),solved,repeat:finished.has(current.id),restored:history.length>0||hits>0,value:hits,progress:{completed:finished.size+(solved&&!finished.has(current.id)?1:0)}};
  },
  snapshot(){return{board:current.id,...__minimalPosition(),history:MinimalBridge.clone(history),finished:[...finished],reached,settings:{...settings},locks:MinimalBridge.clone(lockBook),hint:!!hint,focus,text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const b=boards.find(v=>v.id===d?.board);
    if(!b||!validPosition(d,b)||!Array.isArray(d.history)||d.history.length>5000||!d.history.every(p=>validPosition(p,b))||!Array.isArray(d.finished)||!Number.isInteger(d.reached)||d.reached<0||!['system','light','dark'].includes(d.settings?.theme)||!['system','reduce'].includes(d.settings.motion)||!validLocks(d.locks))throw Error('Invalid Tangles state.');
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    clearInput();
    current=b;rots=d.rots.slice();hits=d.hits;offsets=b.rings?d.offsets.slice():undefined;history=MinimalBridge.clone(d.history);
    for(const id of Object.keys(lockBook))delete lockBook[id];
    for(const [id,list] of Object.entries(d.locks||{}))if(list.length)lockBook[id]=list.slice();
    locks=new Set(lockBook[b.id]||[]);
    finished.clear();for(const id of d.finished)if(boards.some(v=>v.id===id))finished.add(id);
    reached=Math.min(boards.length-1,Math.max(d.reached,boards.indexOf(b)));
    Object.assign(settings,{theme:d.settings.theme,motion:d.settings.motion,borders:d.settings.borders==='on'?'on':'off'});
    corrupt=false;focus=Number.isInteger(d.focus)&&b.tiles[d.focus]?d.focus:middle(b);hover=null;keyboard=false;
    nextReady=E.solved(arranged(),rots);
    applyPrefs();render();
    if(d.hint&&!nextReady){hint=special(current)?E.hintAll(current,rots,offsets):E.hint(current,rots);rings();}
    announce(d.text||'');save();MinimalBridge.restoreUI(d.ui);
  },
  settle:__minimalSettle,
  undoDepth:()=>history.length,
  proof(){return{board:current.id,moves:__minimalMoves()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
// Experiments and New Game+ are pages of this game (experiments.html). A link to one carries the collection's
// handshake, so Home, Scores and the access keys keep working there: adapters/bootstrap.js does that for every
// link to a packaged page, in every game.
