# Minimal Primitives for Android

An offline Android app that plays the Minimal Primitives collection exactly as the
browser build makes it. The app is a small WebView shell. At build time the
contents of `build/html` (the same files that go into
`build/minimal-primitives-browser.zip`) are copied into the APK, so a game added
to the collection appears in the next APK with no Android changes. Games and the
collection shell are never edited for Android.

There are two flavors with the same application id. **full** plays the whole
collection from `build/html`, camera input included, and is the direct-download
app. **fdroid** plays the camera-free collection from `build/html-fdroid`
(`python3 tools/build.py --variant fdroid`), has no CAMERA permission and its own
version, and is built unsigned for F-Droid's reproducible-build check; see
[docs/FDROID.md](../docs/FDROID.md). Full releases are signed with the app's own
release key (see Release signing).

## How it works

- `tools/android.py` runs `tools/build.py`, then Gradle. The Gradle tasks
  `collectionAssetsFull` and `collectionAssetsFdroid` copy `build/html` or
  `build/html-fdroid` into the APK's assets under `www/`.
  Generated assets live under `android/app/build/` and stay out of Git.
- The collection is served by `WebViewAssetLoader` from a virtual HTTPS origin,
  `https://appassets.androidplatform.net/assets/www/index.html`, never from
  `file://`. The library's `catalog.json` fetch, the ES modules some games use,
  and localStorage all behave as they do on the web, and saves persist on that
  origin between launches.
- There is no INTERNET permission. Every request outside the bundled collection
  is answered inside the app with a 404, WebView metrics and Safe Browsing
  lookups are off, and saves are excluded from cloud backup and device transfer.
  Scores stay on the device: if `settings.json` ever names a score service, the
  Android copy clears `apiBase`.
- Outside links (the oneimpossiblethingatatime.com footer, the lukesteuber.com
  credits inside each game) open in the phone's browser through an `ACTION_VIEW`
  intent. They never load inside the app.
- VIBRATE lets the haptic feedback some games already use (Hexsweeper's
  long-press flag, Bending's hits) work as it does in a mobile browser.
- CAMERA (full flavor only, from `src/full/AndroidManifest.xml`) is for Look
  and hold by head or eyes. Android asks the first time a player starts the
  camera; until then nothing uses it. The WebView passes on only a camera
  request from the bundled collection and refuses every other permission a page
  asks for. Frames go to MediaPipe inside the page and never leave the phone.
  The fdroid flavor has no CAMERA permission and refuses every page permission
  request (`BuildConfig.CAMERA_INPUT`).
- Full screen with the system bars hidden; a swipe from the edge shows them
  briefly. The page is drawn edge to edge but kept clear of display cutouts and
  the keyboard. Both orientations work, and rotating keeps the game exactly as
  it was because the activity is not recreated.
- WebGL is on (Hexsweeper Sphere needs it). Text zoom is fixed at 100% whatever
  the system font size, the page cannot be pinch-zoomed, and long presses do not
  select text or open menus.
- Back follows the collection. It closes the scores dialog if it is open. Inside
  a game it presses that game's own Home control, which saves the board and Undo
  before showing the library, the same path as tapping Home. In the library it
  leaves the app.
- The app follows the device's light or dark setting, so games that theme
  themselves by `prefers-color-scheme` look as they do in a mobile browser.
- The launcher icon and splash are the Hexsweeper Sphere tile from the library
  (`web/assets/hexsweeper-sphere.png`): black line work on white paper for the
  icon, and the same lines in white on the library's dark ground for the splash.
  `python3 tools/android.py --icons` redraws them from that artwork (it needs
  Pillow); a normal build does not.

## Identity

`android/app.properties` is the only place the application id and version are
set. The id `com.oneimpossiblethingatatime.minimalprimitives` is permanent
(approved October 16, 2026) and must never change: Android treats a different id
as a different app. The Kotlin namespace (`minimalprimitives.android`) is
independent of it. `VERSION_NAME`/`VERSION_CODE` are the full flavor's version
and `FDROID_VERSION_NAME`/`FDROID_VERSION_CODE` the fdroid flavor's (0.4.0, code
8, the first camera-free release). Every new code must be higher than every code
already issued to either flavor. Minimum Android 8.0 (API 26), target API 36.
Version code 1 was the debug-signed test build.

## Build

Requirements: Python 3, a JDK from 17 to 24 (JDK 21 is preferred), and the
Android SDK with platform 36. The script finds JDK 21 or 17 through
`/usr/libexec/java_home` on a Mac, or uses `JAVA_HOME`, and finds the SDK
through `ANDROID_HOME` or `~/Library/Android/sdk`. System settings are not
changed.

```sh
python3 tools/android.py                    # full flavor, debug-signed, with unit tests
python3 tools/android.py --lint             # the same, plus Android lint
python3 tools/android.py --fdroid           # camera-free flavor, debug-signed
python3 tools/android.py --fdroid --release # camera-free release APK, unsigned
```

The APK is copied to `build/android/minimal-primitives-<version>-<code>-debug.apk`
(or `-release.apk`), and its size and SHA-256 are printed. To build from Android Studio or with Gradle
directly, run `python3 tools/build.py` (and `--variant fdroid` for the fdroid
flavor) first; the Gradle build stops with a message if its folder is missing.

## Install

```sh
adb install -r build/android/minimal-primitives-0.1.0-2-debug.apk
```

Or copy the APK to the phone and open it, allowing installs from that source.
The debug build can be inspected from desktop Chrome at `chrome://inspect`; the
release build cannot. A debug build and a release build cannot replace each
other in place because they are signed with different keys.

## Verified

The release-signed 0.1.0 (2) was checked on October 16, 2026; its signature,
contents and emulator checks are recorded in the private release notes. The
debug test build before it:

Checked on October 15, 2026 on an Android 16 (API 36) emulator with WebView
134, a 1080 × 2400 screen at 420 dpi, by real taps, swipes and key presses
through adb. APK checked: `minimal-primitives-0.1.0-1-debug.apk`, 11,064,369
bytes, SHA-256
`39ff00cfc9aee03e1660f50cea635e7026fd885399781ff9b79c931d9ffd61da`.

- The library shows all twelve tiles with their artwork and scrolls to the
  footer.
- Akari (a lamp placed), Bridges (a bridge dragged), Fold (a fold dragged), Tilt
  (a tilt swiped) and Hexsweeper Sphere (WebGL renders; a flag and a reveal)
  each open and take a move. All twelve tiles open a game that shows its Home
  control.
- Home and the Back key both return to the library, and the game shows
  "Resume" on its tile afterwards. Back closes the scores dialog first, and from
  the library it leaves the app.
- After a force stop and relaunch, Tilt reopens with its move in place and Undo
  takes it back.
- Rotating to landscape and back keeps the page and the board unchanged.
- With a tall display cutout emulated, the page stays clear of it in portrait
  and landscape.
- The footer link and an in-game credit link open Chrome with the right
  address; the app stays on its page.
- `aapt2 dump permissions` lists only VIBRATE; no INTERNET.
- No page loads anything outside the bundled collection, and opening every game
  produced no WebView console errors in logcat.
- Long presses on links, tiles and game text select nothing and open no menu. A
  system font scale of 1.5 leaves page text unchanged. A pinch synthesized
  through DevTools (adb cannot send multi-touch) leaves the page at scale 1.

Not yet checked: a physical phone, Android versions below 16, Fire tablets,
TalkBack, a hardware keyboard, and the nickname field with the on-screen
keyboard (sharing is local in this build).

## Release signing

The release identity belongs to the `minimal-primitives` profile of
`android-release-toolkit`, created once on October 16, 2026. The private
keystore stays in the toolkit's user-only folder on the release machine and its
password in the login Keychain; neither is ever printed or committed. The certificate is RSA 4096,
SHA-256 fingerprint
`E2:40:10:45:47:E5:C7:71:F6:B1:C8:0E:BC:63:CC:1E:47:2D:A2:40:93:40:7A:1D:44:9B:40:74:D4:D3:E5:F3`.
Every future update must be signed with this same key.

Gradle reads four values: `MINIMAL_PRIMITIVES_RELEASE_STORE_FILE`,
`MINIMAL_PRIMITIVES_RELEASE_STORE_PASSWORD`,
`MINIMAL_PRIMITIVES_RELEASE_KEY_ALIAS` and
`MINIMAL_PRIMITIVES_RELEASE_KEY_PASSWORD`. The toolkit supplies them from the
Keychain to one process only:

```sh
cd /path/to/android-release-toolkit
scripts/android-release with-signing --profile minimal-primitives -- \
  python3 /path/to/minimal-collection/tools/android.py --release
```

This runs unit tests and lint, then writes a signed, shrunk APK and AAB to
`build/android/`. The signed build runs in a single-use Gradle process with the
configuration cache off, so the signing values are not written to Gradle's
caches. Without all four values both `tools/android.py --release` and any
Gradle release task stop with an error naming what is missing; there is no
unsigned or debug-signed fallback. Do not put the values in a properties file
or shell profile.

Raise the flavor's version code (and name as needed) in `app.properties` for
every build that leaves this machine.

The fdroid release is unsigned on purpose. F-Droid rebuilds it from the tagged
source and checks it against the release APK, which carries the same upstream
signature added with `fdroid/sign-upstream.sh` (v2 and v3, ZIP alignment
preserved). The guard that stops unsigned release builds covers the full
flavor only.

A release-signed APK cannot update a debug-signed one. Anyone with the debug
test build (version code 1) must uninstall it first, which deletes its saves.
