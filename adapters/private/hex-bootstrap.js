/* Optional bootstrap addition: namespace sessionStorage before upstream runs.
 * Safe alongside the collection localStorage shim; install only once per iframe.
 * All adapter code is embedded by hex_recipe.py, never added to raw imports.
 */
(() => {
  'use strict';
  if (!window.MinimalBridge || window.MinimalHex) return;
  if(!MinimalBridge.sessionIsolated){
  const prefix = `lukesteuber.minimal.${MinimalBridge.config.game}:`;
  const proto = Storage.prototype;
  const native = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'key', 'clear'].map(k => [k, proto[k]]));
  const length = Object.getOwnPropertyDescriptor(proto, 'length').get;
  let session;
  try { session = window.sessionStorage; } catch (_) {}
  const memory = new Map();
  const keys = () => {
    const out = [];
    try {
      for (let i = 0; i < length.call(session); i++) {
        const key = native.key.call(session, i);
        if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
      }
    } catch (_) {}
    for (const key of memory.keys()) if (!out.includes(key)) out.push(key);
    return out;
  };
  proto.getItem = function(key) {
    if (this !== session) return native.getItem.call(this, key);
    key = String(key);
    try { return native.getItem.call(this, prefix + key) ?? memory.get(key) ?? null; } catch (_) { return memory.get(key) ?? null; }
  };
  proto.setItem = function(key, value) {
    if (this !== session) return native.setItem.call(this, key, value);
    key = String(key); value = String(value); memory.set(key, value);
    try { native.setItem.call(this, prefix + key, value); } catch (_) {}
  };
  proto.removeItem = function(key) {
    if (this !== session) return native.removeItem.call(this, key);
    key = String(key); memory.delete(key);
    try { native.removeItem.call(this, prefix + key); } catch (_) {}
  };
  proto.key = function(index) { return this === session ? keys()[Number(index)] ?? null : native.key.call(this, index); };
  proto.clear = function() { if (this !== session) return native.clear.call(this); for (const key of keys()) this.removeItem(key); };
  Object.defineProperty(proto, 'length', { configurable: true, get() { return this === session ? keys().length : length.call(this); } });
  }

  const clockKeys = new Set(['t0', 'lastT', 'lastDigAt', 'telegraphUntil', 'visualDue', 'pulseAt', 'revealDue', '_seepAt', 'lastFrameAt', 'lastClickTime', 'lastTapAt']);
  // Explicit tagged codec: preserve Sets, Maps, undo byte arrays and cell refs.
  // Times are relative to this document's performance clock, never wall-clock.
  function pack(value, now, refs = new Map(), key = '') {
    if (value === undefined) return { $hex: 'undefined' };
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'number' && clockKeys.has(key) && value !== 0) return { $hex: 'clock', value: value - now };
      return value;
    }
    if (refs.has(value)) return { $hex: 'cell', value: refs.get(value) };
    if (value instanceof Set) return { $hex: 'set', value: [...value].map(v => pack(v, now, refs)) };
    if (value instanceof Map) return { $hex: 'map', value: [...value].map(v => pack(v, now, refs)) };
    if (ArrayBuffer.isView(value)) return { $hex: 'bytes', value: Array.from(value) };
    if (Array.isArray(value)) return value.map(v => pack(v, now, refs));
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => k !== 'path' && typeof v !== 'function').map(([k, v]) => [k, pack(v, now, refs, k)]));
  }
  function unpack(value, now, refs = new Map()) {
    if (!value || typeof value !== 'object') return value;
    if (value.$hex === 'undefined') return undefined;
    if (value.$hex === 'clock') return value.value + now;
    if (value.$hex === 'cell') return refs.get(value.value) ?? null;
    if (value.$hex === 'bytes') return new Uint8Array(value.value);
    if (value.$hex === 'set') return new Set(value.value.map(v => unpack(v, now, refs)));
    if (value.$hex === 'map') return new Map(value.value.map(v => unpack(v, now, refs)));
    if (Array.isArray(value)) return value.map(v => unpack(v, now, refs));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unpack(v, now, refs)]));
  }
  const omit = (object, excluded) => Object.fromEntries(Object.entries(object).filter(([k]) => !excluded.includes(k)));
  function chrome() {
    return [...document.querySelectorAll('[id]')].filter(el => !['SCRIPT', 'STYLE', 'CANVAS'].includes(el.tagName)).map(el => ({ id: el.id, hidden: el.hidden, className: el.getAttribute('class'), style: el.getAttribute('style'), expanded: el.getAttribute('aria-expanded'), pressed: el.getAttribute('aria-pressed') }));
  }
  function restoreChrome(rows) {
    for (const row of rows || []) {
      const el = document.getElementById(row.id);
      if (!el) continue;
      el.hidden = row.hidden;
      for (const [attr, field] of [['class', 'className'], ['style', 'style'], ['aria-expanded', 'expanded'], ['aria-pressed', 'pressed']]) {
        if (row[field] === null) el.removeAttribute(attr); else el.setAttribute(attr, row[field]);
      }
    }
  }
  const openListeners = new Set();
  const emit = MinimalBridge.emit;
  MinimalBridge.emit = function(type, payload, attempt) {
    const result = emit.call(this, type, payload,attempt);
    if (type === 'open') for (const listener of openListeners) listener(payload);
    return result;
  };
  function create(o) {
    let initial = null, terminal = null, adapter = null, restored = !!o.started(), queued = false, repeat = false, awaitingOpen = false, pendingAssist = false;
    let outer = { snapshot: () => null, restore() {}, mode: () => o.kind };
    const mode = () => `${outer.mode()}:${o.difficulty()}`;
    const layout = first => o.layout(first);
    const describe = () => ({
      id: `hex/${mode()}`, mode: mode(), layout: initial || { kind: o.kind, pending: true, difficulty: o.difficulty() },
      solved: !!terminal, repeat, restored, value: terminal?.value ?? 0,
      progress: { cleared: o.safe().length }
    });
    const snapshot = () => ({ v: 1, source: MinimalBridge.config.source, kind: o.kind, initial, terminal, restored, repeat, inner: o.snapshot(), outer: outer.snapshot(), chrome: chrome(), bodyClass: document.body.className, bodyStyle: document.body.getAttribute('style'), focus: document.activeElement?.id });
    const controller = {
      install(extension) {
        if (extension) outer = extension;
        if (o.started() && !initial) initial = layout(null);
        awaitingOpen = true;
        adapter = MinimalBridge.install({
          rulesVersion: o.rules,
          get scoringPolicy() { return o.endless() ? 'cleared-v1' : 'time-v1'; },
          describe, snapshot,
          restore(d) {
            if (!d || d.v !== 1 || d.source !== MinimalBridge.config.source || d.kind !== o.kind) throw Error('Invalid Hexsweeper snapshot version');
            const before = snapshot();
            const apply = state => {
              outer.restore(state.outer, true);
              o.restore(state.inner);
              outer.restore(state.outer, false);
              initial = state.initial; terminal = state.terminal; repeat = !!state.repeat; restored = true;
              restoreChrome(state.chrome);
              document.body.className = state.bodyClass || '';
              if (state.bodyStyle === null) document.body.removeAttribute('style'); else document.body.setAttribute('style', state.bodyStyle);
              if (state.focus) document.getElementById(state.focus)?.focus();
            };
            try { apply(d); } catch (error) { apply(before); throw error; }
          },
          proof() { if (!terminal) throw Error('Hexsweeper has no committed terminal state'); return terminal.proof; }
        });
        return adapter;
      },
      begin(first) { initial = layout(first); terminal = null; repeat = false; restored = false; adapter?.changed(); },
      terminal(won, reason) {
        if (!won && !o.endless()) return;
        if (!initial) { initial = layout(null); restored = true; }
        const proof = { v: 1, initial, final: { ...o.final(won, reason), ...(outer.proof ? { session: outer.proof() } : {}) } };
        const value = o.endless() ? proof.final.safe.length : 0;
        terminal = { proof, value };
        adapter?.committed();
      },
      changed() {
        // Flood hooks can fire hundreds of times per frame; send one snapshot.
        if (!adapter || queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; adapter.changed(); adapter.committed(); });
      },
      reset() { adapter?.restart(); initial = null; terminal = null; repeat = false; restored = false; controller.changed(); },
      assist() { adapter?.assist(); },
      resumed() { initial = layout(null); terminal = null; restored = true; controller.changed(); },
      invalidate() {
        if (terminal) {
          terminal = null; repeat = true; pendingAssist = true;
          controller.install();
        } else if (awaitingOpen) pendingAssist = true;
        else adapter?.assist();
        controller.changed();
      }
    };
    openListeners.add(payload => {
      if (!awaitingOpen || payload.identity?.mode !== mode()) return;
      awaitingOpen = false;
      if (pendingAssist) { pendingAssist = false; adapter?.assist(); }
    });
    return controller;
  }
  window.MinimalHex = { pack, unpack, omit, create };
})();
