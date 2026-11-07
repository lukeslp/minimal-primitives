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
            self.assertEqual(len(catalog), 18)
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
        self.assertFalse([n for n in self.names if n.endswith(('.wasm', '.task')) or '/vendor/' in n])
        catalog = json.loads(self.texts['catalog.json'])
        full = json.loads((ROOT / 'sources.json').read_text())['games']
        self.assertEqual([g['id'] for g in catalog], [g['id'] for g in full])
        self.assertEqual(sum(1 for g in catalog if g.get('group') == 'accessible'), 8)
        self.assertNotIn('MediaPipe Face Landmarker', self.texts['NOTICES.txt'])
        self.assertNotIn(' hidden', self.texts['index.html'].split('id="access-open"')[1][:20])

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
            self.assertIn('<label class="row" hidden>Input <select id="input"><option value="pointer">Pointer</option></select></label>', page)
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
        # Every game's Settings/Help credit is part of the scan.
        for game in self.catalog:
            self.assertTrue(any(name.startswith('games/' + game['id'] + '/') for name in seen), game['id'])

    def test_no_shipped_page_references_a_root_absolute_path(self):
        pattern = re.compile(r'''\b(?:href|src|action|poster|data-other)\s*=\s*["']?/(?!/)|url\(\s*["']?/(?!/)''', re.I)
        bad = [(name, match.group(0)) for name, text in self.files.items() if name.endswith(('.html', '.css'))
               for match in pattern.finditer(text)]
        self.assertEqual(bad, [])
        akari = self.files['games/akari/index.html']
        self.assertIn('id="look-other" class="look-link" href="../../games/akari-light/index.html?look=light"', akari)
        self.assertNotIn('akari-preview', akari)
        self.assertIn('href="../../games/akari/index.html?look=dark"', self.files['games/akari-light/index.html'])



class ReleaseCopyTests(unittest.TestCase):
    """The release page names every game in one sentence; a new game needs only that edit."""

    def test_every_game_has_its_line_and_the_count_matches(self):
        games = json.loads((ROOT / 'sources.json').read_text())['games']
        words = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()
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
