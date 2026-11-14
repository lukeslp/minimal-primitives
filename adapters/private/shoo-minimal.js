const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:board.id,mode:'campaign',layout:{cells:board.cells,walls:board.walls||[]},solved:solved(),repeat:progress.completed.includes(board.id),restored:hits>0||history.length>0,value:hits,progress:{completed:progress.completed.length}};},
  snapshot(){const st=MinimalBridge.clone(store);st.at=board.id;st.boards[board.id]={bees,homes:homes.slice(),hits,undo:history.slice(-400)};return{store:st,progress:MinimalBridge.clone(progress),prefs:{...prefs},bees,homes:homes.slice(),hits,history:history.map(u=>({bees:u.bees,homes:u.homes.slice(),hits:u.hits})),hint,focus,keyboard,washOrigin,wasSolved,feedback:$('#feedback').textContent,live:$('#live').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const st=d&&d.store,next=st&&boardOf(st.at);
    if(!next||!isObject(st.boards)||!Object.keys(st.boards).every(id=>ids.has(id)&&boardValid(id,st.boards[id]))||!validPosition({bees:d.bees,homes:d.homes,hits:d.hits},next)||!Array.isArray(d.history)||!d.history.every(u=>validPosition(u,next))||!Array.isArray(d.progress?.completed)||!d.progress.completed.every(id=>ids.has(id))||!isObject(d.prefs))throw Error('Invalid saved Shoo board.');
    epoch++;for(const job of queue)job.resolve();queue=[];animation?.finish();hinting=null;
    for(const m of rippling){m.g.remove();if(m.bee)m.bee.fly=null;}rippling.clear();
    for(const k of Object.keys(store))delete store[k];Object.assign(store,MinimalBridge.clone(st));
    progress.completed=d.progress.completed.slice();Object.assign(prefs,d.prefs);write(K.settings,prefs);
    board=next;L=E.layout(board);history=d.history.map(u=>({bees:u.bees,homes:u.homes.slice(),hits:u.hits}));hover=null;press=null;keyboard=!!d.keyboard;
    reset({bees:d.bees,homes:d.homes,hits:d.hits});
    hint=d.hint??null;focus=Number.isInteger(d.focus)&&L.cells[d.focus]?d.focus:firstCell();washOrigin=d.washOrigin??null;wasSolved=!!d.wasSolved;
    applyPrefs();rest();if(solved())paintWash(washOrigin??hivesOf(board)[0],false);else clearWash();
    say(d.feedback||'');announce(d.live||'');save();MinimalBridge.restoreUI(d.ui);
  },
  async settle(){animation?.finish();for(let n=0;(busy||queue.length)&&n<80;n++)await new Promise(r=>setTimeout(r,25));if(busy||queue.length)throw Error('Wait for the bees to land.');},
  undoDepth:()=>history.length,
  proof(){return{states:[...history,{bees,homes:homes.slice(),hits}]};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
