#!/usr/bin/env node
/* Short play clips for the itch page, taken from the built ZIP. Luke Steuber.
 *
 *   node tools/capture-clips.cjs [--zip build/minimal-primitives-browser.zip] [--out release/clips] [--only id,id]
 *
 * Records each catalog entry (every game, and each Hexsweeper board) in a fresh
 * 720 x 720 page: the library opens the game, then a few seconds of real play,
 * mostly the game's own Hint solving the first board step by step. Writes
 * <name>.webm plus <name>.json with the second the game was ready, which
 * tools/clips-to-gif.sh uses to trim. Same Playwright and Chrome as
 * tools/capture-screenshots.cjs; installs nothing, and no request leaves the page.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.MINIMAL_PLAYWRIGHT || '/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const CHROME = process.env.MINIMAL_CHROME || '/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = path.resolve(__dirname, '..'), SIZE = 720, PLAY_MS = 8000;
const PORTS = [5010, 5011, 5012, 5013, 5014, 5015, 5016, 5017, 5018, 5019, 5050, 5051, 5052, 5053, 5054, 5055, 5056, 5057, 5058, 5059];
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream'};
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (i % 2 ? pairs : [...pairs, [value.replace(/^--/, ''), all[i + 1]]]), []));
const zip = path.resolve(args.zip || path.join(ROOT, 'build/minimal-primitives-browser.zip'));
const out = path.resolve(args.out || path.join(ROOT, 'release/clips'));
const only = args.only ? args.only.split(',') : null;
const wait = ms => new Promise(r => setTimeout(r, ms));

// What a few seconds of play looks like. The default plays through the first
// boards: the game's own Hint places the next correct move, Next moves on when a
// board is done, and where Hint has nothing to say a board cell is tapped.
const sig = frame => frame.evaluate(() => { const b = document.querySelector('#board, #stage, #well, canvas'); return b ? (b.innerHTML || '').length + ':' + (document.querySelector('[aria-live]') || {}).textContent : ''; }).catch(() => '');
async function hints(frame, page, until) {
  let taps = 0;
  while (Date.now() < until) {
    const next = frame.locator('#next-btn, #next').first();
    if (await next.isVisible().catch(() => false)) { await wait(700); await next.click({force: true, timeout: 1500}).catch(() => {}); await wait(900); continue; }
    const before = await sig(frame), hint = frame.locator('#hint-btn, #hint').first();
    if (await hint.isVisible().catch(() => false) && await hint.isEnabled().catch(() => false)) await hint.click().catch(() => {});
    await wait(850);
    if (await sig(frame) === before) {
      const cells = frame.locator('#board .cell, #board [role="gridcell"], #board button');
      const n = await cells.count().catch(() => 0);
      if (n) { await cells.nth((taps++ * 7) % n).click({timeout: 1000}).catch(() => {}); await wait(700); }
    }
  }
}
async function drag(page, from, to, steps = 40) {
  await page.mouse.move(...from); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await wait(30); }
  await page.mouse.up();
}
const PLAY = {
  'hexsweeper:sphere': async (frame, page, until) => { await page.mouse.click(360, 360); await wait(700); await drag(page, [250, 360], [520, 380], 80); await page.mouse.click(330, 300); await wait(Math.max(0, until - Date.now())); },
  'hexsweeper:infinite': async (frame, page, until) => { await page.mouse.click(360, 360); await wait(900); await page.mouse.click(300, 420); await wait(900); await drag(page, [500, 500], [300, 380]); await wait(Math.max(0, until - Date.now())); },
  'hexsweeper:classic': async (frame, page, until) => { for (const [x, y] of [[360, 360], [300, 330], [420, 400], [330, 450]]) { await page.mouse.click(x, y); await wait(1100); } await wait(Math.max(0, until - Date.now())); },
  // Bending: take a planet, set it in the well, and watch the light bend.
  bending: async (frame, page, until) => {
    while (Date.now() < until) {
      const next = frame.locator('#next'); if (await next.isVisible().catch(() => false)) { await wait(600); await next.click({force: true}).catch(() => {}); await wait(1200); continue; }
      const planet = frame.locator('.planet-button').first(); await planet.click({timeout: 1000}).catch(() => {}); await wait(500);
      const well = await frame.locator('#well').boundingBox().catch(() => null);
      if (well) await page.mouse.click(well.x + well.width * (0.3 + Math.random() * 0.4), well.y + well.height * (0.3 + Math.random() * 0.4));
      await wait(1400);
    }
  },
  // Tilt: the hint mark points the way; tip the board that way.
  tilt: async (frame, page, until) => {
    while (Date.now() < until) {
      const next = frame.locator('#next-btn'); if (await next.isVisible().catch(() => false)) { await wait(600); await next.click({force: true}).catch(() => {}); await wait(1000); continue; }
      await frame.locator('#hint-btn').click().catch(() => {}); await wait(300);
      const rotation = await frame.locator('#hint-mark').getAttribute('transform').catch(() => null);
      const angle = rotation && Number((rotation.match(/rotate\(([-\d.]+)/) || [])[1]);
      await frame.locator('#board').focus().catch(() => {});
      await page.keyboard.press({0: 'ArrowUp', 90: 'ArrowRight', 180: 'ArrowDown', '-90': 'ArrowLeft'}[angle] || 'ArrowRight');
      await wait(900);
    }
  },
};

function extract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-clips-'));
  execFileSync('python3', ['-m', 'zipfile', '-e', zip, dir]);
  return dir;
}
async function serve(dir, prefix) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://capture');
    if (!url.pathname.startsWith(prefix)) return res.writeHead(404).end();
    const file = path.resolve(dir, decodeURIComponent(url.pathname.slice(prefix.length)));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  for (const port of PORTS) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return {server, port}; }
    catch (error) { server.removeAllListeners('error'); if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No free test port in 5010-5019 or 5050-5059');
}

async function main() {
  const dir = extract(), prefix = '/html/capture/';
  const {server, port} = await serve(dir, prefix);
  const library = `http://127.0.0.1:${port}${prefix}index.html`;
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json')));
  const entries = catalog.flatMap(game => game.modes.length ? game.modes.map(mode => ({game, mode})) : [{game}]);
  const keyOf = ({game, mode}) => game.id + (mode ? ':' + mode.id : '');
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({executablePath: CHROME, headless: true});
  try {
    for (const entry of entries) {
      const key = keyOf(entry), name = key.replace(':', '-');
      if (only && !only.includes(key) && !only.includes(name)) continue;
      const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-clip-raw-'));
      const context = await browser.newContext({viewport: {width: SIZE, height: SIZE}, deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block', recordVideo: {dir: raw, size: {width: SIZE, height: SIZE}}});
      const outside = [];
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1' && Number(url.port) === port) return route.continue(); if (!['data:', 'blob:'].includes(url.protocol)) outside.push(url.href); return route.abort(); });
      const page = await context.newPage(), t0 = Date.now(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(library);
      await page.waitForSelector('.tile');
      const {game, mode} = entry, accessible = game.group === 'accessible';
      if (accessible) await page.locator('#access-open').click();
      await page.locator('.tile[data-game="' + game.id + '"]' + (mode ? '[data-mode="' + mode.id + '"]' : '')).click();
      const frame = await (await page.waitForSelector('#player iframe')).contentFrame();
      await frame.waitForFunction(ready => (ready || !!window.MinimalAdapter) && !!document.querySelector('#minimal-home'), accessible, {timeout: 15000});
      const play = frame.getByRole('button', {name: 'Play', exact: true});
      if (await play.isVisible().catch(() => false)) await play.click();
      await frame.evaluate(() => document.fonts.ready);
      await wait(1200);
      const ready = (Date.now() - t0) / 1000, until = Date.now() + PLAY_MS;
      await (PLAY[key] || hints)(frame, page, until);
      await wait(500);
      await context.close();
      const video = fs.readdirSync(raw).find(f => f.endsWith('.webm'));
      fs.renameSync(path.join(raw, video), path.join(out, name + '.webm'));
      fs.rmSync(raw, {recursive: true, force: true});
      fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({key, title: game.title + (mode ? ' ' + mode.title : ''), start: Number(ready.toFixed(2)), seconds: PLAY_MS / 1000, errors, outside}, null, 2) + '\n');
      console.log(`${name}.webm  ready at ${ready.toFixed(1)} s${errors.length ? '  errors: ' + errors.join('; ') : ''}${outside.length ? '  outside: ' + outside.length : ''}`);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exit(1); });
