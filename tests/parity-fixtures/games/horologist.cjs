'use strict';
// Horologist parity steps. Since game-riffs PR 262 (69ee5cb3) a first visit opens on the three opening boards
// (opening.js), which record nothing; the campaign step leaves them for board 1 from the Settings board list, as a
// player does. Every other step is the base one.
module.exports={
  async campaign(f,h){
    await h.settings(f,'horologist',async()=>{
      await f.locator('#level-catalog button').first().click();
    });
    h.assert.equal(await f.evaluate(()=>__horologist.board),await f.evaluate(()=>__horologist.boards[0].id),'horologist: board 1 is open');
  },
};
