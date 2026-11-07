/* Shared pointer painting for the puzzle and practice rows. No storage or solution access. */
(function () {
  'use strict';
  const toggle = (v, mark) => v === (mark ? 2 : 1) ? 0 : (mark ? 2 : 1);
  function bind(o) {
    const {root, state: s} = o;
    const point = e => {
      const b = o.rect(), {w,h} = o.size();
      return {x: Math.max(0, Math.min(w - 1e-6, (e.clientX-b.left)/b.width*w)),
        y: Math.max(0, Math.min(h - 1e-6, (e.clientY-b.top)/b.height*h))};
    };
    const index = p => Math.floor(p.y)*o.size().w+Math.floor(p.x);
    function paint(i) {
      if (o.locked?.(i)) return;
      s.drag.painted.add(i); s.cells[i]=s.drag.to; o.render(i);
    }
    function move(e) {
      const d=s.drag, a=d.point, b=point(e), ts=[0,1];
      for (const axis of ['x','y']) {
        const delta=b[axis]-a[axis]; if (!delta) continue;
        for(let n=Math.floor(Math.min(a[axis],b[axis]))+1;n<Math.max(a[axis],b[axis]);n++)
          ts.push((n-a[axis])/delta);
      }
      ts.sort((a,b)=>a-b);
      const visit=t=>{
        const i=index({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        if(i!==d.start)d.moved=true;
        paint(i); return i;
      };
      for(let n=1;n<ts.length;n++)if(ts[n]-ts[n-1]>1e-10)visit((ts[n]+ts[n-1])/2);
      o.focus?.(visit(1)); d.point=b; o.preview?.([...d.painted]);
      if(d.moved)clearHold();
    }
    function clearHold() {
      if(s.pending)clearTimeout(s.pending.timer);
      s.pending=null;
    }
    // A mouse can lose capture a moment before its pointerup: when a move with no
    // button held lands first, the browser lets go early. That is a release, not a cancel.
    const released = e => e.type==='pointerup' || e.type==='lostpointercapture';
    function end(e) {
      if(!s.drag || (e.pointerId!=null && e.pointerId!==s.drag.id))return;
      clearHold();
      if(e.type==='pointerup')move(e);
      const d=s.drag; s.drag=null;
      if(!released(e)) {
        s.cells=d.before; if(d.double)s.undo.push(d.snap);
        s.lastTap=null; o.restore(); return;
      }
      s.undo.push(d.snap); if(s.undo.length>400)s.undo.shift();
      if(d.tap&&!d.moved)s.lastTap={i:d.start,time:performance.now(),snap:d.snap};
      o.commit([...d.painted]);
    }
    function cancel(){end({type:'pointercancel'});}
    root.addEventListener('pointerdown',e=>{
      if(s.drag){ if(e.pointerId!==s.drag.id)cancel(); return; }
      if(!e.isPrimary || ![0,2].includes(e.button) || !o.accept(e))return;
      const pt=point(e),i=index(pt);
      if(o.locked?.(i))return;
      e.preventDefault();
      const last=s.lastTap;
      const double=e.button===0&&last&&last.i===i&&performance.now()-last.time<=300&&s.undo.at(-1)===last.snap;
      s.lastTap=null;
      const before=Int8Array.from(s.cells),snap=double?s.undo.pop():Int8Array.from(s.cells);
      const to=double?toggle(snap[i],true):toggle(snap[i],e.button===2?!s.mark:s.mark);
      s.drag={id:e.pointerId,start:i,to,snap,before,double,painted:new Set(),point:pt,tap:e.button===0&&!double,moved:false};
      o.start?.(); o.focus?.(i);
      try{root.setPointerCapture(e.pointerId);}catch(_){}
      paint(i);
      if(e.pointerType==='touch'&&s.drag.tap) {
        const pending={id:e.pointerId,timer:0};
        pending.timer=setTimeout(()=>{
          if(s.pending!==pending||!s.drag)return;
          s.pending=null; s.drag.to=toggle(s.drag.snap[i],!s.mark); s.drag.tap=false;
          paint(i); o.preview?.([i]);
        },380);
        s.pending=pending;
      }
    });
    root.addEventListener('pointermove',e=>{
      if(s.drag?.id!==e.pointerId)return;
      const samples=e.getCoalescedEvents?.();
      for(const sample of samples?.length?samples:[e])move(sample);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,end);
    // Capture can be unavailable, and backgrounding can interrupt any gesture.
    for(const type of ['pointerup','pointercancel'])document.addEventListener(type,end);
    window.addEventListener('blur',cancel);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
    return {cancel};
  }
  window.NotanPaint={bind,toggle};
})();
