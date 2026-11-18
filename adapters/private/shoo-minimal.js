const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:board.id,mode:'campaign',layout:{cells:board.cells,walls:board.walls||[]},solved:solved(),repeat:progress.completed.includes(board.id),restored:hits>0||history.length>0,value:hits,progress:{completed:progress.completed.length}};},
  snapshot(){const st=MinimalBridge.clone(store);st.at=board.id;st.boards[board.id]={bees,homes:homes.slice(),hits,undo:history.slice(-400)};return{store:st,progress:MinimalBridge.clone(progress),prefs:{...prefs},bees,homes:homes.slice(),hits,history:history.map(u=>({bees:u.bees,homes:u.homes.slice(),hits:u.hits})),hint,focus,keyboard,washOrigin,feedback:$('#feedback').textContent,live:$('#live').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    // Saves are checked against all eighty boards (since game-riffs d3d9b9e the campaign is thirty of them): boards
    // outside the campaign keep their positions and finished marks, as the game keeps its own.
    const st=d&&d.store,saved=st&&boardOf(st.at);
    if(!saved||!isObject(st.boards)||!Object.keys(st.boards).every(id=>known.has(id)&&boardValid(id,st.boards[id]))||!validPosition({bees:d.bees,homes:d.homes,hits:d.hits},saved)||!Array.isArray(d.history)||!d.history.every(u=>validPosition(u,saved))||!Array.isArray(d.progress?.completed)||!d.progress.completed.every(id=>known.has(id))||!isObject(d.prefs))throw Error('Invalid saved Shoo board.');
    // A player last on a board outside the campaign stays there once every campaign board is done (a New Game+
    // board); before that, they go on from the first campaign board not yet done, as the game does on its own.
    const finishedAll=boards.every(b=>d.progress.completed.includes(b.id)),keep=ids.has(st.at)||(finishedAll&&poolIds.has(st.at));
    const next=keep?saved:(boards.find(b=>!d.progress.completed.includes(b.id))||boards[0]);
    epoch++;for(const job of queue)job.resolve();queue=[];animation?.finish();hinting=null;
    for(const m of rippling){m.g.remove();if(m.bee)m.bee.fly=null;}rippling.clear();
    for(const k of Object.keys(store))delete store[k];Object.assign(store,MinimalBridge.clone(st));store.at=next.id;store.pool=Array.isArray(st.pool)?[...new Set(st.pool.filter(id=>poolIds.has(id)))]:[];if(keep&&!ids.has(next.id)&&!store.pool.includes(next.id))store.pool.push(next.id);
    progress.completed=d.progress.completed.slice();Object.assign(prefs,d.prefs);write(K.settings,prefs);
    board=next;L=E.layout(board);history=keep?d.history.map(u=>({bees:u.bees,homes:u.homes.slice(),hits:u.hits})):[];hover=null;press=null;keyboard=!!d.keyboard;
    const kept=keep?{bees:d.bees,homes:d.homes,hits:d.hits}:store.boards[next.id];reset(kept?{bees:kept.bees,homes:kept.homes,hits:kept.hits}:{bees:E.start(next),homes:hivesOf(next).map(()=>0),hits:0});if(!keep&&kept)history=kept.undo.map(u=>({bees:u.bees,homes:u.homes.slice(),hits:u.hits}));
    hint=keep?d.hint??null:null;focus=keep&&Number.isInteger(d.focus)&&L.cells[d.focus]?d.focus:firstCell();washOrigin=keep?d.washOrigin??null:null;
    applyPrefs();rest();if(solved())paintWash(washOrigin??hivesOf(board)[0],false);else clearWash();
    say(keep?d.feedback||'':'');announce(keep?d.live||'':'');save();MinimalBridge.restoreUI(d.ui);
  },
  async settle(){animation?.finish();for(let n=0;(busy||queue.length)&&n<80;n++)await new Promise(r=>setTimeout(r,25));if(busy||queue.length)throw Error('Wait for the bees to land.');},
  undoDepth:()=>history.length,
  proof(){return{states:[...history,{bees,homes:homes.slice(),hits}]};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
