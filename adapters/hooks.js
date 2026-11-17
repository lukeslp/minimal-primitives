(() => {
  'use strict';
  const bridge = window.MinimalBridge;
  if (!bridge) return;
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.nonce !== bridge.nonce || event.data?.v !== 1) return;
    const { type, request, payload } = event.data;
    try {
      if (type === 'snapshot') {
        if (!window.MinimalAdapter) throw new Error('This game’s resume adapter is not ready.');
        const state = await window.MinimalAdapter.snapshot();
        bridge.emit('snapshot', { request, source: bridge.config.source, state });
      } else if (type === 'restore') {
        if (!window.MinimalAdapter) throw new Error('This game’s resume adapter is not ready.');
        // A save from an earlier source commit is tried too. An adapter's restore throws on a state it cannot
        // read (how strictly varies by game), and the library then keeps that save aside and starts the game new.
        await window.MinimalAdapter.restore(payload.state);
        bridge.emit('restored', { request });
      }
    } catch (error) { bridge.emit('error', { request, message: error.message }); }
  });
  function collectionControls() {
    const restart = document.querySelector('#qc-reset') || document.querySelector('#restart-btn, #restart, #reset-btn, #control-restart') || document.querySelector('#undo-btn') || document.querySelector('#new-btn');
    if (!restart) throw new Error('Collection Home anchor is missing.');
    document.querySelectorAll('.web-games-back[data-minimal-library], .app-back[data-minimal-library]').forEach(node=>node.remove());
    const home = document.createElement('button');
    home.id = 'minimal-home'; home.dataset.minimalCollection = 'home'; home.type = 'button'; home.className = restart.className; home.classList.remove('control-restart','qc-reset');
    home.setAttribute('aria-label', 'Home'); home.title = 'Home';
    home.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/></svg>';
    home.addEventListener('click', () => bridge.emit('library'));
    const fixed = getComputedStyle(restart).position === 'fixed';
    if (fixed) {
      restart.after(home);
      const position = () => {
        const rect = restart.getBoundingClientRect();
        Object.assign(home.style, {position:'fixed', left:rect.right+'px', top:rect.top+'px', width:rect.width+'px', height:rect.height+'px', zIndex:'60', color:getComputedStyle(restart).color});
      };
      position(); window.addEventListener('resize', position);
      const themeObserver = new MutationObserver(position);
      for(const node of [document.documentElement,document.body])themeObserver.observe(node, {attributes:true,attributeFilter:['class','data-theme','style','data-sphere-theme']});
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change',position);
    } else restart.after(home);
    const settings = document.querySelector('#settings .sheet-body, #settings .sheet-in, #settings, #help-panel-settings, #modal-overlay .modal-content');
    if (settings && window.MinimalAdapter) {
      const scores = document.createElement('button'); scores.type='button'; scores.textContent='Collection scores';
      scores.className=settings.id==='help-panel-settings'?'help-pack is-text':'text-action'; scores.dataset.minimalCollection='scores'; scores.addEventListener('click',()=>bridge.emit('scores'));settings.append(scores);
      // Games whose stylesheet has no .text-action rule would show the browser's gray button. :where() adds no
      // specificity, so a game's own rule still wins.
      if(scores.className==='text-action'){const look=document.createElement('style');look.textContent=':where(button.text-action[data-minimal-collection]){min-height:44px;padding:8px 12px;border:1px solid currentColor;border-radius:0;background:none;color:inherit;font:inherit;cursor:pointer}';document.head.append(look);}
    }
  }
  const ready = () => { collectionControls(); bridge.emit('ready', { resumable: !!window.MinimalAdapter }); };
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
})();
