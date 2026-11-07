/* Boundary-based Spiral Galaxies. Luke Steuber. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('../engine'));else root.GalaxyBoundaries=factory(root.Galaxies);})(typeof globalThis==='object'?globalThis:this,function(G){
'use strict';
const intros=[
 {id:'intro-1',w:6,h:1,centres:[[3,1],[9,1]],prompt:'Draw one line between the dots.'},
 {id:'intro-2',w:4,h:3,centres:[[3,3],[7,3]],prompt:'Continue the boundary from top to bottom.'},
 {id:'intro-3',w:3,h:3,centres:[[3,3],[4,1],[2,5]],prompt:'Each shape must match after a half-turn.'}
];
function topology(p){const t=G.topology(p),edges=[],adj=Array.from({length:t.n},()=>[]);for(let y=0;y<p.h;y++)for(let x=0;x<p.w;x++){const a=y*p.w+x;for(const [b,vertical]of[[x<p.w-1?a+1:-1,true],[y<p.h-1?a+p.w:-1,false]])if(b>=0){const locked=t.cores.some(c=>c.includes(a)&&c.includes(b)),e=edges.length;edges.push({a,b,vertical,x:vertical?x+1:x,y:vertical?y:y+1,locked});adj[a].push({b,e});adj[b].push({b:a,e});}}return{...t,edges,adj};}
function valid(p,walls){const t=topology(p);return Array.isArray(walls)&&walls.length===t.edges.length&&walls.every((v,e)=>(v===0||v===1)&&(!v||!t.edges[e].locked));}
function inspect(p,walls){const t=topology(p);if(!valid(p,walls))return{solved:false,invalid:true,regions:[],owner:[],redundant:[]};const owner=Array(t.n).fill(-1),regions=[];
 for(let i=0;i<t.n;i++)if(owner[i]<0){const id=regions.length,cells=[i];owner[i]=id;for(let k=0;k<cells.length;k++)for(const {b,e}of t.adj[cells[k]])if(!walls[e]&&owner[b]<0){owner[b]=id;cells.push(b);}const centres=t.cores.flatMap((core,g)=>core.every(c=>owner[c]===id)?[g]:[]),g=centres.length===1?centres[0]:-1,mismatch=g<0?[]:cells.filter(c=>t.pairs[g][c]<0||owner[t.pairs[g][c]]!==id);regions.push({cells,centres,g,mismatch,valid:g>=0&&!mismatch.length});}
 const redundant=t.edges.flatMap((e,i)=>walls[i]&&owner[e.a]===owner[e.b]?[i]:[]);
 return{owner,regions,redundant,solved:regions.every(r=>r.valid)&&!redundant.length};
}
function fromOwners(p,owners){return topology(p).edges.map(e=>Number(owners[e.a]!==owners[e.b]));}
return{intros,topology,valid,inspect,fromOwners};
});
