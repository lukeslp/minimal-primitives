# Local dependencies

Pursuit makes no request to any other origin. Its own files are in this folder; the camera's files are Glance's, published beside it, and are fetched only after the player chooses the camera.

- **MediaPipe Tasks Vision 0.10.35** (`@mediapipe/tasks-vision` on npm) and the **MediaPipe Face Landmarker model** `face_landmarker.task` (float16, version 1), by Google, Apache License 2.0. Pursuit does not carry a copy: `track.js` loads `../glance/vendor/vision_bundle.mjs`, `vision_wasm_internal.js`, `vision_wasm_internal.wasm` and `face_landmarker.task` from the Glance folder on the same origin, unmodified. Their sources, SHA-256 sums, the licence (`glance/vendor/LICENSE-MEDIAPIPE.txt`) and the reason for version 0.10.35 (the last release that sends no usage metrics from the browser) are recorded in `glance/THIRD_PARTY.md`. Pursuit asks the landmarker for face landmarks and the facial transformation matrix only.
- **`gaze.js` and `track.js`** are adapted from Glance's files of the same names (Luke Steuber): the one-euro filter, look and hold, the face features, the five-dot calibrations and the camera loop. Pursuit adds the tuning check and loads the vendored files from Glance's folder.
- **IBM Plex Mono and Plex Sans**, SIL Open Font License 1.1; see `fonts/OFL.txt`.

If Pursuit is ever published without Glance beside it, the camera cannot start and play goes on by pointer, as it does when a camera is refused.
