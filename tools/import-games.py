#!/usr/bin/env python3
"""Import only committed runtime files; never consume a dirty working copy."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TITLES = [
    ('notan', 'Notan', 'notan', 'notan.png'),
    ('akari', 'Akari', 'akari', 'akari-8cfb609d45e3.png'),
    ('galaxies', 'Spiral Galaxies', 'galaxies', 'galaxies.png'),
    ('bridges', 'Bridges', 'bridges', 'bridges-b55b113f97e7.png'),
    ('slant', 'Slant', 'slant', 'slant.png'),
    ('fold', 'Fold', 'fold', 'fold.png'),
    ('bending', 'Bending', 'rimlight', 'light.png'),
    ('tilt', 'Tilt', 'tilt-levels', 'tilt.png'),
    ('horologist', 'Horologist', 'horologist', 'horologist-fe2978354a7d.png'),
]
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
    parser.add_argument('--games-ref', default='master')
    parser.add_argument('--hex-ref', default='aa4a93d69ce5e8a82a594748a4616f2d3c91e935')
    parser.add_argument('--art', type=Path, default=ROOT.parent / 'minimal-social-20261013/minimal/art')
    parser.add_argument('--accessible-art', type=Path, default=None, help="defaults to the games checkout's accessible/art")
    args = parser.parse_args()
    args.accessible_art = args.accessible_art or args.games / 'accessible/art'
    target = ROOT / 'imports'
    target.mkdir(exist_ok=True)
    games_sha = git(args.games, 'rev-parse', args.games_ref + '^{commit}').decode().strip()
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

    for ident, title, folder, art in TITLES + ACCESSIBLE:
        manifest = json.loads(git(args.games, 'show', f'{games_sha}:{folder}/runtime.json'))
        paths = sorted(set(manifest['files'] + ['runtime.json']))
        files = [capture(args.games, games_sha, f'{folder}/{safe(p)}', f'{ident}/{p}') for p in paths]
        variants = []
        if ident == 'akari':
            # Akari's Theme setting navigates between two authored looks.
            available = set(git(args.games, 'ls-tree', '-r', '--name-only', games_sha, 'akari-classic').decode().splitlines())
            alternate = [p for p in paths if 'akari-classic/' + p in available]
            files += [capture(args.games, games_sha, 'akari-classic/' + p, 'akari-light/' + p) for p in alternate]
            variants = [{'id': 'light', 'entry': 'akari-light/index.html', 'files': alternate}]
        record = {'id': ident, 'title': title, 'repository': 'lukeslp/game-riffs', 'commit': games_sha,
                  'entry': f'{ident}/{manifest["entry"]}', 'runtime': manifest, 'variants': variants, 'files': files, 'art': art}
        if (ident, title, folder, art) in ACCESSIBLE:
            record['group'] = 'accessible'
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
                      'files': files, 'art': 'sphere.png'})
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
        art_source = args.accessible_art if record.get('group') == 'accessible' else args.art
        data = (art_source / record['art']).read_bytes()
        (art_dir / (record['id'] + '.png')).write_bytes(data)
    for variant, image in [('sphere','sphere.png'),('classic','hexsweeper-classic.png'),('infinite','infinite-board.png')]:
        (art_dir / ('hexsweeper-' + variant + '.png')).write_bytes((args.art / image).read_bytes())
    print(f'Imported {len(records)} titles, {len(live)} pinned files from {games_sha[:12]} and {hex_sha[:12]}')


if __name__ == '__main__':
    main()
