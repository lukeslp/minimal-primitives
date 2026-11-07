/* Run: node tests/scores-compat.cjs. Only loopback fixtures; no original boards. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const categories = ['unassisted', 'assisted', 'repeat', 'repeat-assisted', 'practice'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

async function transportTests() {
  const scope = { URLSearchParams }; vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/scores-transport.js'), 'utf8'), scope);
  const { handle } = scope.MinimalScoresTransport;
  const calls = [];
  const identity = { game: 'bridges', mode: 'classic', puzzleId: 'b01', layoutHash: 'b'.repeat(64), rulesVersion: 'pinned-rules', scoringPolicy: 'time-v1' };
  const profile = { secret: 'a'.repeat(64), nickname: 'Luke', sharing: false, scores: [] };
  let a = { id: 'attempt-1', identity, practice: true, optedIn: false, finished: true }, active = { game: { id: 'bridges' } }, saves = 0;
  const context = { profile, get attempt() { return a; }, get active() { return active; }, persistProfile() { saves++; },
    async api(url, options) { calls.push({ url, options }); return url.startsWith('boards?') ? { entries: [{ rank: 1, nickname: '<safe>', elapsedMs: 12345 }] } : { removed: true }; } };
  const payload = { request: 'request-1', action: 'state', board: { game: 'bridges', puzzle: 'b01', mode: 'classic-v1', layoutHash: identity.layoutHash } };
  let state = await handle(payload, context);
  equal(JSON.parse(JSON.stringify(state.profile)), { nickname: 'Luke', sharing: false }); ok(!JSON.stringify(state).includes(profile.secret));
  await handle({ ...payload, action: 'preference', nickname: ' Future ' }, context);
  equal(profile.nickname, 'Future'); equal(profile.sharing, true); equal(a.optedIn, false); equal(a.practice, true); equal(calls.length, 0); equal(saves, 1);
  for (const nickname of ['', 'x'.repeat(21), '<script>', 7]) await assert.rejects(handle({ ...payload, action: 'preference', nickname }, context));
  for (const category of categories) {
    const board = await handle({ ...payload, action: 'board', category }, context);
    equal(board.entries[0].alias, '<safe>'); equal(board.entries[0].seconds, 12);
    const query = new URLSearchParams(calls.at(-1).url.split('?')[1]);
    for (const [key, value] of Object.entries(identity)) equal(query.get(key), value);
    equal(query.get('category'), category);
    ok(!query.has('layout')); ok(!query.has('puzzle'));
  }
  for (const board of [{ ...payload.board, mode: 'circuits-v1' }, { ...payload.board, puzzle: 'b02' },
    { ...payload.board, layoutHash: 'c'.repeat(64) }, { ...payload.board, game: 'slant' }]) await assert.rejects(handle({ ...payload, board }, context));
  for (const action of ['runs', 'finish', 'publish', 'fetch']) await assert.rejects(handle({ ...payload, action }, context));
  await assert.rejects(handle({ ...payload, attempt: 'old' }, context));
  await assert.rejects(handle({ ...payload, action: 'board', category: 'invalid' }, context));
  a.run = 'run-1'; a.optedIn = true; a.practice = false;
  a.result = { ranked: true, score: { id: 'score-1', run: a.run, identity, category: 'repeat-assisted', elapsedMs: 45678 } };
  a.completion = Promise.resolve(a.result); profile.scores.push('score-1');
  state = await handle(payload, context); equal(state.result.seconds, 45); equal(state.result.published, true);
  await assert.rejects(handle({ ...payload, action: 'remove', id: 'other-owner' }, context));
  await handle({ ...payload, action: 'remove', id: 'score-1' }, context); equal(profile.scores, []); equal(calls.at(-1).options.method, 'DELETE');
  state = await handle(payload, context); equal(state.result.published, false);
  await assert.rejects(handle({ ...payload, action: 'remove', id: 'score-1' }, context));
  ok(calls.every(c => !c.options || c.options.method === 'DELETE'), 'Transport must never POST');
  // A pending completion/start cannot return a receipt into a replacement attempt.
  let resolve; a.ready = new Promise(r => { resolve = r; });
  const stale = handle(payload, context); a = { ...a, id: 'new' }; resolve(); await assert.rejects(stale);
  a.ready = null; a.completion = null; a.result.score = { ...a.result.score, run: 'another-run' };
  equal((await handle(payload, context)).result, null);
  const count = calls.length; active = { game: { id: 'slant' } }; await assert.rejects(handle(payload, context)); equal(calls.length, count);
  console.log('Parent contract: identity mapping, future-only preference, receipts, deletion and stale-attempt rejection passed.');
}

(async () => {
  await transportTests();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-scores-compat-'));
  let browser, server;
  const requests = [], external = [], pageErrors = [], runs = new Map(), scores = new Map();
  let failBoards = false, emptyBoards = false, failFinish = false, failDelete = false, holdBoard = null;
  try {
    console.log(execFileSync('python3', [path.join(__dirname, 'scores-fixtures/generate.py'), temp], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).trim());
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fixture');
      const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname.startsWith('/api/v1/')) {
        let text = ''; for await (const chunk of req) text += chunk;
        const body = text ? JSON.parse(text) : null;
        requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method, body });
        assert.equal(req.headers.authorization, 'Bearer ' + 'a'.repeat(64));
        if (url.pathname === '/api/v1/runs' && req.method === 'POST') {
          const run = 'run-' + (runs.size + 1); runs.set(run, body); return json(201, { run, startedAt: Date.now() });
        }
        const finish = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/finish$/);
        if (finish) {
          if (failFinish) return json(503, { error: 'Offline fixture' });
          const run = finish[1], start = runs.get(run); assert.ok(start);
          const category = body.practice ? 'practice' : body.repeat ? (body.assisted ? 'repeat-assisted' : 'repeat') : body.assisted ? 'assisted' : 'unassisted';
          const score = { id: 'score-' + run, run, identity: start.identity, category, value: 65432, elapsedMs: 65432 };
          if (body.publish) scores.set(score.id, score);
          return json(200, { score, ranked: !!body.publish });
        }
        if (url.pathname === '/api/v1/boards') {
          if (holdBoard) await holdBoard;
          if (failBoards) return json(503, { error: 'Offline fixture' });
          return json(200, { category: url.searchParams.get('category'), entries: emptyBoards ? [] : [{ id: 'stub', rank: 1, nickname: '<Luke & friends>', value: 65432, elapsedMs: 65432 }] });
        }
        if (req.method === 'DELETE') {
          if (failDelete) return json(503, { error: 'Offline fixture' });
          scores.delete(decodeURIComponent(url.pathname.split('/').at(-1))); return json(200, { removed: true });
        }
        return json(404, { error: 'Unknown fixture route' });
      }
      let file;
      if (url.pathname.startsWith('/preview/anthology/')) file = path.join(temp, url.pathname.slice('/preview/anthology/'.length));
      else if (url.pathname.startsWith('/fixture/')) file = path.join(__dirname, 'scores-fixtures', url.pathname.slice('/fixture/'.length));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
      const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ viewport: { width: 980, height: 820 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.includes('scores-api')) { external.push(url.href); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(origin + '/fixture/parent.html');
    const launch = async (game, mode, sharing, puzzle) => {
      await page.evaluate(args => Fixture.launch(...args), [game, mode, sharing, puzzle]);
      await page.waitForFunction(() => !!Fixture.attempt);
      await page.evaluate(() => Fixture.attempt.ready);
      const frame = page.frames().find(f => f.url().includes('/games/'));
      await frame.waitForFunction(() => !!window.MinimalAdapter && !!document.querySelector('#scores'));
      return frame;
    };
    const open = async frame => {
      await frame.locator('#settings-btn').click();
      await frame.getByRole('button', { name: 'Scores for this puzzle', exact: true }).click();
      await frame.locator('#score-submit').waitFor({ state: 'visible' });
      await frame.waitForFunction(() => document.querySelector('#scores-status').textContent !== 'Loading…');
    };
    const close = async frame => { await frame.getByRole('button', { name: 'Close Scores', exact: true }).click(); };
    const solve = async (frame, game) => {
      // Derive the pinned engine solution; use native input/commit paths below.
      const answer = await frame.evaluate(game => {
        const d = window['__' + game], E = game === 'bridges' ? Bridges : Slant;
        return game === 'bridges' ? E.logical(d.puzzle).lo : E.count(d.puzzle, 2).answer;
      }, game);
      ok(Array.isArray(answer));
      if (game === 'slant') {
        for (let i = 0; i < answer.length; i++) {
          await frame.locator('#board .cell').nth(i).focus();
          for (let n = 0; n < 3 && await frame.evaluate(i => __slant.S.cells[i], i) !== answer[i]; n++) await frame.locator('#board .cell').nth(i).press('Enter');
          equal(await frame.evaluate(i => __slant.S.cells[i], i), answer[i]);
        }
      } else {
        // Bridges exposes edge keyboard controls on island nodes; fixture completion
        // uses its public state hook plus an actual Hint commit for the final edge.
        await frame.evaluate(answer => {
          const d = __bridges, last = answer.findLastIndex(v => v > 0);
          d.S.cells.splice(0, d.S.cells.length, ...answer);
          d.S.cells[last] = 0;
        }, answer);
        await frame.locator('#hint-btn').click();
        await frame.locator('#hint-btn').click();
      }
      const result = await frame.evaluate(game => ({ solved: window['__' + game].S.solved, cells: window['__' + game].S.cells, hint: document.querySelector('#feedback').textContent, mode: document.querySelector('#mode')?.value }), game);
      ok(result.solved, 'Native completion must succeed: ' + JSON.stringify({ game, answer, result }));
      await page.waitForFunction(() => !!Fixture.attempt?.finished);
      await page.evaluate(() => Fixture.attempt.completion);
    };
    for (const [game, mode] of [['bridges', 'classic'], ['bridges', 'circuits'], ['slant', 'standard'], ['slant', 'hard']]) {
      // Fresh browser storage ensures this is a new attempt in each mode.
      await page.evaluate(() => localStorage.clear());
      const start = requests.length, frame = await launch(game, mode);
      await open(frame);
      equal(await frame.locator('#score-alias').inputValue(), 'Luke');
      equal(await frame.locator('#scores-list li').count(), 1);
      equal(await frame.locator('#scores-list li span').nth(1).textContent(), '<Luke & friends>');
      equal(await frame.locator('#scores-list li script').count(), 0);
      for (const category of categories) { await frame.locator('#scores-category').selectOption(category); await frame.waitForFunction(() => document.querySelector('#scores-status').textContent !== 'Loading…'); }
      await close(frame);
      equal(await frame.evaluate(() => document.activeElement.id), 'settings-btn');

      await solve(frame, game);
      await frame.locator('#scores-btn').click();
      await frame.waitForFunction(() => document.querySelector('#scores-result').textContent.includes('1:05'));
      await frame.locator('#score-remove').waitFor({ state: 'visible' });
      const beforePreference = requests.filter(r => r.method === 'POST').length;
      await frame.locator('#score-submit button').click();
      await frame.waitForFunction(() => document.querySelector('#scores-status').textContent.includes('future new attempts'));
      equal(requests.filter(r => r.method === 'POST').length, beforePreference);
      failDelete = true;
      await frame.locator('#score-remove').click();
      await frame.waitForFunction(() => document.querySelector('#scores-status').textContent.includes('Could not remove'));
      ok((await page.evaluate(() => Fixture.profile.scores.length)) > 0);
      failDelete = false;
      await frame.locator('#score-remove').click();
      await frame.locator('#score-remove').waitFor({ state: 'hidden' });
      const calls = requests.slice(start);
      equal(calls.filter(r => r.path === '/api/v1/runs').length, 1);
      equal(calls.filter(r => r.path.endsWith('/finish')).length, 1);
      ok(calls.filter(r => r.path === '/api/v1/boards').every(r => r.query.game === game && r.query.mode === mode && r.query.layoutHash?.length === 64 && r.query.rulesVersion && r.query.scoringPolicy === 'time-v1'));
      console.log(`Browser: ${game}/${mode} native dialog, categories, receipt reuse and removal passed.`);
    }
    // Manual opt-in on a finished local attempt is a profile write only.
    await page.evaluate(() => localStorage.clear());
    let frame = await launch('slant', 'standard', false);
    const startLocal = requests.length;
    await solve(frame, 'slant'); await frame.locator('#scores-btn').click();
    await frame.locator('#score-submit').waitFor({ state: 'visible' });
    await frame.locator('#score-alias').fill('FuturePlayer'); await frame.locator('#score-submit button').click();
    await frame.waitForFunction(() => document.querySelector('#scores-status').textContent.includes('future new attempts'));
    equal(requests.slice(startLocal).filter(r => r.method === 'POST').length, 0);
    equal(await page.evaluate(() => Fixture.attempt.optedIn), false);
    equal(await page.evaluate(() => Fixture.profile.nickname), 'FuturePlayer');
    equal(await page.evaluate(() => Fixture.profile.sharing), true);
    await close(frame);
    // The next new attempt can use that shared opt-in; the old attempt stays local.
    await page.evaluate(() => localStorage.clear());
    frame = await launch('bridges', 'classic');
    equal(await page.evaluate(() => Fixture.attempt.optedIn), true);
    await solve(frame, 'bridges');
    equal(requests.filter(r => r.path.endsWith('/finish')).at(-1).body.nickname, 'FuturePlayer');
    ok(await page.evaluate(() => Fixture.attempt.result.ranked));
    // Shared nickname is authoritative across games; mid-attempt changes stay local.
    await page.evaluate(() => localStorage.clear());
    frame = await launch('bridges', 'classic'); await open(frame);
    equal(await frame.locator('#score-alias').inputValue(), 'FuturePlayer');
    await frame.locator('#score-alias').fill('Luke'); await frame.locator('#score-submit button').click();
    await frame.waitForFunction(() => document.querySelector('#scores-status').textContent.includes('future new attempts'));
    equal(await page.evaluate(() => Fixture.attempt.practice), true);
    await close(frame);
    const postCount = requests.filter(r => r.path.endsWith('/finish')).length;
    await solve(frame, 'bridges'); equal(requests.filter(r => r.path.endsWith('/finish')).length, postCount);
    // Bad envelopes cannot settle an outstanding native request.
    await page.evaluate(() => localStorage.clear()); frame = await launch('slant', 'hard');
    await page.evaluate(() => Fixture.hold(true));
    await frame.locator('#settings-btn').click(); await frame.getByRole('button', { name: 'Scores for this puzzle', exact: true }).click();
    await page.waitForFunction(() => Fixture.held.length === 1);
    const heldRequest = await page.evaluate(() => Fixture.held[0].data.payload.request);
    await frame.evaluate(request => {
      const data = { v: 1, nonce: MinimalBridge.nonce, type: 'scores-response', payload: { request, result: { profile: { nickname: 'Forged' } } } };
      window.postMessage(data, location.origin);
      window.dispatchEvent(new MessageEvent('message', { source: parent, origin: 'https://invalid.example', data }));
    }, heldRequest);
    await page.evaluate(() => {
      const target = document.querySelector('iframe').contentWindow, request = Fixture.held[0].data.payload.request;
      const valid = { v: 1, nonce: Fixture.nonce, type: 'scores-response', payload: { request, result: { profile: { nickname: 'Forged' } } } };
      for (const data of [{ ...valid, nonce: 'wrong' }, { ...valid, v: 2 }, { ...valid, type: 'other' }, { ...valid, payload: { ...valid.payload, request: 'wrong' } }]) target.postMessage(data, location.origin);
    });
    equal(await frame.locator('#score-alias').inputValue(), '');
    await page.evaluate(() => Fixture.release());
    await frame.locator('#score-submit').waitFor({ state: 'visible' });
    equal(await frame.locator('#score-alias').inputValue(), 'Luke');
    // Out-of-order category reads and a closed view never overwrite a newer view.
    let releaseBoard; holdBoard = new Promise(r => { releaseBoard = r; });
    await frame.locator('#scores-category').selectOption('assisted');
    await close(frame); releaseBoard(); holdBoard = null;
    await open(frame); await close(frame);

    // Empty and offline boards leave the native controls and gameplay usable.
    emptyBoards = true; await open(frame); equal(await frame.locator('#scores-status').textContent(), 'No scores yet.'); await close(frame);
    failBoards = true; emptyBoards = false; await open(frame);
    equal(await frame.locator('#scores-status').textContent(), 'Scores are unavailable. Your game is saved on this device.'); await close(frame);

    await frame.locator('#board .cell').first().focus(); await page.keyboard.press('/');
    ok(await frame.evaluate(() => __slant.S.cells.some(Boolean)));
    ok(await frame.evaluate(() => !!localStorage.getItem('slant.current.v1')));
    failBoards = false;
    // A failed main finish produces no native retry or historical publication.
    failFinish = true; await solve(frame, 'slant');
    await frame.locator('#scores-btn').click();
    await frame.waitForFunction(() => document.querySelector('#scores-result').textContent.includes('no shared score'));
    const failedPosts = requests.filter(r => r.method === 'POST').length;
    await frame.locator('#score-submit button').click();
    await frame.waitForFunction(() => document.querySelector('#scores-status').textContent.includes('future new attempts'));
    equal(requests.filter(r => r.method === 'POST').length, failedPosts); failFinish = false;
    // An absent parent response times out without creating or finishing any run.
    await page.evaluate(() => Fixture.hold(true));
    await frame.locator('#scores-category').selectOption('repeat');
    await page.waitForFunction(() => Fixture.held.length > 0);
    await frame.waitForFunction(() => document.querySelector('#scores-status').textContent === 'Scores are unavailable. Your game is saved on this device.', undefined, { timeout: 15000 });
    equal(requests.filter(r => r.method === 'POST').length, failedPosts);
    await page.evaluate(() => Fixture.release());
    equal(external, []); equal(pageErrors, []);
    ok(!requests.some(r => r.path.includes('scores-api')));
    console.log(`PASS: ${checks} assertions; 4 native game/mode paths, future-only shared profile, security guards, empty/offline boards, stale views and failed finishes. No external requests.`);
    await context.close();
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
