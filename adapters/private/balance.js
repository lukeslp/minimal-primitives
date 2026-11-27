const __minimalOpeningDone=()=>{try{return localStorage.getItem(K.opening)!==null;}catch(_){return false;}};
// Generated boards after the campaign (game-riffs PR 283, endless.js). The board in hand is kept under its own key,
// K.generated = {version:1, n, seed, marks, playing}, and made again from its size and seed; the wins after the
// campaign are kept under another, K.plus = {version:1, wins, held}. The snapshot carries both. A restore reads the
// board record as the game reads its own and never takes a win back: the higher count stands with the board it
// counted last. A snapshot from 0.5.19 or earlier has neither, and restoring it leaves the game's own as they are.
const __minimalGenerated=v=>{
  if(v===null)return{gen:null,p:null};
  if(!plain(v)||Object.keys(v).length!==5||v.version!==1||typeof v.playing!=='boolean')return null;
  const p=G.fromSeed(v.seed,v.n);
  return p&&E.stateValid(p,v.marks)?{gen:MinimalBridge.clone(v),p}:null;
};
const __minimalPlusValid=v=>v===undefined||plain(v)&&Object.keys(v).length===3&&v.version===1&&Number.isSafeInteger(v.wins)&&v.wins>=0&&typeof v.held==='string'&&v.held.length<=96;
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  // Opening boards keep their own ids (o1...) inside the one campaign mode the score validators accept. A generated
  // board is reported as mode 'endless' under its size and seed, and as a repeat once it is the win last counted; the
  // validators do not score it, as Weaves' endless cloths and Cast's free play are not.
  describe(){const free=at==='generated';return{id:free?'endless:'+puzzle.n+':'+puzzle.seed:at,mode:free?'endless':'campaign',layout:{n:puzzle.n,givens:puzzle.givens,runsOnly:!!puzzle.runsOnly},solved:S.solved,repeat:free?plus.held===G.identity(puzzle):progress.completed.includes(at),restored:S.cells.some((v,i)=>v!==puzzle.givens[i]),value:0,progress:{completed:progress.completed.length}};},
  snapshot(){return{at,store:{version:1,at:store.at,boards:store.boards},progress:{version:1,completed:progress.completed},generated:gen?MinimalBridge.clone(gen):null,plus:{version:1,wins:plus.wins,held:plus.held},prefs:{version:1,theme:prefs.theme,motion:prefs.motion},opening:__minimalOpeningDone(),state:{cells:S.cells,undo:S.undo,focus:S.focus,hint:S.hint,solved:S.solved,keyboard:S.keyboard},feedback:$('#feedback').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const has=!!d&&typeof d==='object'&&'generated' in d,g=has?__minimalGenerated(d.generated):{gen,p:genPuzzle};
    if(!g||!__minimalPlusValid(d&&d.plus))throw Error('Invalid Balance snapshot');
    // A generated board is the one the snapshot carries, never whichever this page holds.
    const p=d&&(d.at==='generated'?has&&g.p:board(d.at)),s=d&&d.state;
    if(!p||!s||!Array.isArray(s.cells)||s.cells.length!==p.n*p.n||d.at==='generated'&&!E.stateValid(p,s.cells)||!Array.isArray(s.undo)||!d.store||!d.store.boards||!d.progress||!Array.isArray(d.progress.completed)||!d.prefs)throw Error('Invalid Balance snapshot');
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    store.at=ids.has(d.store.at)?d.store.at:campaign[0].id;store.boards=MinimalBridge.clone(d.store.boards);
    progress.completed=d.progress.completed.filter(id=>ids.has(id));
    prefs.theme=d.prefs.theme;prefs.motion=d.prefs.motion;
    if(d.opening)write(K.opening,1);else{try{localStorage.removeItem(K.opening);}catch(_){}}
    // As the game reads its own save on load: the board in hand and the win held are not dealt again, and the seeds go
    // on from the board's.
    if(has){
      gen=g.gen;genPuzzle=g.p;
      if(gen){dealt.add(G.identity(genPuzzle));seed=(gen.seed+1)>>>0;write(K.generated,gen);}else{try{localStorage.removeItem(K.generated);}catch(_){}}
    }
    if(d.plus&&d.plus.wins>plus.wins){plus.wins=d.plus.wins;plus.held=d.plus.held;dealt.add(plus.held);write(K.plus,plus);}
    at=d.at;puzzle=p;generationFailed=false;
    S.cells=s.cells.slice();S.undo=s.undo.map(a=>a.slice());S.focus=s.focus;S.hint=s.hint;S.solved=!!s.solved;S.keyboard=!!s.keyboard;
    applyPrefs();build();render();say(d.feedback||'');save();
    MinimalBridge.restoreUI(d.ui);
  },
  settle(){},
  undoDepth:()=>S.undo.length,
  // A generated board's proof names its size and seed, so the board can be made again from it.
  proof(){return at==='generated'?{board:at,cells:S.cells.slice(),generated:{n:puzzle.n,seed:puzzle.seed,version:puzzle.version}}:{board:at,cells:S.cells.slice()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
// Theme and motion are written outside save(); report them as well.
for(const id of ['theme','motion'])$('#'+id).addEventListener('change',()=>__minimal.changed());
