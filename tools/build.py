#!/usr/bin/env python3
"""Verify pinned imports and make a reproducible, self-contained browser export.

`--variant fdroid` (variants.json) makes the camera-free collection for F-Droid in
build/html-fdroid; the default full build in build/html is unchanged by it.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile
from transforms import transform

ROOT = Path(__file__).resolve().parents[1]
NOTICES = """Minimal Primitives
Games and collection by Luke Steuber.

Hexsweeper: MIT, retained in games/hexsweeper/LICENSE.
Hexsweeper Sphere geometry (games/hexsweeper/sphere/hexasphere.js): Luke Steuber's port of his hexasphere.ts from Rind, an original implementation inspired by Rob Scanlon's hexasphere.js (https://github.com/arscan/hexasphere.js), MIT License, Copyright (c) 2014-2017 Robert Scanlon.
Earth/Moon textures: Solar System Scope / INOVE, CC BY 4.0. Attribution and modification history: games/hexsweeper/sphere/assets/textures/README.md and sources.json.
IBM Plex fonts: SIL Open Font License, retained beside each font set.
MediaPipe Face Landmarker (games/glance/vendor/, used only when a player turns on Look and hold by head or eyes): Google, Apache License 2.0, retained in games/glance/vendor/LICENSE-MEDIAPIPE.txt.
Three.js (games/cast/vendor/, games/tilt-3d/vendor/ and games/cube-maze/vendor/, unmodified): three.js authors, MIT License, retained in each game's vendor/LICENSE-THREE.txt.

Source revisions and individual file hashes: SOURCE_MANIFEST.json.
"""


MEDIAPIPE_NOTICE = NOTICES.splitlines(keepends=True)[7]

# The library is drawn from index.json, the live Minimal index as imported by
# tools/import-index.py: its tiles, order, names, lines, pictures, line drawings,
# opening and stylesheet.


def library_tiles(index, games, output):
    """The index's tiles for this build, checked against the games it carries."""
    ids = {g['id'] for g in games if not g.get('group')}
    modes = {(g['id'], m['id']) for g in games for m in g.get('modes', [])}
    style = (ROOT / 'web/index-tiles.css').read_text().split('*/\n', 1)[1]
    if hashlib.sha256(style.encode()).hexdigest() != index['styleSha256']:
        raise ValueError('web/index-tiles.css was edited by hand: change the index and re-import')
    def versioned(art):
        data = (output / art['file']).read_bytes()
        if hashlib.sha256(data).hexdigest() != art['sha256']:
            raise ValueError('Tile picture differs from the index: ' + art['file'])
        return art['file'] + '?v=' + art['sha256'][:12]
    def opens(game, mode, where):
        if game == 'accessible':
            return
        if game not in ids or (mode and (game, mode) not in modes):
            raise ValueError(f'The index tile {where} opens {game} {mode or ""}, which this build does not carry')
        reached.add(game)
    tiles, reached = [], set()
    for tile in index['tiles']:
        if tile.get('notBundled'):
            tiles.append({'skip': tile['name']})
            continue
        opens(tile['game'], tile['mode'], tile['name'])
        for link in tile['also']:
            opens(link['game'], link['mode'], tile['name'])
        tiles.append({'classes': tile['classes'], 'name': tile['name'], 'label': tile['label'], 'line': tile['line'],
                      'game': tile['game'], 'mode': tile['mode'], 'svg': tile['svg'],
                      'image': versioned(tile['art']) if tile['art'] else None,
                      'imageWide': versioned(tile['artWide']) if tile['artWide'] else None,
                      # The Dark and Light themes show the index's line drawing instead, where it has one.
                      'drawing': versioned(tile['lines']) if tile.get('lines') else None,
                      # Where the game keeps its record and how many boards make its whole set (finished-tile color).
                      'set': tile.get('set'),
                      'also': [{'label': l['label'], 'aria': l['aria'], 'game': l['game'], 'mode': l['mode']} for l in tile['also']]})
    if ids - reached:
        raise ValueError(f'Games with no tile on the index: {sorted(ids - reached)}')
    return tiles


assert MEDIAPIPE_NOTICE.startswith('MediaPipe Face Landmarker'), 'NOTICES layout changed'
CAMERA_FRAME = "frame.allow = 'fullscreen; camera';"
CAMERA_FREE_NOTE = (b'> This copy is from the camera-free build of Minimal Primitives. Its camera input is\n'
                    b'> turned off and the MediaPipe files described below are not included.\n\n')


def build(variant='full', make_zip=True):
    sources = json.loads((ROOT / 'sources.json').read_text())
    spec = {} if variant == 'full' else json.loads((ROOT / 'variants.json').read_text())[variant]
    omitted = set(spec.get('omitGames', []))
    unknown = omitted - {game['id'] for game in sources['games']}
    if unknown:
        raise ValueError(f'variants.json omits unknown games: {sorted(unknown)}')
    games = [game if spec.get('camera', True) else dict(game, camera=False)
             for game in sources['games'] if game['id'] not in omitted]
    shared_sets = [s for s in sources.get('shared', []) if s['id'] not in spec.get('omitShared', [])]
    # Omitted shared files stay out even where a game also lists them (Glance lists MediaPipe).
    left_out = {f['path'] for s in sources.get('shared', []) if s not in shared_sets for f in s['files']}
    output = ROOT / ('build/html' if variant == 'full' else 'build/html-' + variant)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for game in games:
        for item in game['files']:
            if item['path'] in left_out:
                continue
            data = (ROOT / 'imports' / item['path']).read_bytes()
            if hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Modified pinned source: ' + item['path'])
            path = output / 'games' / item['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix in {'.html', '.js', '.mjs', '.css'}:
                data = transform(game, item['path'], data.decode()).encode()
            elif not spec.get('camera', True) and item['path'].endswith('/THIRD_PARTY.md') and b'MediaPipe' in data:
                data = CAMERA_FREE_NOTE + data
            path.write_bytes(data)
    # Shared runtime files (MediaPipe for Look and hold by camera) are copied as pinned, never transformed.
    for item in [f for shared in shared_sets for f in shared['files']]:
        data = (ROOT / 'imports' / item['path']).read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Modified pinned source: ' + item['path'])
        path = output / 'games' / item['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    def omitted_tile(path):
        return path.parent.name == 'assets' and any(path.stem == g or path.stem.startswith(g + '-') for g in omitted)
    for path in (ROOT / 'web').rglob('*'):
        if path.is_file() and not omitted_tile(path):
            dest = output / path.relative_to(ROOT / 'web')
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
    if not spec.get('camera', True):
        # The library frame no longer asks the browser for camera permission.
        library = (output / 'collection.js').read_text()
        if library.count(CAMERA_FRAME) != 1:
            raise ValueError('Camera anchor drift in web/collection.js')
        (output / 'collection.js').write_text(library.replace(CAMERA_FRAME, "frame.allow = 'fullscreen';"))
    for name in ['bootstrap.js', 'hooks.js', 'scores-compat.js']:
        shutil.copyfile(ROOT / 'adapters' / name, output / name)
    index = json.loads((ROOT / 'index.json').read_text())
    tiles = library_tiles(index, games, output)
    # The opening is the index's own markup, placed first in the body as on the web; collection.js plays it.
    page = (output / 'index.html').read_text()
    if page.count('<body>') != 1 or 'class="intro"' in page:
        raise ValueError('Opening anchor drift in web/index.html')
    # The title with its gear and the Settings sheet are the index's own markup too; collection.js wires them.
    for mark, part in (('<!--index:header-->', 'header'), ('<!--index:settings-->', 'settings')):
        if page.count(mark) != 1:
            raise ValueError(f'{mark} anchor drift in web/index.html')
        # An outside link leaves the app: it opens in a new tab, as every shipped page's links do.
        page = page.replace(mark, index[part].replace('<a href="https://', '<a target="_blank" rel="noopener noreferrer" href="https://'), 1)
    (output / 'index.html').write_text(page.replace('<body>', '<body>\n' + index['opening'], 1))
    (output / 'life.json').write_text(json.dumps(index['life'], separators=(',', ':')) + '\n')
    (output / 'tiles.json').write_text(json.dumps(tiles, separators=(',', ':'), ensure_ascii=False) + '\n')
    # Catalog order is the library's: each tile's game, then the games on its card (Tilt, then Tilt · 3D and Cube Maze).
    order = [game for t in tiles if 'game' in t for game in [t['game']] + [l['game'] for l in t['also']]]
    def image_url(name):
        asset = 'assets/' + name + '.png'
        version = hashlib.sha256((output / asset).read_bytes()).hexdigest()[:12]
        return asset + '?v=' + version

    catalog = []
    for game in sorted(games, key=lambda g: (1, 0) if g.get('group') else (0, order.index(g['id']))):
        entry = {key: game[key] for key in ['id', 'title', 'entry', 'commit']}
        entry.update(modes=game.get('modes', []), variants=game.get('variants', []))
        if game.get('group'):
            # The accessible puzzles have no index tile of their own; their pictures come with the games.
            entry.update(group=game['group'], image=image_url(game['id']))
        catalog.append(entry)
    (output / 'catalog.json').write_text(json.dumps(catalog, separators=(',', ':')) + '\n')
    shutil.copyfile(ROOT / 'sources.json', output / 'SOURCE_MANIFEST.json')
    notices = NOTICES if any(s['id'] == 'mediapipe' for s in shared_sets) else NOTICES.replace(MEDIAPIPE_NOTICE, '')
    if variant != 'full':
        notices += f'\nThis is the {variant} build: {spec["summary"]}\n'
        if omitted:
            notices += f'Omitted games: {", ".join(sorted(omitted))}.\n'
    (output / 'NOTICES.txt').write_text(notices)
    hashes = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'BUILD_MANIFEST.json').write_text(json.dumps(hashes, indent=2) + '\n')
    if not make_zip:
        # Android builds need only the folder; F-Droid's scanner refuses archives in the tree.
        print(f'{output}: {len(hashes):,} files')
        return
    dest = ROOT / ('build/minimal-primitives-browser.zip' if variant == 'full' else f'build/minimal-primitives-{variant}.zip')
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(output.rglob('*')):
            if path.is_file():
                info = zipfile.ZipInfo(path.relative_to(output).as_posix(), (2026, 10, 14, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())
    print(f'{dest}: {dest.stat().st_size:,} bytes, SHA256 {hashlib.sha256(dest.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--variant', default='full', help='full (default) or a name in variants.json')
    parser.add_argument('--no-zip', action='store_true', help='write only the build folder (Android, F-Droid)')
    options = parser.parse_args()
    build(options.variant, make_zip=not options.no_zip)
