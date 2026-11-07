/* Shared Minimal control presentation. Luke Steuber. */
(function () {
  'use strict';
  const config = {"id":"hex-sphere","root":"quiet-chrome","bar":".qc-bar","undo":"qc-undo","restart":"qc-reset","tools":["qc-flag"],"help":"qc-help","required":["qc-undo","qc-reset","qc-help"]};
  // Native payloads have their own release/acceptance contract.
  if (window.HEXSWEEPER_SPHERE_APP) return;
  const byId = id => id && document.getElementById(id);
  const cross = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const restart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  let observer;
  function apply() {
    if (document.body.dataset.controlFrame === config.id) return true;
    const existing = (config.required || []).map(byId);
    if (existing.some(n => !n)) return false;
    const root = config.root ? byId(config.root) : document.body;
    const bar = document.querySelector(config.bar);
    if (!root || !bar) return false;
    let reset = byId(config.restart);
    if (!reset && config.restartProxy && byId(config.restartProxy)) {
      reset = document.createElement('button');reset.type='button';reset.id='control-restart';
      reset.setAttribute('aria-label','Restart puzzle');reset.innerHTML=restart;
      reset.addEventListener('click',()=>byId(config.restartProxy)?.click());
    }
    if (reset) {
      reset.classList.add('control-icon','control-restart');
      // Preserve an existing header's input boundary and delegated handlers.
      if(!reset.isConnected || bar.contains(reset))root.prepend(reset);
    }
    const actions=document.createElement('div'),meta=document.createElement('div');
    actions.className='control-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Game actions');
    meta.className='control-meta';meta.setAttribute('role','group');meta.setAttribute('aria-label','Settings and help');
    const actionIds=[config.undo,config.hint,...(config.tools||[])].filter(Boolean);
    const metaIds=[config.settings,config.help].filter(Boolean);
    for(const id of actionIds){const n=byId(id);if(n){n.classList.add('control-icon');actions.append(n);}}
    for(const id of metaIds){const n=byId(id);if(n){n.classList.add('control-icon');meta.append(n);}}
    const kept = new Set([...actions.children,...meta.children]);
    // All toolbar functions are explicitly declared. An unknown control stays
    // in its own action slot rather than being lost during a presentation pass.
    for(const node of [...bar.querySelectorAll('button')]){
      if(node===reset||kept.has(node)||(config.completion||[]).includes(node.id))continue;
      node.classList.add('control-icon');actions.append(node);
    }
    const completionNodes=(config.completion||[]).map(id=>byId(id)).filter(Boolean);
    // Move the existing completion containers intact: their engines still own
    // visibility, state, focus and recovery. A standalone Next keeps its own hidden flag.
    for(const node of completionNodes){
      if(node===bar||node.contains(bar))continue;
      node.classList.add('control-completion');root.append(node);
      for(const button of node.matches('button')?[node]:node.querySelectorAll('button')){
        if(!button.querySelector('svg')&&button.id==='share-btn'){
          if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',button.textContent.trim());
          button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 11v10h14V11" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
        }
        button.classList.add('control-icon');
      }
    }
    for(const n of [...bar.children])if(!n.matches('button')&&!n.contains(reset)&&!n.querySelector('button'))n.remove();
    bar.classList.add('control-toolbar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Game controls');
    bar.append(actions,meta);
    for(const n of document.querySelectorAll('dialog,[role="dialog"],.modal-overlay')){
      n.classList.add('control-sheet');
      for(const close of n.querySelectorAll('button[aria-label^="Close"],button[aria-label^="close"]')){
        close.classList.add('control-close');close.innerHTML=cross;
      }
    }
    document.body.dataset.controlFrame=config.id;
    observer?.disconnect();
    window.addEventListener('pagehide',()=>observer?.disconnect(),{once:true});
    return true;
  }
  if(!apply()){
    observer=new MutationObserver(()=>{if(apply())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    // A failed game boot must not leave a whole-playfield observer behind.
    setTimeout(()=>observer?.disconnect(),30000);
  }
})();
