// Towers resume adapter. Runs inside the game's closure, after its first render.
const __minimalPrimer=()=>{try{return localStorage.getItem(K.primer)!==null;}catch(_){return false;}};
// A turn in progress or a drag under the finger comes to rest on the nearest quarter.
const __minimalRest=()=>{if(spin){cancelAnimationFrame(spin.frame);spin=null;}swipe=null;swiped=false;turn=((Math.round(turn/QUARTER)%4)+4)%4*QUARTER;};
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:at,mode:openingAt(at)>=0?'opening':'campaign',layout:{n:puzzle.n,clues:puzzle.clues,given:puzzle.given},solved:S.solved,repeat:progress.completed.includes(at),restored:!!S.undo.length||S.cells.some((v,i)=>v!==puzzle.given[i]),value:0,progress:{completed:progress.completed.length+(S.solved&&ids.has(at)&&!progress.completed.includes(at)?1:0)}};},
  snapshot(){return{at,S:{cells:S.cells.slice(),undo:S.undo.map(u=>u.slice()),focus:S.focus,hint:S.hint,solved:S.solved,keyboard:S.keyboard},store,progress,prefs,primer:__minimalPrimer(),turn:quarters(),view,feedback:$('#feedback').textContent,announce:$('#announce').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const next=d&&board(d.at);
    if(!next||!Array.isArray(d.S?.cells)||d.S.cells.length!==next.n*next.n||!Array.isArray(d.S.undo)||!d.store||!d.progress||!d.prefs)throw Error('Invalid Towers snapshot');
    stopTour();__minimalRest();
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    for(const k of Object.keys(store))delete store[k];
    Object.assign(store,MinimalBridge.clone(d.store));
    progress=MinimalBridge.clone(d.progress);Object.assign(prefs,d.prefs);
    at=d.at;puzzle=next;
    Object.assign(S,{cells:d.S.cells.slice(),undo:d.S.undo.map(u=>u.slice()),focus:d.S.focus,hint:d.S.hint,solved:d.S.solved,keyboard:d.S.keyboard});
    turn=(d.turn||0)*QUARTER;view=d.view||null;
    applyPrefs();build();render();
    $('#feedback').textContent=d.feedback||'';$('#announce').textContent=d.announce||'';
    write(K.settings,prefs);write(K.current,store);write(K.progress,progress);
    if(d.primer)write(K.primer,1);else{try{localStorage.removeItem(K.primer);}catch(_){}}
    save();
    MinimalBridge.restoreUI(d.ui);
  },
  settle(){if(spin||swipe){__minimalRest();draw();}},
  undoDepth:()=>S.undo.length,
  proof(){return{board:at,cells:S.cells.slice(),moves:S.undo.length};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
