/* Gaze core: reading a face and turning a look into a choice. By Luke Steuber.
   The one copy of the gaze math every game uses: the camera games' gaze.js
   files and Look and hold in the shared control frame are generated from this
   file by tools/sync-gaze.py and tools/apply-control-frame.py (never edit
   those copies). Pure: a one-euro filter, the look-and-hold machine, the
   features read from MediaPipe's face landmarks, and the calibrations that
   turn them into a point on the page. No camera, page or clock lives here;
   every call is given its time. The landmark math follows
   gravitational-lens-tracker's lib/gaze and gazenav's irisOffset: each eye is
   measured inside its own socket, from the corners, in units of its width. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GazeCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // The one-euro filter (Casiez, Roussel and Vogel, 2012): smooth at rest,
  // quick when the point moves fast. Times in milliseconds.
  function oneEuro({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    let x = null, dx = 0, last = null;
    const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    return {
      filter(value, t) {
        if (x === null || last === null || t <= last) { if (x === null) x = value; last = t; return x; }
        const dt = Math.min(.25, (t - last) / 1000); last = t;
        const raw = (value - x) / dt; dx += alpha(dCutoff, dt) * (raw - dx);
        x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
        return x;
      },
      reset() { x = null; dx = 0; last = null; }
    };
  }
  // Look and hold. `targets(x, y)` names what lies under a point (or null in
  // the rest area); `holds(target, x, y)` says whether a point still counts
  // as on a target, its own area grown by the dead zone. A ring fills while
  // the point stays on its target and drains when it leaves; a full ring
  // fires once, and that target cannot fire again until the point has left
  // it. A short loss of the face changes nothing; a longer one is looking away.
  function dwell({ time = 800, drain = 400, lost = 300, targets, holds }) {
    let current = null, blocked = null, last = null, missing = null;
    const progress = new Map();
    function sample(t, x, y) {
      const dt = last === null ? 0 : clamp(t - last, 0, 120), fired = [];
      last = t;
      if (x === null || x === undefined) {
        if (missing === null) missing = t;
        if (t - missing < lost) return fired;
        current = null; blocked = null;
      } else {
        missing = null;
        current = current && holds(current, x, y) ? current : targets(x, y);
        if (blocked !== null && (!current || current.id !== blocked)) blocked = null;
      }
      const live = current && current.id !== blocked ? current.id : null;
      for (const [id, p] of progress) if (id !== live) { const q = p - dt / drain; if (q <= 0) progress.delete(id); else progress.set(id, q); }
      if (live !== null) {
        const p = (progress.get(live) || 0) + dt / time;
        if (p >= 1) { progress.delete(live); blocked = live; fired.push(current); }
        else progress.set(live, p);
      }
      return fired;
    }
    return {
      sample,
      get current() { return current; }, get blocked() { return blocked; },
      progress: id => progress.get(id) || 0,
      rings: () => [...progress],
      set time(v) { time = v; },
      // Treat the point as already resting on this target, fired: it must
      // leave before the target can fill. Used after calibration and a new board.
      hold(target) { current = target || null; blocked = target ? target.id : null; },
      // A board change or a mode switch starts every ring afresh; the target
      // under the point stays blocked so a held look does not fire on what replaced it.
      reset(keepBlock = false) { progress.clear(); if (!keepBlock) { blocked = null; current = null; } else if (current) blocked = current.id; last = null; missing = null; }
    };
  }
  // Landmark indices in MediaPipe's 478-point face mesh.
  const MESH = { nose: 1, forehead: 10, chin: 152, cheekR: 234, cheekL: 454, mouthTop: 13, mouthBottom: 14,
    eyeR: { a: 33, b: 133, up: 159, down: 145, iris: 468 }, eyeL: { a: 362, b: 263, up: 386, down: 374, iris: 473 } };
  // Head yaw and pitch in radians. From the facial transformation matrix
  // (column-major, as MediaPipe gives it): the face's forward axis is its
  // third column. Without a matrix, from the nose against the cheeks and
  // brow, which gives the same signs in image terms.
  function headPose(landmarks, matrix, aspect = 4 / 3) {
    if (matrix && matrix.data && matrix.data.length === 16) {
      const m = matrix.data, fx = m[8], fy = m[9], fz = m[10];
      return { yaw: Math.atan2(fx, fz), pitch: Math.atan2(fy, Math.hypot(fx, fz)) };
    }
    return landmarkPose(landmarks, aspect);
  }
  const P = (lm, i, aspect) => ({ x: lm[i].x * aspect, y: lm[i].y });
  // On a real face looking straight ahead the nose tip sits about 57.5 percent
  // of the way from the brow landmark to the chin, so a still head reads as a
  // 5 to 18 degree nod (the Eye Gaze review). Every use here is relative to a
  // calibrated rest, which takes that offset out, and the asin's slope 18
  // degrees off level differs by under 5 percent, so the reading stays halfway
  // (NOSE_REST): moving it would change every saved eyes calibration for no
  // gain in play.
  const NOSE_REST = .5;
  function landmarkPose(lm, aspect = 4 / 3) {
    const n = P(lm, MESH.nose, aspect), r = P(lm, MESH.cheekR, aspect), l = P(lm, MESH.cheekL, aspect), top = P(lm, MESH.forehead, aspect), chin = P(lm, MESH.chin, aspect);
    const width = Math.hypot(l.x - r.x, l.y - r.y) || 1, height = Math.hypot(chin.x - top.x, chin.y - top.y) || 1;
    return { yaw: Math.asin(clamp((n.x - (l.x + r.x) / 2) / (width * .5), -1, 1)), pitch: Math.asin(clamp((n.y - (top.y + (chin.y - top.y) * NOSE_REST)) / (height * .5), -1, 1)) };
  }
  // Where the irises sit in the eyes, as a fraction of eye width, averaged
  // over both eyes and measured along each eye's own corner line, so a tilted
  // head does not read as a look sideways. Up and down are measured from the
  // corners' midpoint, which stays put, not from the lids, which follow the
  // iris up and down and so hid most of the eyes' vertical movement (as
  // gazenav's irisOffset found).
  // An eye whose iris reads further than this from its socket's centre (in
  // eye widths) is a detection gone wrong, often a half blink; it is left out
  // rather than trusted, and with both out the look is the head's alone.
  const IMPLAUSIBLE = .8;
  function irisOffset(lm, aspect = 4 / 3) {
    let ex = 0, ey = 0, used = 0;
    for (const e of [MESH.eyeR, MESH.eyeL]) {
      const a = P(lm, e.a, aspect), b = P(lm, e.b, aspect), iris = P(lm, e.iris, aspect);
      const w = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / w, uy = (b.y - a.y) / w;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const x = ((iris.x - mid.x) * ux + (iris.y - mid.y) * uy) / w, y = ((iris.x - mid.x) * -uy + (iris.y - mid.y) * ux) / w;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > IMPLAUSIBLE || Math.abs(y) > IMPLAUSIBLE) continue;
      ex += x; ey += y; used++;
    }
    return used ? { ex: ex / used, ey: ey / used, used } : { ex: 0, ey: 0, used: 0 };
  }
  // The look: head turn plus the eyes' turn within the head, both in image
  // terms and roughly in radians. The nose tip stands about a third of a face
  // width proud of the cheeks; the iris moves about two fifths of an eye width
  // per radian.
  function lookAngles(lm, aspect = 4 / 3) {
    const h = landmarkPose(lm, aspect), e = irisOffset(lm, aspect);
    return { ax: Math.sin(h.yaw) * .5 / .35 + e.ex / .4, ay: Math.sin(h.pitch) * .5 / .35 + e.ey / .4 };
  }
  // The five calibration places, in page units: -1 to 1 across the reach of
  // the page inside its edge band, left to right and top to bottom.
  const SPOTS = [{ u: 0, v: 0 }, { u: -.8, v: 0 }, { u: .8, v: 0 }, { u: 0, v: -.8 }, { u: 0, v: .8 }];
  // Head: the centre sets the resting pose, each edge the comfortable turn
  // that way; between them the page follows the turn in proportion. A side
  // turned too little to measure borrows the other side's reach.
  function headCalibration(poses) {
    const [c, l, r, t, b] = poses, min = .035;
    const side = (lo, hi, key) => {
      let a = lo[key] - c[key], z = hi[key] - c[key];
      if (Math.abs(a) < min && Math.abs(z) < min) return null;
      if (Math.abs(a) < min || Math.sign(a) === Math.sign(z)) a = -z;
      if (Math.abs(z) < min) z = -a;
      return { lo: a, hi: z };
    };
    const yaw = side(l, r, 'yaw'), pitch = side(t, b, 'pitch');
    if (!yaw || !pitch) return null;
    return { kind: 'head', centre: { yaw: c.yaw, pitch: c.pitch }, yaw, pitch };
  }
  // Up and down must not be far touchier than left and right. Most people
  // reach the top and bottom dots with their eyes and barely nod, so the
  // nod a calibration measures can be tiny, and mapped as it stands it made a
  // degree of head move the dot many times further up and down than across.
  // So the reach up and down is kept to at least the reach across over
  // BALANCE: a degree moves the dot at most BALANCE times as far across the
  // page's height as across its width. `invertY` flips up and down for a
  // player who wants it the other way.
  const BALANCE = 2;
  function balance(own, other) { const floor = Math.abs(other) / BALANCE; return Math.sign(own) * Math.max(Math.abs(own), floor) || floor; }
  function headMap(cal, pose, { invertY = false } = {}) {
    const along = (d, s) => .8 * (d * s.hi > 0 ? d / s.hi : -d / s.lo);
    const across = Math.min(Math.abs(cal.yaw.lo), Math.abs(cal.yaw.hi)), p = { lo: balance(cal.pitch.lo, across), hi: balance(cal.pitch.hi, across) };
    const v = clamp(along(pose.pitch - cal.centre.pitch, p), -1.25, 1.25);
    return { u: clamp(along(pose.yaw - cal.centre.yaw, cal.yaw), -1.25, 1.25), v: invertY ? -v : v };
  }
  // Eyes: a straight line per axis from the look to the page, fitted to the
  // five places by least squares.
  function eyesCalibration(looks) {
    const fit = (xs, ys) => {
      const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
      let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
      if (sxx < 1e-6) return null;
      const k = sxy / sxx; return { k, b: my - k * mx };
    };
    const u = fit(looks.map(l => l.ax), SPOTS.map(s => s.u)), v = fit(looks.map(l => l.ay), SPOTS.map(s => s.v));
    if (!u || !v || Math.abs(u.k) < .2 || Math.abs(v.k) < .2) return null;
    return { kind: 'eyes', e: 2, u, v };
  }
  function eyesMap(cal, look, { invertY = false } = {}) {
    // A gain is page units per unit of look: the larger, the touchier.
    const most = Math.abs(cal.u.k) * BALANCE, kv = Math.abs(cal.v.k) > most ? Math.sign(cal.v.k) * most : cal.v.k;
    // Turned about the look that lands mid-page, so the middle stays put.
    const v = clamp(kv * (look.ay + cal.v.b / cal.v.k), -1.25, 1.25);
    return { u: clamp(cal.u.b + cal.u.k * look.ax, -1.25, 1.25), v: invertY ? -v : v };
  }
  // A fresh start keeps the reach and moves only the rest to where the
  // player sits now.
  function recentre(cal, rest) {
    if (cal.kind === 'head') return { ...cal, centre: { yaw: rest.yaw, pitch: rest.pitch } };
    return { ...cal, u: { k: cal.u.k, b: -cal.u.k * rest.ax }, v: { k: cal.v.k, b: -cal.v.k * rest.ay } };
  }
  // Holding still: every recent reading lies close to their mean.
  function stillness(window, keys, tolerance) {
    if (!window.length) return { still: false };
    const mean = Object.fromEntries(keys.map(k => [k, window.reduce((s, w) => s + w[k], 0) / window.length]));
    const spread = Math.max(...window.map(w => Math.max(...keys.map(k => Math.abs(w[k] - mean[k])))));
    return { still: spread <= tolerance, mean, spread };
  }
  // An eyes calibration made before the eyes' up and down were measured from
  // the corners (no `e: 2`) still loads, but asks for a full calibration
  // again; a head calibration is unchanged.
  const current = c => !!c && (c.kind !== 'eyes' || c.e === 2);
  function validCalibration(c) {
    const num = v => typeof v === 'number' && Number.isFinite(v);
    if (!c || typeof c !== 'object') return false;
    if (c.kind === 'head') return num(c.centre?.yaw) && num(c.centre?.pitch) && ['yaw', 'pitch'].every(k => num(c[k]?.lo) && num(c[k]?.hi) && c[k].lo * c[k].hi < 0);
    if (c.kind === 'eyes') return ['u', 'v'].every(k => num(c[k]?.k) && num(c[k]?.b) && Math.abs(c[k].k) >= .2);
    // An eye tracker's one-dot correction for the window's place on the screen.
    if (c.kind === 'tracker') return num(c.dx) && num(c.dy);
    return false;
  }
  return { clamp, oneEuro, dwell, MESH, headPose, landmarkPose, irisOffset, lookAngles, SPOTS, headCalibration, headMap, eyesCalibration, eyesMap, recentre, stillness, validCalibration, current };
});

/* Minimal Access: one switch, or look and hold, for every game in the shared
   control frame. The frame (controls.js) loads this file the first time a
   player turns Access on in Settings. A pad of the game's own keys stands in
   the rest area beside the board, never over it, the toolbar or the Next
   disc, and sends each key to the game as a key press; the toolbar's own Undo
   and Hint and the Next disc stay where they are and join in. Look and hold
   is Glance's: its one-euro filter, dwell ring, dead zone, re-arm rule,
   wordless calibration and edge band (glance/gaze.js), and its camera
   (glance/track.js), with the MediaPipe files loaded from Glance's published
   vendor folder the first time the camera starts. Camera frames stay in the
   page; only landmarks come out. The gaze math comes from the gaze core,
   tools/input/gaze-core.js, placed ahead of this file when it is copied into
   a game. Luke Steuber. */
(function () {
  'use strict';
  if (window.MinimalAccessEngine) return;
  const STYLE = `body[data-access] {--access-ink:var(--ink,CanvasText);--access-paper:var(--bg,var(--paper,Canvas));}
body[data-control-frame] .access-pad {position:fixed;inset:0;pointer-events:none;z-index:58;}
body[data-control-frame] .access-pad[hidden],body[data-control-frame] .access-key[hidden] {display:none;}
/* A key is a hairline ring with the game's own icon; the highlight inverts it
   by lightness alone, as the Next disc does, so it reads without colour. */
body[data-control-frame] .access-key {
  position:absolute;box-sizing:border-box;display:grid;place-items:center;border-radius:50%;border:1px solid var(--access-ink);
  background:var(--access-paper);color:var(--access-ink);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;
}
body[data-control-frame] .access-key svg {width:42%;height:42%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;overflow:visible;}
body[data-control-frame] .access-key[data-off="true"] {opacity:.3;}
body[data-control-frame] .access-key[data-scan] {background:var(--access-ink);color:var(--access-paper);}
/* The toolbar's own Undo and Hint and the Next disc are lit where they stand:
   a solid ring for the lit one, a dashed ring for each of a lit group. */
body[data-access] [data-access-scan] {outline:3px solid var(--access-ink)!important;outline-offset:3px!important;border-radius:50%!important;}
body[data-access] [data-access-scan-group] {outline:2px dashed var(--access-ink)!important;outline-offset:3px!important;border-radius:50%!important;}
/* While choosing is by look and hold, the toolbar's own Undo and Hint grow
   to a sixth of the short side, at least 64 px, in a hairline circle, as in Glance. */
body[data-access="look"] .control-toolbar .access-tool {width:var(--access-tool)!important;height:var(--access-tool)!important;min-width:var(--access-tool)!important;min-height:var(--access-tool)!important;padding:0!important;border:1px solid var(--line,currentColor)!important;border-radius:50%!important;background-clip:padding-box;box-sizing:border-box;}
body[data-access="look"] .control-toolbar .access-tool svg {width:calc(var(--access-tool) * .42)!important;height:calc(var(--access-tool) * .42)!important;}
@media(max-height:520px) and (min-width:560px) {body[data-access="look"] .control-toolbar {width:var(--access-tool)!important;}}
body[data-control-frame] .access-key[data-access-sent] {animation:access-sent .18s ease-out;}
@keyframes access-sent {from {scale:.86} to {scale:1}}
html[data-motion="reduce"] body[data-control-frame] .access-key[data-access-sent],html[data-motion="still"] body[data-control-frame] .access-key[data-access-sent] {animation:none;}
@media(prefers-reduced-motion:reduce) {body[data-control-frame] .access-key[data-access-sent] {animation:none;}}
body[data-control-frame] .access-layer {position:fixed;inset:0;width:100vw;height:100dvh;pointer-events:none;z-index:59;overflow:visible;}
body:not([data-access]) .access-layer {display:none;}
.access-layer .a-track {fill:none;stroke:var(--access-paper);stroke-width:7;opacity:.9;}
.access-layer .a-arc {fill:none;stroke:var(--access-ink);stroke-width:3;}
.access-layer .a-halo {fill:var(--access-ink);opacity:.1;}
.access-layer .a-core {fill:var(--access-paper);stroke:var(--access-ink);stroke-width:1.5;}
.access-layer .a-spot {fill:var(--access-ink);}
.access-layer .a-spot-halo {fill:var(--access-paper);}
body[data-control-frame] .access-status {position:fixed;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
body[data-control-frame] .access-live {position:fixed;top:max(18px,calc(env(safe-area-inset-top) + 18px));left:max(64px,calc(env(safe-area-inset-left) + 64px));width:12px;height:12px;box-sizing:border-box;border:1.5px solid var(--access-ink);border-radius:50%;background:var(--access-ink);box-shadow:0 0 0 3px var(--access-paper);z-index:61;pointer-events:none;}
body[data-control-frame] .access-live[data-face="none"] {background:transparent;}
body[data-control-frame] .access-live[hidden] {display:none;}
body[data-control-frame] .access-video {position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;}
body[data-control-frame] .access-probe {position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);}
body[data-access-highlight="outline"] .access-key[data-scan] {background:var(--access-paper);color:var(--access-ink);}
body[data-access-highlight="outline"] .access-key[data-scan] {outline:3px solid var(--access-ink);outline-offset:3px;}
body[data-control-frame] .access-key[data-key="rest"][data-on] {background:var(--access-ink);color:var(--access-paper);opacity:1;}
.access-layer .a-line {stroke:var(--access-ink);stroke-width:2;}
.access-layer .a-line-halo {stroke:var(--access-paper);stroke-width:6;opacity:.85;}
.access-layer .a-cross[data-slow="true"] .a-line {stroke-dasharray:6 4;}
.access-layer .a-from {fill:var(--access-ink);stroke:var(--access-paper);stroke-width:2;}
.access-layer .a-mark {fill:none;stroke:var(--access-ink);stroke-width:2;animation:access-mark .45s ease-out both;}
@keyframes access-mark {from {opacity:1;r:6px} to {opacity:0;r:22px}}
html[data-motion="reduce"] .access-layer .a-mark,html[data-motion="still"] .access-layer .a-mark {animation:none;}
@media(prefers-reduced-motion:reduce) {.access-layer .a-mark {animation:none;}}
/* A lit group is ringed; the lit key itself is inverted (or ringed, with the dashed group ring, in Outline). */
body[data-control-frame] .access-key[data-scan-group] {background:var(--access-paper);color:var(--access-ink);outline:3px solid var(--access-ink);outline-offset:3px;}
body[data-access-highlight="outline"] .access-key[data-scan-group] {outline:2px dashed var(--access-ink);}
body[data-control-frame] .access-zoom {position:fixed;box-sizing:border-box;border:1px solid var(--access-ink);background:var(--access-paper);pointer-events:auto;z-index:1;}
body[data-control-frame] .access-zoom[hidden] {display:none;}
body[data-control-frame] .access-zoom .access-key[data-from] {outline:3px solid var(--access-ink);outline-offset:3px;}`;
  // The gaze math is the gaze core's (tools/input/gaze-core.js), which
  // apply-control-frame.py places ahead of this file in each game's access.js:
  // the same filter, look and hold, landmark reading and calibration as the
  // camera games, from one copy.
  const {clamp,oneEuro,dwell:lookAndHold,SPOTS,headPose,lookAngles,headCalibration,headMap,eyesCalibration,eyesMap,current,recentre,stillness,validCalibration}=window.GazeCore;

  window.MinimalAccessEngine = function (A) {
    const {config,prefs,save,paintRows,completionNodes,nexts,spot,here,SPEEDS}=A,place=A.place||(()=>{});
    // Exact timings a clinician set in the accessible app (minimal-access.v1:exact),
    // each held to its range; where one is missing or out of range the game's
    // own choice stands. Read live, so a change takes effect at once.
    const RANGE={holdMs:[300,5000],scanMs:[400,4000],pressMs:[0,2000],releaseMs:[0,3000],longMs:[0,4000],rest:[0,20]};
    const exact=k=>{let e=null;try{e=A.exact&&A.exact();}catch(_){}const v=e&&e[k],r=RANGE[k];return typeof v==='number'&&Number.isFinite(v)&&v>=r[0]&&v<=r[1]?v:null;};
    const T={get hold(){return exact('holdMs')??prefs.hold;},get scan(){return exact('scanMs')??(SPEEDS[prefs.speed]||1100);},get press(){return exact('pressMs')??prefs.press;},
      get release(){return exact('releaseMs')??prefs.release;},get long(){return exact('longMs')??prefs.long;},get rest(){return exact('rest')??prefs.rest;}};
    const byId=id=>id&&document.getElementById(id),CAL='minimal-access.v1:calibration';
    // A calibration is shared by every game: it is about the player, not the board.
    const calibration={head:null,eyes:null,tracker:null};
    try{const c=JSON.parse(localStorage.getItem(CAL)||'null');if(c)for(const k of ['head','eyes','tracker'])if(validCalibration(c[k])&&c[k].kind===k)calibration[k]=c[k];}catch(_){}
    if(!document.getElementById('access-style')){const st=document.createElement('style');st.id='access-style';st.textContent=STYLE;document.head.append(st);}
    const NS='http://www.w3.org/2000/svg',html=document.documentElement,body=document.body;
    const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
    const reduced=()=>['reduce','reduced','still'].includes(html.dataset.motion)||motionQuery.matches;
    const rail=()=>matchMedia('(max-height:520px) and (min-width:560px)').matches;
    const dialogOpen=()=>!!document.querySelector('dialog[open],.modal-overlay.open');
    const visible=n=>!!n&&n.isConnected&&!n.hidden&&(n.checkVisibility?n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):n.getClientRects().length>0);
    const usable=b=>visible(b)&&!b.disabled;
    // The frame's own controls and the sheets keep their pointer roles.
    const exempt=n=>!!(n&&n.closest&&n.closest('.control-toolbar,.control-restart,.control-completion,dialog,[role="dialog"],button#readout'));
    const outside=n=>exempt(n)||!!(n&&n.closest&&n.closest('.access-pad'));
    const ICON={home:'<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5"/>',up:'<path d="M12 19V5M6 11l6-6 6 6"/>',right:'<path d="M5 12h14M13 6l6 6-6 6"/>',down:'<path d="M12 5v14M6 13l6 6 6-6"/>',left:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
      select:'<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',back:'<circle cx="12" cy="12" r="5"/>',tab:'<path d="M4 12h11M11 7l5 5-5 5M20 5v14"/>',
      undo:'<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',hint:'<path d="M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z"/>',next:'<path d="M5 12h14M13 6l6 6-6 6"/>',
      diamond:'<path d="M12 4l8 8-8 8-8-8Z"/>',mark:'<path d="M7 7l10 10M17 7 7 17"/>',size1:'<circle cx="12" cy="12" r="3"/>',size2:'<circle cx="12" cy="12" r="5.5"/>',size3:'<circle cx="12" cy="12" r="8.5"/>',
      camera:'<path d="M3 8h4l2-3h6l2 3h4v11H3ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/>',point:'<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
      drag:'<circle cx="6" cy="18" r="2" fill="currentColor" stroke="none"/><path d="M8 16 19 5M12 5h7v7"/>',rest:'<path d="M9 6v12M15 6v12"/>',lift:'<path d="M12 15V5M8 9l4-4 4 4M6 19h12"/>',ring:'<path d="M18.5 9A7 7 0 1 0 19 12"/><path d="M15.5 8.5h3.2V5.3"/>',ringback:'<path d="M5.5 9A7 7 0 1 1 5 12"/><path d="M8.5 8.5H5.3V5.3"/>'};
    // The pad holds the game's own keys, from games.json: a name with its usual
    // key, or the name with the game's own key. Undo, Hint and Next are never
    // repeated on it: the toolbar's own Undo and Hint and the game's Next stay
    // where they stand, and the scan and the look use them there.
    const DEF={up:{key:'ArrowUp'},right:{key:'ArrowRight'},down:{key:'ArrowDown'},left:{key:'ArrowLeft'},select:{key:'Enter'},back:{key:'Enter',shift:true},
      tab:{tab:true},press:{key:' ',icon:'select'},point:{point:true},drag:{point:true,drag:true}};
    const keys=[];
    for(const e of config.keys){if(e==='arrows'){for(const id of ['up','right','down','left'])keys.push({id,icon:id,...DEF[id]});continue;}const o=typeof e==='string'?{id:e}:e;if(!['undo','hint','next'].includes(o.id))keys.push({icon:o.id,...DEF[o.id],...o});}
    const disc=nexts[0]||null,nextEl=disc||completionNodes.map(n=>(n.matches('button')?[n]:[...n.querySelectorAll('button')]).find(b=>/next/i.test(b.id))).find(Boolean)||null;
    // The game's own tools in the toolbar (config.tools: Mark, Flag, Replay) join
    // them where they stand, apart from any a game keeps out (config.unscanned,
    // as the camera games keep their camera button out).
    const toolIds=(config.tools||[]).filter(id=>!(config.unscanned||[]).includes(id));
    const bar=[['undo',byId(config.undo)],['hint',byId(config.hint)],...toolIds.map(id=>[id,byId(id)]),['next',nextEl]].filter(([,el])=>el).map(([id,el])=>({id,el,tool:!['undo','hint','next'].includes(id)}));
    const order=keys.concat(bar);
    const pad=document.createElement('div');pad.className='access-pad';pad.setAttribute('aria-hidden','true');pad.hidden=true;
    const node=(id,icon)=>{const n=document.createElement('div');n.className='access-key';n.dataset.key=id;n.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(ICON[icon]||ICON.select)+'</svg>';n.hidden=true;pad.append(n);return n;};
    for(const k of keys)k.node=node(k.id,k.icon);
    const camKey={id:'camera',camera:true};camKey.node=node('camera','camera');
    // Looking needs somewhere to rest: a pause key, the only one that still fills while resting.
    const restKey={id:'rest',rest:true,lookOnly:true};restKey.node=node('rest','rest');keys.push(restKey);order.push(restKey);
    // Inside the accessible app (?in=accessible, or a frame of the same origin) the
    // scan and the look reach Home too; choosing it tells the app.
    const inApp=(()=>{try{if(new URLSearchParams(location.search).get('in')==='accessible')return true;return window.parent!==window&&window.parent.location.origin===location.origin;}catch(_){return false;}})();
    if(inApp){const homeKey={id:'home',icon:'home',home:true};homeKey.node=node('home','home');keys.push(homeKey);order.push(homeKey);}
    let resting=false;
    const layer=document.createElementNS(NS,'svg');layer.setAttribute('class','access-layer');layer.setAttribute('aria-hidden','true');layer.setAttribute('focusable','false');layer.style.display='none';
    const status=document.createElement('p');status.className='access-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const liveDot=document.createElement('span');liveDot.className='access-live';liveDot.hidden=true;liveDot.setAttribute('role','img');liveDot.setAttribute('aria-label','Camera on');
    const probe=document.createElement('div');probe.className='access-probe';probe.setAttribute('aria-hidden','true');
    body.append(pad,layer,status,liveDot,probe);
    const say=text=>{status.textContent=text;};
    const svg=(tag,attrs,parent)=>{const n=document.createElementNS(NS,tag);for(const k in attrs)n.setAttribute(k,attrs[k]);if(parent)parent.append(n);return n;};
    let mode='off',timer=0,lastPress=-1e9,sending=false,lastInput='pointer',swallowUntil=0,nextWas=false,poll=0,sig='',plan=null,targets=[];
    const held=new Set(),swallowed=new Set();

    // ---- What each key does and whether it can do it now.
    function live(k){
      if(k.el)return usable(k.el);
      if(k.click)return usable(byId(k.click));
      return true;
    }
    const CODES={' ':'Space',Enter:'Enter',Escape:'Escape',Backspace:'Backspace',Delete:'Delete',Tab:'Tab'},KC={ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Enter:13,' ':32,Tab:9,Backspace:8,Delete:46,Escape:27};
    const codeOf=k=>k.startsWith('Arrow')?k:CODES[k]||(/^[a-z]$/i.test(k)?'Key'+k.toUpperCase():/^\d$/.test(k)?'Digit'+k:k);
    // Keys go where a real key would: the focused part of the game, or the
    // board brought into focus first; never a toolbar button left in focus.
    function target(){
      const a=document.activeElement;
      if(a&&a!==body&&a!==html&&!outside(a)&&visible(a))return a;
      if(a&&a!==body&&outside(a))a.blur();
      const area=document.querySelector(config.focus||config.board||'#board');
      if(area){
        if(area.getAttribute('tabindex')!==null&&area.tabIndex>=0&&visible(area)){area.focus({preventScroll:true});return area;}
        const item=area.querySelector('[tabindex="0"]');if(item&&visible(item)){item.focus({preventScroll:true});return item;}
      }
      return body;
    }
    function keyEvent(type,key,shift){const kc=KC[key]||(key.length===1?key.toUpperCase().charCodeAt(0):0);return new KeyboardEvent(type,{key,code:codeOf(key),keyCode:kc,which:kc,shiftKey:!!shift,bubbles:true,cancelable:true,composed:true,view:window});}
    function dispatch(node,event){sending=true;try{node.dispatchEvent(event);}finally{sending=false;}return event;}
    // Tab moves through the game's own controls in page order, the frame's
    // toolbar and the sheets left out, after the game has seen the key.
    function tab(back){
      const a=document.activeElement,down=dispatch(a&&a!==html?a:body,keyEvent('keydown','Tab',back));
      dispatch(document.activeElement||body,keyEvent('keyup','Tab',back));if(down.defaultPrevented)return;
      const list=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(n=>n.tabIndex>=0&&!n.disabled&&!outside(n)&&visible(n));
      if(!list.length)return;const i=list.indexOf(document.activeElement);
      list[i<0?(back?list.length-1:0):(i+(back?-1:1)+list.length)%list.length].focus({preventScroll:true});
    }
    let sent=0,lastSent=null;
    // Events for a parent page of the same origin (the accessible app): presses,
    // choices, abandoned rings, Undo, Hint, a finished board and Home, with the
    // time that led to each. No coordinates and no gaze: the Eye Tracker 5 is
    // licensed for interaction only.
    let lastEvent=performance.now();const peaks=new Map();
    const via=()=>mode==='switch'?'switch':prefs.look==='tracker'?'tracker':prefs.look==='pointer'?'pointer':'look';
    function post(type,extra){
      const now=performance.now(),ms=Math.round(now-lastEvent);if(type!=='ring-abandoned')lastEvent=now;
      try{if(window.parent!==window)window.parent.postMessage({source:'minimal-access',v:1,type,via:via(),ms,...extra},location.origin);}catch(_){}
    }
    function send(k){
      sent++;lastSent=k.id;
      if(k.home){post('home');return;}
      post(k.id==='undo'||k.id==='hint'?k.id:'choice',{key:k.id});
      // Undo, Hint and Next: the button where it stands is pressed.
      if(k.el){if(usable(k.el))k.el.click();return;}
      if(k.click){const b=byId(k.click);if(usable(b))b.click();return;}
      if(k.tab){tab(!!k.shift);return;}
      const t=target(),down=dispatch(t,keyEvent('keydown',k.key,k.shift));
      const up=dispatch(document.activeElement&&document.activeElement!==html?document.activeElement:t,keyEvent('keyup',k.key,k.shift));
      // A real Enter or Space presses the button that has focus.
      if((k.key==='Enter'||k.key===' ')&&!down.defaultPrevented&&!(k.key===' '&&up.defaultPrevented)&&t.matches&&t.matches('button:not(:disabled),a[href],summary,input[type=checkbox],input[type=radio]'))t.click();
    }
    function flash(k){
      const n=k.node||k.el;if(!n)return;n.removeAttribute('data-access-sent');void n.offsetWidth;n.setAttribute('data-access-sent','');
      clearTimeout(n.accessSent);n.accessSent=setTimeout(()=>n.removeAttribute('data-access-sent'),200);
    }

    // ---- One switch. The highlight steps through the groups first (the
    // direction keys, the game's other keys, then the toolbar's Undo and Hint
    // with Next, lit where they stand), then the keys of the chosen group,
    // never deeper; or key by key. Any key, tap or click
    // is a press. A press can be asked to last a set time, shown by a
    // filling ring, and presses closer together than the release time are
    // bounces. Settings and Help stay out of the scan, as touch-only.
    const interval=()=>T.scan;
    let top=[],level=null,idx=0,pass=0,hold=null,point=null,topScan=null,presses=0,laps=0,asleep=false;
    const entryLive=e=>!!e&&(e.group?e.group.some(live):live(e.key));
    function buildTop(){
      const pads=keys.filter(k=>k.node&&!k.lookOnly),d=['up','right','down','left','select'].map(id=>pads.find(k=>k.id===id)).filter(Boolean);
      const dpad=d.length>=4?d:[],rest=pads.filter(k=>!dpad.includes(k)),items=[];
      const add=(list,id)=>{if(list.length===1)items.push({key:list[0]});else if(list.length)items.push({group:list,id});};
      if(prefs.scan==='keys')for(const k of [...pads,...bar])items.push({key:k});
      else{add(dpad,'dpad');add(rest,'keys');add(bar,'actions');}
      top=items;level=null;idx=Math.max(0,top.findIndex(entryLive));pass=0;if(top[idx]&&top[idx].group&&alone())enter(top[idx],false);
    }
    const current=()=>(level?level.items:top)[idx];
    const scanId=()=>{const e=current();return e?e.group?'group:'+e.id:e.key.id:null;};
    function paint(){
      const e=mode==='switch'&&!point&&!asleep?current():null,lit=new Set(e?e.group||[e.key]:[]),group=!!(e&&e.group);
      // Only what changed is written, so a steady pad causes no work for the page.
      const put=(n,name,v)=>{if(v===null){if(n.hasAttribute(name))n.removeAttribute(name);}else if(n.getAttribute(name)!==v)n.setAttribute(name,v);};
      for(const k of keys)if(k.node){put(k.node,'data-off',String(!live(k)||(resting&&!k.rest)));put(k.node,'data-scan',lit.has(k)?'':null);put(k.node,'data-scan-group',group&&lit.has(k)?'':null);}
      for(const k of bar){const on=lit.has(k)&&live(k);put(k.el,'data-access-scan',on&&!group?'':null);put(k.el,'data-access-scan-group',on&&group?'':null);}
      put(body,'data-access-highlight',mode==='off'?null:prefs.highlight);
      put(restKey.node,'data-on',resting?'':null);
      drawHold();
    }
    // A group that is the only live choice is scanned key by key, with no level above it.
    const alone=()=>top.filter(entryLive).length===1;
    function enter(e,pause){level={entry:e,items:e.group.map(key=>({key}))};idx=Math.max(0,level.items.findIndex(x=>live(x.key)));pass=0;paint();if(pause)schedule(interval()*1.5);}
    function advance(){
      if(level){
        // One pass through a group with no press goes back up, the group still
        // lit; a group with nothing left to choose (a Next just used) goes on at once.
        const l=level.items,live1=l.filter(x=>live(x.key)).length;
        if(live1&&(++pass<live1||alone())){
          if(pass>=live1)pass=0;
          const from=idx;for(let t=1;t<=l.length;t++){const i=(idx+t)%l.length;if(live(l[i].key)){idx=i;break;}}
          if(alone()&&idx<=from&&lap())return;
          paint();return;
        }
        idx=top.indexOf(level.entry);level=null;pass=0;
        if(live1){paint();return;}
      }
      const from=idx;for(let t=1;t<=top.length;t++){const i=(idx+t)%top.length;if(entryLive(top[i])){idx=i;break;}}
      if(idx<=from&&lap())return;
      if(top[idx]&&top[idx].group&&alone()){enter(top[idx],false);return;}
      paint();
    }
    // Rest after: once the scan has gone round that many times with no press,
    // it stops and its highlight goes, until the next press starts it again
    // from the top, choosing nothing (iOS Switch Control's Loops).
    function lap(){
      if(!T.rest||++laps<T.rest)return false;
      asleep=true;clearTimeout(timer);timer=0;paint();say('The scan is resting. Press to start it again.');return true;
    }
    function wakeUp(){
      const t=performance.now();if(t-lastPress<T.release)return;lastPress=t;presses++;
      asleep=false;laps=0;level=null;pass=0;idx=Math.max(0,top.findIndex(entryLive));
      if(top[idx]&&top[idx].group&&alone())enter(top[idx],false);paint();schedule(interval()*1.5);say('Scanning again.');
    }
    // Long press: back one step. From a group's keys back to the groups (or,
    // at the groups, back to the start); in point mode, from the short line
    // back to the long one, and from the long one back to the keys.
    function back(){
      lastPress=performance.now();presses++;laps=0;
      if(point){
        if(point.stage==='x'){point.stage='y';point.slow=false;point.passes=0;say('Back to the first line.');}
        else{point=null;say('Back to the keys.');schedule(interval()*1.5);}
        paint();draw();return;
      }
      if(level){const e=level.entry;level=null;pass=0;idx=top.indexOf(e);say('Back to the groups.');paint();}
      else{idx=Math.max(0,top.findIndex(entryLive));say('Back to the start.');if(top[idx]&&top[idx].group&&alone())enter(top[idx],false);else paint();}
      schedule(interval()*1.5);
    }
    // Bring the highlight straight to a key, inside its group if it has one.
    function reach(k){
      const t=top.findIndex(e=>e.key===k);if(t>=0){level=null;idx=t;pass=0;paint();return;}
      const e=top.find(e=>e.group&&e.group.includes(k));if(e){level={entry:e,items:e.group.map(key=>({key}))};idx=e.group.indexOf(k);pass=0;paint();}
    }
    function schedule(ms){clearTimeout(timer);timer=mode==='switch'?setTimeout(tick,ms):0;}
    function tick(){if(mode!=='switch'||asleep)return;if(!document.hidden&&!dialogOpen()&&!hold&&!point)advance();schedule(interval());}
    function press(){
      const t=performance.now();if(mode!=='switch'||t-lastPress<T.release)return;lastPress=t;presses++;laps=0;post('press');
      if(point){pointPress();return;}
      let e=current();if(!entryLive(e)){advance();e=current();}if(!entryLive(e))return;
      // Entering a group: its first key holds a moment longer, so it is not missed.
      if(e.group){enter(e,true);return;}
      flash(e.key);pass=0;
      if(e.key.point){startPoint(e.key);return;}
      send(e.key);paint();schedule(interval()*1.5);
    }
    // The switch going down and coming up; with a press time, only a press
    // held until its ring fills counts, and the scan waits while it fills.
    // With Long press on, a key sent to the game cannot be taken back, so a
    // press acts as it is let go; held for the long press time it takes back
    // a step instead, once, however long it is held. With it off, a press
    // acts as before.
    const longAt=()=>T.long?Math.max(T.long,T.press+500):0;
    function down(t){
      if(mode!=='switch'||hold)return;
      if(asleep){hold={t,woke:true};wakeUp();return;}
      if(T.long){hold={t,long:true,timer:setTimeout(()=>{if(hold&&hold.long&&!hold.fired){hold.fired=true;back();}},longAt())};wake();return;}
      if(!T.press){press();return;}
      hold={t,timer:setTimeout(()=>{hold=null;press();paint();},T.press)};wake();
    }
    function up(t){
      if(!hold||held.size||swallowed.size)return;
      const h=hold;hold=null;clearTimeout(h.timer);
      if(h.long&&!h.fired&&t-h.t>=T.press)press();
      paint();
    }
    // A lost window, a hidden page or a cancelled pointer drops a hold: nothing is chosen.
    function dropHold(){if(hold){clearTimeout(hold.timer);hold=null;paint();}}
    const passKeys=new Set(['Tab','Escape','Shift','Control','Alt','Meta','CapsLock','ContextMenu','OS','Fn','FnLock','Hyper','Super','NumLock','ScrollLock','Dead','Unidentified']);
    addEventListener('keydown',e=>{
      if(sending||mode!=='switch')return;
      if(e.key==='Tab')lastInput='keyboard';
      if(dialogOpen()||e.ctrlKey||e.metaKey||e.altKey||passKeys.has(e.key)||/^F\d+$/.test(e.key))return;
      if(e.target.closest&&e.target.closest('select,input,textarea,dialog'))return;
      // A toolbar button reached by Tab keeps Enter and Space.
      if(lastInput==='keyboard'&&exempt(e.target)&&e.target.matches('button')&&(e.key==='Enter'||e.key===' '))return;
      e.preventDefault();e.stopImmediatePropagation();
      const code=e.code||e.key;if(e.repeat||held.has(code))return;held.add(code);down(e.timeStamp);
    },true);
    addEventListener('keyup',e=>{if(sending)return;if(held.delete(e.code||e.key)){e.preventDefault();e.stopImmediatePropagation();up(e.timeStamp);}},true);
    addEventListener('blur',()=>{held.clear();swallowed.clear();dropHold();});
    addEventListener('pointerdown',e=>{
      lastInput='pointer';
      if(sending||mode!=='switch'||exempt(e.target)||(e.pointerType==='mouse'&&e.button!==0))return;
      e.preventDefault();e.stopImmediatePropagation();swallowed.add(e.pointerId);swallowUntil=e.timeStamp+1000;down(e.timeStamp);
    },true);
    for(const name of ['pointerup','pointercancel'])addEventListener(name,e=>{if(sending)return;if(swallowed.delete(e.pointerId)){e.preventDefault();e.stopImmediatePropagation();swallowUntil=e.timeStamp+400;if(name==='pointerup')up(e.timeStamp);else{swallowed.clear();dropHold();}}},true);
    // The compatibility mouse and touch events and the click of a press stay away from the game too.
    for(const name of ['click','dblclick','auxclick','contextmenu','mousedown','mouseup','touchstart','touchend'])addEventListener(name,e=>{
      if(!sending&&mode==='switch'&&e.timeStamp<swallowUntil&&!exempt(e.target)){e.preventDefault();e.stopImmediatePropagation();}
    },{capture:true,passive:false});

    // ---- Point: for what the keys cannot reach, a line glides down the
    // board and a press stops it; a short line then glides along it and a
    // press chooses the point where they cross (Communicator 5's cross hair
    // scan). With the brake on, the first press slows the line and the
    // second stops it. The point gets a real pointer tap, or, for a drag,
    // a press there and a release at a second point chosen the same way.
    function startPoint(k){
      const b=drawn()||{left:0,top:0,right:innerWidth,bottom:innerHeight},m=24;
      const range={left:Math.max(0,b.left-m),top:Math.max(0,b.top-m),right:Math.min(innerWidth,b.right+m),bottom:Math.min(innerHeight,b.bottom+m)};
      point={k,range,stage:'y',x:range.left,y:range.top,slow:false,from:null,passes:0,last:performance.now()};clearTimeout(timer);paint();wake();
    }
    function endPoint(){point=null;paint();draw();schedule(interval()*1.5);}
    function pointPress(){
      const p=point;
      if(prefs.brake==='on'&&!p.slow){p.slow=true;return;}
      p.slow=false;p.passes=0;
      if(p.stage==='y'){p.stage='x';p.x=p.range.left;return;}
      const at={x:Math.round(p.x),y:Math.round(p.y)};
      if(p.k.drag&&!p.from){p.from=at;p.stage='y';p.y=p.range.top;return;}
      endPoint();sent++;lastSent=p.k.id;
      if(p.k.drag)dragFrom(p.from,at);else tap(at);
      mark(at);
    }
    function glide(now){
      const p=point,dt=Math.min(100,now-p.last);p.last=now;
      // With Long press on, a press acts as it is let go, so the line waits while the switch is held.
      if(document.hidden||dialogOpen()||(hold&&hold.long))return;
      const v=66/interval()*(p.slow?1/3:1),axis=p.stage==='y'?'y':'x',lo=axis==='y'?p.range.top:p.range.left,hi=axis==='y'?p.range.bottom:p.range.right;
      p[axis]+=v*dt;if(p[axis]>hi){p[axis]=lo;p.slow=false;if(++p.passes>=2)endPoint();}
    }
    function pointerAt(type,x,y,buttons){
      const t=document.elementFromPoint(x,y)||body,move=type==='pointermove';
      const init={bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,screenX:x,screenY:y,pointerId:1,pointerType:'mouse',isPrimary:true,button:move?-1:0,buttons,width:1,height:1,pressure:buttons?.5:0,detail:1};
      sending=true;try{t.dispatchEvent(new PointerEvent(type,init));const m={pointerdown:'mousedown',pointermove:'mousemove',pointerup:'mouseup'}[type];t.dispatchEvent(new MouseEvent(m,init));}finally{sending=false;}
      return t;
    }
    function tap(at){
      const a=pointerAt('pointerdown',at.x,at.y,1),b=pointerAt('pointerup',at.x,at.y,0),c=a===b||a.contains(b)?a:b.contains(a)?b:null;
      if(c){sending=true;try{c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,composed:true,view:window,clientX:at.x,clientY:at.y,button:0,detail:1}));}finally{sending=false;}}
    }
    async function dragFrom(a,b){
      pointerAt('pointerdown',a.x,a.y,1);const n=12;
      for(let i=1;i<=n;i++){await new Promise(r=>requestAnimationFrame(r));pointerAt('pointermove',a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n,1);}
      pointerAt('pointerup',b.x,b.y,0);
    }

    // ---- The pad's place: the largest keys that fit the rest area, the
    // direction keys on the left and the rest on the right, near the
    // bottom, clear of the board, the toolbar, the readout and the Next disc.
    function boxOf(n){
      if(n instanceof SVGSVGElement)try{const b=n.getBBox(),m=n.getScreenCTM();if(m&&b.width&&b.height){const p=[new DOMPoint(b.x,b.y).matrixTransform(m),new DOMPoint(b.x+b.width,b.y+b.height).matrixTransform(m)];return {left:Math.min(p[0].x,p[1].x),top:Math.min(p[0].y,p[1].y),right:Math.max(p[0].x,p[1].x),bottom:Math.max(p[0].y,p[1].y)};}}catch(_){}
      const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};
    }
    const union=(a,b)=>a?{left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)}:b;
    function drawn(){
      try{const b=window.__minimalize&&window.__minimalize.bounds();if(b&&b.width>0&&b.height>0)return {left:b.x,top:b.y,right:b.x+b.width,bottom:b.y+b.height};}catch(_){}
      const d=config.bounds;
      // A canvas drawn through the game's view: its element, the hook that holds the view, and the drawing's size in view units.
      if(d&&typeof d==='object'){const n=document.querySelector(d.element),g=d.view.split('.').reduce((o,k)=>o&&o[k],window);if(n&&g&&g.scale){const r=n.getBoundingClientRect();return {left:r.left+g.x,top:r.top+g.y,right:r.left+g.x+d.size[0]*g.scale,bottom:r.top+g.y+d.size[1]*g.scale};}}
      let u=null;for(const n of document.querySelectorAll(typeof d==='string'?d:config.board||'#board')){if(!visible(n))continue;const r=boxOf(n);if(r.right-r.left>=1||r.bottom-r.top>=1)u=union(u,r);}
      return u;
    }
    function insets(){const s=getComputedStyle(probe);return {t:parseFloat(s.paddingTop)||0,r:parseFloat(s.paddingRight)||0,b:parseFloat(s.paddingBottom)||0,l:parseFloat(s.paddingLeft)||0};}
    // Where the Next disc stands, shown or not, so the pad never has to move for it.
    function nextZone(){
      const W=innerWidth,H=innerHeight,ins=insets(),low=rail()?Math.max(12,ins.b):Math.max(64,ins.b+64);
      if(disc){const s=spot&&spot(),x=s&&s.left!==undefined?s.left:W/2,b=s?s.bottom:low,z={left:x-32,top:H-b-64,right:x+32,bottom:H-b};return visible(disc)?union(z,boxOf(disc)):z;}
      const boxes=completionNodes.filter(n=>!config.completionRoot&&!n.matches('button'));if(!boxes.length)return null;
      const half=Math.max(32,Math.max(...boxes.map(n=>n.querySelectorAll('button').length))*24+8);
      let z={left:W/2-half,top:H-low-64,right:W/2+half,bottom:H-low};for(const n of boxes)if(visible(n))z=union(z,boxOf(n));return z;
    }
    function obstacles(look){
      const list=[],b=drawn();if(b)list.push([b,look?18:12]);
      for(const n of document.querySelectorAll('.control-restart,#readout,.control-toolbar button'))if(visible(n))list.push([n.getBoundingClientRect(),8]);
      const z=nextZone();if(z)list.push([z,10]);
      for(const n of completionNodes)if(visible(n))list.push([boxOf(n),8]);
      for(const sel of config.avoid||[])for(const n of document.querySelectorAll(sel))if(visible(n))list.push([boxOf(n),8]);
      if(liveDot&&!liveDot.hidden)list.push([liveDot.getBoundingClientRect(),8]);
      return list;
    }
    function layout(){
      if(zoom){zoom=null;zoomPanel.hidden=true;zoomPanel.replaceChildren();}
      const look=mode==='look',prompt=look&&phase==='prompt',W=innerWidth,H=innerHeight,ins=insets(),band=look&&phase!=='pointer'?Math.max(14,Math.round(Math.min(W,H)*.04)):0;
      const cell=W*H>600000?8:4,cols=Math.ceil(W/cell),rows=Math.ceil(H/cell),C=cols+1,base=new Uint8Array(cols*rows);
      const fill=(a,l,t,r,b)=>{const c0=Math.max(0,Math.floor(l/cell)),c1=Math.min(cols,Math.ceil(r/cell)),r0=Math.max(0,Math.floor(t/cell)),r1=Math.min(rows,Math.ceil(b/cell));for(let y=r0;y<r1;y++)a.fill(1,y*cols+c0,y*cols+c1);};
      const sat=a=>{const S=new Int32Array(C*(rows+1));for(let y=0;y<rows;y++){let run=0;for(let x=0;x<cols;x++){run+=a[y*cols+x];S[(y+1)*C+x+1]=S[y*C+x+1]+run;}}return S;};
      const m=Math.max(8,band);
      fill(base,0,0,W,Math.max(m,ins.t));fill(base,0,H-Math.max(m,ins.b),W,H);fill(base,0,0,Math.max(m,ins.l),H);fill(base,W-Math.max(m,ins.r),0,W,H);
      const blockAll=tight=>{for(const [r,c] of obstacles(look))fill(base,r.left-(tight?4:c),r.top-(tight?4:c),r.right+(tight?4:c),r.bottom+(tight?4:c));};
      blockAll(false);
      function find(S,w,h,[ax,ay]){
        const wc=Math.ceil(w/cell),hc=Math.ceil(h/cell);if(wc>cols||hc>rows)return null;let best=null,score=Infinity;
        for(let y=0;y+hc<=rows;y++)for(let x=0;x+wc<=cols;x++){
          if(S[(y+hc)*C+x+wc]-S[y*C+x+wc]-S[(y+hc)*C+x]+S[y*C+x])continue;
          const d=Math.abs(x*cell+wc*cell/2-ax)+Math.abs(y*cell+hc*cell/2-ay);if(d<score){score=d;best={x:x*cell+(wc*cell-w)/2,y:y*cell+(hc*cell-h)/2};}
        }
        return best;
      }
      const pads=keys.filter(k=>k.node&&(look?!k.point:!k.lookOnly)),arrows=['up','right','down','left'].map(id=>pads.find(k=>k.id===id));
      const dpad=arrows.every(Boolean)?arrows:null,sel=dpad&&pads.find(k=>k.id==='select');
      const acts=prompt?[camKey]:pads.filter(k=>!(dpad&&(dpad.includes(k)||k===sel)));
      const tools=[...document.querySelectorAll('.control-toolbar button')].filter(b=>b.offsetParent!==null).map(b=>b.getBoundingClientRect());
      const right=rail()&&tools.length?Math.min(...tools.map(r=>r.left)):W,A1=rail()?[W*.12,H]:[W*.25,H],A2=rail()?[right-W*.12,H]:dpad?[W*.75,H]:[W/2,H];
      let S0=sat(base);
      function attempt(s){
        const g=look?Math.max(8,Math.round(s*.25)):Math.max(4,Math.round(s*.12)),px=n=>n*s+(n-1)*g,out=[];
        const block=(list,c)=>{if(!list.length)return {};for(const cc of [...new Set([list.length,1,2,Math.ceil(list.length/2)])].filter(n=>n<=list.length)){const r=Math.ceil(list.length/cc),p=find(c.S,px(cc),px(r),c.at);if(p)return {p,cc,r};}return null;};
        const put=(list,p,cc)=>list.forEach((k,i)=>out.push([k,p.x+(i%cc)*(s+g),p.y+Math.floor(i/cc)*(s+g)]));
        if(prompt||!dpad){const a=block(acts,{S:S0,at:A2});if(!a)return null;put(acts,a.p,a.cc);return {s,g,out};}
        for(const shape of ['cross','row']){
          const w=shape==='cross'?3:sel?5:4,h=shape==='cross'?3:1,p=find(S0,px(w),px(h),A1);if(!p)continue;
          let S1=S0;if(acts.length){const b2=base.slice();fill(b2,p.x-g,p.y-g,p.x+px(w)+g,p.y+px(h)+g);S1=sat(b2);}
          const a=block(acts,{S:S1,at:A2});if(!a)continue;
          const slots=shape==='cross'?[[1,0],[2,1],[1,2],[0,1],[1,1]]:[[1,0],[3,0],[2,0],[0,0],[4,0]];
          [...dpad,sel].forEach((k,i)=>{if(k)out.push([k,p.x+slots[i][0]*(s+g),p.y+slots[i][1]*(s+g)]);});
          if(acts.length)put(acts,a.p,a.cc);return {s,g,out,shape};
        }
        // Everything in one block, in one row or two.
        const all=[...dpad.slice(3),dpad[0],dpad[2],dpad[1],...(sel?[sel]:[]),...acts],a=block(all,{S:S0,at:[W/2,H]});
        if(!a)return null;put(all,a.p,a.cc);return {s,g,out,shape:'block'};
      }
      const sizes=look?[96,88,80,72,64,56,52,48,44,40,36,32,28,24,20]:[64,56,52,48,44,40,36,32,28,24,20];
      // The largest size that fits: smaller keys always fit where larger ones do.
      const solve=list=>{let lo=0,hi=list.length-1,got=null;while(lo<=hi){const mid=(lo+hi)>>1,a=attempt(list[mid]);if(a){got=a;hi=mid-1;}else lo=mid+1;}return got;};
      // First below the board, near the toolbar and the thumbs, at a comfortable
      // size; then anywhere in the rest area, as large as it allows.
      let got=null;const board=drawn();
      if(board&&!rail()&&!prompt){const keep=base.slice();fill(base,0,0,W,board.bottom+(look?18:12));S0=sat(base);got=solve(sizes.filter(s=>s>=(look?56:40)));base.set(keep);S0=sat(base);}
      if(!got)got=solve(sizes);
      // A board that fills the page: the keys stand closer to it, and smaller, but never on it.
      if(!got){base.fill(0);fill(base,0,0,W,Math.max(m,ins.t));fill(base,0,H-Math.max(m,ins.b),W,H);fill(base,0,0,Math.max(m,ins.l),H);fill(base,W-Math.max(m,ins.r),0,W,H);blockAll(true);S0=sat(base);got=solve([24,20,16]);}
      plan=got;targets=[];
      for(const k of [...keys,camKey])if(k.node)k.node.hidden=true;
      if(got){
        for(const [k,x,y] of got.out){Object.assign(k.node.style,{left:Math.round(x)+'px',top:Math.round(y)+'px',width:got.s+'px',height:got.s+'px'});k.node.hidden=false;targets.push({id:k.id,k,cx:Math.round(x)+got.s/2,cy:Math.round(y)+got.s/2,r:got.s/2});}
      }
      sig=signature();paint();
      // Keys that moved under a resting look or pointer count as already chosen there.
      if(mode==='look')settle();
    }
    function signature(){const b=drawn(),z=nextZone(),f=v=>v?[v.left,v.top,v.right,v.bottom].map(Math.round).join():'';return [innerWidth,innerHeight,f(b),f(z),completionNodes.map(visible).join(),liveDot.hidden].join('|');}
    // While Access is on: refit when the board or the page changes, and
    // bring the highlight to Next as soon as a board is finished.
    function watch(){
      if(signature()!==sig)layout();
      const n=bar.find(k=>k.id==='next');const now=!!n&&live(n);
      if(now&&!nextWas)post('complete');
      if(now&&!nextWas&&mode==='switch'&&!point){reach(n);schedule(interval()*1.5);}
      nextWas=now;paint();
    }
    addEventListener('resize',()=>{if(mode!=='off')requestAnimationFrame(()=>{grow();layout();if(mode==='look')settle();});});

    // ---- Look and hold: each key is a dwell target chosen by a pointer,
    // or by the camera's reading of the head or the eyes.
    let phase='pointer',calib=null,gaze=null,freshHold=false,resume=false,virtual=false,raf=0,activeLook=null;
    const filters=()=>prefs.look==='eyes'?[oneEuro({minCutoff:.45,beta:.35}),oneEuro({minCutoff:.45,beta:.35})]:[oneEuro({minCutoff:.8,beta:.6}),oneEuro({minCutoff:.8,beta:.6})];
    let [fu,fv]=filters();
    const pointer={x:0,y:0,present:false};
    const band=()=>phase==='pointer'?0:Math.max(14,Math.round(Math.min(innerWidth,innerHeight)*.04));
    const inSafe=(x,y)=>{const b=band();return x>=b&&y>=b&&x<=innerWidth-b&&y<=innerHeight-b;};
    const dead=()=>Math.max(10,(plan?plan.s:48)*.15);
    // The toolbar's Undo and Hint and the game's Next are looked at where they stand.
    const barTargets=bar.map(k=>({id:k.id,k}));
    function circleOf(t){if(!t.k.el)return t;const b=t.k.el.getBoundingClientRect();return {cx:b.left+b.width/2,cy:b.top+b.height/2,r:Math.min(b.width,b.height)/2};}
    function targetAt(x,y){
      if(!inSafe(x,y)||dialogOpen())return null;
      if(zoom){for(const t of zoom.targets)if((t.zoomClose||live(t.k))&&Math.hypot(x-t.cx,y-t.cy)<=t.r)return t;return null;}
      for(const t of targets)if(live(t.k)&&(!resting||t.k.rest)&&Math.hypot(x-t.cx,y-t.cy)<=t.r)return t;
      if(resting)return null;
      if(phase!=='prompt')for(const t of barTargets)if(live(t.k)){const c=circleOf(t);if(c.r&&Math.hypot(x-c.cx,y-c.cy)<=c.r)return t;}
      if(boardKey&&phase!=='prompt'){const b=drawn();if(b&&x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom&&!outside(document.elementFromPoint(x,y)))return boardAt(x,y);}
      return null;
    }
    // A board chosen by a point (a point key, no drag) is looked at directly:
    // a look held still on the board fills a ring where it rests, and a full
    // ring taps there. Each place is a new target, so the same cell is not
    // tapped twice without looking away; the pause key stops it, as it stops
    // the keys.
    const boardKey=keys.some(k=>k.point&&!k.drag)?{id:'board',board:true}:null;let boardSeq=0;const boardSpots=[];
    function boardAt(x,y){
      const t={id:'board:'+(++boardSeq),k:boardKey,board:true,cx:x,cy:y,r:Math.max(20,Math.round((plan?plan.s:48)*.4))};
      boardSpots.push(t);if(boardSpots.length>8)boardSpots.shift();return t;
    }
    function holds(t,x,y){if(!inSafe(x,y)||dialogOpen()||(zoom?!zoom.targets.includes(t):false)||(!t.zoomClose&&!live(t.k))||(resting&&!t.k.rest)||(t.k.camera&&phase!=='prompt'))return false;const c=circleOf(t);return Math.hypot(x-c.cx,y-c.cy)<=c.r+dead();}
    const dwell=lookAndHold({time:T.hold,targets:targetAt,holds});
    const pointerDwell=()=>mode==='look'&&(phase==='pointer'||phase==='prompt');
    function feed(t,x,y){
      if(freshHold&&x!==null){dwell.hold(targetAt(x,y));freshHold=false;}
      gaze=x===null?null:{x,y};
      // An open zoom closes when the look stays away from it.
      if(zoom&&x!==null){if(targetAt(x,y))zoom.away=null;else if(zoom.away===null)zoom.away=t;else if(t-zoom.away>1500)closeZoom();}
      const fired=dwell.sample(t,x,y),firedIds=new Set(fired.map(f=>f.id)),after=new Map(dwell.rings());
      for(const [id,p] of after)peaks.set(id,Math.max(peaks.get(id)||0,p));
      for(const [id,p] of peaks)if(!after.has(id)){peaks.delete(id);if(!firedIds.has(id)&&p>=.25)post('ring-abandoned',{key:String(id)});}
      for(const f of fired){
        if(f.k.camera)startCamera(false);
        else if(f.zoomClose)closeZoom();
        else if(f.k.rest){closeZoom();resting=!resting;flash(f.k);paint();say(resting?'Resting. Look at the pause key to go on.':'Looking again.');}
        else if(f.board){sent++;lastSent='board';post('choice',{key:'board'});tap({x:f.cx,y:f.cy});}
        else if(!zoom&&!f.k.el&&plan&&plan.s<ZOOM)openZoom(f.k);
        else{closeZoom();flash(f.k);send(f.k);}
      }
      wake();
    }
    // Small keys, where the rest area leaves no room for large ones, are
    // chosen in two looks, after TD Control's adjust step: the first opens
    // the pad drawn large in the middle of the page, the second chooses there.
    const ZOOM=56;let zoom=null;const zoomPanel=document.createElement('div');zoomPanel.className='access-zoom';zoomPanel.hidden=true;pad.append(zoomPanel);
    function openZoom(from){
      const list=targets.filter(t=>!t.k.camera).map(t=>t.k),n=list.length+1,W=innerWidth,H=innerHeight,cols=Math.ceil(Math.sqrt(n*W/H)),rows=Math.ceil(n/cols);
      const s=Math.max(48,Math.min(96,Math.floor(Math.min((W-48)/cols,(H-48)/rows)*.8))),g=Math.round(s*.25),pw=cols*s+(cols-1)*g+2*g,ph=rows*s+(rows-1)*g+2*g,x0=Math.round((W-pw)/2),y0=Math.round((H-ph)/2);
      zoomPanel.replaceChildren();Object.assign(zoomPanel.style,{left:x0+'px',top:y0+'px',width:pw+'px',height:ph+'px'});zoomPanel.hidden=false;
      const zt=[];[...list,{id:'close',close:true}].forEach((k,i)=>{
        const n2=document.createElement('div');n2.className='access-key';n2.dataset.zoom=k.id;n2.innerHTML=k.close?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>':k.node.innerHTML;
        const x=g+(i%cols)*(s+g),y=g+Math.floor(i/cols)*(s+g);Object.assign(n2.style,{left:x+'px',top:y+'px',width:s+'px',height:s+'px'});if(k===from)n2.dataset.from='';zoomPanel.append(n2);
        zt.push({id:'zoom:'+k.id,k:k.close?restKey:k,zoomClose:!!k.close,cx:x0+x+s/2,cy:y0+y+s/2,r:s/2,node:n2});
      });
      zoom={targets:zt,away:null};settle();paint();
    }
    function closeZoom(){if(!zoom)return;zoom=null;zoomPanel.hidden=true;zoomPanel.replaceChildren();settle();paint();}
    // A new place for the keys, or a new way of looking, starts with
    // whatever lies under the point already counted as chosen.
    function settle(){dwell.reset();if(phase==='camera'||phase==='calibrating')freshHold=true;else{freshHold=false;if(pointerDwell()&&pointer.present)dwell.hold(targetAt(pointer.x,pointer.y));}}
    let synthetic=false;
    addEventListener('pointermove',e=>{synthetic=false;if(e.pointerType!=='touch'||e.buttons){pointer.x=e.clientX;pointer.y=e.clientY;pointer.present=true;if(pointerDwell())wake();}},{passive:true});
    addEventListener('pointerdown',e=>{pointer.x=e.clientX;pointer.y=e.clientY;pointer.present=true;if(pointerDwell())wake();},{passive:true});
    for(const name of ['pointerup','pointercancel'])addEventListener(name,e=>{if(e.pointerType==='touch')pointer.present=false;},{passive:true});
    html.addEventListener('pointerleave',()=>{pointer.present=false;});
    // Pressing a key does nothing while choosing is by looking, apart from the camera glyph's tap.
    pad.addEventListener('pointerdown',e=>{if(mode!=='look')return;e.preventDefault();e.stopPropagation();pointer.x=e.clientX;pointer.y=e.clientY;pointer.present=true;wake();if(e.target.closest('[data-key="camera"]'))startCamera(false);});
    pad.addEventListener('click',e=>{if(mode==='look'){e.preventDefault();e.stopPropagation();}});
    const wake=()=>{if(!raf&&(mode==='look'||hold||point))raf=requestAnimationFrame(frame);};
    let sheetWas=false;
    function frame(now){
      raf=0;
      if(mode==='switch'){if(point)glide(now);draw();if(hold||point)wake();return;}
      if(mode!=='look')return;
      // Closing a sheet leaves the pointer resting where it closed it: whatever key is there counts as already chosen, as in Glance.
      const sheet=dialogOpen();if(sheet!==sheetWas){sheetWas=sheet;if(!sheet)settle();}
      if(pointerDwell()&&!document.hidden&&!synthetic)feed(now,pointer.present?pointer.x:null,pointer.present?pointer.y:null);
      draw();if((pointerDwell()&&pointer.present)||dwell.rings().length)wake();
    }
    // The camera, as in Glance's track.js: frames go from a hidden video
    // straight into the Face Landmarker, read on the page's frame clock.
    const webcam=(()=>{
      const base=new URL('../glance/vendor/',here).href;let video=null,landmarker=null,loading=null,stream=null,running=false,handle=0,last=-1,seen=-1,generation=0;
      const api={onResult:null,onLost:null};let fails=0,moved=0;
      // A camera that ends, a detector that keeps failing, or frames that stop: let go and say so (as in glance/track.js).
      const lose=reason=>{if(!running&&!stream)return;generation++;running=false;release();fails=0;moved=0;showLive(virtual);api.onLost&&api.onLost(reason);};
      function load(){
        if(!loading)loading=(async()=>{
          const vision=await import(base+'vision_bundle.mjs'),files={wasmLoaderPath:base+'vision_wasm_internal.js',wasmBinaryPath:base+'vision_wasm_internal.wasm'};
          const options=d=>({baseOptions:{modelAssetPath:base+'face_landmarker.task',delegate:d},runningMode:'VIDEO',numFaces:1,outputFacialTransformationMatrixes:true,outputFaceBlendshapes:false});
          try{landmarker=await vision.FaceLandmarker.createFromOptions(files,options('GPU'));}catch(_){landmarker=await vision.FaceLandmarker.createFromOptions(files,options('CPU'));}
          return landmarker;
        })().catch(e=>{loading=null;throw e;});
        return loading;
      }
      function release(){if(handle){cancelAnimationFrame(handle);handle=0;}if(stream)for(const t of stream.getTracks())t.stop();stream=null;if(video){video.srcObject=null;video.remove();video=null;}seen=-1;}
      function tickCam(){
        handle=0;if(!running)return;const now=performance.now();
        if(video&&video.readyState>=2&&now-last>=30&&video.currentTime!==seen){last=now;seen=video.currentTime;let r=null;try{r=landmarker.detectForVideo(video,now);fails=0;}catch(_){r=null;fails++;}if(fails>=30){lose('detector');return;}if(r&&api.onResult)api.onResult(r,now);moved=now;}
        else if(video&&video.readyState>=2&&moved&&now-moved>5000){lose('stalled');return;}
        if(running)handle=requestAnimationFrame(tickCam);
      }
      api.start=async()=>{
        if(running||stream)return;const mine=++generation;
        if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw Error('No camera');
        const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}},audio:false});
        if(mine!==generation){for(const t of s.getTracks())t.stop();throw Error('Stopped');}
        video=document.createElement('video');video.className='access-video';video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('aria-hidden','true');body.append(video);
        stream=s;video.srcObject=s;showLive(true);for(const t of s.getVideoTracks())t.addEventListener('ended',()=>{if(stream===s)lose('ended');});
        try{await video.play();await load();}catch(e){if(mine===generation){release();showLive(virtual);}throw e;}
        if(mine!==generation)throw Error('Stopped');
        running=true;last=-1;fails=0;moved=performance.now();handle=requestAnimationFrame(tickCam);
      };
      api.stop=()=>{generation++;running=false;release();showLive(virtual);};
      api.aspect=()=>video&&video.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:4/3;
      api.status=()=>({running,live:stream?stream.getVideoTracks().filter(t=>t.readyState==='live').length:0,loaded:!!landmarker});
      Object.defineProperty(api,'running',{get:()=>running});api.base=base;
      return api;
    })();
    // An eye tracker, through the gaze bridge on this computer: its client
    // (bridge-client.js beside this file) loads the first time it is chosen.
    // Samples arrive in display terms and are placed on this page; the
    // calibration is one dot that takes up the window's offset.
    const tracker=(()=>{
      let link=null,running=false,info=null,loading=null;
      const api={onSample:null,onLost:null};
      const lib=()=>window.GazeBridge?Promise.resolve(window.GazeBridge):loading||(loading=new Promise((ok,no)=>{const s=document.createElement('script');s.src=new URL('./bridge-client.js',here).href;s.onload=()=>window.GazeBridge?ok(window.GazeBridge):no(Error('No client'));s.onerror=()=>{loading=null;no(Error('No client'));};document.head.append(s);}));
      api.start=async()=>{
        if(running)return;const GB=await lib();
        const port=+(new URLSearchParams(location.search).get('bridge'))||GB.PORT;
        await new Promise((ok,no)=>{
          const quit=setTimeout(()=>{if(link)link.stop();link=null;no(Error('No bridge'));},2500);
          link=GB.connect({port,onState:(s,i)=>{
            if(s==='open'){info=i;if(!running){running=true;clearTimeout(quit);showLive(true);ok();}}
            else if(s==='lost'&&running&&api.onLost)api.onLost();
            else if(s==='unsupported'){clearTimeout(quit);link=null;no(Error('Unsupported'));}
          },onSample:(t,x,y,v)=>{if(running&&api.onSample)api.onSample(t,v?GB.toViewport(x,y,info&&info.display,GB.viewOf(window)):null);}});
        });
      };
      api.stop=()=>{running=false;if(link){link.stop();link=null;}showLive(virtual);};
      api.status=()=>({running,device:info&&info.device||null});
      Object.defineProperty(api,'running',{get:()=>running});
      return api;
    })();
    // The look sources behind one face: the one chosen in Look with runs, the
    // other is stopped first, so a change of source starts afresh.
    const camera={
      start:async()=>{if(prefs.look==='tracker'){webcam.stop();await tracker.start();}else{tracker.stop();await webcam.start();}},
      stop(){webcam.stop();tracker.stop();},
      aspect:()=>webcam.aspect(),
      status:()=>({...webcam.status(),tracker:tracker.status()}),
      get running(){return prefs.look==='tracker'?tracker.running:webcam.running;}
    };
    webcam.onResult=(r,t)=>processFace(r,t);
    webcam.onLost=()=>{if(phase!=='camera'&&phase!=='calibrating')return;calib=null;activeLook=null;setPhase('pointer');say('The camera stopped. Look and hold by pointer; choose the camera again to retry.');};
    tracker.onSample=(t,p)=>processTracker(t,p);
    tracker.onLost=()=>{feed(performance.now(),null,null);say('Eye tracker lost. Looking for it again.');};
    const pixelFilters=()=>[oneEuro({minCutoff:.9,beta:.01}),oneEuro({minCutoff:.9,beta:.01})];
    let [tx,ty]=pixelFilters();
    function processTracker(t,p){
      if(phase!=='camera'&&phase!=='calibrating')return;
      liveDot.dataset.face=p?'seen':'none';
      if(phase==='calibrating'){calibrate(t,p&&{x:p.x,y:p.y});return;}
      if(!p){feed(t,null,null);return;}
      const c=calibration.tracker||{dx:0,dy:0};
      feed(t,clamp(tx.filter(p.x+c.dx,t),0,innerWidth),clamp(ty.filter(p.y+c.dy,t),0,innerHeight));
    }
    function showLive(on){liveDot.hidden=!on;if(!on)liveDot.dataset.face='none';}
    function setPhase(next){phase=next;body.dataset.accessPhase=next;gaze=null;if(next!=='camera'&&next!=='calibrating')liveDot.dataset.face='none';layout();settle();draw();wake();}
    // Invert vertical is the player's, shared by every game on this site.
    const invertY=()=>{try{return localStorage.getItem('minimal-gaze.v1:invert-y')==='1';}catch(_){return false;}};
    function processFace(result,t){
      if(phase!=='camera'&&phase!=='calibrating')return;
      const lm=result&&result.faceLandmarks&&result.faceLandmarks[0];liveDot.dataset.face=lm?'seen':'none';
      if(!lm){if(phase==='calibrating')calibrate(t,null);else feed(t,null,null);return;}
      const k=virtual?4/3:camera.aspect(),look=calib?calib.look:prefs.look;
      const f=look==='eyes'?lookAngles(lm,k):headPose(lm,result.facialTransformationMatrixes&&result.facialTransformationMatrixes[0],k);
      if(phase==='calibrating'){calibrate(t,f);return;}
      const c=calibration[look];if(!c)return;
      const o={invertY:invertY()},m=look==='eyes'?eyesMap(c,f,o):headMap(c,f,o),p=toScreen(fu.filter(m.u,t),fv.filter(m.v,t));
      feed(t,clamp(p.x,0,innerWidth),clamp(p.y,0,innerHeight));
    }
    // Page units to pixels: -1 to 1 across the reach inside the outer band.
    function toScreen(u,v){const b=band()||Math.max(14,Math.round(Math.min(innerWidth,innerHeight)*.04)),x0=b,x1=innerWidth-b,y0=b,y1=innerHeight-b;return {x:(x0+x1)/2+u*(x1-x0)/2,y:(y0+y1)/2+v*(y1-y0)/2};}
    // Calibration: one dot at a time; hold still on it and its ring fills.
    // The first time, the centre and four edges; after that the centre alone.
    function beginCalibration(full){if(prefs.look==='tracker')full=false;calib={full,look:prefs.look,spots:full?[0,1,2,3,4]:[0],step:0,win:[],captured:[],progress:0,last:null};setPhase('calibrating');say(full?'Look at each dot in turn and hold still.':'Look at the dot and hold still.');}
    function calibrate(t,f){
      if(dialogOpen()){calib.last=t;wake();return;}
      const dt=calib.last===null?0:clamp(t-calib.last,0,120),head=calib.look==='head',px=calib.look==='tracker',ks=px?['x','y']:head?['yaw','pitch']:['ax','ay'],tol=px?Math.max(12,Math.min(innerWidth,innerHeight)*.03):head?.02:.06,travel=head?.035:.06;calib.last=t;
      if(f){calib.win.push({t,...f});while(t-calib.win[0].t>400)calib.win.shift();}else calib.win=[];
      const s=stillness(calib.win,ks,tol),span=calib.win.length?t-calib.win[0].t:0,spot=calib.spots[calib.step],axis=ks[[0,0,0,1,1][spot]],away=from=>Math.abs(s.mean[axis]-from[axis])>=travel,pair=spot===2?1:spot===4?3:-1,across=pair<0||!s.mean||Math.sign(s.mean[axis]-calib.captured[0][axis])!==Math.sign(calib.captured[pair][axis]-calib.captured[0][axis]);
      // Each edge dot needs the look moved its own way, and the right and bottom dots the other side of the centre from the left and top (as in glance.js).
      const moved=calib.step===0||(!!s.mean&&away(calib.captured[0])&&away(calib.captured[calib.captured.length-1])&&across);
      calib.progress=f&&s.still&&span>=250&&moved?calib.progress+dt/900:Math.max(0,calib.progress-dt/400);
      if(calib.progress>=1){calib.captured.push(s.mean);calib.step++;calib.win=[];calib.progress=0;calib.last=null;if(calib.step>=calib.spots.length)finishCalibration();else say('Dot '+(calib.step+1)+' of '+calib.spots.length+'.');}
      wake();
    }
    let calFails=0;
    function finishCalibration(){
      const {look,full,captured}=calib,mid=toScreen(0,0),made=look==='tracker'?{kind:'tracker',dx:mid.x-captured[0].x,dy:mid.y-captured[0].y}:full?(look==='head'?headCalibration(captured):eyesCalibration(captured)):recentre(calibration[look],captured[0]);
      if(!made){if(++calFails>=2){calFails=0;calib=null;stopCamera();setPhase('pointer');say('Calibration did not take. Look and hold by pointer; Calibrate tries again.');return;}beginCalibration(true);say('Again: look at each dot and hold still.');return;}calFails=0;
      calibration[look]=made;calib=null;activeLook=look;try{localStorage.setItem(CAL,JSON.stringify(calibration));}catch(_){}
      [fu,fv]=filters();[tx,ty]=pixelFilters();setPhase('camera');say(look==='tracker'?'Eye tracker ready. Look at a key and hold.':'Camera ready. Look at a key and hold.');
    }
    async function startCamera(full){
      if(mode!=='look'||prefs.look==='pointer'||phase==='starting')return;
      if(virtual||camera.running){beginCalibration(full||!current(calibration[prefs.look]));return;}
      setPhase('starting');
      try{await camera.start();}catch(_){if(phase==='starting')fallback();return;}
      if(phase!=='starting'||mode!=='look'){camera.stop();return;}
      beginCalibration(full||!current(calibration[prefs.look]));
    }
    function stopCamera(){camera.stop();virtual=false;showLive(false);calib=null;resume=false;activeLook=null;}
    // No eye tracker yet: the choice stays Eye tracker, play goes on by pointer, and the bridge is looked for every few seconds (it may start later).
    let seek=0;
    function fallback(){
      if(prefs.look==='tracker'){stopCamera();setPhase('pointer');const msg='No eye tracker found yet: start the gaze bridge. Look and hold by pointer until it comes.';if(status.textContent!==msg)say(msg);clearTimeout(seek);
        const again=()=>{seek=0;if(mode!=='look'||prefs.look!=='tracker'||phase!=='pointer'||document.hidden){if(mode==='look'&&prefs.look==='tracker'&&phase==='pointer')seek=setTimeout(again,5000);return;}startCamera(false);};seek=setTimeout(again,5000);return;}
      stopCamera();prefs.look='pointer';save();paintRows();setPhase('pointer');say('Camera unavailable. Look and hold by pointer.');
      // Head and Eyes load MediaPipe from Glance's folder on this site; a site without it (playnotan.com) is told so, not left guessing.
      fetch(webcam.base+'vision_bundle.mjs',{method:'HEAD'}).then(r=>{if(!r.ok)say('This site does not have the camera files Head and Eyes need. Look and hold by pointer.');},()=>{});}
    addEventListener('keydown',e=>{if(e.key==='Escape'&&mode==='look'&&(phase==='starting'||phase==='calibrating')&&!dialogOpen()){stopCamera();prefs.look='pointer';save();paintRows();setPhase('pointer');}});
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){pointer.present=false;held.clear();swallowed.clear();dropHold();if(camera.running||phase==='starting'){resume=true;camera.stop();if(phase==='starting')setPhase('prompt');}}
      else if(resume&&mode==='look'){resume=false;if(phase==='camera'||phase==='calibrating')camera.start().then(()=>{dwell.reset();freshHold=true;},()=>{if(phase==='camera'||phase==='calibrating')fallback();});else if(phase==='prompt')startCamera(false);}
    });
    const permission=async()=>{try{return (await navigator.permissions.query({name:'camera'})).state;}catch(_){return 'unknown';}};

    // ---- The look layer: rings filling on keys and the Next disc, the
    // camera's dot, and the calibration dot.
    const ringLayer=svg('g',{},layer),dot=svg('g',{class:'a-dot'},layer);svg('circle',{class:'a-halo',r:18},dot);svg('circle',{class:'a-core',r:7},dot);
    const spotLayer=svg('g',{class:'a-spot-layer'},layer);svg('circle',{class:'a-spot-halo',r:15},spotLayer);svg('circle',{class:'a-spot',r:9},spotLayer);
    svg('circle',{class:'a-track',r:26},spotLayer);const spotArc=svg('circle',{class:'a-arc',r:26},spotLayer);
    const rings=new Map(),cross=svg('g',{class:'a-cross'},layer),holdRings=svg('g',{},layer),marks=svg('g',{},layer);
    const lineH=[svg('line',{class:'a-line-halo'},cross),svg('line',{class:'a-line'},cross)],lineV=[svg('line',{class:'a-line-halo'},cross),svg('line',{class:'a-line'},cross)],fromDot=svg('circle',{class:'a-from',r:6},cross);
    // Nothing on the look layer shows until it is in use and placed: no dot, calibration dot or cross hair parked at the corner.
    dot.style.display=spotLayer.style.display=cross.style.display='none';
    const setLine=(l,x1,y1,x2,y2)=>{for(const n of l){n.setAttribute('x1',x1.toFixed(1));n.setAttribute('y1',y1.toFixed(1));n.setAttribute('x2',x2.toFixed(1));n.setAttribute('y2',y2.toFixed(1));}};
    function mark(at){const c=svg('circle',{class:'a-mark',cx:at.x,cy:at.y,r:14},marks);setTimeout(()=>c.remove(),reduced()?400:450);}
    // The ring around what is lit while a press is held: the press time
    // filling, then, with Long press on, the long press filling (stepped in
    // quarters under reduced motion). A quick tap shows none.
    let ring=null;
    function drawHold(){
      holdRings.replaceChildren();ring=null;if(!hold||mode!=='switch'||hold.woke||hold.fired)return;
      const held1=performance.now()-hold.t;let p;
      if(hold.long&&held1>=T.press){if(held1<120)return;p=Math.min(1,(held1-T.press)/(longAt()-T.press));if(reduced())p=Math.floor(p*4)/4;ring={kind:'long',p};}
      else{p=Math.min(1,held1/T.press);ring={kind:'press',p};}
      const e=point?null:current(),lit=e?e.group||[e.key]:[];
      const spots=point?[{x:point.x,y:point.y,r:16}]:lit.map(k=>{const n=k.node||k.el;if(!n||n.hidden)return null;const b=n.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,r:b.width/2+7};}).filter(Boolean);
      for(const q of spots){const C=2*Math.PI*q.r;svg('circle',{class:'a-track',cx:q.x,cy:q.y,r:q.r},holdRings);svg('circle',{class:'a-arc',cx:q.x,cy:q.y,r:q.r,'stroke-dasharray':(p*C).toFixed(1)+' '+C.toFixed(1),transform:`rotate(-90 ${q.x} ${q.y})`},holdRings);}
    }
    function draw(){
      if(point&&mode==='switch'){
        const p=point,r=p.range;cross.style.display='';setLine(lineH,r.left,p.y,r.right,p.y);
        if(p.stage==='x')setLine(lineV,p.x,p.y-22,p.x,p.y+22);else setLine(lineV,-99,-99,-99,-99);
        fromDot.style.display=p.from?'':'none';if(p.from){fromDot.setAttribute('cx',p.from.x);fromDot.setAttribute('cy',p.from.y);}
        cross.dataset.slow=String(p.slow);
      }else cross.style.display='none';
      drawHold();
      const showDot=mode==='look'&&phase==='camera'&&gaze;
      dot.setAttribute('transform',showDot?`translate(${gaze.x.toFixed(1)} ${gaze.y.toFixed(1)})`:'translate(-99 -99)');dot.style.display=showDot?'':'none';
      const seen=new Set();
      for(const [id,p] of mode==='look'?dwell.rings():[]){
        const b=barTargets.find(x=>x.id===id),t=b?circleOf(b):(zoom&&zoom.targets.find(x=>x.id===id))||targets.find(x=>x.id===id)||boardSpots.find(x=>x.id===id);if(!t||!t.r)continue;
        let n=rings.get(id);if(!n){n={track:svg('circle',{class:'a-track'},ringLayer),arc:svg('circle',{class:'a-arc'},ringLayer)};rings.set(id,n);}
        // The ring fills just inside a key's hairline circle, and outside the solid Next disc.
        const r=b&&b.k.el===disc?t.r+8:Math.max(6,t.r-4),C=2*Math.PI*r,cx=t.cx.toFixed(1),cy=t.cy.toFixed(1);
        for(const c of [n.track,n.arc]){c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r',r.toFixed(1));}
        n.arc.setAttribute('stroke-dasharray',`${(p*C).toFixed(1)} ${C.toFixed(1)}`);n.arc.setAttribute('transform',`rotate(-90 ${cx} ${cy})`);seen.add(id);
      }
      for(const [id,n] of rings)if(!seen.has(id)){n.track.remove();n.arc.remove();rings.delete(id);}
      if(mode==='look'&&phase==='calibrating'&&calib){
        const at=toScreen(SPOTS[calib.spots[calib.step]].u,SPOTS[calib.spots[calib.step]].v),C=2*Math.PI*26;
        spotLayer.style.display='';spotLayer.setAttribute('transform',`translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);spotLayer.dataset.step=String(calib.step);
        spotArc.setAttribute('stroke-dasharray',`${(calib.progress*C).toFixed(1)} ${C.toFixed(1)}`);spotArc.setAttribute('transform','rotate(-90)');
      }else spotLayer.style.display='none';
    }

    // ---- Turning Access on, changing it and turning it off.
    function set(user){
      const was=mode;mode=prefs.mode;dwell.time=T.hold;asleep=false;laps=0;
      clearInterval(poll);poll=0;clearTimeout(timer);timer=0;closeZoom();if(hold){clearTimeout(hold.timer);hold=null;}if(mode!=='switch')point=null;if(mode!=='look')resting=false;
      if(mode!=='look'&&(camera.running||virtual||phase!=='pointer')){stopCamera();phase='pointer';}
      if(mode==='off'){paint();grow();delete body.dataset.access;delete body.dataset.accessPhase;pad.hidden=true;layer.style.display='none';dwell.reset();draw();return;}
      body.dataset.access=mode;pad.hidden=false;layer.style.display='';grow();draw();
      if(mode==='switch'){
        if(was!=='switch'||topScan!==prefs.scan){topScan=prefs.scan;buildTop();}
        phase='pointer';delete body.dataset.accessPhase;layout();schedule(interval());
        if(user&&was!=='switch')say('One switch: any key, tap or click sends the highlighted key.');
      }else if(prefs.look==='pointer'){
        if(camera.running||virtual){stopCamera();}setPhase('pointer');
        if(user&&was!=='look')say('Look and hold: rest the pointer on a key until its ring fills.');
      }else if(camera.running||virtual){
        // A new way of looking needs its own calibration.
        if((calib?calib.look:activeLook)!==prefs.look){beginCalibration(!current(calibration[prefs.look]));[fu,fv]=filters();}
      }else if(phase!=='starting'&&phase!=='calibrating'){
        if(user)startCamera(false);
        else if(prefs.look==='tracker'){startCamera(false);}
        else{setPhase('prompt');permission().then(s=>{if(mode!=='look'||phase!=='prompt')return;if(s==='granted')startCamera(false);else if(s==='denied')fallback();});}
      }
      nextWas=false;poll=setInterval(watch,500);paint();wake();
    }
    // Look and hold grows the toolbar's own Undo and Hint to Glance's look size;
    // One switch and Off leave them exactly as the frame draws them.
    function grow(){
      const on=mode==='look',size=Math.max(64,Math.min(160,Math.round(Math.min(innerWidth,innerHeight)/6)));
      for(const k of bar)if(k.id!=='next')k.el.classList.toggle('access-tool',on);
      if(on)body.style.setProperty('--access-tool',size+'px');else body.style.removeProperty('--access-tool');
      place();
    }
    function calibrateNow(){if(mode!=='look'||prefs.look==='pointer')return;if(phase==='camera'||phase==='calibrating')beginCalibration(true);else startCamera(true);}
    // The test hook: the pad, the scan and synthetic looks.
    const rectOf=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    window.__access={
      get state(){return {mode,phase,speed:prefs.speed,look:prefs.look,hold:T.hold,scanMs:T.scan,scan:mode==='switch'?scanId():null,level:level&&level.entry.id,groups:top.map(e=>e.group?{id:'group:'+e.id,keys:e.group.map(k=>k.id)}:{id:e.key.id}),point:point&&{stage:point.stage,x:point.x,y:point.y,slow:point.slow,from:point.from},holding:!!hold,ring,asleep,laps,long:T.long,rest:T.rest,resting,sent,lastSent,presses,zoom:zoom&&zoom.targets.map(t=>({id:t.id,x:t.cx,y:t.cy,r:t.r})),size:plan&&plan.s,shape:plan&&plan.shape||null,
        keys:order.map(k=>({id:k.id,live:live(k),bar:!!k.el,disc:!!k.el&&k.el===disc,rect:k.el?(visible(k.el)?rectOf(k.el):null):k.node&&!k.node.hidden?rectOf(k.node):null})),
        camera:{...camera.status(),virtual},current:dwell.current&&dwell.current.id,blocked:dwell.blocked,rings:dwell.rings(),calibrating:calib&&{step:calib.step,of:calib.spots.length,progress:calib.progress}};},
      // Time passing: the highlight moves on n steps.
      // Time passing: the highlight moves on n steps, and the scan's own clock starts its wait again.
      step(n=1){for(let i=0;i<n;i++)advance();if(mode==='switch'&&!point)schedule(interval());return scanId();},
      glide(ms){if(point){point.last=performance.now()-ms;glide(performance.now());draw();}return point&&{stage:point.stage,x:point.x,y:point.y};},
      zone:()=>nextZone(),board:()=>drawn(),layout(){layout();return plan&&plan.s;},
      // A synthetic look stands in for the camera: the pointer is not read until it moves again.
      look:(x,y,t)=>{if(mode==='look'){synthetic=true;feed(t,x,y);}},face:(r,t)=>processFace(r,t),
      simulate(look,{full=true}={}){virtual=true;showLive(true);prefs.look=look;save();paintRows();beginCalibration(full||!current(calibration[look]));},
      toScreen:(u,v)=>toScreen(u,v),get calibration(){return JSON.parse(JSON.stringify(calibration));}
    };
    return {set,calibrate:calibrateNow};
  };
})();
