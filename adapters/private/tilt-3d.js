// Tilt · 3D keeps its rules state as a list of tips per board; the scene is rebuilt from it.
function __minimalSettle(){stopLook();for(let n=0;busy()&&n<20;n++){fastForward();anim=null;drain();}fastForward();anim=null;queue=[];cueState=null;afterAnim();}
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:boardId,mode:'campaign',layout:{levels:board.levels},solved:solvedNow,repeat:done.includes(boardId),restored:history.length>0||undoStack.length>0,value:history.length,progress:{completed:done.length}};},
  snapshot(){return{board:boardId,history:history.slice(),undoStack:undoStack.map(h=>h.slice()),done:done.slice(),reached,prefs:{...prefs},hint,look:{yaw:look.yaw,pitch:look.pitch,zoom:look.zoom,vx:look.vx,vy:look.vy},text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const b=BOARDS.find(v=>v.id===d?.board),moves=a=>Array.isArray(a)&&a.every(m=>typeof m==='string');
    if(!b||!moves(d.history)||!Array.isArray(d.undoStack)||!d.undoStack.every(moves)||!Array.isArray(d.done)||!Number.isInteger(d.reached)||!d.prefs||!d.look)throw Error('Invalid Tilt · 3D state.');
    if(indexOf(b.id)>d.reached)throw Error('Board not reached.');
    replay(b,d.history);for(const h of d.undoStack)replay(b,h);
    queue=[];anim=null;cueState=null;clearHint();hideWay();endLookHint();lookHintDue=null;stroke=null;lookG=null;armed=false;look.anim=null;
    prefs={...d.prefs};done=d.done.filter(id=>indexOf(id)>=0);reached=Math.min(BOARDS.length-1,Math.max(0,d.reached));corrupt=false;
    boardId=b.id;history=d.history.slice();undoStack=d.undoStack.map(h=>h.slice());
    Object.assign(look,{yaw:+d.look.yaw||0,pitch:+d.look.pitch||PITCH,zoom:+d.look.zoom||1,vx:+d.look.vx||0,vy:+d.look.vy||0});
    buildBoard();syncAll();applyPrefs();
    if(d.hint&&DIRS[d.hint]&&!solvedNow){hint=d.hint;placeChevron(hintMark,place.level,hint);if(!reduced())leanGoal.copy(DIRS[hint]).multiplyScalar(3.5*DEG);}
    updateUI();say(d.text||'');save();MinimalBridge.restoreUI(d.ui);kick();
  },
  settle(){__minimalSettle();},
  undoDepth:()=>undoStack.length,
  proof(){return{board:boardId,moves:history.slice()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
