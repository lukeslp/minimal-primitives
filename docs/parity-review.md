# Minimal Primitives parity verification

Luke Steuber, October 14, 2026.

The initial audit at `8a990bb` identified missing restore presentation, original
score transports, incomplete Slant free-draw state, Bridges circuit mode,
completion credit timing and invalid-storage handling. These findings are fixed
in the generated integration layer. Imported game files remain hash-verified.

The final suite checks nine titles at 390×844, 844×390 and 1280×900, with equal
standalone and bundled game viewports. It exercises real keyboard and touch
moves, first-board completion, themes, motion preferences, hints, locks, Undo,
iframe destruction, reload, snapshot-only restoration, secondary boards,
unlocks, open settings, alternate modes, and unavailable/corrupt storage.
The actual ZIP separately checks all twelve entries and shared control placement.
Tile images carry a build-generated content hash in their URLs to avoid stale
missing-image responses in the host's cache. The embed fixture reproduces the
observed Akari, Bridges and Bending 404s for unversioned paths. All twelve images
must finish loading with nonzero natural dimensions and the matching asset hash,
both on entry and after returning Home from every game and Hexsweeper mode.
Its cross-origin fixture sets `scrolling="no"`, matching itch's outer iframe.
Real wheel input and portrait/landscape touch swipes must reach the library
footer without scrolling the document. The footer modal and a bottom-row game
remain usable, and Home preserves the library's scroll position. Locator-driven
automatic scrolling alone does not satisfy this check.

The library has no bar or rail. Home beside Restart is the requested collection
addition. Its exact 48px rectangle is masked on both sides in image comparisons;
all other controls and board geometry remain checked. Static screenshots finish
CSS animations rather than sampling transitions at different real times. Pixel
checks permit one channel step out of 255 for raster rounding; counts and maximum
deltas remain in evidence. Larger differences fail. Geometry, computed colors
and observable control state require exact equality. This is not a claim of
byte-identical screenshots or physical-device acceptance.

Akari comparisons use its real host/path semantics, with all requests intercepted
locally, so its authored light/dark page navigation works on both sides. The
adapter restores the correct look, practice state and preferences even from a
collection snapshot alone. Document-scoped handshakes permit that navigation
without replaying a stale snapshot over a manual theme change. Home does not
change the board's input mode or replace its saved native focus.

Luke requested pure-white lamp cores with a tighter halo in the charcoal Akari
look, then a floor brightness halfway between the first bright version and the
dimmer correction. The .585 light ceiling is the approximate visual midpoint of
.31 and .96 after gamma encoding. Standalone visual references apply that ceiling
and the tighter lamp shadow before comparison. Source hashes, floor falloff,
wall occlusion, conflict colors and the classic look remain as authored. The
charcoal look now uses a smooth dark surface on rule-unlit panels in place of
decorative hatching. Its reference and existing Help sentence reflect that
accepted presentation change; forced-colors keeps its pattern fallback.

A focused surface check advances through the real opening boards, places a lamp
with keyboard input, and samples rendered pixels: the diagonally illuminated
unlit panel stays darker than an adjacent lit panel, and the lamp core is white.
It also checks that bulb conflicts remain red, Undo removes that conflict, and
forced-colors retains a non-luminance distinction. Phone and landscape sizes
use isolated browser contexts. Three sizes, including the reported tall-phone
viewport, check that completion stays within 24px of the finished board and keeps
a 48px Next target. Both Akari looks retain this placement. Their puzzle-share
controls are hidden in the bundle; standalone source snapshots remain unchanged.

Notan's active timer can advance by the controlled fixture's 100–300ms while
reopening. Snapshot comparisons account for that elapsed time; a separate test
asserts exact restoration of the remaining fraction and the next tick boundary.
Fold's ArrowLeft is an actual unfolding action, so its resume fixture does not
mistake that action for a focus-only move. Bridges restores its circuit flag,
controller, open wire picker and corresponding Help content.

Run after building:

```sh
node --test --test-concurrency=1 tests/parity*.cjs
```

`MINIMAL_ROOT`, `MINIMAL_PARITY_GAMES`, `MINIMAL_PARITY_SIZES` and
`MINIMAL_PARITY_EVIDENCE` select the target, diagnostic subsets and evidence
location. Requests outside the fixture origin, original score APIs and non-GET
requests are blocked before network access. No public scores are posted.
The Escape-only Rift restore probe freezes its browser clock: its native debug
helper deliberately leaves only 80ms before a loss, which must not elapse during
host-side iframe recreation. Live timer advancement is tested separately. Hex board raster comparisons use
a controlled clock and software Canvas 2D; accelerated edge rasterization was
not repeatable even with identical native poses. All other Hex input, material
and lifecycle checks still exercise the actual pinned browser runtime.

Full acceptance also runs the real isolated HTTP/SQLite service and actual-ZIP
embed tests through `npm test`. See `release/verification.json` for the accepted
artifact and final counts. Initial failures and intermediate evidence remain
outside Git under `~/craft/reports/by-date/2026-10-14/minimal-build/`.
