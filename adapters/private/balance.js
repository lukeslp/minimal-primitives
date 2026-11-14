const __minimalOpeningDone=()=>{try{return localStorage.getItem(K.opening)!==null;}catch(_){return false;}};
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  // Opening boards keep their own ids (o1...) inside the one campaign mode the score validators accept.
  describe(){return{id:at,mode:'campaign',layout:{n:puzzle.n,givens:puzzle.givens,runsOnly:!!puzzle.runsOnly},solved:S.solved,repeat:progress.completed.includes(at),restored:S.cells.some((v,i)=>v!==puzzle.givens[i]),value:0,progress:{completed:progress.completed.length}};},
  snapshot(){return{at,store:{version:1,at:store.at,boards:store.boards},progress:{version:1,completed:progress.completed},prefs:{version:1,theme:prefs.theme,motion:prefs.motion},opening:__minimalOpeningDone(),state:{cells:S.cells,undo:S.undo,focus:S.focus,hint:S.hint,solved:S.solved,keyboard:S.keyboard},feedback:$('#feedback').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const p=d&&board(d.at),s=d&&d.state;
    if(!p||!s||!Array.isArray(s.cells)||s.cells.length!==p.n*p.n||!Array.isArray(s.undo)||!d.store||!d.store.boards||!d.progress||!Array.isArray(d.progress.completed)||!d.prefs)throw Error('Invalid Balance snapshot');
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    store.at=ids.has(d.store.at)?d.store.at:campaign[0].id;store.boards=MinimalBridge.clone(d.store.boards);
    progress.completed=d.progress.completed.filter(id=>ids.has(id));
    prefs.theme=d.prefs.theme;prefs.motion=d.prefs.motion;
    if(d.opening)write(K.opening,1);else{try{localStorage.removeItem(K.opening);}catch(_){}}
    at=d.at;puzzle=p;
    S.cells=s.cells.slice();S.undo=s.undo.map(a=>a.slice());S.focus=s.focus;S.hint=s.hint;S.solved=!!s.solved;S.keyboard=!!s.keyboard;
    applyPrefs();build();render();say(d.feedback||'');save();
    MinimalBridge.restoreUI(d.ui);
  },
  settle(){},
  undoDepth:()=>S.undo.length,
  proof(){return{board:at,cells:S.cells.slice()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
// Theme and motion are written outside save(); report them as well.
for(const id of ['theme','motion'])$('#'+id).addEventListener('change',()=>__minimal.changed());
