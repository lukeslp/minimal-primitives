# Next release: queued

Changes waiting for the next Minimal Primitives build after 0.5.2 (14 and
F-Droid 15). Nothing here is built, signed or submitted. Cut the build only
when Luke asks. The 0.5.2 Play internal release is recorded in
`docs/deployment.md`. Version codes must be above 15.

## Already on main

- iPhone Duo layout (PR 27, `fe4ce73`): `web/duo-layout.js` keeps boards and
  controls off the fold when the phone is folded, and leaves the frame alone
  otherwise. Notes in `docs/iphone-duo.md`.

## Playtest fixes, queued 2026-11-14 (Luke: "Yes, queue them")

These were merged upstream and have been live on the web since about 09:10
UTC on 2026-11-14.

### game-riffs master `e2c954b` (PRs 153 to 156)

| Game | Current pin | Change |
| --- | --- | --- |
| Balance | `9d92c04` | Tapping a fixed square shows corner brackets and shakes; empty squares get a faint outline; opening board 1 now takes two taps. The 30 campaign boards are byte-identical. |
| Constellations | `9d92c04` | An overfull star goes hollow; a second tap clears a route; board 1's line is doubled to teach the count. Board ids are unchanged. |
| Towers | `9d92c04` | New opening board `o2b` after `o2`; `o3` gains a 1 clue; the after-solve view also shows after a tap solve. |
| Delve | `9d92c04` | More floor contrast: floor `#5c5c5c`, remembered floor `#383838`, gray marks `#b0b0b0`. |
| Horologist | `1e8d92e` | Larger peg holes and catch dots (`plate.js` only, `e9896154`). |

`9d92c04` to `e2c954b` is 27 commits. Horologist is one of the original twelve
games, pinned at `1e8d92e`. Re-pinning it also brings in `7052e707`
(2026-11-11: all games are linked in the Settings and Help footers) and
`7fb17802` (home-screen install files, which `tools/transforms.py` and the
importer's `WEB_ONLY` lists already strip). Check that the footer links still
pass the credit-link test. Otherwise, add only Horologist to `REPIN` in
`tools/import-games.py`. Moving all twelve past `1e8d92e` is a separate
decision for Luke.

**Decided 2026-11-14 (Luke: "horologist: move"):** re-pin Horologist to
`e2c954b`.

Towers' new `o2b` board: a 2×2 with no towers placed, a 1 on the left and a
2 on the right (solution: rows 1 2 and 2 1). It sits between `o2` (one given
1) and `o3`, which gains a right-hand 1 clue. Luke asked to see it on
2026-11-14 before deciding; the render is kept outside the repository.

**Decided 2026-11-14 (Luke: "Yes, move Towers"):** Towers moves to `e2c954b`
with the other new games.

The new board also shifts the board order. Before release, check that a
saved Towers game still resumes on the right board (the parity fixtures'
`nextBoard` and `otherBoards` in `tests/parity-fixtures/games/towers.cjs`).

### Hexsweeper `26882d9` (lukeslp/hexsweeper PR 19)

- Classic shows "Mine hit" or "Board cleared" with Play again.
- On Sphere, touching a squeezed rim cell turns that cell to the front first.
  This is off when `HEXSWEEPER_SPHERE_APP` is set unless the game boots with
  `rimTapTurns: true`. The collection does not set `HEXSWEEPER_SPHERE_APP`
  (it appears only inside vendored game files), so rim taps will turn the face
  in the app.

**Decided 2026-11-14 (Luke: "hexsweeper: move"):** re-pin Hexsweeper to
`26882d9`, including the reflection-image trim below.

The app pins `aa4a93d`, which is 241 commits behind `26882d9`. The 241 commits
are mostly unrelated work, but the files the app bundles still change by
about 550 lines across 17 files (7 modified, 10 deleted). Besides PR 19,
the re-pin brings in:

- PR 13 (`2dd9f7a`): it deletes ten bundled reflection images that have no
  known source: amber-cells, canopy, deco, gilded-ribbon and portoro, at two
  sizes each. It also adds `sphere/assets/reflections/SOURCES.md`, which the
  importer should vendor. Confirm that the Sphere theme picker falls back
  cleanly for anyone whose saved theme used one of them, and that
  `sources.json`'s file list drops them.
- PR 14 (script version strings) and PR 15 (canceled and orphaned Sphere
  gestures end cleanly).
- Other merges on the path that touch bundled files: PRs 1, 8, 9 and 10 (the
  Classic board, the restored Classic screenshot, the help history tile and
  the port credit fix). Read the bundled-file diff, not only the PR titles:
  `git diff aa4a93d 26882d9 -- <paths from sources.json>`. Modified:
  `bounded.html` and `sphere/` `hex-bloom.js`, `hexasphere.js`, `index.html`,
  `mirror-material.js`, `quiet-chrome.js`, `sphere.js`.

### Not included

- Fold PR 152 (table finish) is unmerged and waiting on Luke. Add it only once
  it is on game-riffs master.

## Checks before building

1. Re-import with `--new-ref e2c954b`, Horologist added to `REPIN` at
   `e2c954b`, and the Hexsweeper checkout at `26882d9`. Confirm that no other
   game's pin moves.
2. Run each affected game's own suites in game-riffs and Hexsweeper. Two
   tests already fail at random on game-riffs master: Towers' keyboard "Bottom
   edge." and Constellations' "same sky after reload". Rerun them before
   treating a failure as new.
3. Run `npm test` here (parity, package, build, validators). Re-record
   parity baselines only where the change is intended (Balance, Constellations
   and Towers board 1, Delve colors, Horologist holes, Hexsweeper Classic end
   state).
4. Do a smoke check on a phone. Balance: tap a fixed square. Constellations:
   overfill a star and clear a route. Towers: `o2b`. Delve: floor contrast.
   Horologist: peg holes. Hexsweeper: a Classic loss, and a Sphere rim tap.
