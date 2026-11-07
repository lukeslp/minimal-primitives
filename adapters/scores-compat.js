/* Collection-backed behavior for the original Bridges/Slant Scores dialog. Luke Steuber. */
(() => {
  'use strict';
  const bridge = window.MinimalBridge;
  const pending = new Map();
  function request(action, payload) {
    if (!bridge?.nonce || parent === window) return Promise.reject(new Error('Scores are available from the collection.'));
    if (pending.size >= 32) return Promise.reject(new Error('Scores are busy. Try again.'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Scores are unavailable. Your game is unaffected.')); }, 12000);
      pending.set(id, { resolve, reject, timer });
      try { bridge.emit('scores-request', { ...payload, request: id, action }); }
      catch (_) { clearTimeout(timer); pending.delete(id); reject(new Error('Scores are unavailable. Your game is unaffected.')); }
    });
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (!bridge?.nonce || event.source !== parent || event.origin !== location.origin || data?.v !== 1 ||
        data.nonce !== bridge.nonce || data.type !== 'scores-response') return;
    const payload = data.payload;
    if (!payload || typeof payload.request !== 'string' || !pending.has(payload.request) ||
        (Object.hasOwn(payload, 'result') === Object.hasOwn(payload, 'error'))) return;
    const task = pending.get(payload.request);
    pending.delete(payload.request); clearTimeout(task.timer);
    if (Object.hasOwn(payload, 'error')) task.reject(new Error(typeof payload.error === 'string' ? payload.error.slice(0, 240) : 'Scores are unavailable.'));
    else task.resolve(payload.result);
  });
  window.addEventListener('pagehide', () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Scores view closed.')); }
    pending.clear();
  });
  const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(v => v.toString(16).padStart(2, '0')).join('');
  const format = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  function attach({ game, shape, isCampaign, describe, labels, sheet, category, status, submit, remove, open, after }) {
    const $ = selector => sheet.querySelector(selector);
    const alias = $('#score-alias');
    let current = null, completed = null, view = null, epoch = 0, returnTo = null;
    const live = (board, turn) => current === board && epoch === turn && sheet.open;
    async function call(action, board, extra = {}) {
      const identity = await board.identity;
      // A board switch during hashing must never change the new attempt's profile.
      if (current !== board) throw new Error('This Scores view belongs to another attempt. Reopen Scores.');
      return request(action, { board: identity, ...(board.attempt ? { attempt: board.attempt } : {}), ...extra });
    }
    function render(state, fillNickname) {
      view = state;
      current.attempt = state.attempt;
      if (fillNickname) {
        alias.value = state.profile.nickname || '';
        if (current.finished || state.finished) category.value = state.category;
      }
      const result = state.result;
      completed = current.finished ? result || { category: state.category, run: null } : null;
      $('#scores-result').textContent = result ? 'Your time ' + format(result.seconds) + ' · ' + labels[result.category] +
        (result.published ? ' · Shared' : ' · Saved on this device') : current.finished || state.finished ? 'Saved on this device. This attempt has no shared score.' : '';
      submit.hidden = false;
      remove.hidden = !result?.published;
    }
    async function refresh(fillNickname = false) {
      const board = current, turn = ++epoch;
      $('#scores-list').replaceChildren(); submit.hidden = true; remove.hidden = true;
      if (!board?.campaign) { status.textContent = 'Scores are available for campaign puzzles.'; return; }
      status.textContent = 'Loading…';
      try {
        const state = await call('state', board);
        if (!live(board, turn)) return;
        render(state, fillNickname);
        // Keep a user's category selection; selecting a different run list is a read.
        const body = await call('board', board, { category: category.value });
        if (!live(board, turn)) return;
        for (const row of body.entries) {
          const li = document.createElement('li');
          for (const value of [row.rank, row.alias, format(row.seconds)]) { const span = document.createElement('span'); span.textContent = value; li.append(span); }
          $('#scores-list').append(li);
        }
        status.textContent = body.entries.length ? '' : 'No scores yet.';
      } catch (_) { if (live(board, turn)) status.textContent = 'Scores are unavailable. Your game is saved on this device.'; }
    }
    function show(event) {
      if (!current) return;
      returnTo = event.currentTarget;
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      $('#scores-board').textContent = describe(current);
      $('#scores-result').textContent = '';
      alias.value = '';
      category.value = view?.category || 'unassisted';
      sheet.showModal();
      void refresh(true);
    }
    open.onclick = show; after.onclick = show;
    category.onchange = () => { void refresh(); };
    sheet.addEventListener('close', () => {
      epoch++;
      if (returnTo?.isConnected && returnTo.closest('dialog')?.open !== false && returnTo.getClientRects().length) returnTo.focus({ preventScroll: true });
      else document.querySelector('#settings-btn')?.focus({ preventScroll: true });
    });
    submit.onsubmit = async event => {
      event.preventDefault();
      const board = current, turn = ++epoch, button = submit.querySelector('button');
      if (!board?.campaign || !view) return;
      button.disabled = true; status.textContent = 'Saving…';
      try {
        const state = await call('preference', board, { nickname: alias.value.trim() });
        if (!live(board, turn)) return;
        render(state, true);
        status.textContent = 'Sharing preference saved for future new attempts.';
      } catch (error) { if (live(board, turn)) status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    remove.onclick = async () => {
      const board = current, turn = ++epoch, id = view?.result?.id;
      if (!id) return;
      remove.disabled = true;
      try {
        const state = await call('remove', board, { id });
        if (!live(board, turn)) return;
        render(state, false);
        await refresh();
      } catch (_) { if (live(board, turn)) status.textContent = 'Could not remove the score. Try again.'; }
      finally { remove.disabled = false; }
    };
    return {
      load(p, options) {
        epoch++; completed = null; view = null;
        current = { puzzle: p.id, mode: options.mode, campaign: isCampaign(p), label: options.label, finished: false,
          identity: digest(shape(p)).then(layoutHash => ({ game, puzzle: p.id, mode: options.mode, layoutHash })) };
        // No request on load: the main adapter alone opens online runs.
      },
      finish() { if (!current || current.finished) return; current.finished = true; completed = { run: null }; if (sheet.open) void refresh(); },
      // The main adapter owns sticky assistance/restart flags and proof collection.
      hint() {}, restart() {},
      get result() { return completed; }
    };
  }
  window.MinimalScoresCompat = Object.freeze({ attach });
})();
