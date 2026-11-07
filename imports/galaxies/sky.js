/* The sky a finished shape uncovers: one dark-site view per board, chosen from the board's id. Luke Steuber. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.GalaxySky=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const TAU=Math.PI*2,KINDS=['band','spiral','nebula','edge','globular','pair','remnant','ring','starburst','barred','planetary','cluster'];
// Star colours by temperature, hot to cool (blue O and B stars to orange M stars), and roughly how often the eye meets each.
const STAR=['#8fa8ff','#aec2ff','#dce5ff','#fff8f2','#ffe7c2','#ffc988','#ff9f6e'],SHARE=[.12,.17,.2,.16,.15,.12,.08];
// Glowing gas by emission line: hydrogen-alpha red, warm dust, doubly ionised oxygen teal; starlight on dust is blue.
const HA='#ff3f6c',WARM='#ff8a4a',OIII='#3fe0c5',BLUE='#5b8cff',VIOLET='#9a6bff',CREAM='#ffe2b8',MILK='#dfe4ff';
function hash(text){let h=2166136261;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// Campaign boards take the kinds in turn so neighbours differ; any other board picks from its id.
function kind(p){const m=/^g(\d+)$/.exec(p.id||'');return KINDS[(m?+m[1]-1:hash((p.id||'')+p.w+'x'+p.h))%KINDS.length];}
const cache=new Map();
function model(p){
  const key=(p.id||'')+':'+p.w+'x'+p.h+':'+p.centres.length;if(cache.has(key))return cache.get(key);
  const r=rng(hash(key)),cx=p.w/2,cy=p.h/2,small=Math.min(p.w,p.h),reach=Math.hypot(p.w,p.h)/2+.4,area=p.w*p.h,k=kind(p),u=Math.max(p.w,p.h)/8;
  const gauss=()=>(r()+r()+r()+r()-2)*.87,tint=()=>{let v=r(),i=0;while(i<6&&(v-=SHARE[i])>0)i++;return i;},pick=(from,span)=>from+Math.floor(r()*span);
  const stars=[],haze=[],dust=[],add=(x,y,m,c)=>stars.push({x,y,m,c}),glow=(x,y,rx,ry,rot,c,a)=>haze.push({x,y,rx,ry,rot,c,a:Math.min(.85,a*1.35)}),dark=(x,y,rx,ry,rot,a)=>dust.push({x,y,rx,ry,rot,a});
  // The field every board shares: what a dark site shows with nothing else in view. Most stars are faint and a few are brilliant.
  const field=Math.min(3000,220+Math.round(area*42));
  for(let i=0;i<field;i++){const d=reach*Math.sqrt(r()),a=r()*TAU;add(cx+Math.cos(a)*d,cy+Math.sin(a)*d,Math.pow(r(),3.4),tint());}
  // Far gas tints the dark here and there: a wash or two, different on every board.
  for(let i=0,m=pick(1,2);i<m;i++){const a=r()*TAU,d=reach*(.3+r()*.6);glow(cx+Math.cos(a)*d,cy+Math.sin(a)*d,reach*(.5+r()*.4),reach*(.3+r()*.3),r()*180,[BLUE,VIOLET,OIII,HA][pick(0,4)],.045+r()*.035);}
  // The object sits off-centre, turned and tipped, so no two boards frame the same view.
  const ox=cx+(r()-.5)*small*.3,oy=cy+(r()-.5)*small*.3,turn=r()*TAU,ca=Math.cos(turn),sa=Math.sin(turn),squash=.45+r()*.55,deg=turn*180/Math.PI;
  const put=(x,y)=>[ox+x*ca-y*squash*sa,oy+x*sa+y*squash*ca];
  if(k==='band'){
    // The Milky Way: a bright river through the centre, a warm bulge, a dark rift, and knots of glowing gas.
    const L=reach*1.05,wd=small*.2,line=(t,off)=>[cx+ca*t*L-sa*off,cy+sa*t*L+ca*off],bulge=(r()-.5)*.7;
    for(let i=0;i<7;i++)glow(...line(-1+i/3,gauss()*wd*.3),L*.42,wd*(.9+r()*.6),deg,MILK,.11);
    glow(...line(bulge,0),wd*2.4,wd*1.4,deg,CREAM,.3);
    for(let i=0;i<5;i++){const size=wd*(.3+r()*.3);glow(...line((r()-.5)*1.6,gauss()*wd*.5),size,size,0,i===4?OIII:HA,.2);}
    for(let i=0;i<5;i++)dark(...line(-.9+i*.45+gauss()*.08,(r()-.5)*wd*.5),L*.24,wd*(.12+r()*.1),deg+gauss()*8,.6);
    for(let i=0,n=Math.round(field*.9);i<n;i++){const t=r()*2-1;add(...line(t,gauss()*wd*.75),Math.pow(r(),3),Math.abs(t-bulge)<.25?pick(3,3):tint());}
  }else if(k==='spiral'||k==='barred'){
    // A spiral galaxy: old warm stars in the core, young blue ones along the arms, pink where new stars are forming.
    const s=small*(.45+r()*.2),barred=k==='barred',arms=barred?2:pick(2,4),wind=(barred?2.2:2.6+r()*1.2)*Math.PI/s,n=Math.min(1500,200+Math.round(area*18)),temper=pick(0,3),knots=[.02,.006,.045][temper];
    glow(ox,oy,s*.42,s*.42*squash,deg,CREAM,.5);glow(ox,oy,s*1.05,s*1.05*squash,deg,temper===1?WARM:BLUE,temper===2?.2:.1);
    for(let i=0;i<n;i++){
      const t=(i+.5)/n,bar=barred&&t<.14,d=bar?s*.34*r():.03*s+s*Math.pow(t,.62),a=bar?(i%2)*Math.PI+gauss()*.12:d*wind+(i%arms)*TAU/arms+gauss()*(.12+.35*t),[x,y]=put(Math.cos(a)*d,Math.sin(a)*d),knot=!bar&&t>.2&&r()<knots;
      if(knot){const size=s*(.03+r()*.05);glow(x,y,size,size,0,temper===2&&r()<.25?OIII:HA,.26);}
      add(x,y,knot?.75+r()*.25:Math.pow(r(),2.6),t<.16?pick(3,3):knot?1:temper===1?pick(3,3):pick(0,3));
    }
  }else if(k==='edge'){
    // An edge-on spiral: a thin bright disc, a warm bulge, and the dust lane that splits it.
    const s=small*(.5+r()*.2),thick=s*.07,n=Math.min(1300,180+Math.round(area*16)),along=(t,off)=>[ox+ca*t*s-sa*off,oy+sa*t*s+ca*off];
    glow(ox,oy,s*1.05,thick*2.6,deg,MILK,.34);glow(ox,oy,s*.3,s*.2,deg,CREAM,.6);glow(ox,oy,s*1.2,s*.4,deg,BLUE,.07);dark(ox,oy,s*.95,thick*.5,deg,.75);
    for(let i=0;i<n;i++){const t=gauss()*.55,bulge=Math.abs(t)<.18;add(...along(t,gauss()*thick*(bulge?2.4:1)),Math.pow(r(),2.6),bulge?pick(3,3):r()<.06?1:pick(0,4));}
    for(let i=0;i<5;i++){const size=s*(.03+r()*.03);glow(...along((r()-.5)*1.6,gauss()*thick*.6),size,size,0,HA,.28);}
  }else if(k==='pair'){
    // Two galaxies passing: a spiral, a small companion, and the bridge of young stars pulled between them.
    const s=small*(.34+r()*.1),bx=s*1.25,by=s*(.35+r()*.3),n=Math.min(1300,180+Math.round(area*15)),wind=2.6*Math.PI/s,[px,py]=put(bx,by);
    glow(ox,oy,s*.4,s*.4*squash,deg,CREAM,.5);glow(ox,oy,s,s*squash,deg,BLUE,.14);glow(px,py,s*.22,s*.2,0,'#ffd9a8',.55);glow(px,py,s*.5,s*.42,0,WARM,.1);
    for(let i=0;i<n;i++){const t=(i+.5)/n,d=.03*s+s*Math.pow(t,.62),a=d*wind+(i%2)*Math.PI+gauss()*(.12+.35*t);add(...put(Math.cos(a)*d,Math.sin(a)*d),Math.pow(r(),2.6),t<.16?pick(3,3):pick(0,3));}
    for(let i=0,m=Math.round(n*.3);i<m;i++){const d=s*.3*Math.pow(r(),1.6),a=r()*TAU;add(px+Math.cos(a)*d,py+Math.sin(a)*d,Math.pow(r(),2.2),pick(3,4));}
    for(let i=0,m=Math.round(n*.2);i<m;i++){const t=r(),u1=1-t,x=u1*u1*s*.9+2*u1*t*s*1.4+t*t*bx,y=u1*u1*-s*.25+2*u1*t*-s*.15+t*t*by,knot=r()<.05,[qx,qy]=put(x+gauss()*s*.05,y+gauss()*s*.05);if(knot)glow(qx,qy,s*.05,s*.05,0,HA,.3);add(qx,qy,knot?.8:Math.pow(r(),2.4),pick(0,3));}
  }else if(k==='remnant'){
    // A supernova remnant: a broken shell of filaments, oxygen teal on one side and hydrogen red on the other.
    const s=small*(.3+r()*.12),side=r()*TAU;
    for(let i=0;i<8;i++){const a=i/8*TAU+gauss()*.2,teal=Math.cos(a-side)>0;glow(...put(Math.cos(a)*s,Math.sin(a)*s),s*.45,s*.3,0,teal?OIII:HA,.1);}
    for(let i=0;i<64;i++){const a=r()*TAU,d=s*(1+gauss()*.09)*(i%4?1:.72),teal=Math.cos(a-side)>gauss()*.5;glow(...put(Math.cos(a)*d,Math.sin(a)*d),s*(.12+r()*.24),s*(.01+r()*.018),deg+a*180/Math.PI+90+gauss()*16,teal?OIII:r()<.2?WARM:HA,.24+r()*.12);}
    glow(ox,oy,s*1.1,s*1.1*squash,deg,VIOLET,.07);
    for(let i=0;i<140;i++){const a=r()*TAU,d=s*(1+gauss()*.1);add(...put(Math.cos(a)*d,Math.sin(a)*d),Math.pow(r(),2.6),pick(0,4));}
  }else if(k==='starburst'){
    // An irregular starburst galaxy: no arms, only clumps of new blue stars and the gas they light up.
    const s=small*(.32+r()*.12),n=Math.min(1100,160+Math.round(area*13)),clumps=[];
    glow(ox,oy,s*.9,s*.55,deg,BLUE,.2);glow(ox,oy,s*.45,s*.3,deg,MILK,.3);
    for(let i=0,m=pick(6,5);i<m;i++){const x=gauss()*s*.5,y=gauss()*s*.3,size=s*(.08+r()*.1);clumps.push([x,y]);glow(...put(x,y),size,size,0,i%3?HA:OIII,.4);}
    for(let i=0;i<n;i++){const c=clumps[i%clumps.length],near=r()<.6;add(...put(near?c[0]+gauss()*s*.09:gauss()*s*.55,near?c[1]+gauss()*s*.09:gauss()*s*.32),Math.pow(r(),near?2:2.8),near?pick(0,2):pick(0,5));}
  }else if(k==='ring'){
    // A ring galaxy: a yellow core inside a detached ring of young blue stars.
    const s=small*(.3+r()*.1),n=Math.min(900,140+Math.round(area*10));
    glow(ox,oy,s*.42,s*.42*squash,deg,CREAM,.5);
    for(let i=0;i<14;i++){const a=i/14*TAU+r()*.2,pink=i%5===2;glow(...put(Math.cos(a)*s,Math.sin(a)*s),s*.34,s*.34,0,pink?HA:BLUE,pink?.2:.16);}
    for(let i=0;i<n;i++){const core=i%4===0,d=core?s*.2*Math.sqrt(r()):s*(1+gauss()*.11),a=r()*TAU;add(...put(Math.cos(a)*d,Math.sin(a)*d),Math.pow(r(),core?1.8:2.4),core?pick(4,2):pick(0,3));}
  }else if(k==='nebula'){
    // An emission nebula: hydrogen glowing red, oxygen teal at the hot centre, dust lanes across it, a young cluster inside.
    const s=small*(.4+r()*.15);
    glow(...put(-.3*s,-.1*s),s*.75,s*.6,deg+20,HA,.3);glow(...put(.3*s,.2*s),s*.7,s*.5,deg-25,HA,.24);glow(...put(.05*s,-.35*s),s*.5,s*.4,deg,WARM,.16);
    glow(...put(0,0),s*.38,s*.3,deg,OIII,.3);glow(...put(.5*s,-.4*s),s*.4,s*.32,deg+40,BLUE,.22);
    dark(...put(-.05*s,.28*s),s*.7,s*.09,deg+12,.7);dark(...put(.3*s,-.1*s),s*.3,s*.07,deg-50,.6);
    for(let i=0,n=pick(10,10);i<n;i++)add(...put(gauss()*s*.22,gauss()*s*.22),.7+r()*.3,pick(0,2));
    for(let i=0;i<220;i++)add(...put(gauss()*s*.6,gauss()*s*.6),Math.pow(r(),2.4),pick(0,4));
  }else if(k==='globular'){
    // A globular cluster: a dense ball of old warm stars with a few blue stragglers.
    const s=small*(.3+r()*.12),n=Math.min(1500,220+Math.round(area*18));
    glow(ox,oy,s*.5,s*.5,0,CREAM,.5);glow(ox,oy,s*1.1,s*1.1,0,'#ffd9a8',.12);
    for(let i=0;i<n;i++){const d=s*1.2*Math.pow(r(),2.2),a=r()*TAU;add(ox+Math.cos(a)*d,oy+Math.sin(a)*d,Math.pow(r(),2.2),r()<.08?pick(0,2):pick(3,4));}
  }else if(k==='planetary'){
    // A planetary nebula: a small teal shell of oxygen inside a red hydrogen halo, with the dying star at its centre.
    const s=small*(.13+r()*.05);
    glow(ox,oy,s*2.3,s*2.3*squash,deg,HA,.22);glow(ox,oy,s*1.25,s*1.25*squash,deg,OIII,.5);dark(ox,oy,s*.55,s*.55*squash,deg,.55);add(ox,oy,1,0);
    for(let i=0;i<90;i++){const a=r()*TAU,d=s*(1+gauss()*.12);add(...put(Math.cos(a)*d,Math.sin(a)*d),Math.pow(r(),2),r()<.5?2:1);}
  }else{
    // An open cluster: a handful of hot blue stars lighting the dust they are drifting through.
    const s=small*(.2+r()*.08),streak=deg+30;
    for(let i=0,n=pick(7,5);i<n;i++){const x=ox+gauss()*s*.6,y=oy+gauss()*s*.6;add(x,y,.86+r()*.14,pick(0,2));glow(x,y,s*(.5+r()*.4),s*(.16+r()*.1),streak+gauss()*10,BLUE,.2);}
    glow(ox,oy,s*1.6,s*1.2,streak,BLUE,.1);
    for(let i=0;i<70;i++)add(ox+gauss()*s*.9,oy+gauss()*s*.9,Math.pow(r(),2.2),pick(0,3));
  }
  // The brightest stars are drawn one by one so each can twinkle; the rest are gathered by colour and size.
  const sortOut=(list,most,share,rnd)=>{
    list.sort((a,b)=>b.m-a.m);
    const count=Math.min(most,Math.round(12+list.length*share)),bright=list.slice(0,count).map((d,i)=>{const size=(i<10?.036:i<34?.026:.019)*u*(.8+.4*d.m);return{x:d.x,y:d.y,c:d.c,size,halo:size*(i<10?7:i<34?4:2.6),spike:i<10?size*(8+rnd()*6):0,tw:1.1+rnd()*2.6,delay:rnd()*4};}),groups=new Map();
    for(const d of list.slice(count)){const size=d.m<.12?0:d.m<.4?1:2,id=d.c*3+size;if(!groups.has(id))groups.set(id,{c:d.c,width:[.016,.024,.034][size]*u,opacity:[.58,.8,.95][size],tw:3+rnd()*4,delay:rnd()*5,pts:[]});groups.get(id).pts.push(d.x,d.y);}
    return{faint:[...groups.values()],bright};
  };
  const near=sortOut(stars,90,.022,r);
  // Beyond the board the same sky goes on. It is only shown when a finished board is handed over, so it has its own dice.
  const o=rng(hash(key+':far')),far=reach*2.6,beyond=[],farHaze=[];
  for(let i=0,m=Math.min(9000,Math.round(field*4.4));i<m;i++){const d=Math.sqrt(reach*reach+(far*far-reach*reach)*o()),a=o()*TAU;let v=o(),c=0;while(c<6&&(v-=SHARE[c])>0)c++;beyond.push({x:cx+Math.cos(a)*d,y:cy+Math.sin(a)*d,m:Math.pow(o(),3.4),c});}
  for(let i=0;i<4;i++){const a=o()*TAU,d=reach*(1.2+o()*1.1);farHaze.push({x:cx+Math.cos(a)*d,y:cy+Math.sin(a)*d,rx:reach*(.6+o()*.6),ry:reach*(.35+o()*.4),rot:o()*180,c:[BLUE,VIOLET,OIII,HA][Math.floor(o()*4)],a:.07+o()*.06});}
  const out={kind:k,seed:hash(key),cx,cy,reach,far,haze,dust,faint:near.faint,bright:near.bright,outer:{haze:farHaze,...sortOut(beyond,40,.006,o)}};
  if(cache.size>5)cache.delete(cache.keys().next().value);
  cache.set(key,out);return out;
}
const n=v=>+v.toFixed(3),STOPS=[[0,1],[.45,.42],[1,0]],SHADE=[[0,1],[.6,.7],[1,0]];
// SVG for the live board, in cell units. The caller clips it to the uncovered cells and turns it slowly.
function svg(id,m,options={}){
  const hazes=options.outer?[...m.haze,...m.outer.haze]:m.haze,tints=[...new Set(hazes.map(h=>h.c))],gradient=(name,c,stops)=>'<radialGradient id="'+name+'">'+stops.map(([o,a])=>'<stop offset="'+o+'" stop-color="'+c+'" stop-opacity="'+a+'"/>').join('')+'</radialGradient>';
  const blob=(h,fill)=>'<ellipse cx="'+n(h.x)+'" cy="'+n(h.y)+'" rx="'+n(h.rx)+'" ry="'+n(h.ry)+'" fill="url(#'+fill+')" opacity="'+h.a+'"'+(h.rot?' transform="rotate('+n(h.rot)+' '+n(h.x)+' '+n(h.y)+')"':'')+'/>';
  const defs=tints.map((c,i)=>gradient(id+'-h'+i,c,STOPS)).join('')+gradient(id+'-d','#000',SHADE)+STAR.map((c,i)=>'<radialGradient id="'+id+'-s'+i+'"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".2" stop-color="'+c+'" stop-opacity=".5"/><stop offset="1" stop-color="'+c+'" stop-opacity="0"/></radialGradient>').join('');
  const dots=b=>{let d='';for(let i=0;i<b.pts.length;i+=2)d+='M'+n(b.pts[i])+' '+n(b.pts[i+1])+'h0';return d;};
  const field=b=>'<path class="field twinkle" d="'+dots(b)+'" stroke="'+STAR[b.c]+'" stroke-width="'+n(b.width)+'" stroke-linecap="round" fill="none" opacity="'+b.opacity+'" style="--tw:'+b.tw.toFixed(2)+'s;--lo:'+(b.opacity*.55).toFixed(2)+';animation-delay:-'+b.delay.toFixed(2)+'s"/>';
  const star=d=>'<g class="twinkle" style="--tw:'+d.tw.toFixed(2)+'s;--lo:.3;animation-delay:-'+d.delay.toFixed(2)+'s"><circle cx="'+n(d.x)+'" cy="'+n(d.y)+'" r="'+n(d.halo)+'" fill="url(#'+id+'-s'+d.c+')" opacity=".7"/>'+(d.spike?'<path d="M'+n(d.x-d.spike)+' '+n(d.y)+'h'+n(d.spike*2)+'M'+n(d.x)+' '+n(d.y-d.spike)+'v'+n(d.spike*2)+'" stroke="'+STAR[d.c]+'" stroke-width="'+n(d.size*.3)+'" stroke-linecap="round" fill="none" opacity=".6"/>':'')+'<circle cx="'+n(d.x)+'" cy="'+n(d.y)+'" r="'+n(d.size)+'" fill="#fff"/></g>';
  const picture=(href,radius)=>'<image class="cloud" href="'+href+'" x="'+n(m.cx-radius)+'" y="'+n(m.cy-radius)+'" width="'+n(radius*2)+'" height="'+n(radius*2)+'" preserveAspectRatio="none"/>';
  const glows=options.bare?'':options.cloud?picture(options.cloud,m.reach):'<g class="haze">'+hazes.map(h=>blob(h,id+'-h'+tints.indexOf(h.c))).join('')+m.dust.map(h=>blob(h,id+'-d')).join('')+'</g>';
  const body=glows+m.faint.map(field).join('')+(options.outer?m.outer.faint.map(field).join(''):'')+m.bright.map(star).join('')+(options.outer?m.outer.bright.map(star).join(''):'');
  return{defs,body};
}
// Smooth value noise summed over octaves: 0 to 1, the same for the same seed. It is laid out in board
// squares from (left,top), not in pixels, so a close painting and a wide one agree where they meet.
function noise(size,seed,per,octaves,left,top,unit){
  const out=new Float32Array(size*size),at=(x,y,k)=>{let v=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(k,1274126177)|0;v=Math.imul(v^v>>>13,1103515245);return((v^v>>>16)>>>0)/4294967296;};
  let amp=1,total=0;
  for(let k=0;k<octaves;k++){const f=per*(1<<k);for(let y=0;y<size;y++){const fy=(top+y/unit)*f+4096,y0=Math.floor(fy),ty=fy-y0,sy=ty*ty*(3-2*ty);let x0=NaN,a=0,b=0,c=0,d=0;for(let x=0;x<size;x++){const fx=(left+x/unit)*f+4096,xi=Math.floor(fx),tx=fx-xi,sx=tx*tx*(3-2*tx);if(xi!==x0){x0=xi;a=at(xi,y0,seed+k);b=at(xi+1,y0,seed+k);c=at(xi,y0+1,seed+k);d=at(xi+1,y0+1,seed+k);}out[y*size+x]+=amp*(a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy);}}total+=amp;amp*=.5;}
  for(let i=0;i<out.length;i++)out[i]/=total;return out;
}
// The gas and dust as one painted square out to the given radius. Soft glows alone look like fog;
// fractal noise breaks them into cloud, pulls filaments through them and cuts ragged dust lanes.
function cloud(m,size=640,radius=m.far){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d',{willReadFrequently:true}),unit=size/(radius*2),left=m.cx-radius,top=m.cy-radius,rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)).join(',');
  const blob=(h,c,stops,gain)=>{ctx.save();ctx.translate((h.x-left)*unit,(h.y-top)*unit);ctx.rotate((h.rot||0)*Math.PI/180);ctx.scale(1,h.ry/h.rx);const g=ctx.createRadialGradient(0,0,0,0,0,h.rx*unit);for(const[o,a]of stops)g.addColorStop(o,'rgba('+c+','+Math.min(1,a*h.a*gain)+')');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,h.rx*unit,0,TAU);ctx.fill();ctx.restore();};
  ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);ctx.globalCompositeOperation='lighter';
  for(const h of[...m.haze,...m.outer.haze])blob(h,rgb(h.c),STOPS,1.25);
  const glow=ctx.getImageData(0,0,size,size),px=glow.data;
  ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);for(const h of m.dust)blob(h,'255,255,255',SHADE,1);
  const grain=3.2/m.reach,lanes=ctx.getImageData(0,0,size,size).data,billow=noise(size,m.seed,grain,5,left,top,unit),wisp=noise(size,m.seed+97,grain*2.3,4,left,top,unit),rift=noise(size,m.seed+211,grain*1.5,4,left,top,unit);
  for(let i=0,j=0;i<billow.length;i++,j+=4){
    const ridge=1-Math.abs(wisp[i]*2-1),form=.2+1.7*Math.pow(billow[i],1.6)+.22*Math.pow(ridge,5)*(.4+billow[i]),drift=Math.max(0,rift[i]-.52)*1.1,shade=Math.max(0,1-lanes[j]/255*(.55+.9*rift[i])-drift);
    px[j]=Math.min(255,px[j]*form*shade);px[j+1]=Math.min(255,px[j+1]*form*shade);px[j+2]=Math.min(255,px[j+2]*form*shade);px[j+3]=255;
  }
  ctx.putImageData(glow,0,0);return canvas;
}
// The same sky on a canvas, still, for the shared picture. unit is pixels per cell.
function paint(ctx,m,unit,options={}){
  const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)).join(',');
  const blob=(h,c,stops)=>{ctx.save();ctx.translate(h.x*unit,h.y*unit);ctx.rotate((h.rot||0)*Math.PI/180);ctx.scale(1,h.ry/h.rx);const g=ctx.createRadialGradient(0,0,0,0,0,h.rx*unit);for(const[o,a]of stops)g.addColorStop(o,'rgba('+c+','+a*h.a+')');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,h.rx*unit,0,TAU);ctx.fill();ctx.restore();};
  if(options.cloud)ctx.drawImage(options.cloud,(m.cx-m.reach)*unit,(m.cy-m.reach)*unit,m.reach*2*unit,m.reach*2*unit);else{m.haze.forEach(h=>blob(h,rgb(h.c),STOPS));m.dust.forEach(h=>blob(h,'0,0,0',SHADE));}
  for(const b of m.faint){ctx.globalAlpha=b.opacity;ctx.fillStyle=STAR[b.c];const radius=Math.max(.5,b.width*unit/2);for(let i=0;i<b.pts.length;i+=2){ctx.beginPath();ctx.arc(b.pts[i]*unit,b.pts[i+1]*unit,radius,0,TAU);ctx.fill();}}
  for(const d of m.bright){
    const x=d.x*unit,y=d.y*unit,c=rgb(STAR[d.c]),g=ctx.createRadialGradient(x,y,0,x,y,d.halo*unit);g.addColorStop(0,'rgba(255,255,255,.95)');g.addColorStop(.2,'rgba('+c+',.5)');g.addColorStop(1,'rgba('+c+',0)');
    ctx.globalAlpha=.7;ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,d.halo*unit,0,TAU);ctx.fill();
    if(d.spike){const reach=d.spike*unit;ctx.globalAlpha=.6;ctx.strokeStyle=STAR[d.c];ctx.lineWidth=Math.max(1,d.size*.3*unit);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-reach,y);ctx.lineTo(x+reach,y);ctx.moveTo(x,y-reach);ctx.lineTo(x,y+reach);ctx.stroke();}
    ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,d.size*unit,0,TAU);ctx.fill();
  }
  ctx.globalAlpha=1;
}
return{KINDS,STAR,kind,model,svg,cloud,paint};
});
