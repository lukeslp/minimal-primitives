/* Runs before upstream scripts. Only generated pages receive this namespace. */
(() => {
  'use strict';
  const config = window.MINIMAL_CONFIG;
  // A picture leaves a game only through the system's share sheet: the other way out is a blob: download, which an
  // app's web view drops while the game says it saved. Where the sheet can take a picture the page is marked, and
  // the buttons that save or share one show only then (SHARE_SHEET_ONLY in tools/transforms.py).
  try {
    const picture = new File([''], 'picture.png', {type: 'image/png'});
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({files: [picture]}))) document.documentElement.dataset.minimalShare = '';
  } catch (_) {}
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
  // Memory holds only what the device would not store: a refused write (storage full, or storage turned off) and,
  // as null, a refused removal. A pending value wins over the stored one, so a game reads back what it last saved
  // and not the older record; a later write that succeeds clears it. The library is told once (see emit below).
  const memoryFor=store=>{if(!memories.has(store))memories.set(store,new Map());return memories.get(store);};
  let refused=false,announced=false,told=false;
  const tell=()=>{if(!refused||told||!announced)return;told=true;window.MinimalBridge.emit('storage');};
  const keys = store => {
    const result = [];
    try { for (let i = 0; i < length.call(store); i++) { const key = native.key.call(store, i); if (key?.startsWith(prefix)) result.push(key.slice(prefix.length)); } } catch (_) {}
    for (const [key,value] of memoryFor(store)) { const at=result.indexOf(key); if(value===null){if(at>=0)result.splice(at,1);} else if(at<0)result.push(key); }
    return result;
  };
  proto.getItem = function(key) { if (!isolated(this)) return native.getItem.call(this, key); key = String(key); const memory=memoryFor(this);if(memory.has(key))return memory.get(key);try { return native.getItem.call(this, full(key)); } catch (_) { return null; } };
  proto.setItem = function(key, value) { if (!isolated(this)) return native.setItem.call(this, key, value); key = String(key); value = String(value); const memory=memoryFor(this);try { native.setItem.call(this, full(key), value); memory.delete(key); } catch (_) { memory.set(key, value);refused=true;tell(); } };
  proto.removeItem = function(key) { if (!isolated(this)) return native.removeItem.call(this, key); key = String(key); const memory=memoryFor(this);try { native.removeItem.call(this, full(key)); memory.delete(key); } catch (_) { memory.set(key, null); } };
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
    emit(type, payload = {}, attempt=this.attempt) { if(type==='library'&&parent===window){location.assign(new URL(config.root+'/index.html',location.href));return;} if (parent !== window && nonce) parent.postMessage({ v: 1, game: config.game, nonce, document:documentId, attempt, sequence: ++sequence, type, payload }, location.origin);
      // The library takes a new document's first 'open' or 'ready' and nothing before it; a save refused earlier is reported then.
      if(type==='open'||type==='ready'){announced=true;tell();} },
    storage() { return Object.fromEntries(keys(local).map(key => [key, local.getItem(key)])); },
    // A picture the share sheet did not take (not one the player turned away) is said by the library, in words.
    shareFailed() { this.emit('share-failed'); }
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
  // Home, Scores and Android's Back answer only in a page that carries the collection's handshake (the nonce read
  // above). A link to another packaged page starts a new document, so the handshake goes with it: here, once, for
  // every such link in every game (Tangles' Experiments and New Game+ are links of this kind). A link the game
  // handles itself (default prevented) and a link to a place in the same page load nothing and are left alone.
  // The listener sits on the window so every handler of the game's has run first.
  window.addEventListener('click', event => {
    const a = event.target.closest?.('a[href]');
    if (!a || !nonce || event.defaultPrevented || a.hasAttribute('data-minimal-library') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    let url;
    try { url = new URL(href, document.baseURI); } catch (_) { return; }
    if (url.protocol !== location.protocol || url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && href.includes('#')) return;
    url.searchParams.set('minimal', nonce);
    a.setAttribute('href', url.href);
  });
})();
