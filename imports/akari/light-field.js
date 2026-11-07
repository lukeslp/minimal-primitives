/* Occluded area lights and rule-controlled floor material. Luke Steuber. */
(function(){'use strict';
function create(root,p){
 const {w,h,cells}=p, W=Math.round(192*w/Math.max(w,h)),H=Math.round(192*h/Math.max(w,h));
 const walls=cells.flatMap((v,i)=>v!==-2?[{x:i%w,y:Math.floor(i/w)}]:[]),cache=new Map();
 const canvas=document.createElement('canvas');canvas.className='light-field';canvas.setAttribute('aria-hidden','true');root.prepend(canvas);
 const ctx=canvas.getContext('2d'),small=document.createElement('canvas');small.width=W;small.height=H;const sc=small.getContext('2d');
 let shown=new Map(),frame=0,last=null,disposed=false;
 // Closed slabs prevent a ray passing through touching wall corners.
 function blocked(sx,sy,x,y){for(const b of walls){let lo=0,hi=1;for(const [a,d,min,max]of[[sx,x-sx,b.x,b.x+1],[sy,y-sy,b.y,b.y+1]]){if(Math.abs(d)<1e-9){if(a<min||a>max){hi=-1;break;}}else{let t0=(min-a)/d,t1=(max-a)/d;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);}}if(hi>=lo-1e-10&&hi>1e-5&&lo<1-1e-5)return true;}return false;}
 function sees(a,b){if(a===b)return true;const ax=a%w,ay=Math.floor(a/w),bx=b%w,by=Math.floor(b/w);if(ax!==bx&&ay!==by)return false;const step=ax===bx?Math.sign(by-ay)*w:Math.sign(bx-ax);for(let i=a+step;i!==b;i+=step)if(cells[i]!==-2)return false;return true;}
 function field(i){if(cache.has(i))return cache.get(i);const out=new Float32Array(W*H),lx=i%w+.5,ly=Math.floor(i/w)+.5;
 for(let py=0;py<H;py++)for(let px=0;px<W;px++){const x=(px+.5)/W*w,y=(py+.5)/H*h;if(cells[Math.floor(y)*w+Math.floor(x)]!==-2)continue;let sum=0;for(const [ox,oy]of[[-.022,-.022],[.022,-.022],[-.022,.022],[.022,.022]]){const sx=lx+ox,sy=ly+oy;if(!blocked(sx,sy,x,y))sum+=.6/Math.pow((sx-x)**2+(sy-y)**2+.64,1.5);}out[py*W+px]=sum;}cache.set(i,out);return out;}
 function paint(){if(disposed)return;const img=sc.createImageData(W,H),active=[...shown].filter(([,v])=>v>.001),sources=active.map(([i,v])=>[field(i),v]);// Illumination is continuous in every visible direction. Rule coverage only changes the CSS surface texture.
 for(let i=0;i<W*H;i++){let e=0;for(const[f,v]of sources)e+=f[i]*v;const mapped=.585*(1-Math.exp(-e*.7));for(let c=0;c<3;c++){const light=mapped;img.data[i*4+c]=Math.round(255*Math.pow(Math.min(1,.0015+light),1/2.2));}img.data[i*4+3]=255;}
 sc.putImageData(img,0,0);const dpr=Math.min(devicePixelRatio||1,2),cw=Math.max(1,Math.round(root.clientWidth*dpr)),ch=Math.max(1,Math.round(root.clientHeight*dpr));if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}ctx.drawImage(small,0,0,cw,ch);
 }
 function update(state){const lamps=state.flatMap((v,i)=>v===1&&cells[i]===-2?[i]:[]),key=lamps.join(',');if(key===last)return;last=key;
 const nodes=root.querySelectorAll('.cell');for(let i=0;i<cells.length;i++){if(cells[i]===-2)continue;const x=i%w,y=Math.floor(i/w);for(const[edge,px,py]of[['top',x+.5,y-.002],['bottom',x+.5,y+1.002],['left',x-.002,y+.5],['right',x+1.002,y+.5]]){let power=0;for(const a of lamps){const sx=a%w+.5,sy=Math.floor(a/w)+.5;if(!blocked(sx,sy,px,py))power+=1/(1+(sx-px)**2+(sy-py)**2);}const t=Math.min(1,power*.75);nodes[i].style.setProperty('--rim-'+edge,`rgb(${Math.round(30+155*t)} ${Math.round(30+155*t)} ${Math.round(30+155*t)})`);}}
 cancelAnimationFrame(frame);const target=new Map(lamps.map(i=>[i,1])),before=new Map(shown),all=new Set([...before.keys(),...target.keys()]);for(const i of lamps)field(i);const start=performance.now(),duration=document.documentElement.dataset.motion==='reduce'||matchMedia('(prefers-reduced-motion:reduce)').matches?0:200;
 function step(now){const t=duration?Math.min(1,(now-start)/duration):1;shown=new Map([...all].map(i=>[i,(before.get(i)||0)*(1-t)+(target.get(i)||0)*t]));paint();if(t<1)frame=requestAnimationFrame(step);}if(duration)frame=requestAnimationFrame(step);else step(start);
 }
 const observer=new ResizeObserver(paint);observer.observe(root);
 return{update,blocked,sees,destroy(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();cache.clear();canvas.remove();}};
}
window.AkariLight={create};
})();
