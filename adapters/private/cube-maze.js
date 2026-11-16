// Cube Maze keeps its rules state as the moves made on the current board; the scene is rebuilt from them.
// A drag, a roll, a turn or queued moves come to rest first, so a snapshot never holds a cube in motion.
function __minimalSettle(){
  stopLook();if(gesture)abandonGesture();
  if(lookG){for(const id of lookG.ids)try{html.releasePointerCapture(id);}catch(_){}lookG=null;}
  for(let n=0;busy()&&n<40;n++){fastForward();anim=null;drag=null;drain();}
  fastForward();anim=null;drag=null;queue=[];cueState=null;updateUI();kick();
}
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:boardId,mode:'campaign',layout:{n:board.n,masks:board.masks,spout:board.spout,marble:board.marble,g:board.g},solved:!!state.out,repeat:completed.includes(boardId),restored:history.length>0,value:history.length,progress:{completed:completed.length}};},
  snapshot(){return{board:boardId,history:history.map(m=>m.slice()),completed:completed.slice(),prefs:{...prefs},hint:hint&&(hint==='undo'?'undo':hint.slice()),look:{yaw:look.yaw,pitch:look.pitch,zoom:look.zoom,vx:look.vx,vy:look.vy},text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const b=BOARDS.find(v=>v.id===d?.board),move=m=>Array.isArray(m)&&(m.length===2||m.length===3);
    if(!b||!Array.isArray(d.history)||d.history.length>5000||!d.history.every(move)||!Array.isArray(d.completed)||!d.prefs||!['system','reduce'].includes(d.prefs.motion)||!d.look)throw Error('Invalid Cube Maze state.');
    const r=replay(b,d.history);
    if(d.hint&&d.hint!=='undo'&&(r.state.out||!E.validMove(r.state,d.hint)))throw Error('Invalid Cube Maze hint.');
    if(lookG){for(const id of lookG.ids)try{html.releasePointerCapture(id);}catch(_){}lookG=null;}
    queue=[];anim=null;drag=null;gesture=null;roll=null;cueState=null;look.anim=null;
    clearHint();clearSel();endLookHint();lookHintDue=null;endLayer();
    prefs={...d.prefs};completed=d.completed.filter(id=>BOARDS.some(v=>v.id===id));corrupt=false;
    boardId=b.id;history=d.history.map(m=>m.slice());
    buildBoard();syncAll();
    Object.assign(look,{yaw:+d.look.yaw||0,pitch:+d.look.pitch||PITCH,zoom:+d.look.zoom||1,vx:+d.look.vx||0,vy:+d.look.vy||0});aim();
    applyPrefs();
    if(d.hint)showHint(d.hint==='undo'?'undo':d.hint.slice());
    updateUI();announce(d.text||'');save();MinimalBridge.restoreUI(d.ui);kick();
  },
  settle(){__minimalSettle();},
  undoDepth:()=>history.length,
  proof(){return{board:boardId,moves:history.map(m=>m.slice())};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
