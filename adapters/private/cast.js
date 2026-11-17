// Cast (game-riffs cast-3d/): the lit-room game. Its rules state is the column heights per board; the room is
// rebuilt from them. Hits are the scored count (hits-v1), with the same engine as the flat Cast · Old.
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:isFree()?'free-'+puzzle.seed:puzzle.id,mode:isFree()?'free':'campaign',layout:{n:puzzle.n,maxH:puzzle.maxH,left:puzzle.left,right:puzzle.right,plan:puzzle.plan,cubes:puzzle.cubes},solved:solvedNow(),repeat:finished.has(puzzle.id),restored:hits>0,value:hits,progress:{completed:finished.size}};},
  snapshot(){const slot=x=>x&&{board:x.board.id??null,seed:x.board.seed??null,heights:copy(x.heights),hits:x.hits,history:x.history.map(s=>({heights:copy(s.heights),hits:s.hits}))};return{mode,board:isFree()?null:puzzle.id,seed:isFree()?puzzle.seed:null,parked:slot(parked),recent:recent.slice(),heights:copy(heights),hits,history:history.map(s=>({heights:copy(s.heights),hits:s.hits})),finished:[...finished],reached,motion:prefs.motion,hint,focus:focus.slice(),keyboard,view:viewRest,text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // A free board is rebuilt from its seed; the campaign board by id. The other one waits in `parked`.
    const boardFor=(id,seed)=>id!=null?boards.find(b=>b.id===id):(Free&&Number.isInteger(seed)?Free.fromSeed(seed):null);
    const free=d&&d.mode==='free',b=d&&boardFor(free?null:d.board,free?d.seed:null);
    const pb=d&&d.parked&&boardFor(free?d.parked.board:null,free?null:d.parked.seed);
    // Every Undo step is checked against its own board, the waiting board's as well as the open one's: a step the
    // engine cannot read would otherwise pass here and throw at a later Undo.
    const steps=(list,board)=>Array.isArray(list)&&list.every(s=>s&&validHeights(s.heights,board)&&validHits(s.hits));
    if(d&&d.parked&&(!pb||!validHeights(d.parked.heights,pb)||!validHits(d.parked.hits)||!steps(d.parked.history,pb)))throw Error('Invalid Cast snapshot');
    if(!b||!validHeights(d.heights,b)||!validHits(d.hits)||!steps(d.history,b)||!Array.isArray(d.finished)||!['system','reduce'].includes(d.motion)||!Array.isArray(d.focus)||!Number.isInteger(d.reached))throw Error('Invalid Cast snapshot');
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    clearPending();
    const changedBoard=b!==puzzle;
    mode=free?'free':'campaign';parked=pb?{board:pb,heights:copy(d.parked.heights),hits:d.parked.hits,history:d.parked.history.map(s=>({heights:copy(s.heights),hits:s.hits}))}:null;
    if(Array.isArray(d.recent))recent=d.recent.filter(x=>Number.isInteger(x));
    puzzle=b;heights=copy(d.heights);hits=d.hits;history=d.history.map(s=>({heights:copy(s.heights),hits:s.hits}));
    finished=new Set(d.finished.filter(id=>boards.some(b=>b.id===id)));prefs.motion=d.motion;
    reached=Math.max(0,Math.min(boards.length-1,d.reached));
    hint=d.hint;focus=d.focus.slice();hover=null;
    // The finish is one value since game-riffs e558e7f (the room takes its color): 1 on a finished board. cast.json
    // carries its declaration as a hook that changes nothing, so the build stops if the game renames it.
    tint=solvedNow()?1:0;
    const v=Number.isInteger(d.view)&&d.view>=0&&d.view<RESTS.length?d.view:FRONT;
    viewRest=v;board.dataset.view=RESTS[v].name;
    if(renderer&&changedBoard)buildRoom();
    setView(v);
    applyPrefs();keyboard=!!d.keyboard;sync();announce(d.text||'');save();
    MinimalBridge.restoreUI(d.ui);
    // Restoring focus to the board marks keyboard use; keep the saved mode.
    keyboard=!!d.keyboard;rings();
  },
  async settle(){
    // Finish every running tween at once; the test clock may be paused, so wait on microtasks, never timers.
    for(let n=0;(busy||queue.length||animations.size)&&n<400;n++){finishAnimations();await new Promise(r=>queueMicrotask(r));}
    if(busy||queue.length)throw Error('Wait for the cubes to settle.');
  },
  undoDepth:()=>history.length,
  proof(){return{board:puzzle.id,heights:copy(heights),hits,history:history.map(s=>s.heights)};}
});
// The game also saves when its room finishes loading; report a save to the collection only when the
// board, cubes, hits, history, progress or motion setting changed.
const __minimalKey=()=>JSON.stringify([mode,puzzle.id??puzzle.seed,heights,hits,history.length,[...finished],reached,prefs.motion,parked&&(parked.board.id??parked.board.seed)]);
let __minimalLast=__minimalKey();
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);const key=__minimalKey();if(key!==__minimalLast){__minimalLast=key;__minimal.changed();}return value;};
