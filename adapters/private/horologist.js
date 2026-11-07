const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){const p=puzzle;return{id:p.id,mode:'campaign',layout:Object.fromEntries(['W','H','drive','clocks','pillars','tray'].map(k=>[k,p[k]])),solved:S.solved,repeat:completed.includes(p.id),restored:M.hits>0,value:M.hits,progress:{completed:completed.length}};},
  snapshot(){return{board:puzzle.id,model:M,prefs,completed,reached,hint,keyboard,phases,tickStart,text:$('#feedback').textContent,ui:MinimalBridge.ui()};},
  restore(d){clearTimeout(timer);epoch++;queue=[];animation=null;refusal=null;handFrom=null;dragging=null;touches.clear();two=null;puzzle=B.find(p=>p.id===d.board);if(!puzzle||!E.valid(puzzle,d.model.placed))throw Error('Invalid saved gear train.');M=d.model;prefs=d.prefs;completed=d.completed;reached=d.reached;hint=d.hint;keyboard=d.keyboard;phases=d.phases;tickStart=d.tickStart;inspect();applyPrefs();rebuild();say(d.text||'');save();MinimalBridge.restoreUI(d.ui);},
  async settle(){for(let n=0;S.busy&&n<100;n++)await new Promise(r=>setTimeout(r,25));if(S.busy||queue.length)throw Error('Wait for the gears to settle.');},
  undoDepth:()=>M.history.length,
  proof(){return{placed:M.placed,hits:M.hits,history:M.history};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
