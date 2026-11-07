'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixtures = require('./hex-fixtures/proofs.json').cases;
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hashLayout = run => { run.identity.layoutHash = createHash('sha256').update(canonical(run.proof.initial)).digest('hex'); };
const validator = import('../adapters/hex-validator.mjs');

test('finite all-safe and endless safe-count fixture values use service timing', async () => {
  const { validateHexProof } = await validator;
  for (const run of fixtures) {
    const expected = run.name === 'infinite' ? run.proof.final.safe.length : run.elapsedMs;
    assert.deepEqual(validateHexProof(run), { value: expected });
    assert.deepEqual(validateHexProof({ ...run, elapsedMs: 123 }), { value: run.name === 'infinite' ? expected : 123 });
  }
});

test('unknown layouts, duplicate keys, incorrect counts and incomplete boards fail closed', async () => {
  const { validateHexProof } = await validator;
  const changes = [
    r => { r.identity.game = 'other'; },
    r => { r.proof.v = 2; },
    r => { r.proof.initial.kind = 'constructor'; hashLayout(r); },
    r => { r.proof.initial.extra = true; hashLayout(r); },
    r => { r.proof.initial.first = null; hashLayout(r); },
    r => { r.proof.initial.mines.push(r.proof.initial.mines[0]); hashLayout(r); },
    r => { r.proof.final.mines.pop(); },
    r => { r.proof.final.safe.pop(); },
    r => { r.proof.final.safe.push(r.proof.final.safe[0]); },
    r => { r.proof.final.safe.push(r.proof.final.mines[0]); },
    r => { r.proof.final.counts[0][1]++; },
    r => { r.proof.final.counts[0][0] = 'outside'; },
    r => { r.proof.final.counts.pop(); },
    r => { r.proof.final.over = false; },
    r => { r.elapsedMs = -1; },
    r => { r.elapsedMs = 1.5; },
    r => { r.identity.scoringPolicy = 'unknown'; }
  ];
  for (const original of fixtures) for (const change of changes) {
    const run = structuredClone(original); change(run);
    assert.throws(() => validateHexProof(run), `${original.name}: ${change}`);
  }
});

test('sphere subdivisions and plane radius, mine targets, first-click protection are pinned', async () => {
  const { validateHexProof } = await validator;
  const sphere = structuredClone(fixtures[0]); sphere.proof.initial.subdivisions = 1; hashLayout(sphere);
  assert.throws(() => validateHexProof(sphere));
  for (const template of fixtures.slice(1)) for (const radius of [-1, 0, 1.5, 161, 100000]) {
    const run = structuredClone(template); run.proof.initial.radius = radius; run.proof.final.radius = radius; hashLayout(run);
    assert.throws(() => validateHexProof(run));
  }
  const zone = structuredClone(fixtures[1]);
  zone.proof.initial.mines[0] = '1,0'; zone.proof.final.mines[0] = '1,0'; hashLayout(zone);
  assert.throws(() => validateHexProof(zone));
  const exit = structuredClone(fixtures[2]); exit.proof.final.won = true; exit.proof.final.reason = 'finish';
  assert.throws(() => validateHexProof(exit));
  const reason = structuredClone(fixtures[2]); reason.proof.final.reason = 'rift';
  assert.throws(() => validateHexProof(reason));
});
