const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){const p=boards[record.board];return{id:p.id||String(record.board+1),mode:'campaign',layout:p,solved:stage().solved,repeat:stage().solved,restored:history.length>0||stage().planets.some(v=>v!==null),value:0,progress:{completed:record.stages.filter(v=>v.solved).length}};},
  snapshot(){return{record,history,selected,bodies,wonAt:stage().solved?0:null,ui:MinimalBridge.ui()};},
  restore(d){cancel();const saved=migrate(d.record,boards);if(!saved)throw Error('Invalid saved constellation.');record=saved;load(record.board);history=d.history;selected=d.selected;bodies=d.bodies;wonAt=-Infinity;update();save();MinimalBridge.restoreUI(d.ui);},
  settle(){cancel();},
  undoDepth:()=>history.length,
  proof(){return{planets:stage().planets};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
