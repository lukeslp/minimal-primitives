/* Test-only parent: authenticated bridge, shared profile, disposable stub API. */
(() => {
  const profile = { secret: 'a'.repeat(64), nickname: 'Luke', sharing: true, scores: [] };
  let frame, active, nonce, sequence = 0, attempt, saved = 0, hold = false;
  const messages = [], held = [], errors = [];
  const api = async (path, options = {}) => {
    const response = await fetch('/api/v1/' + path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + profile.secret } });
    if (!response.ok) throw Error('Fixture service unavailable.');
    return response.json();
  };
  const context = { api, profile, get attempt() { return attempt; }, get active() { return active; }, persistProfile() { saved++; } };
  function launch(game, mode, sharing = profile.sharing, puzzle = game === 'bridges' ? 'b01' : 'intro1') {
    frame?.remove(); profile.sharing = sharing; nonce = crypto.randomUUID(); sequence = 0; attempt = null;
    active = { game: { id: game } };
    // Native preferences use the bootstrap's namespace; the fixture owns no real saves.
    localStorage.setItem(`lukesteuber.minimal.${game}:${game}.settings.v1`, JSON.stringify({ version: 1, theme: 'light', motion: 'reduce', zoom: 'fit', difficulty: 'Hard', ...(game === 'slant' ? { mode: mode === 'hard' ? 'Hard' : 'Standard' } : {}) }));
    frame = document.createElement('iframe');
    const url = new URL(`/preview/anthology/games/${game}/index.html`, location.href);
    url.searchParams.set('minimal', nonce); url.searchParams.set('puzzle', puzzle);
    if (mode === 'circuits') url.searchParams.set('controls', 'circuits');
    frame.src = url.href; document.body.replaceChildren(frame);
  }
  async function finish(payload) {
    const a = attempt;
    if (!a || a.finished) return;
    a.finished = true;
    // Assign the promise immediately; native state reads share this receipt.
    a.completion = (async () => {
      await a.ready;
      if (!a.run || a.practice || !a.optedIn || !profile.sharing) return null;
      try {
        const receipt = await api(`runs/${a.run}/finish`, { method: 'POST', body: JSON.stringify({ submission: a.id,
          proof: payload.proof, assisted: a.assisted, repeat: a.repeat, practice: false, publish: true, nickname: profile.nickname }) });
        a.result = receipt;
        if (receipt.ranked && receipt.score) { profile.scores.push(receipt.score.id); context.persistProfile(); }
        return receipt;
      } catch (_) { return null; }
    })();
  }
  async function respond(data, target = frame.contentWindow, replyNonce = nonce) {
    try {
      const result = await MinimalScoresTransport.handle(data.payload, context);
      target.postMessage({ v: 1, nonce: replyNonce, type: 'scores-response', payload: { request: data.payload.request, result } }, location.origin);
    } catch (error) {
      errors.push(error.message);
      target.postMessage({ v: 1, nonce: replyNonce, type: 'scores-response', payload: { request: data.payload.request, error: error.message } }, location.origin);
    }
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== frame?.contentWindow || event.origin !== location.origin || data?.v !== 1 || data.nonce !== nonce ||
        data.game !== active.game.id || !Number.isSafeInteger(data.sequence) || data.sequence <= sequence) return;
    sequence = data.sequence; messages.push(data);
    if (data.type === 'open') {
      const a = attempt = { id: crypto.randomUUID(), identity: data.payload.identity, assisted: false, repeat: !!data.payload.repeat,
        practice: !profile.sharing || !!data.payload.restored, optedIn: profile.sharing, finished: false };
      a.ready = (async () => { if (!a.practice) { try { const r = await api('runs', { method: 'POST', body: JSON.stringify({ submission: a.id, identity: a.identity, repeat: a.repeat }) }); a.run = r.run; } catch (_) { a.practice = true; } } })();
    } else if (data.type === 'complete') void finish(data.payload);
    else if (data.type === 'assist') { if (attempt) attempt.assisted = true; }
    else if (data.type === 'restart') { if (attempt) attempt.repeat = true; }
    else if (data.type === 'interrupted') { if (attempt) attempt.practice = true; }
    else if (data.type === 'scores-request') {
      if (hold) held.push({ data, target: event.source, nonce });
      else void respond(data, event.source, nonce);
    }
  });
  window.Fixture = {
    profile, messages, errors, launch, context,
    get attempt() { return attempt; }, get saved() { return saved; }, get held() { return held; }, get nonce() { return nonce; },
    hold(value) { hold = value; },
    release() { hold = false; for (const task of held.splice(0)) void respond(task.data, task.target, task.nonce); }
  };
})();
