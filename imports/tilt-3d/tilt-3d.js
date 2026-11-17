/* Tilt · 3D — Luke Steuber. Tilt's stacked trays as one glass object in a lit charcoal room: frosted plates with low
   rims on four glass posts, frosted glass blocks, real round holes, and a white marble that rolls, stops and falls.
   The rules and boards are Tilt's own (engine.js, levels.js, copied unchanged), and every swipe, tap, wheel step and
   W A S D key reaches the game through Tilt's input layer (tilt-input.js, copied unchanged). */
import * as THREE from './vendor/three.module.min.js';

const E = window.TiltStack, ALL = window.TiltStackBoards, KEY = 'tilt-3d.v1';
// Tilt's campaign (campaign.js, a copy of Tilt's): thirty of the fifty boards, in its order. The other twenty come
// after it, drawn at random, each once before any comes back; they are not campaign progress.
const BOARDS = window.TiltCampaign.map(id => ALL.find(b => b.id === id)), POOL = ALL.filter(b => !BOARDS.includes(b));
const $ = s => document.querySelector(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
THREE.ColorManagement.enabled = false;

// ---------- Sizes, in cells ----------
// The marble, the round openings, the plates and their rims, the blocks, and the posts that carry the trays.
const R = 0.22, HOLE = 0.31, T = 0.07, RIM_W = 0.13, RIM_H = 0.17, BLOCK = 0.86, POST_R = 0.03, FOOT_R = 0.065, H0 = 1.05;
// Where a marble stopped by the rim or by a block comes to rest, measured from its cell's centre: touching it.
const CONTACT = { rim: 0.5 - R, block: 0.5 + (1 - BLOCK) / 2 - R };
// Trays sit far enough apart that, seen from the usual view, each one shows nearly whole between its neighbours.
const gapOf = n => n + 0.4;
// Board directions in the stack's own frame: rows run toward the viewer (+z), columns to the right (+x).
const DIRS = { U: V3(0, 0, -1), R: V3(1, 0, 0), D: V3(0, 0, 1), L: V3(-1, 0, 0) };
const ORDER = ['U', 'R', 'D', 'L'], SCREEN = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] };
const NAMES = { U: 'Up', D: 'Down', L: 'Left', R: 'Right' };
const DEG = Math.PI / 180, YAW = 20 * DEG, PITCH = 44 * DEG, FOV = 26;
const PITCH_MIN = 16 * DEG, PITCH_MAX = 82 * DEG, ZOOM_MAX = 2.5;
const BG = 0.1;
// Motion: the marble's roll down a tipped tray, gravity for its falls, the tip itself, and the lean under a finger.
const ROLL_A = 30, GRAVITY = 36, TIP = 4 * DEG, LEAN_MAX = 4.5 * DEG, LEAN_IN = 120, SETTLE = 340;
const ease = t => t * t * (3 - 2 * t), easeOut = t => 1 - Math.pow(1 - t, 3), clamp01 = t => Math.max(0, Math.min(1, t));

// ---------- Saves ----------
let prefs = { theme: 'dark', motion: 'system', looked: false, hintCount: 0, hintBoard: null };
let boardId = BOARDS[0].id, history = [], done = [], reached = 0, corrupt = false, played = [];
const indexOf = id => BOARDS.findIndex(b => b.id === id), known = id => ALL.some(b => b.id === id);
// Before November 16, 2026 the campaign was all fifty, l01 to l50 in turn, and reached counted in that order.
const OLD_ORDER = ALL.map(b => b.id).sort();
function obstacle(P, s, d) { const [dr, dc] = E.DIRS[d], r = s.row + dr, c = s.col + dc; return r < 0 || c < 0 || r >= P.size || c >= P.size ? 'rim' : 'block'; }
// The rules state after a list of tips, and how the last one ended: against the rim or a block, or on a landing.
function replay(b, moves) {
  const P = E.prepare(b); let s = { level: P.start.level, row: P.start.row, col: P.start.col }, rest = null, solved = false;
  for (const d of moves) {
    if (solved || !DIRS[d]) throw Error('Invalid move');
    const r = E.slide(b, s, d); if (!r.moved) throw Error('Invalid move');
    s = { level: r.level, row: r.row, col: r.col }; solved = r.solved;
    rest = r.path.some(c => c.drop) ? null : { dir: d, kind: obstacle(P, s, d) };
  }
  return { place: s, rest, solved };
}
function readSave() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (_) { return; }
  if (raw === null) return;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || typeof v.board !== 'string' || !Array.isArray(v.moves) || v.moves.length > 5000 || !Array.isArray(v.done) || !v.settings || !['system', 'reduce'].includes(v.settings.motion)) throw Error('Unreadable');
    const s = v.settings, hc = s.hintCount;
    prefs = { theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'dark', motion: s.motion, looked: s.looked === true, hintCount: Number.isInteger(hc) ? Math.max(0, Math.min(2, hc)) : 0, hintBoard: typeof s.hintBoard === 'string' ? s.hintBoard : null };
    // Saves are checked against all fifty boards: a finished mark on a board left out of the campaign stays.
    done = [...new Set(v.done.filter(known))];
    // A save without order 2 counts reached in the fifty-board order: every campaign board it had open stays open.
    const was = Math.min(ALL.length - 1, Math.max(0, Number.isInteger(v.reached) ? v.reached : 0));
    const opened = v.order === 2 ? was : Math.max(...OLD_ORDER.slice(0, was + 1).map(indexOf));
    reached = Math.min(BOARDS.length - 1, Math.max(0, opened, ...done.map(id => indexOf(id) + 1)));
    played = Array.isArray(v.pool) ? [...new Set(v.pool.filter(id => POOL.some(b => b.id === id)))] : [];
    const b = ALL.find(b => b.id === v.board);
    // A player last on a board left out of the campaign goes on from the first campaign board not finished; with the
    // campaign finished, that board is one of the pool and stays, moves and all.
    if (b && (indexOf(b.id) >= 0 ? indexOf(b.id) <= reached : campaignDone())) { boardId = b.id; try { replay(b, v.moves); history = v.moves.slice(); } catch (_) { history = []; } }
    else if (b && indexOf(b.id) < 0) boardId = (BOARDS.find(x => !done.includes(x.id)) || BOARDS[0]).id;
  } catch (_) { corrupt = true; }
}
function save() {
  if (corrupt) return;
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, order: 2, board: boardId, moves: history, done, reached, pool: played, settings: prefs })); } catch (_) {}
}
const reduced = () => prefs.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Renderer and scene ----------
const canvas = $('#scene');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' }); }
catch (_) { canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: 'This puzzle needs WebGL.', className: 'readout' })); throw Error('No WebGL'); }
renderer.setClearColor(new THREE.Color(BG, BG, BG), 1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
const stackRoot = new THREE.Group(); scene.add(stackRoot);

// Shared light: the marble's place in the world, a faint step of light over the whole stack while a tip is pending,
// the depth range for lightness, and the device pixel ratio for hairlines that stay one width on screen.
const U = { uMarble: { value: V3(0, 1, 0) }, uOn: { value: 1 }, uDepth: { value: new THREE.Vector2(20, 8) }, uWhole: { value: 0 }, uDpr: { value: 1 } };
const shared = () => ({ uMarble: U.uMarble, uOn: U.uOn, uDepth: U.uDepth, uWhole: U.uWhole, uDpr: U.uDpr });
const headGLSL = `uniform vec3 uMarble; uniform float uOn; uniform vec2 uDepth; uniform float uWhole; uniform float uDpr; uniform float uK; uniform float uWash;
float deep(vec3 w){ return clamp((distance(cameraPosition, w) - uDepth.x) / uDepth.y, 0.0, 1.0); }
float near(vec3 w){ return mix(1.12, 0.74, deep(w)); }
float hair(float px, float w){ w *= uDpr; return 1.0 - smoothstep(w - 0.6, w + 0.6, px); }`;
const vert = `varying vec3 vL; varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec2 vUv;
void main(){ vL = position; vNo = normal; vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
// Frosted glass veils and dims what lies behind it. The trays are drawn from the lowest up, and the blocks and rims on
// each tray from the farthest to the nearest, so every layer of frost covers exactly what is behind it.
const frost = { transparent: true, depthWrite: false };

// A tray's plate: one layer of frost with an etched grid, real round openings whose cut edges catch the light, a quiet
// dashed ring on each landing cell, and around the bottom tray's opening the double ring, the strongest line in the stack.
function plateMat() {
  return new THREE.ShaderMaterial({ ...frost, side: THREE.FrontSide, vertexShader: vert,
    uniforms: { ...shared(), uK: { value: 1 }, uWash: { value: 0 }, uN: { value: 5 }, uKind: { value: new Float32Array(25) }, uHole: { value: HOLE } },
    fragmentShader: `${headGLSL} uniform float uN; uniform float uKind[25]; uniform float uHole; varying vec3 vL; varying vec3 vW; varying vec3 vN; varying vec3 vNo;
void main(){
 vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(n, v));
 float k = uK * near(vW) * (1.0 + 0.7 * uWash);
 vec3 d = vW - uMarble; float r2 = dot(d, d) + 0.004; float pool = uOn * 0.02 * (abs(d.y) + 0.05) / (r2 * sqrt(r2));
 float c, a;
 if (vNo.y > 0.5) {
  vec2 p = vL.xz + 0.5 * uN;
  c = (0.25 + 0.08 * f * f) * k; a = 0.38;
  vec2 fw = max(fwidth(p), vec2(1e-6)), g = (0.5 - abs(fract(p) - 0.5)) / fw;
  float gx = hair(g.x, 0.4) * step(0.5, min(p.x, uN - p.x)) * step(0.0, p.y) * step(p.y, uN);
  float gy = hair(g.y, 0.4) * step(0.5, min(p.y, uN - p.y)) * step(0.0, p.x) * step(p.x, uN);
  float grid = max(gx, gy); c += 0.045 * grid * k; a = mix(a, 0.5, grid);
  vec2 cell = clamp(floor(p), 0.0, uN - 1.0); float kind = uKind[int(cell.y * uN + cell.x + 0.5)];
  vec2 q = p - cell - 0.5; float r = length(q), rw = max(fwidth(r), 1e-6), mark = 0.0, mc = 0.0;
  if (kind > 0.5 && kind < 1.5) { mark = hair((r - uHole) / rw, 0.7); mc = 0.62 * k; }
  else if (kind > 1.5 && kind < 2.5) {
   float s = atan(q.y, q.x) / 6.2831853 * 14.0, sw = max(fwidth(s), 1e-4), dash = 1.0 - smoothstep(0.5 - sw, 0.5 + sw, abs(fract(s) - 0.5) * 2.0 + 0.1);
   mark = hair(abs(r - 0.25) / rw, 0.65) * dash; mc = 0.36 + 0.14 * k; }
  else if (kind > 2.5) { mark = max(hair((r - uHole) / rw, 0.8), max(hair(abs(r - 0.395) / rw, 1.05), hair(abs(r - 0.47) / rw, 0.85))); mc = 0.88; }
  c = mix(c, max(c, mc), mark); a = mix(a, 0.96, mark);
  c += pool; a = min(1.0, a + 0.6 * pool);
 } else if (vNo.y < -0.5) { discard; }
 else { c = (0.42 + 0.3 * f) * k + 0.6 * pool; a = 0.86; }
 c += 0.05 * uWhole * k;
 gl_FragColor = vec4(vec3(c), a); }` });
}
// Blocks and rims: frosted glass boxes. Tops catch the room's overhead light, faces that see the marble catch its
// light, and every edge is a hairline; the far faces show through the near ones, dimmer.
function boxMat() {
  return new THREE.ShaderMaterial({ ...frost, side: THREE.DoubleSide, vertexShader: vert, uniforms: { ...shared(), uK: { value: 1 }, uWash: { value: 0 } },
    fragmentShader: `${headGLSL} varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec2 vUv;
void main(){
 vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(n, v));
 float k = uK * near(vW) * (1.0 + 0.5 * uWash);
 vec3 d = uMarble - vW; float r2 = dot(d, d) + 0.01, lam = max(dot(gl_FrontFacing ? n : -n, normalize(d)), 0.0), glow = uOn * 0.045 * lam / r2;
 float top = step(0.5, vNo.y);
 float c = (mix(0.27, 0.4, top) + 0.1 * f * f) * k + glow, a = mix(0.48, 0.56, top);
 vec2 e = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-6)); float edge = hair(min(e.x, e.y), 0.6);
 c = mix(c, 0.64 * k + glow, edge); a = mix(a, 0.94, edge);
 if (!gl_FrontFacing) { c *= 0.7; a *= 0.75; }
 c += 0.05 * uWhole * k;
 gl_FragColor = vec4(vec3(c), a); }` });
}
// The posts and their ball feet: thin frosted rods, light at their silhouettes like glass.
function postMat() {
  return new THREE.ShaderMaterial({ ...frost, side: THREE.FrontSide, vertexShader: vert, uniforms: { ...shared(), uK: { value: 1 }, uWash: { value: 0 } },
    fragmentShader: `${headGLSL} varying vec3 vW; varying vec3 vN;
void main(){ vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(n, v));
 float k = uK * near(vW) * (1.0 + 0.4 * uWash); gl_FragColor = vec4(vec3((0.3 + 0.36 * pow(f, 1.2)) * k), 0.55 + 0.35 * f); }` });
}
// The floor: a charcoal room under a soft overhead light, a little darker under the frosted trays, darker still where
// each foot touches, and lit by the marble, more as it comes down toward it.
const floorMat = new THREE.ShaderMaterial({ uniforms: { uMarble: U.uMarble, uOn: U.uOn, uTrans: { value: 0.5 }, uStack: { value: new THREE.Vector2() }, uHalf: { value: 2.6 }, uContact: { value: 1 }, uGlow: { value: 0 }, uRoom: { value: 6 }, uFootR: { value: FOOT_R }, uFeet: { value: Array.from({ length: 4 }, () => V3()) } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec3 uMarble; uniform float uOn; uniform float uTrans; uniform vec2 uStack; uniform float uHalf; uniform float uContact; uniform float uGlow; uniform float uRoom; uniform float uFootR; uniform vec3 uFeet[4]; varying vec3 vW;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){ vec2 p = vW.xz, o = p - uStack; float amb = ${Math.pow(BG, 2.2).toFixed(5)} + 0.055 * exp(-dot(o, o) / (uRoom * uRoom));
 vec2 q = abs(o) - vec2(uHalf); float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); float under = 1.0 - smoothstep(-0.8, 1.2, sd);
 vec3 d = vec3(p.x, 0.0, p.y) - uMarble; float h = max(uMarble.y, 0.03), r2 = dot(d, d);
 float e = uOn * uTrans * 0.32 * h / (r2 * sqrt(r2)); float lit = 0.26 * (1.0 - exp(-e * 0.8));
 float touch = 0.0; for (int i = 0; i < 4; i++) { float k = length(p - uFeet[i].xy) - uFootR; touch = max(touch, uFeet[i].z * exp(-pow(max(k, 0.0) / 0.06, 2.0))); }
 float c = (amb * (1.0 - 0.18 * under * uContact) + lit) * (1.0 - 0.35 * touch) + uGlow * 0.012 * exp(-max(sd, 0.0) * 1.2);
 c = pow(c, 1.0 / 2.2) + (hash(gl_FragCoord.xy) - 0.5) / 255.0; gl_FragColor = vec4(vec3(max(c, 0.0)), 1.0); }` });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMat);
floor.rotation.x = -Math.PI / 2; floor.renderOrder = -10; scene.add(floor);

// ---------- The marble (after Cube Maze) ----------
// The marble is drawn last, against what really lies in front of it, pixel by pixel. In the open, or seen through a
// round opening, it is a white ball at its true size with a hard edge, a thin dark rim and a thin bright outer ring.
// Behind frosted glass (a plate, a block or a rim) it is a soft, milky disc with no hard rim, still the brightest thing
// near it. Behind a post or a foot only a thin outline ring of it shows. Just before the marble, everything near it on
// screen and nearer than its front is drawn again into the stencil buffer only: frost sets the low bit, anything solid
// the top bit. The ring keeps it at least about 16 CSS pixels across when fitted and falls back to the ball's own edge
// as it is zoomed in.
const OCC = { uMz: { value: 1 }, uOccC: { value: new THREE.Vector2() }, uOccR: { value: 0 } };
function occluderMat(solid) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, colorWrite: false, side: THREE.DoubleSide, uniforms: OCC,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilRef: solid ? 0x80 : 1, stencilWriteMask: solid ? 0x80 : 1, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    vertexShader: `varying float vZ; void main(){ vec4 v = modelViewMatrix * vec4(position, 1.0); vZ = -v.z; gl_Position = projectionMatrix * v; }`,
    fragmentShader: `uniform float uMz; uniform vec2 uOccC; uniform float uOccR; varying float vZ; void main(){ if (vZ >= uMz || distance(gl_FragCoord.xy, uOccC) > uOccR) discard; gl_FragColor = vec4(0.0); }` });
}
const frostOcc = occluderMat(false), solidOcc = occluderMat(true);
function twin(mesh, mat) { const t = new THREE.Mesh(mesh.geometry, mat); t.renderOrder = 8000; t.frustumCulled = false; mesh.add(t); return t; }
const seen = stencilFunc => ({ stencilWrite: true, stencilWriteMask: 0, stencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
const markerVert = `uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ vP = position.xy * (uRing + 3.0 * uPx); vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += vP; gl_Position = projectionMatrix * mv; }`;
const markerU = { uR: { value: R }, uRim: { value: R * 1.3 }, uRing: { value: R * 1.5 }, uPx: { value: 0.01 } };
const ballMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerU, ...seen(THREE.EqualStencilFunc), stencilRef: 0, stencilFuncMask: 0x81,
  vertexShader: markerVert,
  fragmentShader: `uniform float uR; uniform float uRim; uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ float r = length(vP), aa = max(fwidth(r), 1e-5) * 0.75;
 float ball = 1.0 - smoothstep(uR - aa, uR + aa, r), rim = 1.0 - smoothstep(uRim - aa, uRim + aa, r), ring = 1.0 - smoothstep(0.55 * uPx - aa, 0.55 * uPx + aa, abs(r - uRing));
 vec3 c = mix(vec3(0.03), vec3(1.0 - 0.1 * smoothstep(0.6 * uR, uR, r)), ball); c = mix(c, vec3(0.92), ring * (1.0 - rim));
 gl_FragColor = vec4(c, max(max(ball, rim), ring)); }` });
const milkMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerU, ...seen(THREE.EqualStencilFunc), stencilRef: 1, stencilFuncMask: 0x81,
  vertexShader: markerVert,
  fragmentShader: `uniform float uR; uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ float Rr = max(uR * 1.2, 0.78 * uRing), r = length(vP) / Rr;
 float k = 1.0 - smoothstep(0.4, 1.0, r); gl_FragColor = vec4(vec3(0.97), 0.93 * k * k * (3.0 - 2.0 * k)); }` });
const outlineMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerU, ...seen(THREE.EqualStencilFunc), stencilRef: 0x80, stencilFuncMask: 0x80,
  vertexShader: markerVert,
  fragmentShader: `uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ float r = length(vP), aa = max(fwidth(r), 1e-5) * 0.75;
 float ring = 1.0 - smoothstep(0.65 * uPx - aa, 0.65 * uPx + aa, abs(r - uRing)), dark = 1.0 - smoothstep(0.6 * uPx - aa, 0.6 * uPx + aa, abs(r - uRing - 1.4 * uPx));
 gl_FragColor = vec4(vec3(0.82 * ring), max(0.9 * ring, 0.45 * dark)); }` });
// A soft bloom: layered glow round the marble, over everything near it.
const bloomMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uGlow: { value: 1 }, uS: { value: 1.9 } },
  vertexShader: `uniform float uS; varying vec2 vP; void main(){ vP = position.xy * uS; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += vP; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uGlow; varying vec2 vP; void main(){ float r = length(vP);
 float b = uGlow * (0.16 * exp(-pow(r / 0.12, 2.0)) + 0.06 * exp(-pow(r / 0.3, 2.0)) + 0.035 * exp(-pow(r / 0.75, 2.0)));
 gl_FragColor = vec4(vec3(b), 1.0); }` });
// One ring of light leaves the marble when a board opens or restarts, so the eye finds it.
const cueMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uRad: { value: 0 }, uW: { value: 0.01 }, uA: { value: 0 }, uS: { value: 1 } },
  vertexShader: `uniform float uS; varying vec2 vP; void main(){ vP = position.xy * uS; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += vP; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uRad; uniform float uW; uniform float uA; varying vec2 vP; void main(){ float d = (length(vP) - uRad) / uW; gl_FragColor = vec4(vec3(uA * exp(-d * d)), 1.0); }` });
const marble = new THREE.Group(), quad = () => new THREE.PlaneGeometry(2, 2);
const bloom = new THREE.Mesh(quad(), bloomMat), ballMesh = new THREE.Mesh(quad(), ballMat), milkMesh = new THREE.Mesh(quad(), milkMat), lineMesh = new THREE.Mesh(quad(), outlineMat), cue = new THREE.Mesh(quad(), cueMat);
bloom.renderOrder = 9000; cue.renderOrder = 9001; ballMesh.renderOrder = milkMesh.renderOrder = lineMesh.renderOrder = 9100;
for (const m of [bloom, ballMesh, milkMesh, lineMesh, cue]) m.frustumCulled = false; cue.visible = false;
marble.add(bloom, cue, ballMesh, milkMesh, lineMesh); stackRoot.add(marble);

// A flat chevron on the marble's tray, just beyond the marble and pointing the way: white for a hint, grey turning white
// for the way a held swipe will tip under reduced motion.
const chevronGeom = (() => { const s = new THREE.Shape([[-0.24, -0.08], [0, 0.16], [0.24, -0.08], [0.24, -0.18], [0, 0.06], [-0.24, -0.18]].map(([x, y]) => new THREE.Vector2(x, y))); return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2); })();
const hintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
const markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.55, 0.55), transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
const hintMark = new THREE.Mesh(chevronGeom, hintMat), wayMark = new THREE.Mesh(chevronGeom, markMat);
hintMark.visible = wayMark.visible = false; stackRoot.add(hintMark, wayMark);

// ---------- Board and display state ----------
let board, puzzle, N = 5, L = 3, G = gapOf(5), par = 0, place = null, solvedNow = false, rest = null;
let levels = [], posts = [], feet = [], kits = [];
const plateMats = [0, 1, 2].map(plateMat), boxMats = [0, 1, 2].map(boxMat), postMats = [0, 1, 2, 3].map(postMat);

// ---------- The light room ----------
// Paper and ink. A pale warm room under one soft key light, high and behind on the left, so the trays, blocks and posts
// throw gentle shadows forward onto the floor. The glass is clear frost with grey hairline edges; holes, landing rings
// and the exit's double ring are grey ink, the top tray's darkest and each tray below a step lighter. There is no bloom.
// The marble is a ball of polished black glass, the darkest thing in the room: one soft highlight from the key light, a
// faint reflection of the pale room toward its rim, and a small contact shadow on its tray.
// The dark room's materials above are untouched; the light room has its own, sharing their uniforms.
const KEYDIR = V3(-0.2, 1, -0.16).normalize(), UL = { uKey: { value: KEYDIR }, uKeyL: { value: KEYDIR.clone() }, uKeyV: { value: V3(0, 0, 1) } };
const inkU = [0, 1, 2, 3].map(() => ({ value: 0.4 }));
const lightHead = `uniform vec3 uMarble; uniform vec2 uDepth; uniform float uWhole; uniform float uDpr; uniform float uWash; uniform float uInk; uniform vec3 uKey; uniform vec3 uKeyL;
const vec3 PAPER = vec3(1.0, 0.99, 0.968);
float deep(vec3 w){ return clamp((distance(cameraPosition, w) - uDepth.x) / uDepth.y, 0.0, 1.0); }
float hair(float px, float w){ w *= uDpr; return 1.0 - smoothstep(w - 0.6, w + 0.6, px); }
float inkAt(vec3 w){ return clamp(uInk + 0.2 * deep(w) - 0.1 * uWash - 0.08 * uWhole, 0.1, 0.92); }`;
const lightFrost = { transparent: true, depthWrite: false };
function plateMatL(k) {
  return new THREE.ShaderMaterial({ ...lightFrost, side: THREE.FrontSide, vertexShader: vert,
    uniforms: { ...plateMats[k].uniforms, uInk: inkU[k], uBlock: { value: new Float32Array(25) }, uKey: UL.uKey, uKeyL: UL.uKeyL },
    fragmentShader: `${lightHead} uniform float uN; uniform float uKind[25]; uniform float uBlock[25]; uniform float uHole; varying vec3 vL; varying vec3 vW; varying vec3 vN; varying vec3 vNo;
float blockAt(vec2 p){ if (p.x < 0.0 || p.y < 0.0 || p.x >= uN || p.y >= uN) return 0.0; vec2 cell = floor(p), q = abs(p - cell - 0.5);
 return uBlock[int(cell.y * uN + cell.x + 0.5)] * (1.0 - smoothstep(0.38, 0.47, max(q.x, q.y))); }
void main(){
 vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(n, v)), ink = inkAt(vW), c, a;
 if (vNo.y > 0.5) {
  vec2 p = vL.xz + 0.5 * uN;
  c = 0.995; a = 0.2 + 0.1 * f * f;
  vec2 fw = max(fwidth(p), vec2(1e-6)), g = (0.5 - abs(fract(p) - 0.5)) / fw;
  float gx = hair(g.x, 0.4) * step(0.5, min(p.x, uN - p.x)) * step(0.0, p.y) * step(p.y, uN);
  float gy = hair(g.y, 0.4) * step(0.5, min(p.y, uN - p.y)) * step(0.0, p.x) * step(p.x, uN);
  float grid = max(gx, gy); c = mix(c, 0.8, 0.75 * grid); a = mix(a, 0.38, grid);
  vec2 cell = clamp(floor(p), 0.0, uN - 1.0); float kind = uKind[int(cell.y * uN + cell.x + 0.5)];
  vec2 q = p - cell - 0.5; float r = length(q), rw = max(fwidth(r), 1e-6), mark = 0.0, mc = 1.0;
  if (kind > 0.5 && kind < 1.5) { mark = hair((r - uHole) / rw, 0.75); mc = ink; }
  else if (kind > 1.5 && kind < 2.5) {
   float s = atan(q.y, q.x) / 6.2831853 * 14.0, sw = max(fwidth(s), 1e-4), dash = 1.0 - smoothstep(0.5 - sw, 0.5 + sw, abs(fract(s) - 0.5) * 2.0 + 0.1);
   mark = hair(abs(r - 0.25) / rw, 0.65) * dash; mc = mix(ink, 1.0, 0.3); }
  else if (kind > 2.5) { mark = max(hair((r - uHole) / rw, 0.8), max(hair(abs(r - 0.395) / rw, 1.05), hair(abs(r - 0.47) / rw, 0.85))); mc = max(0.1, ink - 0.1); }
  c = mix(c, mc, mark); a = mix(a, 0.96, mark);
  // Shadows on the glass: each block's soft shadow on its own tray, thrown away from the key light, and the ball's,
  // tight and dark where it rests and fainter and wider the higher above this tray it is.
  float sh = 0.0;
  for (int i = 1; i <= 4; i++) { float h = 0.2 * float(i); sh = max(sh, (0.2 - 0.03 * float(i)) * blockAt(p + uKeyL.xz / uKeyL.y * h)); }
  float hb = uMarble.y - vW.y;
  if (hb > 0.0) {
   float d = length(vW.xz + uKey.xz / uKey.y * hb - uMarble.xz), lift = max(0.0, hb - ${R.toFixed(3)});
   sh = max(sh, 0.5 * exp(-1.4 * lift) * (1.0 - smoothstep(${(0.45 * R).toFixed(4)}, ${(0.45 * R).toFixed(4)} + 0.08 + 0.35 * lift, d)));
   float u = length(vW.xz - uMarble.xz); sh = max(sh, 0.62 * exp(-6.0 * lift) * exp(-pow(u / ${(0.5 * R).toFixed(4)}, 2.0)));
  }
  c = mix(c, 0.3, sh); a = mix(a, 0.92, sh);
 } else if (vNo.y < -0.5) { discard; }
 else { c = mix(0.9, ink, 0.45 + 0.4 * (1.0 - f)); a = 0.72; }
 gl_FragColor = vec4(PAPER * c, a); }` });
}
// Blocks and rims: clear frost that veils what is behind it toward white; faces turned from the key light read a little
// greyer, and every edge is a grey hairline. The far faces show through, fainter.
function boxMatL(k) {
  return new THREE.ShaderMaterial({ ...lightFrost, side: THREE.DoubleSide, vertexShader: vert,
    uniforms: { ...boxMats[k].uniforms, uInk: inkU[k], uKey: UL.uKey, uKeyL: UL.uKeyL },
    fragmentShader: `${lightHead} varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec2 vUv;
void main(){
 vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(n, v)), ink = inkAt(vW);
 float lit = max(dot(gl_FrontFacing ? n : -n, uKey), 0.0), top = step(0.5, vNo.y), shade = (1.0 - lit) * (1.0 - top);
 float c = 0.99 - 0.12 * shade - 0.03 * (1.0 - lit) * top, a = mix(0.2, 0.13, top) + 0.12 * shade + 0.08 * f * f;
 vec2 e = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-6)); float edge = hair(min(e.x, e.y), 0.6);
 c = mix(c, ink, edge); a = mix(a, 0.92, edge);
 if (!gl_FrontFacing) { c = mix(c, 1.0, 0.35); a *= 0.55; }
 gl_FragColor = vec4(PAPER * c, a); }` });
}
function postMatL(k) {
  return new THREE.ShaderMaterial({ ...lightFrost, side: THREE.FrontSide, vertexShader: vert, uniforms: { ...postMats[k].uniforms, uInk: inkU[k], uKey: UL.uKey, uKeyL: UL.uKeyL },
    fragmentShader: `${lightHead} varying vec3 vW; varying vec3 vN;
void main(){ vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(n, v)), ink = inkAt(vW);
 gl_FragColor = vec4(PAPER * mix(0.96, ink + 0.06, pow(f, 1.1)), 0.32 + 0.5 * f); }` });
}
const plateMatsL = [0, 1, 2].map(plateMatL), boxMatsL = [0, 1, 2].map(boxMatL), postMatsL = [0, 1, 2, 3].map(postMatL);
// The light floor: paper under a soft overhead light, a little darker toward the edges of the room. Each point looks up
// toward the key light through the stack: a frosted plate takes a little light, a rim or a block more, an opening none,
// and the posts and the ball throw soft shadows that widen with height. Feet darken where they touch.
const floorMatL = new THREE.ShaderMaterial({ uniforms: { uMarble: U.uMarble, uKey: UL.uKey, uInv: { value: new THREE.Matrix4() }, uN: { value: 5 }, uL: { value: 3 }, uTop: { value: V3() }, uCells: { value: new Float32Array(75) },
    uPB: { value: Array.from({ length: 4 }, () => V3()) }, uPT: { value: Array.from({ length: 4 }, () => V3()) }, uFeet: floorMat.uniforms.uFeet, uFootR: floorMat.uniforms.uFootR, uStack: floorMat.uniforms.uStack, uHalf: floorMat.uniforms.uHalf, uRoom: { value: 8 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec3 uMarble; uniform vec3 uKey; uniform mat4 uInv; uniform float uN; uniform float uL; uniform vec3 uTop; uniform float uCells[75]; uniform vec3 uPB[4]; uniform vec3 uPT[4]; uniform vec3 uFeet[4]; uniform float uFootR; uniform vec2 uStack; uniform float uHalf; uniform float uRoom; varying vec3 vW;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float kindAt(vec2 cell, int k){ if (cell.x < 0.0 || cell.y < 0.0 || cell.x > uN - 0.5 || cell.y > uN - 0.5) return 0.0; return uCells[k * 25 + int(cell.y * uN + cell.x + 0.5)]; }
// What one tray takes from the key light at stack-local point q, with soft edges b wide: a little through the frosted
// plate, more through a rim or a block, nothing through an opening. Every edge is smooth, so the shadow has no grain.
float trayAt(vec2 q, int k, float b){
 float e = max(abs(q.x), abs(q.y)), h = 0.5 * uN + ${RIM_W.toFixed(3)}, plate = 1.0 - smoothstep(h - b, h + b, e);
 if (plate <= 0.0) return 0.0;
 float rim = smoothstep(0.5 * uN - b, 0.5 * uN + b, e), s = 0.04;
 vec2 p = q + 0.5 * uN, cell = floor(p), c = p - cell - 0.5;
 if (kindAt(cell, k) > 0.5 && kindAt(cell, k) < 1.5) s *= smoothstep(${HOLE.toFixed(3)} - b, ${HOLE.toFixed(3)} + b, length(c));
 vec2 sg = vec2(c.x < 0.0 ? -1.0 : 1.0, c.y < 0.0 ? -1.0 : 1.0); float blk = 0.0;
 for (int j = 0; j < 4; j++) { vec2 cc = cell + vec2(j == 1 || j == 3 ? sg.x : 0.0, j >= 2 ? sg.y : 0.0);
  if (kindAt(cc, k) > 1.5) { vec2 dd = abs(p - cc - 0.5); blk = max(blk, 1.0 - smoothstep(${(BLOCK / 2).toFixed(3)} - b, ${(BLOCK / 2).toFixed(3)} + b, max(dd.x, dd.y))); } }
 return plate * max(mix(s, 0.12, rim), 0.12 * blk * (1.0 - rim)); }
void main(){
 vec2 p = vW.xz, o = p - uStack; float base = 0.885 + 0.08 * exp(-dot(o, o) / (uRoom * uRoom)), lit = 1.0;
 vec3 P = (uInv * vec4(vW, 1.0)).xyz, d = normalize(mat3(uInv) * uKey);
 for (int k = 0; k < 3; k++) {
  if (float(k) >= uL) break;
  float t = (uTop[k] - P.y) / d.y; vec2 q = P.xz + d.xz * t;
  lit *= 1.0 - trayAt(q, k, 0.04 + 0.03 * uTop[k]);
 }
 for (int i = 0; i < 4; i++) {
  vec3 tp = uPT[i] - uKey * (uPT[i].y / uKey.y); vec2 ab = tp.xz - uPB[i].xz, ap = p - uPB[i].xz; float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float dd = length(ap - ab * h), w = 0.03 + 0.08 * h; lit *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, w, dd - ${POST_R.toFixed(3)}));
 }
 float hb = max(uMarble.y, ${R.toFixed(3)}), db = length(p + uKey.xz / uKey.y * hb - uMarble.xz), lift = hb - ${R.toFixed(3)};
 lit *= 1.0 - (0.4 * exp(-0.18 * lift)) * (1.0 - smoothstep(${(0.5 * R).toFixed(4)}, ${(0.5 * R).toFixed(4)} + 0.06 + 0.06 * lift, db));
 lit *= 1.0 - 0.55 * exp(-6.0 * lift) * exp(-pow(length(p - uMarble.xz) / ${(0.55 * R).toFixed(4)}, 2.0));
 float touch = 0.0; for (int i = 0; i < 4; i++) { float k = length(p - uFeet[i].xy) - uFootR; touch = max(touch, uFeet[i].z * exp(-pow(max(k, 0.0) / 0.05, 2.0))); }
 vec2 qq = abs(o) - vec2(uHalf); float sd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0);
 lit *= (1.0 - 0.4 * touch) * (1.0 - 0.07 * (1.0 - smoothstep(-0.5, 1.6, sd)));
 vec3 col = vec3(1.0, 0.985, 0.952) * base * lit + (hash(gl_FragCoord.yx) - 0.5) / 255.0;
 gl_FragColor = vec4(col, 1.0); }` });
// The black ball. In the open, a sphere of polished black glass at its true size with a crisp edge; too small to find
// at a glance, it gains a thin dark ring. Behind frost, a soft dark disc. Behind a post or a foot, a complete dark ring.
const markerUL = { ...markerU, uKeyV: UL.uKeyV, uSmall: { value: 0 }, uSolid: { value: 0 } };
const ballMatL = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerUL, ...seen(THREE.EqualStencilFunc), stencilRef: 0, stencilFuncMask: 0x81, vertexShader: markerVert,
  fragmentShader: `uniform float uR; uniform float uRing; uniform float uPx; uniform vec3 uKeyV; uniform float uSmall; varying vec2 vP; void main(){ float r = length(vP), aa = max(fwidth(r), 1e-5) * 0.75;
 float ball = 1.0 - smoothstep(uR - aa, uR + aa, r);
 vec3 n = vec3(vP / uR, 0.0); n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
 vec3 h = normalize(uKeyV + vec3(0.0, 0.0, 1.0)); float diff = max(dot(n, uKeyV), 0.0), spec = pow(max(dot(n, h), 0.0), 36.0), fres = pow(1.0 - n.z, 2.4);
 float c = 0.014 + 0.028 * diff + 0.17 * fres * (0.45 + 0.55 * clamp(0.5 + 0.5 * n.y, 0.0, 1.0)) + 0.72 * spec;
 float ring = uSmall * (1.0 - smoothstep(0.6 * uPx - aa, 0.6 * uPx + aa, abs(r - uRing)));
 gl_FragColor = vec4(mix(vec3(0.1), vec3(c), ball), max(ball, ring)); }` });
// Behind frost, or behind a glass post, the soft dark disc shows through; a post also brings the complete ring.
const milkMatL = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerUL, ...seen(THREE.NotEqualStencilFunc), stencilRef: 0, stencilFuncMask: 0x81, vertexShader: markerVert,
  fragmentShader: `uniform float uR; uniform float uRing; varying vec2 vP; void main(){ float Rr = max(uR * 1.15, 0.78 * uRing), r = length(vP) / Rr;
 float k = 1.0 - smoothstep(0.4, 1.0, r); gl_FragColor = vec4(vec3(0.08), 0.95 * k * k * (3.0 - 2.0 * k)); }` });
const outlineMatL = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerUL, vertexShader: markerVert,
  fragmentShader: `uniform float uRing; uniform float uPx; uniform float uSolid; varying vec2 vP; void main(){ float r = length(vP), aa = max(fwidth(r), 1e-5) * 0.75;
 float ring = 1.0 - smoothstep(0.75 * uPx - aa, 0.75 * uPx + aa, abs(r - uRing)); gl_FragColor = vec4(vec3(0.1), uSolid * ring); }` });
const cueMatL = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: cueMat.uniforms,
  vertexShader: cueMat.vertexShader,
  fragmentShader: `uniform float uRad; uniform float uW; uniform float uA; varying vec2 vP; void main(){ float d = (length(vP) - uRad) / uW; gl_FragColor = vec4(vec3(0.2), uA * exp(-d * d)); }` });
let lightOn = false;
const lightMQ = matchMedia('(prefers-color-scheme: light)');
const isLight = () => prefs.theme === 'light' || (prefs.theme === 'system' && lightMQ.matches);
// The hint, and the way under reduced motion, in each room: white and grey turning white in the dark, ink and pale
// grey turning ink in the light.
const hintShade = () => lightOn ? 0.26 : 1, wayShade = on => lightOn ? (on ? 0.26 : 0.62) : (on ? 0.96 : 0.55);
// Puts every surface in its room's material.
function dress() {
  const pick = (d, l) => lightOn ? l : d;
  floor.material = pick(floorMat, floorMatL);
  levels.forEach((lv, k) => { lv.plate.material = pick(plateMats[k], plateMatsL[k]); for (const m of lv.items) m.material = pick(boxMats[k], boxMatsL[k]); });
  for (const m of posts) m.material = pick(postMats[m.userData.level + 1], postMatsL[m.userData.level + 1]);
  for (const f of feet) f.material = pick(postMats[L], postMatsL[L]);
  ballMesh.material = pick(ballMat, ballMatL); milkMesh.material = pick(milkMat, milkMatL); lineMesh.material = pick(outlineMat, outlineMatL); cue.material = pick(cueMat, cueMatL);
  lineMesh.renderOrder = lightOn ? 9101 : 9100; bloom.visible = !lightOn;
  hintMat.color.setScalar(hintShade()); markMat.color.setScalar(wayShade(armed));
  if (lightOn) renderer.setClearColor(new THREE.Color(0.885 * 1.0, 0.885 * 0.985, 0.885 * 0.952), 1); else renderer.setClearColor(new THREE.Color(BG, BG, BG), 1);
}
// Is the ball's centre behind a post or a foot? Then the light room draws its complete ring.
function solidCover() {
  const cam = camera.position, m = U.uMarble.value, a = new THREE.Vector3(), b = new THREE.Vector3(), seg = new THREE.Line3(cam, m), on = new THREE.Vector3(), at = new THREE.Vector3();
  for (const p of posts) {
    p.updateMatrixWorld(); const half = p.geometry.parameters.height / 2; a.set(0, -half, 0).applyMatrix4(p.matrixWorld); b.set(0, half, 0).applyMatrix4(p.matrixWorld);
    // closest points between the sight line and the post's axis, sampled finely along the post
    for (let i = 0; i <= 24; i++) { at.lerpVectors(a, b, i / 24); seg.closestPointToPoint(at, true, on); if (on.distanceTo(at) < POST_R + 0.25 * R && on.distanceTo(m) > R) return 1; }
  }
  for (const f of feet) { f.getWorldPosition(at); seg.closestPointToPoint(at, true, on); if (on.distanceTo(at) < FOOT_R + 0.25 * R && on.distanceTo(m) > R) return 1; }
  return 0;
}
const marbleLocal = V3(), leanVec = V3(), leanGoal = V3();
let anim = null, queue = [], undoStack = [], showNext = false, hint = null, wayDir = null;
// True from the solve that finished the last open board until another board opens.
let finale = false;
let pxWorld = 0.01, cueState = null, cueCount = 0;
const plateBottom = k => H0 + (L - 1 - k) * G, topY = k => plateBottom(k) + T;
const cx = col => col - (N - 1) / 2, cz = row => row - (N - 1) / 2;
const reach = () => N / 2 + RIM_W / 2; // the posts stand at the rims' corners
// The lightness each tray steps back by: the top tray is the strongest, each one below a step quieter.
const levelK = k => (L === 2 ? [1, 0.8] : [1, 0.84, 0.7])[k];
// Plates step back less than the blocks on them, so every tray still reads as frost against the floor.
const plateK = k => [1, 0.9, 0.8][k];

const plateGeomCache = new Map();
function plateGeom(k) {
  const key = boardId + ':' + k; if (plateGeomCache.has(key)) return plateGeomCache.get(key);
  const h = N / 2 + RIM_W, s = new THREE.Shape([[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => new THREE.Vector2(x, y)));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (puzzle.grid[k][r][c] === 'o') { const p = new THREE.Path(); p.absarc(cx(c), -cz(r), HOLE, 0, Math.PI * 2, true); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2);
  plateGeomCache.set(key, g); return g;
}
const boxCache = new Map(), boxGeom = (x, y, z) => { const k = [x, y, z].map(v => v.toFixed(4)).join(); if (!boxCache.has(k)) boxCache.set(k, new THREE.BoxGeometry(x, y, z)); return boxCache.get(k); };
const postCache = new Map(), postGeom = len => { const k = len.toFixed(4); if (!postCache.has(k)) postCache.set(k, new THREE.CylinderGeometry(POST_R, POST_R, len, 14, 1, true)); return postCache.get(k); };
const footGeom = new THREE.SphereGeometry(FOOT_R, 18, 12);

function clearStack() {
  for (const o of [...stackRoot.children]) if (o !== marble && o !== hintMark && o !== wayMark) stackRoot.remove(o);
  levels = []; posts = []; feet = []; kits = [];
}
function buildBoard() {
  clearStack();
  board = ALL.find(b => b.id === boardId); puzzle = E.prepare(board); N = puzzle.size; L = puzzle.levels; G = gapOf(N); par = E.par(board);
  for (let k = 0; k < L; k++) {
    const pm = plateMats[k], bm = boxMats[k]; pm.uniforms.uK.value = plateK(k); bm.uniforms.uK.value = levelK(k); pm.uniforms.uN.value = N;
    const kinds = pm.uniforms.uKind.value; kinds.fill(0);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const ch = puzzle.grid[k][r][c], above = k > 0 && puzzle.grid[k - 1][r][c] === 'o';
      kinds[r * N + c] = ch === 'o' ? (k === L - 1 ? 3 : 1) : above ? 2 : 0;
    }
    const plate = new THREE.Mesh(plateGeom(k), pm); plate.position.y = plateBottom(k); const veils = [twin(plate, frostOcc)];
    plate.userData = { level: k, kind: 'plate' }; stackRoot.add(plate);
    const items = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (puzzle.grid[k][r][c] === '#') {
      const b = new THREE.Mesh(boxGeom(BLOCK, BLOCK, BLOCK), bm); b.position.set(cx(c), topY(k) + BLOCK / 2, cz(r)); twin(b, frostOcc);
      b.userData = { level: k, kind: 'block', row: r, col: c }; items.push(b);
    }
    const o = N / 2 + RIM_W / 2, y = topY(k) + RIM_H / 2;
    for (const [x, z, sx, sz] of [[0, -o, N + 2 * RIM_W, RIM_W], [0, o, N + 2 * RIM_W, RIM_W], [-o, 0, RIM_W, N], [o, 0, RIM_W, N]]) {
      const m = new THREE.Mesh(boxGeom(sx, RIM_H, sz), bm); m.position.set(x, y, z); veils.push(twin(m, frostOcc)); m.userData = { level: k, kind: 'rim' }; items.push(m);
    }
    for (const m of items) stackRoot.add(m);
    levels.push({ plate, items, veils });
  }
  // Four posts carry the trays at the rims' corners and stand on ball feet. Each run between two trays is its own piece,
  // so it is drawn in its place among the layers of frost.
  const P = reach();
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let k = L - 1; k >= 0; k--) {
      const y0 = k === L - 1 ? FOOT_R : topY(k + 1) + RIM_H, y1 = plateBottom(k), m = new THREE.Mesh(postGeom(y1 - y0), postMats[k + 1]);
      m.position.set(sx * P, (y0 + y1) / 2, sz * P); twin(m, solidOcc); m.userData = { level: k, kind: 'post' }; stackRoot.add(m); posts.push(m);
    }
    const f = new THREE.Mesh(footGeom, postMats[L]); f.position.set(sx * P, FOOT_R, sz * P); twin(f, solidOcc); f.userData = { level: L, kind: 'foot' }; stackRoot.add(f); feet.push(f);
  }
  for (let k = 0; k <= L; k++) postMats[k].uniforms.uK.value = k < L ? levelK(Math.max(0, k - 1)) * 0.95 : levelK(L - 1) * 0.9;
  floorMat.uniforms.uHalf.value = N / 2 + RIM_W; floorMat.uniforms.uRoom.value = 1.1 * N + 2.5; floorMat.uniforms.uFootR.value = FOOT_R;
  // The light room's ink by tray, its blocks for their shadows on the glass, and what each tray lets through to the floor.
  const ink = L === 2 ? [0.34, 0.5] : [0.34, 0.47, 0.58];
  for (let k = 0; k <= 3; k++) inkU[k].value = k < L ? ink[k] : ink[L - 1] + 0.05;
  const fl = floorMatL.uniforms, cells = fl.uCells.value; cells.fill(0); fl.uN.value = N; fl.uL.value = L; fl.uRoom.value = 1.1 * N + 2.5;
  fl.uTop.value.set(topY(0), L > 1 ? topY(1) : 0, L > 2 ? topY(2) : 0);
  for (let k = 0; k < L; k++) {
    const blocks = plateMatsL[k].uniforms.uBlock.value; blocks.fill(0);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const ch = puzzle.grid[k][r][c]; blocks[r * N + c] = ch === '#' ? 1 : 0; cells[k * 25 + r * N + c] = ch === 'o' ? 1 : ch === '#' ? 2 : 0; }
  }
  dress();
  fit();
}

// The marble's resting place: on its tray, touching whatever stopped it, or on the floor under the exit once it is out.
function restLocal(s, rst, out) {
  if (out) return V3(cx(s.col), R, cz(s.row));
  const p = V3(cx(s.col), topY(s.level) + R, cz(s.row));
  if (rst) p.addScaledVector(DIRS[rst.dir], CONTACT[rst.kind]);
  return p;
}
// Shows the rules state at once: after loading, undo, restart or a board change.
function syncAll() {
  const r = replay(board, history); place = r.place; solvedNow = r.solved; rest = r.rest;
  anim = null; leanVec.set(0, 0, 0); leanGoal.set(0, 0, 0); hideWay();
  if (solvedNow && history.length) fallThrough(replay(board, history.slice(0, -1)).place.level, L - 1); else fallThrough(1, 0);
  marbleLocal.copy(restLocal(place, rest, solvedNow));
  if (solvedNow) settleWash(); else setWash(0);
  showNext = solvedNow;
  updateUI(); kick();
}

// ---------- Placement each frame ----------
function placeStack() {
  // A lean tips the whole stack toward one side on the two feet there, which stay on the floor.
  stackRoot.position.set(0, 0, 0); stackRoot.quaternion.identity();
  const th = leanVec.length();
  if (th > 1e-6) {
    const w = leanVec.clone().divideScalar(th), e = w.clone().multiplyScalar(reach() / Math.max(Math.abs(w.x), Math.abs(w.z))); e.y = FOOT_R;
    const Q = new THREE.Quaternion().setFromAxisAngle(V3().crossVectors(UP, w).normalize(), th);
    stackRoot.position.copy(e).negate().applyQuaternion(Q).add(e); stackRoot.quaternion.copy(Q);
  }
  stackRoot.updateMatrixWorld(true);
  marble.position.copy(marbleLocal);
  // Below the bottom tray the marble has left the stack: it falls to the floor and lies there on its own, so a lean
  // of the stack carries it less and less on the way down and not at all once it is out. (It used to ride the lean
  // on the floor, and crept sideways for a few frames after landing while the stack came level.)
  if (th > 1e-6 && marbleLocal.y < plateBottom(L - 1)) {
    const out = ease(clamp01((plateBottom(L - 1) - marbleLocal.y) / (plateBottom(L - 1) - R)));
    marble.position.copy(stackRoot.worldToLocal(stackRoot.localToWorld(marbleLocal.clone()).lerp(marbleLocal, out)));
  }
  marble.updateMatrixWorld(true); marble.getWorldPosition(U.uMarble.value);
  const depth = Math.max(0.5, -U.uMarble.value.clone().applyMatrix4(camera.matrixWorldInverse).z);
  pxWorld = 2 * depth * Math.tan(FOV * Math.PI / 360) / (viewH * look.zoom);
  const bu = markerU; bu.uPx.value = pxWorld; bu.uR.value = R; bu.uRim.value = Math.max(R + 1.6 * pxWorld, 6.6 * pxWorld); bu.uRing.value = Math.max(bu.uRim.value + 0.9 * pxWorld, 7.5 * pxWorld);
  // What lies in front of the marble is judged against its front, within its marker's reach on screen; the tray it
  // rests on is never in front of it.
  const ms = toScreen(U.uMarble.value), dpr = renderer.getPixelRatio(); OCC.uMz.value = depth - R; OCC.uOccC.value.set(ms.x * dpr, (viewH - ms.y) * dpr); OCC.uOccR.value = (bu.uRing.value / pxWorld + 4) * dpr;
  const fu = floorMat.uniforms; fu.uStack.value.set(stackRoot.position.x, stackRoot.position.z); fu.uContact.value = Math.max(0, 1 - th * 3);
  // Light from the marble reaches the floor through each frosted plate below it, a little less through each.
  let below = 0; if (marbleLocal.y > T + R * 0.5) for (let k = 0; k < L; k++) if (topY(k) < marbleLocal.y - R * 0.5) below++;
  fu.uTrans.value = Math.pow(0.62, below);
  feet.forEach((f, i) => { const t = f.getWorldPosition(V3()); fu.uFeet.value[i].set(t.x, t.z, clamp01(1 - (t.y - FOOT_R) / (0.6 * FOOT_R))); });
  U.uDpr.value = dpr;
  // The light room: the key light in the stack's own frame and in the view, the stack for the floor's shadows, the
  // posts from foot to top, and how the ball shows when it is small or behind a post.
  UL.uKeyL.value.copy(KEYDIR).applyQuaternion(stackRoot.quaternion.clone().invert()); UL.uKeyV.value.copy(KEYDIR).transformDirection(camera.matrixWorldInverse);
  if (lightOn) {
    const fl = floorMatL.uniforms; fl.uInv.value.copy(stackRoot.matrixWorld).invert();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => { stackRoot.localToWorld(fl.uPB.value[i].set(sx * reach(), FOOT_R, sz * reach())); stackRoot.localToWorld(fl.uPT.value[i].set(sx * reach(), topY(0) + RIM_H, sz * reach())); });
    markerUL.uSmall.value = R / pxWorld < 6.5 ? 1 : 0; markerUL.uSolid.value = solidCover();
  }
  // The stand-in for the input layer's tap: the marble's place and size on screen.
  const px = Math.max(8, bu.uRing.value / pxWorld), st = proxy.style; st.width = st.height = (2 * px).toFixed(1) + 'px'; st.transform = 'translate(' + (ms.x - px).toFixed(1) + 'px,' + (ms.y - px).toFixed(1) + 'px)';
}
const proxy = $('.marble');

// Frost covers what is behind it, so order matters: the floor, then each tray from the lowest up, each with the posts
// under it first, then its plate, then its blocks and rims from the farthest to the nearest.
function sortGlass() {
  const cam = stackRoot.worldToLocal(camera.position.clone());
  for (let k = 0; k < L; k++) {
    const base = (L - k) * 1000, lv = levels[k];
    lv.plate.renderOrder = base + 2;
    lv.items.map(m => [m, m.position.distanceToSquared(cam)]).sort((a, b) => b[1] - a[1]).forEach(([m], i) => { m.renderOrder = base + 10 + i; });
    // The hint and the way under reduced motion lie on the marble's tray and are drawn over its blocks, so a block in
    // front never hides them; the trays above still veil them.
    if (place && place.level === k) hintMark.renderOrder = wayMark.renderOrder = base + 900;
  }
  for (const m of posts) m.renderOrder = (L - m.userData.level) * 1000 + 1;
  for (const f of feet) f.renderOrder = 1;
}

// The arrival cue: a ring of light grows from the marble and fades (about 700 ms); with reduced motion a still ring
// stands round it for a second.
function arrival() { cueCount++; cueState = { t0: performance.now(), still: reduced() }; if (cueState.still) setTimeout(kick, 1050); kick(); }
function stepCue(now) {
  if (!cueState) { cue.visible = false; return false; }
  const t = (now - cueState.t0) / (cueState.still ? 1000 : 700), r = ballMat.uniforms.uRing.value;
  if (t >= 1) { cueState = null; cue.visible = false; return false; }
  const rad = cueState.still ? r * 2 : r * (1.3 + 5.5 * easeOut(t)), w = 1.3 * pxWorld, u = cueMat.uniforms;
  u.uRad.value = rad; u.uW.value = w; u.uA.value = cueState.still ? 0.85 : 0.95 * Math.pow(1 - t, 1.3); u.uS.value = rad + 5 * w; cue.visible = true;
  return !cueState.still;
}

// ---------- Rendering on demand ----------
let raf = 0, lastNow = 0;
function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0; if (document.hidden) { lastNow = 0; return; }
  const dt = lastNow ? Math.min(64, now - lastNow) : 16; lastNow = now;
  let more = false;
  if (anim) more = stepAnim(now);
  if (!anim || !anim.leans) {
    if (leanVec.distanceToSquared(leanGoal) > 1e-9) { if (reduced()) leanVec.copy(leanGoal); else leanVec.lerp(leanGoal, 1 - Math.exp(-dt / 60)); more = true; } else leanVec.copy(leanGoal);
  }
  if (look.anim) more = stepLook(now) || more;
  placeStack(); sortGlass(); more = stepCue(now) || more;
  renderer.render(scene, camera);
  if (more || anim) { if (!raf) raf = requestAnimationFrame(frame); } else if (!raf) lastNow = 0;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

// ---------- Animation phases ----------
function play(phases) {
  phases = phases.filter(Boolean);
  if (!phases.length) { afterAnim(); return; }
  if (reduced()) { for (const p of phases) { p.begin?.(); p.update?.(1); p.end?.(); } anim = null; afterAnim(); return; }
  anim = { phases, i: 0, t0: performance.now(), leans: !!phases[0].leans }; phases[0].begin?.(); kick();
}
function stepAnim(now) {
  while (anim) {
    const ph = anim.phases[anim.i], t = ph.duration ? clamp01((now - anim.t0) / ph.duration) : 1;
    anim.leans = !!ph.leans; ph.update?.(t, now);
    if (t < 1) return true;
    ph.end?.(); anim.i++; anim.t0 = now;
    if (anim.i >= anim.phases.length) { anim = null; afterAnim(); return false; }
    anim.phases[anim.i].begin?.();
  }
  return false;
}
function fastForward() {
  if (!anim) return; const a = anim; anim = null; const ph = a.phases[a.i]; ph.update?.(1); ph.end?.();
  for (let i = a.i + 1; i < a.phases.length; i++) { a.phases[i].begin?.(); a.phases[i].update?.(1); a.phases[i].end?.(); }
}
function afterAnim() { updateUI(); drain(); if (lookHintDue && !busy()) maybeLookHint(); kick(); }

// The lean during a tip: in toward the low side, held while the marble rolls, then back to level once it stops or drops.
function leanAt(tau, lean0, w, tHold, peak = TIP) {
  const tin = LEAN_IN / 1000, top = w.clone().multiplyScalar(peak);
  const at = Math.min(tau, tHold), inV = lean0.clone().lerp(top, easeOut(clamp01(at / tin)));
  if (tau <= tHold) return inV;
  return inV.multiplyScalar(1 - ease(clamp01((tau - tHold) / (SETTLE / 1000))));
}
// A tray the marble is falling through does not veil it: neither its plate nor its low rim. Without this they count as
// in front of the marble from the instant its front passes below the glass, and for a few frames the marble shows half
// clear through the opening and half as a milky blur cut along the opening's edge, then snaps back as it clears the
// tray. The veil returns when the marble comes to rest: under that tray it then reads as under glass, in one step.
// Blocks keep their veil throughout; they stand tall enough that a marble passing behind one should look it.
// Out on the floor the marble keeps the clear look it fell with: the trays it left by stay unveiled while the board
// is solved, so nothing changes in the frame it lands. A marble that lands on a tray is under glass again at once.
function fallThrough(first, last) { levels.forEach((lv, k) => { const on = !(k >= first && k <= last); for (const v of lv.veils) v.visible = on; }); }
// One tip that moves the marble. It rolls from rest with a steady acceleration down the tipped tray. It stops dead
// against a block or the rim; over a hole it dips in, the far edge catches it, and it falls straight down the column
// with gravity onto the tray below, through any further holes, and out of the exit to the floor.
function movePhase(d, from, r, start) {
  // The hole it leaves this tray by: the cell before the path's first drop, or, on the bottom tray, the exit itself.
  // The rules list no drop below the bottom tray, so the exit is told by the move being the solving one; without
  // this a marble that rolled to the exit along the bottom tray stopped over it and was on the floor a frame later.
  const w = DIRS[d], k0 = from.level, firstDrop = r.path.findIndex(c => c.drop), holeAt = firstDrop >= 0 ? firstDrop - 1 : r.solved ? r.path.length - 1 : -1, dropping = holeAt >= 0;
  const endCell = dropping ? r.path[holeAt] : r.path[r.path.length - 1];
  const end = V3(cx(endCell.col), topY(k0) + R, cz(endCell.row));
  if (!dropping) end.addScaledVector(w, CONTACT[obstacle(puzzle, endCell, d)]);
  const rel = start.clone().sub(end); rel.y = 0; const D = Math.max(0, -rel.dot(w)), perp = rel.clone().addScaledVector(w, D);
  let tEdge = 0, tStop, horiz;
  if (!dropping) { tStop = Math.sqrt(2 * D / ROLL_A); horiz = t => Math.min(D, 0.5 * ROLL_A * t * t); }
  else {
    const sEdge = Math.max(0, D - (HOLE - 0.05)), left = D - sEdge; tEdge = Math.sqrt(2 * sEdge / ROLL_A); const vEdge = ROLL_A * tEdge, th = vEdge > 1e-3 ? 2 * left / vEdge : 0.12;
    tStop = tEdge + th;
    horiz = t => t <= tEdge ? 0.5 * ROLL_A * t * t : t >= tStop ? D : vEdge > 1e-3 ? sEdge + vEdge * (t - tEdge) - 0.5 * (vEdge / th) * (t - tEdge) ** 2 : sEdge + left * ease((t - tEdge) / th);
  }
  // The fall: free fall, then a soft stop over its last few hundredths, so it lands without a bounce.
  const y0 = topY(k0) + R, y1 = r.solved ? R : topY(r.level) + R, Lf = dropping ? y0 - y1 : 0;
  const L1 = Lf * 0.94, v1 = Math.sqrt(2 * GRAVITY * L1), t1 = Math.sqrt(2 * L1 / GRAVITY), t2 = v1 ? 2 * (Lf - L1) / v1 : 0, Tf = t1 + t2;
  const fall = u => u <= 0 ? 0 : u < t1 ? 0.5 * GRAVITY * u * u : u < Tf ? L1 + v1 * (u - t1) - 0.5 * (v1 / (t2 || 1)) * (u - t1) ** 2 : Lf;
  const tMarble = dropping ? Math.max(tStop, tEdge + Tf) : tStop, tHold = dropping ? tEdge : tStop, total = Math.max(tMarble, tHold + SETTLE / 1000);
  let lean0;
  const ph = { duration: total * 1000, leans: true, live: true,
    begin() { lean0 = leanVec.clone(); leanGoal.set(0, 0, 0); if (dropping) fallThrough(k0, r.solved ? L - 1 : r.level - 1); },
    update(t) {
      const tau = t * total, s = horiz(tau), k = D > 1e-6 ? clamp01(s / D) : 1;
      marbleLocal.copy(end).addScaledVector(w, -(D - s)).addScaledVector(perp, 1 - ease(clamp01(k / 0.6)));
      marbleLocal.y = y0 - (dropping ? fall(tau - tEdge) : 0);
      if (!reduced()) leanVec.copy(leanAt(tau, lean0, w, tHold)); else leanVec.set(0, 0, 0);
    },
    end() { place = { level: r.level, row: r.row, col: r.col }; rest = dropping ? null : { dir: d, kind: obstacle(puzzle, endCell, d) }; marbleLocal.copy(restLocal(place, rest, r.solved)); leanVec.set(0, 0, 0); if (!r.solved) fallThrough(1, 0); } };
  return ph;
}
// A tip the rules refuse still tips the stack and lets it settle, so the gesture is seen to land; a marble not yet
// touching what blocks it rolls up against it.
function refusePhase(d) {
  const w = DIRS[d], start = marbleLocal.clone(), to = restLocal(place, { dir: d, kind: obstacle(puzzle, place, d) }, false);
  const along = Math.max(0, to.clone().sub(start).dot(w)), tRoll = Math.sqrt(2 * along / ROLL_A), total = Math.max(0.12 + SETTLE / 1000, tRoll);
  let lean0;
  return { duration: total * 1000, leans: true,
    begin() { lean0 = leanVec.clone(); leanGoal.set(0, 0, 0); },
    update(t) {
      const tau = t * total; marbleLocal.copy(start).addScaledVector(w, Math.min(along, 0.5 * ROLL_A * tau * tau));
      if (!reduced()) leanVec.copy(leanAt(tau, lean0, w, Math.max(0.12, tRoll), TIP * 0.6)); else leanVec.set(0, 0, 0);
    },
    end() { if (along > 1e-4) rest = { dir: d, kind: obstacle(puzzle, place, d) }; marbleLocal.copy(start).addScaledVector(w, along); leanVec.set(0, 0, 0); } };
}
// The finish: the marble is out on the floor; light rises through the trays from the lowest to the top, the crest
// passes and each tray settles to a steady glow. The next arrow comes in while the light is still rising.
const wash = { levels: [0, 0, 0], floor: 0 };
function setWash(v) { for (let k = 0; k < 3; k++) wash.levels[k] = v; wash.floor = v; writeWash(); }
function writeWash() {
  for (let k = 0; k < 3; k++) { plateMats[k].uniforms.uWash.value = boxMats[k].uniforms.uWash.value = wash.levels[k]; }
  for (let k = 0; k <= 3; k++) postMats[k].uniforms.uWash.value = wash.levels[Math.max(0, Math.min(2, k - 1))];
  floorMat.uniforms.uGlow.value = 0.6 * wash.floor;
}
function finishPhases() {
  let arrived = false; const arrive = () => { if (arrived) return; arrived = true; showNext = true; updateUI(); announceSolved(); };
  const pass = 1.25, at = tau => {
    for (let k = 0; k < L; k++) { const x = tau - (L - 1 - k) * 0.22; wash.levels[k] = x <= 0 ? 0 : ease(clamp01(x / 0.2)) * (0.35 + 0.9 * Math.exp(-Math.max(0, x - 0.2) / 0.35)); }
    wash.floor = ease(clamp01(tau / 0.5)); writeWash();
  };
  return [
    { duration: pass * 1000, update(t) { at(t * pass); if (t * pass >= 0.6) arrive(); }, end() { arrive(); } },
    { duration: 500, update(t) { at(pass + t * 0.5); }, end() { for (let k = 0; k < 3; k++) wash.levels[k] = 1; wash.floor = 1; settleWash(); } }
  ];
}
function settleWash() { for (let k = 0; k < 3; k++) wash.levels[k] = 0.35; wash.floor = 1; writeWash(); }

// ---------- Moves ----------
function busy() { return !!anim || queue.length > 0; }
function enqueue(item) { if (queue.length < 4) queue.push(item); drain(); }
function drain() { while (!anim && queue.length) run(queue.shift()); updateUI(); }
function run(item) {
  if (item.kind !== 'tip' || solvedNow) return;
  const d = item.dir, from = { ...place }, r = E.slide(board, place, d);
  clearHint(); hideWay();
  if (!r.moved) { announceTip(d, r); play([refusePhase(d)]); return; }
  undoStack.push(history.slice()); history.push(d);
  const start = marbleLocal.clone();
  solvedNow = r.solved;
  if (solvedNow) { if (indexOf(boardId) >= 0 && !done.includes(boardId)) { done.push(boardId); if (campaignDone()) finale = true; } reached = Math.max(reached, Math.min(BOARDS.length - 1, indexOf(boardId) + 1)); lookHintDue = null; endLookHint(); }
  if (history.length === 3) lookHintDue = boardId;
  save(); announceTip(d, r); updateUI();
  const phases = [movePhase(d, from, r, start)];
  if (solvedNow) phases.push(...finishPhases());
  play(phases);
}
function settleAll() { queue = []; fastForward(); clearHint(); hideWay(); }
function undo() {
  settleAll();
  const prev = undoStack.pop(); if (!prev) { updateUI(); return; }
  history = prev; syncAll(); save();
  say('Undone. ' + where(place) + '.');
}
function restart() {
  settleAll();
  if (history.length) undoStack.push(history.slice());
  history = []; lookHintDue = null; endLookHint(); syncAll(); save(); arrival(); say('Restarted.');
}
function go(id) {
  const i = indexOf(id); if (i < 0 ? !(campaignDone() && POOL.some(b => b.id === id)) : i > reached) return false;
  queue = []; anim = null; clearHint(); hideWay(); lookHintDue = null; endLookHint(); finale = false;
  drawn = null; if (i < 0) played = (played.length + 1 >= POOL.length ? [] : played.filter(x => x !== id)).concat(id);
  boardId = id; history = []; undoStack = []; resetLook(true); buildBoard(); syncAll(); save(); arrival(); say('');
  return true;
}
// Next: the following board; after the last, the first board not yet finished. When every board is finished the
// game is finished, and Next draws a board from the pool, one not served since the pool was last used up.
let drawn = null;
function drawPool() {
  if (drawn && drawn.id !== boardId) return drawn;
  let left = POOL.filter(b => b.id !== boardId && !played.includes(b.id));
  if (!left.length) left = POOL.filter(b => b.id !== boardId);
  drawn = left[Math.floor(Math.random() * left.length)] || null;
  return drawn;
}
function nextBoard() {
  const i = indexOf(boardId), open = BOARDS.find(b => !done.includes(b.id));
  if (i >= 0 && BOARDS[i + 1] && !ending()) go(BOARDS[i + 1].id);
  else if (open) go(open.id);
  else { const pick = drawPool(); go(pick ? pick.id : BOARDS[0].id); }
}

// ---------- Screen geometry ----------
let viewH = 1, viewW = 1;
let base = { offX: 0, offY: 0, cx: 0, cy: 0 }, frame0 = { top: 56, ah: 1, aw: 1, right: 0, land: false, portrait: true };
const look = { yaw: 0, pitch: PITCH, zoom: 1, vx: 0, vy: 0, anim: null };
const QUARTER = Math.PI / 2, nearestQuarter = () => Math.round(look.yaw / QUARTER);
function fit() {
  const W = innerWidth, H = innerHeight, land = W > H && H <= 520, portrait = H > W;
  // Held sideways, the space under the stack is kept for the next arrow beside the controls.
  const top = land ? 36 : 56, bottom = land ? 66 : 124, right = land ? 64 : 0;
  frame0 = { top, right, land, portrait, aw: W - right - 16, ah: H - top - bottom };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 3)); renderer.setSize(W, H, false); viewW = W; viewH = H;
  if (board) aim(); kick();
}
// The stack from tip to toe: every rim's corners, top and bottom, and the feet.
function stackPoints() {
  const pts = [], h = N / 2 + RIM_W;
  for (let k = 0; k < L; k++) for (const y of [plateBottom(k), topY(k) + RIM_H]) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(V3(sx * h, y, sz * h));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(V3(sx * reach(), 0, sz * reach()));
  return pts;
}
// Places the camera for the current look: the fitted distance for this view, centred in the play area, then the zoom.
function aim() {
  const W = viewW, H = viewH, { top, right, land, portrait, aw, ah } = frame0;
  const wantW = portrait ? Math.min(W * 0.9, aw) : aw * 0.84, wantH = portrait ? ah * 0.96 : land ? ah * 0.97 : ah * 0.9;
  const Tg = V3(0, (topY(0) + RIM_H) / 2, 0), yaw = YAW + look.yaw, pitch = look.pitch;
  const dir = V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)), pts = [];
  // The fit leaves room for the stack leaning its furthest on its feet, any way, so a lean never leaves the screen.
  const sway = Math.sin(LEAN_MAX);
  for (const p of stackPoints()) for (const [ex, ez] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(p.clone().add(V3(ex * p.y * sway, 0, ez * p.y * sway)));
  camera.aspect = W / H; camera.clearViewOffset();
  const measure = D => { camera.position.copy(Tg).addScaledVector(dir, D); camera.lookAt(Tg); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { const q = p.clone().project(camera), x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; };
  let D = 4 * (topY(0) + N), m;
  for (let i = 0; i < 7; i++) { m = measure(D); D *= Math.max(m.w / wantW, m.h / wantH); }
  m = measure(D);
  base = { offX: m.cx - (W - right) / 2, offY: m.cy - (top + ah / 2), cx: (W - right) / 2, cy: top + ah / 2 };
  const span = topY(0) + N; U.uDepth.value.set(D - span * 0.6, span * 1.2);
  applyZoom();
}
function applyZoom() {
  const W = viewW, H = viewH, z = look.zoom = Math.max(1, Math.min(ZOOM_MAX, look.zoom)), keep = (v, c, size, full) => { const lo = Math.max(0, c - 0.85 * size), hi = Math.min(full - size, c - 0.15 * size); return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)); };
  if (z <= 1.0001) look.vx = look.vy = 0; else { look.vx = keep(look.vx, base.cx, W / z, W); look.vy = keep(look.vy, base.cy, H / z, H); }
  camera.setViewOffset(W, H, base.offX + look.vx, base.offY + look.vy, W / z, H / z); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
function zoomAt(x, y, factor) {
  const z0 = look.zoom, z1 = Math.max(1, Math.min(ZOOM_MAX, z0 * factor)); if (Math.abs(z1 - z0) < 1e-6) return;
  // A zoom centred near the marble keeps the marble where it is on screen.
  const m = toScreen(U.uMarble.value); if (Math.hypot(m.x - x, m.y - y) < 48) { x = m.x; y = m.y; }
  look.vx += x / z0 - x / z1; look.vy += y / z0 - y / z1; look.zoom = z1; applyZoom(); kick();
}
function lookTo(to, dur = 240) {
  const from = { yaw: look.yaw, pitch: look.pitch, zoom: look.zoom, vx: look.vx, vy: look.vy };
  if (reduced() || !dur) { Object.assign(look, to); look.anim = null; aim(); kick(); return; }
  look.anim = { from, to: { ...from, ...to }, t0: performance.now(), dur }; kick();
}
function stepLook(now) {
  const a = look.anim, t = clamp01((now - a.t0) / a.dur), k = a.sway ? Math.sin(Math.PI * ease(t)) : easeOut(t);
  for (const key of Object.keys(a.to)) look[key] = a.from[key] + (a.to[key] - a.from[key]) * k;
  aim(); if (t >= 1) { look.anim = null; return false; } return true;
}
function stopLook() { if (look.anim) { Object.assign(look, look.anim.sway ? look.anim.from : look.anim.to); look.anim = null; aim(); } }
// The view stays where it is let go, unless that is within about 12 degrees of a quarter, which it settles onto.
function settleYaw() { const k = nearestQuarter(); if (Math.abs(look.yaw - k * QUARTER) < 12 * DEG) lookTo({ yaw: k * QUARTER }); }
function turnView(dq) { stopLook(); markLooked(); const k = dq > 0 ? Math.floor(look.yaw / QUARTER + 0.01) + 1 : Math.ceil(look.yaw / QUARTER - 0.01) - 1; lookTo({ yaw: k * QUARTER }, 320); }
function resetLook(instant) {
  stopLook(); look.yaw = Math.atan2(Math.sin(look.yaw), Math.cos(look.yaw));
  if (instant) { Object.assign(look, { yaw: 0, pitch: PITCH, zoom: 1, vx: 0, vy: 0 }); if (board) aim(); return; }
  lookTo({ yaw: 0, pitch: PITCH, zoom: 1, vx: 0, vy: 0 }, 320);
}
function toScreen(world) { const p = world.clone().project(camera); return { x: (p.x + 1) / 2 * viewW, y: (1 - p.y) / 2 * viewH }; }
const localToScreen = v => toScreen(stackRoot.localToWorld(v.clone()));
function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of stackPoints()) { const q = localToScreen(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
// The four board directions as seen on screen, measured on the marble's tray at rest (the lean never changes them).
function axesOnScreen() {
  const y = place && !solvedNow ? topY(place.level) : topY(L - 1), c = toScreen(V3(0, y, 0)), out = {};
  for (const d of ORDER) { const p = toScreen(DIRS[d].clone().multiplyScalar(N / 2).setY(y)), x = p.x - c.x, yy = p.y - c.y, l = Math.hypot(x, yy) || 1; out[d] = { x: x / l, y: yy / l }; }
  return out;
}
// Screen directions to board directions, one to one: the quarter turn that best matches the four of them.
function screenMap() {
  const ax = axesOnScreen(); let best = 0, score = -Infinity;
  for (let k = 0; k < 4; k++) { let s = 0; for (let i = 0; i < 4; i++) { const S = SCREEN[ORDER[i]], b = ax[ORDER[(i + k) % 4]]; s += S[0] * b.x + S[1] * b.y; } if (s > score) { score = s; best = k; } }
  const map = {}; for (let i = 0; i < 4; i++) map[ORDER[i]] = ORDER[(i + best) % 4]; return map;
}
const way = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');

// ---------- Input ----------
// Tilt's input layer (tilt-input.js) owns the one-finger stroke, the tap, the wheel and W A S D, and calls tilt() with
// a direction on screen. This page watches the same stroke to lean the stack while the finger is down, and owns looking
// around: two fingers, or a right-drag or Shift-drag at a desk, turn and tilt the view, and a pinch or Ctrl and the
// wheel zoom. A stroke that becomes a look is never a move, and a swipe brought back toward its start cancels.
const control = t => !!(t && t.closest && t.closest('button,a,select,input,textarea,label,summary,dialog'));
const sheetOpen = () => !!document.querySelector('dialog[open]');
const html = document.documentElement;
const touches = new Map(), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
let stroke = null, lookG = null, armed = false;
function tiltScreen(s, source) {
  if (!SCREEN[s] || sheetOpen()) return false;
  if (source === 'input' && (lookG || (stroke && (stroke.look || (stroke.max > 12 && stroke.far < 24))))) { if (stroke) stroke.cancelled = true; return false; }
  if (stroke) stroke.tipped = true;
  enqueue({ kind: 'tip', dir: screenMap()[s] });
  return true;
}
function setArmed(on) { if (armed === on) return; armed = on; U.uWhole.value = on ? 1 : stroke && stroke.max > 8 ? 0.45 : 0; markMat.color.setScalar(wayShade(on)); kick(); }
function preview() {
  const g = stroke; if (!g || g.look) return;
  const dx = g.x - g.x0, dy = g.y - g.y0, far = Math.max(Math.abs(dx), Math.abs(dy));
  g.far = far; g.max = Math.max(g.max, far);
  if (g.max <= 8 || busy() || solvedNow || sheetOpen()) return;
  const d = screenMap()[way(dx, dy)], w = DIRS[d];
  // The stack leans toward the side it will tip to, more as the finger goes further; with reduced motion it stays
  // level and a still chevron outside the marble's tray shows the way. Both brighten a step where a release would tip.
  if (!reduced()) { leanGoal.copy(w).multiplyScalar(LEAN_MAX * Math.sqrt(clamp01((far - 6) / 84))); hideWay(); }
  else showWay(d);
  U.uWhole.value = far >= 24 ? 1 : 0.45; setArmed(far >= 24); kick();
}
function endStroke() { stroke = null; leanGoal.set(0, 0, 0); armed = false; U.uWhole.value = 0; markMat.color.setScalar(wayShade(false)); hideWay(); kick(); }
function abandonStroke() { if (stroke) stroke.look = true; leanGoal.set(0, 0, 0); armed = false; U.uWhole.value = 0; hideWay(); kick(); }
function moveLook() {
  const g = lookG;
  if (g.kind === 'mouse') { look.yaw = g.yaw - (g.x - g.x0) * 0.008; look.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, g.pitch + (g.y - g.y0) * 0.006)); aim(); kick(); return; }
  // Both fingers' latest positions give the pair's centre and spacing. The zoom follows the spacing as a ratio of where
  // the gesture began, past a small dead band, so a pair moved together never changes the zoom.
  const [a, b] = g.ids.map(id => touches.get(id)), c = mid(a, b), d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  look.yaw = g.yaw - (c.x - g.c0.x) * 0.008; look.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, g.pitch + (c.y - g.c0.y) * 0.006)); aim();
  const e = Math.log(d / g.d), k = Math.sign(e) * Math.max(0, Math.abs(e) - 0.08), want = Math.max(1, Math.min(ZOOM_MAX, g.zoom * Math.exp(k)));
  if (Math.abs(want - look.zoom) > 1e-4) zoomAt(c.x, c.y, want / look.zoom); kick();
}
function endLook() {
  const g = lookG; if (!g) return; lookG = null; for (const id of g.ids) try { html.releasePointerCapture(id); } catch (_) {}
  if (Math.abs(look.yaw - g.yaw) > 3 * DEG || Math.abs(look.pitch - g.pitch) > 3 * DEG) markLooked();
  settleYaw();
}
addEventListener('pointerdown', e => {
  if (control(e.target) || sheetOpen()) return;
  lastPointer = e.pointerType === 'mouse' ? 'mouse' : 'touch';
  if (!touches.size && !lookG) stroke = null;
  if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerType === 'touch' && touches.size === 2) {
    // A second finger makes it a look: the first finger's stroke is let go and will not tip.
    e.preventDefault(); abandonStroke(); endLook(); stopLook();
    const ids = [...touches.keys()], [a, b] = ids.map(id => touches.get(id));
    lookG = { kind: 'touch', ids, c0: mid(a, b), d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: look.zoom, yaw: look.yaw, pitch: look.pitch };
    try { html.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  if (lookG || touches.size > 2 || !e.isPrimary) return;
  if (e.pointerType !== 'touch' && (e.button === 2 || (e.button === 0 && e.shiftKey))) {
    e.preventDefault(); stopLook(); if (!stroke) stroke = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, max: 0, far: 0 }; stroke.look = true;
    lookG = { kind: 'mouse', ids: [e.pointerId], x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
    try { html.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  if (e.button !== 0) return;
  stopLook();
  stroke = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, max: 0, far: 0, look: false };
}, true);
addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (lookG && lookG.ids.includes(e.pointerId)) { if (lookG.kind === 'mouse') { if (e.buttons === 0) { endLook(); return; } lookG.x = e.clientX; lookG.y = e.clientY; } moveLook(); return; }
  if (!stroke || stroke.id !== e.pointerId || stroke.look) return;
  stroke.x = e.clientX; stroke.y = e.clientY; preview();
}, true);
// The input layer has acted on a release by the time these run, so the stroke is closed here, after it.
function release(e) {
  touches.delete(e.pointerId);
  if (lookG && lookG.ids.includes(e.pointerId)) { endLook(); return; }
  if (stroke && stroke.id === e.pointerId && !stroke.look) endStroke();
}
addEventListener('pointerup', release, true);
addEventListener('pointercancel', release, true);
addEventListener('lostpointercapture', e => { if (lookG && lookG.kind === 'mouse' && lookG.ids.includes(e.pointerId) && !e.buttons) { endLook(); return; } if (stroke && stroke.id === e.pointerId && !stroke.look && !e.buttons) endStroke(); }, true);
for (const name of ['selectstart', 'dragstart']) canvas.addEventListener(name, e => e.preventDefault());
addEventListener('contextmenu', e => { if (!control(e.target)) e.preventDefault(); });
// Ctrl and the wheel, which is also how a trackpad pinch arrives, zoom toward the pointer. The plain wheel and a
// trackpad's two-finger swipe belong to the input layer, which tips.
addEventListener('wheel', e => {
  if (sheetOpen() || !e.ctrlKey) return;
  e.preventDefault(); stopLook();
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  zoomAt(e.clientX, e.clientY, Math.max(0.8, Math.min(1.25, Math.exp(-e.deltaY * k * 0.01))));
}, { passive: false, capture: true });
addEventListener('keydown', e => {
  if (sheetOpen() || (e.target.matches && e.target.matches('select,input,textarea'))) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const arrows = { ArrowUp: 'U', ArrowRight: 'R', ArrowDown: 'D', ArrowLeft: 'L' };
  if (arrows[k]) { e.preventDefault(); stopLook(); if (!e.repeat) tiltScreen(arrows[k], 'key'); return; }
  if (k === 'z' || k === 'Backspace') { e.preventDefault(); undo(); return; }
  if (k === 'q' || k === 'e') { e.preventDefault(); turnView(k === 'q' ? -1 : 1); return; }
  if (k === '+' || k === '=' || k === '-' || k === '_') { e.preventDefault(); stopLook(); const c = toScreen(U.uMarble.value); zoomAt(c.x, c.y, k === '-' || k === '_' ? 1 / 1.25 : 1.25); return; }
  if (k === '0') { e.preventDefault(); resetLook(false); return; }
  if (k === 'h') { e.preventDefault(); pressHint(); }
});
// The input layer finds its game here.
window.__tiltLevels = { get state() { return { solved: solvedNow, busy: busy() }; }, tilt: s => tiltScreen(s, 'input') };

// ---------- Phone tilt (after Tilt's original tray) ----------
// Off until turned on in Settings, and only for this visit. Hold the phone comfortably for a moment to set level, lean
// past about 8 degrees to tip, and come back to level before the next tip. The stack leans with the phone as it goes.
const sensor = { enabled: false, pending: false, base: null, draft: null, since: 0, armed: false, neutralSince: null, candidate: null, candidateSince: 0, last: 0, timer: null };
const gravity = (beta, gamma, rotation = 0) => { const b = beta * DEG, g = gamma * DEG, r = rotation * DEG, x = Math.cos(b) * Math.sin(g), y = Math.sin(b); return { x: x * Math.cos(r) + y * Math.sin(r), y: y * Math.cos(r) - x * Math.sin(r) }; };
const leanOf = (base, now) => ({ x: Math.asin(Math.max(-1, Math.min(1, now.x - base.x))) / DEG, y: Math.asin(Math.max(-1, Math.min(1, now.y - base.y))) / DEG });
const status = t => { $('#sensor-status').textContent = t; };
function sensorRecalibrate() { Object.assign(sensor, { base: null, draft: null, armed: false, neutralSince: null, candidate: null }); if (sensor.enabled) status('Hold your phone comfortably for a moment.'); }
function stopSensor() {
  sensor.enabled = false; sensor.pending = false; clearInterval(sensor.timer); sensor.timer = null; removeEventListener('deviceorientation', orientation); sensorRecalibrate();
  $('#phone-tilt').textContent = 'Turn on'; $('#phone-tilt').setAttribute('aria-pressed', 'false'); if (!stroke) leanGoal.set(0, 0, 0); kick();
}
function orientation(e) {
  if (!sensor.enabled || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
  const now = performance.now(); sensor.last = now;
  const v = gravity(e.beta, e.gamma, (screen.orientation && screen.orientation.angle) || Number(window.orientation) || 0);
  if (!sensor.base) { if (!sensor.draft || Math.hypot(v.x - sensor.draft.x, v.y - sensor.draft.y) > 0.025) { sensor.draft = v; sensor.since = now; } if (now - sensor.since >= 300) { sensor.base = v; status('Lean to tip. Come back to level between moves.'); } return; }
  const q = leanOf(sensor.base, v), ax = Math.abs(q.x), ay = Math.abs(q.y), amount = Math.max(ax, ay);
  if (document.hidden || reduced() || sheetOpen()) { sensor.armed = false; sensor.neutralSince = null; sensor.candidate = null; return; }
  if (amount < 3) { sensor.candidate = null; if (sensor.neutralSince === null) sensor.neutralSince = now; if (now - sensor.neutralSince >= 100) sensor.armed = true; if (!stroke && !anim) { leanGoal.set(0, 0, 0); kick(); } return; }
  sensor.neutralSince = null; if (busy() || solvedNow || stroke) return;
  const s = ax > ay ? (q.x > 0 ? 'R' : 'L') : (q.y > 0 ? 'D' : 'U');
  leanGoal.copy(DIRS[screenMap()[s]]).multiplyScalar(Math.min(LEAN_MAX, amount * DEG * 0.8)); kick();
  if (!sensor.armed || amount < 8 || Math.max(ax, ay) < Math.min(ax, ay) * 1.3) { sensor.candidate = null; return; }
  if (sensor.candidate !== s) { sensor.candidate = s; sensor.candidateSince = now; return; }
  if (now - sensor.candidateSince < 80) return;
  sensor.armed = false; sensor.candidate = null; tiltScreen(s, 'sensor');
}
async function startSensor() {
  if (sensor.enabled) { stopSensor(); status('Phone tilt is off.'); return; }
  if (sensor.pending) return;
  if (reduced()) { status('Phone tilt is off while motion is reduced. Swipes, taps and keys still work.'); return; }
  if (!window.isSecureContext || typeof DeviceOrientationEvent === 'undefined') { status('Phone tilt is unavailable here. Swipes, taps and keys still work.'); return; }
  sensor.pending = true;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') { status('Permission was not granted. Swipes, taps and keys still work.'); return; }
    if (reduced()) return;
    sensor.enabled = true; sensorRecalibrate(); sensor.last = performance.now();
    $('#phone-tilt').textContent = 'Turn off'; $('#phone-tilt').setAttribute('aria-pressed', 'true');
    addEventListener('deviceorientation', orientation);
    sensor.timer = setInterval(() => { if (performance.now() - sensor.last > 4000) { stopSensor(); status('No tilt readings. Swipes, taps and keys still work.'); } }, 1000);
  } catch (_) { status('Phone tilt is unavailable. Swipes, taps and keys still work.'); }
  finally { sensor.pending = false; }
}
if (screen.orientation) screen.orientation.addEventListener('change', sensorRecalibrate);
document.addEventListener('visibilitychange', () => { if (document.hidden) sensorRecalibrate(); });

// ---------- Marks on a tray: the hint, and the way under reduced motion ----------
function placeChevron(mesh, level, d) {
  const w = DIRS[d]; mesh.position.copy(marbleLocal).addScaledVector(w, R + 0.36).setY(topY(level) + 0.004);
  mesh.quaternion.setFromUnitVectors(V3(0, 0, -1), w); mesh.visible = true;
}
function showWay(d) { if (wayDir === d && wayMark.visible) return; wayDir = d; placeChevron(wayMark, place.level, d); kick(); }
function hideWay() { if (!wayMark.visible && !wayDir) return; wayDir = null; wayMark.visible = false; kick(); }
// Hint: the next tip of a shortest finish, shown first as a white chevron outside the marble's tray with the stack
// leaning a little that way, and played on a second press.
function clearHint() { if (!hint) { updateHintButton(); return; } hint = null; hintMark.visible = false; if (!stroke) leanGoal.set(0, 0, 0); updateHintButton(); kick(); }
function pressHint() {
  if (solvedNow) return;
  if (busy()) return;
  if (hint) { const d = hint; clearHint(); if (d === 'undo') undo(); else if (d === 'restart') restart(); else enqueue({ kind: 'tip', dir: d }); return; }
  const moves = E.solve(board, place);
  // No tip finishes from here: the hint is Undo, played on the second press. After a reload there is nothing to undo,
  // so it is Restart, which Undo can take back.
  if (!moves || !moves.length) { hint = undoStack.length ? 'undo' : 'restart'; say('No way on from here. Press Hint again to ' + hint + '.'); updateHintButton(); kick(); return; }
  hint = moves[0]; placeChevron(hintMark, place.level, hint);
  if (!reduced()) leanGoal.copy(DIRS[hint]).multiplyScalar(3.5 * DEG);
  say(NAMES[hint] + '. Press Hint again to play it.'); updateHintButton(); kick();
}
function updateHintButton() { const b = $('#hint-btn'); b.setAttribute('aria-pressed', String(!!hint)); b.disabled = solvedNow; $('#undo-btn').classList.toggle('hinted', hint === 'undo'); $('#restart-btn').classList.toggle('hinted', hint === 'restart'); }

// ---------- The look hint (after Cube Maze) ----------
// After the third move on a board, if the player has never turned the view, a small wordless glyph near the bottom
// shows how (two fingertips on a touch screen, a right mouse button at a desk) while the view sways a little and back.
// At most twice, the second time on another board, and never once the view has been turned.
let lastPointer = matchMedia('(hover: hover) and (pointer: fine)').matches ? 'mouse' : 'touch', lookHint = null, lookHintDue = null;
const glyphs = {
  touch: '<svg viewBox="0 0 72 56" aria-hidden="true"><path class="arc" d="M8.6 28.8A80 80 0 0 1 63.4 28.8"/><g class="dots"><g class="up"><circle cx="29" cy="40" r="5.5"/><circle cx="43" cy="40" r="5.5"/></g></g></svg>',
  mouse: '<svg viewBox="0 0 72 56" aria-hidden="true"><path class="arc" d="M10.1 13.6A94 94 0 0 1 61.9 13.6"/><g class="mouse"><g class="up"><rect x="27" y="24" width="18" height="28" rx="9"/><path d="M36 24v11M27 35h18"/><path class="lit" d="M36 24a9 9 0 0 1 9 9v2h-9z"/></g></g></svg>'
};
function markLooked() { if (prefs.looked) return; prefs.looked = true; save(); endLookHint(); }
function endLookHint() { if (!lookHint) return; clearTimeout(lookHint.timer); lookHint.el.remove(); lookHint = null; }
function maybeLookHint() {
  // Never under a finger that is still down: it waits for the release.
  if (stroke || lookG) { setTimeout(() => { if (lookHintDue && !busy()) maybeLookHint(); }, 300); return; }
  const due = lookHintDue; lookHintDue = null;
  if (due !== boardId || corrupt || prefs.looked || prefs.hintCount >= 2 || prefs.hintBoard === boardId || history.length < 3 || solvedNow || lookHint || sheetOpen()) return;
  prefs.hintCount++; prefs.hintBoard = boardId; save();
  const kind = lastPointer, still = reduced(), el = document.createElement('div');
  el.id = 'look-hint'; el.className = 'look-hint ' + kind + (still ? ' still' : ''); el.setAttribute('aria-hidden', 'true'); el.innerHTML = glyphs[kind];
  // Bottom centre of the play area, above the toolbar; if the stack reaches down there, it moves to the roomier side.
  const right = viewW - frame0.right; el.style.left = (right / 2 - 36) + 'px'; $('#play').append(el);
  const r = el.getBoundingClientRect(), b = bounds();
  if (r.left < b.x + b.width + 8 && r.right > b.x - 8 && r.top < b.y + b.height + 8 && r.bottom > b.y - 8)
    el.style.left = (b.x > right - (b.x + b.width) ? Math.max(8, b.x / 2 - r.width / 2) : Math.min(right - r.width - 8, (b.x + b.width + right) / 2 - r.width / 2)) + 'px';
  lookHint = { el, kind, timer: setTimeout(endLookHint, 3200) };
  if (!still) { stopLook(); look.anim = { sway: true, from: { yaw: look.yaw }, to: { yaw: look.yaw + 15 * DEG }, t0: performance.now(), dur: 2600 }; kick(); }
}

// ---------- Chrome ----------
const icons = { restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2', next: 'M5 12h14m-6-6 6 6-6 6', replay: 'M21 4v6h-6M3 20v-6h6M5.5 9a7.5 7.5 0 0 1 12.4-2.8L21 10M3 14l3.1 3.8A7.5 7.5 0 0 0 18.5 15' };
for (const [id, path] of Object.entries(icons)) { const b = $('#' + id + '-btn'); if (b) b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; }
const where = s => 'Level ' + (s.level + 1) + ', row ' + (s.row + 1) + ', column ' + (s.col + 1);
function say(text) { const n = $('#announcement'); n.textContent = ''; n.textContent = text; }
function announceTip(d, r) {
  if (!r.moved) say(NAMES[d] + '. The marble stays.');
  else if (r.solved) say(NAMES[d] + '. ' + (r.path.some(c => c.drop) ? 'Drops. ' : '') + where(r) + '. Out through the exit.');
  else if (r.path.some(c => c.drop)) say(NAMES[d] + '. Drops to ' + where(r) + '.');
  else say(NAMES[d] + '. ' + where(r) + '.');
}
function announceSolved() { say('Finished in ' + history.length + (history.length === 1 ? ' move' : ' moves') + '; par ' + par + '.' + (ending() ? ' ' + endLine() : '')); }
const campaignDone = () => BOARDS.every(b => done.includes(b.id));
// The end: every board finished, shown on the last board, or on the one whose finish completed them all.
const ending = () => solvedNow && campaignDone() && (finale || !BOARDS[indexOf(boardId) + 1]);
const endLine = () => 'All ' + BOARDS.length + ' boards solved.';
function describe() {
  const lines = [solvedNow ? 'The marble is out, on the floor under the exit.' : 'Marble on ' + where(place).toLowerCase() + '.'];
  for (let k = 0; k < L; k++) {
    const rows = [];
    for (let r = 0; r < N; r++) { const cells = []; for (let c = 0; c < N; c++) { const ch = puzzle.grid[k][r][c], here = !solvedNow && place.level === k && place.row === r && place.col === c; cells.push(here ? 'marble' : ch === '#' ? 'block' : ch === 'o' ? (k === L - 1 ? 'exit' : 'hole') : 'floor'); } rows.push(cells.join(', ')); }
    lines.push('Level ' + (k + 1) + ': ' + rows.join('; ') + '.');
  }
  return (indexOf(boardId) < 0 ? 'Stacked glass trays. ' : 'Stacked glass trays, board ' + (indexOf(boardId) + 1) + ' of ' + BOARDS.length + '. ') + lines.join(' ');
}
function updateCatalog() {
  const list = $('#level-catalog');
  if (!list.children.length) BOARDS.forEach((b, i) => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.dataset.board = b.id; button.innerHTML = '<span>Board ' + (i + 1) + '</span><span class="catalog-state"></span>';
    button.addEventListener('click', () => { if (i > reached) return; if (b.id !== boardId) go(b.id); $('#settings').close(); });
    li.append(button); list.append(li);
  });
  BOARDS.forEach((b, i) => {
    const button = list.children[i].firstChild, here = b.id === boardId, completed = done.includes(b.id);
    button.dataset.state = here ? 'current' : completed ? 'completed' : i <= reached ? 'available' : 'locked';
    button.disabled = i > reached;
    button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, completed ? 'Completed' : null, !here && !completed ? (i <= reached ? 'Available' : 'Locked') : null].filter(Boolean).join(' · ');
    if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  });
}
function updateUI() {
  if (!place) return;
  const i = indexOf(boardId);
  // A pool board shows the infinity sign where a campaign board shows its number, as Cast's free play does.
  $('#readout').textContent = (i < 0 ? '∞' : (i + 1) + ' / ' + BOARDS.length) + ' · ' + history.length + ' / ' + par;
  $('#undo-btn').disabled = !undoStack.length && !busy();
  $('#next-btn').hidden = !showNext;
  // At the end one line shows above the arrow, and the arrow goes on to the pool (Replay only if the pool were empty).
  const end = showNext && ending(), kind = end && !POOL.length ? 'replay' : 'next', nb = $('#next-btn'), line = $('#end-line');
  line.hidden = !end; line.textContent = end ? endLine() : '';
  if (nb.dataset.kind !== kind) { nb.dataset.kind = kind; nb.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + icons[kind] + '"/></svg>'; nb.setAttribute('aria-label', kind === 'replay' ? 'Replay' : 'Next board'); }
  canvas.setAttribute('aria-label', describe());
  $('#previous').disabled = i <= 0; $('#following').disabled = i < 0 || i >= reached || i === BOARDS.length - 1;
  updateCatalog(); updateHintButton();
}
$('#restart-btn').onclick = restart; $('#undo-btn').onclick = undo; $('#hint-btn').onclick = pressHint; $('#next-btn').onclick = nextBoard;
$('#phone-tilt').addEventListener('click', startSensor);
$('#previous').onclick = () => { const i = indexOf(boardId); if (i > 0) go(BOARDS[i - 1].id); $('#settings').close(); };
$('#following').onclick = () => { const i = indexOf(boardId); if (i < reached && BOARDS[i + 1]) go(BOARDS[i + 1].id); $('#settings').close(); };
for (const id of ['settings', 'help']) {
  $('#' + id + '-btn').onclick = () => { endStroke(); sensorRecalibrate(); $('#' + id).showModal(); };
  $('#' + id).addEventListener('close', () => $('#' + id + '-btn').focus({ preventScroll: true }));
}
$('#motion').onchange = e => { prefs.motion = e.target.value; applyPrefs(); save(); };
$('#theme').onchange = e => { prefs.theme = e.target.value; applyTheme(); save(); };
// Theme, as on Tilt: System, Light or Dark, Dark by default. The page carries the saved theme from its first paint
// (theme-boot.js); this puts the scene in the same room.
function applyTheme() {
  html.dataset.theme = prefs.theme; $('#theme').value = prefs.theme;
  const on = isLight(); document.querySelector('meta[name="theme-color"]').content = on ? '#f3f0e9' : '#1a1a1a';
  if (on !== lightOn) { lightOn = on; dress(); }
  kick();
}
lightMQ.addEventListener('change', applyTheme);
function applyPrefs() {
  applyTheme();
  html.dataset.motion = prefs.motion; $('#motion').value = prefs.motion;
  if (reduced()) { fastForward(); leanVec.set(0, 0, 0); leanGoal.set(0, 0, 0); if (sensor.enabled) { stopSensor(); status('Phone tilt is off while motion is reduced. Swipes, taps and keys still work.'); } }
  kick();
}
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyPrefs);
addEventListener('resize', () => { fit(); });

// ---------- Start ----------
readSave();
buildBoard();
try { syncAll(); } catch (_) { history = []; syncAll(); }
applyPrefs(); save(); arrival();
// Compile every shader now so no later tip, hint, board or finish waits on one.
{
  const warm = new THREE.Group(); warm.position.set(0, -50, 0);
  warm.add(new THREE.Mesh(boxGeom(1, 1, 1), plateMats[2]), new THREE.Mesh(boxGeom(1, 1, 1), boxMats[2]), new THREE.Mesh(boxGeom(1, 1, 1), postMats[3]), new THREE.Mesh(chevronGeom, hintMat));
  // and the other room's, so a change of theme never waits on a shader
  for (const m of [lightOn ? plateMats[0] : plateMatsL[0], lightOn ? boxMats[0] : boxMatsL[0], lightOn ? postMats[0] : postMatsL[0], lightOn ? floorMat : floorMatL, lightOn ? ballMat : ballMatL, lightOn ? milkMat : milkMatL, lightOn ? outlineMat : outlineMatL, lightOn ? cueMat : cueMatL, lightOn ? bloomMat : null].filter(Boolean)) { const w = new THREE.Mesh(boxGeom(0.01, 0.01, 0.01), m); w.frustumCulled = false; w.visible = true; warm.add(w); }
  scene.add(warm); hintMark.visible = wayMark.visible = true; placeStack(); sortGlass(); renderer.compile(scene, camera); renderer.render(scene, camera);
  scene.remove(warm); hintMark.visible = wayMark.visible = false;
}
kick();

// What lies between the eye and the marble, for checks: rays to its centre and eight points round it, each open,
// through frost (plates, blocks, rims) or behind something solid (posts and feet).
function sight() {
  placeStack(); const occ = [];
  for (const lv of levels) { occ.push([lv.plate, 'frost']); for (const m of lv.items) occ.push([m, 'frost']); }
  for (const m of [...posts, ...feet]) occ.push([m, 'solid']);
  const m = U.uMarble.value, cam = camera.position, right = V3(1, 0, 0).applyQuaternion(camera.quaternion), up = V3(0, 1, 0).applyQuaternion(camera.quaternion), rc = new THREE.Raycaster();
  const out = { open: 0, frost: 0, solid: 0 };
  for (let k = 0; k < 9; k++) {
    const a = k / 8 * Math.PI * 2, t = m.clone(); if (k) t.addScaledVector(right, 0.7 * R * Math.cos(a)).addScaledVector(up, 0.7 * R * Math.sin(a));
    const dir = t.clone().sub(cam), far = dir.length(); rc.set(cam.clone(), dir.normalize()); rc.far = far - R;
    const kinds = new Set(); for (const [mesh, kind] of occ) if (rc.intersectObject(mesh, false).length) kinds.add(kind);
    out[kinds.has('solid') ? 'solid' : kinds.size ? 'frost' : 'open']++;
  }
  out.look = out.solid > 4 ? 'solid' : out.frost > 4 ? 'frost' : out.open > 4 ? 'open' : 'mixed'; return out;
}
// A real swipe and a real tap for a board direction, from the current view.
function swipeFor(d, length = 90) {
  placeStack(); const map = screenMap(), s = ORDER.find(k => map[k] === d), [ux, uy] = SCREEN[s], b = bounds(), c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const lo = { x: 16, y: 64 }, hi = { x: viewW - frame0.right - 16, y: viewH - 76 };
  let x = c.x - ux * length / 2, y = c.y - uy * length / 2;
  x = Math.max(lo.x, Math.min(hi.x - Math.max(0, ux * length), x)); y = Math.max(lo.y, Math.min(hi.y - Math.max(0, uy * length), y));
  x = Math.max(lo.x - Math.min(0, ux * length), x); y = Math.max(lo.y - Math.min(0, uy * length), y);
  return { x, y, dx: ux * length, dy: uy * length, screen: s };
}
function tapFor(d) {
  placeStack(); const map = screenMap(), s = ORDER.find(k => map[k] === d), [ux, uy] = SCREEN[s], m = toScreen(U.uMarble.value), r = proxy.getBoundingClientRect();
  const need = Math.max(r.width, r.height) * 0.75 + 12;
  let dist = 80; const room = ux > 0 ? viewW - frame0.right - 12 - m.x : ux < 0 ? m.x - 12 : uy > 0 ? viewH - 76 - m.y : m.y - 64;
  dist = Math.max(need, Math.min(dist, room));
  return { x: m.x + ux * dist, y: m.y + uy * dist, screen: s };
}
window.__tilt3d = {
  boards: BOARDS,
  pool: POOL,
  get board() { return boardId; },
  get state() { return { theme: prefs.theme, board: boardId, level: place.level, row: place.row, col: place.col, moves: history.length, par, solved: solvedNow, busy: busy(), queued: queue.length, history: history.slice(), done: done.slice(), reached, hint, next: showNext, ending: showNext && ending(), corrupt, looked: prefs.looked, motion: prefs.motion, sensor: { enabled: sensor.enabled, calibrated: !!sensor.base, armed: sensor.armed } }; },
  go, tip(d) { if (DIRS[d]) enqueue({ kind: 'tip', dir: d }); }, undo, restart, pressHint, next: nextBoard,
  swipeFor, tapFor,
  cellPoint(level, row, col) { placeStack(); return localToScreen(V3(cx(col), topY(level), cz(row))); },
  setLook(yaw, pitch, zoom = 1) { stopLook(); Object.assign(look, { yaw: yaw * DEG, pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch * DEG)), zoom, vx: 0, vy: 0 }); aim(); if (zoom > 1) { look.vx = base.cx - viewW / (2 * zoom); look.vy = base.cy - viewH / (2 * zoom); applyZoom(); } kick(); },
  sight,
  hint() { return { shown: !!lookHint, count: prefs.hintCount }; },
  view() {
    placeStack(); const m = toScreen(U.uMarble.value), map = screenMap(), lean = leanVec.length();
    return { bounds: bounds(), marble: { x: m.x, y: m.y, px: markerU.uR.value / pxWorld, marker: 2 * (markerU.uRing.value + 0.55 * pxWorld) / pxWorld }, marbleLocal: marbleLocal.toArray(), marbleWorld: U.uMarble.value.toArray(),
      lean: { deg: lean / DEG, x: leanVec.x, z: leanVec.z, dir: lean > 1e-3 ? ORDER.find(d => DIRS[d].dot(leanVec) > 0.7 * lean) || null : null },
      look: { yaw: look.yaw / DEG, pitch: look.pitch / DEG, zoom: look.zoom, moving: !!look.anim || !!lookG, swaying: !!(look.anim && look.anim.sway) },
      map, axes: axesOnScreen(), drawing: !!raf, armed, whole: U.uWhole.value, way: wayMark.visible ? wayDir : null, hintMark: hintMark.visible ? hint : null,
      light: lightOn, veils: levels.map(lv => lv.veils.every(v => v.visible)), solid: markerUL.uSolid.value, wash: wash.levels.slice(0, L), sizes: { N, L, G, R, HOLE, T, topY: Array.from({ length: L }, (_, k) => topY(k)) },
      ring: { count: cueCount, active: !!cueState, still: !!(cueState && cueState.still) } };
  }
};
window.__minimalize = { bounds() { placeStack(); return bounds(); } };
