# Minimal Primitives on F-Droid

F-Droid gets the camera-free build: the `fdroid` Android flavor, made from
`python3 tools/build.py --variant fdroid`. The full build, with head and eye
pointing through MediaPipe, stays the browser, desktop and direct-download
version.

## What the camera-free build changes

- No MediaPipe. The variant leaves out the shared MediaPipe set and Glance's
  copy of it, and the F-Droid recipe deletes `imports/glance/vendor/` before
  building (`scandelete`), so no WebAssembly file or model is in the build tree.
- No camera input. Every game's control frame reports no camera and no eye
  tracker, so Look and hold works by pointer only (a finger, mouse or head
  mouse) and any saved head or eye choice falls back to pointer. Glance, Glyph,
  Shoo, Nod and Pursuit lose their camera button, Input, calibration and Up and
  down rows and their camera help and privacy lines, and their pages see no
  camera API, so they start on pointer. Every page's own policy drops the
  camera's WebAssembly and the gaze bridge.
- Every game stays: all 18, with the motor-accessible set in its own grid, and
  every switch, touch, keyboard and pointer mode unchanged.
- Android: no CAMERA permission (it lives in `android/app/src/full/`), page
  permission requests are refused, and VIBRATE is the only permission.

`tools/camera_recipe.py` makes the page changes with anchored build transforms;
the game snapshots in `imports/` are not edited, and an upstream change that
moves an anchor fails the build. `tests/test_build.py` checks the variant: the
full game list, no MediaPipe or head and eye input, and reproducible output.

## Licenses

The games and collection are MIT (`LICENSE`). Bundled third-party parts, also
listed in each build's `NOTICES.txt`: Earth and Moon textures by Solar System
Scope (CC BY 4.0), IBM Plex fonts (SIL Open Font License 1.1, beside each font
set), and Hexsweeper Sphere geometry inspired by Rob Scanlon's hexasphere.js
(MIT). MediaPipe (Apache License 2.0) is in the full build only.

## Build and signing

JDK 21, Android SDK platform 36, AGP 8.13.0, Kotlin 2.3.21, Gradle 8.14.5, and
Python 3 for the collection build (no network, inputs pinned in `sources.json`).

```sh
python3 tools/build.py --variant fdroid --no-zip
./android/gradlew -p android :app:testFdroidReleaseUnitTest :app:assembleFdroidRelease
python3 fdroid/verify-apk.py android/app/build/outputs/apk/fdroid/release/app-fdroid-release-unsigned.apk \
  --build-tools "$ANDROID_HOME/build-tools/36.0.0"
```

The release build leaves out the version-control file and the dependency
metadata block, so its bytes do not depend on how the source was checked out.
The fdroid release APK is unsigned; each GitHub release carries it signed with
the established Minimal Primitives key (certificate SHA-256
`e240104547e5c771f6b1c80ebc63cc1e472da24093407a1d449b4074d4d3e5f3`) using
`fdroid/sign-upstream.sh`, so F-Droid can confirm the rebuilt APK matches and
ship that signed file. Releases are tagged `v<version>`; the version comes from
`FDROID_VERSION_NAME` and `FDROID_VERSION_CODE` in `android/app.properties`.
