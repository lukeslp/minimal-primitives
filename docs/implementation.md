# Minimal Primitives implementation contract

Accepted October 14, 2026. Browser-first private collection; no accounts or cloud saves. Public publication follows review. Amended October 15: an offline Android app (`android/`, built by `tools/android.py`) plays the exact browser build, with no network permission and scores kept on the device.

## Games and preservation
Ten titles: Hexsweeper (Sphere, Classic, Infinite), Notan, Akari, Spiral Galaxies, Bridges, Slant, Fold, Bending, Tilt, Horologist. Import committed runtime snapshots with source SHA and hashes. No source edits for bundling. Preserve controls, appearance, themes, hints, rules and completion; integration transforms affect storage, links, transport and invisible state/lifecycle hooks, plus the explicitly requested Home icon and pure-white lamp cores with a tighter halo in Akari’s charcoal look. The floor brightness sits visually halfway between the original dim floor and the first bright version. Smooth, darker unlit panels replace decorative hatching while retaining natural light spill; lit panels lose that dark surface. The forced-colors pattern fallback is retained. In both Akari looks, Next sits directly below the completed board. Puzzle-share controls are hidden in the collection because their embedded-page links do not open the itch collection; the itch page handles collection sharing. Falloff, occlusion, animation and red conflict indicators are retained; the classic board is unchanged. The library follows the Minimal Primitives web index: edge-to-edge monochrome square artwork, no visible titles or introductory text. Sphere, Classic and Infinite each have a direct-launch tile. No collection bar or side rail; games fill the viewport. A Home icon beside the native restart control returns to the library. Collection scores live in Settings and in a single trophy modal below the library. This modal combines board categories, nickname, explicit future-score sharing, save and removal; actions use labeled icons. The footer centers the oneimpossiblethingatatime.com link independently of the trophy. This supersedes the initial external-bar plan at Luke’s request. Only the selected game runs. Lossless adapter snapshots retain undo and transient state on switching. The selected game/mode is recorded in the URL fragment so refresh reopens it; Home clears that selection. A synchronous pagehide checkpoint preserves the current board, Undo and open settings before reload. Reloaded attempts remain local practice.

## Campaigns
Horologist 14→50, Tilt 12→50, Fold 18→50, Bending 24→50, old prefix unchanged, no mirror/rotation padding. New players progressively unlock each next board. Show every board with current/completed/available/locked state. Retain prior access and earned unlocks for existing saves. Original changes confined to these campaigns, selectors, migrations and dynamic length assumptions. The bundle imports the same accepted catalog data.

## Shared profile and scores
Local anonymous profile, public nickname of up to 20 characters, explicit one-time opt-in. No historical or mid-attempt publication. Separate boards by game, mode, puzzleId, layoutHash, rulesVersion, scoringPolicy. Native measures: Horologist hits, Tilt moves, Fold folds ascending, then elapsed; timed finite games ascending; Infinite cleared descending then elapsed ascending. Categories unassisted/assisted/repeat/repeat-assisted/practice; practice stays local. Hints/restarts sticky through undo. Server-issued online runs, wall-clock timing, final-state/replay validation; casual, not cheat-proof. Network failure never blocks play. 90-day public retention; players can remove their own scores. Original public boards untouched.

## Service API v1
JSON with CORS for exact configured origins, default https://html-classic.itch.zone; Authorization: Bearer anonymous secret (32-byte hex). Endpoints under /api/v1/: POST runs {submission,identity:{game,mode,puzzleId,layoutHash,rulesVersion,scoringPolicy},repeat:false}; returns {run,startedAt}. POST runs/:run/finish {submission,proof,assisted,repeat,practice}; returns {score:{id,run,identity,category,value,elapsedMs},ranked:boolean}. A valid opted-in finish includes nickname and publish:true and creates a public score idempotently. GET boards?identity fields&category=... returns {entries:[{id,rank,nickname,value,elapsedMs}],category}; DELETE scores/:id removes owner's score. GET health returns {ok:true}. Strict bounded requests, owner checks, SQLite outside webroot, no client-provided elapsed trusted. Rules validation runs in a bounded persistent Node subprocess using pinned imported engines via server/validate.mjs. Server worker implements service, validation dispatcher and test fixtures; real per-game proof validators are main-owned adapters/validators.mjs, invoked by dispatcher. Unknown/invalid validators fail closed. Run start never posts a public score. Offline and interrupted are practice, not queued for later ranked upload. Transient failed finish for a valid online run can retry with identical submission id.

## Browser integration
Parent window owns profile/API. Each generated game receives bridge bootstrap and invisible hooks. Events contain v:1, game, mode, attempt, sequence, type, payload; types ready/open/commit/assist/restart/complete/snapshot. Parent checks event.source, exact origin, handshake nonce and a document identifier with monotonic sequencing within each document. Theme navigation receives a new document identifier; stale prior-document events are rejected. A saved snapshot is consumed only on initial entry, and cannot overwrite a manual theme change. Adapter snapshot/restore types private and source-versioned. Existing Bridges/Slant Scores interfaces remain via transport compatibility; avoid duplicate requests. Use source-anchor guards; do not poll completion timing.

## Acceptance
Original rule suites; full campaign proof and migration tests; exact-layout parity at equal game viewport; desktop/phone/landscape keyboard/touch, reduced motion, iframe focus, save corruption/isolation, resume every mode. API tests use private disposable DB and invalid/replay/duplicate/origin/deletion fixtures. Actual export exercised under cross-origin itch-like subfolder. Release ZIP, cover/screenshots, copy, manifests, deployment/rollback recipe. Stage local/private preview first, no public itch push.

## Web snapshot correction
Hexsweeper uses the web release at `aa4a93d69ce5e8a82a594748a4616f2d3c91e935` in `lukeslp/hexsweeper-private-history` (re-pinned 2026-11-03 from `a110ca99270fa0886510953e1f44d893d00065a9`), including its committed control frame. Classic and Infinite load Access (one switch, look and hold) from `access.js` and `bridge-client.js` beside them, which the importer now copies. The game rules are unchanged from `a110ca9`; only the frame, the Sphere picture caption and the tab icons differ. The score validator's rule versions follow the new file hashes, so Hexsweeper scores start new lanes. The initial import came from an older native-development checkout and lacked that frame. The three web entries now preserve the same controls as the other games. Their original Games pills are already absent in this source. Collection Home is the only added navigation glyph. New source hashes also version the score validators and their proof fixtures. The retained Earth/Moon texture attribution travels with the ZIP.

The archive check opens all twelve entries at desktop, phone and landscape sizes, checks the existing control frame, 48px Home targets beside Restart, full-viewport iframes, return and unloading, and absence of legacy Games pills. Hex board raster parity is compared directly from the game canvas; Home is an intentional difference in surrounding controls.


## Akari tile entry correction, October 15, 2026

The library tile always starts stylized Akari (`look=dark`), regardless of stored
Theme or device appearance. Classic remains accessible through Settings. Restore
keeps the entry-selected renderer while retaining all board marks, Undo and
Classic tutorial records. Presentation-only `look` parameters do not skip the
stylized opening boards. The standalone renderer and both tile captures use
the accepted brighter appearance.


Akari unlit material correction: the normal unlit floor is a visible charcoal
layer (`#484848cc`) rather than translucent black. The lamp and lit light-field
brightness are retained. Pixel checks require unlit panels to stay visible and
at least 40 levels darker than a representative lit panel.


Akari completion now fades in at its final target position after the board
settles; the arrow itself no longer translates during its reveal. Standalone
uses the same board-adjacent completion placement as the collection.


## The package offers only what works, November 16, 2026

Found in a review of the app package. All of it is build-time or shell work; the imports are untouched.

- Privacy policy: the library's Settings has a Privacy row that opens `web/privacy.html` in a sheet over Settings (the
  page is bundled, so it works offline; opened by itself it is an ordinary page with a link back). The row is added by
  `web/collection.js`, because the sheet's markup is the index's own. `tools/build.py` keeps the page's paragraphs for
  the build being made: the full build's camera use, or that the camera-free build has no camera input.
- Cast: the "Cast · Old" links (`../cast/`) led back into the same packaged page without the collection's handshake,
  where Home, All games and Scores stopped answering. The Settings footer loses the link, and the page shown without
  WebGL offers "Back to all games" instead.
- Sharing and downloads: Copy link copied the packaged page's own address (`minimal://collection/...` in the iOS app),
  and a download is a `blob:` link the apps' web views drop while the game reports success. Hidden in the package, as
  Akari's Share row already was: the Share group in Slant, Bridges, Spiral Galaxies and Fold; Slant's Download (in
  Settings and on a Free draw board); Notan's Share blank; Hexsweeper Endless's Export run and Import run. Hexsweeper
  Sphere's Share image stays: it hands a picture to the system share sheet, with no address.
- Camera: on the web a camera the browser already allows starts by itself when a game opens. In the package it starts
  only after the player selects a camera control in the game that is open: the camera key or button (a tap, a click,
  or the pointer held on it), or Head, Eyes, Look and hold or Calibrate in that game's Settings. A camera the player
  started comes back after the app was in the background. Permission granted to another game, or on another day,
  starts nothing (`press_first` in `tools/camera_recipe.py`, both builds).
- Saves: the storage shim in `adapters/bootstrap.js` keeps a write the device refused and reads it back in place of the
  older stored value; the library says once, quietly, "Could not save on this device. Progress may not be kept."
- Recovery: a library that cannot read its data clears the opening and shows "The games could not load." with Retry; a
  game frame that has not reported ready after eight seconds gets the collection's own Home over the frame; the iOS
  shell shows the same message with Retry when a navigation fails.
- Scores: with no score service the sheet lists this device's results for the open board and says "Scores stay on
  this device."; at the library it lists the last eight boards finished, across games, newest first.

`tests/shell-review.test.cjs` drives each of these in the built library; `tests/test_build.py`
(`PackageOffersOnlyWhatWorksTests`) checks the transforms, both privacy pages and the iOS privacy manifest.

Four more checks of the built packages, the same day (0.5.8). The Android APKs' `assets/www` and the iOS app's `www`
are byte for byte `build/html` (or `build/html-fdroid`), so the checks read those trees.

- Script syntax and the iOS deployment target (17.0, `ios/project.yml`): no packaged script has a class static block
  (they parse from iOS 16.4), a `v`-flag expression, an import attribute, an expression modifier or `using`. Newer
  calls that do ship are each behind a check for themselves (`requestIdleCallback`, `getCoalescedEvents`,
  `checkVisibility`, `AbortSignal.any`, `Float16Array`). These are searches of the text, not a parse: no parser held
  to an older language level, and no iOS 17 runtime, was at hand.
- Nothing from the network: the counter's script tag was already removed; thirteen pages' own content policies still
  allowed its host, and two Hexsweeper pages kept its comment. The policies no longer name the host, and the build
  stops if any packaged file does. No element, style or script names an address outside the package to load. The
  ways out are ordinary links, each opening outside the app: lukesteuber.com (every game's Settings and Help),
  datapoems.io (Hexsweeper), the source on GitHub and oneimpossiblethingatatime.com (the library's Settings and
  footer).
- Pictures: Tangles' Save the picture (on a finished board, in its board list and its Experiments) and Hexsweeper
  Sphere's Share image fall back to a `blob:` download where no share sheet exists, which the apps drop; Tangles
  then says "Image saved." Android's web view has no share sheet (seen on the check emulator: `navigator.share` is
  undefined). `adapters/bootstrap.js` marks a page that can share a picture, and those buttons show only there
  (`SHARE_SHEET_ONLY` in `tools/transforms.py`, with each game's own decision anchored).
- Privacy page: Tilt · 3D's Phone tilt asks an iPhone or iPad for motion, which the page did not say. Both builds'
  pages say it now. The hosted policy (downloads-site) must say the same.

Two outside reviews of that build, the same day, before submission. Each item was checked in the built package
first; two were not as reported and are noted as such.

- Links between packaged pages: a game plays in a frame the library opened with a handshake in the page's address
  (`?minimal=`), and Home, Scores and Android's Back answer only in a page that has it. Hexsweeper's Help named its
  other modes as links ("Also Infinite · Classic" in Sphere, "Also Sphere · Classic" in Endless): they loaded a
  second mode in the first one's frame, where Home did nothing, and the one to Sphere named a page the package does
  not have. Both rows are cut (`ALSO_ROWS`); the library's card offers the modes. The handshake now goes with every
  link to a packaged page from one listener in `adapters/bootstrap.js`, for every game, so a link a later import
  brings cannot strand a player. Tangles' Experiments and New Game+ were reported stranded and were not: Tangles'
  adapter already carried the handshake to `experiments.html`. That handler is gone in favor of the shared one.
- Android's Back pressed the game's Home and took the press as done. It now presses Home only in a page that still
  carries the handshake its frame was opened with, and six seconds later asks the library to leave that one game,
  named by its handshake, if it is still on screen (`MainActivity.kt`, `confirmHome`; `leave` in
  `web/collection.js`). The library takes the board as it stands, stores it and shows itself. Where the board
  cannot be saved (the game will not give it up, or the device will not store it) the player is asked over the
  game: "This board could not be saved.", Keep playing or Leave anyway. A page without the handshake is left the
  same way, at once. No path reloads over a game; the one reload left is for a library that never started. A check
  started in one game says nothing about a game opened after it. The scripts are run as written by
  `tests/shell-review.test.cjs`. On the `Minimal057_Check` emulator (Android 16, a debug build, the real Back key,
  the page driven through the web view's debugging socket): Back from a Tangles Experiments page showed the
  library; Back left a page without the handshake in 40 ms; a game that never answered Home was saved and left 6.5
  seconds after Back, with no reload; a board that could not be saved brought the question after 6.6 seconds, and
  both answers worked; with Back in a second game 2.2 seconds after Back in a first, nothing happened at the first
  game's six seconds and the question came 6.3 seconds after the second press; Back from the library left the app.
- Hexsweeper Sphere's Water Wheel is not in the package. Its three doors (a button in Help, a hold on the mine
  count with a water-fill hint, a button named for screen readers) paused the timer and opened nothing. All three
  are cut whole (`WHEEL_HELP`, `WHEEL_CLICK`, `WHEEL_HOLD`), and the `window.open` rewrite went with them.
- Cast: the adapter checked every Undo step of the open board and none of the waiting one (the free board while
  the fifty are played, and the reverse). A waiting board with a step the engine cannot read was restored and threw
  at a later Undo. Both lists are checked now, each against its own board.
- A save a game refuses is kept under `refused` whichever build made it. It used to be kept only when the source
  commit differed, so a damaged save from the same build was written over by the next move or by Home. On a device
  with no room for the copy, the save is left where it is: no move, Home or closing writes over it, the notice says
  so ("…this device has no room to set it aside. It is left as it was, and new moves in this game are not saved
  for now."), and the copy is made, and play saved again, at the first save after there is room (`write` now
  reports whether the device stored it; `held` and `free` in `web/collection.js`).
- A share that fails for a reason other than the player turning the sheet away is said by the library ("The picture
  could not be shared. Try again.") and nothing is downloaded (`SHARE_FAILED`). Tangles draws its picture after the
  press, which can outlast the press; the drawn picture is kept, so the next press hands it over at once. Tangles'
  other branch, a sheet that will not take the picture that was drawn, downloaded and said "Image saved."; it says
  the same failure now, and neither script has a download or a window left. Tangles takes a browser with no
  `canShare` as able to share, as the bootstrap's probe and the sphere do.
- Look with: Eye tracker needs a helper program on the same computer, which no phone has. Every build shows the
  choice unavailable, with the frame's own sentence, turns a saved choice of it into Pointer, and no page's policy
  allows the loopback connection (`no_eye_tracker` in `tools/camera_recipe.py`). The privacy page no longer
  describes the helper. The web pages keep the choice.
- Bridges and Slant: "Scores for this puzzle" offered a nickname and "Share future scores" with no score service
  behind it. The sheet asks the library once whether there is a service; without one it leaves the form, the
  picker of shared lists and the note about the service out, shows the player's own finished attempts at the board
  from the library's record ("Your time 0:42 · With hints · Saved on this device", and the list, newest first),
  says "Scores stay on this device.", and the library refuses a sharing preference.
- The history of Minesweeper in Hexsweeper Sphere's Help is words now, not a link to another publisher's site.
- Cube Maze's Hint threw if its search worker could not be made at all. That case now takes the game's own
  fallback (the stored solution's next move, or Undo).
- Reported and not so: the library's Reduced motion already dropped the solved picture's fade (the index's
  stylesheet stills everything under `html[data-motion="reduce"]`). A test now starts the library that way.
- Reported and not so: Slant, Bridges, Spiral Galaxies and Fold were said to skip their opening boards for a new
  player, because each takes a first visit only from an address with no query and the library opens a game with
  `?minimal=` in it. `adapters/bootstrap.js` takes the handshake out of the address before any of the game's
  scripts run, so each reads an empty query and opens on `p1`. A test opens all eight games that decide a first
  visit (those four, Akari, Balance, Towers, Tents) with empty storage and holds them to their opening boards.
- iOS motion. Tilt · 3D's Phone tilt calls `DeviceOrientationEvent.requestPermission()`. One review said the web
  view rejects it with no prompt unless Info.plist has `NSMotionUsageDescription`. In the iOS 27.2 simulator the
  web view's own prompt came up ("Minimal Primitives" Would Like to Access Motion and Orientation, Cancel or
  Allow) both with the key and in a copy of the app with the key deleted, and with the shell implementing no
  motion method of `WKUIDelegate` (the SDK header, `WKUIDelegate.h`, describes
  `webView:requestDeviceOrientationAndMotionPermissionForOrigin:…` only as letting the app decide; the shell
  leaves the decision to the prompt). The key is in `ios/project.yml` all the same, in the privacy page's terms.
  The request needs a press: asked from a script some seconds after one, it is rejected ("requires a user gesture
  to prompt"), which is what the game's own button satisfies.
- `tests/shell-review.test.cjs` plays the built package (the library and its sheets, Glance without its camera,
  Hexsweeper's sphere, Tangles and its Experiments) and fails on any request, socket or beacon that leaves it.

The iOS app, run. Until this round the iOS build of 0.5.8 had only been compiled. A debug build was installed
in an iPhone 17 Pro simulator (iOS 27.2; no iOS 17 runtime is installed on the build machine) and played through
the debug-only `-MPCheck` runner (`docs/iphone-duo.md`), which runs steps in the library page the way the browser
tests do; the simulator was booted without a window, so nothing was tapped by hand. Under `minimal://collection`,
a secure context: the library draws its tiles; Slant opens on its opening board, takes a move and Home returns
with "Slant · Resume" on the tile; Cast draws its lit room (WebGL) and Home returns; Cube Maze's Hint made its
search worker, got its answer, showed the move and played it on the second press; Hexsweeper's sphere draws, with
no Water Wheel door and no "Also" row; Tangles' Settings link to a tiling carried the handshake and Home returned
from there; Glance showed its camera key and never asked for the camera; Home returned every time. A Slant board
with one move on it, left open when the app was ended, was offered as Resume after relaunch and opened with the
move and its Undo. Not exercised there: the camera itself, the share sheet, VoiceOver, the answer to the motion
prompt (Allow and Cancel need a tap) and tilt readings.

Open: none of this was tried on a real phone, or on iOS 17, the deployment target. A page a script sends itself to
without the handshake (no packaged game does this) is left on Android by Back, as above; the iOS shell has no such
way out. A few messages call the app "this
browser", "this page" or "this site" (Ticker's sound note, Spiral Galaxies' and Cast's failure notes, the camera
notes, and now "on this computer" beside Eye tracker); none tells a player to go anywhere.

## Motor-accessible puzzles in the package, November 2, 2026

The package carries the eight motor-accessible puzzles from
game-riffs (Glance, Glyph, Pursuit, Shoo, Nod, Noon, Sweep, Ticker) beside the
ten games: "the 10 + the 8". They are imported like the others, from their
`runtime.json`, and marked `group: accessible` in `sources.json` and the
catalog. The library's last tile, with the accessibility icon, opens them as a
second grid in the same page (`#view=accessible`); its Home key returns to the
main grid. Home inside one of them returns to that grid.

They keep their own saves and have no resume or score adapter, so the
collection skips the snapshot on Home, adds no Collection scores row and puts
only Home, not Scores, on the Access pad. The resume and score parity suites
cover the ten games; `tests/package.test.cjs` opens each of the eight from the
built archive. All game-riffs games now share one pin, so every game has the
same Access frame. Inside the collection that frame's own in-app Home key is
turned off, because the collection adds its own.

Harmonies, Simple Machines, Cast 3D and Weave stay on the web and are
linked from the release page.
