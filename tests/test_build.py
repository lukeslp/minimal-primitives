import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from transforms import open_outside, replace_once, transform


class ExportTests(unittest.TestCase):
    def test_pins_cover_every_import(self):
        manifest = json.loads((ROOT / 'sources.json').read_text())
        expected = set()
        for game in manifest['games'] + manifest.get('shared', []):
            self.assertEqual(len(game['commit']), 40)
            for item in game['files']:
                expected.add(item['path'])
                self.assertEqual(hashlib.sha256((ROOT / 'imports' / item['path']).read_bytes()).hexdigest(), item['sha256'])
        self.assertEqual(expected, {p.relative_to(ROOT / 'imports').as_posix() for p in (ROOT / 'imports').rglob('*') if p.is_file()})

    def test_anchor_drift_is_fatal(self):
        for text in ['missing', 'anchor anchor']:
            with self.assertRaises(ValueError):
                replace_once(text, 'anchor', 'changed', 'fixture')

    def test_outside_links_and_root_paths_fail_loudly(self):
        self.assertEqual(open_outside('<a href="https://x.test">x</a>', 'f'), '<a href="https://x.test" target="_blank" rel="noopener">x</a>')
        self.assertEqual(open_outside('<a target="_top" rel="noreferrer" href="https://x.test">', 'f'), '<a target="_blank" rel="noreferrer noopener" href="https://x.test">')
        self.assertEqual(open_outside("html='<a href=\"https://x.test\">x</a>';", 'f'), "html='<a href=\"https://x.test\" target=\"_blank\" rel=\"noopener\">x</a>';")
        self.assertEqual(open_outside('<a href="../x/index.html">', 'f'), '<a href="../x/index.html">')
        with self.assertRaises(ValueError):
            open_outside('<a href=https://x.test>', 'f')
        game = {'id': 'notan', 'commit': '0' * 40, 'files': []}
        with self.assertRaises(ValueError):
            transform(game, 'notan/x.html', '<html><head></head><body><a href="/games/other/">x</a></body></html>')
        page = transform(game, 'notan/x.html', '<html><head></head><body><a href="/games/akari-preview/?look=light">x</a></body></html>')
        self.assertIn('href="../../games/akari-light/index.html?look=light"', page)

    def test_reproducible_zip_and_explicit_pages(self):
        subprocess.run([sys.executable, 'tools/build.py'], cwd=ROOT, check=True, capture_output=True)
        first = (ROOT / 'build/minimal-primitives-browser.zip').read_bytes()
        subprocess.run([sys.executable, 'tools/build.py'], cwd=ROOT, check=True, capture_output=True)
        self.assertEqual(first, (ROOT / 'build/minimal-primitives-browser.zip').read_bytes())
        with zipfile.ZipFile(ROOT / 'build/minimal-primitives-browser.zip') as archive:
            self.assertIn('index.html', archive.namelist())
            catalog = json.loads(archive.read('catalog.json'))
            self.assertEqual(len(catalog), len(json.loads((ROOT / 'sources.json').read_text())['games']))
            self.assertEqual(sum(1 for game in catalog if game.get('group') == 'accessible'), 8)
            for game in catalog:
                for entry in [game['entry']] + [m['entry'] for m in game['modes']]:
                    text = archive.read('games/' + entry).decode()
                    self.assertIn('bootstrap.js', text)
                    self.assertNotIn('stats.dr.eamer.dev/count.js', text)
            self.assertLess(len(archive.namelist()), 1000)


class CameraFreeVariantTests(unittest.TestCase):
    """The fdroid variant: no MediaPipe and no head or eye input; every game and switch/touch mode stays."""

    @classmethod
    def setUpClass(cls):
        command = [sys.executable, 'tools/build.py', '--variant', 'fdroid']
        subprocess.run(command, cwd=ROOT, check=True, capture_output=True)
        cls.first = (ROOT / 'build/minimal-primitives-fdroid.zip').read_bytes()
        subprocess.run(command, cwd=ROOT, check=True, capture_output=True)
        cls.second = (ROOT / 'build/minimal-primitives-fdroid.zip').read_bytes()
        with zipfile.ZipFile(ROOT / 'build/minimal-primitives-fdroid.zip') as bundle:
            cls.names = bundle.namelist()
            cls.texts = {n: bundle.read(n).decode() for n in cls.names if n.endswith(('.html', '.js', '.mjs', '.css', '.txt', '.json'))}
        cls.spec = json.loads((ROOT / 'variants.json').read_text())['fdroid']

    def test_reproducible(self):
        self.assertEqual(self.first, self.second)

    def test_no_mediapipe_and_every_game_kept(self):
        # MediaPipe's folder; Tilt · 3D's three.js vendor folder is ordinary game code.
        self.assertFalse([n for n in self.names if n.endswith(('.wasm', '.task')) or 'glance/vendor/' in n])
        catalog = json.loads(self.texts['catalog.json'])
        full = json.loads((ROOT / 'sources.json').read_text())['games']
        self.assertEqual(sorted(g['id'] for g in catalog), sorted(g['id'] for g in full))
        self.assertEqual(sum(1 for g in catalog if g.get('group') == 'accessible'), 8)
        self.assertNotIn('MediaPipe Face Landmarker', self.texts['NOTICES.txt'])
        self.assertIn('"game":"accessible"', self.texts['tiles.json'], 'the last tile still opens the accessible puzzles')

    def test_no_camera_input_anywhere(self):
        for name, text in self.texts.items():
            self.assertNotIn("['head','Head'", text, name)
            self.assertNotIn('cameraAllowed(),trackOK', text, name)
            # A page's own policy must not allow the camera's WebAssembly or the gaze bridge.
            for policy in re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', text, re.I):
                self.assertNotIn("'wasm-unsafe-eval'", policy, name)
                self.assertNotIn('ws://127.0.0.1', policy, name)
        self.assertIn("frame.allow = 'fullscreen';", self.texts['collection.js'])

    def test_camera_games_play_by_pointer(self):
        for game in ['glance', 'glyph', 'shoo', 'nod', 'pursuit']:
            page = self.texts[f'games/{game}/index.html']
            self.assertIn("Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});", page)
            self.assertIn('<label class="row" hidden>Look with <select id="input"><option value="pointer">Pointer</option></select></label>', page)
            self.assertNotIn('Camera frames', page)
            self.assertNotIn('<option value="head">', page)
            self.assertIn('#camera-btn,#camera-start,#camera{display:none!important}', page)

    def test_only_open_license_assets(self):
        """No photograph and no Microsoft screenshot: four Sphere themes, no history picture, notices in step."""
        self.assertTrue(self.spec['freeAssets'])
        self.assertFalse([n for n in self.names if 'assets/reflections/' in n or 'classic-minesweeper' in n])
        sphere = self.texts['games/hexsweeper/sphere/index.html']
        self.assertIn('const ROSTER = ["light", "dark", "mercury", "aurora"];', sphere)
        for gone in ['classic-minesweeper', 'class="help-history-row"', 'id="history-lightbox"', 'id="help-history-btn"', 'help-theme-credit']:
            self.assertNotIn(gone, sphere)
        engine = self.texts['games/hexsweeper/sphere/sphere.js']
        self.assertIn('    THEME_MERCURY,\n    THEME_AURORA,\n  ].filter(', engine)
        self.assertNotIn('assets/reflections/', self.texts['games/hexsweeper/sphere/mirror-material.js'])
        notices = self.texts['NOTICES.txt']
        for word in ['Unsplash', 'Microsoft', 'reflection photographs', 'Stratosphere', 'stratosphere']:
            self.assertNotIn(word, notices)
        for name in ['classic-minesweeper', 'stratosphere-1024', 'stratosphere-2048', 'assets/reflections/']:
            self.assertNotIn(name, self.texts['SOURCE_MANIFEST.json'])

    def test_full_build_leaves_out_the_screenshot_and_stratosphere(self):
        """Every build: no Microsoft screenshot, no Stratosphere photograph; the full build credits the other photos."""
        full = ROOT / 'build/minimal-primitives-browser.zip'
        if not full.exists():
            subprocess.run([sys.executable, 'tools/build.py'], cwd=ROOT, check=True, capture_output=True)
        with zipfile.ZipFile(full) as bundle:
            names = bundle.namelist()
            text = lambda name: bundle.read(name).decode()
            said, page, mirror, engine = text('NOTICES.txt'), text('games/hexsweeper/sphere/index.html'), text('games/hexsweeper/sphere/mirror-material.js'), text('games/hexsweeper/sphere/sphere.js')
            sources, manifest = text('games/hexsweeper/sphere/assets/reflections/SOURCES.md'), text('SOURCE_MANIFEST.json')
            files = [bundle.read(n) for n in names if not n.endswith('/')]
        photos = sorted(n.rsplit('/', 1)[1] for n in names if 'assets/reflections/' in n and n.endswith('.webp'))
        self.assertEqual(len(photos), 12)
        for gone in ['classic-minesweeper', 'stratosphere-1024', 'stratosphere-2048']:
            self.assertFalse([n for n in names if gone in n], gone)
            for body in [page, mirror, engine, sources, manifest]:
                self.assertNotIn(gone, body)
        # Not by name and not by content: the shipped hashes of the screenshot and both Stratosphere sizes.
        # The SHA-256 of each file as Hexsweeper f4ea5ca (and e61a79f, shipped through 0.5.8) carries it: not in the
        # package and not in the source record; the importer no longer takes the files at all.
        gone = {'hexsweeper/sphere/assets/classic-minesweeper.png': 'b42114581fded77b4aa8e003634ee68682a7013f3ce7d43f2ac119b4fc0360fa',
                'hexsweeper/sphere/assets/reflections/stratosphere-1024.webp': '6a4464d76e50c17740ed17a3f10efa074657f664dd0a293020dae7bd4c159fa8',
                'hexsweeper/sphere/assets/reflections/stratosphere-2048.webp': '9c0c54f493ab29c116c991275cf558d9d59e638b45e6300cb691d78bbf5f78c5'}
        shipped = {hashlib.sha256(bundle_bytes).hexdigest() for bundle_bytes in files}
        recorded = (ROOT / 'sources.json').read_text()
        for path, digest in gone.items():
            self.assertNotIn(digest, shipped)
            self.assertNotIn(digest, manifest)
            self.assertNotIn(path, recorded)
            self.assertFalse((ROOT / 'imports' / path).exists())
        self.assertIn('const ROSTER = ["light", "dark", "mercury", "ion-storm", "aurora", "galaxy", "heat-lightning"];', page)
        self.assertIn('    THEME_MERCURY,\n    THEME_ION_STORM,\n    THEME_AURORA,\n', engine)
        for gone in ['class="help-history-row"', 'id="history-lightbox"', 'id="help-history-btn"']:
            self.assertNotIn(gone, page)
        self.assertIn('id="help-theme-credit">Photographs: Ion Storm by Felix Mittermeier, Galaxy by Jose G. Ortega Castro, Heat Lightning by Max LaRochelle, on Unsplash (Unsplash License).', page)
        raw = (ROOT / 'imports/hexsweeper/sphere/mirror-material.js').read_text()
        self.assertEqual(mirror.count('retired: true'), raw.count('retired: true') + 1)
        self.assertEqual(mirror.count('Retired stratosphere slot'), 1)
        for credit in ['Unsplash License', 'Felix Mittermeier', 'Jose G. Ortega Castro', 'Max LaRochelle', 'Johannes Plenio', 'Daniel Olah', 'Adam Gonzales', 'Solar System Scope']:
            self.assertIn(credit, said)
        for gone in ['Microsoft', 'Minesweeper screenshot', 'stratosphere', 'Stratosphere']:
            self.assertNotIn(gone, said)
        # The repository's own notice file says the same, for the source as published.
        repo = (ROOT / 'THIRD-PARTY-NOTICES.md').read_text()
        for credit in ['Unsplash License', 'Felix Mittermeier', 'Jose G. Ortega Castro', 'Max LaRochelle', 'Johannes Plenio', 'Daniel Olah', 'Adam Gonzales', 'Solar System Scope', 'Robert Scanlon', 'Apache License 2.0', 'LICENSE-THREE.txt']:
            self.assertIn(credit, repo)

    def test_open_assets_anchor_drift_is_fatal(self):
        from assets_recipe import transform as assets
        from assets_recipe import rewrite
        for hexsweeper in [{'id': 'hexsweeper', 'freeAssets': True}, {'id': 'hexsweeper'}]:
            for path in ['hexsweeper/sphere/sphere.js', 'hexsweeper/sphere/index.html', 'hexsweeper/sphere/mirror-material.js']:
                with self.assertRaises(ValueError):
                    assets(hexsweeper, path, 'nothing to anchor on')
            with self.assertRaises(ValueError):
                rewrite(hexsweeper, 'hexsweeper/sphere/assets/reflections/SOURCES.md', b'nothing to anchor on')
        self.assertEqual(assets({'id': 'hexsweeper'}, 'hexsweeper/sphere/quiet-chrome.js', 'untouched'), 'untouched')
        self.assertEqual(assets({'id': 'akari', 'freeAssets': True}, 'akari/akari.js', 'untouched'), 'untouched')

    def test_camera_anchor_drift_is_fatal(self):
        from camera_recipe import transform as camera
        with self.assertRaises(ValueError):
            camera({'id': 'akari', 'camera': False}, 'akari/controls.js', 'no frame here')
        self.assertEqual(camera({'id': 'akari'}, 'akari/controls.js', 'untouched'), 'untouched')


class ShippedPageTests(unittest.TestCase):
    """Scan the actual archive, the shell included, rather than the transform's own checks."""

    @classmethod
    def setUpClass(cls):
        archive = ROOT / 'build/minimal-primitives-browser.zip'
        if not archive.exists():
            subprocess.run([sys.executable, 'tools/build.py'], cwd=ROOT, check=True, capture_output=True)
        with zipfile.ZipFile(archive) as bundle:
            cls.files = {name: bundle.read(name).decode() for name in bundle.namelist()
                         if name.endswith(('.html', '.js', '.mjs', '.css'))}
            cls.catalog = json.loads(bundle.read('catalog.json'))

    def test_outside_links_open_in_a_new_tab(self):
        seen, bad = set(), []
        for name, text in self.files.items():
            for tag in re.findall(r'<a\b[^>]*>', text, re.I):
                if not re.search(r'\bhref\s*=\s*["\']?https?://', tag, re.I):
                    continue
                seen.add(name)
                target = re.search(r'\btarget\s*=\s*["\']([^"\']*)["\']', tag, re.I)
                rel = re.search(r'\brel\s*=\s*["\']([^"\']*)["\']', tag, re.I)
                if not (target and target.group(1) == '_blank' and rel and 'noopener' in rel.group(1).lower().split()):
                    bad.append((name, tag))
        self.assertEqual(bad, [])
        self.assertIn('index.html', seen)
        # Every game's Settings/Help credit is part of the scan. A game whose only
        # outside link was the Minimal board (now the library link) has none left.
        credit = re.compile(r'<a\b[^>]*\bhref\s*=\s*["\']?https?://(?!lukesteuber\.com/(?:games|minimal)/?["\'])', re.I)
        for game in self.catalog:
            if not any(credit.search(path.read_text()) for path in (ROOT / 'imports' / game['id']).rglob('*.html')):
                continue
            self.assertTrue(any(name.startswith('games/' + game['id'] + '/') for name in seen), game['id'])

    def test_no_home_screen_install_in_the_package(self):
        # The web pages install to a home screen; the package ships none of that.
        bad = [name for name, text in self.files.items() if name.endswith('.html') and
               re.search(r'rel=["\']manifest|pwa\.js|apple-mobile-web-app|serviceWorker\.register', text, re.I)]
        self.assertEqual(bad, [])
        self.assertFalse([n for n in self.files if n.endswith(('manifest.webmanifest', '/sw.js', '/pwa.js'))])

    def test_no_shipped_page_references_a_root_absolute_path(self):
        pattern = re.compile(r'''\b(?:href|src|action|poster|data-other)\s*=\s*["']?/(?!/)|url\(\s*["']?/(?!/)''', re.I)
        bad = [(name, match.group(0)) for name, text in self.files.items() if name.endswith(('.html', '.css'))
               for match in pattern.finditer(text)]
        self.assertEqual(bad, [])
        akari = self.files['games/akari/index.html']
        self.assertIn('id="look-other" class="look-link" href="../../games/akari-light/index.html?look=light"', akari)
        self.assertNotIn('akari-preview', akari)
        self.assertIn('href="../../games/akari/index.html?look=dark"', self.files['games/akari-light/index.html'])



class LibraryIndexTests(unittest.TestCase):
    """The library is the live Minimal index, imported by tools/import-index.py at a pinned commit.
    These fail when the two are edited apart; `tools/import-index.py --check` catches the index moving on."""

    @classmethod
    def setUpClass(cls):
        cls.index = json.loads((ROOT / 'index.json').read_text())
        cls.tiles = [t for t in cls.index['tiles'] if not t.get('notBundled')]
        cls.sources = json.loads((ROOT / 'sources.json').read_text())['games']

    def test_pictures_and_stylesheet_are_the_index_s_own(self):
        style = (ROOT / 'web/index-tiles.css').read_text().split('*/\n', 1)[1]
        self.assertEqual(hashlib.sha256(style.encode()).hexdigest(), self.index['styleSha256'])
        used = set()
        for tile in self.tiles:
            for key in ('art', 'artWide', 'lines'):
                if tile[key]:
                    data = (ROOT / 'web' / tile[key]['file']).read_bytes()
                    self.assertEqual(hashlib.sha256(data).hexdigest(), tile[key]['sha256'], tile['name'])
                    used.add(Path(tile[key]['file']).name)
            for ground in ('dark', 'light') if tile.get('solved') else ():
                art = tile['solved'][ground]
                self.assertEqual(hashlib.sha256((ROOT / 'web' / art['file']).read_bytes()).hexdigest(), art['sha256'], tile['name'])
                self.assertRegex(Path(art['file']).name, r'-solved(?:-light)?-%s\.webp$' % art['sha256'][:12], 'named by its own hash')
                used.add(Path(art['file']).name)
        self.assertEqual({p.name for p in (ROOT / 'web/assets/tiles').iterdir()}, used, 'no stray tile pictures or drawings')
        # Main games have no second, hand-kept picture; only the accessible puzzles keep theirs.
        self.assertEqual({p.stem for p in (ROOT / 'web/assets').glob('*.png')},
                         {g['id'] for g in self.sources if g.get('group') == 'accessible'})

    def test_finished_tiles_show_a_bundled_solved_picture(self):
        # A finished game's tile shows that game's own solved board, bundled with the app: the nine the index names,
        # and Notan, whose record the package can read and the web page cannot (APP_LIFE in tools/import-index.py).
        solved = {t['name']: t for t in self.tiles if t.get('solved')}
        self.assertEqual(list(solved), ['Slant', 'Notan', 'Bridges', 'Spiral Galaxies', 'Cast', 'Folding', 'Towers', 'Tents', 'Shoo', 'Balance'])
        for name, tile in solved.items():
            self.assertTrue(tile['set'], name + ' can be finished')
            self.assertTrue(0.5 <= tile['solved']['fill'] <= 0.8, name)
        self.assertEqual({t['name'] for t in self.tiles if t.get('set') and not t.get('solved')}, {'Akari', 'Tilt', 'Horologist'},
                         'the games that finish without color keep the one-color mark')
        # Notan's whole set is every board its pinned source lists (the ramp and New Game+), kept under ink.v1.
        boards = sum(len(re.findall(r"\{ id: '[\w-]+'", (ROOT / 'imports/notan' / name).read_text())) for name in ('levels.js', 'plus-levels.js'))
        self.assertEqual(solved['Notan']['set'], ['ink', boards])
        self.assertIn("const KEY = 'ink.v1';", (ROOT / 'imports/notan/notan.js').read_text())
        self.assertIn("'All ' + all + ' boards solved.'", (ROOT / 'imports/notan/notan.js').read_text())
        # The build names each picture for a tile on black and one on white, and the shell reads them only from the package.
        subprocess.run([sys.executable, str(ROOT / 'tools/build.py'), '--no-zip'], check=True, capture_output=True)
        built = {t['name']: t for t in json.loads((ROOT / 'build/html/tiles.json').read_text()) if t.get('solved')}
        self.assertEqual(list(built), list(solved))
        for name, tile in built.items():
            for ground in ('dark', 'light'):
                self.assertRegex(tile['solved'][ground], r'^assets/tiles/[\w-]+\.webp\?v=[0-9a-f]{12}$', name)
                self.assertTrue((ROOT / 'build/html' / tile['solved'][ground].split('?')[0]).is_file(), name)
        shell = (ROOT / 'web/collection.js').read_text()
        self.assertIn("tile.classList.toggle('won', won); picture(tile);", shell)
        self.assertNotIn('solved-capture', shell + json.dumps(self.index), 'the capture script stays with the index')

    def test_one_hexsweeper_tile_with_the_other_boards_through_it(self):
        hexes = [t for t in self.tiles if t['game'] == 'hexsweeper']
        self.assertEqual(len(hexes), 1)
        self.assertEqual((hexes[0]['name'], hexes[0]['mode']), ('Hexsweeper', 'sphere'))
        self.assertEqual([(l['label'], l['mode']) for l in hexes[0]['also']], [('Flat', 'classic'), ('Endless', 'infinite')])

    def test_card_links_open_bundled_games_or_are_left_off(self):
        # Every "Also" link on a card the package shows opens a bundled game; a link the package does not
        # carry is recorded with its reason and drawn nowhere (Quipu on Notan, Hands on on Simple Machines).
        links = {(t['name'], l['label']): (l['game'], l['mode']) for t in self.tiles for l in t['also']}
        self.assertEqual(links, {('Hexsweeper', 'Flat'): ('hexsweeper', 'classic'), ('Hexsweeper', 'Endless'): ('hexsweeper', 'infinite'),
                                 ('Bridges', 'Constellations'): ('constellations', None),
                                 ('Tilt', '3D'): ('tilt-3d', None), ('Tilt', 'Cube Maze'): ('cube-maze', None)})
        left_off = {(n['on'], n['name']) for n in self.index['notBundled'] if 'on' in n}
        self.assertEqual(left_off, {('Notan', 'Quipu'), ('Simple Machines', 'Hands on')})
        drawn = {l['href'] for t in self.tiles for l in t['also']}
        for entry in self.index['notBundled']:
            self.assertTrue(entry['reason'], entry['name'])
            self.assertNotIn(entry['href'], drawn)
        ids = {g['id'] for g in self.sources}
        self.assertNotIn('quipu', ids)
        self.assertIn('cube-maze', ids)

    def test_tangles_opens_from_its_tile_and_keeps_its_experiments_inside(self):
        # The Tangles tile opens the bundled game. Its Experiments play on a second page of the same game, with
        # the collection's handshake carried both ways; the web's six share-only tiling pages are not imported.
        tile = next(t for t in self.tiles if t['name'] == 'Tangles')
        self.assertEqual((tile['game'], tile['mode'], tile['href']), ('tangles', None, 'https://lukesteuber.com/games/loop/'))
        self.assertNotIn('Tangles', [n['name'] for n in self.index['notBundled']])
        game = next(g for g in self.sources if g['id'] == 'tangles')
        paths = {f['path'] for f in game['files']}
        self.assertLessEqual({'tangles/index.html', 'tangles/experiments.html', 'tangles/experiments.js', 'tangles/experiments-list.js'}, paths)
        self.assertEqual([p for p in paths if p.endswith('.html') and p not in {'tangles/index.html', 'tangles/experiments.html'}], [])
        source = (ROOT / 'imports/tangles/experiments.js').read_text()
        built = transform(game, 'tangles/experiments.js', source)
        self.assertNotIn("ROOT = STANDALONE ? '../' : './';", built)
        self.assertIn("+ 'index.html' + (window.MinimalBridge && MinimalBridge.nonce ? '?minimal=' + MinimalBridge.nonce : '')", built)
        # Every link Tangles makes to its Experiments is an ordinary link to that page. The handshake goes with it
        # in the one place that carries it for every game (adapters/bootstrap.js), not in Tangles' own adapter.
        listing = (ROOT / 'imports/tangles/experiments-list.js').read_text()
        self.assertGreaterEqual(listing.count('./experiments.html?'), 3)
        self.assertEqual(listing.count('experiments.html'), listing.count('./experiments.html?'))
        self.assertNotIn("addEventListener('click'", (ROOT / 'adapters/private/tangles.js').read_text())
        self.assertIn("url.searchParams.set('minimal', nonce);\n    a.setAttribute('href', url.href);", (ROOT / 'adapters/bootstrap.js').read_text())

    def test_weaves_opens_from_its_own_tile(self):
        # Weaves is game-riffs weave-minimal/, bundled as `weaves`; Quipu (game-riffs weave/) is a different game.
        tile = next(t for t in self.tiles if t['name'] == 'Weaves')
        self.assertEqual((tile['game'], tile['mode'], tile['href'], tile['also']), ('weaves', None, 'https://lukesteuber.com/games/weave-minimal/', []))
        self.assertNotIn('Weaves', [n['name'] for n in self.index['notBundled']])
        game = next(g for g in self.sources if g['id'] == 'weaves')
        self.assertEqual((game['title'], game['runtime']['id'], game['entry']), ('Weaves', 'weave-minimal', 'weaves/index.html'))
        page = (ROOT / 'build/html/games/weaves/index.html').read_text()
        self.assertIn('<title>Weaves</title>', page)
        built = (ROOT / 'build/html/games/weaves/weave.js').read_text()
        for call in ['MinimalAdapter?.committed()', 'MinimalAdapter?.undo()', 'MinimalAdapter?.restart()', 'MinimalAdapter?.assist()', "scoringPolicy:'hits-v1'"]:
            self.assertEqual(built.count(call), 1, call)

    def test_themes_and_opening_are_the_index_s_without_its_previews(self):
        # The library opens Dark like the index, with Light and Checkerboard as the other themes; its line drawings
        # replace the pictures in Dark and Light, and its opening is the index's markup. The index's color look
        # (?look=flourish, html[data-color]), its "signs of life" preview (?life=1) and its address switches stay out.
        style = (ROOT / 'web/index-tiles.css').read_text().split('*/\n', 1)[1]
        selectors = [s.strip() for block in re.findall(r'([^{}]+)\{[^{}]*\}', re.sub(r'/\*.*?\*/', '', style, flags=re.S))
                     for s in block.split(',') if not s.strip().startswith('@')]
        for selector in selectors:
            if 'data-look' in selector or 'data-color' in selector:
                self.assertRegex(selector, r'^html\[data-(?:look|color)', selector)
        shell = '\n'.join((ROOT / path).read_text() for path in ['web/index.html', 'web/collection.js', 'web/collection.css', 'web/library-theme.js',
                                                                 'web/duo-layout.js', 'adapters/bootstrap.js', 'adapters/hooks.js'])
        for word in ['data-color', 'minimal.index.theme.v1', "'minimal.opening'"]:
            self.assertFalse(word in shell, word)
        self.assertIsNone(re.search(r'''get\(\s*["'](?:look|intro|life)["']\s*\)|[?&](?:look|intro|life)=''', shell), 'no address switches')
        theme = (ROOT / 'web/library-theme.js').read_text()
        self.assertIn("const setting = prefs => THEMES.includes(prefs?.theme) ? prefs.theme : 'system'", theme, "the phone's setting is the default")
        self.assertIn("asks('(prefers-color-scheme: dark)') ? 'dark' : asks('(prefers-color-scheme: light)') ? 'light' : 'checkerboard'", theme)
        page = (ROOT / 'web/index.html').read_text()
        self.assertLess(page.index('library-theme.js'), page.index('index-tiles.css'), 'the theme is set before the styles and the first paint')
        self.assertNotIn(' defer', page[page.index('library-theme.js') - 40:page.index('library-theme.js') + 20])
        self.assertIn('<option value="system">Follow phone</option><option value="checkerboard">Checkerboard</option><option value="light">Light</option><option value="dark">Dark</option>', self.index['settings'])
        self.assertEqual(page.count('<!--index:header-->'), 1)
        self.assertEqual(page.count('<!--index:settings-->'), 1)
        # The drawings: every tile the index's script swaps has one; Hexsweeper, Spiral Galaxies and Tangles keep their pictures.
        self.assertEqual({t['name'] for t in self.tiles if not t.get('lines') and not t['svg']}, {'Hexsweeper', 'Spiral Galaxies', 'Tangles'})
        for tile in self.tiles:
            if tile.get('lines'):
                self.assertTrue(tile['lines']['file'].endswith('-lines.svg'), tile['name'])
        self.assertEqual({p.name for p in (ROOT / 'web/assets/tiles').glob('*-color.svg')}, set(), 'no flourish art')
        # The opening is the index's own markup, placed in the built page, hidden until collection.js plays it.
        opening = self.index['opening']
        self.assertRegex(opening, r'^<div class="intro" id="intro" aria-hidden="true" hidden>')
        self.assertEqual(re.findall(r'<li>([^<]+)</li>', opening), ['get', 'put', 'push', 'turn', 'join', 'split', 'bend', 'switch'])
        subprocess.run([sys.executable, str(ROOT / 'tools/build.py'), '--no-zip'], check=True, capture_output=True)
        built = (ROOT / 'build/html/index.html').read_text()
        self.assertEqual(built.count(opening), 1)
        self.assertLess(built.index(opening), built.index('<main id="library">'))
        for part in ('header', 'settings'):
            self.assertEqual(built.replace(' target="_blank" rel="noopener noreferrer"', '').count(self.index[part]), 1, part)
        self.assertNotIn('<!--index:', built)
        self.assertEqual(self.tiles[-1]['name'], 'Eye, head & switch games')

    def test_every_bundled_game_is_reached_from_exactly_one_place(self):
        reached = [(t['game'], t['mode']) for t in self.tiles if t['game'] != 'accessible']
        reached += [(l['game'], l['mode']) for t in self.tiles for l in t['also']]
        carried = [(g['id'], m['id']) for g in self.sources if not g.get('group') for m in (g.get('modes') or [{'id': None}])]
        self.assertEqual(sorted(reached, key=str), sorted(carried, key=str))
        self.assertEqual(self.tiles[-1]['game'], 'accessible', 'the last tile opens the accessible puzzles')

    def test_the_build_serves_the_index_s_tiles_in_order(self):
        subprocess.run([sys.executable, str(ROOT / 'tools/build.py'), '--no-zip'], check=True, capture_output=True)
        built = json.loads((ROOT / 'build/html/tiles.json').read_text())
        self.assertEqual([t.get('name') or t['skip'] for t in built], [t['name'] for t in self.index['tiles']])
        for made, tile in zip(built, self.index['tiles']):
            if not tile.get('notBundled'):
                self.assertEqual((made['line'], made['classes'], made['label']), (tile['line'], tile['classes'], tile['label']))
        page = (ROOT / 'build/html/index.html').read_text()
        self.assertLess(page.index('index-tiles.css'), page.index('collection.css'), "the index's stylesheet loads first")
        self.assertNotIn('--paper:#', (ROOT / 'web/collection.css').read_text().split('#access-tiles')[0], 'tile grounds come from the index')


class PackageOffersOnlyWhatWorksTests(unittest.TestCase):
    """Build-time changes for the app package: no link that strands the player, no sharing or download that cannot
    work in an app, no camera without a press, and a privacy page that says what the build being made does."""

    @classmethod
    def setUpClass(cls):
        for variant in ([], ['--variant', 'fdroid']):
            subprocess.run([sys.executable, str(ROOT / 'tools/build.py'), '--no-zip', *variant], check=True, capture_output=True)
        cls.full, cls.free = ROOT / 'build/html', ROOT / 'build/html-fdroid'
        cls.games = {g['id']: g for g in json.loads((ROOT / 'sources.json').read_text())['games']}

    def test_cast_has_no_link_to_the_old_cast(self):
        # "Cast · Old" (../cast/) is this same page in the package, reached without the collection's handshake:
        # Home, All games and Scores stopped answering there.
        for root in (self.full, self.free):
            page = (root / 'games/cast/index.html').read_text()
            self.assertNotIn('../cast/', page)
            self.assertNotIn('Cast · Old', page)
            self.assertIn('<footer class="sheet-foot"><a href="../../index.html" data-minimal-library>All games</a> · <a href="https://lukesteuber.com"', page)
            self.assertIn('which this browser has turned off. <a href="../../index.html" data-minimal-library>Back to all games</a>.</p>', page)
        with self.assertRaises(ValueError):
            transform(self.games['cast'], 'cast/index.html', '<html><head></head><body>no old link here</body></html>')
        # No other bundled page links to a game folder without naming its page.
        for path in self.full.glob('games/*/*.html'):
            self.assertIsNone(re.search(r'href="\.\./[a-z0-9-]+/"', path.read_text()), path.name)

    def test_no_game_offers_a_share_link_or_a_download(self):
        hidden_share = ('<h3 class="group" hidden>Share</h3><div class="row" hidden style="display:none"><span>This puzzle</span>'
                        '<button id="share">Copy link</button><button id="share-picture" hidden>Share</button></div>')
        for game in ['slant', 'bridges', 'galaxies', 'fold']:
            page = (self.full / 'games' / game / 'index.html').read_text()
            self.assertEqual(page.count(hidden_share), 1, game)
        slant = (self.full / 'games/slant/index.html').read_text()
        self.assertIn('<div class="row" hidden style="display:none"><span>Colored puzzle</span><button id="download">Download</button></div>', slant)
        self.assertIn('<style>#download-btn{display:none!important}</style></head>', slant)
        self.assertIn('<style>#share-btn{display:none!important}</style></head>', (self.full / 'games/notan/index.html').read_text())
        endless = (self.full / 'games/hexsweeper/infinite.html').read_text()
        for control in ['export-run-btn', 'import-run-btn']:
            self.assertRegex(endless, r'<button hidden type="button" class="help-pack" id="' + control + '"')
        # Every Settings sheet in the package: a Share heading, a Copy link or a Download row is never left showing.
        for path in sorted(self.full.glob('games/**/*.html')):
            page = path.read_text()
            self.assertNotIn('<h3 class="group">Share</h3>', page, path)
            for label in ['Copy link', 'Download']:
                for row in re.findall(r'<div class="row"[^>]*>(?:(?!</div>).)*>' + label + '</button>', page):
                    self.assertIn(' hidden', row.split('>')[0], f'{path}: {label}')
        for path in ['slant/index.html', 'bridges/index.html', 'galaxies/index.html', 'fold/index.html']:
            with self.assertRaises(ValueError):
                transform(self.games[path.split('/')[0]], path, '<html><head></head><body>no share row</body></html>')

    def test_the_camera_starts_only_after_a_press(self):
        # Permission granted earlier is not the player asking now: neither the shared frame nor a camera game starts
        # the camera by itself when a game opens, in either build.
        from camera_recipe import CAMERA_GAMES, press_first
        for root in (self.full, self.free):
            frames = sorted(root.glob('games/*/access.js'))
            self.assertGreaterEqual(len(frames), 29)
            for path in frames:
                text = path.read_text()
                self.assertNotIn("if(s==='granted')startCamera", text, path)
                self.assertEqual(text.count("permission().then(s=>{if(mode!=='look'||phase!=='prompt')return;if(s==='denied')fallback();});"), 1, path)
            for game in CAMERA_GAMES:
                text = (root / 'games' / game / (game + '.js')).read_text()
                self.assertNotIn("state === 'granted'", text, game)
                self.assertEqual(text.count("permission().then(state => { if (phase !== 'prompt') return; if (state === 'denied') fallback(); });"), 1, game)
        with self.assertRaises(ValueError):
            press_first({'id': 'glance'}, 'glance/glance.js', 'no camera start here')
        with self.assertRaises(ValueError):
            press_first({'id': 'akari'}, 'akari/access.js', 'no camera start here')
        self.assertEqual(press_first({'id': 'akari'}, 'akari/akari.js', 'untouched'), 'untouched')

    def test_each_build_has_its_own_privacy_page(self):
        sys.path.insert(0, str(ROOT / 'tools'))
        from build import privacy_page
        source = (ROOT / 'web/privacy.html').read_text()
        full, free = (self.full / 'privacy.html').read_text(), (self.free / 'privacy.html').read_text()
        self.assertEqual((full, free), (privacy_page(source, True), privacy_page(source, False)))
        for page in (full, free):
            self.assertNotRegex(page, r'<!--(?:full|camera-free):')
            self.assertEqual(page.count('<h2 class="group">Camera</h2>'), 1)
            for fact in ['no account, no advertising, no analytics and no tracking', 'does not collect personal data or usage data',
                         'The Android app has no network permission at all.', 'are stored on this device', 'open in your browser, outside the app']:
                self.assertIn(fact, page)
            self.assertNotRegex(page, r'<a\b[^>]*href="(?:https?:|mailto:)', 'nothing on the page needs the network or another app')
        self.assertIn('Camera images are processed on this device, by MediaPipe Face Landmarker', full)
        self.assertIn('They are never saved, uploaded or shared.', full)
        self.assertIn('This is the camera-free build. It has no camera input', free)
        for word in ['MediaPipe', 'Eye tracker', 'The app asks for the camera']:
            self.assertNotIn(word, free)
        # No build offers the Eye tracker choice (test_eye_tracker_is_not_offered), so neither page describes it.
        self.assertNotRegex(full, r'(?i)eye tracker|helper program')
        for broken in [source.replace('<!--full:end-->', ''), source.replace('<!--camera-free:begin-->', '<!--camera-free:begin-->\n<!--camera-free:begin-->')]:
            with self.assertRaises(ValueError):
                privacy_page(broken, True)
        # The page's facts, where they are kept: no score service in any build made here, no network permission on
        # Android, the camera permission in the full flavor only.
        self.assertEqual(json.loads((ROOT / 'web/settings.json').read_text()), {'apiBase': ''}, 'privacy.html says scores stay on the device')
        manifest = (ROOT / 'android/app/src/main/AndroidManifest.xml').read_text()
        self.assertEqual(re.findall(r'<uses-permission android:name="([^"]+)"', manifest), ['android.permission.VIBRATE'])
        self.assertEqual(re.findall(r'<uses-permission android:name="([^"]+)"', (ROOT / 'android/app/src/full/AndroidManifest.xml').read_text()), ['android.permission.CAMERA'])
        # The library opens it from Settings, and the page is in both builds' manifests.
        self.assertIn("fetch('privacy.html')", (ROOT / 'web/collection.js').read_text())
        for root in (self.full, self.free):
            self.assertIn('privacy.html', json.loads((root / 'BUILD_MANIFEST.json').read_text()))

    def texts(self, root, suffixes=('.html', '.js', '.mjs', '.css', '.json')):
        return {p.relative_to(root).as_posix(): p.read_text(errors='replace') for p in sorted(root.rglob('*')) if p.is_file() and p.suffix in suffixes}

    def test_no_page_counter_and_nothing_loaded_from_the_network(self):
        # The web pages count visits and their content policies allow the counter's host. The package loads no
        # counter and nothing else from a network: no packaged file names the host, no element or style takes its
        # source from an address outside the package, and no script asks one for anything. web/privacy.html says so.
        loads = re.compile(r'''<(?:script|img|iframe|source|video|audio|embed|object|link|form|input|track)\b[^>]*?\b(?:src|srcset|href|data|action|poster)\s*=\s*["']?(?:https?:)?//[^"'\s>]+''', re.I)
        styles = re.compile(r'''url\(\s*["']?(?:https?:)?//|@import\s+["'](?:https?:)?//''', re.I)
        calls = re.compile(r'''\b(?:fetch|sendBeacon|EventSource|importScripts|Worker|import)\s*\(\s*[`"'](?:https?:)?//'''
                           r'''|\bWebSocket\s*\(\s*[`"']wss?://(?!127\.0\.0\.1[:/])|\.open\(\s*["'](?:GET|POST)["']\s*,\s*["'](?:https?:)?//'''
                           r'''|\bfrom\s+["']https?://|\.src\s*=\s*[`"'](?:https?:)?//''')
        for root in (self.full, self.free):
            for name, text in self.texts(root).items():
                self.assertNotIn('stats.dr.eamer.dev', text, name)
                self.assertNotRegex(text, r'data-goatcounter|count\.js|goatcounter\s*=[^=]', name)
                self.assertIsNone(loads.search(text), f'{name}: {loads.search(text) and loads.search(text).group(0)[:120]}')
                self.assertIsNone(styles.search(text), name)
                self.assertIsNone(calls.search(text), f'{name}: {calls.search(text) and calls.search(text).group(0)[:120]}')
                for policy in re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', text, re.I):
                    outside = [word for word in policy.replace(';', ' ').split() if '://' in word]
                    self.assertEqual(outside, [], f'{name} allows a load from outside the package')
        # The one address a script builds is the eye-tracker helper's, on the same computer (bridge-client.js),
        # which no build can reach any more: the choice is unavailable and no page's policy allows the connection
        # (test_eye_tracker_is_not_offered). The score service's is empty in every build made here
        # (web/settings.json). An address a script puts together from parts is beyond these searches:
        # tests/shell-review.test.cjs plays the built package and fails on any request that leaves it, and the
        # apps' shells refuse one (Android has no network permission and answers every http request itself).
        bridge = {name.rsplit('/', 1)[-1] for name, text in self.texts(self.full, ('.js', '.mjs')).items() if "'ws://127.0.0.1:'" in text}
        self.assertEqual(bridge, {'bridge-client.js'})
        self.assertEqual(json.loads((self.full / 'settings.json').read_text()), {'apiBase': ''})
        from transforms import transform
        page = {'id': 'notan', 'commit': '0' * 40, 'files': []}
        with self.assertRaises(ValueError):
            transform(page, 'notan/x.css', "@import 'https://stats.dr.eamer.dev/count.css';")
        policy = transform(page, 'notan/x.html', '''<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; '''
                           '''img-src 'self' data: https://stats.dr.eamer.dev"></head><body><!-- GoatCounter Analytics --></body></html>''')
        self.assertIn('''content="default-src 'self'; img-src 'self' data:"''', policy)
        self.assertNotIn('GoatCounter', policy)
        for root in (self.full, self.free):
            self.assertIn('no analytics', (root / 'privacy.html').read_text())
            self.assertIn('load nothing from the network', (root / 'privacy.html').read_text())

    def test_outside_links_are_the_known_few(self):
        # Every way out of the package a player can reach: where it leads, by the page that carries it. Each opens
        # outside the app (target="_blank": the Android shell hands it to the browser, the iOS shell to Safari).
        # A new one must be added here on purpose. All are the author's own: his site, Data Poems, the source and
        # oneimpossiblethingatatime.com. The history of Minesweeper in Hexsweeper Sphere's Help is words, not a link.
        known = {'https://lukesteuber.com', 'https://lukesteuber.com/', 'https://datapoems.io', 'https://oneimpossiblethingatatime.com/',
                 'https://github.com/lukeslp/minimal-primitives'}
        found, opened = set(), []
        for root in (self.full, self.free):
            for name, text in self.texts(root, ('.html', '.js', '.mjs')).items():
                if '/vendor/' in name:
                    continue
                for tag, href in re.findall(r'''(<a\b[^>]*\bhref\s*=\s*["'](https?://[^"']+)["'][^>]*>)''', text):
                    found.add(href)
                    self.assertRegex(tag, r'''target=["']_blank["']''', name)
                self.assertNotIn('coolmathgames', text, name)
                if 'window.open(' in text and root == self.full:
                    opened.append(name)
        self.assertEqual(found, known)
        # No packaged script opens a window at all.
        self.assertEqual(opened, [])
        sphere = (self.full / 'games/hexsweeper/sphere/index.html').read_text()
        # The Help row that named Minesweeper's history went with its screenshot (tools/assets_recipe.py).
        self.assertNotIn('history of Minesweeper', sphere)
        with self.assertRaises(ValueError):
            transform(self.games['hexsweeper'], 'hexsweeper/sphere/index.html',
                      (ROOT / 'imports/hexsweeper/sphere/index.html').read_text().replace('the-history-of-minesweeper', 'another-article'))
        # No script sends the page itself to another site (Notan's hand-off to its own domain stays off).
        self.assertIn('const HAND_OFF = false;', (self.full / 'games/notan/notan.js').read_text())

    def test_no_link_leads_to_another_packaged_page_without_the_library(self):
        # A game plays in a frame the library opened for it, with a handshake in that page's address. Hexsweeper's
        # Help named its other modes as links ("Also Infinite · Classic", "Also Sphere · Classic"): they loaded a
        # second mode in the first one's frame, where Home did nothing, and the one to Sphere named a page that
        # is not in the package. The rows are gone; the library's card offers the modes.
        from transforms import ALSO_ROWS
        for root in (self.full, self.free):
            for path, row in ALSO_ROWS.items():
                page = (root / 'games' / path).read_text()
                self.assertNotIn('class="help-more"', page, path)
                self.assertEqual((ROOT / 'imports' / path).read_text().count(row), 1, path)
            # Every link written into a page that stays inside the package: the library (which the page hands to
            # the collection), and Akari's other look, which its own script opens with the handshake.
            inside = {}
            for path in sorted(root.glob('games/**/*.html')):
                for tag, href in re.findall(r'''(<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>)''', path.read_text()):
                    if not re.match(r'https?:|\$\{', href) and 'data-minimal-library' not in tag:
                        inside.setdefault(href, []).append(path.relative_to(root / 'games').as_posix())
            self.assertEqual(inside, {'../../games/akari-light/index.html?look=light': ['akari/index.html'],
                                      '../../games/akari/index.html?look=dark': ['akari-light/index.html']})
        for path in ALSO_ROWS:
            with self.assertRaises(ValueError, msg=path):
                transform(self.games['hexsweeper'], path, (ROOT / 'imports' / path).read_text().replace('class="help-more">Also', 'class="help-more">See also'))
        # Links a script makes (Tangles' Experiments and New Game+) and any link a later import brings are covered
        # where the click is handled: one listener, for same-origin links, in every packaged page.
        bootstrap = (ROOT / 'adapters/bootstrap.js').read_text()
        self.assertEqual(bootstrap.count("window.addEventListener('click', event => {"), 1)
        self.assertIn("if (url.protocol !== location.protocol || url.origin !== location.origin) return;", bootstrap)
        # The Android shell's Back: Home counts once the library shows, and a page without the handshake is left.
        shell = (ROOT / 'android/app/src/main/java/minimalprimitives/android/MainActivity.kt').read_text()
        # The check that follows is for the one game Home was pressed in, named by its handshake, and it leaves
        # through the library, which saves the board or asks the player: the shell reloads over no game.
        self.assertNotIn('"opening", "dialog", "home", "grid", "loading" -> Unit', shell)
        self.assertIn("if (home && bridge && bridge.nonce && bridge.nonce === sent) { home.click(); return 'home:' + sent; }", shell)
        self.assertIn('webView.postDelayed(confirmHome, HOME_LIMIT_MS)', shell)
        self.assertIn("if (window.MinimalLibrary && typeof window.MinimalLibrary.leave === 'function') return window.MinimalLibrary.leave(opened);", shell)
        for gone in ['LIBRARY_SCRIPT', 'HOME_PENDING_SCRIPT', 'data-back']:
            self.assertNotIn(gone, shell)
        self.assertIn('window.MinimalLibrary = { leave };', (ROOT / 'web/collection.js').read_text())

    def test_the_water_wheel_has_no_door(self):
        # Hexsweeper Sphere's Water Wheel is not in the package. Its three doors (a button in Help, a hold on the
        # mine count with a water-fill hint, a button named for screen readers) paused the timer and opened
        # nothing. They are cut whole, so nothing is left to pause the timer, and no script opens a window.
        from transforms import WHEEL_CLICK, WHEEL_HELP, WHEEL_HOLD
        sources = {'hexsweeper/sphere/index.html': [WHEEL_HELP, WHEEL_CLICK], 'hexsweeper/sphere/quiet-chrome.js': [WHEEL_HOLD]}
        for root in (self.full, self.free):
            for path, cuts in sources.items():
                built, source = (root / 'games' / path).read_text(), (ROOT / 'imports' / path).read_text()
                for cut in cuts:
                    self.assertEqual(source.count(cut), 1, path)
                for gone in ['Water Wheel', 'help-wheel-btn', 'qc-wheel', 'qc-egg-door")', 'pauseTimer', 'WHEEL_HREF', 'window.open', 'is-hinting")']:
                    self.assertNotIn(gone, built, f'{path}: {gone}')
            chrome = (root / 'games/hexsweeper/sphere/quiet-chrome.js').read_text()
            self.assertIn('      if (b) b.click();\n    });\n\n    setInterval(paint, 250);', chrome, 'the readout and the bar are as they were')
        for path, cuts in sources.items():
            for cut in cuts:
                with self.assertRaises(ValueError, msg=path):
                    transform(self.games['hexsweeper'], path, (ROOT / 'imports' / path).read_text().replace(cut, cut.replace('Water Wheel', 'Water Mill').replace('pauseTimer', 'stopTimer')))

    def test_eye_tracker_is_not_offered(self):
        # Look with: Eye tracker needs a helper program on the same computer. No phone or tablet has one (and the
        # Android app has no network permission), so the choice only ever reported that it had found nothing.
        # Every build tells the shared frame the helper cannot be reached, which is the frame's own rule for
        # showing the choice unavailable with its own sentence; and no page's policy allows the connection.
        from camera_recipe import GAZE_BRIDGE, INLINE_FRAMES, no_eye_tracker
        frames = sorted(self.full.glob('games/*/controls.js')) + [self.full / 'games' / path for path in sorted(INLINE_FRAMES)]
        self.assertGreaterEqual(len(frames), 31)
        for path in frames:
            text = path.read_text()
            self.assertEqual(text.count('const camOK=cameraAllowed(),trackOK=false,'), 1, path)
            self.assertNotIn('trackOK=trackerAllowed()', text, path)
            self.assertEqual(text.count("['tracker','Eye tracker',!trackOK]"), 1, path)
            # Hexsweeper's flat boards carry an earlier frame, whose buttons step past an unavailable choice without a note.
            self.assertEqual(text.count("!trackOK&&'Eye tracker needs the gaze bridge on this computer, which this page cannot reach.'"), int(path.name == 'controls.js'), path)
            self.assertRegex(text, r"prefs\.look==='tracker'&&!trackOK\)\{?(?:keptLook=prefs\.look;)?prefs\.look='pointer';", path)
        for root in (self.full, self.free):
            allowed = [path for path in sorted(root.rglob('*.html')) if GAZE_BRIDGE in path.read_text() or 'ws:' in ''.join(
                re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', path.read_text(), re.I))]
            self.assertEqual(allowed, [])
        self.assertGreaterEqual(sum(GAZE_BRIDGE in path.read_text() for path in (ROOT / 'imports').glob('*/index.html')), 10, 'the web pages still allow it')
        game = self.games['slant']
        with self.assertRaises(ValueError):
            no_eye_tracker(game, 'slant/controls.js', 'no look sources here')
        self.assertEqual(no_eye_tracker(game, 'slant/slant.js', 'untouched'), 'untouched')
        self.assertEqual(no_eye_tracker(dict(game, camera=False), 'slant/controls.js', 'left to the camera-free recipe'), 'left to the camera-free recipe')
        page = no_eye_tracker(game, 'slant/x.html', '''<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src ws://127.0.0.1:47913 'self'">''')
        self.assertIn('''content="default-src 'self'; connect-src 'self'"''', page)

    def test_a_failed_share_is_said_and_never_downloaded(self):
        # An offered share can fail for a reason other than the player turning it away. The games then fell
        # through to the blob: download the apps drop (Tangles: "Image saved."). In the package the failure goes
        # to the library, which says it in words, and Tangles keeps the picture it drew for the next press.
        from transforms import SHARE_FAILED, TANGLES_SHEET_AGREED
        self.assertEqual(sorted(SHARE_FAILED), ['hexsweeper/sphere/sphere.js', 'tangles/experiments.js', 'tangles/loop.js'])
        for root in (self.full, self.free):
            for path, changes in SHARE_FAILED.items():
                built = (root / 'games' / path).read_text()
                # Tangles has two ways to fail: the sheet refuses, or it will not take this picture.
                self.assertEqual(built.count('window.MinimalBridge.shareFailed();'), 2 if path.startswith('tangles/') else 1, path)
                for old, new in changes:
                    self.assertEqual((built.count(old), built.count(new)), (0, 1), path)
            for path in ['tangles/loop.js', 'tangles/experiments.js']:
                built = (root / 'games' / path).read_text()
                self.assertIn("catch (error) { if (error.name !== 'AbortError') window.MinimalBridge.shareFailed(); return; }\n    window.MinimalBridge.shareFailed();\n  }", built, path)
                # No download, no window and no "saved" is left to reach, and the test for the sheet is the
                # bootstrap's: no canShare is taken as able.
                self.assertNotRegex(built, r"\.download\s*=|window\.open\(|createObjectURL|Image saved", path)
                self.assertEqual(built.count("matchMedia('(pointer: coarse)').matches && " + TANGLES_SHEET_AGREED), 1, path)
            sphere = (root / 'games/hexsweeper/sphere/sphere.js').read_text()
            self.assertEqual(sphere.count('downloadBlob('), 1, 'only its own definition is left')
        self.assertIn("typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({files: [picture]}))", (ROOT / 'adapters/bootstrap.js').read_text())
        for path, changes in SHARE_FAILED.items():
            source = (ROOT / 'imports' / path).read_text()
            for old, _ in changes:
                with self.assertRaises(ValueError, msg=path):
                    transform(self.games[path.split('/')[0]], path, source.replace(old, old[:9] + '~' + old[9:], 1))
        self.assertIn("shareFailed() { this.emit('share-failed'); }", (ROOT / 'adapters/bootstrap.js').read_text())
        self.assertIn("else if (data.type === 'share-failed') notice('The picture could not be shared. Try again.');", (ROOT / 'web/collection.js').read_text())

    def test_cube_maze_hint_survives_a_worker_that_cannot_be_made(self):
        # The game's own fallback (the stored solution's next move, or Undo) ran only when a worker failed after
        # it was made. One that cannot be made at all threw, and Hint did nothing.
        from transforms import HINT_WORKER, HINT_WORKER_GUARDED
        game, source = self.games['cube-maze'], (ROOT / 'imports/cube-maze/cube-maze.js').read_text()
        self.assertEqual(source.count(HINT_WORKER), 1)
        for root in (self.full, self.free):
            built = (root / 'games/cube-maze/cube-maze.js').read_text()
            self.assertEqual((built.count(HINT_WORKER), built.count(HINT_WORKER_GUARDED)), (0, 1))
            self.assertEqual(built.count('new Worker('), 1)
            self.assertIn("w.onmessage = e => done(e.data.path); w.onerror = () => done(null);", built, 'the stand-in reports through the same handler')
            self.assertIn("showHint(path && path.length ? path[0] : onPath ? board.solution[history.length] : 'undo')", built)
        with self.assertRaises(ValueError):
            transform(game, 'cube-maze/cube-maze.js', source.replace("new Worker('./engine.js')", "new Worker('./search.js')"))

    def test_a_picture_is_offered_only_where_the_share_sheet_can_take_it(self):
        # Tangles' Save the picture and Hexsweeper Sphere's Share image fall back to a blob: download, which the
        # apps' web views drop (Android's has no share sheet; Tangles then says "Image saved."). The buttons show
        # only on a page the bootstrap marked as able to share a picture; the games' own decisions are anchored.
        from transforms import SHARE_DECISIONS, SHARE_SHEET_ONLY, transform
        for root in (self.full, self.free):
            for path, (selector, touch_only, script) in SHARE_SHEET_ONLY.items():
                page = (root / 'games' / path).read_text()
                self.assertEqual(page.count(f'html:not([data-minimal-share]) {selector}{{display:none!important}}'), 1, path)
                self.assertEqual(f'@media not (pointer:coarse){{{selector}{{display:none!important}}}}' in page, touch_only, path)
                self.assertIn(script, SHARE_DECISIONS)
        self.assertIn("document.documentElement.dataset.minimalShare = ''", (ROOT / 'adapters/bootstrap.js').read_text())
        for path, anchors in SHARE_DECISIONS.items():
            game = self.games[path.split('/')[0]]
            source = (ROOT / 'imports' / path).read_text()
            with self.assertRaises(ValueError, msg=path):
                transform(game, path, source.replace(anchors[0], 'true', 1))
        # Every other download or share control stays hidden outright (Slant, Bridges, Spiral Galaxies, Fold, Notan,
        # Akari, Hexsweeper Endless), so a new download path must be looked at before it ships.
        downloads = sorted(name for name, text in self.texts(self.full, ('.js', '.mjs', '.html')).items()
                           if '/vendor/' not in name and re.search(r'\.download\s*=', text))
        self.assertEqual(downloads, ['games/hexsweeper/infinite.html', 'games/hexsweeper/sphere/sphere.js', 'games/slant/slant.js'])

    def test_script_syntax_fits_the_ios_deployment_target(self):
        # The iOS app's web view is the system's: a script it cannot parse leaves a blank game. The deployment
        # target is read from ios/project.yml. Class static blocks parse from iOS 16.4 and the regular expression
        # v flag from 17.0; import attributes, regular expression modifiers and `using` are newer than iOS 17.0,
        # so none may ship while the target is below the release that reads them. These are searches, not a parse.
        target = tuple(int(n) for n in re.search(r'deploymentTarget:\n\s+iOS: "(\d+)\.(\d+)"', (ROOT / 'ios/project.yml').read_text()).groups())
        self.assertEqual(target, (17, 0), 'recheck what each rule allows before changing the target')
        rules = [((16, 4), 'a class static block', r'\bstatic\s*\{'),
                 ((17, 0), 'the v flag', r'''/[dgimsuy]*v[dgimsuy]*\.(?:test|exec)\(|RegExp\([^)\n]{0,200},\s*["'][dgimsuy]*v[dgimsuy]*["']\)'''),
                 ((17, 2), 'an import attribute', r'\b(?:import|from)\b[^;\n]{0,160}\b(?:with|assert)\s*\{\s*type\b'),
                 ((18, 2), 'a regular expression modifier', r'\(\?[ims]+(?:-[ims]+)?:|\(\?-[ims]+:'),
                 ((99, 0), 'a using declaration', r'(?:^|[;{}\s])(?:await\s+)?using\s+[A-Za-z_$][\w$]*\s*=')]
        scripts = self.texts(self.full, ('.html', '.js', '.mjs'))
        self.assertGreater(len(scripts), 250)
        for name, text in scripts.items():
            for since, what, pattern in rules:
                found = re.search(pattern, text) if target < since else None
                self.assertIsNone(found, f'{name} uses {what}, which iOS {target[0]}.{target[1]} cannot parse')
            # No static block ships at all today; one would need the target to stay at 16.4 or later.
            self.assertNotRegex(text, r'\bstatic\s*\{', name)
        # Newer calls that would stop a game on iOS 17.0 stay behind a check for themselves, and some do not ship.
        guarded = {'requestIdleCallback': r"window\.requestIdleCallback\s*\|\||'requestIdleCallback' in window",
                   'getCoalescedEvents': r'getCoalescedEvents\?\.\(', 'checkVisibility': r'\.checkVisibility\s*\?',
                   'AbortSignal.any': r'typeof AbortSignal\.any', 'Float16Array': r'typeof Float16Array'}
        for name, text in scripts.items():
            for call, guard in guarded.items():
                if call in text:
                    self.assertRegex(text, guard, f'{name} calls {call} without checking for it')
            self.assertNotRegex(text, r'Object\.groupBy|Map\.groupBy|Promise\.withResolvers|Promise\.try\(|Array\.fromAsync|\.fromBase64\(|\.toBase64\(|RegExp\.escape|'
                                      r'Error\.isError|Math\.sumPrecise|\bTemporal\.|Intl\.DurationFormat|startViewTransition|\bURL\.parse\(|scheduler\.(?:postTask|yield)', name)

    def test_the_privacy_page_names_every_permission_the_package_can_ask_for(self):
        # Tilt · 3D's Phone tilt asks an iPhone or iPad for motion and orientation. The prompt is the web view's
        # own ("Minimal Primitives" Would Like to Access Motion and Orientation): in the iOS 27.2 simulator it came
        # up with the shell implementing no motion delegate method, and with or without a purpose string in
        # Info.plist. The app carries NSMotionUsageDescription all the same, in the privacy page's terms. The page
        # must say so while any packaged script can ask.
        asks = sorted(name for name, text in self.texts(self.full, ('.js', '.mjs', '.html')).items()
                      if re.search(r'Device(?:Orientation|Motion)Event\.requestPermission', text))
        self.assertEqual(asks, ['games/tilt-3d/tilt-3d.js'])
        self.assertIn('<span>Phone tilt</span><button id="phone-tilt"', (self.full / 'games/tilt-3d/index.html').read_text())
        for root in (self.full, self.free):
            page = (root / 'privacy.html').read_text()
            self.assertIn('once you turn on Phone tilt in its Settings', page)
            self.assertIn('never saved or sent', page)
        self.assertIn('an iPhone or iPad asks first before the game may read motion', (self.full / 'privacy.html').read_text())
        project = (ROOT / 'ios/project.yml').read_text()
        self.assertIn('NSMotionUsageDescription: "Lean the phone to steer Tilt · 3D once you turn on Phone tilt in its Settings. '
                      'Motion readings steer the game and are never saved or sent."', project)
        # The web view's prompt is left to ask: the shell does not answer the request for the player.
        self.assertNotIn('requestDeviceOrientationAndMotionPermission', (ROOT / 'ios/MinimalPrimitives/CollectionViewController.swift').read_text())
        # Other prompts a web view can raise: no packaged script asks for any of them.
        for name, text in self.texts(self.full, ('.js', '.mjs', '.html')).items():
            if '/vendor/' in name:
                continue
            self.assertNotRegex(text, r'navigator\.geolocation|Notification\.requestPermission|getDisplayMedia|navigator\.(?:bluetooth|usb|serial|hid)\b|'
                                      r'navigator\.contacts|audio\s*:\s*true', name)

    def test_no_preview_wording_reaches_a_player(self):
        shell = '\n'.join((ROOT / path).read_text() for path in ['web/index.html', 'web/collection.js', 'web/scores-transport.js', 'web/privacy.html',
                                                                 'adapters/bootstrap.js', 'adapters/hooks.js', 'adapters/scores-compat.js'])
        self.assertNotRegex(shell, r'(?i)in this preview|preview build')
        self.assertIn("throw new Error('Scores stay on this device.')", (ROOT / 'web/collection.js').read_text())

    def test_ios_privacy_manifest_and_camera_purpose(self):
        import plistlib
        manifest = plistlib.loads((ROOT / 'ios/MinimalPrimitives/PrivacyInfo.xcprivacy').read_bytes())
        self.assertEqual(manifest, {'NSPrivacyTracking': False, 'NSPrivacyTrackingDomains': [], 'NSPrivacyCollectedDataTypes': [], 'NSPrivacyAccessedAPITypes': []})
        project = (ROOT / 'ios/project.yml').read_text()
        self.assertIn('- path: MinimalPrimitives/PrivacyInfo.xcprivacy\n        buildPhase: resources', project)
        self.assertIn('NSCameraUsageDescription: "Use the front camera to move the game pointer with your head or eyes. '
                      'Camera images are processed on this device and are never saved or sent."', project)
        # The manifest declares no required-reason API, so the release code must use none: user defaults, file
        # timestamps, disk space, system boot time or the active keyboards. DEBUG-only checks are left out of the scan.
        reasons = re.compile(r'UserDefaults|NSUserDefaults|creationDate|modificationDate|contentModificationDate|attributesOfItem|'
                             r'attributesOfFileSystem|volumeAvailableCapacity|systemFreeSize|systemUptime|mach_absolute_time|'
                             r'activeInputModes|\bf?stat\(|getattrlist|statfs')
        for path in sorted((ROOT / 'ios/MinimalPrimitives').glob('*.swift')):
            release, depth = [], 0
            for line in path.read_text().splitlines():
                word = line.strip()
                if word.startswith('#if'):
                    depth += 1 if depth or word == '#if DEBUG' else 0
                elif word.startswith('#endif') and depth:
                    depth -= 1
                elif not depth:
                    release.append(line)
            self.assertIsNone(reasons.search('\n'.join(release)), path.name)


class PrimitivesTests(unittest.TestCase):
    """Every game names its interaction primitives from the shared vocabulary (docs/interaction-primitives.md)."""

    def test_every_game_has_primitives_from_the_vocabulary(self):
        data = json.loads((ROOT / 'primitives.json').read_text())
        allowed = {verb for verbs in data['vocabulary']['groups'].values() for verb in verbs}
        line, words = data['vocabulary']['line'], data['vocabulary']['words']
        self.assertEqual(line, ['get', 'put', 'push', 'turn', 'join', 'split', 'bend', 'switch'], 'the eight words, in the order the opening shows them')
        self.assertEqual(list(words), line)
        self.assertLessEqual({verb for verbs in words.values() for verb in verbs}, allowed, 'each word covers grouped verbs')
        games = [g['id'] for g in json.loads((ROOT / 'sources.json').read_text())['games']]
        self.assertEqual(sorted(data['games']), sorted(games), 'Add the new game to primitives.json')
        for game, entry in data['games'].items():
            self.assertTrue(1 <= len(entry['primitives']) <= 3, game)
            self.assertLessEqual(set(entry['primitives']), allowed, game)
            self.assertTrue(entry['exercises'], game)
            self.assertTrue(1 <= len(entry['words']) <= 2, game)
            self.assertLessEqual(set(entry['words']), set(line), game)
            covered = {verb for word in entry['words'] for verb in words[word]}
            self.assertTrue(set(entry['primitives']) & covered, game + ': its words cover none of its verbs')

    def test_every_public_text_names_the_same_eight_words(self):
        # One list everywhere: the index's opening (imported), the store and itch descriptions and the document.
        line = ', '.join(json.loads((ROOT / 'primitives.json').read_text())['vocabulary']['line'])
        opening = re.findall(r'<li>([^<]+)</li>', json.loads((ROOT / 'index.json').read_text())['opening'])
        self.assertEqual(', '.join(opening), line, 'the opening shows the eight words')
        # Settings' About paragraph is imported with the index and names the same eight.
        self.assertIn('Primitives are what doing is made of: ' + line + '.', json.loads((ROOT / 'index.json').read_text())['settings'])
        for name in ['release/app-store/description.txt', 'release/play/full_description.txt',
                     'fastlane/metadata/android/en-US/full_description.txt', 'release/itch-page.md']:
            text = (ROOT / name).read_text()
            self.assertIn('to building: ' + line + '.', text, name)
            self.assertNotIn('toggle, point', text, name)
        self.assertIn(line.capitalize() + '.', ' '.join((ROOT / 'docs/interaction-primitives.md').read_text().split()))


class ReleaseCopyTests(unittest.TestCase):
    """The release page names every game in one sentence; a new game needs only that edit."""

    def test_every_game_has_its_line_and_the_count_matches(self):
        games = json.loads((ROOT / 'sources.json').read_text())['games']
        words = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()
        words += ['twenty-' + w for w in words[1:10]]
        page = (ROOT / 'release/itch-page.md').read_text().split('\n---\n')[0]
        self.assertIn(words[len(games)].capitalize() + ' small puzzle games', page)
        for game in games:
            self.assertEqual(page.count('**' + game['title'] + '.**'), 1, 'Add a line for ' + game['title'] + ' to release/itch-page.md')
        accessible = sum(1 for game in games if game.get('group') == 'accessible')
        self.assertIn(words[accessible] + ' Motor Accessibility Puzzles', page)
        for stale in [(ROOT / 'README.md').read_text(), json.loads((ROOT / 'package.json').read_text())['description']]:
            self.assertNotRegex(stale, r'\b' + words[len(games)].capitalize() + r'\b(?: small)? games')

    def test_screenshot_list_matches_the_files_and_every_tile(self):
        page = (ROOT / 'release/itch-page.md').read_text()
        block = page.split('<!-- screenshots: written by tools/capture-screenshots.cjs -->')[1].split('<!-- /screenshots -->')[0]
        listed = re.findall(r'^\d+\. `([^`]+)`', block, re.M)
        folder = ROOT / 'release/screenshots'
        self.assertEqual(listed, sorted(p.name for p in folder.glob('*.png')))
        self.assertTrue(listed[0].startswith('01-library'), 'the library leads')
        games = json.loads((ROOT / 'sources.json').read_text())['games']
        tiles = [g['id'] + ('-' + m['id'] if m else '') for g in games for m in (g.get('modes') or [None])]
        for tile in tiles:
            self.assertTrue(any(re.fullmatch(r'\d+-' + re.escape(tile) + r'\.png', name) for name in listed),
                            'Rerun node tools/capture-screenshots.cjs for ' + tile)
        for name in listed:
            data = (folder / name).read_bytes()
            size = int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')
            self.assertIn(size, {(1170, 2532), (2532, 1170), (1440, 900)}, name)


if __name__ == '__main__':
    unittest.main()
