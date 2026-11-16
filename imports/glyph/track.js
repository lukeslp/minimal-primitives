/* Glyph · the camera. By Luke Steuber.
   Adapted from Glance (glance/track.js). The front camera's frames go
   straight from the video element into MediaPipe's Face Landmarker, all on
   this device; only the landmarks come out, and no frame is kept, drawn or
   sent. MediaPipe and its model are not copied into this folder: they load,
   same origin, from the published Glance folder beside it (../glance/vendor/),
   the first time the camera starts and never before.
   Its body is generated from tools/input/track.js by tools/sync-gaze.py;
   edit that file, never this one. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CameraTrack = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Where MediaPipe may be, in order: Glance's published folder beside the
  // game on the same site (Glance's own ./vendor/ is the same folder), then a
  // copy beside the game, for a site with no Glance (playnotan.com).
  const BASES = ['../glance/vendor/', './vendor/'];
  const MODEL = 'face_landmarker.task';

  // The first base that answers for the model file. `fetch` is given so tests
  // can stand in for the network.
  async function findBase(bases, fetcher) {
    for (const base of bases) {
      try { const r = await fetcher(base + MODEL, { method: 'HEAD' }); if (r && r.ok) return base; } catch (_) {}
    }
    const error = Error('The camera files are not on this site'); error.code = 'vendor-missing'; throw error;
  }

  function create({ video, bases = BASES, fetcher = (...a) => fetch(...a), importer = url => import(url), doc = typeof document === 'object' ? document : null, clock = () => performance.now(), frame = f => requestAnimationFrame(f), cancel = h => cancelAnimationFrame(h), media = () => typeof navigator === 'object' && navigator.mediaDevices } = {}) {
    let landmarker = null, loading = null, stream = null, running = false, handle = 0, last = -1, delegate = null, generation = 0, base = null, lastError = null;
    // Loaded once and kept: GPU first, the CPU when the GPU path is not offered.
    function load() {
      if (!loading) loading = (async () => {
        base = await findBase(bases, fetcher);
        const vision = await importer(base + 'vision_bundle.mjs');
        const files = { wasmLoaderPath: base + 'vision_wasm_internal.js', wasmBinaryPath: base + 'vision_wasm_internal.wasm' };
        const options = d => ({ baseOptions: { modelAssetPath: base + MODEL, delegate: d }, runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false });
        try { landmarker = await vision.FaceLandmarker.createFromOptions(files, options('GPU')); delegate = 'GPU'; }
        catch (_) { landmarker = await vision.FaceLandmarker.createFromOptions(files, options('CPU')); delegate = 'CPU'; }
        return landmarker;
      })().catch(error => { loading = null; lastError = error; throw error; });
      return loading;
    }
    function release() {
      if (handle) { cancel(handle); handle = 0; }
      if (stream) for (const track of stream.getTracks()) track.stop();
      stream = null; video.srcObject = null; seen = -1;
    }
    // The video is never shown, so frames are taken on the page's own frame
    // clock rather than the video's: at most about thirty readings a second,
    // each of a new camera frame, stamped with the page clock.
    let seen = -1, fails = 0, moved = 0;
    // A camera that ends (unplugged, permission taken back, another app took
    // it), a detector that keeps failing, or frames that stop coming: the
    // camera is let go and the page told, so play can go on another way. The
    // detector's last error is kept for status(), not swallowed.
    function lose(reason) {
      if (!running && !stream) return;
      generation++; running = false; release(); fails = 0; moved = 0;
      api.onStream && api.onStream(false); api.onLost && api.onLost(reason);
    }
    function schedule() { if (running) handle = frame(tick); }
    function tick() {
      handle = 0;
      if (!running) return;
      const now = clock();
      if (video.readyState >= 2 && now - last >= 30 && video.currentTime !== seen) {
        last = now; seen = video.currentTime;
        let result = null;
        try { result = landmarker.detectForVideo(video, now); fails = 0; } catch (error) { result = null; fails++; lastError = error; }
        if (fails >= 30) { lose('detector'); return; }
        if (result && api.onResult) api.onResult(result, now);
        moved = now;
      } else if (video.readyState >= 2 && moved && now - moved > 5000) { lose('stalled'); return; }
      schedule();
    }
    const stopped = () => Error('Stopped');
    const api = {
      onResult: null, onStream: null, onLost: null,
      // Ask for the camera, then load the landmarker; either refusal throws.
      // A page hidden while the camera starts lets it go at once.
      async start() {
        if (running || stream) return;
        const mine = ++generation;
        const md = media();
        if (!md || !md.getUserMedia) throw Error('No camera');
        const s = await md.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
        if (mine !== generation || (doc && doc.hidden)) { for (const track of s.getTracks()) track.stop(); if (mine === generation) generation++; throw stopped(); }
        stream = s; video.srcObject = s; api.onStream && api.onStream(true);
        for (const track of s.getVideoTracks()) track.addEventListener('ended', () => { if (stream === s) lose('ended'); });
        try {
          await video.play();
          await load();
        } catch (error) { if (mine === generation) { release(); api.onStream && api.onStream(false); } throw error; }
        if (mine !== generation) throw stopped();
        if (doc && doc.hidden) { generation++; release(); api.onStream && api.onStream(false); throw stopped(); }
        running = true; last = -1; fails = 0; moved = clock(); schedule();
      },
      stop() { generation++; running = false; const had = !!stream; release(); if (had) api.onStream && api.onStream(false); },
      get running() { return running; },
      aspect() { return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3; },
      status() { return { running, live: stream ? stream.getVideoTracks().filter(t => t.readyState === 'live').length : 0, loaded: !!landmarker, delegate, base, error: lastError ? String(lastError.message || lastError) : null }; }
    };
    return api;
  }
  return { create, findBase, BASES };
});
(function () {
  const here = document.currentScript ? document.currentScript.src : document.baseURI;
  window.GlyphTrack = CameraTrack.create({ video: document.getElementById('camera'), bases: CameraTrack.BASES.map(b => new URL(b, here).href) });
})();
