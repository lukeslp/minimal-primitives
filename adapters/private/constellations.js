const __minimal=MinimalBridge.install({
  rulesVersion:'__RULES__',scoringPolicy:'__POLICY__',
  describe(){const r=E.inspect(p,s.weights);return{id:p.id,mode:'campaign',layout:{stars:p.stars,routes:p.routes},solved:r.solved,repeat:store.completed.includes(p.id),restored:s.weights.some(Boolean)||s.undo.length>0,value:0,progress:{completed:store.completed.length}};},
  snapshot(){const st=clone(store);st.current=p.id;st.records[p.id]={weights:s.weights.slice(),locks:s.locks.slice(),undo:clone(s.undo)};return{store:st,selected:s.selected,focus:s.focus,hint:s.hint,text:$('status').textContent,ui:MinimalBridge.ui()};},
  restore(d){
    const st=d&&d.store;
    if(!st||st.version!==1||!B.some(b=>b.id===st.current)||!st.records||typeof st.records!=='object'||Array.isArray(st.records)||!Array.isArray(st.completed)||!st.completed.every(id=>B.some(b=>b.id===id))||!st.settings||!['system','still'].includes(st.settings.motion)||Object.entries(st.records).some(([id,r])=>!B.some(b=>b.id===id&&recordValid(b,r))))throw Error('Invalid saved constellations.');
    cancel();clearTimeout(refusalTimer);refused.clear();store=clone(st);p=null;load(store.current);
    s.selected=Number.isInteger(d.selected)&&d.selected<p.stars.length?d.selected:null;s.focus=Number.isInteger(d.focus)&&d.focus<p.stars.length?d.focus:0;s.hint=d.hint??null;
    render();if(finishTimer!==null)finish();say(d.text||'');save();MinimalBridge.restoreUI(d.ui);
  },
  settle(){cancel();if(finishTimer!==null)finish();if(refused.size){clearTimeout(refusalTimer);refused.clear();render();}},
  undoDepth:()=>s.undo.length,
  proof(){return{weights:s.weights.slice()};}
});
const __minimalSave=save;save=function(){const value=__minimalSave.apply(this,arguments);__minimal.changed();return value;};
