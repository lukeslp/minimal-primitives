'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = '/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core';
const CHROME = '/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const canonical = v => JSON.stringify(v, (_, x) => x && !Array.isArray(x) && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
let temp, server, base, browser, validate, keepEvidence = false;
const errors = [], missing = [];
before(async () => {
  validate = (await import(pathToFileURL(path.join(ROOT, 'adapters/hex-validator.mjs')))).validateHexProof;
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-hex-'));
  const result = spawnSync('python3', ['-c', `
import sys,json,shutil
from pathlib import Path
sys.path.insert(0,'tools')
from transforms import transform as base
from hex_recipe import transform, exact
out=Path(sys.argv[1])
game=json.load(open('sources.json'))['games'][0]
assert game['id']=='hexsweeper'
for item in game['files']:
 p=item['path']; raw=Path('imports')/p
 dst=out/'collection/games'/p; dst.parent.mkdir(parents=True,exist_ok=True)
 if raw.suffix in {'.html','.js','.css','.mjs'}: dst.write_text(base(game,p,raw.read_text()))
 else: shutil.copyfile(raw,dst)
 dst=out/'original/games'/p;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(raw,dst)
for name in ['bootstrap.js','hooks.js']: shutil.copyfile(Path('adapters')/name,out/'collection'/name)
for bad in ['none','x x']:
 try: exact(bad,'x','y','fixture')
 except ValueError: pass
 else: raise AssertionError('unguarded anchor')
for p in ['hexsweeper/bounded.html','hexsweeper/infinite.html','hexsweeper/sphere/sphere.js']:
 t=(Path('imports')/p).read_text()
 # A changed boot anchor must fail closed on the generated copy.
 old='  function boot(opts) {' if p.endswith('sphere.js') else '  function boot(userOpts = {}) {'
 try: base(game,p,t.replace(old,old.replace('boot','drifted')))
 except ValueError: pass
 else: raise AssertionError('source drift accepted')
` , temp], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/host') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><body style="margin:0"><script>window.events=[];addEventListener("message",e=>events.push(e.data));</script></body></html>'); return;
    }
    const file = path.join(temp, decodeURIComponent(u.pathname));
    if (!file.startsWith(temp) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.push(u.pathname); res.writeHead(404); res.end(); return; }
    const ext = path.extname(file);
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.webp':'image/webp', '.jpg':'image/jpeg', '.png':'image/png' })[ext] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await require(PLAYWRIGHT).chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-accelerated-2d-canvas'] });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); if (temp && !keepEvidence) fs.rmSync(temp, { recursive: true, force: true }); });

async function surface(entry, { original = false, viewport = { width: 1024, height: 768 }, mobile = false, reduced = true, frozen = false } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await context.addInitScript(({ unlock, reduced }) => {
    // The pinned collection entry intentionally scopes Infinite to Light/Dark.
    // Exercise embedded legacy lanes without changing the exported product.
    if (unlock) Object.defineProperty(window, 'HEXSWEEPER_ONEPAGER', { configurable: true, get: () => null, set() {} });
    let seed = 219488;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (const key of ['hexsweeper-effects-v1', 'lukesteuber.minimal.hexsweeper:hexsweeper-effects-v1']) localStorage.setItem(key, reduced ? 'reduced' : 'full');
    for (const name of ['Hexsweeper', 'SphereSweeper']) {
      let value;
      Object.defineProperty(window, name, { configurable: true, get: () => value, set(v) { value = v; const boot = v.boot; v.boot = function(...a) { return window.__hexGame = boot.apply(this, a); }; } });
    }
  }, { unlock: /[?&]mode=(escape|fire|plague|water)/.test(entry), reduced });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  if(frozen){await page.clock.install({time:new Date('2026-10-14T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-14T12:00:01Z'));}
  await page.goto(base + '/host');
  await page.evaluate(src => { const f = document.createElement('iframe'); f.style.cssText = 'display:block;border:0;width:100vw;height:100vh'; f.src = src; document.body.append(f); }, `${base}/${original ? 'original' : 'collection'}/games/hexsweeper/${entry}${entry.includes('?') ? '&' : '?'}welcome=0&minimal=test`);
  const frame = await page.waitForSelector('iframe').then(e => e.contentFrame());
  if(frozen){await frame.waitForLoadState('load');await page.clock.runFor(100);}
  await frame.waitForFunction(() => window.__hexGame && (window.MinimalAdapter || !window.MINIMAL_CONFIG));
  await frame.evaluate(() => document.fonts.ready);
  return { context, page, frame, close: () => context.close() };
}
async function snapshot(frame) { return frame.evaluate(() => MinimalAdapter.snapshot()); }
async function recreate(s, entry, saved) {
  await s.page.evaluate(() => document.querySelector('iframe').remove());
  await s.page.evaluate(src => { const f = document.createElement('iframe'); f.style.cssText = 'display:block;border:0;width:100vw;height:100vh'; f.src = src; document.body.append(f); }, `${base}/collection/games/hexsweeper/${entry}${entry.includes('?') ? '&' : '?'}welcome=0&minimal=test`);
  const f = await s.page.waitForSelector('iframe').then(e => e.contentFrame());
  await f.waitForFunction(() => window.MinimalAdapter);
  s.restored = await f.evaluate(async d => { await MinimalAdapter.restore(d); return MinimalAdapter.snapshot(); }, saved);
  s.frame = f;
  return f;
}
async function completion(s) {
  await s.page.waitForFunction(() => events.some(e => e.type === 'complete'));
  return s.page.evaluate(() => {
    const all = events.filter(e => e.game === 'hexsweeper');
    const done = all.findLastIndex(e => e.type === 'complete');
    return { identity: all.slice(0, done).findLast(e => e.type === 'open').payload.identity, proof: all[done].payload.proof };
  });
}

test('Sphere unfinished camera, preferences, undo and timer survive actual iframe unload', async () => {
  const s = await surface('sphere/index.html');
  try {
    const d = await s.frame.evaluate(async () => {
      const g = __hexGame; g.setSize('xsmall'); g.digAt(0);
      const state = g.getState(); state.rotY = 1.234; state.targetRotY = 1.567; state.rotX = .321;
      state.timeElapsed = 31; g.setFlagMode(true); g.setThemeIndex(3); g.setInvertDragX(false);
      document.getElementById('help-btn').click();
      return MinimalAdapter.snapshot();
    });
    assert(d.inner.undo?.revealed?.$hex === 'bytes');
    const frame = await recreate(s, 'sphere/index.html', d);
    const result = await frame.evaluate(async () => {
      const before = await MinimalAdapter.snapshot();
      const g = __hexGame, s = g.getState();
      const view = { time: s.timeElapsed, target: s.targetRotY, flag: s.flagMode, theme: g.getThemeIndex(), invert: g.getInvertDrag().x, canUndo: g.canUndo(), help: document.getElementById('help-overlay').className };
      const undo = g.undo();
      const after = await MinimalAdapter.snapshot();
      return { before, after, view, undo };
    });
    assert.equal(result.view.time, 31); assert.equal(result.view.target, 1.567); assert(result.view.flag); assert.equal(result.view.theme, 3); assert.equal(result.view.invert, false); assert(result.view.canUndo); assert(result.undo);
    assert.deepEqual(result.before.inner.run.mines, d.inner.run.mines);
    assert.deepEqual(result.before.inner.run.revealed, d.inner.run.revealed);
    assert.equal(result.after.inner.run.revealed.length, 0);
    assert.equal(await s.page.evaluate(() => events.filter(e => e.type === 'assist').length), 1);
    assert.equal(await s.page.evaluate(() => events.filter(e => e.type === 'complete').length), 0);
  } finally { await s.close(); }
});

test('Classic pending flood, camera targets, flag mode and native board survive unload', async () => {
  const s = await surface('bounded.html?size=easy');
  try {
    const saved = await s.frame.evaluate(async () => {
      __hexGame.dig('0,0');
      const s = __hexGame.state;
      s.camX = 12; s.camTX = 45; s.camY = -3; s.timeElapsed = 19;
      __hexGame.setFlagMode(true);
      return MinimalAdapter.snapshot();
    });
    const f = await recreate(s, 'bounded.html?size=hard', saved);
    const got = s.restored;
    assert.deepEqual(got.inner.run.mines, saved.inner.run.mines);
    assert.deepEqual(got.inner.run.revealed, saved.inner.run.revealed);
    assert.equal(got.inner.run.difficulty, saved.inner.run.difficulty);
    assert.equal(got.inner.state.camTX, 45); assert.equal(got.inner.state.flagMode, true);
    assert.equal(got.inner.run.time, 19);
    assert.equal(got.inner.state.floodPending, saved.inner.state.floodPending);
    await f.waitForTimeout(1200);
    assert.equal((await snapshot(f)).inner.state.floodPending, 0);
  } finally { await s.close(); }
});

test('Infinite escape retains live Rift clock, sets, frontier, finish and theme across unload', async () => {
  const s = await surface('infinite.html?mode=escape');
  try {
    // This probe leaves only 80ms before the live Rift deadline. Freeze the
    // browser clock so host load time cannot turn the restore audit into a loss.
    await s.page.clock.install({time:new Date()});
    await s.page.clock.pauseAt(new Date(Date.now()+1000));
    await s.frame.evaluate(() => { __hexRift.digCenter(); __hexRift.awakenNow(); __hexGame.state.timeElapsed = 27; __hexGame.state.camTX = 64; });
    const saved = await snapshot(s.frame);
    assert(saved.outer.rift.phase === 'awaken' || saved.outer.rift.phase === 'chase');
    const f = await recreate(s, 'infinite.html?mode=fire', saved);
    const got = s.restored;
    assert.equal(got.outer.themeIndex, saved.outer.themeIndex);
    assert.equal(got.outer.rift.phase, saved.outer.rift.phase);
    assert.equal(got.inner.run.finish, saved.inner.run.finish);
    assert.deepEqual(got.inner.run.mines, saved.inner.run.mines);
    assert.deepEqual(got.inner.run.revealed, saved.inner.run.revealed);
    assert.deepEqual(got.outer.rift.torn, saved.outer.rift.torn);
    assert(Math.abs(got.outer.rift.t0.value - saved.outer.rift.t0.value) < 300);
    assert.equal(got.inner.state.camTX, 64); assert.equal(got.inner.run.time, 27);
    assert.equal(await s.page.evaluate(() => events.filter(e => e.type === 'complete').length), 0);
  } finally { await s.close(); }
});

test('precise finite completions validate independently and reject tampering', async () => {
  for (const entry of ['sphere/index.html', 'bounded.html?size=easy', 'infinite.html?mode=fire', 'infinite.html?mode=plague', 'infinite.html?mode=water']) {
    const s = await surface(entry);
    try {
      await s.frame.evaluate(async () => {
        const g = __hexGame;
        if (g.getState) {
          g.setSize('xsmall'); g.digAt(0);
          for (let i = 0; i < g.getState().cells.length; i++) if (!g.getState().cells[i].isMine) g.digAt(i);
        } else {
          g.dig('0,0');
          // Exercise the real dig/wave/win paths on the pinned randomized board.
          for (let round = 0; round < 12 && !g.state.isGameOver; round++) {
            for (const [k, c] of g.state.map) if (!c.isMine && !c.revealed && !c._pendingReveal) g.dig(k);
            await new Promise(r => setTimeout(r, 150));
          }
        }
      });
      const run = await completion(s);
      assert.deepEqual(validate({ ...run, elapsedMs: 5432 }), { value: 5432 }, entry);
      assert.equal(await s.page.evaluate(() => events.filter(e => e.type === 'complete').length), 1);
      const bad = structuredClone(run); bad.proof.final.safe.pop();
      assert.throws(() => validate({ ...bad, elapsedMs: 5432 }));
      const count = structuredClone(run); count.proof.final.counts[0][1] = 99;
      assert.throws(() => validate({ ...count, elapsedMs: 5432 }));
      for (const field of ['layoutHash', 'rulesVersion', 'mode', 'puzzleId', 'scoringPolicy']) {
        const other = structuredClone(run); other.identity[field] = 'unknown';
        assert.throws(() => validate({ ...other, elapsedMs: 5432 }), field);
      }
      // A post-win snapshot never re-emits completion after a new iframe restore.
      const saved = await snapshot(s.frame); const countBefore = await s.page.evaluate(() => events.filter(e => e.type === 'complete').length);
      await recreate(s, entry, saved);
      assert.equal(await s.page.evaluate(() => events.filter(e => e.type === 'complete').length), countBefore);
    } finally { await s.close(); }
  }
});

test('Infinite loss counts safe reveals before spoiled mines, identity stays stable on expansion', async () => {
  const s = await surface('infinite.html?mode=light');
  try {
    await s.frame.evaluate(() => __hexGame.dig('0,0'));
    await s.frame.waitForTimeout(1500);
    const saved = await snapshot(s.frame);
    await s.frame.evaluate(() => {
      const g = __hexGame; const mine = [...g.state.map].find(([, c]) => c.isMine && !c.revealed && !c.flagged);
      g.dig(mine[0]);
    });
    const run = await completion(s);
    assert.equal(run.proof.initial.radius, saved.initial.radius);
    const value = run.proof.final.safe.length;
    assert(value > 0);
    assert.deepEqual(validate({ ...run, elapsedMs: 1234 }), { value });
    const final = await snapshot(s.frame);
    assert(final.inner.run.revealed.length > value, 'upstream loss spoils mines');
    const bad = structuredClone(run); bad.proof.final.safe.push(bad.proof.final.mines[0]);
    assert.throws(() => validate({ ...bad, elapsedMs: 1234 }));
    const changed = structuredClone(run); changed.proof.initial.radius = 161; changed.identity.layoutHash = digest(changed.proof.initial);
    assert.throws(() => validate({ ...changed, elapsedMs: 1234 }));
  } finally { await s.close(); }
});

test('sessionStorage is namespaced and cannot clear another game or raw Hexsweeper', async () => {
  const s = await surface('sphere/index.html');
  try {
    const result = await s.frame.evaluate(() => {
      // The outer page retains the native Storage prototype for inspection.
      const raw = parent.sessionStorage;
      raw.setItem('hexsweeper-sphere-run-v2', 'original'); raw.setItem('other-game', 'keep');
      sessionStorage.setItem('hexsweeper-sphere-run-v2', 'collection');
      const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
      const own = sessionStorage.getItem('hexsweeper-sphere-run-v2');
      sessionStorage.clear();
      return { keys, own, original: raw.getItem('hexsweeper-sphere-run-v2'), other: raw.getItem('other-game'), leaked: raw.getItem('lukesteuber.minimal.hexsweeper:hexsweeper-sphere-run-v2') };
    });
    assert.equal(result.own, 'collection'); assert(result.keys.includes('hexsweeper-sphere-run-v2')); assert.equal(result.original, 'original'); assert.equal(result.other, 'keep'); assert.equal(result.leaked, null);
  } finally { await s.close(); }
});

test('desktop and touch board pixels match pinned upstream at equal viewport', async () => {
  for (const [entry, viewport, mobile] of [
    ['sphere/index.html', { width: 1024, height: 768 }, false],
    ['bounded.html?size=easy', { width: 390, height: 844 }, true],
    ['infinite.html?mode=light', { width: 844, height: 390 }, true]
  ]) {
    const a = await surface(entry, { original: true, viewport, mobile, frozen:true });
    const b = await surface(entry, { viewport, mobile, frozen:true });
    try {
      await a.page.clock.runFor(250); await b.page.clock.runFor(250);
      const pose=frame=>frame.evaluate(()=>{const s=__hexGame.getState?__hexGame.getState():__hexGame.state;return Object.fromEntries(['rotX','rotY','targetRotX','targetRotY','ambientSpin','reduceMotion','centerX','centerY','scale','baseScale','zoomFactor','hovered','pressed'].map(k=>[k,s[k]]));});
      assert.deepEqual(await pose(a.frame),await pose(b.frame),'same native board pose before raster comparison');
      const capture=frame=>frame.locator('#gameCanvas').evaluate(canvas=>canvas.toDataURL('image/png'));
      const original = Buffer.from((await capture(a.frame)).split(',')[1],'base64'); const generated = Buffer.from((await capture(b.frame)).split(',')[1],'base64');
      assert.ok(original.length>4000,'nonempty board raster');
      fs.writeFileSync(path.join(temp, 'original.png'), original); fs.writeFileSync(path.join(temp, 'generated.png'), generated);
      if (!original.equals(generated)) keepEvidence = true;
      assert(original.equals(generated), `pixel parity: ${entry} (evidence ${temp})`);
    } finally { await a.close(); await b.close(); }
  }
});

test('corrupt and foreign snapshots fail without replacing the live board', async () => {
  for (const entry of ['sphere/index.html', 'bounded.html', 'infinite.html?mode=light']) {
    const s = await surface(entry);
    try {
      await s.frame.evaluate(() => __hexGame.getState ? __hexGame.digAt(0) : __hexGame.dig('0,0'));
      const result = await s.frame.evaluate(async () => {
        const before = await MinimalAdapter.snapshot();
        const foreign = structuredClone(before); foreign.source = 'foreign';
        let rejected = 0;
        try { await MinimalAdapter.restore(foreign); } catch (_) { rejected++; }
        const broken = structuredClone(before); broken.inner.cells.pop();
        try { await MinimalAdapter.restore(broken); } catch (_) { rejected++; }
        const after = await MinimalAdapter.snapshot();
        return { rejected, before, after };
      });
      assert.equal(result.rejected, 2);
      assert.deepEqual(result.after.inner.run.mines, result.before.inner.run.mines);
      assert.deepEqual(result.after.inner.run.revealed, result.before.inner.run.revealed);
      assert.equal(result.after.outer?.themeIndex, result.before.outer?.themeIndex);
    } finally { await s.close(); }
  }
});

test('snapshot/restore hooks enforce handshake and source version in a single lazy iframe', async () => {
  const s = await surface('bounded.html');
  try {
    await s.page.evaluate(() => {
      const f = document.querySelector('iframe');
      f.contentWindow.postMessage({ v: 1, nonce: 'wrong', type: 'snapshot', request: 'ignored' }, location.origin);
      f.contentWindow.postMessage({ v: 1, nonce: 'test', type: 'snapshot', request: 'saved' }, location.origin);
    });
    await s.page.waitForFunction(() => events.some(e => e.type === 'snapshot' && e.payload.request === 'saved'));
    const saved = await s.page.evaluate(() => events.find(e => e.type === 'snapshot').payload);
    assert.equal(await s.page.evaluate(() => events.some(e => e.payload?.request === 'ignored')), false);
    await s.page.evaluate(payload => document.querySelector('iframe').contentWindow.postMessage({ v: 1, nonce: 'test', type: 'restore', request: 'restore', payload }, location.origin), saved);
    await s.page.waitForFunction(() => events.some(e => e.type === 'restored' && e.payload.request === 'restore'));
    assert.equal(await s.page.locator('iframe').count(), 1);
  } finally { await s.close(); }
});

test('Escape validates its native Rift catch and positive exit independently', async () => {
  for (const outcome of ['rift', 'finish']) {
    const s = await surface('infinite.html?mode=escape');
    try {
      if (outcome === 'rift') await s.frame.evaluate(() => __hexRift.awakenNow());
      else await s.frame.evaluate(() => {
        const g = __hexGame, finish = g.state.finishKey;
        // Viewport expansion creates the reserved exit; move the live camera
        // there, then use the engine's real dig/finish path.
        const [q, r] = finish.split(',').map(Number), size = g.state.cellSize;
        g.setCamera(size * Math.sqrt(3) * (q + r / 2), size * 1.5 * r);
        g.relayout();
        g.dig(finish);
      });
      const run = await completion(s);
      assert.equal(run.proof.final.reason, outcome);
      assert.deepEqual(validate({ ...run, elapsedMs: 5000 }), { value: run.proof.final.safe.length });
    } finally { await s.close(); }
  }
});

test('native keyboard, touch dig and all registered Sphere material assets work', async () => {
  const desktop = await surface('bounded.html');
  try {
    await desktop.frame.locator('body').click({ position: { x: 2, y: 2 } });
    await desktop.page.keyboard.press('f');
    assert.equal(await desktop.frame.evaluate(() => __hexGame.state.flagMode), true);
    const zoom = await desktop.frame.evaluate(() => __hexGame.state.viewZoom);
    await desktop.page.keyboard.press('+');
    assert(await desktop.frame.evaluate(() => __hexGame.state.viewZoom) > zoom);
  } finally { await desktop.close(); }
  const touch = await surface('bounded.html?size=easy', { viewport: { width: 390, height: 844 }, mobile: true });
  try {
    const p = await touch.frame.evaluate(() => {
      const g = __hexGame, c = g.state.map.get('0,0'), el = g.state.canvas, r = el.getBoundingClientRect();
      return { x: r.left + c.x * r.width / el.width, y: r.top + c.y * r.height / el.height };
    });
    await touch.page.touchscreen.tap(p.x, p.y);
    assert.equal(await touch.frame.evaluate(() => __hexGame.state.isFirstClick), false);
  } finally { await touch.close(); }
  const sphere = await surface('sphere/index.html');
  try {
    for (let i = 0; i < 9; i++) {
      await sphere.frame.evaluate(i => __hexGame.setThemeIndex(i), i);
      await sphere.frame.waitForTimeout(120);
      assert.equal(await sphere.frame.evaluate(() => __hexGame.getThemeIndex()), i);
    }
  } finally { await sphere.close(); }
});

test('completed Sphere undo opens a repeat-assisted attempt with the same layout', async () => {
  const s = await surface('sphere/index.html');
  try {
    await s.frame.evaluate(() => {
      const g = __hexGame; g.setSize('xsmall'); g.digAt(0);
      for (let i = 0; i < g.getState().cells.length; i++) if (!g.getState().cells[i].isMine) g.digAt(i);
    });
    const first = await completion(s);
    await s.frame.evaluate(() => __hexGame.undo());
    await s.page.waitForFunction(() => events.some(e => e.type === 'open' && e.payload.repeat));
    const events = await s.page.evaluate(() => window.events);
    const open = events.findLastIndex(e => e.type === 'open');
    assert.equal(events[open].payload.repeat, true);
    assert.equal(events[open].payload.identity.layoutHash, first.identity.layoutHash);
    assert(events.slice(open + 1).some(e => e.type === 'assist'));
  } finally { await s.close(); }
});

test('live timer phase and orientation resume without replacing mines or undo', async () => {
  for (const entry of ['bounded.html', 'sphere/index.html']) {
    const s = await surface(entry);
    try {
      await s.frame.evaluate(() => __hexGame.getState ? __hexGame.digAt(0) : __hexGame.dig('0,0'));
      await s.frame.waitForTimeout(350);
      const saved = await snapshot(s.frame);
      assert(saved.inner.timerRemaining > 0 && saved.inner.timerRemaining < 900);
      await s.page.setViewportSize({ width: 390, height: 844 });
      await recreate(s, entry, saved);
      assert(Math.abs(s.restored.inner.timerRemaining - saved.inner.timerRemaining) < 100);
      assert.deepEqual(s.restored.inner.run.mines, saved.inner.run.mines);
      const size = await s.frame.evaluate(() => __hexGame.getState ? [__hexGame.getState().canvasCssW, __hexGame.getState().canvasCssH] : [__hexGame.state.canvas.width, __hexGame.state.canvas.height]);
      const baseline = await surface(entry, { original: true, viewport: { width: 390, height: 844 } });
      try {
        const expected = await baseline.frame.evaluate(() => __hexGame.getState ? [__hexGame.getState().canvasCssW, __hexGame.getState().canvasCssH] : [__hexGame.state.canvas.width, __hexGame.state.canvas.height]);
        assert.deepEqual(size, expected);
      } finally { await baseline.close(); }
    } finally { await s.close(); }
  }
});

test('unfinished Infinite intro camera glide resumes on the original curve', async () => {
  // A paused page clock holds the 1.4 s glide mid-flight, however long the page takes to load.
  const s = await surface('infinite.html?mode=escape', { reduced: false, frozen: true });
  try {
    const saved = await snapshot(s.frame);
    assert(saved.outer.intro, 'snapshot during the native opening glide');
    await recreate(s, 'infinite.html?mode=fire', saved);
    assert(s.restored.outer.intro);
    assert(Math.abs(s.restored.inner.run.zoom - saved.inner.run.zoom) < .001);
    await s.page.clock.runFor(1600);
    assert.equal((await snapshot(s.frame)).outer.intro, null);
  } finally { await s.close(); }
});

test('all emitted errors and runtime asset requests are clean', () => {
  assert.deepEqual(errors, []);
  assert.deepEqual([...new Set(missing.filter(p => p !== '/favicon.ico'))], []);
});
