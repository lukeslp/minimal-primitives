#!/usr/bin/env node
/* Release screenshots taken from the built ZIP, as a new visitor sees it. Luke Steuber.
 *
 *   node tools/capture-screenshots.cjs [--zip build/minimal-primitives-browser.zip]
 *     [--out release/screenshots] [--page release/itch-page.md] [--receipt file.json]
 *
 * Every catalog entry gets a phone shot, so a new game is captured on the next run.
 * The library leads, followed by desk and landscape shots, then each phone game.
 * Stale PNGs in the output folder are removed and the ordered list in the
 * release page is rewritten between its screenshot markers. Uses the same
 * external Playwright and Chrome as the browser tests; installs nothing.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {createHash} = require('node:crypto'), {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.MINIMAL_PLAYWRIGHT || '/Users/luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const CHROME = process.env.MINIMAL_CHROME || '/Users/luke/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = path.resolve(__dirname, '..');

const PHONE = {viewport: {width: 390, height: 844}, scale: 3, mobile: true};
const LANDSCAPE = {viewport: {width: 844, height: 390}, scale: 3, mobile: true};
const DESK = {viewport: {width: 1440, height: 900}, scale: 1, mobile: false};
// Entries are game ids, or game:mode for a mode tile.
const DESK_GAME = 'hexsweeper:sphere', LANDSCAPE_GAME = 'tilt';
const SCHEME = 'light', SETTLE_MS = 2000, PORTS = [5010, 5011, 5012, 5013, 5014, 5015, 5016, 5017, 5018, 5019, 5050, 5051, 5052, 5053, 5054, 5055, 5056, 5057, 5058, 5059];
const START = '<!-- screenshots: written by tools/capture-screenshots.cjs -->', END = '<!-- /screenshots -->';
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (i % 2 ? pairs : [...pairs, [value.replace(/^--/, ''), all[i + 1]]]), []));
const zip = path.resolve(args.zip || path.join(ROOT, 'build/minimal-primitives-browser.zip'));
const out = path.resolve(args.out || path.join(ROOT, 'release/screenshots'));
const releasePage = path.resolve(args.page || path.join(ROOT, 'release/itch-page.md'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pngSize = file => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

function extract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-shots-'));
  execFileSync('python3', ['-m', 'zipfile', '-e', zip, dir]);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'BUILD_MANIFEST.json')));
  for (const [file, hash] of Object.entries(manifest))
    if (sha(fs.readFileSync(path.join(dir, file))) !== hash) throw new Error('Archive file does not match its manifest: ' + file);
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
  const nameOf = entry => keyOf(entry).replace(':', '-');
  const titleOf = ({game, mode}) => game.title + (mode ? ' ' + mode.title : '');
  const find = key => { const entry = entries.find(e => keyOf(e) === key); if (!entry) throw new Error('Unknown catalog entry ' + key); return entry; };
  const plan = [
    {name: 'library-phone', device: PHONE, label: 'Library, phone'},
    {name: 'library-desk', device: DESK, label: 'Library, desk'},
    {name: nameOf(find(DESK_GAME)) + '-desk', device: DESK, entry: find(DESK_GAME), label: titleOf(find(DESK_GAME)) + ', desk'},
    {name: nameOf(find(LANDSCAPE_GAME)) + '-landscape', device: LANDSCAPE, entry: find(LANDSCAPE_GAME), label: titleOf(find(LANDSCAPE_GAME)) + ', phone landscape'},
    ...entries.map(entry => ({name: nameOf(entry), device: PHONE, entry, label: titleOf(entry) + ', phone'})),
  ].map((shot, i) => ({...shot, file: String(i + 1).padStart(2, '0') + '-' + shot.name + '.png'}));

  const browser = await chromium.launch({executablePath: CHROME, headless: true});
  const receipt = {zip: path.relative(ROOT, zip), zipSHA256: sha(fs.readFileSync(zip)), chromium: browser.version(), scheme: SCHEME, shots: []};
  fs.mkdirSync(out, {recursive: true});
  try {
    for (const shot of plan) {
      const {viewport, scale, mobile} = shot.device;
      // A fresh context per shot: empty storage, as a new visitor sees it.
      const context = await browser.newContext({viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile, colorScheme: SCHEME, serviceWorkers: 'block'});
      const outside = [], errors = [];
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1' && Number(url.port) === port) return route.continue(); if (!['data:', 'blob:'].includes(url.protocol)) outside.push(url.href); return route.abort(); });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(library);
      await page.waitForSelector('.tile');
      if (!shot.entry) {
        // Decode every tile image, then return to the top of the library.
        await page.locator('#library').evaluate(async library => {
          for (const image of library.querySelectorAll('.tile img')) { image.loading = 'eager'; image.scrollIntoView({block: 'nearest'}); await image.decode(); }
          library.scrollTop = 0;
        });
        await page.waitForFunction(() => [...document.querySelectorAll('#library .tile img')].every(i => i.complete && i.naturalWidth > 0));
      } else {
        const {game, mode} = shot.entry;
        // The motor-accessible puzzles sit behind the last tile and have no resume adapter.
        const accessible = game.group === 'accessible';
        if (accessible) await page.locator('#access-open').click();
        await page.locator('.tile[data-game="' + game.id + '"]' + (mode ? '[data-mode="' + mode.id + '"]' : '')).click();
        const frame = await (await page.waitForSelector('#player iframe')).contentFrame();
        await frame.waitForFunction(ready => (ready || !!window.MinimalAdapter) && !!document.querySelector('#minimal-home'), accessible, {timeout: 15000});
        const play = frame.getByRole('button', {name: 'Play', exact: true});
        if (await play.isVisible()) await play.click();
        await frame.evaluate(() => document.fonts.ready);
      }
      await page.waitForTimeout(SETTLE_MS);
      const file = path.join(out, shot.file);
      await page.screenshot({path: file});
      const [width, height] = pngSize(file);
      if (width !== viewport.width * scale || height !== viewport.height * scale) throw new Error(`${shot.file}: ${width}x${height}`);
      if (outside.length || errors.length) throw new Error(`${shot.file}: outside requests ${JSON.stringify(outside)}, errors ${JSON.stringify(errors)}`);
      receipt.shots.push({file: shot.file, label: shot.label, viewport: `${viewport.width}x${viewport.height}`, scale, pixels: `${width}x${height}`, bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file))});
      console.log(`${shot.file}  ${width}x${height}  ${shot.label}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, {recursive: true, force: true});
  }
  const kept = new Set(plan.map(shot => shot.file));
  for (const file of fs.readdirSync(out)) if (file.endsWith('.png') && !kept.has(file)) { fs.rmSync(path.join(out, file)); console.log('removed stale', file); }
  if (fs.existsSync(releasePage)) {
    const text = fs.readFileSync(releasePage, 'utf8'), start = text.indexOf(START), end = text.indexOf(END);
    if (start < 0 || end < start) throw new Error('Release page lacks the screenshot markers');
    const list = receipt.shots.map((shot, i) => `${i + 1}. \`${shot.file}\`: ${shot.label} (${shot.pixels})`).join('\n');
    fs.writeFileSync(releasePage, text.slice(0, start + START.length) + '\n' + list + '\n' + text.slice(end));
  }
  if (args.receipt) fs.writeFileSync(path.resolve(args.receipt), JSON.stringify(receipt, null, 2) + '\n');
}

main().catch(error => { console.error(error); process.exit(1); });
