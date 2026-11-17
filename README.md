# Minimal Primitives

[![itch.io](https://img.shields.io/badge/itch.io-game_page-FA5C5C?style=flat-square)](https://lukesteuber.itch.io/minimal-primitives)
[![Android download](https://img.shields.io/badge/Android-direct_download-34A853?style=flat-square)](https://dr.eamer.dev/downloads/apps/minimal-primitives/)
[![F-Droid repository](https://img.shields.io/badge/F--Droid-LocalType_releases_repo-1976D2?style=flat-square)](https://dr.eamer.dev/downloads/fdroid/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Small puzzle games, collected into one offline package for the browser,
Android and iOS.

## The games

The library is the [Minimal index](https://lukesteuber.com/minimal/), imported
(`tools/import-index.py`): the same tiles in the same order, in the index's
Dark theme by default (Light and Checkerboard are in the library's settings),
with the games a tile's card names under "Also" opening from that card:

- Slant, Notan, Hexsweeper (Sphere; Flat and Endless on its card), Bridges
  (Constellations on its card), Akari, Spiral Galaxies, Cast, Tangles (its
  Experiments, six other tilings, open from its Settings), Fold, Bending,
  Towers, Weaves, Tilt (Tilt · 3D and Cube Maze on its card), Horologist,
  Tents, Shoo · Minimal, Balance and Delve.
- A motor-accessible set: Glance, Glyph, Pursuit, Shoo and Nod, which can be
  played with head or eye pointing through the front camera, and Noon, Sweep
  and Ticker, which are played with one switch.

Games fill the viewport; Home beside Restart returns to the library. Refresh
keeps the selected game and mode, with unfinished boards and Undo restored. The
games and their modes come from `sources.json`, which pins each game's source by
commit and file hash. The [release copy](release/itch-page.md) names them in one
sentence, which `npm test` checks against that list.

## The name

Primitives are what doing is made of, as simple machines are what machines are
made of. The collection names eight: get, put, push, turn, join, split, bend,
switch. Each game is built on one or two of them. See
[interaction primitives](docs/interaction-primitives.md).

## Two builds

| Build | Command | Output | Used for |
| --- | --- | --- | --- |
| Full | `python3 tools/build.py` | `build/html`, `build/minimal-primitives-browser.zip` | Browser, desktop, the direct-download and Google Play Android app, the iOS app |
| Camera-free | `python3 tools/build.py --variant fdroid` (`--no-zip` for Android) | `build/html-fdroid`, `build/minimal-primitives-fdroid.zip` | F-Droid |

The full build adds camera input to the 29 games: head and eye pointing through
MediaPipe Face Landmarker, which runs in the page, and frames never leave the
device. The camera-free build is defined in `variants.json`. It leaves out
MediaPipe and the camera and eye-tracker inputs and keeps every game and every
switch, touch, keyboard and pointer mode. `tools/camera_recipe.py` makes those
changes at build time, and the variant leaves the default build byte-for-byte
unchanged.

## Access

Most games' settings include Access (Hexsweeper Sphere has none): one-switch
scanning, and Look and hold, which selects whatever the pointer rests on. The
pointer can be a finger, a mouse or a head mouse. The full build adds head and
eye pointing through the front camera. The Eye tracker choice needs a helper
program on a computer, so the package shows it as unavailable; it works on the
web pages.

## Android

`python3 tools/android.py` builds the full flavor and `python3 tools/android.py
--fdroid` the camera-free one. Both play exactly what `tools/build.py` makes. See
[the Android notes](android/README.md) and [F-Droid notes](docs/FDROID.md).

## iOS

`ios/` is a small native shell for iPhone and iPad that plays the same
`build/html`, with nothing loaded from the network. Builds go out through
TestFlight. See [the iOS notes](ios/README.md) and the
[iPhone Duo layouts](docs/iphone-duo.md).

## How the package is made

Imports are verified against `sources.json`, and the game snapshots under
`imports/` are never edited by hand. Changes for the collection are build-only
transforms in `tools/` whose anchors fail the build when the source drifts. See
[the implementation contract](docs/implementation.md).

The package changes what would not work inside an app: puzzle sharing and downloads are hidden, the camera starts only
after a press in the game that is open, a link from one packaged page to another keeps Home working, and the library's
Settings carries the privacy policy (`web/privacy.html`).

Run `npm test` for acceptance. Browser tests use external Playwright and Chrome
installations and install no packages. After a build,
`node tools/capture-screenshots.cjs` retakes every release screenshot from the
ZIP. See [parity coverage](docs/parity-review.md) and
[score coverage](docs/real-score-verification.md).

## Scores

Scores stay on the device unless a score service is configured. `server/` is an
optional HTTP and SQLite score service; the static builds start with sharing off
and no endpoint, and the Android app always keeps scores on the device. For a
local preview with real scores in a separate database:

```sh
python3 tools/preview.py --db /path/to/scores.sqlite3
```

Open `http://127.0.0.1:5010/`. Both listeners bind loopback.

## License

MIT, see [LICENSE](LICENSE). Third-party parts keep their own terms, listed in
the `NOTICES.txt` of every build (see `tools/build.py`): MediaPipe Face Landmarker
(Apache License 2.0, full build only), Earth and Moon textures by Solar System
Scope (CC BY 4.0), IBM Plex fonts (SIL Open Font License 1.1), and Hexsweeper
Sphere geometry inspired by Rob Scanlon's hexasphere.js (MIT).
