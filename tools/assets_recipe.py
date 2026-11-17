"""What the app leaves out of Hexsweeper Sphere's pictures, in every build and in an open-assets one.

The pinned Hexsweeper source carries two pictures the app does not ship in any
build (decided for 0.5.9):

- the screenshot of Microsoft Minesweeper in Sphere's Help: Help loses the
  history picture and its full-size view, and the file is left out;
- the Stratosphere photograph, whose source is not confirmed: the Stratosphere
  theme is not registered, its reflection material is retired in place (so
  later shader indices do not move), the two files are left out, and the
  folder's SOURCES.md says so.

A saved choice of a removed theme falls back to the default, as the game does
for any theme it no longer has.

A variant that sets "freeAssets": true (the F-Droid build) also leaves out the
six remaining photographs, which are under the Unsplash License, not an open
license (F-Droid asks that every asset in an app has one): Ion Storm, Galaxy
and Heat Lightning are not registered either, so Sphere offers Light, Dark,
Mercury and Aurora, every photo material is retired, and the whole reflections
folder is left out.

The full build credits the three photo themes it offers in Sphere's Themes tab
(THEME_CREDIT) and every photograph in NOTICES.txt (tools/build.py).

tools/build.py leaves the files out (omitted) and runs transform() on each
page and script after tools/transforms.py, and rewrite() on SOURCES.md. Every
anchor must match exactly, so a change in the pinned source fails the build
instead of shipping half of this.
"""
import re

GAME = 'hexsweeper'
SCREENSHOT = 'hexsweeper/sphere/assets/classic-minesweeper.png'
REFLECTIONS = 'hexsweeper/sphere/assets/reflections/'
SOURCES = REFLECTIONS + 'SOURCES.md'
# Left out of every build: the screenshot and the unconfirmed photograph (both sizes).
NEVER = (SCREENSHOT, REFLECTIONS + 'stratosphere-1024.webp', REFLECTIONS + 'stratosphere-2048.webp')
NEVER_NAMES = ('classic-minesweeper', 'stratosphere-1024', 'stratosphere-2048')
PHOTO_THEMES = ['stratosphere', 'ion-storm', 'galaxy', 'heat-lightning']

THEMES = ('    THEME_MERCURY,\n    THEME_STRATOSPHERE,\n    THEME_ION_STORM,\n    THEME_AURORA,\n'
          '    THEME_GALAXY,\n    THEME_HEAT_LIGHTNING,\n  ].filter(')
APP_THEMES = '    THEME_MERCURY,\n    THEME_ION_STORM,\n    THEME_AURORA,\n    THEME_GALAXY,\n    THEME_HEAT_LIGHTNING,\n  ].filter('
FREE_THEMES = '    THEME_MERCURY,\n    THEME_AURORA,\n  ].filter('
ROSTER = 'const ROSTER = ["light", "dark", "stratosphere", "mercury", "ion-storm", "aurora", "galaxy", "heat-lightning"];'
APP_ROSTER = 'const ROSTER = ["light", "dark", "mercury", "ion-storm", "aurora", "galaxy", "heat-lightning"];'
FREE_ROSTER = 'const ROSTER = ["light", "dark", "mercury", "aurora"];'
HISTORY_ROW = re.compile(r'    <div class="help-history-row">\n.*?\n    </div>\n', re.S)
LIGHTBOX = re.compile(r'<div id="history-lightbox".*?\n</div>\n', re.S)
THEME_GRID = '      <div class="help-theme-grid" id="help-theme-grid"></div>\n    </div>\n'
# Credit for the photographs the full build's themes reflect, shown under the theme buttons.
THEME_CREDIT = ('      <span class="help-packs-cap" id="help-theme-credit">Photographs: Ion Storm by Felix Mittermeier, '
                'Galaxy by Jose G. Ortega Castro, Heat Lightning by Max LaRochelle, on Unsplash (Unsplash License).</span>\n')
# One material preset that reads a photograph: keep its slot and fallback colors, drop the picture.
PHOTO_PRESET = re.compile(
    r'    \{\n      id: "([a-z-]+)",\n      label: "[^"\n]*",\n      shortLabel: "[^"\n]*",\n'
    r'(      fallback: [^\n]*\n)      swatch: [^\n]*\n'
    r'      texture: \{ desktop: "assets/reflections/[^\n]*\n    \},')
# SOURCES.md: the unconfirmed photograph's table and the line saying it is still here.
SOURCES_STILL = 'Five had no source and were removed the same day, with their materials. One,\nStratosphere, has a probable source and is still here.\n'
SOURCES_APP = ('Five had no source and were removed the same day, with their materials. One,\n'
               'Stratosphere, has only a probable source; the Minimal Primitives app leaves it out.\n')
SOURCES_UNCONFIRMED = re.compile(r'## Not confirmed\n.*?(?=## Removed\n)', re.S)


def omitted(path, free=False):
    """True for a packaged file the build leaves out."""
    return path in NEVER or (free and path.startswith(REFLECTIONS))


def once(text, old, new, path):
    if text.count(old) != 1:
        raise ValueError(f'Assets anchor drift in {path}: {old[:70]!r}: {text.count(old)}')
    return text.replace(old, new, 1)


def cut(text, pattern, path):
    text, count = pattern.subn('', text)
    if count != 1:
        raise ValueError(f'Assets anchor drift in {path}: {pattern.pattern[:50]!r}: {count}')
    return text


def retire(match):
    return ('    {\n      // Left out of this build: its photograph is not shipped.\n'
            '      // The slot stays so later shader indices do not move.\n'
            '      retired: true,\n'
            f'      label: "Retired {match.group(1)} slot",\n      shortLabel: "Retired",\n'
            f'{match.group(2)}      swatch: "linear-gradient(#111, #050505)",\n    }},')


def transform(game, path, text):
    if game['id'] != GAME:
        return text
    free = bool(game.get('freeAssets'))
    if path == 'hexsweeper/sphere/sphere.js':
        text = once(text, THEMES, FREE_THEMES if free else APP_THEMES, path)
    elif path == 'hexsweeper/sphere/index.html':
        text = once(text, ROSTER, FREE_ROSTER if free else APP_ROSTER, path)
        text = cut(text, HISTORY_ROW, path)
        text = cut(text, LIGHTBOX, path)
        if not free:
            text = once(text, THEME_GRID, THEME_GRID.replace('    </div>\n', THEME_CREDIT + '    </div>\n'), path)
        for name in NEVER_NAMES:
            if name in text:
                raise ValueError(f'Assets: {name} is still named in {path}')
    elif path == 'hexsweeper/sphere/mirror-material.js':
        if free:
            text, count = PHOTO_PRESET.subn(retire, text)
            expected = 7
        else:
            count = 0

            def stratosphere(match):
                nonlocal count
                if match.group(1) != 'stratosphere':
                    return match.group(0)
                count += 1
                return retire(match)
            text = PHOTO_PRESET.sub(stratosphere, text)
            expected = 1
        if count != expected:
            raise ValueError(f'Assets anchor drift in {path}: {count} photo materials retired, {expected} expected')
        if free and 'assets/reflections/' in text:
            raise ValueError(f'Assets: {path} still reads a photograph')
        for name in NEVER_NAMES:
            if name in text:
                raise ValueError(f'Assets: {name} is still named in {path}')
    return text


def rewrite(game, path, data):
    """Byte files the build copies: SOURCES.md no longer says Stratosphere is here."""
    if game['id'] != GAME or path != SOURCES:
        return data
    text = once(data.decode(), SOURCES_STILL, SOURCES_APP, path)
    text = cut(text, SOURCES_UNCONFIRMED, path)
    for name in NEVER_NAMES:
        if name in text:
            raise ValueError(f'Assets: {name} is still named in {path}')
    return text.encode()
