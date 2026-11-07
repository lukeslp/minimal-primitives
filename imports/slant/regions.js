/* Geometric sections for Slant. Closed sections use the visible clues or the board solution;
   free draw has neither, so every closed section fills, loop interiors included. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SlantRegions=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const palette=['#1768ff','#ffe000','#ed6500','#da5cce'];
// Four triangles per square: north, east, south, west. Grid edges are permeable;
// a drawn diagonal joins only its two triangles on each side.
function sections(p,cells,hasLoop=false,previous=new Map(),answer=null,free=false){
 const n=p.w*p.h,parent=Array.from({length:n*4},(_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
 function join(a,b){a=find(a);b=find(b);if(a!==b)parent[b]=a;}
 for(let i=0;i<n;i++){const k=i*4,x=i%p.w,y=Math.floor(i/p.w),v=cells[i];
  if(v===1){join(k,k+3);join(k+1,k+2);}else if(v===2){join(k,k+1);join(k+2,k+3);}else{join(k,k+1);join(k,k+2);join(k,k+3);}
  if(x+1<p.w)join(k+1,k+7);if(y+1<p.h)join(k+2,k+p.w*4);
 }
 const groups=new Map(),owner=parent.map((_,i)=>find(i));
 for(let t=0;t<owner.length;t++){const id=owner[t],i=Math.floor(t/4),side=t%4,x=i%p.w,y=Math.floor(i/p.w);if(!groups.has(id))groups.set(id,{id,triangles:[],open:false,edge:false});const g=groups.get(id);g.triangles.push(t);g.open||=!cells[i];g.edge||=(side===0&&y===0)||(side===1&&x===p.w-1)||(side===2&&y===p.h-1)||(side===3&&x===0);}
 const counts=Array((p.w+1)*(p.h+1)).fill(0),corners=i=>{const a=Math.floor(i/p.w)*(p.w+1)+i%p.w;return[a,a+1,a+p.w+2,a+p.w+1];};
 for(let i=0;i<n;i++)if(cells[i]){const c=corners(i);for(const j of(cells[i]===1?[1,3]:[0,2]))counts[c[j]]++;}
 const matches=t=>{const c=corners(Math.floor(t/4)),side=t%4;return[c[side],c[(side+1)%4]].every(v=>p.clues[v]<0||counts[v]===p.clues[v]);};
 const complete=[...groups.values()].filter(g=>!g.open&&(free||g.edge&&(answer?g.triangles.every(t=>cells[Math.floor(t/4)]===answer[Math.floor(t/4)]):!hasLoop&&g.triangles.every(matches)))),eligible=new Map(complete.map(g=>[g.id,g]));
 for(const g of complete){g.key=g.triangles.join(',');g.neighbors=new Set();g.color=-1;}
 for(let i=0;i<n;i++)if(cells[i]){const a=eligible.get(owner[i*4]),b=eligible.get(owner[i*4+2]);if(a&&b&&a!==b){a.neighbors.add(b);b.neighbors.add(a);}}
 // DSATUR with four-color backtracking, preferring existing region colors.
 // Vary the starting color by position; unchanged sections retain their color.
 function color(left){if(!left)return true;const next=complete.filter(g=>g.color<0).sort((a,b)=>saturation(b)-saturation(a)||b.neighbors.size-a.neighbors.size||a.triangles[0]-b.triangles[0])[0],used=new Set([...next.neighbors].map(g=>g.color)),preferred=previous.get(next.key),choices=[...new Set([preferred,...palette.map((_,c)=>(c+Math.floor(next.triangles[0]/4))%palette.length)])].filter(c=>Number.isInteger(c)&&c>=0&&c<4&&!used.has(c));for(const c of choices){next.color=c;if(color(left-1))return true;}next.color=-1;return false;}
 function saturation(g){return new Set([...g.neighbors].filter(n=>n.color>=0).map(n=>n.color)).size;}
 for(const g of complete){const c=previous.get(g.key);if(Number.isInteger(c)&&c>=0&&c<4)g.color=c;}
 if(complete.some(g=>g.color>=0&&[...g.neighbors].some(n=>n.color===g.color))||!color(complete.filter(g=>g.color<0).length)){for(const g of complete)g.color=-1;if(!color(complete.length))throw Error('Unable to color Slant sections');}
 return{regions:complete,colors:owner.map(id=>eligible.get(id)?.color??-1),memory:new Map(complete.map(g=>[g.key,g.color])),settled:cells.map((_,i)=>answer&&owner.slice(i*4,i*4+4).some(id=>eligible.has(id))?true:false)};
}
function paint(root,p,cells,hasLoop,answer=null,free=false){const key=p.w+'x'+p.h+':'+p.clues.join(',')+':'+cells.join(',')+':'+hasLoop+':'+(free?'free':answer?'standard':'hard');if(root._regionKey===key)return root._regionResult;root._regionKey=key;const cache=root._regionCache||(root._regionCache=new Map());let result=cache.get(key);if(!result){result=sections(p,cells,hasLoop,root._regionColors,answer,free);cache.set(key,result);if(cache.size>128)cache.delete(cache.keys().next().value);}root._regionResult=result;root._regionColors=result.memory;root.dataset.sections=result.regions.length;
 root.querySelectorAll('.cell').forEach((node,i)=>{const sides=result.colors.slice(i*4,i*4+4),fill=side=>sides[side]<0?'var(--bg)':'color-mix(in srgb,'+palette[sides[side]]+' var(--section-strength),var(--bg))',v=cells[i];node.style.setProperty('--section-a',fill(0));node.style.setProperty('--section-b',fill(2));if(v||!node.style.background)node.style.background=v===2?'linear-gradient(45deg,var(--section-b) 50%,var(--section-a) 50%)':'linear-gradient(135deg,var(--section-a) 50%,var(--section-b) 50%)';node.style.borderRightColor=sides[1]>=0?'transparent':'';node.style.borderBottomColor=sides[2]>=0?'transparent':'';node.dataset.sectionColors=sides.join(',');});return result;
}
return{palette,sections,paint};});
