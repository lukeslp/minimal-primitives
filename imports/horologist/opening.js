/* Horologist's opening boards: three small plates that lead the game on a first visit, each about which way a wheel
   turns, and come back from Help ("Play the opening boards again"). They are not campaign plates: no progress,
   no count, no New Game+. 1: one wheel between the drive and the clock (wheels in mesh turn opposite ways).
   2: two wheels run the clock backwards, three run it forwards. 3: two small wheels run it backwards round the
   pillar, one big wheel runs it forwards. Each has one answer (engine search); found with the engine on 2026-11-20.
   Luke Steuber. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HorologistOpening=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
return [
 {id:'o1',W:2,H:3,drive:{at:[0,0],size:1},clocks:[{at:[-1,2],size:1}],pillars:[],tray:{1:1,3:0,5:0},par:1,ways:1},
 {id:'o2',W:3,H:3,drive:{at:[0,0],size:1},clocks:[{at:[2,1],size:1}],pillars:[],tray:{1:3,3:0,5:0},par:3,ways:1},
 {id:'o3',W:3,H:3,drive:{at:[0,0],size:1},clocks:[{at:[2,0],size:1}],pillars:[[1,0]],tray:{1:2,3:1,5:0},par:1,ways:1}
];});
