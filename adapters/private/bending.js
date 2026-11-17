const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){const p=boards[record.board];return{id:p.id||String(record.board+1),mode:'campaign',layout:p,solved:stage().solved,repeat:stage().solved,restored:history.length>0||stage().planets.some(v=>v!==null),value:0,progress:{completed:record.stages.filter(v=>v.solved).length}};},
  // `record` is the playing record, kept by place; `named` is the same progress kept under each board's name, as the
  // game saves it (v3), so a later campaign that moves or drops boards can still read it.
  snapshot(){return{record,named:pack(record,campaign,pool),history,selected,bodies,wonAt:stage().solved?0:null,ui:MinimalBridge.ui()};},
  restore(d){
    // The game's own reading: a v3 save by name, or a v1/v2 record by place converted once (before game-riffs
    // d3d9b9e the library kept only the v2 record). Unreadable saves are refused, never replaced by a new game.
    const source=d&&d.named&&d.named.v>=3?d.named:d&&d.record&&(d.record.v===1||d.record.v===2)?d.record:null;
    const opened=source&&restore(JSON.stringify(source),null,campaign,pool);
    if(!opened||opened.keep!==null||!opened.record)throw Error('Invalid saved constellation.');
    cancel();record=opened.record;marks();load(record.board);
    // The Undo history and the planet in hand belong to the board they were made on: kept only when the save names
    // this same board (a v3 save), dropped when the board moved or left the campaign.
    if(source===d.named&&d.named.board===fingerprint(boards[record.board])){history=d.history;selected=d.selected;bodies=d.bodies;}
    wonAt=-Infinity;update();save();MinimalBridge.restoreUI(d.ui);
  },
  settle(){cancel();},
  undoDepth:()=>history.length,
  proof(){return{planets:stage().planets};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
