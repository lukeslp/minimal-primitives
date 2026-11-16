// Weaves resume adapter. Runs inside the game's closure, after its first draw.
// The game's own save holds the board, grid, hits, undo history, finished boards, settings and how far the
// campaign is open. The snapshot adds what that save leaves out: the shown hint, the crossing ring and the
// announcement. The proof is the list of crossings flipped since the board's start, read from the undo history.
const __minimalMoves=()=>{
  const states=[...history.map(h=>h.grid),grid],out=[];
  for(let n=1;n<states.length;n++)for(let r=0;r<board.rows;r++)for(let c=0;c<board.cols;c++)if(states[n][r][c]!==states[n-1][r][c])out.push([r,c]);
  return out;
};
// Pending taps are dropped and the motion in progress ends where it would have ended.
const __minimalStop=()=>{epoch++;for(const job of queue)job.resolve();queue=[];gestures.clear();animation?.finish();};
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:board.id,mode:'campaign',layout:{rows:board.rows,cols:board.cols,pins:board.pins},solved:E.solved(board,grid),repeat:finished.has(board.id),restored:history.length>0,value:hits,progress:{completed:finished.size}};},
  snapshot(){return{board:board.id,grid:copy(grid),hits,history:history.map(h=>({grid:copy(h.grid),hits:h.hits})),finished:[...finished],reached,prefs:{...prefs},hint:hint?{r:hint.r,c:hint.c,to:hint.to}:null,focus:focus.slice(),keyboard,text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  async restore(d){
    const b=boards.find(v=>v.id===d?.board),cell=p=>Number.isInteger(p?.[0])&&Number.isInteger(p?.[1])&&p[0]>=0&&p[1]>=0&&p[0]<b.rows&&p[1]<b.cols;
    if(!b||!validGrid(d.grid,b)||!validHits(d.hits)||!Array.isArray(d.history)||d.history.length>10000||!d.history.every(h=>h&&validGrid(h.grid,b)&&validHits(h.hits))
      ||!Array.isArray(d.finished)||!d.finished.every(id=>boards.some(v=>v.id===id))||!Number.isInteger(d.reached)||d.reached<0||d.reached>=boards.length
      ||!['system','light','dark'].includes(d.prefs?.theme)||!['system','reduce'].includes(d.prefs?.motion)||!cell(d.focus))throw Error('Invalid Weaves state.');
    if(d.hint&&(!cell([d.hint.r,d.hint.c])||b.pins.some(p=>p[0]===d.hint.r&&p[1]===d.hint.c)))throw Error('Invalid Weaves hint.');
    // A move in motion ends first, so nothing of the old board is drawn or announced over the restored one.
    __minimalStop();for(let n=0;busy&&n<200;n++)await null;
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    board=b;grid=copy(d.grid);hits=d.hits;history=d.history.map(h=>({grid:copy(h.grid),hits:h.hits}));
    finished=new Set(d.finished);reached=Math.min(boards.length-1,Math.max(d.reached,openedBy(finished),boards.indexOf(board)));
    prefs={...d.prefs};hint=d.hint?{r:d.hint.r,c:d.hint.c,to:d.hint.to}:null;hover=null;refusal=null;focus=d.focus.slice(0,2);
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
