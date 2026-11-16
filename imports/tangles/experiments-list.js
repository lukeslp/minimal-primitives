/* Loop · Experiments on Loop's own page: an Experiments section in Settings,
   the sets in Help, and New Game+ offered on the last board once every line
   closes. Loop's own script is untouched; this reads its board and saves.
   The sets' names, board ids and drawings match tilings-boards.js, which a
   test checks. By Luke Steuber. */
(function () {
  'use strict';
  const SETS = [{"id":"488","name":"Octagons and squares","slug":"octagons","boards":["488-01","488-02","488-03","488-04","488-05","488-06","488-07","488-08","488-09","488-10"],"swatch":{"box":"-2.01 -2.01 4.03 4.03","path":"M-0.50,-1.21L-1.21,-0.50L-1.91,-1.21L-1.21,-1.91ZM-0.50,1.21L-1.21,1.91L-1.91,1.21L-1.21,0.50ZM1.91,-1.21L1.21,-0.50L0.50,-1.21L1.21,-1.91ZM1.21,0.50L0.50,1.21L-0.50,1.21L-1.21,0.50L-1.21,-0.50L-0.50,-1.21L0.50,-1.21L1.21,-0.50ZM1.91,1.21L1.21,1.91L0.50,1.21L1.21,0.50Z"}},{"id":"3464","name":"Hexagons, squares and triangles","slug":"hexagons-squares","boards":["3464-01","3464-02","3464-03","3464-04","3464-05","3464-06","3464-07","3464-08","3464-09","3464-10"],"swatch":{"box":"-1.97 -1.97 3.93 3.93","path":"M-0.87,-0.50L-1.87,-0.50L-1.37,-1.37ZM-0.87,0.50L-1.87,0.50L-1.87,-0.50L-0.87,-0.50ZM-1.37,1.37L-1.87,0.50L-0.87,0.50ZM0.50,1.87L-0.50,1.87L-0.00,1.00ZM-0.87,-0.50L-1.37,-1.37L-0.50,-1.87L0.00,-1.00ZM0.00,-1.00L-0.50,-1.87L0.50,-1.87ZM1.87,-0.50L0.87,-0.50L1.37,-1.37ZM0.87,0.50L0.00,1.00L-0.87,0.50L-0.87,-0.50L-0.00,-1.00L0.87,-0.50ZM1.87,0.50L0.87,0.50L0.87,-0.50L1.87,-0.50ZM0.50,1.87L-0.00,1.00L0.87,0.50L1.37,1.37ZM-1.37,1.37L-0.87,0.50L0.00,1.00L-0.50,1.87ZM1.37,1.37L0.87,0.50L1.87,0.50ZM0.00,-1.00L0.50,-1.87L1.37,-1.37L0.87,-0.50Z"}},{"id":"4612","name":"Dodecagons, hexagons and squares","slug":"dodecagons","boards":["4612-01","4612-02","4612-03","4612-04","4612-05","4612-06","4612-07","4612-08","4612-09","4612-10"],"swatch":{"box":"-3.7 -3.7 7.40 7.40","path":"M-1.37,-1.37L-1.87,-0.50L-2.87,-0.50L-3.37,-1.37L-2.87,-2.23L-1.87,-2.23ZM-1.87,0.50L-2.87,0.50L-2.87,-0.50L-1.87,-0.50ZM-1.37,1.37L-1.87,2.23L-2.87,2.23L-3.37,1.37L-2.87,0.50L-1.87,0.50ZM1.00,2.73L0.50,3.60L-0.50,3.60L-1.00,2.73L-0.50,1.87L0.50,1.87ZM-1.37,-1.37L-1.87,-2.23L-1.00,-2.73L-0.50,-1.87ZM1.00,-2.73L0.50,-1.87L-0.50,-1.87L-1.00,-2.73L-0.50,-3.60L0.50,-3.60ZM3.37,-1.37L2.87,-0.50L1.87,-0.50L1.37,-1.37L1.87,-2.23L2.87,-2.23ZM1.87,0.50L1.37,1.37L0.50,1.87L-0.50,1.87L-1.37,1.37L-1.87,0.50L-1.87,-0.50L-1.37,-1.37L-0.50,-1.87L0.50,-1.87L1.37,-1.37L1.87,-0.50ZM2.87,0.50L1.87,0.50L1.87,-0.50L2.87,-0.50ZM1.00,2.73L0.50,1.87L1.37,1.37L1.87,2.23ZM-1.87,2.23L-1.37,1.37L-0.50,1.87L-1.00,2.73ZM3.37,1.37L2.87,2.23L1.87,2.23L1.37,1.37L1.87,0.50L2.87,0.50ZM0.50,-1.87L1.00,-2.73L1.87,-2.23L1.37,-1.37Z"}},{"id":"3636","name":"Hexagons and triangles","slug":"hexagons-triangles","boards":["3636-01","3636-02","3636-03","3636-04","3636-05","3636-06","3636-07","3636-08","3636-09","3636-10"],"swatch":{"box":"-1.83 -1.83 3.66 3.66","path":"M-1.00,-0.00L-0.50,0.87L-1.50,0.87ZM-1.00,0.00L-1.50,-0.87L-0.50,-0.87ZM0.00,1.73L-0.50,0.87L0.50,0.87ZM-0.00,-1.73L0.50,-0.87L-0.50,-0.87ZM1.00,0.00L0.50,0.87L-0.50,0.87L-1.00,0.00L-0.50,-0.87L0.50,-0.87ZM1.00,-0.00L1.50,0.87L0.50,0.87ZM1.00,0.00L0.50,-0.87L1.50,-0.87Z"}},{"id":"square","name":"Squares","slug":"squares","boards":["square-01","square-02","square-03","square-04","square-05","square-06","square-07","square-08","square-09","square-10"],"swatch":{"box":"-1.6 -1.6 3.20 3.20","path":"M-0.50,-0.50L-1.50,-0.50L-1.50,-1.50L-0.50,-1.50ZM-0.50,0.50L-1.50,0.50L-1.50,-0.50L-0.50,-0.50ZM-0.50,1.50L-1.50,1.50L-1.50,0.50L-0.50,0.50ZM0.50,-0.50L-0.50,-0.50L-0.50,-1.50L0.50,-1.50ZM0.50,0.50L-0.50,0.50L-0.50,-0.50L0.50,-0.50ZM0.50,1.50L-0.50,1.50L-0.50,0.50L0.50,0.50ZM1.50,-0.50L0.50,-0.50L0.50,-1.50L1.50,-1.50ZM1.50,0.50L0.50,0.50L0.50,-0.50L1.50,-0.50ZM1.50,1.50L0.50,1.50L0.50,0.50L1.50,0.50Z"}},{"id":"triangle","name":"Triangles","slug":"triangles","boards":["triangle-01","triangle-02","triangle-03","triangle-04","triangle-05","triangle-06","triangle-07","triangle-08","triangle-09","triangle-10"],"swatch":{"box":"-2.1 -2.1 4.20 4.20","path":"M-1.50,-0.87L-1.00,0.00L-2.00,-0.00ZM-2.00,-0.00L-1.00,-0.00L-1.50,0.87ZM-1.00,-0.00L-0.50,0.87L-1.50,0.87ZM-1.50,0.87L-0.50,0.87L-1.00,1.73ZM-0.50,0.87L0.00,1.73L-1.00,1.73ZM-1.00,-1.73L-0.50,-0.87L-1.50,-0.87ZM-1.50,-0.87L-0.50,-0.87L-1.00,0.00ZM-0.50,-0.87L0.00,0.00L-1.00,-0.00ZM-1.00,-0.00L-0.00,-0.00L-0.50,0.87ZM-0.00,-0.00L0.50,0.87L-0.50,0.87ZM-0.50,0.87L0.50,0.87L0.00,1.73ZM0.50,0.87L1.00,1.73L-0.00,1.73ZM-1.00,-1.73L-0.00,-1.73L-0.50,-0.87ZM-0.00,-1.73L0.50,-0.87L-0.50,-0.87ZM-0.50,-0.87L0.50,-0.87L0.00,0.00ZM0.50,-0.87L1.00,0.00L-0.00,-0.00ZM0.00,-0.00L1.00,-0.00L0.50,0.87ZM1.00,-0.00L1.50,0.87L0.50,0.87ZM0.50,0.87L1.50,0.87L1.00,1.73ZM0.00,-1.73L1.00,-1.73L0.50,-0.87ZM1.00,-1.73L1.50,-0.87L0.50,-0.87ZM0.50,-0.87L1.50,-0.87L1.00,0.00ZM1.50,-0.87L2.00,0.00L1.00,-0.00ZM1.00,-0.00L2.00,-0.00L1.50,0.87Z"}}];
  const KEY = 'loop-experiments.v1', LOOP_KEY = 'loop.v1', LAST = 'L50', NS = 'http://www.w3.org/2000/svg';
  const $ = s => document.querySelector(s);
  // The page loads this script deferred and its stylesheet from here, so
  // Loop's own page loads as quickly as it did without them.
  if (!document.querySelector('link[href^="./experiments-list.css"]')) { const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = './experiments-list.css?v=decd8844'; document.head.append(css); }
  const read = key => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; } };
  const beaten = () => { const s = read(LOOP_KEY); return !!(s && Array.isArray(s.finished) && s.finished.includes(LAST)); };
  const finished = () => { const s = read(KEY); return new Set(s && Array.isArray(s.finished) ? s.finished : []); };
  function svg(d, cls, box = '0 0 24 24') { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', box); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('vector-effect', 'non-scaling-stroke'); s.append(p); return s; }
  function item(list, { label, state, href, shape, box, disabled }) {
    const li = document.createElement('li'), a = document.createElement(disabled ? 'button' : 'a');
    a.className = 'experiment'; if (disabled) { a.type = 'button'; a.disabled = true; } else a.href = href;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = label;
    const st = document.createElement('span'); st.className = 'progress'; st.textContent = state;
    a.append(svg(shape, null, box), name, st); li.append(a); list.append(li);
  }
  // Settings: New Game+ and the six sets, below Loop's own boards.
  const section = document.createElement('section'), title = document.createElement('h3'), list = document.createElement('ol');
  section.setAttribute('aria-labelledby', 'experiments-title'); title.id = 'experiments-title'; title.className = 'experiments-title'; title.textContent = 'Experiments';
  list.id = 'experiments'; list.className = 'experiments'; section.append(title, list);
  const boards = $('#catalog-title'); if (boards) boards.closest('section').after(section); else $('#settings .sheet-body').append(section);
  function refresh() {
    const done = finished(), open = beaten(); list.replaceChildren();
    const all = SETS.reduce((a, s) => a + s.boards.length, 0), plusDone = SETS.reduce((a, s) => a + s.boards.filter(id => done.has(id)).length, 0);
    item(list, { label: 'New Game+', state: open ? `${plusDone} / ${all}` : 'After board 50', href: './experiments.html?plus', shape: 'M12 5v14M5 12h14', disabled: !open });
    for (const s of SETS) item(list, { label: s.name, state: `${s.boards.filter(id => done.has(id)).length} / ${s.boards.length}`, href: `./experiments.html?set=${s.id}`, shape: s.swatch.path, box: s.swatch.box });
  }
  refresh();
  $('#settings-btn')?.addEventListener('click', refresh);
  // Settings chosen on the experiments page before Loop had a save of its own
  // are taken here, through Loop's own controls, so Loop saves them.
  try {
    const mine = read(KEY);
    if (mine && mine.settingsPending && mine.settings) {
      const valid = { theme: ['system', 'light', 'dark'], motion: ['system', 'reduce'], borders: ['off', 'on'] };
      for (const [id, values] of Object.entries(valid)) { const sel = document.getElementById(id), v = mine.settings[id]; if (sel && values.includes(v) && sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
      delete mine.settingsPending; localStorage.setItem(KEY, JSON.stringify(mine));
    }
  } catch (_) { /* Loop keeps its own */ }
  // Help: the sets as links under a heading, so Help keeps Loop's three
  // sentences.
  const help = document.createElement('section'), head = document.createElement('h3'), ul = document.createElement('ul');
  help.className = 'experiments-help'; help.setAttribute('aria-labelledby', 'experiments-help-title'); head.id = 'experiments-help-title'; head.className = 'experiments-title'; head.textContent = 'Experiments';
  for (const s of SETS) { const li = document.createElement('li'), a = document.createElement('a'); a.href = `./experiments.html?set=${s.id}`; a.textContent = s.name; li.append(a); ul.append(li); }
  help.append(head, ul); $('#help .sheet-body')?.append(help);
  // New Game+: a large disc on the last board once it is solved.
  const plus = document.createElement('a'); plus.id = 'plus-btn'; plus.href = './experiments.html?plus'; plus.hidden = true;
  plus.setAttribute('aria-label', 'New Game+: sixty boards on six other tilings'); plus.append(svg('M12 5v14M5 12h14'));
  document.body.append(plus);
  const board = $('#board');
  function watch() {
    const show = board?.dataset.solved === 'true' && window.__loop?.board?.id === LAST;
    // Loop saves board 50 as finished, which is what opens New Game+; this
    // page writes nothing of its own.
    if (show === plus.hidden) plus.hidden = !show;
  }
  if (board) new MutationObserver(watch).observe(board, { attributes: true, attributeFilter: ['data-solved', 'data-busy'] });
  watch();
})();
