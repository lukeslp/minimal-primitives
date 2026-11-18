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
  snapshot(){return{board:boardId,history:history.map(m=>m.slice()),completed:completed.slice(),pool:played.slice(),prefs:{...prefs},hint:hint&&(hint==='undo'?'undo':hint.slice()),look:{yaw:look.yaw,pitch:look.pitch,zoom:look.zoom,vx:look.vx,vy:look.vy},text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // The game's own reading of its save (game-riffs 9ad63d8, the campaign twenty-five of the fifty): solved marks and
    // the board are read against all fifty; a player on a board that left the campaign goes on from the campaign board
    // nearest it in the old order of fifty (the later of two) with a fresh cube, and once the campaign is finished it
    // is a New Game+ board and stays.
    const saved=ALL.find(v=>v.id===d?.board),move=m=>Array.isArray(m)&&(m.length===2||m.length===3);
    if(!saved||!Array.isArray(d.history)||d.history.length>5000||!d.history.every(move)||!Array.isArray(d.completed)||!d.prefs||!['system','reduce'].includes(d.prefs.motion)||!d.look)throw Error('Invalid Cube Maze state.');
    const nextCompleted=[...new Set(d.completed.filter(id=>ALL.some(v=>v.id===id)))];
    let b=saved;
    if(POOL.includes(b)&&!BOARDS.every(v=>nextCompleted.includes(v.id))){const at=ALL.indexOf(b),far=c=>Math.abs(ALL.indexOf(c)-at);b=BOARDS.reduce((best,c)=>far(c)<far(best)||(far(c)===far(best)&&ALL.indexOf(c)>ALL.indexOf(best))?c:best);}
    const resume=b===saved,moves=resume?d.history:[],hinted=resume?d.hint:null;
    const r=replay(b,moves);
    if(hinted&&hinted!=='undo'&&(r.state.out||!E.validMove(r.state,hinted)))throw Error('Invalid Cube Maze hint.');
    if(lookG){for(const id of lookG.ids)try{html.releasePointerCapture(id);}catch(_){}lookG=null;}
    queue=[];anim=null;drag=null;gesture=null;roll=null;cueState=null;look.anim=null;
    clearHint();clearSel();endLookHint();lookHintDue=null;endLayer();
    prefs={...d.prefs};completed=nextCompleted;played=Array.isArray(d.pool)?[...new Set(d.pool.filter(id=>POOL.some(v=>v.id===id)))]:[];drawn=null;corrupt=false;
    boardId=b.id;history=moves.map(m=>m.slice());
    buildBoard();syncAll();
    Object.assign(look,{yaw:+d.look.yaw||0,pitch:+d.look.pitch||PITCH,zoom:+d.look.zoom||1,vx:+d.look.vx||0,vy:+d.look.vy||0});aim();
    applyPrefs();
    if(hinted)showHint(hinted==='undo'?'undo':hinted.slice());
    updateUI();announce(resume?d.text||'':'');save();MinimalBridge.restoreUI(d.ui);kick();
  },
  settle(){__minimalSettle();},
  undoDepth:()=>history.length,
  proof(){return{board:boardId,moves:history.map(m=>m.slice())};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
