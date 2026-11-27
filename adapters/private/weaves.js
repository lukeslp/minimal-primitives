// Weaves resume adapter. Runs inside the game's closure, after its first draw.
// The game's own save holds the board, grid, hits, undo history (with each step's settled marks), the settled marks
// (`kept`), finished boards, settings, how far the old fifty-board catalog is open (`reached`, a catalog index) and
// how far the sixteen-board course is open (`courseReached`, since game-riffs 9ad63d8) and the optional cloths dealt
// after the course (`pool`, since PR 201). The snapshot adds what that
// save leaves out: the shown hint with its reason, the crossing ring, the mark mode and the announcement. The proof
// is the list of crossings flipped since the board's start, read from the undo history (marking changes no crossing).
// Since game-riffs PR 249 (57d75298) a board can also be an endless cloth, made from a seed (generate.js): its id is g
// and the seed, and the game's lookup() makes it again from that id. The wins after the course have a key of their own
// (PLUS), written by the game with each win; the snapshot carries them, and a restore never takes one back.
const __minimalMoves=()=>{
  const states=[...history.map(h=>h.grid),grid],out=[];
  for(let n=1;n<states.length;n++)for(let r=0;r<board.rows;r++)for(let c=0;c<board.cols;c++)if(states[n][r][c]!==states[n-1][r][c])out.push([r,c]);
  return out;
};
// Pending taps are dropped and the motion in progress ends where it would have ended.
const __minimalStop=()=>{epoch++;for(const job of queue)job.resolve();queue=[];gestures.clear();animation?.finish();};
const __minimalPlusValid=v=>v===undefined||!!v&&v.version===1&&validHits(v.wins)&&typeof v.held==='string'&&v.held.length<=96&&Array.isArray(v.set)&&v.set.every(id=>typeof id==='string');
const __minimalPlus=v=>{
  setEnd=null;if(!v)return;
  const set=[...new Set([...plus.set,...v.set.filter(id=>course.more.some(b=>b.id===id))])];
  plus=v.wins>plus.wins?{version:1,wins:v.wins,held:v.held,set}:{...plus,set};
  if(!protectPlus)try{localStorage.setItem(PLUS,JSON.stringify(plus));}catch(_){}
};
const __minimalCell=(p,b)=>Array.isArray(p)&&Number.isInteger(p[0])&&Number.isInteger(p[1])&&p[0]>=0&&p[1]>=0&&p[0]<b.rows&&p[1]<b.cols;
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  // An endless cloth is reported as one; an optional cloth after the course is New Game+. Each is a repeat once it
  // has been won there (an endless cloth only while it is the last one counted: its seed is new each time). The
  // committed() hook runs before the game takes an endless cloth's id back out of `finished`, so the count skips it.
  describe(){const seed=board.seed,plusBoard=seed===undefined&&course.index(board.id)<0&&allDone();return{id:board.id,mode:seed!==undefined?'endless':plusBoard?'plus':'campaign',layout:{rows:board.rows,cols:board.cols,pins:board.pins},solved:E.solved(board,grid),repeat:seed!==undefined?plus.held==='g:'+seed:plusBoard?plus.set.includes(board.id):finished.has(board.id),restored:history.length>0,value:hits,progress:{completed:finished.size-(seed!==undefined&&finished.has(board.id)?1:0)}};},
  snapshot(){return{board:board.id,grid:copy(grid),hits,history:history.map(h=>({grid:copy(h.grid),hits:h.hits,kept:(h.kept||[]).slice()})),kept:[...kept],keepMode,finished:[...finished],reached,course:1,courseReached,pool:played.slice(),plus:{version:1,wins:plus.wins,held:plus.held,set:plus.set.slice()},prefs:{...prefs},
    hint:hint?{r:hint.r,c:hint.c,to:hint.to,...(hint.pair?{pair:hint.pair.map(p=>p.slice()),axis:hint.axis,between:!!hint.between}:{})}:null,focus:focus.slice(),keyboard,text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  async restore(d){
    const b=lookup(d?.board),cell=p=>__minimalCell(p,b);
    if(!b||!validGrid(d.grid,b)||!validHits(d.hits)||!Array.isArray(d.history)||d.history.length>10000||!d.history.every(h=>h&&validGrid(h.grid,b)&&validHits(h.hits)&&validKept(h.kept,b))
      ||!validKept(d.kept,b)||!Array.isArray(d.finished)||!d.finished.every(id=>boards.some(v=>v.id===id))||!Number.isInteger(d.reached)||d.reached<0||d.reached>=boards.length
      ||d.course!==undefined&&(d.course!==1||!Number.isInteger(d.courseReached)||d.courseReached<0||d.courseReached>=course.main.length)
      ||!['system','light','dark'].includes(d.prefs?.theme)||!['system','reduce'].includes(d.prefs?.motion)||!cell(d.focus)||!__minimalPlusValid(d.plus))throw Error('Invalid Weaves state.');
    if(d.hint&&(!cell([d.hint.r,d.hint.c])||b.pins.some(p=>p[0]===d.hint.r&&p[1]===d.hint.c)||d.hint.pair!==undefined&&(!Array.isArray(d.hint.pair)||!d.hint.pair.every(cell))))throw Error('Invalid Weaves hint.');
    // A move in motion ends first, so nothing of the old board is drawn or announced over the restored one.
    __minimalStop();for(let n=0;busy&&n<200;n++)await null;
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    board=b;grid=copy(d.grid);hits=d.hits;history=d.history.map(h=>({grid:copy(h.grid),hits:h.hits,kept:(h.kept||[]).slice()}));kept=new Set(d.kept||[]);keepMode=!!d.keepMode;
    finished=new Set(d.finished);reached=Math.min(boards.length-1,Math.max(d.reached,openedBy(finished),boards.indexOf(board)));
    // The game's own reading of its save (course.migrate): a snapshot from 0.5.9 or earlier has no course, so every
    // main-course board whose old catalog place was open stays open, and the course is open at least as far as the
    // boards finished and the board in play. `reached` keeps its catalog meaning and is never read as a course place.
    courseReached=course.migrate(d.course===1?{course:1,courseReached:d.courseReached}:{},reached,board.id,finished);
    // The optional cloths served since the endless round last ran out (game-riffs PR 201), read as the game reads its
    // save's `pool`: unknown or repeated ids are dropped; a snapshot from 0.5.10 or earlier has none.
    played=Array.isArray(d.pool)?[...new Set(d.pool.filter(id=>course.more.some(v=>v.id===id)))]:[];drawn=null;__minimalPlus(d.plus);
    prefs={...d.prefs};hover=null;refusal=null;focus=d.focus.slice(0,2);
    hint=d.hint?{r:d.hint.r,c:d.hint.c,to:d.hint.to,...(d.hint.pair?{pair:d.hint.pair.map(p=>p.slice(0,2)),axis:d.hint.axis,between:!!d.hint.between}:{})}:null;
    fit();applyPrefs();rest();announce(d.text||'');save();
    MinimalBridge.restoreUI(d.ui);
    keyboard=!!d.keyboard&&document.activeElement===boardNode;drawRings();
  },
  // Taps waiting behind a move are played out and every motion ends, so a snapshot never holds a cloth mid-beat.
  async settle(){for(let n=0;busy&&n<2000;n++){animation?.finish();await null;}},
  undoDepth:()=>history.length,
  proof(){return{board:board.id,moves:__minimalMoves()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
