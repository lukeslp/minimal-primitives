# Local dependencies

Nod makes no request to any other origin.

- **MediaPipe Tasks Vision 0.10.35** and the **MediaPipe Face Landmarker model** (float16, version 1), by Google, Apache License 2.0. Not copied into this folder: Nod loads Glance's unmodified copies from `../glance/vendor/` on the same origin (`vision_bundle.mjs`, `vision_wasm_internal.js`, `vision_wasm_internal.wasm` and `face_landmarker.task`), and only after the player chooses the camera. Their sources, licence file (`glance/vendor/LICENSE-MEDIAPIPE.txt`), SHA-256 sums and the reason for this version (the last release that sends no usage metrics from the browser) are in `glance/THIRD_PARTY.md`. The runtime manifest names this one reference so the release checks accept it.
- **IBM Plex Mono and Plex Sans**, SIL Open Font License 1.1; see `fonts/OFL.txt`.

`engine.js`, `levels.js` and `development/` are Tilt's files, by the same author, copied byte for byte. `gaze.js` and `track.js` are adapted from Glance's, by the same author.
