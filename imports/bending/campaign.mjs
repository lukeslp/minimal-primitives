// Campaign records, kept by board rather than by place. Luke Steuber.
import {placed, spots} from './well.mjs?v=ceff1282';

// A board's name: an FNV-1a hash of its lattice, answer and probes. Progress is
// saved under these names, so a board keeps its record wherever it moves in the
// campaign, and the record of a board that has left is simply not found.
export function fingerprint(board) {
  const text = `${board.size}|${[...board.answer].sort((a, b) => a - b).join(',')}|${board.probes.map(probe => `${probe.at}:${probe.aim}`).join(',')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

// The 50-stage campaign whose places v1 and v2 saves count, frozen: the name of
// the board at each place (v1 saves hold the first 24).
export const V2 = [
  '9743634d', '230d5685', 'e949f1af', '434982b8', 'a22bec96', '519154bb', '8572a8a1', 'ed7367fa', 'd81df376', '0eaf2bf2',
  'ed55bb5d', '59b9e5fd', '4b30119a', 'b87acb33', 'a1fa5f95', 'cb9a0c44', '96909210', '9a549590', 'fd3c5b7e', 'a0ff89ca',
  'ad226d66', '69787ef1', '3c4ca9fd', '7ad51718', '05e640a0', 'e0cfdabb', '4a4be1ea', 'da5c42fa', 'f8b8d977', 'd2e4bbcb',
  'bb6e196f', 'd2ea70f7', 'ff71a49f', 'a6086abe', 'ad8682cd', 'b18af31c', '3a0df79b', '275473c5', '807bab79', '2240b23c',
  'd3390eb0', '018c2152', '3addad31', 'd533f790', '666f37b5', '2a8acf19', '71bf6023', '9964367a', '89bb277f', '4675f6b5'
];

const blank = board => ({planets: board.answer.map(() => null), hints: 0, solved: false});
const every = (boards, pool) => [...boards, ...pool];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The record the page plays with: one entry per board, the campaign's stages
// first and New Game+'s after them. `board` is the place of the board on screen,
// `available` how many stages are open, `done` every stage ever solved, and
// `bag` the New Game+ boards still to come this round. `past` keeps the names of boards solved while they were
// campaign stages that no longer are (five left on November 17, 2026), so their record is never lost.
export const fresh = (boards, pool = []) => ({v: 3, board: 0, stages: every(boards, pool).map(blank), available: 1,
  done: every(boards, pool).map(() => false), bag: [], past: [], motion: true, sound: false});

// Solving a stage opens the next for good. New Game+ boards open nothing.
export function unlock(record, index, boards) {
  if (index < boards.length) record.available = Math.max(record.available, Math.min(boards.length, index + 2));
}

// A saved stage that fits this board, its solved mark taken from its planets; else null.
function stage(saved, board) {
  if (!object(saved) || !Array.isArray(saved.planets) || saved.planets.length !== board.answer.length) return null;
  const count = spots(board).length;
  const there = saved.planets.filter(index => index !== null);
  if (!saved.planets.every(index => index === null || Number.isInteger(index) && index >= 0 && index < count) || new Set(there).size !== there.length) return null;
  const hints = Number.isInteger(saved.hints) && saved.hints > 0 ? Math.min(saved.hints, board.answer.length) : 0;
  return {planets: [...saved.planets], hints, solved: placed(board, saved.planets).solved};
}

// Makes the marks agree: a solved stage is done and opens the next, and the
// board on screen is one the player may open.
function settle(record, boards) {
  const count = boards.length;
  record.stages.forEach((entry, index) => { if (index >= count) record.done[index] = false; else if (entry.solved) record.done[index] = true; });
  record.done.forEach((done, index) => { if (done) unlock(record, index, boards); });
  record.available = Math.min(count, Math.max(1, record.available));
  const finished = boards.every((_, index) => record.done[index]);
  if (record.board >= count && !finished) record.board = record.available - 1;
  if (record.board < count && record.board >= record.available) record.board = record.available - 1;
  return record;
}

// What is saved: progress under each board's name. `open` lists the stages the
// player may open, in campaign order, so a later campaign can find the nearest.
export function pack(record, boards, pool = []) {
  const ids = every(boards, pool).map(fingerprint);
  const stages = {};
  record.stages.forEach((entry, index) => {
    if (index >= boards.length && index !== record.board) return;
    if (entry.solved || entry.hints || entry.planets.some(dot => dot !== null)) stages[ids[index]] = {planets: [...entry.planets], hints: entry.hints, solved: entry.solved};
  });
  const past = (record.past || []).filter(id => !ids.slice(0, boards.length).includes(id));
  return {v: 3, board: ids[record.board], stages, done: [...ids.filter((_, index) => index < boards.length && record.done[index]), ...past],
    open: ids.slice(0, record.available), pool: record.bag.filter(id => ids.indexOf(id) >= boards.length), motion: record.motion, sound: record.sound};
}

// Reads a v3 save, or a later one as far as this version understands it. Names
// this build does not know are left out quietly, and so is any stage that does
// not fit its board.
function read(save, boards, pool) {
  const list = every(boards, pool);
  const at = new Map(list.map((board, index) => [fingerprint(board), index]));
  const known = (id, stagesOnly = false) => typeof id === 'string' && at.has(id) && (!stagesOnly || at.get(id) < boards.length);
  const record = fresh(boards, pool);
  if (object(save.stages)) for (const [id, saved] of Object.entries(save.stages)) {
    if (!known(id)) continue;
    const entry = stage(saved, list[at.get(id)]);
    if (entry) record.stages[at.get(id)] = entry;
  }
  if (Array.isArray(save.done)) for (const id of save.done) {
    if (known(id, true)) record.done[at.get(id)] = true;
    else if (typeof id === 'string' && /^[0-9a-f]{8}$/.test(id) && !record.past.includes(id)) record.past.push(id);
  }
  const open = Array.isArray(save.open) ? save.open : [];
  for (const id of open) if (known(id, true)) record.available = Math.max(record.available, at.get(id) + 1);
  if (Array.isArray(save.pool)) record.bag = [...new Set(save.pool.filter(id => known(id) && at.get(id) >= boards.length))];
  if (typeof save.motion === 'boolean') record.motion = save.motion;
  if (typeof save.sound === 'boolean') record.sound = save.sound;
  // The saved board; if it has gone, the nearest open stage before it that is still here. A board that is now a
  // New Game+ board stays only once the campaign is finished; before that, the open stage nearest it in the order
  // it was saved in (the later of two) takes its place.
  let where = known(save.board) ? at.get(save.board) : -1;
  const finishedAll = boards.every((_, index) => record.done[index] || record.stages[index].solved);
  if (where >= boards.length && !finishedAll) {
    const from = open.indexOf(save.board), here = open.map((id, index) => [id, index]).filter(([id]) => known(id, true));
    where = -1;
    if (from >= 0 && here.length) {
      const [id] = here.reduce((best, item) => Math.abs(item[1] - from) < Math.abs(best[1] - from) || (Math.abs(item[1] - from) === Math.abs(best[1] - from) && item[1] > best[1]) ? item : best);
      where = at.get(id);
    }
  }
  if (where < 0) {
    const from = open.indexOf(save.board);
    const before = from < 0 ? open : open.slice(0, from + 1);
    for (let index = before.length - 1; index >= 0 && where < 0; index--) if (known(before[index], true)) where = at.get(before[index]);
  }
  record.board = Math.max(0, where);
  return settle(record, boards);
}

// Converts a v1 (24 places) or v2 (50 places) save. Each place is the board V2
// names there: a board still in the campaign keeps its planets, hints and solved
// mark; one that has left is dropped. Every stage that was open stays open, and
// the player goes to the nearest surviving stage at or before the one they were
// on; a player who had finished every stage that remains goes to the last.
export function migrate(save, boards, pool = []) {
  if (!object(save) || save.v !== 1 && save.v !== 2) return null;
  const at = new Map(boards.map((board, index) => [fingerprint(board), index]));
  const where = V2.map(id => at.has(id) ? at.get(id) : -1);
  const record = fresh(boards, pool);
  const stages = Array.isArray(save.stages) ? save.stages.slice(0, V2.length) : [];
  const done = save.v === 2 && Array.isArray(save.done) ? save.done : [];
  stages.forEach((saved, place) => {
    if (where[place] < 0) return;
    const entry = stage(saved, boards[where[place]]);
    if (entry) record.stages[where[place]] = entry;
  });
  where.forEach((index, place) => { if (index >= 0 && done[place] === true) record.done[index] = true; });
  // A solved board that has left the campaign keeps its record by name.
  V2.forEach((id, place) => { if (where[place] < 0 && (done[place] === true || stages[place]?.solved === true) && !record.past.includes(id)) record.past.push(id); });
  // v1 saves had every one of their 24 stages open.
  const reach = save.v === 1 ? 24 : Number.isInteger(save.available) ? Math.min(V2.length, Math.max(1, save.available)) : 1;
  for (let place = 0; place < reach; place++) if (where[place] >= 0) record.available = Math.max(record.available, where[place] + 1);
  if (typeof save.motion === 'boolean') record.motion = save.motion;
  if (typeof save.sound === 'boolean') record.sound = save.sound;
  let place = Number.isInteger(save.board) ? Math.min(V2.length - 1, Math.max(0, save.board)) : 0;
  while (place > 0 && where[place] < 0) place--;
  record.board = Math.max(0, where[place]);
  settle(record, boards);
  if (boards.every((_, index) => record.done[index])) record.board = boards.length - 1;
  return record;
}

// Opens whatever is saved. `current` is the raw v3 record and `older` the raw
// v2 one (strings, or null when absent). Never throws and never starts over
// while something can be read: a v3 save is read; a later version's save is
// read as far as this version can and marked `protect`, so the page never
// writes over it; an unreadable v3 save is handed back as `keep`, for the page
// to set aside, and the older record is tried instead. The v2 record itself is
// never changed, so it stays as its own recovery copy.
export function restore(current, older, boards, pool = []) {
  const parse = raw => { if (typeof raw !== 'string') return undefined; try { return JSON.parse(raw); } catch (_) { return null; } };
  const result = {record: null, protect: false, keep: null};
  try {
    const save = parse(current);
    if (save !== undefined) {
      if (object(save) && Number.isInteger(save.v) && save.v >= 3) {
        result.record = read(save, boards, pool);
        result.protect = save.v > 3;
        return result;
      }
      const converted = migrate(save, boards, pool);
      if (converted) { result.record = converted; return result; }
      result.keep = current;
    }
  } catch (_) {
    result.keep = typeof current === 'string' ? current : null;
    result.protect = false;
  }
  try {
    result.record = migrate(parse(older), boards, pool);
  } catch (_) {
    result.record = null;
  }
  result.record ||= fresh(boards, pool);
  return result;
}

// The next New Game+ board: each comes once, in a shuffled order, before any
// comes again, and a new round never opens with the board just played. While
// some boards are not in `solved` (the names New Game+ has seen solved), one of
// those comes first, the round's next if it holds any. It starts empty.
// Returns its place in the record, or -1 when there is no pool.
export function draw(record, boards, pool, random = Math.random, solved = null) {
  if (!pool.length) return -1;
  const ids = pool.map(fingerprint);
  const current = record.board >= boards.length ? ids[record.board - boards.length] : null;
  record.bag = record.bag.filter(id => ids.includes(id));
  if (!record.bag.length) {
    const order = [...ids];
    for (let index = order.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    if (order.length > 1 && order[0] === current) [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
    record.bag = order;
  }
  const unsolved = solved ? ids.filter(id => !solved.includes(id) && id !== current) : [];
  const id = unsolved.length ? record.bag.find(other => unsolved.includes(other)) ?? unsolved[Math.floor(random() * unsolved.length)] : record.bag[0];
  record.bag = record.bag.filter(other => other !== id);
  const index = boards.length + ids.indexOf(id);
  record.stages[index] = blank(pool[index - boards.length]);
  return index;
}

// The rules a playing record keeps, for the tests.
export function valid(record, boards, pool = []) {
  const list = every(boards, pool);
  const count = boards.length;
  return object(record) && record.v === 3 && Array.isArray(record.stages) && record.stages.length === list.length &&
    record.stages.every((entry, index) => { const fit = stage(entry, list[index]); return fit && fit.hints === entry.hints && fit.solved === entry.solved; }) &&
    Array.isArray(record.done) && record.done.length === list.length && record.done.every(done => typeof done === 'boolean') &&
    Number.isInteger(record.available) && record.available >= 1 && record.available <= count &&
    Number.isInteger(record.board) && record.board >= 0 && record.board < list.length &&
    (record.board < count ? record.board < record.available : boards.every((_, index) => record.done[index])) &&
    record.stages.every((entry, index) => index >= count || !entry.solved || index < record.available) &&
    Array.isArray(record.bag) && typeof record.motion === 'boolean' && typeof record.sound === 'boolean';
}
