# Third-party notices

The games and the collection are under the MIT license in `LICENSE`. The material below comes from elsewhere and keeps its own license.
Every build carries the same list as `NOTICES.txt` (written by `tools/build.py`),
and each license file named here ships beside its material.

## Hexsweeper

- Hexsweeper: MIT, retained in `imports/hexsweeper/LICENSE` (in a build,
  `games/hexsweeper/LICENSE`).
- Sphere geometry (`sphere/hexasphere.js`): Luke Steuber's port of his
  hexasphere.ts from Rind, an original implementation inspired by Rob
  Scanlon's [hexasphere.js](https://github.com/arscan/hexasphere.js), MIT
  License, Copyright (c) 2014-2017 Robert Scanlon.
- Earth and Moon textures (`sphere/assets/textures/`): Solar System Scope /
  INOVE, CC BY 4.0. Attribution and modification history are in that folder's
  `README.md` and `sources.json`. They are packaged but not offered as themes.

### Reflection photographs

In `sphere/assets/reflections/`, from [Unsplash](https://unsplash.com) under
the [Unsplash License](https://unsplash.com/license), which is not an
open-source license; the MIT license does not cover them. Each was resized and
converted to WebP. `SOURCES.md` in that folder records how each was traced.

| Theme | Photograph | Photographer |
|---|---|---|
| Ion Storm | [Clouds with thunder digital wallpaper](https://unsplash.com/photos/L4-16dmZ-1c) | Felix Mittermeier |
| Galaxy | [A night sky filled with lots of stars](https://unsplash.com/photos/W6EsQWhEc94) | Jose G. Ortega Castro |
| Heat Lightning | [Lightning strike at night](https://unsplash.com/photos/uu-Jw5SunYI) | Max LaRochelle |
| (packaged, not offered) Amber Tempest | [Photo of island and thunder](https://unsplash.com/photos/E-Zuyev2XWo) | Johannes Plenio |
| (packaged, not offered) Chromatic Ink | [Swirling iridescent soap film patterns](https://unsplash.com/photos/pCcGpVsOHoo) | Daniel Olah |
| (packaged, not offered) Stained Oculus | [Unsplash photo 2_Zm7XxRzYk](https://unsplash.com/photos/2_Zm7XxRzYk) | Adam Gonzales |

The app credits the three theme photographs under Sphere's theme buttons. The
F-Droid build (`--variant fdroid`) carries none of them.

Since 0.5.9 neither this repository nor any build carries the screenshot of
Microsoft Minesweeper that Sphere's Help once showed, or the Stratosphere
photograph, whose source was never confirmed. The importer leaves both out
(`tools/assets_recipe.py`).

## Shared

- IBM Plex fonts: SIL Open Font License 1.1, retained beside each font set
  (`fonts/OFL.txt` in each game).
- MediaPipe Face Landmarker (`imports/glance/vendor/`, used only when a player
  turns on Look and hold by head or eyes): Google, Apache License 2.0, retained
  in `LICENSE-MEDIAPIPE.txt` there. Not in the F-Droid build.
- Three.js (`vendor/` in Cast, Tilt · 3D and Cube Maze, unmodified): three.js
  authors, MIT License, retained in each `vendor/LICENSE-THREE.txt`.
