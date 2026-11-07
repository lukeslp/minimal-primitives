/** Independent final-state validation for the accepted Hexsweeper pin.
 * Returns { value }; throws on unknown/inconsistent proofs. elapsedMs must be
 * supplied by the service's run clock. This is casual validation, not replay
 * attestation: random mine layouts are bound to identity, not server-seeded.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../imports/hexsweeper/', import.meta.url);
const pins = {
  sphere: ['sphere/sphere.js', '6792801b5a4430ef1f2d7b19f8fbd32f4705bf6d11e3121aa7bd5e3591c2016b'],
  classic: ['bounded.html', 'a53584846d25b349954cf60d5f1df847e3497c05a85a3dd38f6b4f9b9c56103a'],
  infinite: ['infinite.html', '91ec62a9f19c9e280ba858ed69884f930b73795a454bead8848ff3aeaf4c8700']
};
const graphPath = new URL('sphere/hexasphere.js', root);
const hash = value => createHash('sha256').update(value).digest('hex');
for (const [path, sha] of Object.values(pins)) {
  if (hash(readFileSync(new URL(path, root))) !== sha) throw Error(`Hex engine pin mismatch: ${path}`);
}
if (hash(readFileSync(graphPath)) !== 'bc2f0a104d495a060c68634579bab57b4ebcf2d4e3cdb8876ccc9a95f3a96787') throw Error('Hex graph pin mismatch');
const { generateHexasphere } = require(graphPath.pathname);
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const demand = (condition, message) => { if (!condition) throw Error(`Invalid Hex proof: ${message}`); };
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const sizes = { xsmall: 4, easy: 6, medium: 10, hard: 12, xlarge: 15 };
const density = { easy: .13, medium: .155, hard: .18 };
const finite = {
  classic: { easy: [4, 10], medium: [7, 35], hard: [10, 80] },
  fire: { easy: [4, 10], medium: [7, 35], hard: [10, 70] },
  plague: { easy: [8, 40], medium: [10, 70], hard: [12, 105] },
  water: { easy: [4, 10], medium: [6, 28], hard: [8, 52] }
};
const spheres = new Map();
function sphereGraph(difficulty) {
  if (!spheres.has(difficulty)) {
    const tiles = generateHexasphere(1, sizes[difficulty]).tiles;
    spheres.set(difficulty, new Map(tiles.map((t, i) => [i, t.neighborIndices])));
  }
  return spheres.get(difficulty);
}
function axial(key) {
  demand(typeof key === 'string' && /^-?(?:0|[1-9]\d*),-?(?:0|[1-9]\d*)$/.test(key), 'axial key');
  const [q, r] = key.split(',').map(Number);
  demand(`${q},${r}` === key && Math.abs(q) <= 160 && Math.abs(r) <= 160 && Math.abs(q + r) <= 160, 'axial bounds');
  return [q, r];
}
const ring = ([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
function planeGraph(radius) {
  demand(Number.isInteger(radius) && radius >= 1 && radius <= 160, 'radius bounds');
  const graph = new Map();
  for (let q = -radius; q <= radius; q++) for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
    graph.set(`${q},${r}`, directions.map(([dq, dr]) => [q + dq, r + dr]).filter(p => ring(p) <= radius).map(p => p.join(',')));
  }
  return graph;
}
function list(value, graph, label) {
  demand(Array.isArray(value) && value.length <= graph.size, label);
  const set = new Set(value);
  demand(set.size === value.length && value.every(k => graph.has(k)), `${label} membership/duplicates`);
  return set;
}
function same(a, b) { return a.size === b.size && [...a].every(k => b.has(k)); }
function fields(o, allowed) { demand(o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => allowed.includes(k)), 'unknown layout fields'); }

export function validateHexProof({ identity, proof, elapsedMs }) {
  demand(identity?.game === 'hexsweeper' && proof?.v === 1, 'game/version');
  demand(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0, 'service elapsed time');
  const l = proof.initial, f = proof.final;
  demand(l?.v === 1 && Object.hasOwn(pins, l.kind) && f?.over === true && typeof f.won === 'boolean', 'layout/terminal');
  const kind = l.kind;
  demand(identity.rulesVersion === pins[kind][1].slice(0, 16), 'rulesVersion');
  demand(identity.layoutHash === hash(canonical(l)), 'layoutHash');
  const mode = identity.mode;
  demand(identity.puzzleId === `hex/${mode}`, 'puzzleId');
  let graph, initialGraph, endless = false;
  if (kind === 'sphere') {
    fields(l, ['v', 'kind', 'difficulty', 'subdivisions', 'first', 'mines']);
    demand(Object.hasOwn(sizes, l.difficulty) && l.subdivisions === sizes[l.difficulty] && mode === `sphere:${l.difficulty}`, 'sphere mode/subdivisions');
    graph = initialGraph = sphereGraph(l.difficulty);
  } else {
    fields(l, ['v', 'kind', 'difficulty', 'endless', 'radius', 'density', 'finish', 'first', 'mines']);
    demand(Object.hasOwn(density, l.difficulty) && typeof l.endless === 'boolean', 'plane difficulty');
    let lane;
    if (kind === 'classic') {
      demand(mode === `classic:${l.difficulty}` && !l.endless && l.finish === null, 'classic mode');
      lane = 'classic';
    } else {
      const match = /^infinite-(light|escape|fire|plague|water):(easy|medium|hard)$/.exec(mode);
      demand(match && match[2] === l.difficulty, 'infinite mode');
      lane = match[1];
      demand(f.session?.mode === lane || lane === 'light' && f.session?.mode === 'dark', 'theme session');
      endless = lane === 'light' || lane === 'escape';
      demand(l.endless === endless, 'endless lane');
      if (lane !== 'escape') demand(l.finish === null, 'unexpected finish');
      else { axial(l.finish); demand(!l.mines.includes(l.finish), 'mined exit'); }
    }
    demand(l.density === density[l.difficulty] || !endless, 'density');
    if (endless) demand(Number.isInteger(l.radius) && l.radius >= Math.max(6, finite.classic[l.difficulty][0]) && f.radius >= l.radius, 'initial expansion');
    else demand(l.radius === finite[lane][l.difficulty][0] && f.radius === l.radius && l.mines.length === finite[lane][l.difficulty][1], 'finite configuration');
    initialGraph = planeGraph(l.radius); graph = planeGraph(f.radius);
    demand(f.finish === l.finish, 'changed exit');
  }
  const initialMines = list(l.mines, initialGraph, 'initial mines');
  const mines = list(f.mines, graph, 'final mines');
  const safe = list(f.safe, graph, 'safe reveals');
  demand(initialGraph.has(l.first), 'missing first dig');
  demand(!initialMines.has(l.first) && initialGraph.get(l.first).every(k => !initialMines.has(k)), 'first-dig safe zone');
  demand(safe.has(l.first), 'first dig not revealed');
  demand([...safe].every(k => !mines.has(k)), 'revealed mine counted safe');
  demand([...initialGraph.keys()].every(k => initialMines.has(k) === mines.has(k)), 'initial mines changed');
  if (kind === 'sphere') demand(initialMines.size === Math.max(1, Math.round(graph.size * .17)), 'sphere mine target');
  if (!endless) demand(same(initialMines, mines) && f.won && safe.size === graph.size - mines.size, 'finite all-safe completion');
  else {
    demand(initialMines.size >= 3 && safe.size > 0 && identity.scoringPolicy === 'cleared-v1', 'endless mines/policy');
    const torn = list(f.torn, graph, 'torn cells');
    if (f.won) demand(mode.startsWith('infinite-escape:') && f.reason === 'finish' && safe.has(l.finish), 'exit completion');
    else if (f.reason === 'mine') demand(mines.has(f.detonator), 'mine terminal');
    else {
      demand(f.reason === 'rift' && mode.startsWith('infinite-escape:'), 'unknown end reason');
      demand(f.session?.rift?.phase === 'catch' && f.session.rift.catchKey === f.detonator && f.session.rift.lastDigKey === f.detonator && safe.has(f.detonator), 'rift terminal');
    }
    if (!mode.startsWith('infinite-escape:')) demand(torn.size === 0, 'torn plate');
  }
  demand(identity.scoringPolicy === (endless ? 'cleared-v1' : 'time-v1'), 'scoring policy');
  demand(Array.isArray(f.counts) && f.counts.length === safe.size, 'number evidence');
  const seen = new Set();
  for (const row of f.counts) {
    demand(Array.isArray(row) && row.length === 2, 'number row');
    const [k, n] = row;
    demand(safe.has(k) && !seen.has(k) && Number.isInteger(n) && n === graph.get(k).filter(j => mines.has(j)).length, 'neighbor count');
    seen.add(k);
  }
  return { value: endless ? safe.size : elapsedMs };
}
