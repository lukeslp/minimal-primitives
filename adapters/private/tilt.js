const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:current.id,mode:'campaign',layout:{levels:current.levels},solved,repeat:done.has(current.id),restored:moves>0,value:moves,progress:{completed:done.size}};},
  snapshot(){return{board:current.id,place,moves,solved,hint,undoStack,prefs,done:[...done],reached,text:$('live').textContent,ui:MinimalBridge.ui()};},
  restore(d){cancelMotion();reached=d.reached;go(d.board);place=d.place;moves=d.moves;solved=d.solved;hint=d.hint;undoStack=d.undoStack;Object.assign(prefs,d.prefs);done.clear();for(const id of d.done)done.add(id);applyPrefs();draw();placeMarble(centerOf(place.level,place.row,place.col),1);refresh();say(d.text||'');writeSave();MinimalBridge.restoreUI(d.ui);},
  async settle(){for(let n=0;busy&&n<80;n++)await new Promise(r=>setTimeout(r,25));if(busy)throw Error('Wait for the marble to stop.');},
  undoDepth:()=>undoStack.length,
  proof(){return{states:[...undoStack,snapshot()]};}
});
const __minimalWrite=writeSave;writeSave=function(){const value=__minimalWrite.apply(this,arguments);__minimal.changed();return value;};
const __minimalUndo=undo;undo=function(){const value=__minimalUndo.apply(this,arguments);__minimal.changed();return value;};
