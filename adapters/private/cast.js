const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:puzzle.id,mode:'campaign',layout:{n:puzzle.n,maxH:puzzle.maxH,left:puzzle.left,right:puzzle.right,plan:puzzle.plan,cubes:puzzle.cubes},solved:E.solved(puzzle,heights),repeat:finished.has(puzzle.id),restored:hits>0,value:hits,progress:{completed:finished.size}};},
  snapshot(){return{board:puzzle.id,heights,hits,history,finished:[...finished],motion:prefs.motion,hint,focus,keyboard,light,text:$('#announcement').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const b=d&&boards.find(b=>b.id===d.board);
    if(!b||!validHeights(d.heights,b)||!validHits(d.hits)||!Array.isArray(d.history)||!d.history.every(s=>validHeights(s.heights,b)&&validHits(s.hits))||!Array.isArray(d.finished)||!['system','reduce'].includes(d.motion)||!Array.isArray(d.focus))throw Error('Invalid Cast snapshot');
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    clearPending();
    puzzle=b;heights=copy(d.heights);hits=d.hits;history=d.history.map(s=>({heights:copy(s.heights),hits:s.hits}));
    finished=new Set(d.finished.filter(id=>boards.some(b=>b.id===id)));prefs.motion=d.motion;
    hint=d.hint;focus=d.focus.slice();hover=null;light=d.light;
    applyPrefs();keyboard=!!d.keyboard;render();announce(d.text||'');save();
    MinimalBridge.restoreUI(d.ui);
    // Restoring focus to the board marks keyboard use; keep the saved mode.
    keyboard=!!d.keyboard;rings();
  },
  async settle(){
    for(let n=0;(busy||animation)&&n<200;n++){animation?.finish();await new Promise(r=>queueMicrotask(r));}
    if(busy)throw Error('Wait for the cubes to settle.');
  },
  undoDepth:()=>history.length,
  proof(){return{board:puzzle.id,heights:copy(heights),hits,history:history.map(s=>s.heights)};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
