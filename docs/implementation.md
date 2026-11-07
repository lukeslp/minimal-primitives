# Minimal Primitives implementation contract

Accepted October 14, 2026. Browser-first private collection; no accounts or cloud saves. Public publication follows review. Amended October 15 at Luke's request: an offline Android app (`android/`, built by `tools/android.py`) plays the exact browser build, with no network permission and scores kept on the device.

## Games and preservation
Ten titles: Hexsweeper (Sphere, Classic, Infinite), Notan, Akari, Spiral Galaxies, Bridges, Slant, Fold, Bending, Tilt, Horologist. Import committed runtime snapshots with source SHA and hashes. No source edits for bundling. Preserve controls, appearance, themes, hints, rules and completion; integration transforms affect storage, links, transport and invisible state/lifecycle hooks, plus the explicitly requested Home icon and pure-white lamp cores with a tighter halo in Akari’s charcoal look. The floor brightness sits visually halfway between the original dim floor and the first bright version. Smooth, darker unlit panels replace decorative hatching while retaining natural light spill; lit panels lose that dark surface. The forced-colors pattern fallback is retained. In both Akari looks, Next sits directly below the completed board. Puzzle-share controls are hidden in the collection because their embedded-page links do not open the itch collection; the itch page handles collection sharing. Falloff, occlusion, animation and red conflict indicators are retained; the classic board is unchanged. The library follows the Minimal Primitives web index: edge-to-edge monochrome square artwork, no visible titles or introductory text. Sphere, Classic and Infinite each have a direct-launch tile. No collection bar or side rail; games fill the viewport. A Home icon beside the native restart control returns to the library. Collection scores live in Settings and in a single trophy modal below the library. This modal combines board categories, nickname, explicit future-score sharing, save and removal; actions use labelled icons. The footer centers the oneimpossiblethingatatime.com link independently of the trophy. This supersedes the initial external-bar plan at Luke’s request. Only the selected game runs. Lossless adapter snapshots retain undo and transient state on switching. The selected game/mode is recorded in the URL fragment so refresh reopens it; Home clears that selection. A synchronous pagehide checkpoint preserves the current board, Undo and open settings before reload. Reloaded attempts remain local practice.

## Campaigns
Horologist14→50, Tilt12→50, Fold18→50, Bending24→50, old prefix unchanged, no mirror/rotation padding. New players progressively unlock each next board. Show every board with current/completed/available/locked state. Retain prior access and earned unlocks for existing saves. Original changes confined to these campaigns, selectors, migrations and dynamic length assumptions. The bundle imports the same accepted catalog data.

## Shared profile and scores
Local anonymous profile, public nickname20chars, explicit one-time opt-in. No historical or mid-attempt publication. Separate boards by game, mode, puzzleId, layoutHash, rulesVersion, scoringPolicy. Native measures: Horologist hits, Tilt moves, Fold folds ascending, then elapsed; timed finite games ascending; Infinite cleared descending then elapsed ascending. Categories unassisted/assisted/repeat/repeat-assisted/practice; practice stays local. Hints/restarts sticky through undo. Server-issued online runs, wall-clock timing, final-state/replay validation; casual, not cheat-proof. Network failure never blocks play.90-day public retention, remove own scores. Original public boards untouched.

## Service API v1
JSON with CORS for exact configured origins, default https://html-classic.itch.zone; Authorization: Bearer anonymous secret (32-byte hex). Endpoints under /api/v1/: POST runs {submission,identity:{game,mode,puzzleId,layoutHash,rulesVersion,scoringPolicy},repeat:false}; returns {run,startedAt}. POST runs/:run/finish {submission,proof,assisted,repeat,practice}; returns {score:{id,run,identity,category,value,elapsedMs},ranked:boolean}. A valid opted-in finish includes nickname and publish:true and creates a public score idempotently. GET boards?identity fields&category=... returns {entries:[{id,rank,nickname,value,elapsedMs}],category}; DELETE scores/:id removes owner's score. GET health returns {ok:true}. Strict bounded requests, owner checks, SQLite outside webroot, no client-provided elapsed trusted. rules validation runs in a bounded persistent Node subprocess using pinned imported engines via server/validate.mjs. Server worker implements service, validation dispatcher and test fixtures; real per-game proof validators are main-owned adapters/validators.mjs, invoked by dispatcher. Unknown/invalid validators fail closed. Run start never posts a public score. Offline and interrupted are practice, not queued for later ranked upload. Transient failed finish for a valid online run can retry with identical submission id.

## Browser integration
Parent window owns profile/API. Each generated game receives bridge bootstrap and invisible hooks. Events contain v:1, game, mode, attempt, sequence, type, payload; types ready/open/commit/assist/restart/complete/snapshot. Parent checks event.source, exact origin, handshake nonce and a document identifier with monotonic sequencing within each document. Theme navigation receives a new document identifier; stale prior-document events are rejected. A saved snapshot is consumed only on initial entry, and cannot overwrite a manual theme change. Adapter snapshot/restore types private and source-versioned. Existing Bridges/Slant Scores interfaces remain via transport compatibility; avoid duplicate requests. Use source-anchor guards; do not poll completion timing.

## Acceptance
Original rule suites; full campaign proof and migration tests; exact-layout parity at equal game viewport; desktop/phone/landscape keyboard/touch, reduced motion, iframe focus, save corruption/isolation, resume every mode. API tests use private disposable DB and invalid/replay/duplicate/origin/deletion fixtures. Actual export exercised under cross-origin itch-like subfolder. Release ZIP, cover/screenshots, copy, manifests, deployment/rollback recipe. Stage local/private preview first, no public itch push.

## Web snapshot correction
Hexsweeper uses the web release at `aa4a93d69ce5e8a82a594748a4616f2d3c91e935` in `lukeslp/hexsweeper-private-history` (re-pinned 2026-11-03 from `a110ca99270fa0886510953e1f44d893d00065a9`), including its committed control frame. Classic and Infinite load Access (one switch, look and hold) from `access.js` and `bridge-client.js` beside them, which the importer now copies. The game rules are unchanged from `a110ca9`; only the frame, the Sphere picture caption and the tab icons differ. The score validator's rule versions follow the new file hashes, so Hexsweeper scores start new lanes. The initial import came from an older native-development checkout and lacked that frame. The three web entries now preserve the same controls as the other games. Their original Games pills are already absent in this source. Collection Home is the only added navigation glyph. New source hashes also version the score validators and their proof fixtures. The retained Earth/Moon texture attribution travels with the ZIP.

The archive check opens all twelve entries at desktop, phone and landscape sizes, checks the existing control frame, 48px Home targets beside Restart, full-viewport iframes, return and unloading, and absence of legacy Games pills. Hex board raster parity is compared directly from the game canvas; Home is an intentional difference in surrounding controls.


## Akari tile entry correction — October 15, 2026

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


## Motor-accessible puzzles in the package — November 2, 2026

At Luke's request the package carries the eight motor-accessible puzzles from
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

Harmonies, Simple Machines, Cast 3D, Loop and Weave stay on the web and are
linked from the release page.
