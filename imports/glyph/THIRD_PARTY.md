# Local dependencies

Glyph runs entirely in the page and makes no request to another origin. The camera files are fetched only after the player chooses the camera.

- **MediaPipe Tasks Vision 0.10.35 and the Face Landmarker model**, by Google, Apache License 2.0. Not copied into this folder: `track.js` loads them, same origin, from the published Glance folder beside it (`../glance/vendor/`, served at `/games/glance/vendor/`), so the site carries one copy of the 15 MB of camera files rather than two. The files used are `vision_bundle.mjs`, `vision_wasm_internal.js`, `vision_wasm_internal.wasm` and `face_landmarker.task`, unmodified. Their licence is `glance/vendor/LICENSE-MEDIAPIPE.txt`, and `glance/THIRD_PARTY.md` gives their sources, SHA-256 sums and why 0.10.35 is used (the last release that sends no usage metrics). Glyph therefore needs Glance published beside it for the camera; without it the camera cannot start and play goes on by pointer.
- **IBM Plex Mono and Plex Sans**, SIL Open Font License 1.1; see `fonts/OFL.txt`.

`gaze.js` (the one-euro filter, look and hold, the features read from face landmarks and the calibrations) and `track.js` (the camera) come from Glance, by the same author, with only their names and the place the camera files load from changed.
