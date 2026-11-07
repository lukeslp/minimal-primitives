/* Actual export, native inputs, real Python/SQLite/Node API. Luke Steuber.
 * HTTPS fixtures use a loopback TLS proxy, so Chromium itself enforces CORS.
 * No route.fulfill/API stub, web security flags, production requests or new deps.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { ROOT } = require('./real-score-fixtures/proofs.cjs');
const { chromium } = require(process.env.MINIMAL_PLAYWRIGHT || '/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const CHROME = process.env.MINIMAL_CHROME || '/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const TEST_ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build/html');
const PREFIX = 'lukesteuber.minimal.collection.v1:';
const SHELL = '/preview/anthology/';
const ports = [...Array.from({ length: 9 }, (_, n) => n + 5011), ...Array.from({ length: 9 }, (_, n) => n + 5051)];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

async function checkedListen(server) {
  for (const port of ports) {
    const probe = net.createServer();
    try { await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); }); }
    catch { continue; }
    await new Promise(resolve => probe.close(resolve));
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      return port;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw Error('No free approved HTTPS fixture port; 5010 is excluded');
}

async function main() {
  assert.ok(fs.existsSync(path.join(BUILD, 'BUILD_MANIFEST.json')), 'Build the target before running acceptance');
  assert.equal(JSON.parse(fs.readFileSync(path.join(BUILD, 'settings.json'))).apiBase, '', 'The default ZIP must remain practice only');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-real-browser-'));
  let browser, service, tls, egress;
  const tunnels = new Set();
  let base, shellOrigin, apiOrigin, forbiddenOrigin;
  const calls = [], blocked = [], pageErrors = [], proxyErrors = [], checks = [], networkErrors = [], corsMessages = [];
  const deniedEgress = new Set();
  const equal = (a, b, message) => assert.deepEqual(a, b, message || 'Real score acceptance mismatch');
  const posts = from => calls.slice(from).filter(c => c.method === 'POST');
  const starts = from => posts(from).filter(c => c.path === '/api/v1/runs');
  const finishes = from => posts(from).filter(c => c.path.endsWith('/finish'));
  const passed = name => { checks.push(name); console.log(`PASS browser: ${name}`); };
  try {
    // Temporary self-signed TLS terminates only on loopback. The test context
    // trusts it; normal browser CORS and preflight remain enabled.
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=minimal-real-score.test', '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem')], { stdio: 'ignore' });
    tls = https.createServer({ key: fs.readFileSync(path.join(temp, 'key.pem')), cert: fs.readFileSync(path.join(temp, 'cert.pem')) }, async (req, res) => {
      try {
        const url = new URL(req.url, 'https://' + req.headers.host);
        if (url.origin === apiOrigin && url.pathname.startsWith('/api/v1/')) {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks);
          const headers = { ...req.headers, host: new URL(base).host };
          // Forward the original browser Origin/Authorization unchanged. Never
          // synthesize ACAO or intercept OPTIONS: the Python service owns CORS.
          const upstream = http.request(new URL(url.pathname + url.search, base), { method: req.method, headers }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
              const body = Buffer.concat(chunks);
              const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
                origin: req.headers.origin, authorized: /^Bearer [a-f0-9]{64}$/.test(req.headers.authorization || ''),
                body: raw.length ? JSON.parse(raw) : null, status: response.statusCode,
                response: body.length ? JSON.parse(body) : null };
              calls.push(call); // Only redacted metadata; never log bearer headers.
              res.writeHead(response.statusCode, response.headers); res.end(body);
            });
          });
          upstream.on('error', error => { proxyErrors.push(error.message); res.writeHead(502); res.end(); });
          upstream.end(raw); return;
        }
        if (![shellOrigin, forbiddenOrigin].includes(url.origin) || !url.pathname.startsWith(SHELL)) {
          res.writeHead(404); res.end(); return;
        }
        const relative = decodeURIComponent(url.pathname.slice(SHELL.length)) || 'index.html';
        if (relative === 'settings.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ apiBase: apiOrigin + '/api/v1/' })); return;
        }
        const file = path.resolve(BUILD, relative);
        if (!file.startsWith(BUILD + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
      } catch (error) { proxyErrors.push(error.message); res.writeHead(500); res.end(); }
    });
    const port = await checkedListen(tls);
    shellOrigin = `https://minimal-real-score.test:${port}`;
    apiOrigin = `https://minimal-real-score-api.test:${port}`;
    forbiddenOrigin = `https://minimal-forbidden.test:${port}`;
    // Do not use Playwright request interception: Chromium treats an intercepted
    // request as already preflighted. A real CONNECT proxy provides fail-closed
    // egress without changing the browser's Fetch/CORS implementation.
    egress = http.createServer((req, res) => { deniedEgress.add('HTTP proxy request'); res.writeHead(403); res.end(); });
    egress.on('connect', (req, client, head) => {
      if (![shellOrigin, apiOrigin, forbiddenOrigin].map(origin => new URL(origin).host).includes(req.url)) {
        deniedEgress.add(req.url); client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
      }
      const upstream = net.connect(port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client); client.pipe(upstream);
      });
      for (const socket of [client, upstream]) { tunnels.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => tunnels.delete(socket)); }
      client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
    });
    const proxyPort = await checkedListen(egress);
    const workerEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', MINIMAL_ROOT: ROOT, MINIMAL_REAL_SCORE_ORIGIN: shellOrigin };
    service = spawn('python3', [path.join(__dirname, 'test_real_scores.py'), '--serve'], { cwd: ROOT, env: workerEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let startup = '', stderr = '';
    service.stderr.on('data', chunk => { stderr += chunk; });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Local Python service startup timed out')), 15000);
      service.once('exit', () => { clearTimeout(timer); reject(Error('Local service startup failed: ' + stderr)); });
      service.stdout.on('data', chunk => {
        startup += chunk;
        if (!startup.includes('\n')) return;
        clearTimeout(timer);
        try {
          const ready = JSON.parse(startup.split('\n')[0]);
          const target = new URL(ready.base);
          assert.equal(target.hostname, '127.0.0.1'); assert.ok(ports.includes(Number(target.port)));
          assert.ok(!path.resolve(ready.db).startsWith(TEST_ROOT + path.sep));
          resolve(ready.base);
        } catch (error) { reject(error); }
      });
    });
    browser = await chromium.launch({ executablePath: CHROME, headless: true,
      proxy: { server: `http://127.0.0.1:${proxyPort}` }, args: ['--proxy-bypass-list=<-loopback>'] });
    async function contextAt(origin = shellOrigin) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1050, height: 900 }, reducedMotion: 'reduce' });
      context.on('request', request => {
        const url = new URL(request.url());
        if (![shellOrigin, apiOrigin, forbiddenOrigin].includes(url.origin) || url.pathname.includes('scores-api'))
          blocked.push(url.origin + url.pathname);
      });
      context.setDefaultTimeout(12000);
      const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
      page.on('requestfailed', request => { const url = new URL(request.url()); networkErrors.push({ path: url.origin + url.pathname, error: request.failure()?.errorText }); });
      page.on('console', message => { if (/CORS|preflight|certificate|local network/i.test(message.text())) corsMessages.push(message.text()); });
      await page.goto(origin + SHELL);
      await page.getByRole('button', { name: 'Notan', exact: true }).waitFor();
      return { context, page };
    }
    async function optIn(page, nickname) {
      await page.locator('#scores-button').click();
      await page.locator('#nickname').fill(nickname);
      await page.locator('#share-opt-in').check();
      await page.locator('#save-profile').click();
      equal(await page.locator('#share-opt-in').isChecked(), true);
      equal(await page.locator('#profile-status').textContent(), 'Saved.');
      await page.locator('#scores .close').click();
    }
    async function launch(page, game) {
      const title = { notan: 'Notan', bridges: 'Bridges', slant: 'Slant' }[game];
      await page.locator('#tiles button').filter({ has: page.locator('.sr-only', { hasText: new RegExp('^' + title + '$') }) }).click();
      const frame = await (await page.locator('#player iframe').elementHandle()).contentFrame();
      await frame.waitForFunction(game => !!window['__' + game] && !!window.MinimalAdapter, game);
      return frame;
    }
    async function solveNotan(frame) {
      // Read the pinned board's solution only; every move is a native key event.
      const answer = await frame.evaluate(() => Array.from(__notan.S.puz.sol));
      for (let i = 0; i < answer.length; i++) if (answer[i]) {
        if (await frame.evaluate(i => __notan.S.cells[i], i) === 1) continue;
        await frame.locator('#board .cell').nth(i).focus();
        await frame.locator('#board .cell').nth(i).press('Enter');
      }
      await frame.waitForFunction(() => __notan.S.solved);
    }
    async function waitFinish(from) {
      await assertEventually(() => finishes(from).some(c => c.status === 200), 'real API finish');
      equal(finishes(from).map(c => c.status), [200]);
      return finishes(from)[0];
    }
    async function assertEventually(predicate, label) {
      const until = Date.now() + 12000;
      while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(predicate(), label);
    }

    // No storage-seeded sharing profile. Opt in using the actual parent UI.
    {
      const { context, page } = await contextAt();
      const from = calls.length;
      const frame = await launch(page, 'notan');
      await solveNotan(frame);
      equal(posts(from), []);
      await frame.locator('#minimal-home').click();
      await optIn(page, 'Shell Player');
      equal(posts(from), []);
      // A new context below starts a genuinely blank eligible board. Opening
      // Notan here would correctly select the newly unlocked Cup board.
      await context.close();
      passed('default local solve and future-only opt-in never upload history');
    }
    {
      const { context, page } = await contextAt();
      await optIn(page, 'Shell Player');
      const from = calls.length;
      const frame = await launch(page, 'notan');
      await assertEventually(() => starts(from).length === 1, 'real shell start');
      await solveNotan(frame);
      const finish = await waitFinish(from);
      equal(starts(from).length, 1); equal(finish.response.ranked, true);
      equal(finish.response.score.category, 'unassisted');
      equal(finish.response.score.value, finish.response.score.elapsedMs);
      assert.ok(starts(from)[0].authorized && finish.authorized);
      equal(finish.origin, shellOrigin);
      await frame.locator('#settings-btn').click();await frame.getByRole('button',{name:'Collection scores',exact:true}).click();
      await page.locator('#score-list .score-row').waitFor();
      assert.ok((await page.locator('#score-list').textContent()).includes('Shell Player'));
      const profile = await page.evaluate(prefix => { const p = JSON.parse(localStorage.getItem(prefix + 'profile')); return { sharing: p.sharing, nickname: p.nickname, scores: p.scores }; }, PREFIX);
      equal(profile, { sharing: true, nickname: 'Shell Player', scores: [finish.response.score.id] });
      await page.locator('#remove-scores').click();
      await page.waitForFunction(() => document.querySelector('#profile-status').textContent.includes('have been removed'));
      equal(calls.slice(from).filter(c => c.method === 'DELETE').map(c => c.status), [200]);
      equal(posts(from).length, 2);
      await context.close();
      passed('Notan native keyboard solve, parent profile, real board read and withdrawal');
    }
    {
      const { context, page } = await contextAt();
      await optIn(page, 'Hint Player');
      const from = calls.length;
      const frame = await launch(page, 'notan');
      await assertEventually(() => starts(from).length === 1, 'assisted shell start');
      await frame.locator('#board .cell').first().focus();
      await frame.locator('#board .cell').first().press('Enter');
      await frame.locator('#hint-btn').click();
      await frame.locator('#undo-btn').click();
      await solveNotan(frame);
      const finish = await waitFinish(from);
      equal(finish.body.assisted, true); equal(finish.response.score.category, 'assisted');
      equal(starts(from).length, 1);
      await context.close();
      passed('real shell Hint remains assisted through Undo and proof acceptance');
    }
    {
      const { context, page } = await contextAt();
      const from = calls.length;
      const frame = await launch(page, 'notan');
      await frame.locator('#board .cell').first().focus();
      await frame.locator('#board .cell').first().press('Enter');
      await frame.locator('#settings-btn').click();await frame.getByRole('button',{name:'Collection scores',exact:true}).click();
      await page.locator('#nickname').fill('Future Player');
      await page.locator('#share-opt-in').check();
      await page.locator('#save-profile').click();
      await page.locator('#scores .close').click();await frame.locator('#settings').evaluate(d=>d.close());
      await solveNotan(frame);
      await page.waitForFunction(prefix => (JSON.parse(localStorage.getItem(prefix + 'results')) || []).length > 0, PREFIX);
      equal(posts(from), []);
      equal(await page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + 'results')).at(-1).practice, PREFIX), true);
      await context.close();
      passed('mid-attempt parent opt-in preserves practice with no start/finish upload');
    }
    {
      const { context, page } = await contextAt(forbiddenOrigin);
      const from = calls.length;
      // A normal cross-origin JSON/Auth fetch forces a real browser OPTIONS.
      const outcome = await page.evaluate(async api => {
        try { await fetch(api + '/api/v1/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + crypto.randomUUID().replaceAll('-', '').repeat(2) }, body: '{}' }); return 'unexpected'; }
        catch (error) { return error.name; }
      }, apiOrigin);
      equal(outcome, 'TypeError');
      await assertEventually(() => calls.slice(from).some(c => c.method === 'OPTIONS'),
        'forbidden preflight reached real service: ' + JSON.stringify({ calls: calls.slice(from).map(c => ({ method: c.method, status: c.status, origin: c.origin, path: c.path })), networkErrors, corsMessages, blocked }));
      equal(posts(from), []);
      assert.ok(calls.slice(from).some(c => c.method === 'OPTIONS' && c.status === 403));
      await context.close();
      passed('Chromium enforces forbidden-origin CORS before POST');
    }
    for (const [game, mode] of [['bridges', 'classic'], ['slant', 'standard'], ['slant', 'hard']]) {
      const { context, page } = await contextAt();
      // Skip only the unscored primer. No prepared board, completed progress,
      // parent profile or run is injected. Mode is a native saved preference.
      await page.evaluate(({ game, mode }) => {
        localStorage.setItem(`lukesteuber.minimal.${game}:${game}.primer.v1`, '1');
        if (game === 'slant') localStorage.setItem('lukesteuber.minimal.slant:slant.settings.v1', JSON.stringify({ version: 1, theme: 'light', motion: 'reduce', zoom: 'fit', difficulty: 'Hard', mode: mode === 'hard' ? 'Hard' : 'Standard' }));
      }, { game, mode });
      await optIn(page, 'Native Player');
      const from = calls.length;
      const frame = await launch(page, game);
      await assertEventually(() => starts(from).length === 1, `native ${game} start`);
      await frame.locator('#settings-btn').click();
      await frame.getByRole('button', { name: 'Scores for this puzzle', exact: true }).click();
      await frame.locator('#score-submit').waitFor({ state: 'visible' });
      equal(await frame.locator('#score-alias').inputValue(), 'Native Player');
      await frame.getByRole('button', { name: 'Close Scores', exact: true }).click();
      if (game === 'slant') {
        const answer = await frame.evaluate(() => Slant.count(__slant.puzzle, 2).answer);
        for (let i = 0; i < answer.length; i++) {
          if (await frame.evaluate(i => __slant.S.cells[i], i) === answer[i]) continue;
          await frame.locator('#board .cell').nth(i).focus();
          for (let n = 0; n < 3 && await frame.evaluate(i => __slant.S.cells[i], i) !== answer[i]; n++)
            await frame.locator('#board .cell').nth(i).press('Enter');
          equal(await frame.evaluate(i => __slant.S.cells[i], i), answer[i], `Native ${game}/${mode} cell ${i}`);
        }
      } else {
        const edges = await frame.evaluate(() => {
          const p = __bridges.puzzle, answer = Bridges.logical(p).lo;
          return Bridges.topology(p).edges.map(({ a, b }, i) => ({ a, value: answer[i],
            key: p.islands[b].x > p.islands[a].x ? 'ArrowRight' : p.islands[b].x < p.islands[a].x ? 'ArrowLeft' : p.islands[b].y > p.islands[a].y ? 'ArrowDown' : 'ArrowUp' }));
        });
        for (const edge of edges) for (let n = 0; n < edge.value; n++) {
          const island = frame.locator('#board .island').nth(edge.a);
          await island.focus(); await island.press('Shift+' + edge.key);
        }
      }
      await frame.waitForFunction(game => window['__' + game].S.solved, game);
      const finish = await waitFinish(from);
      equal(finish.response.ranked, true); equal(finish.response.score.identity.mode, mode);
      equal(finish.response.score.category, 'unassisted');
      await frame.locator('#scores-btn').click();
      await frame.locator('#score-remove').waitFor({ state: 'visible' });
      assert.ok((await frame.locator('#scores-result').textContent()).includes('Unassisted'));
      for (const category of ['unassisted', 'assisted', 'repeat', 'repeat-assisted', 'practice']) {
        await frame.locator('#scores-category').selectOption(category);
        await frame.waitForFunction(() => document.querySelector('#scores-status').textContent !== 'Loading…');
      }
      await frame.locator('#score-remove').click();
      await frame.locator('#score-remove').waitFor({ state: 'hidden' });
      equal(starts(from).length, 1); equal(finishes(from).length, 1);
      equal(calls.slice(from).filter(c => c.method === 'DELETE').map(c => c.status), [200]);
      const reads = calls.slice(from).filter(c => c.path === '/api/v1/boards' && c.method === 'GET');
      for (const read of reads) for (const [key, value] of Object.entries(finish.response.score.identity)) equal(read.query[key], value);
      assert.ok(reads.length >= 5);
      equal(await page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + 'profile')).scores, PREFIX), []);
      await context.close();
      passed(`${game}/${mode} native Scores shares parent profile/receipt, categories and removal; one start/finish`);
    }
    assert.ok(calls.some(c => c.method === 'OPTIONS' && c.status === 204 && c.origin === shellOrigin), 'Real allowed preflight observed');
    equal(proxyErrors, []); equal(pageErrors, []); equal(blocked, [], 'Any production/external request is a test failure');
    console.log(`PASS: ${checks.length} browser scenarios; HTTPS/CORS -> loopback Python -> SQLite -> pinned Node. No application external requests or external connections; ${deniedEgress.size} browser background destinations denied locally.`);
  } finally {
    await browser?.close();
    for (const socket of tunnels) socket.destroy();
    if (service) {
      let timer;
      service.stdin.end();
      if (service.exitCode === null) await Promise.race([once(service, 'exit'), new Promise(resolve => {
        timer = setTimeout(() => { if (service.exitCode === null) service.kill('SIGTERM'); resolve(); }, 5000);
      })]);
      clearTimeout(timer);
    }
    if (tls?.listening) await new Promise(resolve => tls.close(resolve));
    if (egress?.listening) await new Promise(resolve => egress.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
