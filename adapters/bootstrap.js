/* Runs before upstream scripts. Only generated pages receive this namespace. */
(() => {
  'use strict';
  const config = window.MINIMAL_CONFIG;
  const prefix = `lukesteuber.minimal.${config.game}:`;
  // Access is about the player, not the game: the choice made on the
  // library's Accessibility band and the camera calibration are shared by
  // every game. Everything else stays in the game's own namespace.
  const SHARED = new Set(['minimal-access.v1:default', 'minimal-access.v1:calibration']);
  const full = key => (SHARED.has(key) ? 'lukesteuber.minimal.shared:' : prefix) + key;
  const proto = Storage.prototype;
  const native = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'clear', 'key'].map(k => [k, proto[k]]));
  const length = Object.getOwnPropertyDescriptor(proto, 'length').get;
  const memories = new WeakMap();
  let local, session;
  try { local = window.localStorage; } catch (_) {}
  try { session = window.sessionStorage; } catch (_) {}
  for (const kind of ['localStorage','sessionStorage']) {
    if ((kind==='localStorage'?local:session)) continue;
    const fallback=Object.create(proto);
    try { Object.defineProperty(window,kind,{configurable:true,value:fallback}); if(kind==='localStorage')local=fallback;else session=fallback; } catch (_) {}
  }
  const isolated=store=>store===local||store===session;
  const memoryFor=store=>{if(!memories.has(store))memories.set(store,new Map());return memories.get(store);};
  const keys = store => {
    const result = [];
    try { for (let i = 0; i < length.call(store); i++) { const key = native.key.call(store, i); if (key?.startsWith(prefix)) result.push(key.slice(prefix.length)); } } catch (_) {}
    for (const key of memoryFor(store).keys()) if (!result.includes(key)) result.push(key);
    return result;
  };
  proto.getItem = function(key) { if (!isolated(this)) return native.getItem.call(this, key); key = String(key); const memory=memoryFor(this);try { return native.getItem.call(this, full(key)) ?? memory.get(key) ?? null; } catch (_) { return memory.get(key) ?? null; } };
  proto.setItem = function(key, value) { if (!isolated(this)) return native.setItem.call(this, key, value); key = String(key); value = String(value); memoryFor(this).set(key, value); try { native.setItem.call(this, full(key), value); } catch (_) {} };
  proto.removeItem = function(key) { if (!isolated(this)) return native.removeItem.call(this, key); key = String(key); memoryFor(this).delete(key); try { native.removeItem.call(this, full(key)); } catch (_) {} };
  proto.key = function(index) { return isolated(this) ? keys(this)[Number(index)] ?? null : native.key.call(this, index); };
  proto.clear = function() { if (!isolated(this)) return native.clear.call(this); for (const key of keys(this)) this.removeItem(key); };
  Object.defineProperty(proto, 'length', { configurable: true, get() { return isolated(this) ? keys(this).length : length.call(this); } });
  const nonce = new URL(location.href).searchParams.get('minimal');
  // The handshake must not make a first visit look like a shared-puzzle URL.
  if (nonce) { const url = new URL(location.href); url.searchParams.delete('minimal'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
  const documentId = crypto.randomUUID();
  let sequence = 0, navigationFocus = null;
  // Collection navigation must not become a board gesture or change its input mode.
  for(const type of ['pointerdown','pointerup','keydown'])window.addEventListener(type,event=>{
    if(!event.target.closest?.('[data-minimal-collection]'))return;
    if(type==='pointerdown')event.preventDefault();
    event.stopImmediatePropagation();
  },true);
  window.addEventListener('focusout',event=>{
    if(event.relatedTarget?.closest?.('[data-minimal-collection]'))navigationFocus=event.target.id||null;
  },true);
  window.MinimalBridge = {
    config, nonce,sessionIsolated:true,
    emit(type, payload = {}, attempt=this.attempt) { if(type==='library'&&parent===window){location.assign(new URL(config.root+'/index.html',location.href));return;} if (parent !== window && nonce) parent.postMessage({ v: 1, game: config.game, nonce, document:documentId, attempt, sequence: ++sequence, type, payload }, location.origin); },
    storage() { return Object.fromEntries(keys(local).map(key => [key, local.getItem(key)])); }
  };
  const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const clone = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? Array.from(v) : v));
  window.MinimalBridge.clone = clone;
  window.MinimalBridge.ui=()=>({dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),focus:document.activeElement?.dataset.minimalCollection?navigationFocus:document.activeElement?.id||null});
  window.MinimalBridge.restoreUI=ui=>{
    if(!ui)return;
    for(const id of ui.dialogs||[]){const dialog=document.getElementById(id);if(!dialog||dialog.open)continue;const button=document.querySelector(id==='settings'?'#settings-button,#settings-btn':id==='help'?'#help-button,#help-btn':`[aria-controls="${CSS.escape(id)}"]`);if(button)button.click();if(!dialog.open)dialog.showModal();}
    if(ui.focus)document.getElementById(ui.focus)?.focus({preventScroll:true});
  };
  window.MinimalBridge.install = options => {
    let current = '', solved = false, paused = false, identityReady = Promise.resolve(), generation = 0, restartBoundary=0, pendingRestart=false;
    const bridge = window.MinimalBridge;
    const describe = () => options.describe();
    const open = () => {
      if (paused) return;
      const description = clone(describe());
      const key = canonical([description.id, description.mode, description.layout]);
      if (key === current) return;
      current = key; solved = !!description.solved;
      const serial = ++generation;
      const attempt=bridge.attempt=crypto.randomUUID();
      identityReady = crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(description.layout))).then(hash => {
        if (serial !== generation) return;
        const layoutHash = [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
        bridge.emit('open', { identity: { game: config.game, mode: description.mode || 'campaign', puzzleId: String(description.id), layoutHash, rulesVersion: options.rulesVersion, scoringPolicy: options.scoringPolicy || 'time-v1' }, repeat: !!description.repeat, restored: !!description.restored || !!description.solved || String(description.id).startsWith('p') && ['akari', 'bridges', 'fold', 'galaxies', 'slant'].includes(config.game) },attempt);
      });
    };
    const adapter = window.MinimalAdapter = {
      checkpoint() { return clone(options.snapshot()); },
      async snapshot() { await options.settle?.(); return clone(options.snapshot()); },
      async restore(state) {
        const before=clone(options.snapshot());paused=true;
        try { await options.restore(clone(state)); }
        catch(error) { try { await options.restore(before); } catch(_) {} throw error; }
        finally { paused=false;current='';open();bridge.emit('interrupted'); }
      },
      committed() {
        if (paused) return;
        open();
        const description = describe();
        if (description.solved && !solved) {
          solved = true;
          const payload = clone({ proof: options.proof(), value: description.value, progress: description.progress });
          const attempt=bridge.attempt;
          identityReady.then(() => bridge.emit('complete', payload,attempt));
        } else if (!description.solved) solved = false;
      },
      changed() { if (paused) return; open();if(pendingRestart){restartBoundary=options.undoDepth?.()||0;pendingRestart=false;} bridge.emit('commit', { snapshot: clone(options.snapshot()) }); },
      assist() { if (!paused) bridge.emit('assist'); },
      restart() { if (!paused){solved=false;pendingRestart=true;bridge.emit('restart');} },
      undo() {const depth=options.undoDepth?.()||0;if(!paused&&depth>0&&depth<=restartBoundary)bridge.emit('interrupted');},
    };
    open();
    return adapter;
  };
  document.addEventListener('click', event => {
    const a = event.target.closest('a');
    if (!a) return;
    if (a.hasAttribute('data-minimal-library')) { event.preventDefault(); window.MinimalBridge.emit('library'); }
    else if (new URL(a.href, location.href).origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  });
})();
