/* Tilt · Levels. Luke Steuber. */
(function () {
  'use strict';

  const E = globalThis.TiltStack;
  const Boards = globalThis.TiltStackBoards;
  const KEY = 'tilt-levels-grok.v1';
  const CELL = 64;
  const GAP = 44;
  const PAD = 26;
  const NS = 'http://www.w3.org/2000/svg';
  const NAMES = { U: 'Up', D: 'Down', L: 'Left', R: 'Right' };
  const ids = new Set(Boards.map(board => board.id));
  const $ = id => document.getElementById(id);

  const paths = {
    reset: 'M5 7a8 8 0 1 1-1 9M5 3v5h5',
    undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',
    hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z',
    next: 'M5 12h14m-6-6 6 6-6 6',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
  }

  for (const [id, name] of [['restart-btn', 'reset'], ['undo-btn', 'undo'], ['hint-btn', 'hint'], ['next-btn', 'next'], ['settings-btn', 'settings'], ['help-btn', 'help']]) {
    $(id).innerHTML = icon(name);
  }

  let saveBlocked = false;
  function readSave() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (error) { saveBlocked = true; return null; }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid save');
      const board = typeof data.board === 'string' && ids.has(data.board) ? data.board : null;
      const done = Array.isArray(data.done) ? [...new Set(data.done.filter(id => typeof id === 'string' && ids.has(id)))] : [];
      const theme = data.theme === 'system' || data.theme === 'light' || data.theme === 'dark' ? data.theme : 'dark';
      const motion = data.motion === 'reduce' || data.motion === 'system' ? data.motion : 'system';
      // Before campaign version 2 every original tray was available.
      const previous = data.campaign === 2 ? (Number.isInteger(data.reached) ? data.reached : 0) : 11;
      const reached = Math.min(Boards.length - 1, Math.max(0, previous,
        Boards.findIndex(item => item.id === board), ...done.map(id => Boards.findIndex(item => item.id === id) + 1)));
      return { board: board, done: done, theme: theme, motion: motion, reached: reached };
    } catch (error) {
      saveBlocked = true;
      return null;
    }
  }

  const saved = readSave();
  const prefs = { theme: saved ? saved.theme : 'dark', motion: saved ? saved.motion : 'system' };
  const done = new Set(saved && saved.done || []);
  let reached = saved ? saved.reached : 0;
  let current = Boards.find(board => board.id === (saved && saved.board)) || Boards[0];
  let parsed = E.prepare(current);
  let place = { level: parsed.start.level, row: parsed.start.row, col: parsed.start.col };
  let moves = 0;
  let solved = false;
  let par = E.par(current);
  let hint = null;
  let undoStack = [];
  let busy = false;
  let token = 0;
  let lastFocus = null;
  let gesture = null;

  function reduced() {
    if (document.documentElement.dataset.motion === 'reduce') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function writeSave() {
    if (saveBlocked) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        campaign: 2,
        reached: reached,
        board: current.id,
        done: [...done],
        theme: prefs.theme,
        motion: prefs.motion
      }));
    } catch (error) {}
  }

  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.motion = prefs.motion;
    $('theme').value = prefs.theme;
    $('motion').value = prefs.motion;
    const light = prefs.theme === 'light' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.querySelector('meta[name="theme-color"]').content = light ? '#ffffff' : '#000000';
  }

  function origin(level) {
    return { x: PAD, y: PAD + level * (parsed.size * CELL + GAP) };
  }

  function centerOf(level, row, col) {
    const at = origin(level);
    return { x: at.x + (col + 0.5) * CELL, y: at.y + (row + 0.5) * CELL };
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function describe() {
    const lines = ['Marble on level ' + (place.level + 1) + ', row ' + (place.row + 1) + ', column ' + (place.col + 1) + '.'];
    for (let level = 0; level < parsed.levels; level++) {
      const rows = [];
      for (let row = 0; row < parsed.size; row++) {
        const cells = [];
        for (let col = 0; col < parsed.size; col++) {
          const ch = parsed.grid[level][row][col];
          const here = level === place.level && row === place.row && col === place.col;
          if (here && ch === 'o') cells.push('marble in the exit');
          else if (here) cells.push('marble');
          else if (ch === '#') cells.push('block');
          else if (ch === 'o') cells.push(level === parsed.levels - 1 ? 'exit' : 'hole');
          else cells.push('floor');
        }
        rows.push(cells.join(', '));
      }
      lines.push('Level ' + (level + 1) + ': ' + rows.join('; ') + '.');
    }
    return lines.join(' ');
  }

  function say(text) {
    const live = $('live');
    live.textContent = '';
    live.textContent = text;
  }

  function draw() {
    const width = PAD * 2 + parsed.size * CELL;
    const height = PAD * 2 + parsed.levels * parsed.size * CELL + (parsed.levels - 1) * GAP;
    const svg = svgEl('svg', { id: 'picture', viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-hidden': 'true' });
    const ink = ['var(--lv0)', 'var(--lv1)', 'var(--lv2)'];
    for (let level = parsed.levels - 1; level >= 0; level--) {
      const at = origin(level);
      const span = parsed.size * CELL;
      svg.append(svgEl('rect', { x: at.x, y: at.y, width: span, height: span, fill: 'var(--floor)', stroke: 'var(--line)', 'stroke-width': 1, class: 'tray-frame', 'data-level': level }));
      let lines = '';
      for (let i = 1; i < parsed.size; i++) {
        lines += 'M' + (at.x + i * CELL) + ' ' + at.y + 'V' + (at.y + span);
        lines += 'M' + at.x + ' ' + (at.y + i * CELL) + 'H' + (at.x + span);
      }
      svg.append(svgEl('path', { d: lines, fill: 'none', stroke: 'var(--line)', 'stroke-width': 1 }));
      for (let row = 0; row < parsed.size; row++) {
        for (let col = 0; col < parsed.size; col++) {
          const ch = parsed.grid[level][row][col];
          const x = at.x + col * CELL;
          const y = at.y + row * CELL;
          if (ch === '#') svg.append(svgEl('rect', { x: x + 1, y: y + 1, width: CELL - 2, height: CELL - 2, fill: ink[level] || ink[2] }));
          if (ch === 'o') {
            const goal = level === parsed.levels - 1;
            const radius = CELL * (goal ? 0.34 : 0.28);
            svg.append(svgEl('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: radius, fill: 'none', stroke: 'var(--hole)', 'stroke-width': goal ? 3 : 2 }));
            if (goal) svg.append(svgEl('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: CELL * 0.16, fill: 'none', stroke: 'var(--hole)', 'stroke-width': 2 }));
            if (!goal && parsed.grid[level + 1][row][col] !== 'o') {
              const land = centerOf(level + 1, row, col);
              svg.append(svgEl('circle', { cx: land.x, cy: land.y, r: CELL * 0.18, fill: 'none', stroke: 'var(--ghost)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
            }
            if (!goal) {
              const xLine = x + CELL / 2;
              const y1 = at.y + span;
              svg.append(svgEl('line', { x1: xLine, y1: y1, x2: xLine, y2: y1 + GAP, stroke: 'var(--shaft)', 'stroke-width': 1.5, 'stroke-dasharray': '2 4' }));
            }
          }
        }
      }
    }
    const chevron = svgEl('path', { id: 'hint-mark', d: 'M-10 5 0-7 10 5', fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', visibility: 'hidden' });
    svg.append(chevron);
    const marble = svgEl('g', { id: 'marble' });
    marble.append(svgEl('circle', { r: CELL * 0.2, fill: 'var(--ball)' }));
    marble.append(svgEl('circle', { r: CELL * 0.06, cx: -CELL * 0.06, cy: -CELL * 0.07, fill: 'var(--spec)' }));
    svg.append(marble);
    const board = $('board');
    board.replaceChildren(svg);
    placeMarble(centerOf(place.level, place.row, place.col), 1);
    showHint();
    markActive();
    fit();
  }

  function placeMarble(point, scale) {
    const marble = $('marble');
    if (!marble) return;
    marble.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ') scale(' + scale + ')');
  }

  function markActive() {
    document.querySelectorAll('.tray-frame').forEach(node => {
      const on = Number(node.getAttribute('data-level')) === place.level;
      node.setAttribute('stroke', on ? 'var(--ink)' : 'var(--line)');
      node.setAttribute('stroke-width', on ? '2.5' : '1');
    });
  }

  function showHint() {
    const mark = $('hint-mark');
    if (!mark) return;
    if (!hint) {
      mark.setAttribute('visibility', 'hidden');
      return;
    }
    const at = origin(place.level);
    const span = parsed.size * CELL;
    const spots = {
      U: [at.x + span / 2, at.y - 8, 0],
      D: [at.x + span / 2, at.y + span + 8, 180],
      L: [at.x - 8, at.y + span / 2, -90],
      R: [at.x + span + 8, at.y + span / 2, 90]
    };
    const spot = spots[hint];
    mark.setAttribute('transform', 'translate(' + spot[0] + ' ' + spot[1] + ') rotate(' + spot[2] + ')');
    mark.setAttribute('visibility', 'visible');
  }

  function fit() {
    const box = $('stack-fit');
    const svg = $('picture');
    if (!svg || !box.clientWidth || !box.clientHeight) return;
    const view = svg.viewBox.baseVal;
    const aspect = view.width / view.height;
    let width = box.clientWidth;
    let height = box.clientHeight;
    if (width / height > aspect) width = height * aspect;
    else height = width / aspect;
    svg.style.width = Math.floor(width) + 'px';
    svg.style.height = Math.floor(height) + 'px';
  }

  function updateCatalog() {
    const list = $('level-catalog');
    if (!list.children.length) Boards.forEach((board, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.board = board.id;
      button.innerHTML = '<span>Board ' + (index + 1) + '</span><span class="catalog-state"></span>';
      button.addEventListener('click', () => {
        if (index > reached) return;
        if (board !== current) go(board.id);
        $('settings').close();
      });
      item.append(button);
      list.append(item);
    });
    Boards.forEach((board, index) => {
      const button = list.children[index].firstChild;
      const here = board === current;
      const completed = done.has(board.id);
      button.dataset.state = here ? 'current' : completed ? 'completed' : index <= reached ? 'available' : 'locked';
      button.dataset.completed = String(completed);
      button.disabled = index > reached;
      button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, completed ? 'Completed' : null,
        !here && !completed ? (index <= reached ? 'Available' : 'Locked') : null].filter(Boolean).join(' · ');
      if (here) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  function refresh() {
    const index = Boards.findIndex(board => board.id === current.id) + 1;
    $('readout').textContent = index + ' / ' + Boards.length + ' · ' + moves + '/' + par;
    $('board').setAttribute('aria-label', describe());
    $('next-btn').hidden = !solved || index === Boards.length;
    $('previous').disabled = index === 1;
    $('following').disabled = index - 1 >= reached || index === Boards.length;
    updateCatalog();
    $('undo-btn').disabled = undoStack.length === 0;
    $('hint-btn').disabled = solved;
    document.documentElement.dataset.busy = busy ? '1' : '0';
    markActive();
    showHint();
  }

  function snapshot() {
    return { level: place.level, row: place.row, col: place.col, moves: moves, solved: solved };
  }

  function restore(state) {
    place = { level: state.level, row: state.row, col: state.col };
    moves = state.moves;
    solved = state.solved;
    hint = null;
  }

  function cancelMotion() {
    token++;
    busy = false;
  }

  function animate(from, path) {
    const points = [centerOf(from.level, from.row, from.col)].concat(path.map(cell => centerOf(cell.level, cell.row, cell.col)));
    if (reduced() || points.length < 2) {
      placeMarble(points[points.length - 1], 1);
      busy = false;
      refresh();
      return;
    }
    busy = true;
    refresh();
    const serial = ++token;
    const spans = [];
    for (let i = 1; i < points.length; i++) {
      const drop = path[i - 1].drop;
      const dist = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / CELL;
      spans.push(drop ? 180 + dist * 70 : 60 + dist * 48);
    }
    const total = spans.reduce((sum, item) => sum + item, 0);
    const started = performance.now();
    const frame = now => {
      if (serial !== token) return;
      const time = now - started;
      if (time >= total) {
        placeMarble(points[points.length - 1], 1);
        busy = false;
        refresh();
        return;
      }
      let walked = 0;
      for (let i = 0; i < spans.length; i++) {
        if (time <= walked + spans[i]) {
          const raw = (time - walked) / spans[i];
          const ease = path[i].drop ? raw * raw : raw;
          placeMarble({
            x: points[i].x + (points[i + 1].x - points[i].x) * ease,
            y: points[i].y + (points[i + 1].y - points[i].y) * ease
          }, path[i].drop ? 1 - 0.28 * Math.sin(Math.PI * raw) : 1);
          break;
        }
        walked += spans[i];
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function announce(dir, result) {
    const where = 'Level ' + (result.level + 1) + ', row ' + (result.row + 1) + ', column ' + (result.col + 1) + '.';
    if (!result.moved) say(NAMES[dir] + '. The marble stays.');
    else if (result.solved) say(NAMES[dir] + '. ' + (result.path.some(cell => cell.drop) ? 'Drops. ' : '') + where + ' Finished in ' + moves + '.');
    else if (result.path.some(cell => cell.drop)) say(NAMES[dir] + '. Drops to ' + where);
    else say(NAMES[dir] + '. ' + where);
  }

  function tilt(dir) {
    if (busy || solved || !NAMES[dir]) return false;
    const result = E.slide(current, place, dir);
    hint = null;
    if (!result.moved) {
      announce(dir, result);
      refresh();
      return false;
    }
    undoStack.push(snapshot());
    const from = snapshot();
    place = { level: result.level, row: result.row, col: result.col };
    moves += 1;
    solved = result.solved;
    if (solved) {
      done.add(current.id);
      reached = Math.max(reached, Math.min(Boards.length - 1, Boards.indexOf(current) + 1));
    }
    writeSave();
    announce(dir, result);
    refresh();
    animate(from, result.path);
    return true;
  }

  function undo() {
    cancelMotion();
    const previous = undoStack.pop();
    if (!previous) {
      refresh();
      return;
    }
    restore(previous);
    say('Undone. Level ' + (place.level + 1) + ', row ' + (place.row + 1) + ', column ' + (place.col + 1) + '.');
    placeMarble(centerOf(place.level, place.row, place.col), 1);
    refresh();
  }

  function restart() {
    cancelMotion();
    const home = parsed.start;
    if (moves !== 0 || place.level !== home.level || place.row !== home.row || place.col !== home.col) undoStack.push(snapshot());
    place = { level: home.level, row: home.row, col: home.col };
    moves = 0;
    solved = false;
    hint = null;
    say('Restarted.');
    placeMarble(centerOf(place.level, place.row, place.col), 1);
    refresh();
  }

  function go(id) {
    const next = Boards.find(board => board.id === id);
    if (!next || Boards.indexOf(next) > reached) return false;
    cancelMotion();
    current = next;
    parsed = E.prepare(current);
    par = E.par(current);
    place = { level: parsed.start.level, row: parsed.start.row, col: parsed.start.col };
    moves = 0;
    solved = false;
    hint = null;
    undoStack = [];
    gesture = null;
    writeSave();
    say('');
    draw();
    refresh();
    return true;
  }

  function armHint() {
    if (busy || solved) return;
    if (hint) {
      const dir = hint;
      hint = null;
      tilt(dir);
      return;
    }
    const moveset = E.solve(current, place);
    if (!moveset || !moveset.length) {
      say('No way on from here.');
      return;
    }
    hint = moveset[0];
    say(NAMES[hint] + '.');
    showHint();
  }

  const board = $('board');
  board.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy || solved) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lx: event.clientX, ly: event.clientY };
    try { board.setPointerCapture(event.pointerId); } catch (error) {}
  });
  board.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.lx = event.clientX;
    gesture.ly = event.clientY;
  });
  board.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = gesture.lx - gesture.x;
    const dy = gesture.ly - gesture.y;
    gesture = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    tilt(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
  });
  board.addEventListener('pointercancel', event => {
    if (gesture && gesture.id === event.pointerId) gesture = null;
  });

  document.addEventListener('keydown', event => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector('dialog[open]') || event.target.matches('select, input, textarea')) return;
    const dir = { ArrowUp: 'U', ArrowRight: 'R', ArrowDown: 'D', ArrowLeft: 'L' }[event.key];
    if (dir) {
      event.preventDefault();
      tilt(dir);
    } else if (event.key === 'z' || event.key === 'Z' || event.key === 'Backspace') {
      event.preventDefault();
      undo();
    }
  });

  $('restart-btn').addEventListener('click', restart);
  $('undo-btn').addEventListener('click', undo);
  $('hint-btn').addEventListener('click', armHint);
  $('next-btn').addEventListener('click', () => {
    const index = Boards.findIndex(board => board.id === current.id);
    if (solved && index + 1 < Boards.length) go(Boards[index + 1].id);
  });

  function openSheet(id, button) {
    lastFocus = button;
    $(id).showModal();
  }
  $('settings-btn').addEventListener('click', () => openSheet('settings', $('settings-btn')));
  $('help-btn').addEventListener('click', () => openSheet('help', $('help-btn')));
  for (const id of ['settings', 'help']) {
    $(id).addEventListener('close', () => { if (lastFocus) lastFocus.focus(); });
  }
  for (const id of ['theme', 'motion']) {
    $(id).addEventListener('change', event => {
      prefs[id] = event.target.value;
      applyPrefs();
      if (id === 'motion' && reduced()) {
        cancelMotion();
        placeMarble(centerOf(place.level, place.row, place.col), 1);
        refresh();
      }
      writeSave();
    });
  }
  $('previous').addEventListener('click', () => {
    const index = Boards.findIndex(board => board.id === current.id);
    if (index > 0) go(Boards[index - 1].id);
    $('settings').close();
  });
  $('following').addEventListener('click', () => {
    const index = Boards.findIndex(board => board.id === current.id);
    if (index < reached && index + 1 < Boards.length) go(Boards[index + 1].id);
    $('settings').close();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyPrefs);
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe($('stack-fit'));

  applyPrefs();
  draw();
  refresh();
  writeSave();

  globalThis.__tiltLevels = {
    boards: Boards,
    get board() { return current.id; },
    get state() {
      return { level: place.level, row: place.row, col: place.col, moves: moves, par: par, solved: solved };
    },
    tilt: tilt,
    undo: undo,
    restart: restart,
    go: go
  };
})();
