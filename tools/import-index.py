#!/usr/bin/env python3
"""Import the library's tiles from the live Minimal index, so the two cannot drift.

The index at lukesteuber.com/minimal/ (lukeslp/luke-portfolio, minimal/index.html)
is the design baseline: which tiles there are, their order, names, one-line
descriptions, pictures, light or dark ground, and the styles that draw them.
This reads that page at a pinned commit and writes:

  index.json              every tile, in order, with the game it opens here, its
                          line drawing for the Dark and Light themes, and the
                          markup of the opening, the title with its Settings
                          gear, and the Settings sheet
  web/index-tiles.css     the index's own stylesheet, verbatim
  web/assets/tiles/       the index's tile pictures and line drawings, by their own file names

The line drawings (minimal/art/*-lines.svg) are made by minimal/art/linework.py in
luke-portfolio; only the drawings are imported, never the generator. Which tile
takes which drawing comes from the `lines` map in the page's own script.

`--check` compares the pin with another ref (default origin/main) and fails
when the index has moved on. Run it before every release.
"""
import argparse
import hashlib
import html as entities
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = '9721093'
PAGE = 'minimal/index.html'

# Where each index link leads inside the package: (game id, Hexsweeper mode). A tile's own
# link and the "Also" links on its card are both listed here.
OPENS = {
    'https://lukesteuber.com/games/slant/': ('slant', None),
    'https://playnotan.com/': ('notan', None),
    'https://dr.eamer.dev/games/hexsweeper/sphere/': ('hexsweeper', 'sphere'),
    'https://lukesteuber.com/games/hexsweeper/bounded.html': ('hexsweeper', 'classic'),
    'https://dr.eamer.dev/games/hexsweeper/infinite.html': ('hexsweeper', 'infinite'),
    'https://lukesteuber.com/games/bridges/': ('bridges', None),
    'https://lukesteuber.com/games/akari/?look=dark': ('akari', None),
    'https://lukesteuber.com/games/galaxies/': ('galaxies', None),
    'https://lukesteuber.com/games/cast-3d/': ('cast', None),
    'https://lukesteuber.com/games/fold/': ('fold', None),
    'https://lukesteuber.com/games/light/': ('bending', None),
    'https://lukesteuber.com/games/towers/': ('towers', None),
    'https://lukesteuber.com/games/tilt/': ('tilt', None),
    'https://lukesteuber.com/games/horologist/': ('horologist', None),
    'https://lukesteuber.com/games/tents/': ('tents', None),
    'https://lukesteuber.com/games/shoo-minimal/': ('shoo-minimal', None),
    'https://lukesteuber.com/games/balance/': ('balance', None),
    'https://lukesteuber.com/games/delve-preview/': ('delve', None),
    # On the Bridges card since 3bb4e4e; it was a tile of its own before.
    'https://lukesteuber.com/games/constellations/': ('constellations', None),
    # On the Tilt card since 3bb4e4e ("Also 3D · Cube Maze"); Tilt · 3D was a tile of its own before.
    'https://lukesteuber.com/games/tilt-3d/': ('tilt-3d', None),
    'https://lukesteuber.com/games/cube-maze/': ('cube-maze', None),
    # The last tile opens the motor-accessible puzzles, a second grid in the package.
    'https://dr.eamer.dev/games/accessible/': ('accessible', None),
}
# Index tiles and "Also" links the package does not carry. A new tile or link must be
# added to OPENS or listed here with its reason, or the import stops. A tile listed here
# keeps its place in the grid unseen; a link listed here is left off its card.
NOT_BUNDLED = {
    'https://lukesteuber.com/games/loop/': 'Tangles is not in the package yet',
    'https://lukesteuber.com/games/weave-minimal/': 'Weaves is not in the package yet',
    'https://datapoems.io/datavis/poems/music.html': 'Harmonies is a Data Poems page, not a bundled game',
    'https://lukesteuber.com/games/simplemachines-minimal/': 'Simple Machines is not in the package yet',
    # The Simple Machines card is not in the package, so neither is its link.
    'https://lukesteuber.com/games/simplemachines-hand/': 'Simple Machines (and so its Hands on page) is not in the package yet',
    # Quipu is game-riffs weave/, last changed 2026-10-11 (c2b7355). It predates the shared control
    # frame every packaged game carries (controls.js and access.js: one switch, Look and hold, the
    # collection's Home and Scores) and has no runtime.json, so the package cannot carry it as it is.
    'https://lukesteuber.com/games/quipu-nonogram/': 'Quipu (game-riffs weave/) has no shared control frame (switch and Look and hold access) and no runtime.json yet',
}


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def parse(html):
    style = re.search(r'<style>\n?(.*?)</style>', html, re.S).group(1)
    tiles = []
    for block in re.findall(r'<div class="tile[^"]*">.*?\n      </div>', html, re.S):
        classes = re.match(r'<div class="([^"]*)"', block).group(1).split()[1:]
        go = re.search(r'<a class="go" href="([^"]+)" aria-label="([^"]+)"', block)
        # Names and labels are text here, not markup: "Eye, head &amp; switch games" is stored with its plain "&".
        href, label = go.group(1), entities.unescape(go.group(2))
        name = entities.unescape(re.search(r'<span class="cap"[^>]*>([^<]+)</span>', block).group(1))
        line = re.search(r'<span class="line"[^>]*>(.*?)</span>', block, re.S).group(1)
        img = re.search(r'<img src="([^"?]+)', block)
        wide = re.search(r'<source media="\(min-width: 720px\)" srcset="([^"?]+)', block)
        svg = re.search(r'<svg.*?</svg>', block, re.S)
        also = [{'label': entities.unescape(text), 'aria': entities.unescape(aria), 'href': link}
                for link, aria, text in re.findall(r'<a href="([^"]+)" aria-label="([^"]+)">([^<]+)</a>', block)]
        tiles.append({'classes': classes, 'name': name, 'label': label, 'line': line, 'href': href,
                      'art': img.group(1) if img else None, 'artWide': wide.group(1) if wide else None,
                      'svg': re.sub(r'\s*\n\s*', '', svg.group(0)) if svg else None, 'also': also})
    # In the Dark and Light themes the page's script swaps each tile named in its `lines` map (by tile class)
    # for art/<name>-lines.svg; the tiles it leaves out (Hexsweeper, Spiral Galaxies, Tangles) keep their pictures.
    lines = dict(re.findall(r"'?([\w-]+)'?\s*:\s*'([\w-]+)'", re.search(r'var lines = \{(.*?)\};', html, re.S).group(1)))
    # The opening: the name, then the primitives, then the tiles. Its markup is taken as the page has it.
    opening = re.search(r'<div class="intro" id="intro"[^>]*>.*?</div>', html, re.S).group(0)
    # The title with its Settings gear, and the Settings sheet (Display, Access, About), as the page has them.
    header = re.search(r'<header class="top">.*?</header>', html, re.S).group(0)
    settings = re.search(r'<dialog id="settings".*?</dialog>', html, re.S).group(0)
    return style, tiles, lines, opening, header, settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--index', type=Path, default=ROOT.parent / 'luke-portfolio', help='a checkout of lukeslp/luke-portfolio')
    parser.add_argument('--ref', default=PIN)
    parser.add_argument('--check', nargs='?', const='origin/main', help='fail if the index at this ref differs from the pin')
    args = parser.parse_args()
    sha = git(args.index, 'rev-parse', args.ref + '^{commit}').decode().strip()
    html = git(args.index, 'show', f'{sha}:{PAGE}').decode()
    if args.check:
        other = git(args.index, 'rev-parse', args.check + '^{commit}').decode().strip()
        moved = git(args.index, 'diff', '--stat', sha, other, '--', 'minimal').decode().strip()
        if moved:
            sys.exit(f'The Minimal index moved past the pin ({sha[:7]} → {other[:7]}):\n{moved}\n'
                     'Re-import with --ref, rebuild, and look at the library before releasing.')
        print(f'The Minimal index at {args.check} matches the pin {sha[:7]}.')
        return
    style, tiles, lines, opening, header, settings = parse(html)
    art_dir = ROOT / 'web/assets/tiles'
    art_dir.mkdir(parents=True, exist_ok=True)
    kept, skipped = [], []
    def links(tile, carried):
        # Each "Also" link opens a bundled game or is left off the card with its reason.
        out = []
        for link in tile['also']:
            if link['href'] in NOT_BUNDLED:
                skipped.append({'name': link['label'], 'on': tile['name'], 'href': link['href'], 'reason': NOT_BUNDLED[link['href']]})
            elif link['href'] in OPENS and carried:
                link['game'], link['mode'] = OPENS[link['href']]
                out.append(link)
            elif link['href'] in OPENS:
                sys.exit(f'Link {link["label"]!r} is on {tile["name"]!r}, a tile the package does not carry: '
                         f'give {link["href"]} a place in the package or list it in NOT_BUNDLED.')
            else:
                sys.exit(f'New link {link["label"]!r} on {tile["name"]!r}: add {link["href"]} to OPENS or NOT_BUNDLED in tools/import-index.py.')
        return out
    for tile in tiles:
        if tile['href'] in NOT_BUNDLED:
            skipped.append({'name': tile['name'], 'href': tile['href'], 'reason': NOT_BUNDLED[tile['href']]})
            links(tile, False)
            # Its place in the grid is kept, so every other tile sits on the same ground as on the index.
            kept.append({'name': tile['name'], 'notBundled': NOT_BUNDLED[tile['href']]})
            continue
        if tile['href'] not in OPENS:
            sys.exit(f'New index tile {tile["name"]!r} ({tile["href"]}): add it to OPENS or NOT_BUNDLED in tools/import-index.py.')
        tile['game'], tile['mode'] = OPENS[tile['href']]
        tile['also'] = links(tile, True)
        drawing = next((lines[c] for c in tile['classes'] if c in lines), None)
        tile['lines'] = f'art/{drawing}-lines.svg' if drawing else None
        for key in ('art', 'artWide', 'lines'):
            if tile[key]:
                data = git(args.index, 'show', f'{sha}:minimal/{tile[key]}')
                name = Path(tile[key]).name
                (art_dir / name).write_bytes(data)
                tile[key] = {'file': 'assets/tiles/' + name, 'sha256': hashlib.sha256(data).hexdigest()}
        kept.append(tile)
    live = {Path(t[k]['file']).name for t in kept for k in ('art', 'artWide', 'lines') if t.get(k)}
    for old in art_dir.iterdir():
        if old.name not in live:
            old.unlink()
    record = {'schema': 1, 'repository': 'lukeslp/luke-portfolio', 'page': PAGE, 'commit': sha,
              'styleSha256': hashlib.sha256(style.encode()).hexdigest(), 'opening': opening, 'header': header, 'settings': settings, 'tiles': kept, 'notBundled': skipped}
    (ROOT / 'index.json').write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'web/index-tiles.css').write_text(
        f'/* Generated by tools/import-index.py from {record["repository"]} {PAGE} at {sha[:12]}.\n'
        '   The live Minimal index\'s own stylesheet, verbatim. Do not edit: change the index, then re-import. */\n' + style)
    dropped = sum(1 for s in skipped if 'on' in s)
    print(f'Imported {len(tiles)} tiles from {sha[:12]}: {len(tiles) - len(skipped) + dropped} in the package, '
          f'{len(skipped) - dropped} not bundled, {dropped} card links left off')


if __name__ == '__main__':
    main()
