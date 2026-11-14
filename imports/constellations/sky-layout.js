/* The sky map: fits a board's projected star positions to the stage, keeping the figure's true shape, and draws
   routes as straight lines between stars. Luke Steuber. Rules and saved edge order do not depend on this drawing. */
(function(r,f){if(typeof module==='object'&&module.exports)module.exports=f();else r.ConstellationSky=f();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 function randomFor(id){let seed=2166136261;for(const c of id)seed=Math.imul(seed^c.charCodeAt(0),16777619);return()=>{seed=Math.imul(seed,1664525)+1013904223|0;return(seed>>>0)/4294967296;};}
 // One scale for both axes, so a constellation keeps its shape; the figure is centered in the box less its margin.
 function create(p,width,height,margin){
  const xs=p.stars.map(s=>s.x),ys=p.stars.map(s=>s.y),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(1e-6,Math.max(...xs)-left),h=Math.max(1e-6,Math.max(...ys)-top);
  const scale=Math.min(Math.max(1,width-2*margin)/w,Math.max(1,height-2*margin)/h),ox=(width-w*scale)/2-left*scale,oy=(height-h*scale)/2-top*scale;
  const project=(x,y)=>({x:ox+x*scale,y:oy+y*scale}),point=i=>project(p.stars[i].x,p.stars[i].y);
  function route(edge){const A=point(edge.a),B=point(edge.b),steps=Math.max(8,Math.ceil(Math.hypot(B.x-A.x,B.y-A.y)/6));return Array.from({length:steps+1},(_,i)=>({x:A.x+(B.x-A.x)*i/steps,y:A.y+(B.y-A.y)*i/steps}));}
  function path(points,offset=0){return points.map((a,i)=>{const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)],dx=after.x-before.x,dy=after.y-before.y,length=Math.hypot(dx,dy)||1;return(i?'L':'M')+(a.x-dy/length*offset).toFixed(3)+' '+(a.y+dx/length*offset).toFixed(3);}).join(' ');}
  return{scale,project,point,route,path};
 }
 // The whole fit used in play: the sky map on the stage less a 30 px margin, each star's disc (about 15% of the
 // closest spacing between stars, 7 to 12 px, up to a fifth larger for the brightest and smaller for the faintest),
 // its 44 px or larger tap target, and the painted box cropped to the figure. The development generator runs the
 // same code on a 390 x 844 phone's stage, so what it checks is what a phone shows.
 function fit(p,width,height){
  const map=create(p,width,height,30),centers=p.stars.map((_,i)=>map.point(i));
  let spacing=Infinity;for(let i=0;i<centers.length;i++)for(let j=0;j<i;j++)spacing=Math.min(spacing,Math.hypot(centers[i].x-centers[j].x,centers[i].y-centers[j].y));
  const R=Math.max(7,Math.min(12,spacing*.15)),target=Math.max(44,Math.min(88,Math.floor(spacing*.92)));
  const radii=p.stars.map(a=>Math.max(5.5,R*(1+.2*Math.max(-1,Math.min(1,(2.5-(a.mag??3))/2.5)))));
  const outer=Math.max(target/2,Math.max(...radii)*1.9+8);
  const left=Math.min(...centers.map(a=>a.x))-outer,top=Math.min(...centers.map(a=>a.y))-outer;
  const paintedWidth=Math.max(...centers.map(a=>a.x))+outer-left,paintedHeight=Math.max(...centers.map(a=>a.y))+outer-top;
  const scale=Math.min(1,width/paintedWidth,height/paintedHeight),move=a=>({x:(a.x-left)*scale,y:(a.y-top)*scale});
  return{R:R*scale,target:target*scale,outer:outer*scale,radii:radii.map(v=>v*scale),width:paintedWidth*scale,height:paintedHeight*scale,scale:map.scale*scale,project:(x,y)=>move(map.project(x,y)),point:i=>move(map.point(i)),route:e=>map.route(e).map(move),path:map.path};
 }
 // Every route's handle. Handles start at their routes' middles. Where two would sit closer than a 44 px target,
 // the crowded ones slide apart along their routes, never closer than 9 px beyond a disc, trying seeded starts
 // until every pair clears 44 px or the tries run out (the best found is kept). Each handle: its place, its arc
 // length along the route and the route's direction there.
 function placeHandles(paths,edges,radii,id){
  const K=49,mid=(K-1)/2;
  const routes=paths.map((P,e)=>{const L=[0];for(let i=1;i<P.length;i++)L.push(L[i-1]+Math.hypot(P[i].x-P[i-1].x,P[i].y-P[i-1].y));const total=L.at(-1),lo=Math.min(radii[edges[e].a]+9,total/2),hi=Math.max(total-radii[edges[e].b]-9,total/2),place=d=>{let i=1;while(i<L.length-1&&L[i]<d)i++;const f=(d-L[i-1])/(L[i]-L[i-1]||1),x=P[i-1].x+(P[i].x-P[i-1].x)*f,y=P[i-1].y+(P[i].y-P[i-1].y)*f,dx=P[i].x-P[i-1].x,dy=P[i].y-P[i-1].y,n=Math.hypot(dx,dy)||1;return{x,y,s:d,tx:dx/n,ty:dy/n};};return Array.from({length:K},(_,k)=>place(lo+(hi-lo)*k/(K-1)));});
  const pick=routes.map(()=>mid),pt=e=>routes[e][pick[e]],gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const span=routes.map(r=>{const xs=r.map(a=>a.x),ys=r.map(a=>a.y);return{l:Math.min(...xs),r:Math.max(...xs),t:Math.min(...ys),b:Math.max(...ys)};});
  const near=routes.map((_,e)=>routes.map((_,f)=>f).filter(f=>f!==e&&span[e].l-50<span[f].r&&span[f].l-50<span[e].r&&span[e].t-50<span[f].b&&span[f].t-50<span[e].b));
  const least=()=>{let m=Infinity;for(let e=0;e<routes.length;e++)for(const f of near[e])m=Math.min(m,gap(pt(e),pt(f)));return m;};
  const crowd=routes.map((_,e)=>e).filter(e=>near[e].some(f=>gap(pt(e),pt(f))<45));
  if(crowd.length){
   const moving=[...new Set(crowd.flatMap(e=>[e,...near[e]]))],random=randomFor('handles:'+id);
   let best=pick.slice(),bestLeast=least();
   for(let attempt=0;attempt<60&&bestLeast<44;attempt++){
    const goal=45+attempt%4*2;
    if(attempt)for(const e of moving)pick[e]=Math.floor(random()*K);else for(const e of moving)pick[e]=mid;
    for(let round=0;round<30;round++){
     let changed=false;
     for(const e of moving){let choice=pick[e],score=Infinity;for(let k=0;k<K;k++){const q=routes[e][k];let cost=.004*(k-mid)**2;for(const f of near[e]){const d=gap(q,pt(f));if(d<goal)cost+=(goal-d)**2;}if(cost<score){score=cost;choice=k;}}if(choice!==pick[e]){pick[e]=choice;changed=true;}}
     if(!changed)break;
    }
    const m=least();if(m>bestLeast){bestLeast=m;best=pick.slice();}
   }
   best.forEach((k,e)=>pick[e]=k);
  }
  return routes.map((r,e)=>r[pick[e]]);
 }
 return{create,fit,placeHandles,randomFor};
});
