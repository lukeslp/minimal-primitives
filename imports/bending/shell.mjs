// Pinned local adaptation of arcade-kit/shell.mjs. Rimlight keeps its fixed
// 120 Hz lifecycle and safe, namespaced saves but deliberately omits the kit's
// title card, hub link, arrow pad, footer, and pause chrome.
import {DT, createEngine} from './engine.mjs?v=31b88eb6';
import {levels} from './levels.mjs?v=31b88eb6';
import {createRenderer} from './render.mjs?v=31b88eb6';

// v5: the opening teaches Fire before the star. Older saves
// remain untouched under their original keys instead of being read as corrupt.
export const SAVE_KEY = 'rimlight.save.v5';
function tally(name) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: `rimlight/${name}`, event: true }); } catch (_) {} }
const clone = value => structuredClone(value);
export const defaultRecord = () => ({ v: 1, stage: 0, completed: [], bestScores: Array(levels.length).fill(0), settings: { sound: false }, snapshot: null });

export function normalizeRecord(candidate) {
  if (!candidate || candidate.v !== 1 || !Number.isInteger(candidate.stage) || candidate.stage < 0 || candidate.stage >= levels.length ||
    !Array.isArray(candidate.completed) || !candidate.completed.every(item => Number.isInteger(item) && item >= 0 && item < levels.length) ||
    !candidate.settings || typeof candidate.settings !== 'object' || typeof candidate.settings.sound !== 'boolean' ||
    (candidate.bestScores !== undefined && (!Array.isArray(candidate.bestScores) || candidate.bestScores.length !== levels.length || !candidate.bestScores.every(score => Number.isInteger(score) && score >= 0)))) return null;
  const defaults = defaultRecord();
  return {
    ...defaults,
    ...candidate,
    completed: [...new Set(candidate.completed)],
    bestScores: candidate.bestScores ? [...candidate.bestScores] : defaults.bestScores,
    settings: { sound: false, ...candidate.settings }
  };
}

export function mountRimlight() {
  const canvas = document.querySelector('#well');
  const readout = document.querySelector('#readout');
  const scoreFeedback = document.querySelector('#score-feedback');
  const status = document.querySelector('#status');
  const undoButton = document.querySelector('#undo');
  const fireButton = document.querySelector('#fire');
  const helpButton = document.querySelector('#help-button');
  const settingsButton = document.querySelector('#settings-button');
  const help = document.querySelector('#help');
  const settings = document.querySelector('#settings');
  const pauseButton = document.querySelector('#pause-toggle');
  const resetButton = document.querySelector('#reset-stage');
  const resetGameButton = document.querySelector('#reset-game');
  const sound = document.querySelector('#sound');
  const soundState = document.querySelector('#sound-state');
  const motionState = document.querySelector('#motion-state');
  const stageList = document.querySelector('#stage-list');
  const saveNote = document.querySelector('#save-note');
  let record = defaultRecord();
  let storageInvalid = false;
  let storageFailed = false;
  let stage = 0;
  let engine;
  let renderer;
  let paused = false;
  let last = performance.now();
  let accumulator = 0;
  let raf = 0;
  let lastSave = 0;
  let feedbackUntil = 0;
  let feedbackKey = '';
  let wasFlying = false;
  let advanceAt = 0;
  // Mouse aiming. Hover previews the nearest rim point; the first click holds
  // it, and the next click (or the release of a drag) fires. `restore` keeps
  // the rim point and aim from before the preview so leaving or Escape undoes it.
  let mouse = { anchor: null, press: null, restore: null, last: null };
  // Touch and pen aiming (see touchDown). `pointerMode` follows the last pointer
  // so a touch screen shows the loaded probe before anything is placed.
  let touch = null;
  let pointerMode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  // The well's focus rim is for keyboard focus only; a tap clears it.
  let keyboardFocus = true;
  const fireLabel = fireButton.querySelector('span');
  let audio = null;

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = normalizeRecord(JSON.parse(raw));
      if (!parsed) throw new Error('Invalid Rimlight save');
      record = parsed;
    }
  } catch (_) {
    // Do not delete or overwrite a corrupt record; fresh play remains usable.
    storageInvalid = true;
  }

  function persist() {
    if (storageInvalid || storageFailed || !engine) return;
    record.stage = stage;
    record.snapshot = engine.snapshot();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(record)); }
    catch (_) { storageFailed = true; }
  }
  function announce(message) { status.textContent = message; }
  function showSheet(sheet, opener) {
    if (!sheet.open) sheet.showModal();
    sheet.addEventListener('close', () => opener?.focus({ preventScroll: true }), { once: true });
  }
  function renderStages() {
    stageList.replaceChildren();
    levels.forEach((level, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const name = document.createElement('span');
      const best = document.createElement('span');
      button.type = 'button';
      name.className = 'stage-name';
      name.textContent = `${index + 1} · ${level.name}`;
      best.className = 'best-score';
      best.textContent = record.bestScores[index] ? record.bestScores[index].toLocaleString() : '—';
      button.append(name, best);
      button.setAttribute('aria-label', `Stage ${index + 1}: ${level.name}; best score ${record.bestScores[index].toLocaleString()}${record.completed.includes(index) ? ', complete' : ''}`);
      button.setAttribute('aria-current', String(index === stage));
      button.dataset.complete = String(record.completed.includes(index));
      button.addEventListener('click', () => { settings.close(); load(index); });
      item.append(button);
      stageList.append(item);
    });
  }
  function updateUI() {
    if (!engine) return;
    const state = engine.state;
    readout.textContent = `Stage ${stage + 1}/${levels.length} · ${state.balls} probe${state.balls === 1 ? '' : 's'} · ${state.score.toLocaleString()}`;
    undoButton.disabled = !state.ball && !engine.snapshot().history.length;
    // A finished stage never dead-ends: Fire becomes Next after a clear and Retry when out of probes.
    fireButton.disabled = Boolean(state.ball || (!state.won && !state.failed && !state.balls));
    const label = state.won ? 'Next' : state.failed ? 'Retry' : 'Fire';
    if (fireLabel && fireLabel.textContent !== label) fireLabel.textContent = label;
    fireButton.setAttribute('aria-label', state.won ? 'Next stage' : state.failed ? 'Retry stage' : 'Fire probe');
    fireButton.setAttribute('aria-disabled', String(fireButton.disabled));
    motionState.textContent = paused ? 'Paused' : 'On';
    pauseButton.setAttribute('aria-pressed', String(!paused));
    soundState.textContent = record.settings.sound ? 'On' : 'Off';
    sound.setAttribute('aria-pressed', String(record.settings.sound));
    const nextStatus = storageInvalid ? 'Saved progress was ignored; the original save was left untouched.'
      : storageFailed ? 'Saving is unavailable in this tab.'
        : state.message;
    if (nextStatus) announce(nextStatus);
  }
  function load(index, restore = false) {
    undoButton.classList.remove('cue');
    stage = Math.max(0, Math.min(levels.length - 1, index));
    advanceAt = 0;
    clearMouse();
    touch = null;
    renderer.clearTrails();
    engine = createEngine(stage);
    if (restore && record.snapshot) {
      try { engine.restore(record.snapshot); }
      catch (_) { storageInvalid = true; engine = createEngine(stage); }
      // A save taken on a cleared stage resumes on the next one.
      if (engine.state.won && stage < levels.length - 1) return load(stage + 1);
    }
    paused = false;
    feedbackKey = '';
    scoreFeedback.hidden = true;
    renderStages();
    updateUI();
    persist();
  }

  function playTone(event) {
    if (!record.settings.sound || !event.noteHz || !window.AudioContext && !window.webkitAudioContext) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    audio ||= new Context();
    if (audio.state === 'suspended') void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = event.noteHz;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, audio.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.19);
  }
  // A short tick on a touch screen when a ring breaks or the stage clears.
  function buzz(event) {
    const pattern = { hit: 12, win: [12, 60, 24] }[event.type];
    if (!pattern || pointerMode === 'mouse' || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (_) { /* unsupported */ }
  }
  function next() { load(stage + 1 < levels.length ? stage + 1 : 0); }
  function fire() {
    clearMouse();
    undoButton.classList.remove('cue');
    if (engine.state.won) { next(); return; }
    if (engine.state.failed) { reset(); return; }
    engine.action('fire');
    updateUI();
    persist();
  }
  function reset() { tally(`restart/${stage + 1}`); load(stage); announce(`Stage ${stage + 1} reset.`); }
  // Undo is the forgiving path: the launcher comes back placed, with the aim
  // that was fired, so a miss can be nudged and tried again at once.
  function undo() {
    clearMouse();
    undoButton.classList.remove('cue');
    engine.action('undo');
    if (canAim()) mouse.anchor = engine.state.position;
    updateUI();
    persist();
  }
  // Reset game asks for a second tap, then clears every stage, best score and saved shot.
  // Sound stays as chosen. It also replaces a save that could not be read.
  let resetGameArmed = 0;
  function disarmResetGame() { clearTimeout(resetGameArmed); resetGameArmed = 0; resetGameButton.textContent = 'Reset game'; resetGameButton.removeAttribute('data-armed'); }
  function resetGame() {
    if (!resetGameArmed) {
      resetGameButton.textContent = 'Tap again';
      resetGameButton.dataset.armed = 'true';
      resetGameArmed = setTimeout(disarmResetGame, 4000);
      announce('Tap Reset game again to erase all progress.');
      return;
    }
    disarmResetGame();
    tally(`restart/${stage + 1}`);
    const keepSound = record.settings.sound;
    record = defaultRecord();
    record.settings.sound = keepSound;
    storageInvalid = false;
    saveNote.hidden = true;
    settings.close();
    load(0);
    announce('All progress erased.');
  }
  function showScoreFeedback(shot) {
    const details = [];
    if (shot.assists) details.push(`${shot.assists} assist${shot.assists === 1 ? '' : 's'}`);
    if (shot.orbits) details.push(`${shot.orbits} orbit${shot.orbits === 1 ? '' : 's'}`);
    if (shot.bonus) details.push(`${shot.bonus.toLocaleString()} clear`);
    scoreFeedback.textContent = `+${shot.total.toLocaleString()}${details.length ? ` · ${details.join(' · ')}` : ''}`;
    scoreFeedback.hidden = false;
    feedbackUntil = performance.now() + 1800;
  }
  // Stage 2 is the one lesson the board cannot teach by itself: after a probe
  // falls in while the aim still points at the star, a line says how to bend it.
  function bendHint(state) {
    if (stage !== 1 || !state.shot || state.won || state.failed || state.ball) return '';
    if (Math.abs(wrapPi(state.aim - state.position - Math.PI)) > 0.04) return '';
    return keyboardFocus && pointerMode === 'mouse' ? 'Up and down arrows turn the aim'
      : pointerMode === 'mouse' ? 'Click inside the well to aim' : 'Drag anywhere to swing the aim';
  }
  function boardPoint(event) { return renderer.toBoard(event.clientX, event.clientY); }
  function aimFrom(point, position) {
    const launch = { x: 300 + Math.cos(position) * 262, y: 300 + Math.sin(position) * 262 };
    const dx = point.x - launch.x;
    const dy = point.y - launch.y;
    return Math.hypot(dx, dy) > 8 ? Math.atan2(dy, dx) : position + Math.PI;
  }

  function clearMouse() { mouse = { anchor: null, press: null, restore: null, last: mouse?.last ?? null }; }
  const canAim = () => !engine.state.ball && !engine.state.won && !engine.state.failed;
  const rimAngle = point => Math.atan2(point.y - 300, point.x - 300);
  const launchPoint = position => ({ x: 300 + Math.cos(position) * 262, y: 300 + Math.sin(position) * 262 });
  const nearRim = point => Math.hypot(point.x - 300, point.y - 300) > 234;
  function holdPreview() {
    mouse.restore ||= { position: engine.state.position, aim: engine.state.aim };
  }
  // Before a rim point is placed, a hovering mouse previews the nearest one.
  // After placing, hover changes nothing, so reaching for Fire keeps the aim.
  function mousePreview(point) {
    if (!canAim() || mouse.anchor !== null) return;
    holdPreview();
    const position = rimAngle(point);
    engine.action('position', position);
    engine.action('aim', position + Math.PI);
    updateUI();
  }
  function cancelMouseAim() {
    if (mouse.anchor === null && !mouse.press) return false;
    if (mouse.press) { try { canvas.releasePointerCapture(mouse.press.id); } catch (_) { /* already released */ } }
    const { restore, last } = mouse;
    mouse = { anchor: null, press: null, restore, last };
    if (last && canAim()) mousePreview(last);
    else if (restore && canAim()) { engine.action('position', restore.position); engine.action('aim', restore.aim); mouse.restore = null; }
    updateUI();
    return true;
  }
  function endPreview() {
    if (mouse.anchor !== null || mouse.press || !mouse.restore) return;
    if (canAim()) { engine.action('position', mouse.restore.position); engine.action('aim', mouse.restore.aim); }
    mouse.restore = null;
    updateUI();
  }
  // Touch, pen and keyboard keep the aim inside the well: at most 88 degrees
  // either side of the line to the star. The mouse still points anywhere.
  const CONE = 1.53;
  const wrapPi = value => Math.atan2(Math.sin(value), Math.cos(value));
  function setAim(aim, position = engine.state.position) {
    const offset = Math.max(-CONE, Math.min(CONE, wrapPi(aim - position - Math.PI)));
    engine.action('aim', position + Math.PI + offset);
  }
  // Moving the launcher keeps the aim's bend, so a set-up shot can be slid along the rim.
  function moveLauncher(position) {
    const offset = wrapPi(engine.state.aim - engine.state.position - Math.PI);
    engine.action('position', position);
    setAim(position + Math.PI + offset, engine.state.position);
  }
  function place(point) {
    const position = rimAngle(point);
    engine.action('position', position);
    engine.action('aim', position + Math.PI);
    mouse.anchor = position;
  }

  // Touch and pen. The rim is a slider and the rest of the screen is a lever.
  // Slide along the rim to move the launcher; drag anywhere else, the blank
  // space around the well included, to swing the aim's tip with the finger
  // beside the line rather than on it. A drag never jumps the aim, so a
  // second drag nudges the first. A still tap inside the well points the aim
  // there. Tap the loaded probe or Fire to launch; nothing fires on release.
  const PROBE_PX = 30;
  const RIM_IN_PX = 26;
  const RIM_OUT_PX = 40;
  // Finger travel turns the aim as if pushing a tip this far out: on a phone a
  // degree is about two and a half pixels, and a second drag nudges further.
  const swingRadius = () => Math.max(145, renderer.scale * 200);
  function touchDown(event) {
    canvas.focus({ preventScroll: true });
    const point = boardPoint(event);
    const scale = renderer.scale;
    const launch = launchPoint(engine.state.position);
    const fromCentre = Math.hypot(point.x - 300, point.y - 300);
    let mode = 'pending';
    if (Math.hypot(point.x - launch.x, point.y - launch.y) * scale < PROBE_PX) mode = 'probe';
    else if (Math.abs(fromCentre - 270) * scale < (fromCentre < 270 ? RIM_IN_PX : RIM_OUT_PX)) { mode = 'rim'; moveLauncher(rimAngle(point)); }
    touch = { id: event.pointerId, mode, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
    updateUI();
  }
  function touchMove(event) {
    if (event.pointerId !== touch.id) return;
    if (!touch.moved && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) {
      touch.moved = true;
      if (touch.mode === 'probe') touch.mode = 'rim';
      if (touch.mode === 'pending') touch.mode = 'swing';
    }
    if (!canAim()) return;
    if (touch.mode === 'rim' && touch.moved) moveLauncher(rimAngle(boardPoint(event)));
    if (touch.mode === 'swing') {
      // Only the finger's travel across the aim turns it, as if pushing its tip.
      const dx = event.clientX - touch.lastX;
      const dy = event.clientY - touch.lastY;
      const aim = engine.state.aim;
      setAim(aim + (Math.cos(aim) * dy - Math.sin(aim) * dx) / swingRadius());
      touch.lastX = event.clientX;
      touch.lastY = event.clientY;
    }
    updateUI();
  }
  function touchUp(event) {
    if (event.pointerId !== touch.id) return;
    const { mode, moved } = touch;
    touch = null;
    if (mode === 'probe' && !moved) { fire(); return; }
    if (mode === 'pending' && !moved && canAim()) {
      const point = boardPoint(event);
      const launch = launchPoint(engine.state.position);
      if (Math.hypot(point.x - 300, point.y - 300) < 270 && Math.hypot(point.x - launch.x, point.y - launch.y) > 8) setAim(Math.atan2(point.y - launch.y, point.x - launch.x));
    }
    updateUI();
  }

  // Any press anywhere, Fire included, says which pointer is in hand.
  document.addEventListener('pointerdown', event => {
    keyboardFocus = false;
    pointerMode = event.pointerType === 'mouse' ? 'mouse' : 'touch';
  }, true);
  // The mouse. A press never fires on release: click the rim to place the
  // launcher, click or drag inside the well to curve the aim, then click the
  // loaded probe (or Fire, Space, Enter) to launch.
  canvas.addEventListener('pointerdown', event => {
    undoButton.classList.remove('cue');
    if (!event.isPrimary || engine.state.ball || event.button !== 0) return;
    if (engine.state.won || engine.state.failed) { fire(); return; }
    if (event.pointerType !== 'mouse') { touchDown(event); return; }
    const point = boardPoint(event);
    holdPreview();
    let mode;
    if (mouse.anchor === null) { place(point); mode = 'place'; }
    else {
      const launch = launchPoint(mouse.anchor);
      if (Math.hypot(point.x - launch.x, point.y - launch.y) < 26) mode = 'launcher';
      else if (nearRim(point)) { place(point); mode = 'place'; }
      else { engine.action('aim', aimFrom(point, mouse.anchor)); mode = 'aim'; }
    }
    mouse.press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, mode };
    canvas.setPointerCapture(event.pointerId);
    updateUI();
  });
  canvas.addEventListener('pointermove', event => {
    if (touch) { touchMove(event); return; }
    const point = boardPoint(event);
    if (event.pointerType === 'mouse') mouse.last = point;
    const press = mouse.press;
    if (press && event.pointerId === press.id) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true;
      // Dragging curves the aim, whether the press began on the rim or inside.
      if (press.moved && canAim() && mouse.anchor !== null) { engine.action('aim', aimFrom(point, mouse.anchor)); updateUI(); }
    } else if (!press && event.pointerType === 'mouse') mousePreview(point);
  });
  canvas.addEventListener('pointerup', event => {
    if (touch) { touchUp(event); return; }
    const press = mouse.press;
    if (!press || event.pointerId !== press.id) return;
    mouse.press = null;
    if (press.mode === 'launcher' && !press.moved) { fire(); return; }
    // The last move may have been coalesced away; the release point is the aim.
    if (press.moved && canAim() && mouse.anchor !== null) engine.action('aim', aimFrom(boardPoint(event), mouse.anchor));
    updateUI();
  });
  canvas.addEventListener('pointercancel', event => {
    if (touch && event.pointerId === touch.id) touch = null;
    if (mouse.press && event.pointerId === mouse.press.id) mouse.press = null;
  });
  canvas.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    mouse.last = null;
    endPreview();
  });
  // Right click cancels a held aim instead of opening the page menu.
  canvas.addEventListener('contextmenu', event => {
    if (mouse.anchor !== null || mouse.press) { event.preventDefault(); cancelMouseAim(); }
  });

  document.addEventListener('keydown', event => {
    if (help.open || settings.open || event.ctrlKey || event.metaKey || event.altKey) return;
    keyboardFocus = true;
    if (event.key === 'Escape' && cancelMouseAim()) { event.preventDefault(); return; }
    if (event.target.matches('input,button')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      clearMouse();
      const step = event.shiftKey ? 0.035 : 0.14;
      if (canAim()) moveLauncher(engine.state.position + (event.key === 'ArrowLeft' ? -step : step));
      updateUI();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      clearMouse();
      const step = event.shiftKey ? 0.01 : 0.05;
      if (canAim()) setAim(engine.state.aim + (event.key === 'ArrowUp' ? -step : step));
      updateUI();
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); fire(); return; }
    if (event.key === 'u' || event.key === 'U') { event.preventDefault(); undo(); return; }
    if (event.key === '?') { event.preventDefault(); showSheet(help, helpButton); }
  });
  undoButton.addEventListener('click', undo);
  fireButton.addEventListener('click', fire);
  helpButton.addEventListener('click', () => showSheet(help, helpButton));
  settingsButton.addEventListener('click', () => { renderStages(); updateUI(); showSheet(settings, settingsButton); });
  [help, settings].forEach(sheet => sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); }));
  pauseButton.addEventListener('click', () => { paused = !paused; updateUI(); });
  resetButton.addEventListener('click', () => { settings.close(); reset(); });
  resetGameButton.addEventListener('click', resetGame);
  settings.addEventListener('close', disarmResetGame);
  sound.addEventListener('click', () => { record.settings.sound = !record.settings.sound; updateUI(); persist(); });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, devicePixelRatio || 1);
  }
  renderer = createRenderer(canvas, {
    get state() { return engine.state; },
    get star() { return engine.star; },
    get armed() { return pointerMode !== 'mouse' || mouse.anchor !== null || Boolean(mouse.press); },
    trajectory: () => engine.trajectory()
  });
  new ResizeObserver(resize).observe(canvas);
  load(record.stage, !storageInvalid && Boolean(record.snapshot));
  resize();
  if (storageInvalid) { saveNote.hidden = false; saveNote.textContent = 'Saved progress could not be read. It has not been changed.'; }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!paused) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= DT && steps++ < 12) {
        engine.step(DT);
        accumulator -= DT;
        if (engine.state.won || engine.state.failed) break;
      }
      if (steps >= 12) accumulator = 0;
    }
    for (const event of engine.drainEvents()) { if (event.type === 'win') tally(`stage/${stage + 1}`); playTone(event); buzz(event); }
    // After a shot that clears nothing, Undo pulses: the retry is free.
    const flying = Boolean(engine.state.ball);
    if (wasFlying && !flying && !engine.state.won && !(engine.state.lastShot?.rings)) undoButton.classList.add('cue');
    wasFlying = flying;
    const state = engine.state;
    if (state.lastShot) {
      const key = `${state.shot}:${state.score}`;
      if (key !== feedbackKey) { feedbackKey = key; showScoreFeedback(state.lastShot); }
    }
    if (state.won) {
      let menuChanged = false;
      if (!record.completed.includes(stage)) { record.completed.push(stage); menuChanged = true; }
      if (state.score > record.bestScores[stage]) { record.bestScores[stage] = state.score; menuChanged = true; }
      if (menuChanged) { renderStages(); persist(); }
      if (!advanceAt) advanceAt = now + 1400;
    }
    if (advanceAt && now >= advanceAt && !help.open && !settings.open) next();
    const hint = now >= feedbackUntil ? bendHint(state) : '';
    if (hint) {
      if (scoreFeedback.textContent !== hint) scoreFeedback.textContent = hint;
      scoreFeedback.hidden = false;
    } else if (!scoreFeedback.hidden && now >= feedbackUntil && !state.won) scoreFeedback.hidden = true;
    if (now - lastSave > 2000) { persist(); lastSave = now; }
    updateUI();
    renderer.draw(accumulator / DT, {
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      focusRing: keyboardFocus && canvas.matches(':focus-visible'),
      swing: touch?.mode === 'swing' ? swingRadius() : null,
      sliding: touch?.mode === 'rim' && touch.moved
    });
  }
  raf = requestAnimationFrame(frame);
  window.__rimlight = {
    get engine() { return engine; },
    get stage() { return stage; },
    get paused() { return paused; },
    get aiming() { return touch ? touch.mode : mouse.press?.moved ? 'drag' : mouse.anchor !== null ? 'held' : mouse.restore ? 'hover' : null; },
    get geometry() { return renderer.geometry; },
    get record() { return clone(record); },
    action(id, value) { engine.action(id, value); updateUI(); },
    load: index => load(index),
    snapshot: () => engine.snapshot(),
    save: persist,
    reset,
    resetGame,
    dispose() { cancelAnimationFrame(raf); }
  };
}
