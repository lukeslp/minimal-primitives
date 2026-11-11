# Minimal Primitives

Small puzzle games by Luke Steuber, collected into one offline package for the
browser and Android.

## The games

The library has one artwork tile per game, with a tile for each Hexsweeper mode:

- Hexsweeper (Sphere, Classic, Infinite), Notan, Akari, Spiral Galaxies,
  Bridges, Slant, Fold, Bending, Tilt and Horologist.
- A motor-accessible set: Glance, Glyph, Pursuit, Shoo and Nod, which can be
  played with head or eye pointing through the front camera, and Noon, Sweep
  and Ticker, which are played with one switch.

Games fill the viewport; Home beside Restart returns to the library. Refresh
keeps the selected game and mode, with unfinished boards and Undo restored. The
games and their modes come from `sources.json`, which pins each game's source by
commit and file hash. The [release copy](release/itch-page.md) names them in one
sentence, which `npm test` checks against that list.

## Two builds

| Build | Command | Output | Used for |
| --- | --- | --- | --- |
| Full | `python3 tools/build.py` | `build/html`, `build/minimal-primitives-browser.zip` | Browser, desktop, direct-download Android app |
| Camera-free | `python3 tools/build.py --variant fdroid` (`--no-zip` for Android) | `build/html-fdroid`, `build/minimal-primitives-fdroid.zip` | F-Droid |

The full build adds camera input to the 18 games: head and eye pointing through
MediaPipe Face Landmarker, which runs in the page, and frames never leave the
device. The camera-free build is defined in `variants.json`. It leaves out
MediaPipe and the camera and eye-tracker inputs and keeps every game and every
switch, touch, keyboard and pointer mode. `tools/camera_recipe.py` makes those
changes at build time. The default build is byte-for-byte unchanged by the
variant.

## Access

Most games' settings include Access (Hexsweeper Sphere has none): one-switch
scanning, and Look and hold,
which selects whatever the pointer rests on. With a pointer that can be a finger,
a mouse or a head mouse. The full build adds head and eye pointing through the
front camera, and an eye tracker through a local gaze bridge.

## Android

`python3 tools/android.py` builds the full flavor and `python3 tools/android.py
--fdroid` the camera-free one. Both play exactly what `tools/build.py` makes. See
[the Android notes](android/README.md) and [F-Droid notes](docs/FDROID.md).

## How the package is made

Imports are verified against `sources.json`, and the game snapshots under
`imports/` are never edited by hand. Changes for the collection are build-only
transforms in `tools/` whose anchors fail the build when the source drifts. See
[the implementation contract](docs/implementation.md).

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
