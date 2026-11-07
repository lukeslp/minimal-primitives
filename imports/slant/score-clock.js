/* Completion timing is independent of Undo and game saves. Luke Steuber. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BridgesScoreClock=factory();})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
class Clock{
 constructor(now=()=>performance.now(),wall=()=>Date.now()){this.now=now;this.wall=wall;this.run=null;}
 start(meta){this.run={...meta,start:this.now(),wallStart:this.wall(),assisted:false,repeat:!!meta.repeat,practice:!!meta.practice,result:null};}
 flag(name){if(this.run&&!this.run.result)this.run[name]=true;}
 finish(cells){const r=this.run;if(!r||r.result)return null;const elapsed=this.now()-r.start;if(Math.abs((this.wall()-r.wallStart)-elapsed)>2000)r.practice=true;const category=r.practice?'practice':r.repeat?(r.assisted?'repeat-assisted':'repeat'):(r.assisted?'assisted':'unassisted');r.result=Object.freeze({puzzle:r.puzzle,layout:r.layout,mode:r.mode,category,policy:'elapsed-v1',seconds:Math.max(1,Math.floor(elapsed/1000)),cells:cells.slice(),submission:r.submission});return r.result;}
}
return{Clock};
});
