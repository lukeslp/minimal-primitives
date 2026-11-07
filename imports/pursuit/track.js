/* Pursuit · the camera. By Luke Steuber. Adapted from Glance's track.js.
   The front camera's frames go straight from the video element into
   MediaPipe's Face Landmarker, all on this device; only the landmarks come
   out, and no frame is kept, drawn or sent. MediaPipe and its model are the
   files Glance already publishes beside this game, loaded from ../glance/vendor/
   on this same origin the first time the camera starts, never before. */
(function () {
  'use strict';
  const base = new URL('../glance/vendor/', document.currentScript ? document.currentScript.src : document.baseURI).href;
  const video = document.getElementById('camera');
  let landmarker = null, loading = null, stream = null, running = false, handle = 0, last = -1, delegate = null, generation = 0;
  // Loaded once and kept: GPU first, the CPU when the GPU path is not offered.
  function load() {
    if (!loading) loading = (async () => {
      const vision = await import('../glance/vendor/vision_bundle.mjs');
      const files = { wasmLoaderPath: base + 'vision_wasm_internal.js', wasmBinaryPath: base + 'vision_wasm_internal.wasm' };
      const options = d => ({ baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate: d }, runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false });
      try { landmarker = await vision.FaceLandmarker.createFromOptions(files, options('GPU')); delegate = 'GPU'; }
      catch (_) { landmarker = await vision.FaceLandmarker.createFromOptions(files, options('CPU')); delegate = 'CPU'; }
      return landmarker;
    })().catch(error => { loading = null; throw error; });
    return loading;
  }
  function release() {
    if (handle) { cancelAnimationFrame(handle); handle = 0; }
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null; video.srcObject = null; seen = -1;
  }
  // The video is never shown, so frames are taken on the page's own frame
  // clock rather than the video's: at most about thirty readings a second,
  // each of a new camera frame, stamped with the page clock.
  let seen = -1, fails = 0, moved = 0;
  // A camera that ends (unplugged, permission taken back, another app took
  // it), a detector that keeps failing, or frames that stop coming: the camera
  // is let go and the page told, so play can go on another way.
  function lose(reason) {
    if (!running && !stream) return;
    generation++; running = false; release(); fails = 0; moved = 0;
    api.onStream && api.onStream(false); api.onLost && api.onLost(reason);
  }
  function schedule() { if (running) handle = requestAnimationFrame(tick); }
  function tick() {
    handle = 0;
    if (!running) return;
    const now = performance.now();
    if (video.readyState >= 2 && now - last >= 30 && video.currentTime !== seen) {
      last = now; seen = video.currentTime;
      let result = null;
      try { result = landmarker.detectForVideo(video, now); fails = 0; } catch (_) { result = null; fails++; }
      if (fails >= 30) { lose('detector'); return; }
      if (result && api.onResult) api.onResult(result, now);
      moved = now;
    } else if (video.readyState >= 2 && moved && now - moved > 5000) { lose('stalled'); return; }
    schedule();
  }
  const api = {
    onResult: null, onStream: null, onLost: null,
    // Ask for the camera, then load the landmarker; either refusal throws.
    async start() {
      if (running || stream) return;
      const mine = ++generation;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Error('No camera');
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
      if (mine !== generation) { for (const track of s.getTracks()) track.stop(); throw Error('Stopped'); }
      stream = s; video.srcObject = s; api.onStream && api.onStream(true);
      for (const track of s.getVideoTracks()) track.addEventListener('ended', () => { if (stream === s) lose('ended'); });
      try {
        await video.play();
        await load();
      } catch (error) { if (mine === generation) { release(); api.onStream && api.onStream(false); } throw error; }
      if (mine !== generation) throw Error('Stopped');
      running = true; last = -1; fails = 0; moved = performance.now(); schedule();
    },
    stop() { generation++; running = false; const had = !!stream; release(); if (had) api.onStream && api.onStream(false); },
    get running() { return running; },
    aspect() { return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3; },
    status() { return { running, live: stream ? stream.getVideoTracks().filter(t => t.readyState === 'live').length : 0, loaded: !!landmarker, delegate }; }
  };
  window.PursuitTrack = api;
})();
