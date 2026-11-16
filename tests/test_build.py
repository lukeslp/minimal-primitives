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
        self.assertEqual({p.name for p in (ROOT / 'web/assets/tiles').iterdir()}, used, 'no stray tile pictures or drawings')
        # Main games have no second, hand-kept picture; only the accessible puzzles keep theirs.
        self.assertEqual({p.stem for p in (ROOT / 'web/assets').glob('*.png')},
                         {g['id'] for g in self.sources if g.get('group') == 'accessible'})

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
        # Every link Tangles makes to its Experiments names the page, which the adapter's click handler matches.
        listing = (ROOT / 'imports/tangles/experiments-list.js').read_text()
        self.assertGreaterEqual(listing.count('./experiments.html?'), 3)
        self.assertEqual(listing.count('experiments.html'), listing.count('./experiments.html?'))
        self.assertIn("url.pathname.endsWith('/experiments.html')", (ROOT / 'adapters/private/tangles.js').read_text())

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


class PrimitivesTests(unittest.TestCase):
    """Every game names its interaction primitives from the shared vocabulary (docs/interaction-primitives.md)."""

    def test_every_game_has_primitives_from_the_vocabulary(self):
        data = json.loads((ROOT / 'primitives.json').read_text())
        allowed = {verb for verbs in data['vocabulary']['groups'].values() for verb in verbs}
        self.assertLessEqual(set(data['vocabulary']['line']), allowed, 'the public line uses grouped verbs')
        games = [g['id'] for g in json.loads((ROOT / 'sources.json').read_text())['games']]
        self.assertEqual(sorted(data['games']), sorted(games), 'Add the new game to primitives.json')
        for game, entry in data['games'].items():
            self.assertTrue(1 <= len(entry['primitives']) <= 3, game)
            self.assertLessEqual(set(entry['primitives']), allowed, game)
            self.assertTrue(entry['exercises'], game)


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
