const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:current.id,mode:'campaign',layout:{levels:current.levels},solved,repeat:done.has(current.id),restored:moves>0,value:moves,progress:{completed:done.size}};},
  snapshot(){return{board:current.id,place,moves,solved,hint,undoStack,prefs,done:[...done],reached,order:2,pool:played.slice(),text:$('live').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // The game's own reading of its save: finished marks on any of the fifty boards stay; a save without order 2
    // (before game-riffs d3d9b9e, when the campaign was all fifty in turn) counts reached in that order, and every
    // campaign board it had open stays open; a player on a board the campaign left out goes on from the first
    // campaign board not finished (with the campaign finished, a pool board stays).
    if(!d||typeof d.board!=='string'||!ids.has(d.board)||!Array.isArray(d.done)||!Number.isInteger(d.reached)||!d.prefs)throw Error('Invalid saved Tilt board.');
    cancelMotion();
    done.clear();for(const id of d.done)if(ids.has(id))done.add(id);
    const was=Math.min(All.length-1,Math.max(0,d.reached));
    const opened=d.order===2?was:Math.max(...OLD_ORDER.slice(0,was+1).map(id=>Boards.findIndex(item=>item.id===id)));
    reached=Math.min(Boards.length-1,Math.max(0,opened,Boards.findIndex(item=>item.id===d.board),...[...done].map(id=>Boards.findIndex(item=>item.id===id)+1)));
    const inCampaign=Boards.some(item=>item.id===d.board),keep=inCampaign||campaignDone();
    const at=keep?d.board:(Boards.find(item=>!done.has(item.id))||Boards[0]).id;
    if(go(at)===false)throw Error('Invalid saved Tilt board.');
    played=Array.isArray(d.pool)?[...new Set(d.pool.filter(id=>Pool.some(item=>item.id===id)))]:[];
    if(keep){place=d.place;moves=d.moves;solved=d.solved;hint=d.hint;undoStack=d.undoStack;}
    Object.assign(prefs,d.prefs);applyPrefs();draw();placeMarble(centerOf(place.level,place.row,place.col),1);refresh();say(keep?d.text||'':'');writeSave();MinimalBridge.restoreUI(d.ui);},
  async settle(){for(let n=0;busy&&n<80;n++)await new Promise(r=>setTimeout(r,25));if(busy)throw Error('Wait for the marble to stop.');},
  undoDepth:()=>undoStack.length,
  proof(){return{states:[...undoStack,snapshot()]};}
});
const __minimalWrite=writeSave;writeSave=function(){const value=__minimalWrite.apply(this,arguments);__minimal.changed();return value;};
const __minimalUndo=undo;undo=function(){const value=__minimalUndo.apply(this,arguments);__minimal.changed();return value;};
