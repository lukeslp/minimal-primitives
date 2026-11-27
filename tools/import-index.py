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
  web/assets/tiles/       the index's tile pictures, line drawings and solved pictures, by their own file names

The line drawings (minimal/art/*-lines.svg) are made by minimal/art/linework.py in
luke-portfolio; only the drawings are imported, never the generator. Which tile
takes which drawing comes from the `lines` map in the page's own script.

A finished game's tile shows that game's own solved board in color. The pictures
(minimal/art/*-solved*.webp, captures made by minimal/art/solved-capture.cjs) and
which tile takes which come from the `solved` table in the page's "Signs of life"
script; the capture script is not imported.

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
PIN = '298f3e8'
PAGE = 'minimal/index.html'

# Where each index link leads inside the package: (game id, Hexsweeper mode). A tile's own
# link and the "Also" links on its card are both listed here.
OPENS = {
    'https://lukesteuber.com/games/slant/': ('slant', None),
    'https://playnotan.com/': ('notan', None),
    'https://dr.eamer.dev/games/hexsweeper/sphere/': ('hexsweeper', 'sphere'),
    'https://lukesteuber.com/games/hexsweeper/bounded.html': ('hexsweeper', 'classic'),
    'https://dr.eamer.dev/games/hexsweeper/infinite.html': ('hexsweeper', 'infinite'),
    # Since the index at b3323f7 (luke-portfolio PR 46) the Hexsweeper tile and its Endless link are on lukesteuber.com.
    'https://lukesteuber.com/games/hexsweeper/sphere/': ('hexsweeper', 'sphere'),
    'https://lukesteuber.com/games/hexsweeper/infinite.html': ('hexsweeper', 'infinite'),
    'https://lukesteuber.com/games/bridges/': ('bridges', None),
    'https://lukesteuber.com/games/akari/?look=dark': ('akari', None),
    'https://lukesteuber.com/games/galaxies/': ('galaxies', None),
    'https://lukesteuber.com/games/cast-3d/': ('cast', None),
    'https://lukesteuber.com/games/fold/': ('fold', None),
    'https://lukesteuber.com/games/light/': ('bending', None),
    'https://lukesteuber.com/games/towers/': ('towers', None),
    'https://lukesteuber.com/games/weave-minimal/': ('weaves', None),
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
    # Tangles is game-riffs loop/; its tile was left off until the game joined the package.
    'https://lukesteuber.com/games/loop/': ('tangles', None),
    # The last tile opens the motor-accessible puzzles, a second grid in the package.
    'https://dr.eamer.dev/games/accessible/': ('accessible', None),
}
# Index tiles and "Also" links the package does not carry. A new tile or link must be
# added to OPENS or listed here with its reason, or the import stops. A tile listed here
# keeps its place in the grid unseen; a link listed here is left off its card.
NOT_BUNDLED = {
    'https://datapoems.io/datavis/poems/music.html': 'Harmonies is a Data Poems page, not a bundled game',
    'https://lukesteuber.com/games/simplemachines-minimal/': 'Simple Machines is not in the package yet',
    # The Simple Machines card is not in the package, so neither is its link.
    'https://lukesteuber.com/games/simplemachines-hand/': 'Simple Machines (and so its Hands on page) is not in the package yet',
    # Quipu is game-riffs weave/, last changed 2026-10-11 (c2b7355). It predates the shared control
    # frame every packaged game carries (controls.js and access.js: one switch, Look and hold, the
    # collection's Home and Scores) and has no runtime.json, so the package cannot carry it as it is.
    'https://lukesteuber.com/games/quipu-nonogram/': 'Quipu (game-riffs weave/) has no shared control frame (switch and Look and hold access) and no runtime.json yet',
}
# Finished-tile facts the index's own tables cannot hold. The web page cannot read a record kept on another site,
# so its `sets` and `solved` tables leave Notan (playnotan.com) out; the package reads every bundled game's own
# record. By tile class: where the game keeps its record (storage key, field) and the solved pictures the index's art
# folder carries for the app (on black, on white, the share of the tile's side filled). Notan keeps a map of board to
# best time under ink.v1 (`solved`). Its main campaign is the ramp in levels.js, read from the bundled source at
# import; its New Game+ boards (plus-levels.js) never finish the tile.
# Hexsweeper's set has been the index's own since b3323f7: ["hexsweeper-sphere-best-v1", null, the five sizes], a null
# field meaning the whole record is the map of size to {seconds, at}; collection.js reads it that way.
APP_LIFE = {
    'notan': {'set': ['ink.v1', 'solved', 'levels.js'], 'solved': ['notan-solved-7725aca98610.webp', 'notan-solved-light-535dc40e3591.webp', 0.68]},
}
# Where a game lists its campaign in play order, when that is not the last list of ids in its campaign.js. Tangles'
# campaign.js holds board data (the thirty-eight campaign boards); its twenty-five-board course is course.js.
ORDER_FILES = {'tangles': 'course.js'}
# Games whose campaign ids are worked out by the game rather than written in its source. Bending keeps each finished
# stage under the board's own name, a hash of the board (campaign.mjs `fingerprint`), so its ids are those names for
# the boards of boards.mjs, in order, computed by the bundled modules themselves.
COMPUTED_IDS = {
    'bending': "const {boards}=await import(url('boards.mjs')),{fingerprint}=await import(url('campaign.mjs'));"
               "console.log(JSON.stringify(boards.map(fingerprint)));",
}
# A finished tile needs every id of the game's current main campaign, from the index's `sets` table (written from
# game-riffs by minimal/campaigns.cjs). The package plays the games pinned in sources.json, which can trail the
# index: each set's storage key and ids must be in the bundled game, or the import stops. A game listed here is
# known to trail: its tile is imported without a set (it never shows as finished) until its game is re-pinned.
STALE_SETS = {}  # Weaves left it in 0.5.10, when its game moved to game-riffs 29b29ad and its sixteen-board course.


def computed_ids(game):
    """The campaign ids the bundled game works out itself (COMPUTED_IDS), by running its own modules."""
    folder = (ROOT / 'imports' / game).as_uri() + '/'
    script = f"const url=f=>new URL(f,{json.dumps(folder)}).href;(async()=>{{{COMPUTED_IDS[game]}}})().catch(e=>{{console.error(e);process.exit(1);}});"
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script]))


def unbundled(game, campaign):
    """The storage key and campaign ids of a set that the bundled game's own scripts never name."""
    folder = ROOT / 'imports' / game
    # Scripts and ES modules (Bending is .mjs), and those in a game's subfolders (Hexsweeper's sphere/).
    text = '\n'.join(p.read_text() for p in sorted([*folder.rglob('*.js'), *folder.rglob('*.mjs')]))
    key, _field, ids = campaign
    quoted = lambda word: re.search(r'[\'"]%s[\'"]' % re.escape(word), text)
    if not quoted(key):
        return [key]
    if game in COMPUTED_IDS:
        # The game's own names for its campaign, in play order, must be the set.
        return [] if computed_ids(game) == ids else [f'the campaign {game} works out (a different list or order)']
    missing = [w for w in ids if not quoted(w)]
    # A game that plays a chosen part of its boards lists it in play order, in campaign.js or the file ORDER_FILES
    # names: that list must be the set. Since the index at 298f3e8 a set follows the game's own finish rule, and a game
    # that counts its campaign done once its last board closes (Tangles' beaten()) has that one board as its set.
    name = ORDER_FILES.get(game, 'campaign.js')
    order = folder / name
    if not missing and order.exists():
        lists = re.findall(r"\[((?:\s*'[\w-]+'\s*,?)+)\s*\]", order.read_text())
        course = re.findall(r"'([\w-]+)'", lists[-1]) if lists else []
        if ids != course and ids != course[-1:]:
            missing = [f'the campaign in {name}, or its last board (a different list or order)']
    return missing


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
    # A sentence marked data-web-only is about the web page alone (games on other sites); every bundled game shares one store.
    settings = re.sub(r'<span data-web-only>.*?</span>', '', settings, flags=re.S)
    # Signs of life: the colors a finished tile and the idle shine take, and, by tile class, where each game keeps
    # its record and how many boards make its whole set. Read from the page's own script.
    def literal(name):
        text = re.search(r'\b%s = (\[[^\]]*\]|\{.*?\});' % name, html, re.S) or re.search(r'\b%s = (\[[^\]]*\])' % name, html)
        return json.loads(re.sub(r"([{,]\s*)([A-Za-z_][\w]*)\s*:", r'\1"\2":', text.group(1).replace("'", '"')))
    life = {'onDark': literal('onDark'), 'onLight': literal('onLight'), 'sets': literal('sets'), 'solved': literal('solved')}
    for name, extra in APP_LIFE.items():
        if name in life['sets'] or name in life['solved']:
            sys.exit(f'The index now has its own finished-tile entry for {name!r}: take it out of APP_LIFE in tools/import-index.py.')
        key, field, source = extra['set']
        ids = re.findall(r"\{ id: '([\w-]+)'", (ROOT / 'imports' / name / source).read_text())
        life['sets'][name], life['solved'][name] = [key, field, ids], extra['solved']
    # The card's words for a finished tile where a game has its own, by tile class, as the page's script picks them
    # (name === 'hexsweeper' ? ' Every size cleared.' : ' All boards finished.').
    life['done'] = dict(re.findall(r"name === '([\w-]+)' \? ' ([^']+)'", html))
    return style, tiles, lines, opening, header, settings, life


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
    style, tiles, lines, opening, header, settings, life = parse(html)
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
        tile['set'] = next((life['sets'][c] for c in tile['classes'] if c in life['sets']), None)
        # The card's words for a finished tile where the game has its own (the page's script); otherwise "All boards finished.".
        done = next((life['done'][c] for c in tile['classes'] if c in life['done']), None)
        if done:
            tile['done'] = done
        if tile['set']:
            if not (isinstance(tile['set'], list) and len(tile['set']) == 3 and all(isinstance(i, str) for i in tile['set'][2]) and tile['set'][2]):
                sys.exit(f'{tile["name"]!r}: the index set {tile["set"]!r} is not [key, field, campaign ids]; re-import from an index with minimal/campaigns.json.')
            missing = unbundled(tile['game'], tile['set'])
            if missing and tile['game'] in STALE_SETS:
                tile['setLeftOff'] = STALE_SETS[tile['game']]
                tile['set'] = None
            elif missing:
                sys.exit(f'{tile["name"]!r}: the bundled game (imports/{tile["game"]}) has no {", ".join(missing[:6])}'
                         f'{" and more" if len(missing) > 6 else ""}. Re-pin the game, or list it in STALE_SETS with the reason.')
            elif tile['game'] in STALE_SETS:
                sys.exit(f'{tile["name"]!r} now matches its bundled game: take it out of STALE_SETS.')
        def carry(source):
            data = git(args.index, 'show', f'{sha}:minimal/{source}')
            name = Path(source).name
            (art_dir / name).write_bytes(data)
            return {'file': 'assets/tiles/' + name, 'sha256': hashlib.sha256(data).hexdigest()}
        for key in ('art', 'artWide', 'lines'):
            if tile[key]:
                tile[key] = carry(tile[key])
        # The solved board in color, shown once the game is finished: one picture for a tile on black, one for a
        # tile on white (the same file where the game finishes on a ground of its own), and the share of the side.
        pictures = next((life['solved'][c] for c in tile['classes'] if c in life['solved']), None)
        if pictures and not tile['set']:
            sys.exit(f'{tile["name"]!r} has a solved picture and no set to finish: the picture could never show.')
        tile['solved'] = {'dark': carry('art/' + pictures[0]), 'light': carry('art/' + pictures[1]), 'fill': pictures[2]} if pictures else None
        kept.append(tile)
    used = {c for t in kept for c in t.get('classes', [])}
    for name in life['solved']:
        if name not in used:
            sys.exit(f'The index has a solved picture for {name!r}, which is no tile in the package.')
    live = {Path(t[k]['file']).name for t in kept for k in ('art', 'artWide', 'lines') if t.get(k)}
    live |= {Path(t['solved'][k]['file']).name for t in kept if t.get('solved') for k in ('dark', 'light')}
    for old in art_dir.iterdir():
        if old.name not in live:
            old.unlink()
    record = {'schema': 1, 'repository': 'lukeslp/luke-portfolio', 'page': PAGE, 'commit': sha,
              'styleSha256': hashlib.sha256(style.encode()).hexdigest(), 'opening': opening, 'header': header, 'settings': settings,
              'life': {'onDark': life['onDark'], 'onLight': life['onLight']}, 'tiles': kept, 'notBundled': skipped}
    (ROOT / 'index.json').write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'web/index-tiles.css').write_text(
        f'/* Generated by tools/import-index.py from {record["repository"]} {PAGE} at {sha[:12]}.\n'
        '   The live Minimal index\'s own stylesheet, verbatim. Do not edit: change the index, then re-import. */\n' + style)
    dropped = sum(1 for s in skipped if 'on' in s)
    print(f'Imported {len(tiles)} tiles from {sha[:12]}: {len(tiles) - len(skipped) + dropped} in the package, '
          f'{len(skipped) - dropped} not bundled, {dropped} card links left off')


if __name__ == '__main__':
    main()
