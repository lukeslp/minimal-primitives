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
  // The library's own settings: Look (the phone's, Dark, Light, Checkerboard) and Motion. library-theme.js applied them before the first paint.
  const settings=read('library',{});
  let catalog = [], tiles = [], active = null, frame = null, nonce = null, sequence = 0, busy = false, attempt = null;
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
  // The library is the Minimal index (lukesteuber.com/minimal/) as imported into tiles.json: the same tiles,
  // names, lines and pictures, in the index's own markup, so its stylesheet draws them. A tile's links open
  // bundled games instead of web pages. `data-open` names what each link opens.
  let shown = null;
  const hideCard = () => { if (shown) { shown.classList.remove('show'); shown = null; } };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const opener = (key, label, run) => {
    const link = el('a'); link.href = '#' + new URLSearchParams({game: key}); link.dataset.open = key; link.setAttribute('aria-label', label);
    link.addEventListener('click', event => { event.preventDefault(); run(event); });
    return link;
  };
  function tileFor({classes, name, label, line, image, imageWide, drawing, svg, also = []}, key, run, id) {
    const tile = el('div', ['tile', ...classes].join(' '));
    const art = el('span', 'art');
    if (svg) art.innerHTML = svg;
    else if (drawing && document.documentElement.hasAttribute('data-look')) {
      // Dark and Light: the index's line drawing replaces the picture (and Cast's wide-screen <source>), as on the web.
      const img = el('img'); img.src = drawing; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      art.append(img); tile.classList.add('lines');
    } else {
      const img = el('img'); img.src = image; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      if (imageWide) { const picture = el('picture'), source = el('source'); source.media = '(min-width: 720px)'; source.srcset = imageWide; picture.append(source, img); art.append(picture); }
      else art.append(img);
    }
    const touch = !matchMedia('(hover: hover)').matches;
    // Touch: the first tap shows the tile's card, the second opens it. Keys, switches and scripts open it at once.
    const go = opener(key, label, event => {
      if (touch && line && event.detail !== 0 && shown !== tile) { hideCard(); shown = tile; tile.classList.add('show'); return; }
      hideCard(); run();
    });
    go.classList.add('go'); if (id) go.id = id;
    const cap = el('span', 'cap', name); cap.setAttribute('aria-hidden', 'true');
    tile.append(art, go, cap);
    if (line) {
      const more = el('span', 'more'), heading = el('span', 'name', name), text = el('span', 'line', line);
      heading.setAttribute('aria-hidden', 'true'); text.id = 'line-' + key.replace(/\W/g, '-'); go.setAttribute('aria-describedby', text.id);
      more.append(heading, text);
      if (also.length) {
        const row = el('span', 'also', 'Also ');
        also.forEach((link, n) => { if (n) row.append(' · '); const a = opener(link.key, link.aria, () => { hideCard(); link.run(); }); a.textContent = link.label; row.append(a); });
        more.append(row);
      }
      tile.append(more);
    }
    // A scripted click on the tile itself (the app shells and capture tools) opens it.
    tile.addEventListener('click', event => { if (event.target === tile) go.click(); });
    return tile;
  }
  function renderLibrary() {
    $('tiles').replaceChildren(); $('access-tiles').replaceChildren(); shown = null;
    const find = (id, mode) => { const game = catalog.find(g => g.id === id); return {game, mode: game?.modes.find(m => m.id === mode)}; };
    const resume = (label, game, mode) => label + (saves[keyFor(game, mode?.id)] ? ' · Resume' : '');
    for (const spec of tiles) {
      // An index tile the package does not carry keeps its place, unseen, so the tiles after it sit on the same ground as on the index.
      if (spec.skip) { const gap = el('span'); gap.hidden = true; gap.dataset.notBundled = spec.skip; $('tiles').append(gap); continue; }
      if (spec.game === 'accessible') {
        $('tiles').append(tileFor(spec, 'accessible', () => { showList('accessible'); $('access-tiles').querySelector('.go')?.focus({preventScroll: true}); }, 'access-open'));
        continue;
      }
      const {game, mode} = find(spec.game, spec.mode);
      const also = spec.also.map(link => { const other = find(link.game, link.mode); return {label: link.label, aria: resume(link.aria, other.game, other.mode), key: keyFor(other.game, other.mode?.id), run: () => launch(other.game, other.mode)}; });
      const tile = tileFor({...spec, label: resume(spec.label, game, mode), also}, keyFor(game, mode?.id), () => launch(game, mode));
      tile.dataset.game = game.id; if (mode) tile.dataset.mode = mode.id;
      tile._set = spec.set || null;
      $('tiles').append(tile);
    }
    for (const game of catalog.filter(accessible)) {
      const tile = tileFor({classes: [game.id], name: game.title, label: resume(game.title, game), image: game.image}, keyFor(game), () => launch(game));
      tile.dataset.game = game.id;
      $('access-tiles').append(tile);
    }
    dressTiles(); markTiles();
  }
  // Signs of life, the Minimal index's own (its styles, colors, set sizes and timings): a game whose every board is
  // finished keeps its tile in one of Slant's colors, and a library that has sat still for ten seconds gets one pass
  // of the same color across its tiles, then another every twenty. Each bundled game keeps its own record under its
  // own namespace (adapters/bootstrap.js); the library only reads it. Color is a reward and a greeting: nothing is
  // told by it alone. Reduced motion, the system's or the library's, stops the shine and keeps the color.
  let life = {onDark: [], onLight: []}, shineTimer = null;
  const lifeTiles = () => [...$('tiles').querySelectorAll('.tile')];
  const finishedCount = value => !value || typeof value !== 'object' ? 0
    : Math.max(...['completed', 'solved', 'finished', 'done'].map(k => Array.isArray(value[k]) ? value[k].length : 0));
  function beaten(game, [name, total]) {
    const prefix = 'lukesteuber.minimal.' + game + ':';
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (!full.startsWith(prefix)) continue;
        const key = full.slice(prefix.length);
        if ((key === name + '.v1' || key.startsWith(name + '.progress.')) && finishedCount(JSON.parse(localStorage.getItem(full))) >= total) return true;
      }
    } catch (_) {}
    return false;
  }
  function dressTiles() {
    const cols = getComputedStyle($('tiles')).gridTemplateColumns.split(' ').length || 1;
    lifeTiles().forEach((tile, i) => {
      const dark = getComputedStyle(tile).backgroundColor === 'rgb(0, 0, 0)', wave = Math.floor(i / cols) + i % cols;
      tile.classList.toggle('on-dark', dark); tile.classList.toggle('on-light', !dark);
      tile.style.setProperty('--win', (dark ? life.onDark : life.onLight)[wave % 4] || 'transparent');
      tile._wave = wave;
    });
  }
  function markTiles() { for (const tile of lifeTiles()) tile.classList.toggle('won', !!tile._set && !!tile.querySelector('.art img') && beaten(tile.dataset.game, tile._set)); }
  const stillLibrary = () => matchMedia('(prefers-reduced-motion: reduce)').matches || settings.motion === 'reduce';
  function shine() {
    if (stillLibrary()) return;
    if (document.hidden || active || $('library').hidden || $('intro') || document.querySelector('dialog[open]')) { waitShine(10000); return; }
    for (const tile of lifeTiles()) {
      if (!tile.querySelector('.art img')) continue;
      setTimeout(() => { tile.classList.add('glint'); setTimeout(() => tile.classList.remove('glint'), 1250); }, tile._wave * 110);
    }
    waitShine(20000);
  }
  function waitShine(ms) { clearTimeout(shineTimer); if (!stillLibrary()) shineTimer = setTimeout(shine, ms); }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'visibilitychange']) addEventListener(type, () => waitShine(10000), {passive: true, capture: true});
  addEventListener('resize', dressTiles);
  waitShine(10000);
  document.addEventListener('click', event => { if (!event.target.closest?.('.tile')) hideCard(); });
  // The opening, the Minimal index's own (its markup, styles and timings): the name, then the eight primitives one at a
  // time in two rows of four, then the name moves up to become the title. It plays the first time the app is opened,
  // at the library, in any theme; Play in Settings shows it again. Never with reduced motion (the system's or the
  // library's Motion setting). Any key, tap, click or switch press skips it, and that press does nothing else. A
  // scripted click (the app shells, the capture tools) ends it at once and goes on. It holds no focus: the tiles stay
  // in the tab order beneath it.
  const opening = {skip: () => false, end: () => {}};
  window.MinimalOpening = opening;
  const OPENING = PREFIX + 'opening', introMarkup = $('intro')?.cloneNode(true);
  function playOpening(again = false) {
    let intro = $('intro');
    let seen = false;
    try { seen = localStorage.getItem(OPENING) === '1'; } catch (_) {}
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches || settings.motion === 'reduce';
    if (active) { intro?.remove(); document.documentElement.classList.remove('opening'); return; } // opened straight into a game: it waits for a launch that opens at the library
    try { localStorage.setItem(OPENING, '1'); } catch (_) {}
    if ((seen && !again) || still) { intro?.remove(); document.documentElement.classList.remove('opening'); return; }
    if (!intro) { if (!introMarkup) { document.documentElement.classList.remove('opening'); return; } intro = introMarkup.cloneNode(true); document.body.prepend(intro); }
    intro.hidden = false;
    document.documentElement.classList.add('opening'); $('library').scrollTop = 0;
    const name = intro.querySelector('p'), words = [...intro.querySelectorAll('li')], timers = [];
    let done = false, clickUntil = 0, heldKey = null;
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const types = ['keydown', 'keyup', 'pointerdown', 'mousedown', 'touchstart', 'click', 'focusin'];
    const remove = () => { types.forEach(type => removeEventListener(type, guard, true)); document.documentElement.classList.remove('opening'); intro.remove(); opening.skip = () => false; };
    // At the end the name moves up into the title's place while the ground and the words fade, then the title
    // takes over (the index's own ending). A press that skips the opening puts it there quickly.
    const finish = (fast = true) => {
      if (done) return false;
      done = true; timers.forEach(clearTimeout);
      const ms = fast === false ? 800 : 220, a = name.getBoundingClientRect(), b = $('masthead-text').getBoundingClientRect();
      const size = element => parseFloat(getComputedStyle(element).fontSize);
      name.style.transformOrigin = '0 0';
      intro.style.setProperty('--land', ms + 'ms');
      intro.classList.add('landing');
      name.style.transform = `translate(${b.left - a.left}px,${b.top - a.top}px) scale(${size($('masthead')) / size(name)})`;
      setTimeout(remove, ms + 40);
      return true;
    };
    const swallow = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    function guard(event) {
      // Automation is not a press: end the opening outright and let the event through.
      if (!event.isTrusted) { done = true; timers.forEach(clearTimeout); remove(); return; }
      if (event.type === 'focusin') { finish(); return; }
      if (event.type === 'keyup') { if (event.code === heldKey) { heldKey = null; swallow(event); } return; }
      if (event.type === 'click') { if (!done || event.timeStamp < clickUntil) { swallow(event); finish(); } return; }
      if (done) return;
      swallow(event);
      if (event.type === 'keydown') heldKey = event.code;
      else clickUntil = event.timeStamp + 800; // the click that follows this press is part of it
      finish();
    }
    types.forEach(type => addEventListener(type, guard, {capture: true, passive: false}));
    opening.skip = finish;
    opening.end = () => { if (!intro.isConnected) return; done = true; timers.forEach(clearTimeout); remove(); };
    // The name arrives and stays; then a word every 500 ms beneath it; the full list rests for 1.8 s, then the tiles.
    requestAnimationFrame(() => name.classList.add('on'));
    words.forEach((li, i) => at(1800 + i * 500, () => li.classList.add('on')));
    at(1800 + words.length * 500 + 1800, () => finish(false));
  }
  // Settings (the gear at the top right): the index's own sheet. Look and Motion are the library's, kept with the
  // collection's preferences; a Look redraws the tiles in it at once. Access writes the collection's shared starting
  // choice, which each game reads until it has a setting of its own. Play shows the opening again.
  const sheet = $('settings'), gear = $('gear'), ACCESS = 'lukesteuber.minimal.shared:minimal-access.v1:default';
  const sharedAccess = () => { try { const value = JSON.parse(localStorage.getItem(ACCESS)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; } };
  function showSettings() {
    MinimalLibraryTheme.apply(settings);
    $('set-look').value = MinimalLibraryTheme.setting(settings); $('set-motion').value = settings.motion === 'reduce' ? 'reduce' : 'system';
    const mode = sharedAccess().mode; $('set-access').value = ['off', 'switch', 'look'].includes(mode) ? mode : 'off';
  }
  showSettings();
  gear.onclick = () => { showSettings(); sheet.showModal(); };
  sheet.addEventListener('close', () => gear.focus({preventScroll: true}));
  sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });
  $('set-look').onchange = () => {
    // A change of look redraws the tiles in it (pictures differ between looks); the opening does not replay.
    if ($('set-look').value === 'system') delete settings.theme; else settings.theme = $('set-look').value;
    write('library', settings); MinimalLibraryTheme.apply(settings);
    if (!active) renderLibrary();
  };
  // While Look follows the phone, a change of the phone's appearance redraws the library in the new look.
  if (window.matchMedia) {
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => { if (MinimalLibraryTheme.setting(settings) !== 'system') return; MinimalLibraryTheme.apply(settings); if (!active) renderLibrary(); };
    if (scheme.addEventListener) scheme.addEventListener('change', follow); else if (scheme.addListener) scheme.addListener(follow);
  }
  $('set-motion').onchange = () => {
    if ($('set-motion').value === 'reduce') settings.motion = 'reduce'; else delete settings.motion;
    write('library', settings); MinimalLibraryTheme.apply(settings); if (settings.motion === 'reduce') opening.end();
  };
  $('set-access').onchange = () => { try { localStorage.setItem(ACCESS, JSON.stringify({...sharedAccess(), mode: $('set-access').value})); } catch (_) {} };
  $('set-opening').onclick = () => { sheet.close(); gear.blur(); playOpening(true); };
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
    opening.end();
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
      // A save made by an earlier build of the game (another source commit) is offered to the game too: its
      // restore checks the state and refuses what it cannot read, and then the game simply starts as new.
      if (saved) { try { await request('restore', saved); if (attempt) attempt.practice = true; } catch (error) { if (saved.source === active.game.commit) notice(error.message); } }
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
      const data=category==='local'?{entries:results.filter(r=>Object.keys(attempt.identity).every(k=>r.identity?.[k]===attempt.identity[k])).reverse().map((r,n)=>({rank:n+1,nickname:r.practice?'Practice':r.assisted?'Assisted':'Unassisted',value:['hits-v1','moves-v1','folds-v1','cleared-v1','depth-v1'].includes(r.identity.scoringPolicy)?r.value:Math.round(r.elapsedMs/1000)+'s'}))}:await api('boards?' + query);
      for (const item of data.entries) { const row = document.createElement('div'); row.className = 'score-row'; for (const value of [item.rank, item.nickname, item.value]) { const span = document.createElement('span'); span.textContent = value; row.append(span); } $('score-list').append(row); }
      if (!data.entries.length) $('score-context').textContent += category==='local'?' · No results yet.':' · No shared scores yet.';
    } catch (error) { $('score-context').textContent = error.message; }
  }
  $('scores-button').onclick=openScores;$('score-category').onchange=showScores;
  $('access-back').onclick=()=>{showList('library');$('access-open')?.focus({preventScroll:true});};
  Promise.all([fetch('catalog.json').then(r => r.json()), fetch('settings.json').then(r => r.ok ? r.json() : {}).catch(() => ({})), fetch('tiles.json').then(r => r.json()), fetch('life.json').then(r => r.ok ? r.json() : null).catch(() => null)]).then(([games, settings, index, colors]) => { catalog = games; tiles = index; if (colors) life = colors;if(typeof settings.apiBase==='string'&&settings.apiBase){const url=new URL(settings.apiBase,location.href);if(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))apiBase=url.href.replace(/\/?$/,'/');} renderLibrary();
    const hash=new URLSearchParams(location.hash.slice(1));
    if(hash.get('view')==='accessible')showList('accessible');
    let selected=hash.get('game');
    if(!selected){try { selected=sessionStorage.getItem(PREFIX+'selected'); } catch(_) {}}
    if(selected){
      const game=catalog.find(g=>g.id===selected||g.modes.some(m=>keyFor(g,m.id)===selected));
      if(game)launch(game,game.modes.find(m=>keyFor(game,m.id)===selected));
      else selectView(null);
    }
    if(!active&&!$('library').hidden)playOpening();else{$('intro')?.remove();document.documentElement.classList.remove('opening');}
  }).catch(() => notice('The library could not load. Please reload.'));
})();
