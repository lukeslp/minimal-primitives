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
  snapshot(){return{board:current.id,...__minimalPosition(),history:MinimalBridge.clone(history),finished:[...finished],order:ORDER,reached,more:[...more],settings:{...settings},locks:MinimalBridge.clone(lockBook),hint:!!hint,focus,text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const saved=boards.find(v=>v.id===d?.board);
    if(!saved||!validPosition(d,saved)||!Array.isArray(d.history)||d.history.length>5000||!d.history.every(p=>validPosition(p,saved))||!Array.isArray(d.finished)||!Number.isInteger(d.reached)||d.reached<0||!['system','light','dark'].includes(d.settings?.theme)||!['system','reduce'].includes(d.settings.motion)||!validLocks(d.locks)
      ||d.order!==undefined&&d.order!==ORDER||d.more!==undefined&&!(Array.isArray(d.more)&&d.more.every(id=>extras.some(v=>v.id===id))))throw Error('Invalid Tangles state.');
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    clearInput();
    finished.clear();for(const id of d.finished)if(boards.some(v=>v.id===id))finished.add(id);
    more.clear();for(const id of d.more||[])more.add(id);
    // The game's own reading of its save (game-riffs 9ad63d8): with order 2, reached is a place in the twenty-five-board
    // course. Without it (0.5.9 and earlier, when the course was all fifty in id order), every board the save had open
    // stays open, the course up to the furthest of them and the boards the course left out under More boards, and a
    // player on a board the course left out goes to the nearest open course board by the old order, an unfinished one
    // first, which starts fresh.
    let b=saved;
    if(d.order===ORDER)reached=Math.min(course.length-1,Math.max(d.reached,place(b.id),...[...finished].map(id=>place(id)+(place(id)>=0?1:0))));
    else{
      const was=Math.min(ALL.length-1,Math.max(d.reached,oldPlace(b.id),...[...finished].map(id=>oldPlace(id)+1)));
      reached=Math.min(course.length-1,Math.max(0,...course.map((v,n)=>oldPlace(v.id)<=was?n:0),...course.map((v,n)=>finished.has(v.id)?n+1:0)));
      for(const v of extras)if(oldPlace(v.id)<=was&&!finished.has(v.id))more.add(v.id);
      if(!course.includes(b)){
        const from=oldPlace(b.id),open=course.slice(0,reached+1),near=list=>list.sort((x,y)=>Math.abs(oldPlace(x.id)-from)-Math.abs(oldPlace(y.id)-from)||oldPlace(y.id)-oldPlace(x.id))[0];
        b=near(open.filter(v=>!finished.has(v.id)))||near(open);
      }
    }
    const resume=b===saved;
    current=b;rots=resume?d.rots.slice():b.start.slice();hits=resume?d.hits:0;offsets=b.rings?(resume?d.offsets.slice():startOffsets(b)):undefined;history=resume?MinimalBridge.clone(d.history):[];
    for(const id of Object.keys(lockBook))delete lockBook[id];
    for(const [id,list] of Object.entries(d.locks||{}))if(list.length)lockBook[id]=list.slice();
    locks=new Set(lockBook[b.id]||[]);
    Object.assign(settings,{theme:d.settings.theme,motion:d.settings.motion,borders:d.settings.borders==='on'?'on':'off'});
    corrupt=false;focus=resume&&Number.isInteger(d.focus)&&b.tiles[d.focus]?d.focus:middle(b);hover=null;keyboard=false;
    nextReady=E.solved(arranged(),rots);
    applyPrefs();render();
    if(resume&&d.hint&&!nextReady){hint=special(current)?E.hintAll(current,rots,offsets):E.hint(current,rots);rings();}
    announce(resume?d.text||'':'');save();MinimalBridge.restoreUI(d.ui);
  },
  settle:__minimalSettle,
  undoDepth:()=>history.length,
  proof(){return{board:current.id,moves:__minimalMoves()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
// Experiments and New Game+ are pages of this game (experiments.html). A link to one carries the collection's
// handshake, so Home, Scores and the access keys keep working there: adapters/bootstrap.js does that for every
// link to a packaged page, in every game.
