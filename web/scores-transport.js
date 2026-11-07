/* Native Scores transport. Luke Steuber. No run creation or completion here. */
(() => {
  'use strict';
  const modes = {
    bridges: { 'classic-v1': 'classic', 'circuits-v1': 'circuits' },
    slant: { 'slant-standard-v1': 'standard', 'slant-v1': 'hard' }
  };
  const categories = ['unassisted', 'assisted', 'repeat', 'repeat-assisted', 'practice'];
  const identityKeys = ['game', 'mode', 'puzzleId', 'layoutHash', 'rulesVersion', 'scoringPolicy'];
  const fail = message => { throw new Error(message); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const categoryOf = a => a.practice || !a.run || !a.optedIn ? 'practice' : a.repeat ? (a.assisted ? 'repeat-assisted' : 'repeat') : a.assisted ? 'assisted' : 'unassisted';

  /* handle(payload, context) returns a result or rejects with a displayable Error.
   * The caller MUST first authenticate source/origin/v/game/nonce/sequence and
   * reply to that same frame with {v:1,nonce,type:'scores-response',payload:
   * {request:payload.request,result}} or {request:payload.request,error:message}.
   * Context: api(path, options) uses the parent's secret and isolated /api/v1/;
   * profile is {secret,nickname,sharing,scores:[id]}; persistProfile() saves it.
   * active.game.id and attempt MUST be live getters across asynchronous work.
   * attempt has id,identity,run,assisted,repeat,practice,optedIn,finished.
   * Optional ready: Promise settles the parent's start. completion: Promise
   * settles its finish/retries and returns {score,ranked} or null. Main assigns
   * completion synchronously when finishing and retains its receipt in result.
   * These promises must settle even on failure. Nothing here starts/finishes a run.
   * Actions: state, board (+category), preference (+nickname), remove (+id).
   * Every request carries board:{game,puzzle,mode,layoutHash}; layoutHash is the
   * canonical shape hash, NOT the old order-dependent native digest. An optional
   * attempt binds subsequent UI actions to the returned parent attempt ID.
   */
  async function handle(payload, context) {
    if (!object(payload) || typeof payload.request !== 'string' || !/^[\w.:-]{1,128}$/.test(payload.request) ||
        !['state', 'board', 'preference', 'remove'].includes(payload.action)) fail('Invalid Scores request.');
    const { profile } = context;
    const attempt = context.attempt;
    const board = payload.board;
    function check() {
      const i = attempt?.identity;
      if (!attempt || context.attempt !== attempt || !object(board) || !Object.hasOwn(modes, board.game) ||
          context.active?.game?.id !== board.game || !object(i) ||
          !identityKeys.every(k => typeof i[k] === 'string' && i[k].length > 0) ||
          i.game !== board.game || i.puzzleId !== board.puzzle ||
          i.mode !== modes[board.game][board.mode] || i.layoutHash !== board.layoutHash ||
          !/^[a-f0-9]{64}$/.test(i.layoutHash) || i.scoringPolicy !== 'time-v1' ||
          (payload.attempt !== undefined && payload.attempt !== attempt.id)) fail('This Scores view belongs to another attempt. Reopen Scores.');
    }
    check();
    if (!object(profile) || !Array.isArray(profile.scores) || typeof context.api !== 'function' || typeof context.persistProfile !== 'function') fail('Scores are unavailable. Your game is unaffected.');
    const snapshot = receipt => {
      const score = receipt?.score;
      // Only a receipt for this exact parent run and pinned identity may be shown.
      const valid = object(score) && score.run === attempt.run &&
        identityKeys.every(k => score.identity?.[k] === attempt.identity[k]) &&
        categories.includes(score.category) && Number.isSafeInteger(score.elapsedMs) && score.elapsedMs >= 0;
      const published = valid && receipt.ranked === true && profile.scores.includes(score.id);
      return {
        attempt: attempt.id,
        profile: { nickname: profile.nickname, sharing: !!profile.sharing },
        finished: !!attempt.finished,
        category: valid ? score.category : categoryOf(attempt),
        result: valid ? { seconds: Math.max(1, Math.floor(score.elapsedMs / 1000)), category: score.category,
          published, ...(published ? { id: score.id } : {}) } : null
      };
    };
    if (payload.action === 'preference') {
      if (typeof payload.nickname !== 'string') fail('Choose a nickname of 1–20 letters, numbers, spaces, underscores, dots or dashes.');
      const nickname = payload.nickname.normalize('NFKC').trim();
      if (!/^[\p{L}\p{N}_. -]{1,20}$/u.test(nickname)) fail('Choose a nickname of 1–20 letters, numbers, spaces, underscores, dots or dashes.');
      // Never upgrade optedIn, start an online run, or publish an old receipt.
      if (!profile.sharing || profile.nickname !== nickname) attempt.practice = true;
      profile.nickname = nickname;
      profile.sharing = true;
      await context.persistProfile();
      check();
      return snapshot(attempt.result);
    }
    if (payload.action === 'board') {
      if (!categories.includes(payload.category)) fail('Invalid Scores category.');
      const identity = Object.fromEntries(identityKeys.map(k => [k, attempt.identity[k]]));
      const data = await context.api('boards?' + new URLSearchParams({ ...identity, category: payload.category }));
      check();
      if (!Array.isArray(data?.entries)) fail('Scores are unavailable. Your game is unaffected.');
      return { category: payload.category, entries: data.entries.map(row => ({ rank: row.rank,
        alias: row.nickname, seconds: Math.max(1, Math.floor(row.elapsedMs / 1000)) })) };
    }
    if (payload.action === 'state') {
      if (attempt.ready) await attempt.ready;
      check();
      const receipt = attempt.completion ? await attempt.completion : attempt.result;
      check();
      return snapshot(receipt);
    }
    const receipt = attempt.completion ? await attempt.completion : attempt.result;
    check();
    const state = snapshot(receipt);
    if (typeof payload.id !== 'string' || state.result?.id !== payload.id || !profile.scores.includes(payload.id)) fail('This shared score is no longer available. Reopen Scores.');
    await context.api('scores/' + encodeURIComponent(payload.id), { method: 'DELETE' });
    profile.scores = profile.scores.filter(id => id !== payload.id);
    await context.persistProfile();
    check();
    return snapshot(receipt);
  }
  globalThis.MinimalScoresTransport = Object.freeze({ handle });
})();
