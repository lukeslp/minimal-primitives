// Delve has no Undo and no Hint. The adapter keeps the run's action log (the
// history and the completion proof: the seed plus every action replays the
// run) and the list of finished runs. A run's end is its completion, and its
// value is the depth reached.
const __minimalExtraKey=KEY+'.minimal';
const __minimalStore=()=>{try{localStorage.setItem(__minimalExtraKey,JSON.stringify({seed:run.seed,turn:run.turn,depth:run.depth,log:__minimalLog,ended:__minimalEnded}));}catch(_){}};
try{const x=JSON.parse(localStorage.getItem(__minimalExtraKey)||'null');if(x&&typeof x==='object'){if(Array.isArray(x.ended))__minimalEnded=x.ended.filter(e=>e&&typeof e==='object'&&typeof e.seed==='number');if(Array.isArray(x.log)&&x.seed===run.seed&&x.turn===run.turn&&x.depth===run.depth)__minimalLog=x.log;}}catch(_){}
const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){return{id:String(run.seed),mode:run.mode,layout:{seed:run.seed,w:D.W,h:D.H},solved:run.over,repeat:__minimalEnded.filter(e=>e.seed===run.seed).length>(run.over?1:0),restored:run.turn>0,value:run.depth,progress:{completed:__minimalEnded.length}};},
  snapshot(){return{run:D.serialize(run),save:{mode:save.mode,best:save.best,before:save.before,daily:save.daily,seen:save.seen},fell,struckMe,found,pendingNew:!!pendingNew,byKey,log:__minimalLog,ended:__minimalEnded,text:$('#live').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    if(!d||typeof d!=='object'||!d.run||!d.save||!Array.isArray(d.log)||!Array.isArray(d.ended)||!Array.isArray(d.fell))throw Error('Invalid Delve snapshot.');
    const next=D.deserialize(d.run);
    stopTravel();clearTimeout(pendingNew);
    run=next;
    save.mode=d.save.mode==='random'?'random':'daily';save.best=Number(d.save.best)||0;save.before=Number(d.save.before)||0;
    save.daily={key:String(d.save.daily?.key||''),best:Number(d.save.daily?.best)||0};save.seen=Object.assign({},d.save.seen);
    fell=d.fell;struckMe=!!d.struckMe;found=String(d.found||'');byKey=!!d.byKey;
    __minimalLog=d.log;__minimalEnded=d.ended;
    pendingNew=d.pendingNew?setTimeout(()=>{pendingNew=0;render();},4000):0;
    jump();render();settings();say(d.text||'');persist();MinimalBridge.restoreUI(d.ui);
  },
  // A walk to a tapped square is a chain of turns on a timer; a snapshot stops it where it stands.
  async settle(){stopTravel();},
  undoDepth:()=>__minimalLog.length,
  proof(){return{seed:run.seed,mode:run.mode,depth:run.depth,turn:run.turn,actions:__minimalLog};}
});
const __minimalPersist=persist;persist=function(){const value=__minimalPersist.apply(this,arguments);__minimalStore();__minimal.changed();return value;};
