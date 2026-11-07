# Local dependencies

Everything Glance runs is in this folder. Nothing loads from another origin, and the camera files are fetched only after the player chooses the camera.

- **MediaPipe Tasks Vision 0.10.35** (`@mediapipe/tasks-vision` on npm), by Google, Apache License 2.0. Three unmodified files from the package, enough for the Face Landmarker: the ES module `vision_bundle.mjs` and the SIMD WebAssembly build, `vision_wasm_internal.js` with `vision_wasm_internal.wasm`. The licence is `vendor/LICENSE-MEDIAPIPE.txt`, the MediaPipe repository's LICENSE at tag v0.10.35 (the npm package carries no licence file of its own).
- **MediaPipe Face Landmarker model** `face_landmarker.task` (float16, version 1), by Google, Apache License 2.0 as stated on its model cards. Unmodified. It bundles the BlazeFace short-range face detector, the Face Mesh V2 landmark model and the Blendshape V2 model; Glance asks for landmarks and the facial transformation matrix only.
- **IBM Plex Mono and Plex Sans**, SIL Open Font License 1.1; see `fonts/OFL.txt`.

## Why 0.10.35

The newest stable release at least two weeks old on October 16, 2026 was 1.0.1 (July 31, 2026). Releases from 1.0.0 on send usage metrics from the browser to `odml.pa.googleapis.com`, as their README's privacy notice says. Version 0.10.35 (April 27, 2026) is the last release without that code, so no request of any kind leaves the page; the page's Content Security Policy would refuse one anyway (`connect-src 'self'`).

Only the SIMD build of the WebAssembly is included. A browser without WebAssembly SIMD cannot start the camera and plays on by pointer.

## Sources and checksums

| File | Source | SHA-256 |
|---|---|---|
| npm tarball | https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz (npm integrity `sha512-HOvadwVRE6JC+45nyYhmnywnr5h/J8KZvOeUNVOG9q/0875pZgItznFB9bRTvLc264YSJqiZ1NsIpCStJw/egg==`, matched) | `84597a25e13d123b5f4cbe768bb72e97a2c28c7a465f0ace287d8cbe5246bff0` |
| `vendor/vision_bundle.mjs` | `package/vision_bundle.mjs` in the tarball | `55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe` |
| `vendor/vision_wasm_internal.js` | `package/wasm/vision_wasm_internal.js` | `e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c` |
| `vendor/vision_wasm_internal.wasm` | `package/wasm/vision_wasm_internal.wasm` | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| `vendor/face_landmarker.task` | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task (storage MD5 `sOcnSQehZEQE/vZrKN1thQ==`, matched) | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `vendor/LICENSE-MEDIAPIPE.txt` | https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.35/LICENSE | `8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8` |

Model cards, each stating Apache License 2.0:

- https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf

`vision_bundle.mjs` ends with a source-map comment naming a map that is not shipped. Browsers read it only with developer tools open, and nothing in play requests it.

Upstream: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js and https://github.com/google-ai-edge/mediapipe
