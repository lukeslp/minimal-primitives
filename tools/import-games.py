#!/usr/bin/env python3
"""Import only committed runtime files; never consume a dirty working copy."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TITLES = [
    ('notan', 'Notan', 'notan'),
    ('akari', 'Akari', 'akari'),
    ('galaxies', 'Spiral Galaxies', 'galaxies'),
    ('bridges', 'Bridges', 'bridges'),
    ('slant', 'Slant', 'slant'),
    ('fold', 'Fold', 'fold'),
    ('bending', 'Bending', 'rimlight'),
    ('tilt', 'Tilt', 'tilt-levels'),
    ('horologist', 'Horologist', 'horologist'),
]
# Promoted onto the Minimal index on 2026-11-12, in its order; imported from --new-ref.
NEW = [
    ('towers', 'Towers', 'towers'),
    ('tents', 'Tents', 'tents'),
    ('constellations', 'Constellations', 'constellations'),
    ('shoo-minimal', 'Shoo · Minimal', 'shoo-minimal'),
    ('balance', 'Balance', 'balance'),
    ('cast', 'Cast', 'cast-3d'),  # the lit-room Cast (game-riffs cast-3d/) since 0.5.3
    ('tilt-3d', 'Tilt · 3D', 'tilt-3d'),
    ('delve', 'Delve', 'delve'),
    # Reached from the Tilt tile's card ("Also 3D · Cube Maze") since the index at luke-portfolio 3bb4e4e.
    ('cube-maze', 'Cube Maze', 'cube-maze'),
    # Tangles (game-riffs loop/) has its own tile on the index; its Experiments open from its Settings and Help.
    ('tangles', 'Tangles', 'loop'),
    # The Weaves tile on the index (game-riffs weave-minimal/; weave/ is Quipu, a different game, and stays out).
    ('weaves', 'Weaves', 'weave-minimal'),
]
# Games moved past --games-ref one at a time, each to a commit whose page the
# build's transforms and adapters were checked against.
REPIN = {}  # Every game moved to --games-ref c965c4f in 0.5.7 (the Settings standard).
# Web-only files a newer runtime.json lists: home-screen installs and the site's privacy page.
WEB_ONLY = ('manifest.webmanifest', 'sw.js', 'pwa.js', 'privacy.html')
WEB_ONLY_DIRS = ('icons/',)
# Pages a game keeps only as addresses to share on the web. No page in the package links to them, and they
# lead to one another by folder addresses (../squares/), which a packaged copy cannot be relied on to serve.
# Tangles' six tiling sets play inside the package on experiments.html, reached from Settings and Help.
WEB_ONLY_PAGES = {
    'tangles': ('squares/index.html', 'triangles/index.html', 'octagons/index.html', 'dodecagons/index.html',
                'hexagons-squares/index.html', 'hexagons-triangles/index.html'),
}
# The motor-accessible puzzles open from the last tile, not from the main grid.
ACCESSIBLE = [
    ('glance', 'Glance', 'glance', 'glance-74c875a48ff7.png'),
    ('glyph', 'Glyph', 'glyph', 'glyph-653c82391a0f.png'),
    ('pursuit', 'Pursuit', 'pursuit', 'pursuit-64f8824f599a.png'),
    ('shoo', 'Shoo', 'shoo', 'shoo-60b69f11f929.png'),
    ('nod', 'Nod', 'nod', 'nod-e00c0c2f8d92.png'),
    ('noon', 'Noon', 'noon', 'noon-61f3ddeb115d.png'),
    ('sweep', 'Sweep', 'sweep', 'sweep-b314e7a11342.png'),
    ('ticker', 'Ticker', 'ticker', 'ticker-7cf400ae1da4.png'),
]


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def safe(path):
    p = PurePosixPath(path)
    if p.is_absolute() or '..' in p.parts or not p.parts:
        raise ValueError(f'Unsafe runtime path: {path}')
    return str(p)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--games', type=Path, default=ROOT.parent / 'game-riffs')
    parser.add_argument('--hex', type=Path, default=ROOT.parent / 'hexsweeper')
    parser.add_argument('--games-ref', default='c965c4f')
    parser.add_argument('--new-ref', default='c965c4f')
    parser.add_argument('--hex-ref', default='e61a79f')
    parser.add_argument('--accessible-art', type=Path, default=None, help="defaults to the games checkout's accessible/art")
    args = parser.parse_args()
    args.accessible_art = args.accessible_art or args.games / 'accessible/art'
    target = ROOT / 'imports'
    target.mkdir(exist_ok=True)
    games_sha = git(args.games, 'rev-parse', args.games_ref + '^{commit}').decode().strip()
    new_sha = git(args.games, 'rev-parse', args.new_ref + '^{commit}').decode().strip()
    hex_sha = git(args.hex, 'rev-parse', args.hex_ref + '^{commit}').decode().strip()
    records = []

    def capture(repo, sha, source, dest):
        data = git(repo, 'show', f'{sha}:{safe(source)}')
        out = target / safe(dest)
        if out.exists() and out.read_bytes() != data:
            # Imported trees are regenerated, never edited by hand.
            pass
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        return {'path': dest, 'source': source, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

    for entry in TITLES + NEW + ACCESSIBLE:
        # Main-game tile pictures come from the Minimal index (tools/import-index.py); only the
        # accessible puzzles, which have no index tile of their own, name their art here.
        ident, title, folder = entry[:3]
        art = entry[3] if len(entry) > 3 else None
        sha = new_sha if entry in NEW else REPIN.get(ident, games_sha)
        sha = git(args.games, 'rev-parse', sha + '^{commit}').decode().strip()
        manifest = json.loads(git(args.games, 'show', f'{sha}:{folder}/runtime.json'))
        manifest['files'] = [f for f in manifest['files'] if f not in WEB_ONLY and not f.startswith(WEB_ONLY_DIRS)]
        share_pages = WEB_ONLY_PAGES.get(ident, ())
        if set(share_pages) - set(manifest['files']):
            raise ValueError(f'{ident}: runtime.json no longer lists {sorted(set(share_pages) - set(manifest["files"]))}')
        manifest['files'] = [f for f in manifest['files'] if f not in share_pages]
        paths = sorted(set(manifest['files'] + ['runtime.json']))
        files = [capture(args.games, sha, f'{folder}/{safe(p)}', f'{ident}/{p}') for p in paths]
        variants = []
        if ident == 'akari':
            # Akari's Theme setting navigates between two authored looks.
            available = set(git(args.games, 'ls-tree', '-r', '--name-only', games_sha, 'akari-classic').decode().splitlines())
            alternate = [p for p in paths if 'akari-classic/' + p in available]
            files += [capture(args.games, games_sha, 'akari-classic/' + p, 'akari-light/' + p) for p in alternate]
            variants = [{'id': 'light', 'entry': 'akari-light/index.html', 'files': alternate}]
        record = {'id': ident, 'title': title, 'repository': 'lukeslp/game-riffs', 'commit': sha,
                  'entry': f'{ident}/{manifest["entry"]}', 'runtime': manifest, 'variants': variants, 'files': files}
        if entry in ACCESSIBLE:
            record['group'] = 'accessible'
            record['art'] = art
        records.append(record)

    hex_paths = git(args.hex, 'ls-tree', '-r', '--name-only', hex_sha).decode().splitlines()
    # access.js and bridge-client.js load beside the flat boards when a player turns Access on.
    roots = {'bounded.html', 'infinite.html', 'LICENSE', 'skin-chrome.css', 'access.js', 'bridge-client.js'}
    paths = [p for p in hex_paths if p in roots or p.startswith(('fonts/', 'sphere/assets/')) or
             (p.startswith('sphere/') and p.count('/') == 1 and Path(p).suffix in {'.js', '.css', '.html'} and not Path(p).name.startswith('test-'))]
    files = [capture(args.hex, hex_sha, p, 'hexsweeper/' + p) for p in sorted(paths)]
    records.insert(0, {'id': 'hexsweeper', 'title': 'Hexsweeper', 'repository': 'lukeslp/hexsweeper-private-history', 'commit': hex_sha,
                      'entry': 'hexsweeper/sphere/index.html', 'modes': [
                          {'id': 'sphere', 'title': 'Sphere', 'entry': 'hexsweeper/sphere/index.html'},
                          {'id': 'classic', 'title': 'Classic', 'entry': 'hexsweeper/bounded.html'},
                          {'id': 'infinite', 'title': 'Infinite', 'entry': 'hexsweeper/infinite.html'}],
                      'files': files})
    # Look and hold by head or eyes loads MediaPipe from ../glance/vendor/ beside the games.
    vendor = sorted(p for p in git(args.games, 'ls-tree', '-r', '--name-only', games_sha, 'glance/vendor').decode().splitlines())
    shared = [{'id': 'mediapipe', 'title': 'MediaPipe Face Landmarker (Apache-2.0)', 'repository': 'lukeslp/game-riffs', 'commit': games_sha,
               'files': [capture(args.games, games_sha, p, p) for p in vendor]}]
    live = {f['path'] for g in records + shared for f in g['files']}
    for old in target.rglob('*'):
        if old.is_file() and old.relative_to(target).as_posix() not in live:
            old.unlink()
    (ROOT / 'sources.json').write_text(json.dumps({'schema': 1, 'games': records, 'shared': shared}, indent=2) + '\n')
    art_dir = ROOT / 'web/assets'
    art_dir.mkdir(parents=True, exist_ok=True)
    for record in records:
        if record.get('art'):
            (art_dir / (record['id'] + '.png')).write_bytes((args.accessible_art / record['art']).read_bytes())
    print(f'Imported {len(records)} titles, {len(live)} pinned files from {games_sha[:12]} and {hex_sha[:12]}')


if __name__ == '__main__':
    main()
