// Tilt · 3D keeps its rules state as a list of tips per board; the scene is rebuilt from it.
function __minimalSettle(){stopLook();for(let n=0;busy()&&n<20;n++){fastForward();anim=null;drain();}fastForward();anim=null;queue=[];cueState=null;afterAnim();}
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:boardId,mode:'campaign',layout:{levels:board.levels},solved:solvedNow,repeat:done.includes(boardId),restored:history.length>0||undoStack.length>0,value:history.length,progress:{completed:done.length}};},
  snapshot(){return{board:boardId,history:history.slice(),undoStack:undoStack.map(h=>h.slice()),done:done.slice(),reached,order:3,pool:played.slice(),prefs:{...prefs},hint,look:{yaw:look.yaw,pitch:look.pitch,zoom:look.zoom,vx:look.vx,vy:look.vy},text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // The game's own reading of its save (readSave): finished marks on any of the fifty boards stay; reached counts in
    // this build's twenty-five with order 3 (game-riffs 9ad63d8), in the thirty of 0.5.9 with order 2 (d3d9b9e), and
    // in the fifty-board order with neither, and every campaign board a save had open stays open. A player on a board
    // the campaign left out goes on from the open campaign board nearest it in the campaign it was saved under (the
    // first not finished, for a board left out before that), unless the campaign is finished, when that board is one
    // of the pool and stays, moves and all.
    const saved=ALL.find(v=>v.id===d?.board),moves=a=>Array.isArray(a)&&a.every(m=>typeof m==='string');
    if(!saved||!moves(d.history)||!Array.isArray(d.undoStack)||!d.undoStack.every(moves)||!Array.isArray(d.done)||!Number.isInteger(d.reached)||!d.prefs||!d.look)throw Error('Invalid Tilt · 3D state.');
    const nextDone=[...new Set(d.done.filter(known))];
    const was=Math.min(ALL.length-1,Math.max(0,d.reached));
    const opened=d.order===3?was:Math.max(-1,...(d.order===2?ORDER_2:OLD_ORDER).slice(0,was+1).map(indexOf));
    const nextReached=Math.min(BOARDS.length-1,Math.max(0,opened,...nextDone.map(id=>indexOf(id)+1)));
    const finishedAll=BOARDS.every(v=>nextDone.includes(v.id));
    const keep=indexOf(saved.id)>=0?indexOf(saved.id)<=nextReached:finishedAll;
    if(indexOf(saved.id)>=0&&!keep)throw Error('Board not reached.');
    const at=ORDER_2.indexOf(saved.id),far=x=>Math.abs(ORDER_2.indexOf(x.id)-at);
    const b=keep?saved:at<0?(BOARDS.find(v=>!nextDone.includes(v.id))||BOARDS[0]):BOARDS.slice(0,nextReached+1).reduce((best,x)=>far(x)<far(best)||(far(x)===far(best)&&ORDER_2.indexOf(x.id)>ORDER_2.indexOf(best.id))?x:best);
    const history0=keep?d.history:[],undo0=keep?d.undoStack:[];
    replay(b,history0);for(const h of undo0)replay(b,h);
    queue=[];anim=null;cueState=null;clearHint();hideWay();endLookHint();lookHintDue=null;stroke=null;lookG=null;armed=false;look.anim=null;
    prefs={...d.prefs};done=nextDone;reached=nextReached;corrupt=false;
    played=Array.isArray(d.pool)?[...new Set(d.pool.filter(id=>POOL.some(v=>v.id===id)))]:[];
    boardId=b.id;history=history0.slice();undoStack=undo0.map(h=>h.slice());
    Object.assign(look,{yaw:+d.look.yaw||0,pitch:+d.look.pitch||PITCH,zoom:+d.look.zoom||1,vx:+d.look.vx||0,vy:+d.look.vy||0});
    buildBoard();syncAll();applyPrefs();
    if(keep&&d.hint&&DIRS[d.hint]&&!solvedNow){hint=d.hint;placeChevron(hintMark,place.level,hint);if(!reduced())leanGoal.copy(DIRS[hint]).multiplyScalar(3.5*DEG);}
    updateUI();say(keep?d.text||'':'');save();MinimalBridge.restoreUI(d.ui);kick();
  },
  settle(){__minimalSettle();},
  undoDepth:()=>undoStack.length,
  proof(){return{board:boardId,moves:history.slice()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
