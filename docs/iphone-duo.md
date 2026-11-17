# iPhone Duo

How the iOS app lays out the collection on iPhone Duo (iOS 27.1+), and how it was
checked. Started 2026-11-13.

## Pieces

| File | What it does |
|---|---|
| `ios/MinimalPrimitives/DuoBridge.swift` | `UIHingeInteraction` on the web view plus `reservedRegions(kind: .division)`; sends `{hinge, status, angle, fold, reserved}` to the page on every change. Installs the shim in every frame. |
| `ios/MinimalPrimitives/duo-fold.js` | The page side: sets `data-duo-pose` (book, laptop, flat), `data-duo-status`, `data-duo-axis` and `--duo-fold-*` on `<html>`, fires `duo:fold`. Game frames take the collection's state with the fold in their own coordinates. Prefers the web's Viewport Segments and Device Posture APIs if a browser has them. |
| `web/duo-layout.css`, `web/duo-layout.js` | The collection's layouts. Inert everywhere else: nothing sets the attributes without the app's bridge. |

The bridge and shim are copies of the shared pair in the snippets library,
`mobile-capacitor/duo-bridge/` (with a README for Capacitor and SwiftUI hosts).
Change them there first, then copy them here, so Naqbu, Notan, Hexsweeper, CUUUUBE
and What Color pick up the same fix.

## Layouts

- **Home.** The open inner display in landscape gets four columns, folded or flat,
  so the first fold doesn't reflow the grid (the bridge reports the fold before it
  is active). Folded like a book, the middle two columns part at the fold, the
  Accessibility band takes the leading half, and the footer link and Scores
  button sit on either side. Elsewhere (phones, iPad, the outer display, Android,
  the web) the grid is unchanged: 2 columns, 3 from 720 px.
- **A game, book pose.** The game plays on the trailing side of the fold (where
  Apple's own overlay arrangement puts the primary view) at phone-portrait size,
  which every game already handles. Its name sits on the leading side. The game
  frame sees no fold.
- **A game, laptop pose.** The game plays above the fold. Its toolbar shows below
  the fold, on the half resting on the table: those buttons press the game's own
  buttons (same labels, icons, pressed and disabled states), and the game's own
  toolbar stays in place but unseen so its spacing and Next placement don't
  change. Sheets open inside the game, above the fold. A game without the shared
  control frame plays above the fold with its name below.
- **Flat or closed.** Everything as before. `duo-layout.js` doesn't touch the game
  frame at all unless the phone is folded, and never before the frame's own `load`.
  Reaching into a frame's initial `about:blank` document changed which window the
  game ran in, and the parity check's seeded `Math.random` was lost: Delve's
  Random mode drew a different dungeon.

Why the frame is shaped from outside: all 29 games size their boards from the
viewport (CSS `dvh` and `innerHeight`), so one change to the frame's size moves
every board off the fold without touching the pinned game sources.

## Checks

- `npm test` (repository acceptance).
- Browser check with made-up folds at the inner display's sizes (951×669 book,
  669×951 laptop): home grid off the fold at the top and bottom of the scroll;
  book game frame wholly on the trailing side; laptop frame ending at the fold
  for Tents, Akari, Tilt · 3D, Hexsweeper, Glance and Delve, with every toolbar
  button mirrored below it; the mirrored Settings opening Tents' sheet; unfolding
  restoring the full frame and the game's own toolbar; and the home page laid out
  and colored exactly as on `main` at 402×874, 951×669, 669×951 and 1280×800
  without a hinge. The script is not in the repository (it needs the Playwright
  runtime from the score checks); see the PR.
- Duo simulator (Xcode 27.2, runtime iOS 27.2 iPhone19,4): folded, the page gets
  `status: closed`, angle 0, pose flat, and the game frame inside the iframe has
  its own shim (`-MPDuoProbe tents`).
- Device Hub, Partially Open (2026-11-13): the inner display is portrait with a
  horizontal fold at y 455.5–495.5 pt (40 pt) and the hinge at 128.6°, so the
  simulator shows laptop pose. Game frame ends at the fold, the game sees no
  fold, and the toolbar is mirrored below (Tents, Spiral Galaxies, Delve,
  Hexsweeper, Tilt · 3D). Closed: status closed, angle 0, layout as before.
  `ios/scripts/duo-screens.sh <udid> <label> [game]` photographs the active
  display and saves the fold state the page saw. `simctl` cannot fold the
  simulator, and `devicectl device orientation set` doesn't turn the inner
  display, so book pose needs a phone.

## Debug-only launch arguments

- `-MPDuoProbe <game id>` opens the game and writes the fold state the collection
  and the game frame see to `Documents/duo-probe.json`.
- `-MPDuoSimulate book|laptop` reports a made-up 24 pt fold across the middle, for
  screenshots on a simulator that can't fold. Never in a release build.
- `-MPCheck <folder>` runs `Documents/<folder>/1.js`, `2.js`, … in the library
  page, each as its file appears, and writes what each returns to `<n>.json`
  beside it. A script on the Mac writes the steps into the simulator's app
  container, reads the answers and takes `simctl io screenshot` between them:
  it is how the app is played in a simulator that cannot be tapped (the 0.5.8
  check, `docs/implementation.md`). Never in a release build.

## Not done

- The optional hinge moment in Tilt · 3D (a lean driven by the hinge angle, with
  the existing tilt and keys as the alternative). It needs a transform of the
  pinned Tilt · 3D source and an angle-drag check in Device Hub.
- A real phone: VoiceOver over the mirrored toolbar, the real fold width, laptop
  pose (the simulator's inner display doesn't rotate).
- The web build and Android leave the shim out, so Chrome's segments API on
  Android foldables changes nothing yet. Adding `duo-fold.js` to `web/index.html`
  would turn the same layouts on there; check on a foldable first.

## Rollback

Revert the merge commit. The layouts sit behind attributes only the bridge sets,
so removing `duo.attach(to:)` from `CollectionViewController.swift` alone also
turns them off.
