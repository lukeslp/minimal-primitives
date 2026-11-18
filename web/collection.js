/* The collection never handles keyboard or pointer events inside a game. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PREFIX = 'lukesteuber.minimal.collection.v1:';
  const memory = new Map();
  let noticeTimer;
  const notice = message => { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); };
  // A save the device refuses (storage full, or storage turned off) is said once, quietly, the first time it happens:
  // by the library for its own records, and by a game through its bridge (adapters/bootstrap.js, 'storage').
  let saveWarned = false;
  const warnSave = () => { if (saveWarned) return; saveWarned = true; notice('Could not save on this device. Progress may not be kept.'); };
  const read = (key, fallback) => {
    try {
      const raw=localStorage.getItem(PREFIX+key);if(raw===null)return fallback;
      const value=JSON.parse(raw);
      const valid=key==='profile'?value&&/^[a-f0-9]{64}$/.test(value.secret)&&typeof value.nickname==='string'&&typeof value.sharing==='boolean'&&Array.isArray(value.scores):Array.isArray(fallback)?Array.isArray(value):value&&typeof value==='object'&&!Array.isArray(value);
      if(!valid)throw Error('Invalid collection record');return value;
    } catch (_) { return memory.get(key) ?? fallback; }
  };
  // Returns whether the device stored it. A record it refused is still held for this session (`memory`).
  const write = (key, value) => { memory.set(key, value); try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (_) { warnSave(); return false; } };
  const uuid = () => crypto.randomUUID();
  const secret = () => [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
  const profile = read('profile', null) || { secret: secret(), nickname: '', sharing: false, scores: [] };
  write('profile', profile);
  const saves = read('saves', {}), progress = read('progress', {}), results = read('results', []);
  const ledger=read('attempts',{});
  // The library's own settings: Look (the phone's, Dark, Light, Checkerboard) and Motion. library-theme.js applied them before the first paint.
  const settings=read('library',{});
  let catalog = [], tiles = [], active = null, frame = null, nonce = null, sequence = 0, busy = false, attempt = null;
  let apiBase = '';
  const pending = new Map();
  let currentDocument=null; const seenDocuments=new Set();
  const persist = () => { const stored = write('saves', saves); write('progress', progress); return stored; };
  // A save a game refused is set aside under `refused` before anything may take its place. On a device with no room
  // for the copy, the save itself is the only one there is: `held` names its game, and while it is held nothing
  // writes over it (not a move, not Home, not closing the app). Each time a save would be made the copy is tried
  // again, so play is saved as before once there is room.
  const held = new Map();
  function setAside(key, saved, by) {
    const refused = read('refused', {}); refused[key] = { ...saved, refusedAt: Date.now(), by };
    if (write('refused', refused)) { held.delete(key); return true; }
    held.set(key, { saved, by }); return false;
  }
  // Whether a new save for this game may be written now.
  const free = key => !held.has(key) || setAside(key, held.get(key).saved, held.get(key).by);
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
      tile._set = spec.set || null; tile._pictures = spec.solved || null;
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
  // A finished game whose solved board is in color shows that board instead of the one color: a picture bundled with
  // the app (tiles.json `solved`, the index's own captures), read from the package and never from the network.
  let life = {onDark: [], onLight: []}, shineTimer = null;
  const lifeTiles = () => [...$('tiles').querySelectorAll('.tile')];
  // A tile is finished when every id of its game's current main campaign is in that game's own record: the index's
  // set is [storage key, field, campaign ids], read from the games (luke-portfolio minimal/campaigns.cjs). Most games
  // keep a list of finished ids; Notan keeps a map of board to best time. Boards outside the campaign (optional, New
  // Game+, boards a campaign has dropped) and repeats never make up for a missing one.
  const finishedIds = (value, field) => {
    const list = value && typeof value === 'object' ? value[field] : null;
    return Array.isArray(list) ? list.filter(id => typeof id === 'string')
      : list && typeof list === 'object' ? Object.keys(list).filter(id => typeof list[id] === 'number') : [];
  };
  function beaten(game, [key, field, ids]) {
    try {
      const raw = localStorage.getItem('lukesteuber.minimal.' + game + ':' + key); if (raw === null) return false;
      const done = new Set(finishedIds(JSON.parse(raw), field));
      return ids.length > 0 && ids.every(id => done.has(id));
    } catch (_) { return false; }
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
  // The index's own picture(): the solved picture goes in for a finished tile and comes out again if the tile stops
  // being finished. Nothing is read for a tile that is not finished. The tile changes its dress (.solved) only once
  // the picture has arrived; one that cannot be had leaves the one-color mark. The fade-in is the index's, and its
  // stylesheet drops it under reduced motion, the system's or the library's.
  function picture(tile) {
    const img = tile.querySelector('.art img'); if (!img) return;
    const set = !tile._broken && tile.classList.contains('won') && tile._pictures;
    const src = set ? set[tile.classList.contains('on-light') ? 'light' : 'dark'] : null;
    if ((tile._solved || null) === src) return;
    tile._solved = src;
    if (!src) {
      tile.classList.remove('pictured', 'solved'); tile.style.removeProperty('--fill');
      tile._plain.sources.forEach(source => img.before(source));
      img.setAttribute('src', tile._plain.src);
      return;
    }
    if (!tile._plain) {
      tile._plain = {src: img.getAttribute('src'), sources: [...tile.querySelectorAll('.art source')]};
      img.addEventListener('load', () => { if (tile._solved && img.getAttribute('src') === tile._solved) { tile.style.setProperty('--fill', tile._pictures.fill); tile.classList.add('solved'); } });
      img.addEventListener('error', () => { if (tile._solved && img.getAttribute('src') === tile._solved) { tile._broken = true; picture(tile); } });
    }
    tile.classList.add('pictured');
    tile._plain.sources.forEach(source => source.remove());
    img.setAttribute('src', src);
  }
  function markTiles() {
    for (const tile of lifeTiles()) {
      const won = !!tile._set && !!tile.querySelector('.art img') && beaten(tile.dataset.game, tile._set);
      tile.classList.toggle('won', won); picture(tile);
      // As on the index: the card's line says it in words (the link is described by that line); the corner check is CSS.
      const line = tile.querySelector('.more .line'); let done = line?.querySelector('.done');
      if (won && line && !done) { done = document.createElement('span'); done.className = 'done'; done.textContent = ' All boards finished.'; line.append(done); }
      if (!won && done) done.remove();
    }
  }
  const stillLibrary = () => matchMedia('(prefers-reduced-motion: reduce)').matches || settings.motion === 'reduce';
  let shinePass = [];
  // Reduced motion asked for while a pass is under way: drop what is queued and clear what is lit.
  function haltShine() { shinePass.forEach(clearTimeout); shinePass = []; for (const tile of lifeTiles()) tile.classList.remove('glint'); }
  function shine() {
    if (stillLibrary()) { haltShine(); return; }
    if (document.hidden || active || $('library').hidden || $('intro') || document.querySelector('dialog[open]')) { waitShine(10000); return; }
    shinePass = [];
    for (const tile of lifeTiles()) {
      if (!tile.querySelector('.art img')) continue;
      shinePass.push(setTimeout(() => { if (stillLibrary()) return; tile.classList.add('glint'); shinePass.push(setTimeout(() => tile.classList.remove('glint'), 1250)); }, tile._wave * 110));
    }
    waitShine(20000);
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { if (stillLibrary()) { clearTimeout(shineTimer); haltShine(); } else waitShine(10000); });
  function waitShine(ms) { clearTimeout(shineTimer); if (!stillLibrary()) shineTimer = setTimeout(shine, ms); }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'visibilitychange']) addEventListener(type, () => waitShine(10000), {passive: true, capture: true});
  // A tile can change ground when the columns change, and its solved picture with it.
  addEventListener('resize', () => { dressTiles(); lifeTiles().forEach(picture); });
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
    const remove = () => { types.forEach(type => removeEventListener(type, guard, true)); document.documentElement.classList.remove('opening'); intro.remove(); opening.skip = () => false; waitShine(10000); };
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
    if (stillLibrary()) { clearTimeout(shineTimer); haltShine(); } else waitShine(10000);
    write('library', settings); MinimalLibraryTheme.apply(settings); if (settings.motion === 'reduce') opening.end();
  };
  $('set-access').onchange = () => { try { localStorage.setItem(ACCESS, JSON.stringify({...sharedAccess(), mode: $('set-access').value})); } catch (_) {} };
  $('set-opening').onclick = () => { sheet.close(); gear.blur(); playOpening(true); };
  // Privacy: a row in Settings, above About, that opens the page bundled with the app (privacy.html) in a sheet of
  // the same kind, on top of Settings. The Settings markup is the index's own, so the row is added here. The sheet
  // shows the page's own text; if that cannot be read, the row opens the page itself.
  const privacy = $('privacy');
  if (privacy) {
    const body = sheet.querySelector('.sheet-body'), heading = el('h3', 'group', 'Privacy'), row = el('div', 'row'), button = el('button', '', 'Read');
    button.type = 'button'; button.id = 'set-privacy'; button.setAttribute('aria-label', 'Read the privacy policy'); button.setAttribute('aria-haspopup', 'dialog');
    row.append(el('span', '', 'Privacy policy'), button);
    const about = [...body.querySelectorAll('h3.group')].find(node => node.textContent.trim() === 'About');
    if (about) about.before(heading, row); else body.append(heading, row);
    let loaded = false;
    button.onclick = async () => {
      if (!loaded) {
        try {
          const response = await fetch('privacy.html'); if (!response.ok) throw Error('Missing page');
          const main = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector('main');
          // The sheet has its own title and Close; the page's section headings sit one level under the title.
          const parts = [...main.children].filter(node => !node.matches('h1,.page-only')).map(node => {
            if (node.tagName !== 'H2') return document.importNode(node, true);
            const section = el('h3', node.className, node.textContent); return section;
          });
          $('privacy-body').replaceChildren(...parts); loaded = true;
        } catch (_) { location.href = 'privacy.html'; return; }
      }
      privacy.showModal(); $('privacy-body').scrollTop = 0;
    };
    privacy.addEventListener('click', event => { if (event.target === privacy) privacy.close(); });
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
    if (free(active.key)) { saves[active.key] = { source: data.source, state: data.state, mode: active.mode?.id, savedAt: Date.now() }; persist(); }
    if (attempt) attempt.practice = true;
  }
  // A game frame that has not reported ready after eight seconds (a page that failed to load, or one whose own Home
  // never arrived) gets the collection's own way Home, over the frame. It goes when the game reports ready.
  let stallTimer;
  const stalled = shown => { clearTimeout(stallTimer); $('stalled').hidden = !shown; };
  $('stalled-home').onclick = async () => { const key = active?.key; await library(); document.querySelector(`#tiles [data-open="${key}"], #access-tiles [data-open="${key}"]`)?.focus({preventScroll: true}); };
  function close() {
    const list = active && accessible(active.game) ? 'accessible' : 'library';
    stalled(false); $('unsaved').hidden = true;
    frame?.remove(); frame = null; active = null; attempt = null;
    $('player').hidden = true; renderLibrary(); showList(list);
  }
  async function library() {
    if (busy) return;
    busy = true;
    try { await stash(); close(); }
    catch (error) { notice(error.message); }
    finally { busy = false; }
  }
  // The app shell's way out of a game whose own Home did not bring the library (Android's Back, some seconds after it
  // pressed Home, or at once in a page that cannot answer). It never discards a board: the board is taken from the
  // game as it stands, without waiting on it, and the library shows only once the device has stored it. A page with
  // nothing of the collection's to save (no resume adapter in it, or a save still waiting to be restored) is simply
  // left. Where the board cannot be saved, the player is asked, over the game: Leave anyway, or Keep playing.
  // `opened` is the handshake of the game the shell means; another game, or none, is left alone.
  function leave(opened) {
    if (!frame || !active || (opened && opened !== nonce)) return 'library';
    if (busy) return 'busy';
    let adapter = null;
    try { adapter = frame.contentWindow.MinimalAdapter || null; } catch (_) {}
    if (!adapter || active.restorePending) { close(); return 'left'; }
    try {
      const state = adapter.checkpoint();
      if (state && free(active.key)) {
        saves[active.key] = { source: active.game.commit, state, mode: active.mode?.id, savedAt: Date.now() };
        if (persist()) { close(); return 'saved'; }
      }
    } catch (_) {}
    $('unsaved').hidden = false; $('unsaved-stay').focus({preventScroll: true});
    return 'asked';
  }
  $('unsaved-leave').onclick = () => { const key = active?.key; close(); document.querySelector(`#tiles [data-open="${key}"], #access-tiles [data-open="${key}"]`)?.focus({preventScroll: true}); };
  $('unsaved-stay').onclick = () => { $('unsaved').hidden = true; frame?.contentWindow.focus(); };
  window.MinimalLibrary = { leave };
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
      stalled(false); $('unsaved').hidden = true; const opened = active; stallTimer = setTimeout(() => { if (active === opened && !opened.ready) stalled(true); }, 8000);
    } catch (error) { notice(error.message); }
    finally { busy = false; }
  }
  async function api(path, options = {}) {
    if (!apiBase) throw new Error('Scores stay on this device.');
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
    notice(apiBase ? 'Score saved on this device. Online sharing was unavailable.' : 'Score saved on this device.');
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
      const context={api,profile,persistProfile:()=>{write('profile',profile);renderLibrary();},get attempt(){return attempt;},get active(){return active;},get service(){return !!apiBase;},get results(){return results;}};
      try{const result=await MinimalScoresTransport.handle(data.payload,context);target.postMessage({v:1,nonce:requestNonce,type:'scores-response',payload:{request:data.payload.request,result}},location.origin);}
      catch(error){target.postMessage({v:1,nonce:requestNonce,type:'scores-response',payload:{request:data.payload.request,error:error.message}},location.origin);}
      return;
    }
    const waiting = pending.get(data.payload?.request);
    if (waiting) { clearTimeout(waiting.timeout); pending.delete(data.payload.request); if (data.type === 'error') waiting.reject(new Error(data.payload.message)); else waiting.resolve(data.payload); }
    if (data.type === 'ready') {
      active.ready = true; stalled(false);
      active.resumable = !!data.payload.resumable;
      const saved = active.restorePending&&data.payload.resumable?active.initialSave:null;
      if(data.payload.resumable)active.restorePending=false;
      // A save made by an earlier build of the game (another source commit) is offered to the game too: its
      // restore checks the state and refuses what it cannot read. A refused save is never lost, whichever build
      // made it (an update does not move every game to a new commit, and a save can be damaged in this one): it is
      // kept under `refused`, out of the way of the new board that the next move or Home will save in its place,
      // and the player is told.
      const opened = active;
      if (saved) { try { await request('restore', saved); if (attempt) attempt.practice = true; } catch (error) {
        const which = saved.source === opened.game.commit ? 'A saved board' : 'A board saved by an earlier version';
        if (setAside(opened.key, saved, opened.game.commit)) notice(which + ' could not be opened. It has been kept, and this game starts new.');
        else notice(which + ' could not be opened, and this device has no room to set it aside. It is left as it was, and new moves in this game are not saved for now.');
      } }
      frame?.contentWindow.focus();
    } else if (data.type === 'library') library();
    else if (data.type === 'scores') openScores();
    else if (data.type === 'storage') warnSave();
    else if (data.type === 'share-failed') notice('The picture could not be shared. Try again.');
    else if (data.type === 'open') openAttempt(data.payload,data.attempt);
    else if (data.type === 'assist') { if (attempt){attempt.assisted=true;ledger[attempt.key]={finished:!!attempt.finished,assisted:true};write('attempts',ledger);} }
    else if (data.type === 'restart') { if(attempt)openAttempt({identity:attempt.identity,repeat:true,assisted:attempt.assisted},data.attempt,true); }
    else if (data.type === 'interrupted') { if (attempt) attempt.practice = true; }
    else if (data.type === 'complete' && data.attempt === attempt?.remote) {const token=attempt;token.completion=complete(data.payload);}
    else if (data.type === 'commit' && !active.restorePending && data.payload.snapshot && free(active.key)) { saves[active.key] = { source: active.game.commit, state: data.payload.snapshot, savedAt: Date.now() }; persist(); }
  });
  window.addEventListener('pagehide',()=>{
    if(!frame||!active||active.restorePending)return;
    try {
      const state=frame.contentWindow.MinimalAdapter?.checkpoint();
      if(state&&free(active.key)){saves[active.key]={source:active.game.commit,state,mode:active.mode?.id,savedAt:Date.now()};persist();}
    } catch(_) {}
  });
  window.addEventListener('offline', () => { if (attempt) attempt.practice = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && attempt) attempt.practice = true; });
  function openScores() {
    // With no score service (every app build, and the default ZIP) nothing can be shared: say so and leave the
    // nickname and sharing controls out, so a ticked box never suggests scores went online.
    $('scores-local').hidden = !!apiBase; document.querySelector('#scores .sharing').hidden = !apiBase;
    // The picker chooses among shared boards and this device's own list. Without a service only the device's list
    // exists, and at the library (no board open) the sheet lists recent results instead: no picker in either case.
    if (!apiBase) $('score-category').value = 'local';
    $('score-category').hidden = !apiBase || !attempt?.identity;
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
  // What a result was scored by, in words: the count for the games that count, the time for the rest.
  const COUNTS = {'hits-v1': ['hit', 'hits'], 'moves-v1': ['move', 'moves'], 'folds-v1': ['fold', 'folds'], 'cleared-v1': ['cleared', 'cleared']};
  const scored = result => {
    const policy = result.identity?.scoringPolicy;
    if (policy === 'depth-v1' && Number.isFinite(result.value)) return 'depth ' + result.value;
    if (COUNTS[policy] && Number.isFinite(result.value)) return result.value + ' ' + COUNTS[policy][result.value === 1 ? 0 : 1];
    return Math.round(result.elapsedMs / 1000) + 's';
  };
  // At the library no board is open, so the sheet shows the last few boards finished on this device, across games,
  // newest first. They are the collection's own records (`results`), which never leave the device.
  function showRecent() {
    const recent = results.filter(r => r && r.identity && Number.isFinite(r.elapsedMs)).map(r => ({result: r, game: catalog.find(g => g.id === r.identity.game)})).filter(r => r.game).slice(-8).reverse();
    $('score-context').textContent = recent.length ? 'Recently finished on this device' : 'No finished boards yet. Finish one and it is listed here.';
    for (const {result, game} of recent) {
      const row = el('div', 'score-row recent');
      row.append(el('span', '', game.title), el('span', '', String(result.identity.puzzleId)), el('span', '', scored(result)));
      $('score-list').append(row);
    }
  }
  async function showScores() {
    $('score-list').replaceChildren();
    if (!attempt?.identity) { showRecent(); return; }
    $('score-context').textContent = `${active.game.title} · ${attempt.identity.puzzleId}`;
    try {
      const category=$('score-category').value;
      const query = new URLSearchParams({ ...attempt.identity, category });
      const data=category==='local'?{entries:results.filter(r=>Object.keys(attempt.identity).every(k=>r.identity?.[k]===attempt.identity[k])).reverse().map((r,n)=>({rank:n+1,nickname:apiBase&&r.practice?'Practice':r.assisted?'Assisted':'Unassisted',value:['hits-v1','moves-v1','folds-v1','cleared-v1','depth-v1'].includes(r.identity.scoringPolicy)?r.value:Math.round(r.elapsedMs/1000)+'s'}))}:await api('boards?' + query);
      for (const item of data.entries) { const row = document.createElement('div'); row.className = 'score-row'; for (const value of [item.rank, item.nickname, item.value]) { const span = document.createElement('span'); span.textContent = value; row.append(span); } $('score-list').append(row); }
      if (!data.entries.length) $('score-context').textContent += category==='local'?' · No results yet.':' · No shared scores yet.';
    } catch (error) { $('score-context').textContent = error.message; }
  }
  $('scores-button').onclick=openScores;$('score-category').onchange=showScores;
  $('access-back').onclick=()=>{showList('library');$('access-open')?.focus({preventScroll:true});};
  // The library's data. If it cannot be read the opening's ground must not stay up over an empty page: the opening is
  // cleared, and a message stays with a Retry button until a load works.
  const load = () => Promise.all([fetch('catalog.json').then(r => r.json()), fetch('settings.json').then(r => r.ok ? r.json() : {}).catch(() => ({})), fetch('tiles.json').then(r => r.json()), fetch('life.json').then(r => r.ok ? r.json() : null).catch(() => null)]).then(([games, settings, index, colors]) => { catalog = games; tiles = index; if (colors) life = colors;if(typeof settings.apiBase==='string'&&settings.apiBase){const url=new URL(settings.apiBase,location.href);if(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))apiBase=url.href.replace(/\/?$/,'/');} renderLibrary();
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
    $('load-failed').hidden = true;
  }).catch(() => {
    opening.end(); $('intro')?.remove(); document.documentElement.classList.remove('opening');
    catalog = []; tiles = []; $('tiles').replaceChildren(); $('access-tiles').replaceChildren();
    $('load-failed').hidden = false;
  });
  let loading = load().finally(() => { loading = null; });
  $('load-retry').onclick = () => { if (!loading) loading = load().finally(() => { loading = null; }); };
})();
