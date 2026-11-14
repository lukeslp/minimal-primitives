/* Constellations night sky. Luke Steuber. At the solve, the true sky around the constellation in the board's own
   projection: the catalog's real stars to magnitude 6 at their real places, brightness and color (sky.json, from
   d3-celestial and XHIP; see THIRD_PARTY.md), with generated faint stars below magnitude 6, counted about three times as
   many for each magnitude fainter, and the Milky Way's extra faint stars laid along the galactic plane. Points
   only: no gradient, blur or haze. Rules and saves never depend on it. */
(function(r,f){if(typeof module==='object'&&module.exports)module.exports=f();else r.ConstellationStarfield=f();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 // ---- Seeded numbers: a 32-bit mix, a stream per seed, and smooth value noise. ----
 const mix=x=>{x=Math.imul(x^x>>>16,0x7feb352d);x=Math.imul(x^x>>>15,0x846ca68b);return(x^x>>>16)>>>0;};
 const seedOf=id=>{let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return mix(h>>>0);};
 const stream=s=>()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
 const lattice=(s,i,j)=>mix(s^Math.imul(i,374761393)^Math.imul(j,668265263))/4294967296;
 function noise(s,x,y){const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),a=lattice(s,i,j),b=lattice(s,i+1,j),c=lattice(s,i,j+1),d=lattice(s,i+1,j+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
 const smooth=v=>v<=0?0:v>=1?1:v*v*(3-2*v);

 // ---- The sky's make-up ----
 // Stellar colors by temperature, kept pale so the field reads white until looked at closely:
 // blue-white, white, yellow-white, yellow, orange and a rare red, with their shares of the field.
 const TINTS=[[222,231,255],[238,243,255],[255,252,246],[255,244,228],[255,230,204],[255,212,186]],SHARE=[.11,.36,.62,.83,.965,1];
 const LAW=Math.log10(3),rad=Math.PI/180;
 // Magnitudes between lo and hi with counts rising threefold per magnitude fainter.
 const magnitude=(u,lo,hi)=>lo+Math.log10(1+u*(10**(LAW*(hi-lo))-1))/LAW;
 // Light in device pixels: the faintest star drawn lights about a fifth of a CSS pixel; brighter stars are
 // compressed (exponent .72) the way a photograph's highlights are.
 const lightOf=(m,dpr,faint)=>.2*dpr*dpr*10**(.4*.72*(faint-m));
 // A catalog star's B-V color index to a pale tint: blue-white, white, yellow-white, yellow, orange, red.
 const tintOfColor=bv=>bv<0?0:bv<.3?1:bv<.6?2:bv<1?3:bv<1.45?4:5;

 // ---- The catalog ----
 // sky.json packs each star as four little-endian 16-bit numbers: right ascension, declination, magnitude, B-V.
 // It is fetched after the page settles, never before the first board is playable.
 let catalog=null,loading=null;
 function load(){
  if(!loading)loading=fetch('./sky.json').then(r=>r.ok?r.json():null).then(d=>{
   if(!d||typeof d.stars!=='string')return null;
   const bin=atob(d.stars),n=Math.floor(bin.length/8),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
   const v=new DataView(bytes.buffer),out={ra:new Float32Array(n),dec:new Float32Array(n),mag:new Float32Array(n),bv:new Float32Array(n),count:n};
   for(let i=0;i<n;i++){out.ra[i]=v.getUint16(i*8,true)/65535*360;out.dec[i]=v.getInt16(i*8+2,true)/32767*90;out.mag[i]=v.getInt16(i*8+4,true)/1000;out.bv[i]=v.getInt16(i*8+6,true)/1000;}
   return catalog=out;
  }).catch(()=>null);
  return loading;
 }

 // ---- Projection and the galaxy ----
 // Stereographic about the board's center, north up and east to the left, in degrees on the tangent plane
 // (x to the right, y downward): the same projection the boards were laid out in.
 function projector(c){const a0=c.ra*rad,d0=c.dec*rad,s0=Math.sin(d0),c0=Math.cos(d0);return(ra,dec)=>{const de=dec*rad,dra=ra*rad-a0,sd=Math.sin(de),cd=Math.cos(de),cr=Math.cos(dra),k=2/(1+s0*sd+c0*cd*cr);return{x:-k*cd*Math.sin(dra)/rad,y:-k*(c0*sd-s0*cd*cr)/rad,front:s0*sd+c0*cd*cr>-.2};};}
 function unprojector(c){const a0=c.ra*rad,d0=c.dec*rad,s0=Math.sin(d0),c0=Math.cos(d0);return(x,y)=>{const xe=-x*rad,yn=-y*rad,rho=Math.hypot(xe,yn);if(rho<1e-9)return{ra:c.ra,dec:c.dec};const cc=2*Math.atan(rho/2),sc=Math.sin(cc),ccos=Math.cos(cc);return{ra:((a0+Math.atan2(xe*sc,rho*c0*ccos-yn*s0*sc))/rad+360)%360,dec:Math.asin(Math.max(-1,Math.min(1,ccos*s0+yn*sc*c0/rho)))/rad};};}
 // Galactic longitude and latitude (degrees) from J2000 right ascension and declination.
 const NGP={ra:192.85948*rad,dec:27.12825*rad},NCP=122.93192;
 function galactic(ra,dec){const a=ra*rad-NGP.ra,d=dec*rad,sb=Math.sin(d)*Math.sin(NGP.dec)+Math.cos(d)*Math.cos(NGP.dec)*Math.cos(a);const l=NCP-Math.atan2(Math.cos(d)*Math.sin(a),Math.sin(d)*Math.cos(NGP.dec)-Math.cos(d)*Math.sin(NGP.dec)*Math.cos(a))/rad;return{l:(l+720)%360,b:Math.asin(Math.max(-1,Math.min(1,sb)))/rad};}
 // How crowded the Milky Way is at a galactic position, from 0 well off the plane to about 2.5 in the bright
 // clouds toward the center: a band about 7 degrees deep, thicker and brighter toward Sagittarius, mottled by
 // clouds, with the Great Rift darkening it from Cygnus to Sagittarius just north of the plane.
 const N=[mix(911),mix(1213),mix(1517),mix(1913)];
 function milky(l,b){
  const L=((l+180)%360+360)%360-180,width=7*(1+.4*Math.exp(-((L/45)**2))),core=Math.exp(-((b/width)**2)),bulge=1+1.3*Math.exp(-((L/30)**2)-((b/12)**2));
  const clouds=(.35+1.2*noise(N[0],l/8,b/8))*(.7+.6*noise(N[1],l/2.6,b/2.6));
  const lane=L>0&&L<90?.9*Math.exp(-(((b-1.2-1.6*Math.sin(L/15))/(1.6+.9*noise(N[2],l/4,b/4)))**2))*smooth(L/10)*smooth((90-L)/12):0;
  return core*bulge*clouds*(1-lane);
 }
 // Stars of every magnitude are thicker toward the plane: about twice as many there as near its poles.
 const plainDensity=b=>.75+.75*Math.exp(-((b/22)**2));

 // Room for the field near the figure and near the controls, each 1 in open sky, -1 where nothing may stand
 // (a few pixels around a disc or thread, or on a control) and in between over a ramp, so the field thins
 // toward them rather than stopping at an edge. The masks are drawn at quarter scale.
 function clearance(figure,W,H){
  const q=.25,w=Math.max(1,Math.ceil(W*q)),h=Math.max(1,Math.ceil(H*q)),steps=6;
  const mask=draw=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const x=canvas.getContext('2d',{willReadFrequently:true});x.scale(q,q);x.lineCap=x.lineJoin='round';draw(x);return x.getImageData(0,0,w,h).data;};
  const solid=(x,a)=>{x.fillStyle=x.strokeStyle=`rgba(255,255,255,${a})`;};
  const drawn=(x,pad)=>{x.lineWidth=2*pad;x.beginPath();for(const line of figure.lines)line.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.stroke();x.beginPath();for(const d of figure.discs){x.moveTo(d.x+d.r+pad,d.y);x.arc(d.x,d.y,d.r+pad,0,Math.PI*2);}x.fill();};
  const boxed=(x,pad)=>{for(const b of figure.boxes)x.fillRect(b.l-pad,b.t-pad,b.r-b.l+2*pad,b.b-b.t+2*pad);};
  const ramp=(shape,near,span)=>{const hard=mask(x=>{solid(x,1);shape(x,near);}),soft=mask(x=>{x.globalCompositeOperation='lighter';solid(x,1/steps);for(let k=1;k<=steps;k++)shape(x,near+k*span/steps);});return(px,py)=>{const i=(Math.min(h-1,Math.max(0,py*q|0))*w+Math.min(w-1,Math.max(0,px*q|0)))*4+3;return hard[i]>127?-1:soft[i]/255;};};
  return{figure:ramp(drawn,figure.near,figure.ramp),controls:ramp(boxed,2,20)};
 }
 // Every star of the sky for this board and screen.
 // - The catalog's stars to magnitude 6 stand where they really are, except the figure's own (drawn as discs)
 //   and any within a few pixels of the figure or on a control.
 // - Below magnitude 6, generated stars fill in down to a limit set by the field's scale, so a narrow field shows
 //   fainter stars, as a longer lens would: about one star per 90 square pixels in open sky, counted from the
 //   sky's average of 0.12 stars per square degree brighter than 6 and three times as many per magnitude fainter.
 //   They come from 40 px cells counted from the screen's center, each with its own seeded streams.
 // - The Milky Way adds many more faint stars, and none bright, where the galactic plane crosses the field.
 // Near the figure faint stars thin to half and the rest fade out; near the controls only faint ones stay; bright
 // generated stars keep clear of both. It yields after each row of cells to spread the work over several tasks.
 // Faint means within 1.3 magnitudes of the field's limit, about half a CSS pixel of light or less.
 const BRIGHT=2.6,FAINTISH=1.3;
 function* generate(o,W,H,room,out){
  const seed=seedOf(o.seed),cx=W/2,cy=H/2,C=40,g=8,s=o.scale,toPx=(x,y)=>({x:o.origin.x+x*s,y:o.origin.y+y*s}),toSky=unprojector(o.center);
  const limit=Math.max(8.5,Math.min(11.5,6+Math.log(s*s/(90*.122))/Math.log(3))),PLAIN=Math.round(C*C/90*1.5),BAND=Math.round(C*C/90*14);
  out.limit=limit;out.counts=Array(Math.ceil(limit)+1).fill(0);const stars=out.stars=[],tintOf=hue=>{let t=0;while(hue>=SHARE[t])t++;return t;};
  // The galaxy on an 8 px grid: the plain stars' density and the Milky Way's crowd.
  const gw=Math.ceil(W/g)+2,gh=Math.ceil(H/g)+2,crowd=new Float32Array(gw*gh),plain=new Float32Array(gw*gh);
  for(let j=0;j<gh;j++){for(let i=0;i<gw;i++){const q=toSky((i*g-o.origin.x)/s,(j*g-o.origin.y)/s),G=galactic(q.ra,q.dec);crowd[j*gw+i]=milky(G.l,G.b)/2.5;plain[j*gw+i]=plainDensity(G.b)/1.5;}if(j%16===15)yield;}
  const at=(grid,x,y)=>grid[Math.round(Math.min(H-1,Math.max(0,y))/g)*gw+Math.round(Math.min(W-1,Math.max(0,x))/g)];
  const middle=galactic(o.center.ra,o.center.dec);out.plane={l:+middle.l.toFixed(2),b:+middle.b.toFixed(2)};
  // Whether a star of magnitude m, with its own spare number, may stand at x, y.
  const allowed=(x,y,m,spare)=>{const f=room.figure(x,y);if(f<0)return false;if(m>=limit-FAINTISH)return spare>=.5*f;const c=room.controls(x,y);if(m<BRIGHT)return f===0&&c===0;return c>=0&&spare>=Math.max(f,c);};
  // The real stars.
  out.real=0;out.figure=[];
  if(catalog){
   const project=projector(o.center),skip=new Set(o.figureStars||[]);
   for(let k=0;k<catalog.count;k++){
    const q=project(catalog.ra[k],catalog.dec[k]);if(!q.front)continue;const p=toPx(q.x,q.y);
    if(skip.has(k)){out.figure.push({k,x:+p.x.toFixed(2),y:+p.y.toFixed(2)});continue;}
    if(p.x<-3||p.y<-3||p.x>W+3||p.y>H+3||room.figure(p.x,p.y)<0||room.controls(p.x,p.y)<0)continue;
    const m=catalog.mag[k];stars.push({x:p.x,y:p.y,m,tint:tintOfColor(catalog.bv[k]),band:false,real:true,spark:(k*.61803)%1});out.real++;
   }
  }
  yield;
  for(let j=Math.floor(-cy/C);j*C<H-cy;j++){
   for(let i=Math.floor(-cx/C);i*C<W-cx;i++){
    const r=stream(mix(seed^Math.imul(i,73856093)^Math.imul(j,19349663)));
    // Each candidate draws its five numbers whether or not it is kept.
    for(let n=0;n<PLAIN;n++){
     const x=cx+(i+r())*C,y=cy+(j+r())*C,u=r(),hue=r(),keep=r();
     if(x<0||y<0||x>=W||y>=H||keep*.999>=at(plain,x,y)*2)continue;
     const m=magnitude(u,6,limit),spare=keep*7919%1;if(!allowed(x,y,m,spare))continue;
     if(room.figure(x,y)===0&&room.controls(x,y)===0)out.counts[m|0]++;
     stars.push({x,y,m,tint:tintOf(hue),band:false,spark:keep*9973%1});
    }
    // The Milky Way: each cell takes a count from its most crowded point, then keeps stars in proportion.
    const x0=cx+i*C,y0=cy+j*C;let most=0;
    for(const fx of [0,.5,1])for(const fy of [0,.5,1])most=Math.max(most,at(crowd,x0+fx*C,y0+fy*C));
    if(most<.01)continue;
    most=Math.min(1.2,most*1.15);
    const b=stream(mix(seed^0x5bd1e995^Math.imul(i,83492791)^Math.imul(j,2654435761)));
    for(let n=Math.floor(BAND*most+b());n>0;n--){
     const x=x0+b()*C,y=y0+b()*C,u=b(),hue=b(),keep=b();
     if(x<0||y<0||x>=W||y>=H||keep*most>=at(crowd,x,y))continue;
     const m=magnitude(u,6.5,limit+.6);if(!allowed(x,y,m,keep*7919%1))continue;
     stars.push({x,y,m,tint:tintOf(hue),band:true,spark:keep*9973%1});
    }
   }
   yield;
  }
 }

 // ---- Drawing ----
 // Fills by tint and by alpha in 32nds, made once. A group of shapes keeps flat arrays per fill:
 // rectangles as x, y, width, height and discs as x, y, radius, in device pixels.
 const LEVELS=32,FILLS=TINTS.map(t=>Array.from({length:LEVELS+1},(_,k)=>`rgba(${t[0]},${t[1]},${t[2]},${(k/LEVELS).toFixed(4)})`));
 const level=a=>Math.max(1,Math.min(LEVELS,Math.round(a*LEVELS)));
 const empty=()=>({rects:[],discs:[]});
 const put=(list,key,...v)=>{(list[key]||(list[key]=[])).push(...v);};
 function shapes(star,dpr,out,bright,faint){
  const x=Math.round(star.x*dpr),y=Math.round(star.y*dpr),L=lightOf(star.m,dpr,faint),t=star.tint*(LEVELS+1);
  if(L<=1){put(out.rects,t+level(L),x,y,1,1);return;}
  if(L<=4){
   // A point that spills into its four neighbors reads as a slightly brighter star while staying crisp.
   const a=t+level((L-1)/4);put(out.rects,t+LEVELS,x,y,1,1);put(out.rects,a,x-1,y,1,1,x+1,y,1,1,x,y-1,1,1,x,y+1,1,1);return;
  }
  // A tight core with a falloff of a few pixels; the brightest few also carry hairline spikes.
  const r=Math.min(Math.sqrt(L/Math.PI),2.4*Math.sqrt(dpr)),cx=x+.5,cy=y+.5;
  if(L>10){put(out.discs,t+level(.05),cx,cy,r+2.6*dpr);put(out.discs,t+level(.12),cx,cy,r+1.4*dpr);}
  put(out.discs,t+level(.3),cx,cy,r+.6*dpr);put(out.discs,t+LEVELS,cx,cy,r);
  if(bright){const len=r*5.5;for(const [k,a]of[[0,.34],[1,.13],[2,.05]]){const from=r+k*len/3,to=r+(k+1)*len/3,w=to-from;put(out.rects,t+level(a),x-to,y,w,1,x+1+from,y,w,1,x,y-to,1,w,x,y+1+from,1,w);}}
 }
 function paint(ctx,group,alpha){
  ctx.globalAlpha=alpha;
  group.rects.forEach((list,key)=>{ctx.fillStyle=FILLS[key/(LEVELS+1)|0][key%(LEVELS+1)];ctx.beginPath();for(let i=0;i<list.length;i+=4)ctx.rect(list[i],list[i+1],list[i+2],list[i+3]);ctx.fill();});
  group.discs.forEach((list,key)=>{ctx.fillStyle=FILLS[key/(LEVELS+1)|0][key%(LEVELS+1)];ctx.beginPath();for(let i=0;i<list.length;i+=3){ctx.moveTo(list[i]+list[i+2],list[i+1]);ctx.arc(list[i],list[i+1],list[i+2],0,Math.PI*2);}ctx.fill();});
  ctx.globalAlpha=1;
 }

 // ---- The reveal ----
 // Stars come out from brightest to faintest over about two seconds, each over a third of a second, the way
 // eyes adapt to the dark; the Milky Way's faint stars come last. Afterwards about one star in forty of the
 // middling ones shimmers slowly, by up to a third of its light.
 const SPAN=1700,FADE=350,LAST=[1350,900],STEP=50;
 function create(canvas){
  let sky=null,still=true,paused=false,frame=0,start=0,shown=false,info=null,lastShimmer=0,job=0,ready=false,task=null;
  const ctx=canvas.getContext('2d'),baked=document.createElement('canvas'),bake=baked.getContext('2d');
  // The catalog loads once the page is idle, after the first board is up.
  (window.requestIdleCallback||(f=>setTimeout(f,800)))(()=>load(),{timeout:2500});
  // Long work runs in slices of about 8 ms between other tasks, so the page never stalls.
  const channel=new MessageChannel();channel.port1.onmessage=()=>{if(task)task();};
  function run(steps,id,done){
   task=()=>{if(id!==job)return;const end=performance.now()+8;for(;;){const r=steps.next();if(r.done){task=null;done(r.value);return;}if(r.value==='wait'){setTimeout(()=>{if(task)task();},30);return;}if(performance.now()>end)break;}channel.port2.postMessage(0);};
   channel.port2.postMessage(0);
  }
  function* build(o,W,H,dpr){
   if(!catalog&&o.catalog!==false)yield* waitFor(load());
   const room=clearance(o.figure,W,H);yield;
   const made={};yield* generate(o,W,H,room,made);
   const faint=made.limit,lo=Math.min(...made.stars.map(s=>s.m),6);
   const cohorts=new Map(),shimmer=[],top=made.stars.filter(s=>s.real).sort((a,b)=>a.m-b.m).slice(0,3).filter(s=>lightOf(s.m,1,faint)>4);
   let n=0;
   for(const star of made.stars){
    const time=star.band?LAST[0]+LAST[1]*star.spark:SPAN*((star.m-lo)/(faint-lo))**.9,L=lightOf(star.m,dpr,faint);
    if(!star.band&&!star.real&&L>.5*dpr*dpr&&L<=4&&star.spark<.025){const out=empty();shapes(star,dpr,out,false,faint);shimmer.push({out,time,phase:star.spark*1e3,period:2600+star.m*400});}
    else{const key=Math.floor(time/STEP);if(!cohorts.has(key))cohorts.set(key,{time:key*STEP,...empty(),done:false});shapes(star,dpr,cohorts.get(key),top.includes(star),faint);}
    if(++n%4000===0)yield;
   }
   return{cohorts:[...cohorts.values()].sort((a,b)=>a.time-b.time),shimmer,info:{stars:made.stars.length,real:made.real,bandStars:made.stars.filter(s=>s.band).length,counts:made.counts,limit:+faint.toFixed(2),plane:made.plane,figure:made.figure,bright:top.map(s=>({x:+(s.x-W/2).toFixed(2),y:+(s.y-H/2).toFixed(2),m:+s.m.toFixed(3)})),dpr:+dpr.toFixed(3)}};
  }
  // Waits on a promise inside the sliced work: the slices idle until it settles.
  function* waitFor(promise){let settled=false;promise.then(()=>settled=true,()=>settled=true);while(!settled)yield 'wait';}
  function* settle(){for(const c of sky.cohorts)if(!c.done){paint(bake,c,1);c.done=true;yield;}}
  function draw(now,revealing){
   const t=now-start;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
   if(revealing)for(const c of sky.cohorts)if(!c.done&&t-c.time>=FADE){paint(bake,c,1);c.done=true;}
   ctx.drawImage(baked,0,0);
   if(revealing)for(const c of sky.cohorts)if(!c.done){const a=(t-c.time)/FADE;if(a>0)paint(ctx,c,a);}
   for(const s of sky.shimmer){const a=revealing?Math.max(0,Math.min(1,(t-s.time)/FADE)):1,wave=still||paused?1:.83+.17*Math.sin(now/s.period*6.283+s.phase);if(a>0)paint(ctx,s.out,a*wave);}
  }
  function loop(now){
   frame=0;if(!sky||paused)return;
   if(sky.reveal&&now-start<LAST[0]+LAST[1]+FADE){draw(now,true);frame=requestAnimationFrame(loop);return;}
   if(sky.reveal){sky.reveal=false;for(const c of sky.cohorts)if(!c.done){paint(bake,c,1);c.done=true;}draw(now,false);}
   if(still)return;
   // After the reveal only the shimmer moves, redrawn about twenty times a second.
   if(now-lastShimmer>=48){lastShimmer=now;draw(now,false);}
   frame=requestAnimationFrame(loop);
  }
  // Ends any reveal: what remains is baked in slices, then the whole sky is drawn at once.
  function complete(id){sky.reveal=false;run(settle(),id,()=>{draw(performance.now(),false);if(!still&&!paused&&!frame)frame=requestAnimationFrame(loop);});}
  return{
   // Shows the sky for a board; reveal plays it in from the dark, otherwise it is simply there. Until the new
   // sky is ready the canvas keeps what it last showed.
   show(o){
    const id=++job,W=o.width,H=o.height;let dpr=Math.min(3,o.dpr||1);if(W*H*dpr*dpr>9e6)dpr=Math.sqrt(9e6/(W*H));
    cancelAnimationFrame(frame);frame=0;still=!!o.still;shown=true;ready=false;
    run(build(o,W,H,dpr),id,made=>{
     sky={cohorts:made.cohorts,shimmer:made.shimmer,reveal:!!o.reveal&&!still&&!paused};info=made.info;
     baked.width=Math.round(W*dpr);baked.height=Math.round(H*dpr);bake.setTransform(1,0,0,1,0,0);
     const go=()=>{canvas.width=baked.width;canvas.height=baked.height;ready=true;};
     if(sky.reveal){go();start=performance.now();draw(start,true);frame=requestAnimationFrame(loop);}
     else run(settle(),id,()=>{go();draw(performance.now(),false);if(!still&&!paused)frame=requestAnimationFrame(loop);});
    });
   },
   hide(){job++;task=null;cancelAnimationFrame(frame);frame=0;sky=null;shown=false;ready=false;info=null;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);},
   // Reduced motion ends a reveal at once and stops the shimmer.
   still(value){still=!!value;if(!sky||!ready)return;cancelAnimationFrame(frame);frame=0;if(still)complete(job);else if(!paused)frame=requestAnimationFrame(loop);},
   // A hidden page stops every frame; coming back shows the finished sky.
   pause(value){paused=!!value;if(!sky||!ready)return;cancelAnimationFrame(frame);frame=0;if(paused)complete(job);else if(!still)frame=requestAnimationFrame(loop);},
   get shown(){return shown;},
   get info(){return info&&{...info,ready,revealing:ready&&!!sky&&sky.reveal,shimmering:!!frame&&!still&&!paused&&!!sky&&!sky.reveal,shimmers:sky?sky.shimmer.length:0};}
  };
 }
 return{create,load,magnitude,seedOf,projector,unprojector,galactic,milky};
});
