// Tents resume adapter. Runs inside the game's closure, after its first render.
const __minimalOpening=()=>read(K.opening,v=>v===1,0)===1;
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:at,mode:openingAt(at)>=0?'opening':'campaign',layout:{w:puzzle.w,h:puzzle.h,cells:puzzle.cells,rows:puzzle.rows,cols:puzzle.cols},solved:S.solved,repeat:progress.completed.includes(at),restored:!!S.undo.length||S.cells.some(v=>v!==0),value:0,progress:{completed:progress.completed.length+(S.solved&&ids.has(at)&&!progress.completed.includes(at)?1:0)}};},
  snapshot(){return{at,gen:gen?MinimalBridge.clone(gen):null,S:{cells:S.cells.slice(),undo:S.undo.map(u=>u.slice()),solved:S.solved,focus:S.focus,hint:S.hint,keyboard:S.keyboard,pairs:S.pairs},store,progress,prefs,opening:__minimalOpening(),feedback:$('#feedback').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // A free-play board lives in `gen` (and `genPuzzle`); set them first so boardOf('generated') finds it.
    if(d&&'gen' in d){gen=d.gen?MinimalBridge.clone(d.gen):null;genPuzzle=genBoard();}
    const next=d&&boardOf(d.at);
    if(!next||!Array.isArray(d.S?.cells)||d.S.cells.length!==next.w*next.h||!Array.isArray(d.S.undo)||!d.store||!Array.isArray(d.progress?.completed)||!d.prefs)throw Error('Invalid Tents snapshot');
    drag=null;dragDone=0;
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    for(const k of Object.keys(store))delete store[k];
    Object.assign(store,MinimalBridge.clone(d.store));
    progress.completed=d.progress.completed.slice();Object.assign(prefs,d.prefs);
    at=d.at;puzzle=next;
    Object.assign(S,{cells:d.S.cells.slice(),undo:d.S.undo.map(u=>u.slice()),solved:d.S.solved,focus:d.S.focus,hint:d.S.hint,keyboard:d.S.keyboard,pairs:MinimalBridge.clone(d.S.pairs||[])});
    applyPrefs();build();fit();render();
    say(d.feedback||'');
    write(K.settings,prefs);write(K.current,store);write(K.progress,progress);
    if(gen)write(K.generated,gen);else{try{localStorage.removeItem(K.generated);}catch(_){}}
    if(d.opening)write(K.opening,1);else{try{localStorage.removeItem(K.opening);}catch(_){}}
    save();
    MinimalBridge.restoreUI(d.ui);
  },
  settle(){},
  undoDepth:()=>S.undo.length,
  proof(){return{board:at,cells:S.cells.slice(),moves:S.undo.length};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
