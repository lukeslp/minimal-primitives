# Minimal Primitives

These games started as UX experiments. I wanted to see whether a simple, iconic surface could drop you straight into a puzzle and teach the interaction through the design, with almost no text.

I think the purpose of technology is to reduce the latency between intent and outcome. Each of these is a small test of that idea.

Eighteen small puzzle games in black and white.

**Hexsweeper.** Minesweeper on hex tiles: on a sphere, on a classic board, or on a board with no end.
**Notan.** Fill the squares each row and column asks for, and a small picture appears.
**Akari.** Light every open square. Lamps must never shine on each other.
**Spiral Galaxies.** Build a shape around each center that matches after a half turn.
**Bridges.** Join the islands. Match each number and connect them all.
**Slant.** Draw a diagonal in every square. Match the numbers without making a loop.
**Fold.** Fold the paper until a dot shows through every hole.
**Bending.** Bend light around planets.
**Tilt.** Tip the tray to roll the marble into the hole.
**Horologist.** Put wheels in the holes so every clock runs forwards.

The last tile opens eight Motor Accessibility Puzzles, made for one switch, your eyes or a tilt of the head:

**Glance.** A small board of tiles, turned over by looking.
**Glyph.** Trace a faint figure from corner to corner by looking.
**Pursuit.** The ring your eyes, head or pointer follows comes to rest in the picture.
**Shoo.** Bees flee from wherever you look. Herd them home.
**Nod.** Tilt your head to tip stacked trays and drop the marble through the right holes.
**Noon.** Fill the cells the numbers describe, pressing one switch as a cell's clock reaches noon.
**Sweep.** A highlight sweeps the rows: press for the row, press for the tile.
**Ticker.** One button, played by ear: press as each note of the tune sounds.

Play with touch, a mouse or keys. Every game except Hexsweeper also plays with one switch or by looking. Turn that on in Settings > Access. Looking uses your camera, and the picture never leaves your device.

Progress stays in your browser. No account.

More on the web:
- [Android download](https://lukesteuber.com/downloads/apps/minimal-primitives/)
- [The Minimal board](https://lukesteuber.com/minimal/), with [Harmonies](https://datapoems.io/datavis/poems/music.html), [Simple Machines](https://lukesteuber.com/games/simplemachines-minimal/), [Cast 3D](https://lukesteuber.com/games/cast-3d/), [Loop](https://lukesteuber.com/games/loop/) and [Weave](https://lukesteuber.com/games/weave-minimal/)

---

Every game in `sources.json` has one bold line above, and the count in the
first line matches. When a game joins, add its line; `npm test` names any game
that is missing.

Private draft settings (project 5161098, `lukesteuber/minimal-primitives`):

- Kind: HTML game; browser only.
- Upload: `minimal-primitives-browser.zip`; root `index.html`.
- Pricing: itch takes payments for HTML5 games only as donations, so choose
  No payments or Donate.
- Generated content: answer No to itch's question about generated content.
- Embed: enable fullscreen. Start with a resizable 960×720 embed.
- Mobile Friendly: on, with orientation Default.
- Do not enable automatic start until the final embed is checked on itch.
- Accessibility: Color-blind friendly, once Slant is settled. Checked on
  2026-10-15 against the shipped CSS. Akari, Bridges, Horologist and Notan pair
  each state colour with a lightness step, heavier stroke, ring, dash or
  strike-through; Hexsweeper's states are glyphs; Spiral Galaxies' sky and
  Slant's section fills are decoration. The exception is Slant's clues: an
  unfinished clue is red (#bd2938) and a satisfied clue blue (#0966ae), with the
  same lightness (L\* 42) and the same digit. In the dark theme they are 70 and
  79. Red-green colour blindness keeps the blue–yellow difference, but lightness
  and shape do not tell them apart. Change that in Slant's source project, or
  leave the tag off.
- Tags (itch allows ten): puzzle, minimalist, collection, singleplayer,
  touch-friendly, logic, relaxing, abstract, black-and-white, casual.
- Keep visibility Draft. Private preview upload is authorized; public publication is separate.
- This private ZIP has no remote score endpoint, so results stay local. Online
  scores require a separate service deployment and acceptance run.

Screenshots, in upload order. itch suggests three to five, so the first five
lead. After adding a game, run `python3 tools/build.py`, then
`node tools/capture-screenshots.cjs`; it retakes every shot from the ZIP and
rewrites this list.

<!-- screenshots: written by tools/capture-screenshots.cjs -->
1. `01-library-phone.png`: Library, phone (1170x2532)
2. `02-library-desk.png`: Library, desk (1440x900)
3. `03-hexsweeper-sphere-desk.png`: Hexsweeper Sphere, desk (1440x900)
4. `04-tilt-landscape.png`: Tilt, phone landscape (2532x1170)
5. `05-hexsweeper-sphere.png`: Hexsweeper Sphere, phone (1170x2532)
6. `06-hexsweeper-classic.png`: Hexsweeper Classic, phone (1170x2532)
7. `07-hexsweeper-infinite.png`: Hexsweeper Infinite, phone (1170x2532)
8. `08-notan.png`: Notan, phone (1170x2532)
9. `09-akari.png`: Akari, phone (1170x2532)
10. `10-galaxies.png`: Spiral Galaxies, phone (1170x2532)
11. `11-bridges.png`: Bridges, phone (1170x2532)
12. `12-slant.png`: Slant, phone (1170x2532)
13. `13-fold.png`: Fold, phone (1170x2532)
14. `14-bending.png`: Bending, phone (1170x2532)
15. `15-tilt.png`: Tilt, phone (1170x2532)
16. `16-horologist.png`: Horologist, phone (1170x2532)
17. `17-glance.png`: Glance, phone (1170x2532)
18. `18-glyph.png`: Glyph, phone (1170x2532)
19. `19-pursuit.png`: Pursuit, phone (1170x2532)
20. `20-shoo.png`: Shoo, phone (1170x2532)
21. `21-nod.png`: Nod, phone (1170x2532)
22. `22-noon.png`: Noon, phone (1170x2532)
23. `23-sweep.png`: Sweep, phone (1170x2532)
24. `24-ticker.png`: Ticker, phone (1170x2532)
<!-- /screenshots -->

Play clips, one per board, in `release/clips/`: a 480 px looping GIF (about
8 seconds, 12 fps, 64 colors, like the first Tilt and Horologist uploads) and
a poster frame each. Most show the game's own Hint playing through the first
boards. Ticker is a listening game, so its clip barely moves. To retake them
after a change, run `python3 tools/build.py`, then `node tools/capture-clips.cjs`
(records each board from the ZIP), then `tools/clips-to-gif.sh release/clips`
on a machine with ffmpeg.

