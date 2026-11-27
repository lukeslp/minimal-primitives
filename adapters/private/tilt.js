// Wins after the campaign (game-riffs PR 252) live under a key of their own (PLUS_KEY), which the game writes with
// each win. The snapshot carries them; a restore never takes one back: the higher count stands with the board it
// counted last, and the pool boards solved are both lists together. A snapshot from 0.5.13 or earlier has none.
const __minimalPlusValid=v=>v===undefined||!!v&&v.version===1&&Number.isInteger(v.wins)&&v.wins>=0&&typeof v.held==='string'&&Array.isArray(v.set)&&v.set.every(id=>typeof id==='string');
const __minimalPlus=v=>{
  if(!v)return;
  plus.set=[...new Set([...plus.set,...v.set.filter(id=>Pool.some(item=>item.id===id))])];
  if(v.wins>plus.wins){plus.wins=v.wins;plus.held=v.held;}
  if(!plusBlocked)try{localStorage.setItem(PLUS_KEY,JSON.stringify(plus));}catch(_){}
};
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  // A pool board (New Game+, after the campaign) is reported as one, and as a repeat once it has been won there.
  describe(){const pool=inPool();return{id:current.id,mode:pool?'plus':'campaign',layout:{levels:current.levels},solved,repeat:pool?plus.set.includes(current.id):done.has(current.id),restored:moves>0,value:moves,progress:{completed:done.size}};},
  snapshot(){return{board:current.id,place,moves,solved,hint,undoStack,prefs,done:[...done],reached,order:3,pool:played.slice(),plus:{version:1,wins:plus.wins,held:plus.held,set:plus.set.slice()},text:$('live').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // The game's own reading of its save (readSave): finished marks on any of the fifty boards stay; reached counts in
    // this build's twenty-five with order 3 (game-riffs 9ad63d8), in the thirty of 0.5.9 with order 2 (d3d9b9e), and
    // in the old fifty-board order with neither, and every campaign board a save had open stays open. A player on a
    // board the campaign left out goes on from the open campaign board nearest it in the campaign it was saved under
    // (the first not finished, for a board left out before that); with the campaign finished, a pool board stays.
    if(!d||typeof d.board!=='string'||!ids.has(d.board)||!Array.isArray(d.done)||!Number.isInteger(d.reached)||!d.prefs||!__minimalPlusValid(d.plus))throw Error('Invalid saved Tilt board.');
    cancelMotion();
    done.clear();for(const id of d.done)if(ids.has(id))done.add(id);
    const was=Math.min(All.length-1,Math.max(0,d.reached));
    const opened=d.order===3?was:Math.max(-1,...(d.order===2?ORDER_2:OLD_ORDER).slice(0,was+1).map(id=>Boards.findIndex(item=>item.id===id)));
    reached=Math.min(Boards.length-1,Math.max(0,opened,Boards.findIndex(item=>item.id===d.board),...[...done].map(id=>Boards.findIndex(item=>item.id===id)+1)));
    const inCampaign=Boards.some(item=>item.id===d.board),keep=inCampaign||campaignDone();
    const at=keep?d.board:nearestOpen(d.board,reached,done).id;
    if(go(at)===false)throw Error('Invalid saved Tilt board.');
    played=Array.isArray(d.pool)?[...new Set(d.pool.filter(id=>Pool.some(item=>item.id===id)))]:[];__minimalPlus(d.plus);
    if(keep){place=d.place;moves=d.moves;solved=d.solved;hint=d.hint;undoStack=d.undoStack;}
    Object.assign(prefs,d.prefs);applyPrefs();draw();placeMarble(centerOf(place.level,place.row,place.col),1);refresh();say(keep?d.text||'':'');writeSave();MinimalBridge.restoreUI(d.ui);},
  async settle(){for(let n=0;busy&&n<80;n++)await new Promise(r=>setTimeout(r,25));if(busy)throw Error('Wait for the marble to stop.');},
  undoDepth:()=>undoStack.length,
  proof(){return{states:[...undoStack,snapshot()]};}
});
const __minimalWrite=writeSave;writeSave=function(){const value=__minimalWrite.apply(this,arguments);__minimal.changed();return value;};
const __minimalUndo=undo;undo=function(){const value=__minimalUndo.apply(this,arguments);__minimal.changed();return value;};
