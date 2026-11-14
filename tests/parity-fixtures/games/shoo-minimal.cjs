'use strict';
// Shoo · Minimal: the default steps fit (cells, #campaign, #theme, #motion);
// only the save shape differs.
module.exports={
  creditsBoard:true,
  storageKey:'shoo-minimal.current.v2',
  history:s=>s.history,
  position:s=>s.bees,
  otherBoards(state,assert){
    const saved=Object.entries(state.store.boards);
    assert(saved.length>=2,'two board saves');
    assert(saved.some(([id,b])=>id!==state.store.at&&b.hits>0),'first board keeps its taps');
  }
};
