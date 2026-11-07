# Third-party code and files

Shoo ships no third-party code of its own except its fonts. The camera's face tracking is not copied into this folder: it loads from Glance's published folder beside it, on the same origin, and only after the player chooses the camera.

- **MediaPipe Tasks Vision 0.10.35 and the Face Landmarker model**, by Google, Apache License 2.0. `track.js` imports `../glance/vendor/vision_bundle.mjs` and points MediaPipe at `vision_wasm_internal.js`, `vision_wasm_internal.wasm` and `face_landmarker.task` in the same folder, which on the site is `/games/glance/vendor/`. Those files, their licence (`glance/vendor/LICENSE-MEDIAPIPE.txt`), their sources and their SHA-256 sums are listed in `glance/THIRD_PARTY.md`, including why 0.10.35 is used (it is the last release that sends no usage metrics from the browser). The page's Content Security Policy allows only its own origin, so nothing loads from anywhere else. Publishing Shoo therefore needs Glance published beside it at `/games/glance/`.
- **IBM Plex Mono and Plex Sans**, by IBM, SIL Open Font License 1.1; see `fonts/OFL.txt`.

## Code adapted from Glance

Glance and Shoo are both by Luke Steuber. `gaze.js` is Glance's, copied unchanged apart from its name (the one-euro filter, look and hold, head and eye features, calibrations). `track.js` is Glance's camera module with the path to MediaPipe changed to Glance's folder. The camera prompt, calibration, rest area, the toolbar's Undo and Hint as look targets, the filling layout and the privacy behaviour in `shoo.js` follow Glance's page.

The six reward palettes are Mandaza's, as Luke Steuber's Loop uses them (`loop/loop.js`); Dichromat is built from the Okabe and Ito colour-blind-safe set.

The one-euro filter is after Géry Casiez, Nicolas Roussel and Daniel Vogel, "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems" (CHI 2012).
