/* First-board acceptance vectors derived from the target's pinned engines.
 * Luke Steuber. No validator import: the service must independently check these.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(process.env.MINIMAL_ROOT || path.join(__dirname, '../..'));
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

async function fixtures() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json')));
  function pinned(game, file) {
    const relative = `${game}/${file}`, absolute = path.join(ROOT, 'imports', relative);
    const expected = manifest.games.find(g => g.id === game)?.files.find(f => f.path === relative);
    if (!expected || createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') !== expected.sha256)
      throw Error(`Fixture pin mismatch: ${relative}`);
    return absolute;
  }
  const fields = { akari: ['w', 'h', 'cells'], galaxies: ['w', 'h', 'centres'], bridges: ['w', 'h', 'islands'],
    slant: ['w', 'h', 'clues'], fold: ['w', 'h', 'pairs'], horologist: ['W', 'H', 'drive', 'clocks', 'pillars', 'tray'], tilt: ['levels'] };
  const cases = [];
  for (const game of ['notan', 'akari', 'galaxies', 'bridges', 'slant', 'fold', 'bending', 'tilt', 'horologist']) {
    const rule = game === 'bending' ? 'well.mjs' : 'engine.js';
    const ruleFile = pinned(game, rule);
    const E = game === 'bending' ? null : require(ruleFile);
    const levels = game === 'bending' ? (await import(pathToFileURL(pinned(game, 'boards.mjs')))).boards
      : require(pinned(game, game === 'horologist' ? 'boards.js' : 'levels.js'));
    const p = levels[0];
    let layout, proof, expectedValue = null;
    if (game === 'notan') {
      const q = E.fromArt(p.art);
      layout = { w: q.w, h: q.h, ...E.cluesOf(q.sol, q.w, q.h) };
      proof = { cells: Array.from(q.sol) };
    } else if (game === 'bending') {
      layout = p; proof = { planets: p.answer };
    } else {
      layout = Object.fromEntries(fields[game].filter(k => p[k] !== undefined).map(k => [k, p[k]]));
      if (game === 'fold') { proof = { path: E.solve(p) }; expectedValue = proof.path.length; }
      else if (game === 'tilt') {
        let state = { ...E.start(p), moves: 0, solved: false };
        const states = [state];
        for (const dir of E.solve(p)) {
          const r = E.slide(p, state, dir);
          state = { level: r.level, row: r.row, col: r.col, moves: state.moves + 1, solved: r.solved };
          states.push(state);
        }
        proof = { states }; expectedValue = state.moves;
      } else if (game === 'horologist') {
        const placed = [], history = [];
        for (const wheel of E.search(p).best) { history.push({ placed: structuredClone(placed), hits: placed.length }); placed.push(wheel); }
        proof = { placed, history, hits: placed.length }; expectedValue = placed.length;
      } else {
        const answer = E.logical(p);
        proof = { cells: answer.state || answer.solution || answer.lo };
      }
    }
    const identity = { game, mode: { bridges: 'classic', slant: 'standard' }[game] || 'campaign',
      puzzleId: p.id || '1', layoutHash: digest(layout),
      rulesVersion: manifest.games.find(g => g.id === game).files.find(f => f.path === `${game}/${rule}`).sha256.slice(0, 16),
      scoringPolicy: { fold: 'folds-v1', tilt: 'moves-v1', horologist: 'hits-v1' }[game] || 'time-v1' };
    cases.push({ name: game, identity, proof, expectedValue });
  }
  // Synthetic graph-consistent terminal states, not recorded browser play.
  for (const item of JSON.parse(fs.readFileSync(path.join(__dirname, 'hex-proofs.json'))).cases)
    cases.push({ name: `hex-${item.name}`, identity: item.identity, proof: item.proof,
      expectedValue: item.name === 'infinite' ? item.proof.final.safe.length : null });
  return cases;
}
module.exports = { ROOT, fixtures, digest };
if (require.main === module) fixtures().then(cases => process.stdout.write(JSON.stringify(cases) + '\n'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
