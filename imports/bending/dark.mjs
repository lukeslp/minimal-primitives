import {judge, nearestDot, placed, spots, FULL, PLANET, WELL} from './well.mjs?v=0f8ac9d7';
import {boards} from './boards.mjs?v=7924441f';
import {fresh as freshCampaign, migrate, unlock} from './campaign.mjs?v=afbaeef6';
import {createView, createSky, trayPoint, NEXT, RIPPLE} from './dark-view.mjs?v=0f8ac9d7';

// v2: a planet's place is a dot of its own stage's lattice, so v1 places mean nothing here.
const SAVE_KEY = 'rimlight.dark.v2';
const fresh = () => freshCampaign(boards);
const $ = id => document.getElementById(id);
const canvas = $('well');
const view = createView(canvas);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const query = new URLSearchParams(location.search);
const mode = query.get('paths') === 'off' ? 'dots' : 'paths';
const lens = query.get('lens') !== 'off';
// The dotted way-out lines are off unless asked for: they did not explain themselves.
const clues = query.get('clues') === 'on';
const stars = query.get('stars') !== 'off';
const weave = query.get('weave') !== 'off';
// Another way to draw a planet, to compare: a black hole with a disc.
const hole = query.get('orb') === 'hole';
const sky = stars ? createSky($('sky')) : null;
let record = fresh();
try {
  const candidate = JSON.parse(localStorage.getItem(SAVE_KEY));
  const migrated = migrate(candidate, boards);
  if (migrated) record = migrated;
} catch (_) {}
let result;
let held = null;
let history = [];
let buttons = [];
let raf = 0;
// Where each planet is drawn. It glides to where it has been put, and the
// paths and the lattice follow it there; the board itself never waits.
let bodies = [];
let gliding = false;
let last = 0;
let audio = null;
const stage = () => record.stages[record.board];
const size = () => boards[record.board].size ?? FULL;
const dots = () => spots(boards[record.board]);
// The planets still in the tray close up toward its left end, in order. While one is held the rest stay put.
const slots = () => held?.slots ?? packed();
function packed() {
  let next = 0;
  return stage().planets.map(index => index === null ? next++ : null);
}
const home = i => trayPoint(slots()[i] ?? packed()[i] ?? 0, stage().planets.length);
// One ripple per planet, from when it lands: {planet, start}.
let ripples = [];
// The planet a tap on a dot will move: the one last touched, shown lit. Null when none is picked.
let selected = null;
const rippling = now => ripples.some(ripple => now < ripple.start + RIPPLE);
function ripple(planet, delay = 0) {
  if (!moving()) return;
  ripples = ripples.filter(other => other.planet !== planet);
  ripples.push({ planet, start: performance.now() + delay });
}
// When the stage on screen was solved, for the moment the board takes to settle.
let wonAt = -Infinity;
const SETTLE = 700;
const won = now => !stage().solved ? 0 : moving() ? Math.min(1, Math.max(0, (now - wonAt) / SETTLE)) : 1;
const settling = now => stage().solved && now < wonAt + SETTLE;
const moving = () => record.motion && !reduced.matches && !document.hidden;
// Dust circles every planet in the well for as long as anything may move.
const circling = () => moving() && (hole || stage().planets.some(index => index !== null));
const twinkling = () => stars && moving();
// True for one more frame after the last thing on the board has stopped, so its resting state is drawn.
let wasBusy = false;
function goals() {
  return stage().planets.map((index, i) => {
    if (held?.planet === i && index === null) return { x: held.point.x, y: held.point.y, k: 0, loose: true };
    if (index === null) return { ...home(i), k: 0, loose: false };
    return { x: dots()[index].x, y: dots()[index].y, k: 1, loose: false };
  });
}
// Moves every drawn planet toward its place; true while any is still on the way.
function settle(seconds) {
  const goal = goals();
  if (!moving() || bodies.length !== goal.length) { bodies = goal; return false; }
  const step = 1 - Math.exp(-seconds / 0.07);
  let busy = false;
  goal.forEach((to, i) => {
    const body = bodies[i];
    // Under the pointer a planet keeps up with it; everywhere else it glides.
    const pace = to.loose && body.loose ? 1 : step;
    body.x += (to.x - body.x) * pace;
    body.y += (to.y - body.y) * pace;
    body.k += (to.k - body.k) * step;
    body.loose = to.loose;
    if (Math.hypot(to.x - body.x, to.y - body.y) < 0.3 && Math.abs(to.k - body.k) < 0.01) Object.assign(body, to);
    else busy = true;
  });
  return busy;
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(record)); } catch (_) {}
}
function tone() {
  if (!record.sound || !(window.AudioContext || window.webkitAudioContext)) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    audio ||= new Context();
    if (audio.state === 'suspended') void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, audio.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.19);
  } catch (_) {}
}
function announce() {
  $('status').replaceChildren(document.createTextNode(stage().solved ? 'Solved' : `${result.count} of ${result.lit.length} lit`));
}
function positionButtons() {
  const { scale, x, y } = view.geometry;
  stage().planets.forEach((index, i) => {
    const point = held?.planet === i && index === null ? held.point : index === null ? home(i) : dots()[index];
    const button = buttons[i];
    button.style.left = `${x + point.x * scale}px`;
    button.style.top = `${y + point.y * scale}px`;
    button.style.width = button.style.height = `${Math.max(44, PLANET.r * 2 * scale)}px`;
    button.setAttribute('aria-label', `Planet ${i + 1}, ${index === null ? 'in the tray' : `row ${dots()[index].row + size() + 1}, column ${dots()[index].col + size() + 1}`}`);
    button.setAttribute('aria-disabled', String(stage().solved));
  });
  // The next arrow takes the tray's place under the well.
  $('completion').style.left = `${x + NEXT.x * scale}px`;
  $('completion').style.top = `${y + NEXT.y * scale}px`;
}
function draw(now = performance.now()) {
  const board = boards[record.board];
  // Mid-glide the paths are those of the planets as drawn, wherever they are inside the rim.
  const shown = gliding ? judge(board, bodies.filter(body => Math.hypot(body.x - WELL.centre, body.y - WELL.centre) <= WELL.rim)) : result;
  const waves = stage().planets.map((_, i) => {
    const mine = ripples.find(other => other.planet === i);
    const age = mine ? (now - mine.start) / RIPPLE : -1;
    return age >= 0 && age < 1 ? age : null;
  });
  view.draw({ board, planets: stage().planets, bodies, shown, won: won(now), hints: stage().hints, held, mode, lens, clues, slots: slots(), waves,
    sky: stars ? record.board : null, weave, hole, selected, time: moving() ? now : null });
  night(now);
}
// The page's sky: every stage has its own, and it twinkles only while things may move.
function night(now = performance.now()) {
  if (!sky) return;
  const rect = canvas.getBoundingClientRect();
  const { scale, x, y } = view.geometry;
  sky.draw({ seed: record.board, x: rect.left + x, y: rect.top + y, scale, colour: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), time: moving() ? now : null });
}
function loop(now) {
  raf = 0;
  gliding = settle(last ? Math.min(0.05, (now - last) / 1000) : 1 / 60);
  last = now;
  // While only the stars are moving the board is left as it is.
  const busy = gliding || wasBusy || circling() || settling(now) || rippling(now);
  if (busy) draw(now); else night(now);
  ripples = ripples.filter(other => now < other.start + RIPPLE);
  wasBusy = gliding || circling() || settling(now) || rippling(now);
  if (wasBusy || twinkling()) raf = requestAnimationFrame(loop);
  else last = 0;
}
// Starts the loop when something should move, stops it when nothing should.
function animation() {
  if (!moving()) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    gliding = settle(0);
    last = 0;
    ripples = [];
  } else {
    gliding = settle(0);
    wasBusy = true;
    if (!raf && (gliding || circling() || twinkling() || settling(performance.now()) || rippling(performance.now()))) raf = requestAnimationFrame(loop);
  }
  draw();
}
function update(atRest = false, before = null, landed = null) {
  result = placed(boards[record.board], stage().planets);
  if (atRest) {
    // A planet that has come to rest on a new dot sends a ripple; a solved stage sends one from each.
    if (landed) stage().planets.forEach((index, i) => { if (index !== null && index !== landed[i]) ripple(i, 110); });
    if (result.solved && !stage().solved) { wonAt = performance.now(); stage().planets.forEach((_, i) => ripple(i, 260 + i * 130)); }
    stage().solved = result.solved;
    if (result.solved) unlock(record, record.board, boards);
    if (result.solved) selected = null;
    if (before && result.lit.some((lit, i) => lit && !before[i])) tone();
    announce();
    save();
  }
  $('readout').textContent = `${record.board + 1} / ${boards.length} · ${record.stages.filter(entry => entry.solved).length} ✓`;
  canvas.setAttribute('aria-label', `Bending, stage ${record.board + 1} of ${boards.length}: ${result.lit.length} beams, ${stage().planets.length} planets`);
  $('completion').hidden = !stage().solved;
  $('undo').disabled = history.length === 0;
  positionButtons();
  animation();
}
function snapshot() { return structuredClone(stage()); }
function releaseCapture(id) { try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (_) {} }
function cancel() {
  if (!held) return;
  const drag = held;
  held = null;
  record.stages[record.board] = drag.before;
  releaseCapture(drag.id);
  update();
}
function finish() {
  if (!held) return;
  const drag = held;
  held = null;
  releaseCapture(drag.id);
  const moved = stage().planets.some((index, i) => index !== drag.before.planets[i]);
  // A press on a planet that goes nowhere picks it, or lets it go if it was picked.
  if (drag.direct && !moved && !drag.travelled) selected = selected === drag.planet ? null : drag.planet;
  else selected = drag.planet;
  if (moved) history.push(drag.before);
  update(true, drag.lit, drag.before.planets);
}
function movePointer(event) {
  const point = view.toBoard(event.clientX, event.clientY);
  const index = nearestDot(point.x, point.y, stage().planets.filter((_, i) => i !== held.planet), size());
  held.point = point;
  if (Math.hypot(event.clientX - held.x, event.clientY - held.y) > 6) held.travelled = true;
  stage().planets[held.planet] = index < 0 ? null : index;
  update();
}
function place(planet, index) {
  if (held || stage().solved || !Number.isInteger(planet) || planet < 0 || planet >= stage().planets.length ||
    !(index === null || Number.isInteger(index) && index >= 0 && index < dots().length) ||
    index !== null && stage().planets.some((dot, i) => i !== planet && dot === index)) return;
  const before = result.lit;
  const was = [...stage().planets];
  history.push(snapshot());
  stage().planets[planet] = index;
  update(true, before, was);
  if (stage().solved && document.body.dataset.input === 'keyboard') $('next').focus({ preventScroll: true });
}
function keyboard(event, planet) {
  const keys = ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace', 'Delete'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  if (stage().solved || held) return;
  const current = stage().planets[planet];
  if (event.key === 'Delete' || event.key === 'Backspace') { place(planet, null); return; }
  const taken = stage().planets.filter((_, i) => i !== planet);
  if (current === null) { place(planet, nearestDot(300, 300, taken, size())); return; }
  if (!event.key.startsWith('Arrow')) return;
  const dot = dots()[current];
  const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
  const axis = horizontal ? 'col' : 'row';
  const fixed = horizontal ? 'row' : 'col';
  const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
  const options = dots().map((point, index) => ({ point, index })).filter(({ point, index }) =>
    point[fixed] === dot[fixed] && (point[axis] - dot[axis]) * sign > 0 && !taken.includes(index));
  options.sort((a, b) => Math.abs(a.point[axis] - dot[axis]) - Math.abs(b.point[axis] - dot[axis]));
  if (options.length) place(planet, options[0].index);
}
function load(index) {
  if (!Number.isInteger(index) || index < 0 || index >= boards.length || index >= record.available) return;
  cancel();
  record.board = index;
  history = [];
  selected = null;
  bodies = [];
  ripples = [];
  wonAt = -Infinity;
  $('planet-buttons').replaceChildren();
  buttons = stage().planets.map((_, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'planet-button';
    button.dataset.planet = i;
    button.addEventListener('keydown', event => keyboard(event, i));
    button.addEventListener('focus', () => { if (document.body.dataset.input === 'keyboard' && !stage().solved && selected !== i) { selected = i; draw(); } });
    $('planet-buttons').append(button);
    return button;
  });
  update(true);
}
function undo() {
  cancel();
  if (!history.length) return;
  const hints = stage().hints;
  record.stages[record.board] = history.pop();
  stage().hints = hints;
  update(true);
}
function restart() {
  cancel();
  selected = null;
  history.push(snapshot());
  stage().planets.fill(null);
  update(true);
}
function hint() {
  if (held) return;
  stage().hints = Math.min(boards[record.board].answer.length, stage().hints + 1);
  save();
  draw();
}
function next() {
  if (!stage().solved || held) return;
  const keys = document.body.dataset.input === 'keyboard';
  load((record.board + 1) % boards.length);
  // The next arrow has gone; a keyboard player carries on from the first planet.
  if (keys) buttons[0]?.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', event => {
  document.body.dataset.input = 'pointer';
  if (held && event.pointerId !== held.id) cancel();
}, true);
canvas.addEventListener('pointerdown', event => {
  if (held || !event.isPrimary || event.button !== 0 || stage().solved) return;
  const point = view.toBoard(event.clientX, event.clientY);
  const radius = Math.max(22 / view.geometry.scale, PLANET.r);
  let planet = -1;
  let distance = radius;
  stage().planets.forEach((index, i) => {
    const p = index === null ? home(i) : dots()[index];
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (d <= distance) { distance = d; planet = i; }
  });
  // A press on the open well moves the lit planet to the nearest free dot, and
  // it can be dragged on from there. With none lit it moves the only planet, or
  // else the last one still waiting.
  const direct = planet >= 0;
  let fetched = false;
  if (!direct && nearestDot(point.x, point.y, stage().planets, size()) >= 0) {
    planet = selected ?? (stage().planets.length === 1 ? 0 : stage().planets.lastIndexOf(null));
    fetched = planet >= 0;
  }
  if (planet < 0) return;
  event.preventDefault();
  buttons[planet].focus({ preventScroll: true });
  held = { id: event.pointerId, planet, point, direct, travelled: false, x: event.clientX, y: event.clientY, before: snapshot(), lit: [...result.lit], slots: packed() };
  canvas.setPointerCapture(event.pointerId);
  if (fetched) movePointer(event);
});
canvas.addEventListener('pointermove', event => {
  if (!held || held.id !== event.pointerId) return;
  if (event.buttons === 0) { finish(); return; }
  movePointer(event);
});
canvas.addEventListener('pointerup', event => {
  if (!held || held.id !== event.pointerId) return;
  movePointer(event);
  finish();
});
canvas.addEventListener('pointercancel', event => { if (held?.id === event.pointerId) cancel(); });
canvas.addEventListener('lostpointercapture', event => {
  if (held?.id === event.pointerId) { if (event.buttons === 0) finish(); else cancel(); }
});
window.addEventListener('blur', cancel);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); animation(); });
window.addEventListener('pagehide', cancel);
reduced.addEventListener('change', animation);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw());
new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.addEventListener('keydown', event => {
  document.body.dataset.input = 'keyboard';
  if (event.key === 'Escape') cancel();
  if ($('help').open || $('settings').open || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'u' || key === 'z') { event.preventDefault(); undo(); }
  if (key === 'n') { event.preventDefault(); next(); }
  if (key === 'r') { event.preventDefault(); restart(); }
  if (key === 'h') { event.preventDefault(); hint(); }
  // A digit goes to that planet. An arrow or Enter pressed with no control in
  // focus goes to the lit planet, or the first, and acts on it.
  const digit = Number(event.key);
  if (Number.isInteger(digit) && digit >= 1 && digit <= buttons.length && event.key.trim()) {
    event.preventDefault();
    buttons[digit - 1].focus({ preventScroll: true });
  } else if ((event.key.startsWith('Arrow') || event.key === 'Enter') && !document.activeElement?.closest('button, a, select, input, dialog') && buttons.length && !stage().solved) {
    const planet = selected ?? Math.max(0, stage().planets.indexOf(null));
    buttons[planet].focus({ preventScroll: true });
    keyboard(event, planet);
  }
});
function showSheet(id, opener) {
  cancel();
  const sheet = $(id);
  if (!sheet.open) sheet.showModal();
  sheet.addEventListener('close', () => $(opener).focus({ preventScroll: true }), { once: true });
}
function settings() {
  $('stage-list').replaceChildren();
  boards.forEach((_, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const current = index === record.board;
    const completed = record.stages[index].solved;
    const available = index < record.available;
    const state = current ? 'current' : completed ? 'completed' : available ? 'available' : 'locked';
    button.append(document.createTextNode(String(index + 1)));
    const label = document.createElement('span');
    label.className = 'stage-state';
    label.textContent = {current:'Current',completed:'Done',available:'Open',locked:'Locked'}[state];
    button.append(label);
    button.disabled = !available;
    button.dataset.state = state;
    button.setAttribute('aria-label', `Stage ${index + 1}, ${state}${current && completed ? ', completed' : ''}`);
    button.setAttribute('aria-current', String(index === record.board));
    button.dataset.complete = record.stages[index].solved;
    button.addEventListener('click', () => { $('settings').close(); load(index); });
    item.append(button);
    $('stage-list').append(item);
  });
  showSheet('settings', 'settings-button');
}
function preferences() {
  ['motion', 'sound'].forEach(key => {
    $(key).setAttribute('aria-pressed', String(record[key]));
    $(`${key}-state`).textContent = record[key] ? 'On' : 'Off';
  });
  document.body.classList.toggle('still', !record.motion);
}
$('undo').addEventListener('click', undo);
$('restart').addEventListener('click', restart);
$('hint').addEventListener('click', hint);
$('next').addEventListener('click', next);
$('help-button').addEventListener('click', () => showSheet('help', 'help-button'));
$('settings-button').addEventListener('click', settings);
['help', 'settings'].forEach(id => $(id).addEventListener('click', event => { if (event.target === $(id)) $(id).close(); }));
['motion', 'sound'].forEach(key => $(key).addEventListener('click', () => { record[key] = !record[key]; preferences(); save(); animation(); }));
$('reset-stage').addEventListener('click', () => {
  cancel();
  record.stages[record.board] = fresh().stages[record.board];
  $('settings').close();
  load(record.board);
});
$('reset-game').addEventListener('click', () => {
  cancel();
  const { motion, sound } = record;
  record = { ...fresh(), motion, sound };
  $('settings').close();
  load(0);
});
new ResizeObserver(() => { view.resize(); positionButtons(); draw(); }).observe(canvas);
window.addEventListener('resize', () => night());
view.resize();
load(record.board);
preferences();
document.fonts.ready.then(() => draw());
animation();
window.__rimlight = {
  boards, mode,
  get dots() { return dots(); },
  get tray() { return stage().planets.map((_, i) => slots()[i] === null ? null : home(i)); },
  get rippling() { return rippling(performance.now()); },
  get circling() { return circling(); },
  get selected() { return selected; },
  get sky() { return sky ? { stars: sky.count } : null; },
  stars, weave, hole,
  get board() { return record.board; },
  get available() { return record.available; },
  get planets() { return [...stage().planets]; },
  get lit() { return [...result.lit]; },
  get solved() { return stage().solved; },
  get hints() { return stage().hints; },
  get gliding() { return gliding; },
  get won() { return won(performance.now()); },
  get size() { return size(); },
  lens, clues,
  get geometry() { return view.geometry; },
  place, load, undo, restart, hint, next
};
