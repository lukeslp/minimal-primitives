// Towers resume adapter. Runs inside the game's closure, after its first render.
const __minimalPrimer=()=>{try{return localStorage.getItem(K.primer)!==null;}catch(_){return false;}};
// A saved board's marks with the board's fixed towers in place (the game's fillGivens, for one board).
const __minimalFill=(id,cells)=>{const p=ids.has(id)&&board(id);return p&&Array.isArray(cells)&&cells.length===p.n*p.n?cells.map((x,i)=>p.given[i]||x):cells;};
// A turn in progress or a drag under the finger comes to rest on the nearest quarter.
const __minimalRest=()=>{if(spin){cancelAnimationFrame(spin.frame);spin=null;}swipe=null;swiped=false;turn=((Math.round(turn/QUARTER)%4)+4)%4*QUARTER;};
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:at,mode:openingAt(at)>=0?'opening':'campaign',layout:{n:puzzle.n,clues:puzzle.clues,given:puzzle.given},solved:S.solved,repeat:progress.completed.includes(at),restored:!!S.undo.length||S.cells.some((v,i)=>v!==puzzle.given[i]),value:0,progress:{completed:progress.completed.length+(S.solved&&ids.has(at)&&!progress.completed.includes(at)?1:0)}};},
  snapshot(){return{at,gen:gen?MinimalBridge.clone(gen):null,S:{cells:S.cells.slice(),undo:S.undo.map(u=>u.slice()),focus:S.focus,hint:S.hint,solved:S.solved,keyboard:S.keyboard},store,progress,prefs,primer:__minimalPrimer(),turn:quarters(),view,feedback:$('#feedback').textContent,announce:$('#announce').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // A free-play board lives in `gen`; set it first so board('generated') can find it.
    if(d&&'gen' in d)gen=d.gen?MinimalBridge.clone(d.gen):null;
    // Marks saved under a fixed tower added since (game-riffs PR 202, eleven campaign boards) take its height, as the
    // game's own save loader does (fillGivens): the board in hand, each Undo step and every board kept in the store.
    if(d&&d.S&&Array.isArray(d.S.cells))d={...d,S:{...d.S,cells:__minimalFill(d.at,d.S.cells),undo:Array.isArray(d.S.undo)?d.S.undo.map(u=>__minimalFill(d.at,u)):d.S.undo}};
    if(d&&d.store&&typeof d.store==='object'&&d.store.boards&&typeof d.store.boards==='object')d={...d,store:{...d.store,boards:Object.fromEntries(Object.entries(d.store.boards).map(([id,cells])=>[id,__minimalFill(id,cells)]))}};
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
    if(gen)write(K.generated,gen);else{try{localStorage.removeItem(K.generated);}catch(_){}}
    if(d.primer)write(K.primer,1);else{try{localStorage.removeItem(K.primer);}catch(_){}}
    save();
    MinimalBridge.restoreUI(d.ui);
  },
  settle(){if(spin||swipe){__minimalRest();draw();}},
  undoDepth:()=>S.undo.length,
  proof(){return{board:at,cells:S.cells.slice(),moves:S.undo.length};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
