/* The collection never handles keyboard or pointer events inside a game. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PREFIX = 'lukesteuber.minimal.collection.v1:';
  const memory = new Map();
  const read = (key, fallback) => {
    try {
      const raw=localStorage.getItem(PREFIX+key);if(raw===null)return fallback;
      const value=JSON.parse(raw);
      const valid=key==='profile'?value&&/^[a-f0-9]{64}$/.test(value.secret)&&typeof value.nickname==='string'&&typeof value.sharing==='boolean'&&Array.isArray(value.scores):Array.isArray(fallback)?Array.isArray(value):value&&typeof value==='object'&&!Array.isArray(value);
      if(!valid)throw Error('Invalid collection record');return value;
    } catch (_) { return memory.get(key) ?? fallback; }
  };
  const write = (key, value) => { memory.set(key, value); try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {} };
  const uuid = () => crypto.randomUUID();
  const secret = () => [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
  const profile = read('profile', null) || { secret: secret(), nickname: '', sharing: false, scores: [] };
  write('profile', profile);
  const saves = read('saves', {}), progress = read('progress', {}), results = read('results', []);
  const ledger=read('attempts',{});
  let catalog = [], active = null, frame = null, nonce = null, sequence = 0, busy = false, attempt = null;
  let apiBase = '', noticeTimer;
  const pending = new Map();
  let currentDocument=null; const seenDocuments=new Set();
  const notice = message => { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); };
  const persist = () => { write('saves', saves); write('progress', progress); };
  const keyFor = (game, mode) => game.id + (mode ? ':' + mode : '');
  // The last tile opens the motor-accessible puzzles, a second grid in the same package.
  const accessible = game => game.group === 'accessible';
  function showList(name) {
    $('library').hidden = name !== 'library'; $('accessible').hidden = name !== 'accessible';
    if (!active) selectView(null, name);
  }
  function selectView(key, list) {
    const url=new URL(location.href);url.hash=key?new URLSearchParams({game:key}).toString():list==='accessible'?'view=accessible':'';
    history.replaceState(null,'',url);
    try { if(key)sessionStorage.setItem(PREFIX+'selected',key);else sessionStorage.removeItem(PREFIX+'selected'); } catch(_) {}
  }
  function renderLibrary() {
    $('tiles').replaceChildren(); $('access-tiles').replaceChildren();
    const variants = catalog.flatMap(game => game.modes.length ? game.modes.map(mode => ({game, mode})) : [{game}]);
    for (const {game, mode} of variants) {
      const tile = document.createElement('button'); tile.className = 'tile ' + (mode?.id || game.id);
      tile.dataset.game = game.id; if (mode) tile.dataset.mode = mode.id;
      const title = mode ? game.title + ' ' + mode.title : game.title;
      const saved = saves[keyFor(game, mode?.id)];
      tile.setAttribute('aria-label', title + (saved ? ' · Resume' : ''));
      const image = document.createElement('img'); image.src = mode?.image || game.image; image.alt = ''; image.loading = 'lazy';
      const art = document.createElement('span'); art.className = 'art'; art.append(image);
      const name = document.createElement('span'); name.className = 'sr-only'; name.textContent = title;
      tile.append(art, name);
      tile.addEventListener('click', () => launch(game, mode));
      $(accessible(game) ? 'access-tiles' : 'tiles').append(tile);
    }
  }
  function request(type, payload) {
    return new Promise((resolve, reject) => {
      const request = uuid();
      const timeout = setTimeout(() => { pending.delete(request); reject(new Error('The game did not respond. Your current board is still open.')); }, 5000);
      pending.set(request, { resolve, reject, timeout });
      frame.contentWindow.postMessage({ v: 1, nonce, type, request, payload }, location.origin);
    });
  }
  async function stash() {
    // Games without a resume adapter (the motor-accessible puzzles) keep their own saves.
    if (!frame || !active?.resumable) return;
    const data = await request('snapshot');
    saves[active.key] = { source: data.source, state: data.state, mode: active.mode?.id, savedAt: Date.now() };
    persist();
    if (attempt) attempt.practice = true;
  }
  async function library() {
    if (busy) return;
    busy = true;
    try {
      await stash();
      const list = active && accessible(active.game) ? 'accessible' : 'library';
      frame?.remove(); frame = null; active = null; attempt = null;
      $('player').hidden = true; renderLibrary(); showList(list);
    } catch (error) { notice(error.message); }
    finally { busy = false; }
  }
  async function launch(game, mode) {
    if (busy) return;
    busy = true;
    try {
      if (frame) await stash();
      frame?.remove();
      nonce = uuid(); sequence = 0; attempt = null;currentDocument=null;seenDocuments.clear();
      active = { game, mode, key: keyFor(game, mode?.id), restorePending:true };
      active.initialSave=saves[active.key];
      frame = document.createElement('iframe'); frame.title = game.title + (mode ? ' · ' + mode.title : '');
      frame.allow = 'fullscreen; camera'; frame.setAttribute('allowfullscreen', '');
      let entry=mode?.entry || game.entry;
      const url = new URL('games/' + entry, location.href); url.searchParams.set('minimal', nonce);
      if(game.id==='akari')url.searchParams.set('look','dark');
      frame.src = url.href; selectView(active.key);$('player').replaceChildren(frame); $('player').hidden = false; $('library').hidden = true; $('accessible').hidden = true;
    } catch (error) { notice(error.message); }
    finally { busy = false; }
  }
  async function api(path, options = {}) {
    if (!apiBase) throw new Error('Scores are local in this preview.');
    const response = await fetch(apiBase + path, { signal:AbortSignal.timeout(6000),...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + profile.secret, ...options.headers } });
    if (!response.ok) {const error=new Error('Score service unavailable. Your game is unaffected.');error.status=response.status;throw error;}
    return response.status === 204 ? null : response.json();
  }
  function openAttempt(payload, remote, fresh=false) {
    const key=JSON.stringify(Object.entries(payload.identity).sort());const previous=ledger[key];
    const token = attempt = { id: uuid(), remote, key, identity: payload.identity, assisted: !!payload.assisted||!!previous?.assisted&&!previous?.finished, repeat: !!payload.repeat||!!previous?.finished, practice: !profile.sharing || !navigator.onLine || !!payload.restored || (!fresh&&!!previous&&!previous.finished), optedIn: profile.sharing, start: performance.now() };
    ledger[key]={finished:false,assisted:token.assisted};write('attempts',ledger);
    token.ready=(async()=>{
      if (!token.practice) {
        try { const data = await api('runs', { method: 'POST', body: JSON.stringify({ submission: token.id, identity: token.identity, repeat: token.repeat }) }); if (attempt === token) token.run = data.run; }
        catch (_) { token.practice = true; }
      }
    })();
  }
  async function complete(payload) {
    const current = attempt;
    if (!current || current.finished) return;
    current.finished = true;
    const elapsedMs=Math.round(performance.now()-current.start);
    ledger[current.key]={finished:true,assisted:current.assisted};write('attempts',ledger);
    await current.ready;
    const result = { game: current.identity.game, identity: current.identity, value: payload.value, elapsedMs, localAt: Date.now(), practice: current.practice || !current.run, assisted:current.assisted,repeat:current.repeat };
    results.push(result); if (results.length > 1000) results.shift(); write('results', results);
    progress[current.identity.game] = { ...(progress[current.identity.game] || {}), ...payload.progress }; persist();
    if (!current.run || current.practice || !current.optedIn || !profile.sharing) return;
    const body = JSON.stringify({ submission: current.id, proof: payload.proof, assisted: current.assisted, repeat: current.repeat, practice: false, publish: true, nickname: profile.nickname });
    // The same immutable body and id are reused after a transient finish failure.
    for (let n = 0; n < 3; n++) {
      if(!profile.sharing||current.practice)return null;
      try { const response = await api(`runs/${encodeURIComponent(current.run)}/finish`, { method: 'POST', body });current.result=response;if (response.ranked && response.score) { if(!profile.scores.includes(response.score.id))profile.scores.push(response.score.id); write('profile', profile);if(!profile.sharing){try{await api('scores/'+encodeURIComponent(response.score.id),{method:'DELETE'});profile.scores=profile.scores.filter(id=>id!==response.score.id);response.ranked=false;write('profile',profile);}catch(_){}} } return response; }
      catch (_) { if (n < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (n + 1))); }
    }
    notice('Score saved on this device. Online sharing was unavailable.');
  }
  window.addEventListener('message', async event => {
    const data = event.data;
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || data?.v !== 1 || data.nonce !== nonce || data.game !== active.game.id || !Number.isSafeInteger(data.sequence)) return;
    if(typeof data.document!=='string'||data.document.length>64)return;
    if(data.document!==currentDocument){
      if(seenDocuments.has(data.document)||!['open','ready'].includes(data.type))return;
      currentDocument=data.document;seenDocuments.add(data.document);sequence=0;
    }
    if(data.sequence<=sequence)return;
    sequence = data.sequence;
    if(data.type==='scores-request'){
      const target=frame.contentWindow,requestNonce=nonce;
      const context={api,profile,persistProfile:()=>{write('profile',profile);renderLibrary();},get attempt(){return attempt;},get active(){return active;}};
      try{const result=await MinimalScoresTransport.handle(data.payload,context);target.postMessage({v:1,nonce:requestNonce,type:'scores-response',payload:{request:data.payload.request,result}},location.origin);}
      catch(error){target.postMessage({v:1,nonce:requestNonce,type:'scores-response',payload:{request:data.payload.request,error:error.message}},location.origin);}
      return;
    }
    const waiting = pending.get(data.payload?.request);
    if (waiting) { clearTimeout(waiting.timeout); pending.delete(data.payload.request); if (data.type === 'error') waiting.reject(new Error(data.payload.message)); else waiting.resolve(data.payload); }
    if (data.type === 'ready') {
      active.resumable = !!data.payload.resumable;
      const saved = active.restorePending&&data.payload.resumable?active.initialSave:null;
      if(data.payload.resumable)active.restorePending=false;
      if (saved && saved.source === active.game.commit) { try { await request('restore', saved); if (attempt) attempt.practice = true; } catch (error) { notice(error.message); } }
      frame?.contentWindow.focus();
    } else if (data.type === 'library') library();
    else if (data.type === 'scores') openScores();
    else if (data.type === 'open') openAttempt(data.payload,data.attempt);
    else if (data.type === 'assist') { if (attempt){attempt.assisted=true;ledger[attempt.key]={finished:!!attempt.finished,assisted:true};write('attempts',ledger);} }
    else if (data.type === 'restart') { if(attempt)openAttempt({identity:attempt.identity,repeat:true,assisted:attempt.assisted},data.attempt,true); }
    else if (data.type === 'interrupted') { if (attempt) attempt.practice = true; }
    else if (data.type === 'complete' && data.attempt === attempt?.remote) {const token=attempt;token.completion=complete(data.payload);}
    else if (data.type === 'commit' && !active.restorePending && data.payload.snapshot) { saves[active.key] = { source: active.game.commit, state: data.payload.snapshot, savedAt: Date.now() }; persist(); }
  });
  window.addEventListener('pagehide',()=>{
    if(!frame||!active||active.restorePending)return;
    try {
      const state=frame.contentWindow.MinimalAdapter?.checkpoint();
      if(state){saves[active.key]={source:active.game.commit,state,mode:active.mode?.id,savedAt:Date.now()};persist();}
    } catch(_) {}
  });
  window.addEventListener('offline', () => { if (attempt) attempt.practice = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && attempt) attempt.practice = true; });
  function openScores() {
    $('nickname').value = profile.nickname; $('share-opt-in').checked = profile.sharing; $('profile-status').textContent = '';
    $('scores').showModal(); showScores();
  }
  $('save-profile').onclick = () => {
    const nickname = $('nickname').value.normalize('NFKC').trim();
    if ($('share-opt-in').checked && !/^[\p{L}\p{N}_. -]{1,20}$/u.test(nickname)) { $('profile-status').textContent = 'Use 1–20 letters, numbers, spaces, dots, dashes or underscores.'; $('nickname').focus(); return; }
    if (attempt) attempt.practice = true;
    profile.nickname = nickname; profile.sharing = $('share-opt-in').checked; write('profile', profile); renderLibrary(); $('profile-status').textContent = 'Saved.';
  };
  $('remove-scores').onclick = async () => {
    profile.sharing = false; if (attempt) attempt.practice = true; write('profile', profile);
    const remaining = [];
    for (const id of profile.scores) { try { await api('scores/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (error) { if(error.status!==404)remaining.push(id); } }
    profile.scores = remaining; write('profile', profile); $('share-opt-in').checked = false; renderLibrary();
    $('profile-status').textContent = remaining.length ? 'Sharing is off. Some scores could not be removed; try again when online.' : 'Sharing is off. Your shared scores have been removed.';
  };
  async function showScores() {
    $('score-list').replaceChildren(); $('score-context').textContent = attempt?.identity ? `${active.game.title} · ${attempt.identity.puzzleId}` : 'Choose a game and a board to see its scores.';
    if (!attempt?.identity) return;
    try {
      const category=$('score-category').value;
      const query = new URLSearchParams({ ...attempt.identity, category });
      const data=category==='local'?{entries:results.filter(r=>Object.keys(attempt.identity).every(k=>r.identity?.[k]===attempt.identity[k])).reverse().map((r,n)=>({rank:n+1,nickname:r.practice?'Practice':r.assisted?'Assisted':'Unassisted',value:['hits-v1','moves-v1','folds-v1','cleared-v1'].includes(r.identity.scoringPolicy)?r.value:Math.round(r.elapsedMs/1000)+'s'}))}:await api('boards?' + query);
      for (const item of data.entries) { const row = document.createElement('div'); row.className = 'score-row'; for (const value of [item.rank, item.nickname, item.value]) { const span = document.createElement('span'); span.textContent = value; row.append(span); } $('score-list').append(row); }
      if (!data.entries.length) $('score-context').textContent += category==='local'?' · No results yet.':' · No shared scores yet.';
    } catch (error) { $('score-context').textContent = error.message; }
  }
  $('scores-button').onclick=openScores;$('score-category').onchange=showScores;
  $('access-open').onclick=()=>{showList('accessible');$('access-tiles').querySelector('.tile')?.focus({preventScroll:true});};
  $('access-back').onclick=()=>{showList('library');$('access-open').focus({preventScroll:true});};
  Promise.all([fetch('catalog.json').then(r => r.json()), fetch('settings.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))]).then(([games, settings]) => { catalog = games;if(typeof settings.apiBase==='string'&&settings.apiBase){const url=new URL(settings.apiBase,location.href);if(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))apiBase=url.href.replace(/\/?$/,'/');} renderLibrary();
    const hash=new URLSearchParams(location.hash.slice(1));
    if(hash.get('view')==='accessible')showList('accessible');
    let selected=hash.get('game');
    if(!selected){try { selected=sessionStorage.getItem(PREFIX+'selected'); } catch(_) {}}
    if(selected){
      const game=catalog.find(g=>g.id===selected||g.modes.some(m=>keyFor(g,m.id)===selected));
      if(game)launch(game,game.modes.find(m=>keyFor(game,m.id)===selected));
      else selectView(null);
    }
  }).catch(() => notice('The library could not load. Please reload.'));
})();
