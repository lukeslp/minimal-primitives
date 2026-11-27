/* Balance: the page. Rules live in engine.js; only Hint reads the answer, to pick a mark to change. */
(function () {
  'use strict';
  const E = Balance, G = BalanceEndless, L = BalanceLevels, $ = s => document.querySelector(s);
  const K = { current: 'balance.current.v1', progress: 'balance.progress.v1', settings: 'balance.settings.v1', opening: 'balance.opening.v1', generated: 'balance.generated.v1', plus: 'balance.plus.v1' };
  const campaign = L.campaign, opening = L.opening, TOTAL = campaign.length;
  const ids = new Set(campaign.map(p => p.id));
  let gen = null, genPuzzle = null;
  const board = id => id === 'generated' ? genPuzzle : campaign.find(p => p.id === id) || opening.find(p => p.id === id);
  const openingAt = id => opening.findIndex(p => p.id === id);
  const campaignAt = id => campaign.findIndex(p => p.id === id);

  // ---- storage: a save that cannot be read is copied aside, never overwritten ----
  const blocked = new Set();
  let notice = '';
  function read(key, validate, otherwise) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (_) { blocked.add(key); return otherwise; }
    if (raw === null) return otherwise;
    try {
      const value = JSON.parse(raw);
      if (!validate(value)) throw Error('invalid');
      return value;
    } catch (_) {
      try { localStorage.setItem(key + '.recovery.' + Date.now(), raw); notice = 'An unreadable save was kept aside.'; }
      catch (_) { blocked.add(key); }
      return otherwise;
    }
  }
  function write(key, value) {
    if (blocked.has(key)) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { blocked.add(key); }
  }
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  const progress = read(K.progress, v => plain(v) && v.version === 1 && Array.isArray(v.completed) && v.completed.every(id => ids.has(id)) && new Set(v.completed).size === v.completed.length, { version: 1, completed: [] });
  const allDone = () => campaign.every(p => progress.completed.includes(p.id));
  const ENDING = 'All ' + TOTAL + ' boards solved.';
  const prefs = read(K.settings, v => plain(v) && v.version === 1 && ['system', 'light', 'dark'].includes(v.theme) && ['system', 'reduce'].includes(v.motion), { version: 1, theme: 'system', motion: 'system' });
  const store = read(K.current, v => plain(v) && v.version === 1 && ids.has(v.at) && plain(v.boards) && Object.values(v.boards).every(Array.isArray), { version: 1, at: campaign[0].id, boards: {} });
  // Marks saved on a board whose givens have since changed no longer fit it; they are dropped, the rest kept.
  for (const id of Object.keys(store.boards)) if (!ids.has(id) || !E.stateValid(board(id), store.boards[id])) delete store.boards[id];

  // The generator version belongs to this new key; campaign keys retain their exact old shapes.
  gen = read(K.generated, v => {
    if (!plain(v) || Object.keys(v).length !== 5 || v.version !== 1 || typeof v.playing !== 'boolean') return false;
    const p = G.fromSeed(v.seed, v.n);
    if (!p || !E.stateValid(p, v.marks)) return false;
    genPuzzle = p;
    return true;
  }, null);
  const plus = read(K.plus, v => plain(v) && Object.keys(v).length === 3 && v.version === 1 && Number.isSafeInteger(v.wins) && v.wins >= 0 && typeof v.held === 'string' && v.held.length <= 96, { version: 1, wins: 0, held: '' });
  const solvedCount = () => progress.completed.length + (plus.wins ? ' + ' + plus.wins : '') + ' ✓';
  function countPlus() {
    if (at !== 'generated' || !allDone()) return;
    const key = G.identity(genPuzzle);
    if (plus.held === key) return;
    plus.held = key; plus.wins++; write(K.plus, plus);
  }
  const resumeAt = () => gen && gen.playing ? 'generated' : store.at;
  const cellsOf = id => (id === 'generated' ? gen.marks : store.boards[id]) || E.start(board(id));

  const query = new URLSearchParams(location.search);
  let firstVisit = false;
  try { firstVisit = localStorage.getItem(K.opening) === null; } catch (_) {}
  let at = firstVisit ? opening[0].id : resumeAt();
  if (query.has('level')) {
    const n = Number(query.get('level'));
    if (Number.isInteger(n) && n >= 1 && n <= TOTAL) at = campaign[n - 1].id;
  }
  let puzzle = board(at);
  const S = { cells: cellsOf(at).slice(), undo: [], focus: 0, hint: null, solved: false, keyboard: false, refused: -1 };

  // ---- icons ----
  const paths = { reset: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', replay: 'M4 11V9a3 3 0 0 1 3-3h12m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H5m3 3-3-3 3-3', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2' };
  for (const [id, name] of [['restart-btn', 'reset'], ['undo-btn', 'undo'], ['hint-btn', 'hint'], ['next-btn', 'next'], ['settings-btn', 'settings'], ['help-btn', 'help']]) {
    $('#' + id).innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
  }
  const root = $('#board'), marks = document.createElement('div');
  marks.className = 'marks';
  marks.setAttribute('aria-hidden', 'true');
  root.after(marks);
  // The status line. A hint is shown with "this square" and "the dashed squares", which point at what is
  // drawn; read aloud it names the squares by row and column instead (engine.js, `spoken`).
  function say(text, spoken) {
    const line = $('#feedback');
    if (!spoken || spoken === text) { line.textContent = text; return; }
    const shown = document.createElement('span'), aloud = document.createElement('span');
    shown.setAttribute('aria-hidden', 'true');
    shown.textContent = text;
    aloud.className = 'sr-only';
    aloud.textContent = spoken;
    line.replaceChildren(shown, aloud);
  }

  // ---- drawing ----
  function build() {
    const n = puzzle.n;
    root.replaceChildren();
    root.setAttribute('aria-rowcount', n);
    root.setAttribute('aria-colcount', n);
    for (let r = 0; r < n; r++) {
      const row = document.createElement('div');
      row.className = 'grid-row';
      row.setAttribute('role', 'row');
      for (let c = 0; c < n; c++) {
        const cell = document.createElement('div'), i = r * n + c;
        cell.className = 'cell ' + 'ebw'[S.cells[i]];
        cell.dataset.i = i;
        cell.setAttribute('role', 'gridcell');
        if (puzzle.givens[i]) cell.setAttribute('aria-readonly', 'true');
        cell.addEventListener('focus', () => { if (S.focus !== i) { S.focus = i; render(); } });
        row.append(cell);
      }
      root.append(row);
    }
    fit();
  }
  /* The solved board in color: each group of black squares joined edge to edge takes one of four
     colors, never the color of a group it touches (corners count) while one is free. Decoration only. */
  function colors() {
    const n = puzzle.n, group = Array(n * n).fill(-1), near = [];
    let count = 0;
    for (let i = 0; i < n * n; i++) {
      if (S.cells[i] !== 1 || group[i] >= 0) continue;
      const stack = [i]; group[i] = count;
      while (stack.length) {
        const a = stack.pop(), r = Math.floor(a / n), c = a % n;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr, cc = c + dc, b = rr * n + cc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && S.cells[b] === 1 && group[b] < 0) { group[b] = count; stack.push(b); }
        }
      }
      near.push(new Set()); count++;
    }
    for (let i = 0; i < n * n; i++) {
      if (group[i] < 0) continue;
      const r = Math.floor(i / n), c = i % n;
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [0, 2]]) {
        const rr = r + dr, cc = c + dc, b = rr * n + cc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && group[b] >= 0 && group[b] !== group[i]) { near[group[i]].add(group[b]); near[group[b]].add(group[i]); }
      }
    }
    const of = Array(count).fill(-1);
    for (let g = 0; g < count; g++) {
      const used = new Set([...near[g]].map(h => of[h]));
      let k = g % 4;
      for (let t = 0; t < 4 && used.has(k); t++) k = (k + 1) % 4;
      of[g] = k;
    }
    return group.map(g => g < 0 ? -1 : of[g]);
  }

  function render() {
    const n = puzzle.n, v = E.inspect(puzzle, S.cells);
    const runH = new Set(), runV = new Set(), runLines = new Set();
    for (const run of v.runs) {
      for (const i of run.cells) (run.kind === 'row' ? runH : runV).add(i);
      runLines.add(run.kind + (run.kind === 'row' ? Math.floor(run.cells[0] / n) : run.cells[0] % n));
    }
    // A line that breaks a rule is marked at its end, outside the board, and nothing is drawn over the
    // squares: it holds three alike in a row, or it cannot balance (full with unequal counts, or holding
    // more than half of one shade before it is full). One mark per line, whichever rule it breaks.
    const uneven = puzzle.runsOnly ? [] : [...v.uneven, ...v.crowded].filter(u => !runLines.has(u.kind + u.index));
    // A tried-shade Hint marks the line its chain would break the same way, at its end.
    const ahead = S.hint && S.hint.lines ? S.hint.lines.map(u => u.kind + u.index) : [];
    const broken = [...new Set([...runLines, ...uneven.map(u => u.kind + u.index), ...ahead])].map(k => ({ kind: k.startsWith('row') ? 'row' : 'column', index: Number(k.replace(/^\D+/, '')) }));
    const unevenRows = new Set(uneven.filter(u => u.kind === 'row').map(u => u.index));
    const unevenCols = new Set(uneven.filter(u => u.kind === 'column').map(u => u.index));
    const evidence = new Set(S.hint ? S.hint.support : []);
    const target = S.hint && !S.hint.fault ? S.hint.i : -1;
    root.classList.toggle('solved', S.solved);
    const tint = S.solved ? colors() : null;
    // The page takes color too: whichever of the four the board has least of, so all four are in the
    // picture. A tie is settled by the board itself, so the same board always gets the same page.
    if (tint) {
      const used = [0, 0, 0, 0]; let sum = 0;
      tint.forEach((k, i) => { if (k >= 0) { used[k]++; sum += i; } });
      const least = Math.min(...used), ties = used.map((u, k) => u === least ? k : -1).filter(k => k >= 0);
      document.documentElement.dataset.field = ties[sum % ties.length];
    } else delete document.documentElement.dataset.field;
    root.querySelectorAll('.cell').forEach((cell, i) => {
      const value = S.cells[i], given = puzzle.givens[i] !== 0, r = Math.floor(i / n), c = i % n;
      if (tint && tint[i] >= 0) { cell.dataset.k = tint[i]; cell.style.setProperty('--d', (r + c) * 40 + 'ms'); } else delete cell.dataset.k;
      cell.className = 'cell ' + 'ebw'[value] + (given ? ' given' : '') + (runH.has(i) ? ' run-h' : '') + (runV.has(i) ? ' run-v' : '') +
        (evidence.has(i) ? ' evidence' : '') + (i === target ? ' hint-target' : '') + (i === S.refused ? ' refuse' : '');
      cell.tabIndex = i === S.focus ? 0 : -1;
      cell.setAttribute('aria-selected', String(i === S.focus));
      cell.setAttribute('aria-label', 'Row ' + (r + 1) + ', column ' + (c + 1) + ': ' + E.NAME[value] + (given ? ', fixed' : '') +
        (runH.has(i) || runV.has(i) ? ', three alike in a row' : '') + (unevenRows.has(r) ? ', row uneven' : '') + (unevenCols.has(c) ? ', column uneven' : '') +
        (evidence.has(i) ? ', dashed' : '') + (i === target ? ', hint' : ''));
    });
    marks.replaceChildren(...broken.map(u => {
      const mark = document.createElement('i');
      mark.className = 'end-' + u.kind + (ahead.includes(u.kind + u.index) ? ' ahead' : '');
      mark.style[u.kind === 'row' ? 'top' : 'left'] = 'calc(var(--cell) * ' + (u.index + 0.5) + ' - 5px)';
      return mark;
    }));
    const k = campaignAt(at);
    $('#readout').textContent = at === 'generated' ? puzzle.n + ' × ' + puzzle.n + ' · ' + solvedCount() : k < 0 ? '' : (k + 1) + ' / ' + TOTAL + ' · ' + solvedCount();
    $('#undo-btn').disabled = !S.undo.length;
    $('#completion').hidden = !S.solved;
    // Next stays on the page: after the last campaign board it starts New Game+, then deals again.
    const ended = S.solved && k >= 0 && allDone(), fresh = S.solved && nextTarget() === 'new', next = $('#next-btn');
    $('#ending').hidden = !ended; $('#ending').textContent = ended ? ENDING : '';
    next.hidden = !S.solved;
    next.setAttribute('aria-label', fresh ? (at === 'generated' ? 'Next board' : 'Start New Game+') : 'Next puzzle');
    $('#feedback').classList.toggle('sr-only', S.solved && !generationFailed);
    $('#free-row').hidden = !allDone();
    $('#free-label').textContent = 'Endless · ' + plus.wins + ' ✓';
    $('#plus-locked').hidden = allDone();
    $('#plus-locked').textContent = 'Complete all ' + TOTAL + ' to unlock New Game+.';
    $('#previous').disabled = k <= 0;
    $('#following').disabled = k < 0 || k === TOTAL - 1;
    $('#replay-opening').textContent = replaying && openingAt(at) >= 0 ? (resumeAt() === 'generated' ? 'Back to New Game+' : 'Back to board ' + (campaignAt(store.at) + 1)) : REPLAY;
  }
  function fit() {
    const shell = $('#board-shell'), n = puzzle.n;
    const cell = Math.floor(Math.min(88, (shell.clientWidth - 24) / n, (shell.clientHeight - 14) / n));
    $('.board-stage').style.setProperty('--cell', Math.max(16, cell) + 'px');
  }
  function focusCell(i, dom) {
    S.focus = i;
    render();
    if (dom) root.querySelectorAll('.cell')[i].focus({ preventScroll: true });
  }

  // ---- play ----
  function save() {
    if (openingAt(at) >= 0) return;
    if (at === 'generated') { gen.marks = S.cells.slice(); gen.playing = true; write(K.generated, gen); return; }
    if (gen && gen.playing) { gen.playing = false; write(K.generated, gen); }
    store.at = at;
    store.boards[at] = S.cells.slice();
    write(K.current, store);
    write(K.progress, progress);
  }
  // Solved means: full, and neither rule broken. No stored answer is involved.
  function judge(announce) {
    const was = S.solved;
    S.solved = E.inspect(puzzle, S.cells).solved;
    if (S.solved && !was) {
      if (announce) countPlus();
      if (ids.has(at) && !progress.completed.includes(at)) progress.completed.push(at);
      if (announce) say(ids.has(at) && allDone() ? ENDING : 'Solved.');
    }
  }
  function commit(before, text) {
    generationFailed = false;
    if (before.some((v, i) => v !== S.cells[i])) S.undo.push(before);
    S.hint = null;
    say(text || '');
    judge(true);
    render();
    save();
  }
  // A tapped given refuses on the board as well as in words: brackets on its corners for a moment, and a
  // shake unless motion is reduced. Tapping it again starts the cue over.
  let refuseTimer = 0;
  function refuse(i) {
    const cell = root.querySelectorAll('.cell')[i];
    if (S.refused === i && cell) { cell.classList.remove('refuse'); void cell.offsetWidth; }
    S.refused = i;
    clearTimeout(refuseTimer);
    refuseTimer = setTimeout(() => { S.refused = -1; render(); }, 700);
  }
  function act(i) {
    if (S.solved) return;
    if (puzzle.givens[i]) { S.hint = null; refuse(i); say('That square is fixed.'); render(); return; }
    const before = S.cells.slice();
    S.cells[i] = (S.cells[i] + 1) % 3;
    commit(before);
  }
  function undo() {
    const before = S.undo.pop();
    if (!before) return;
    S.cells = before;
    S.hint = null;
    say('');
    S.solved = false;
    judge(false);
    render();
    save();
  }
  function restart() {
    const before = S.cells.slice();
    S.cells = E.start(puzzle);
    S.solved = false;
    commit(before, 'Board cleared. Undo brings it back.');
  }
  function hint() {
    if (S.solved) { say('Nothing left to find.'); return; }
    if (S.hint && !S.hint.fault) {
      const m = S.hint, before = S.cells.slice();
      S.cells[m.i] = m.value;
      commit(before);
      return;
    }
    // On a board with a mistake (a broken rule, a dead end, or a step the answer does not take) Hint rings a
    // mark to change instead, so the second press always moves toward the answer.
    let m = E.next(puzzle, S.cells);
    if (!m || m.fault || m.value !== (E.answer(puzzle) || [])[m.i]) m = E.fix(puzzle, S.cells, m, recent()) || m;
    if (!m) { say('Nothing to deduce from these marks.'); return; }
    S.hint = m;
    say(m.text, m.spoken);
    render();
  }
  // Squares in the order they last changed, newest first, from the undo history.
  function recent() {
    const out = [];
    for (let k = S.undo.length - 1, now = S.cells; k >= 0; now = S.undo[k], k--) {
      S.undo[k].forEach((v, i) => { if (v !== now[i] && !out.includes(i)) out.push(i); });
    }
    return out;
  }
  function switchBoard(id, alreadySaved) {
    if (!alreadySaved) save();
    generationFailed = false;
    at = id;
    puzzle = board(id);
    if (openingAt(id) < 0) replaying = false;
    S.cells = cellsOf(id).slice();
    S.undo = [];
    S.focus = 0;
    S.hint = null;
    S.solved = false;
    S.keyboard = false;
    S.refused = -1;
    say('');
    judge(false);
    build();
    render();
    save();
    if (location.search) history.replaceState(null, '', location.pathname);
  }
  // Help's replay button takes a player back from the opening boards it brought them to.
  let replaying = false;
  const REPLAY = 'Play the opening boards again';
  function nextTarget() {
    const o = openingAt(at), k = campaignAt(at);
    if (o >= 0) return o < opening.length - 1 ? opening[o + 1].id : resumeAt();
    if (k >= 0 && k < TOTAL - 1) return campaign[k + 1].id;
    const open = campaign.find(p => !progress.completed.includes(p.id));
    return open ? open.id : 'new';
  }
  let generationFailed = false;
  // Seeds advance even if the random source repeats. Keep dealt identities for the whole visit, plus
  // the saved board and held win on reload. Never overwrite the current board on generation failure.
  const dealt = new Set([plus.held, ...(gen ? [G.identity(genPuzzle)] : [])]);
  let seed = gen ? (gen.seed + 1) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0];
  function newGenerated() {
    if (!allDone()) return false;
    save();
    const p = G.deal(seed, dealt);
    seed = (p ? p.seed + 1 : seed + 2 * G.TRIES) >>> 0;
    if (!p) {
      generationFailed = true;
      say('Could not make a new board. Try Next again.');
      render();
      return false;
    }
    dealt.add(G.identity(p));
    genPuzzle = p;
    gen = { version: 1, n: p.n, seed: p.seed, marks: E.start(p), playing: true };
    switchBoard('generated', true);
    return true;
  }
  function advance(event) {
    if (!S.solved) return;
    const byKey = !event || event.detail === 0, target = nextTarget();
    if (openingAt(at) === opening.length - 1) write(K.opening, 1);
    if (target === 'new') { if (!newGenerated()) return; }
    else switchBoard(target);
    if (byKey) focusCell(0, true);
  }

  // ---- input: one verb. A tap, or Enter or Space, turns a square. ----
  root.addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    S.keyboard = false;
    S.focus = Number(cell.dataset.i);
    act(S.focus);
  });
  root.addEventListener('keydown', e => {
    const here = e.target.closest('.cell');
    if (here) S.focus = Number(here.dataset.i);
    const n = puzzle.n, r = Math.floor(S.focus / n), c = S.focus % n;
    let to = -1;
    if (e.key === 'ArrowLeft') to = r * n + Math.max(0, c - 1);
    else if (e.key === 'ArrowRight') to = r * n + Math.min(n - 1, c + 1);
    else if (e.key === 'ArrowUp') to = Math.max(0, r - 1) * n + c;
    else if (e.key === 'ArrowDown') to = Math.min(n - 1, r + 1) * n + c;
    else if (e.key === 'Home') to = r * n;
    else if (e.key === 'End') to = r * n + n - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      S.keyboard = true;
      if (S.solved) advance(); else act(S.focus);
    } else return;
    e.preventDefault();
    if (to >= 0) { S.keyboard = true; focusCell(to, true); }
  });
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.matches('select,input,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || key === 'backspace') { e.preventDefault(); undo(); }
    else if (key === 'h') { e.preventDefault(); S.keyboard = true; hint(); }
  });
  $('#undo-btn').addEventListener('click', undo);
  $('#hint-btn').addEventListener('click', e => { S.keyboard = e.detail === 0; hint(); });
  $('#restart-btn').addEventListener('click', restart);
  $('#next-btn').addEventListener('click', advance);

  // ---- sheets ----
  let invoker = null;
  function openSheet(id, button) {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    invoker = button;
    if (id === 'settings') {
      $('#campaign').replaceChildren(...campaign.map((p, i) => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = (i + 1) + ' · ' + p.n + '×' + p.n + (progress.completed.includes(p.id) ? ' ✓' : '');
        return option;
      }));
      // An opening board is listed as what it is, at the head of the list: the list no longer shows a campaign
      // board's number and size over one. Choosing a campaign board from it leaves the opening boards as before.
      const o = openingAt(at);
      if (o >= 0 || at === 'generated') { const intro = document.createElement('option'); intro.value = at; intro.dataset.opening = ''; intro.textContent = o >= 0 ? 'Opening ' + (o + 1) + ' of ' + opening.length : 'New Game+ board'; $('#campaign').prepend(intro); }
      $('#campaign').value = at;
    }
    $('#' + id).showModal();
  }
  for (const id of ['settings', 'help']) {
    $('#' + id + '-btn').addEventListener('click', () => openSheet(id, $('#' + id + '-btn')));
    $('#' + id).addEventListener('close', () => { if (!document.activeElement.closest('.board,dialog[open]') && invoker) invoker.focus({ preventScroll: true }); });
  }
  $('#campaign').addEventListener('change', e => { if (ids.has(e.target.value)) switchBoard(e.target.value); $('#settings').close(); });
  for (const [id, step] of [['previous', -1], ['following', 1]]) {
    $('#' + id).addEventListener('click', () => {
      const k = campaignAt(at) + step;
      if (campaignAt(at) >= 0 && k >= 0 && k < TOTAL) switchBoard(campaign[k].id);
      $('#settings').close();
    });
  }
  $('#new-game').addEventListener('click', () => { $('#settings').close(); newGenerated(); });
  $('#reset').addEventListener('click', () => { restart(); $('#settings').close(); });
  // From a campaign board the button replays the opening boards; from an opening board it reached that way, it goes
  // back to the board the player was on. Finishing the opening boards, or a reload, goes back there too.
  $('#replay-opening').addEventListener('click', () => {
    $('#help').close();
    if (replaying && openingAt(at) >= 0) { switchBoard(resumeAt()); return; }
    replaying = true; switchBoard(opening[0].id);
  });
  function applyPrefs() {
    const html = document.documentElement;
    if (prefs.theme === 'system') delete html.dataset.theme; else html.dataset.theme = prefs.theme;
    html.dataset.motion = prefs.motion;
    $('#theme').value = prefs.theme;
    $('#motion').value = prefs.motion;
  }
  for (const id of ['theme', 'motion']) {
    $('#' + id).addEventListener('change', e => { prefs[id] = e.target.value; write(K.settings, prefs); applyPrefs(); });
  }
  addEventListener('resize', fit);

  applyPrefs();
  build();
  judge(false);
  render();
  save();
  if (notice) say(notice);
  window.__balance = { S, get puzzle() { return puzzle; }, get at() { return at; }, get progress() { return progress; }, get generated() { return gen; }, get plus() { return plus; }, keys: K };
})();
