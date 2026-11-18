const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){const p=puzzle;return{id:p.id,mode:'campaign',layout:Object.fromEntries(['W','H','drive','clocks','pillars','tray'].map(k=>[k,p[k]])),solved:S.solved,repeat:completed.includes(p.id),restored:M.hits>0,value:M.hits,progress:{completed:completed.length}};},
  snapshot(){return{board:puzzle.id,model:M,prefs,completed,reached,order:3,pool:played.slice(),hint,keyboard,phases,tickStart,text:$('#feedback').textContent,ui:MinimalBridge.ui()};},
  restore(d){clearTimeout(timer);epoch++;queue=[];animation=null;refusal=null;handFrom=null;dragging=null;touches.clear();two=null;puzzle=ALL.find(p=>p.id===d.board);if(!puzzle||!E.valid(puzzle,d.model.placed)||!Array.isArray(d.completed)||!Number.isInteger(d.reached))throw Error('Invalid saved gear train.');prefs=d.prefs;completed=[...new Set(d.completed.filter(id=>ALL.some(b=>b.id===id)))];
    played=Array.isArray(d.pool)?[...new Set(d.pool.filter(id=>POOL.some(b=>b.id===id)))]:[];drawn=null;
    // The game's own reading (restore): plates keep their ids and solved marks on any of the fifty stay; reached counts
    // in the twenty-five with order 3 (game-riffs 9ad63d8), in boards.js's fifty with order 2 (d3d9b9e) and in id order
    // with neither, and every campaign plate a save had open stays open. A player on a plate that left the campaign goes
    // to the open campaign plate nearest it in boards.js's order, fresh; with the campaign finished it stays, wheels and all.
    const left=POOL.includes(puzzle)&&!allDone();M=left?blank():d.model;
    reached=Math.min(B.length-1,Math.max(opened(d),B.indexOf(puzzle),...completed.map(id=>B.findIndex(b=>b.id===id)+1),B.includes(puzzle)&&E.inspect(puzzle,M.placed).solved?B.indexOf(puzzle)+1:0));
    if(left){const at=ALL.indexOf(puzzle),far=c=>Math.abs(ALL.indexOf(c)-at);puzzle=B.slice(0,reached+1).reduce((best,c)=>far(c)<far(best)||far(c)===far(best)&&ALL.indexOf(c)>ALL.indexOf(best)?c:best);M=blank();}
    hint=left?null:d.hint;keyboard=d.keyboard;phases=left?[]:d.phases;tickStart=left?Date.now():d.tickStart;inspect();if(left)align();applyPrefs();rebuild();say(left?'':d.text||'');save();MinimalBridge.restoreUI(d.ui);},
  async settle(){for(let n=0;S.busy&&n<100;n++)await new Promise(r=>setTimeout(r,25));if(S.busy||queue.length)throw Error('Wait for the gears to settle.');},
  undoDepth:()=>M.history.length,
  proof(){return{placed:M.placed,hits:M.hits,history:M.history};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
