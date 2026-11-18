/* Cube Maze — Luke Steuber. A glass cube of tubes in a dark room; the marble is the only light.
   Tip the cube or turn a slice, and the marble falls along gravity until a closed end stops it. */
import * as THREE from './vendor/three.module.min.js';

const E = window.CubeMazeEngine, ALL = window.CubeMazeBoards, FT = window.CubeMazeFeet, KEY = 'cube-maze.v1';
// The campaign (campaign.js) plays twenty-five of the fifty boards in boards.js, in its own order. Once every one is
// solved the game is finished, and New Game+ deals the other twenty-five (the pool) at random, each once before any
// comes back; a pool board is never campaign progress.
const BOARDS = window.CubeMazeCampaign.map(id => ALL.find(b => b.id === id)), POOL = ALL.filter(b => !BOARDS.includes(b));
const $ = s => document.querySelector(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const VEC = E.VEC.map(v => V3(...v)), AXES = E.AXES, UP = V3(0, 1, 0), DOWN = V3(0, -1, 0);
// Cubies are one unit apart; the glass box leaves a gap so the slices and the interior read.
const HB = 0.45, SEAT = 0.5 - HB, RM = FT.MARBLE, ARM = 0.5, END = HB - RM - 0.006;
// Tube, bend and collar radii; a three-cubie cube gets thicker tubes so its smaller cubies still read.
const TUBES = { 2: { rt: 0.15, bend: 0.19, rs: 0.188 }, 3: { rt: 0.185, bend: 0.225, rs: 0.228 } };
let RT = TUBES[2].rt, RBEND = TUBES[2].bend, RS = TUBES[2].rs;
// The cube stands on four short frosted-glass feet, one centred under each bottom corner of whichever face is down, so
// a marble leaving by a downward spout has room to fall and roll out (feet.js, as in the first build). A tip rolls the
// cube over its bottom edge. FOOT is the height of the base above the floor, the same on both boards.
let FOOT = FT.size(2).height, FEET = FT.size(2);
const YAW = 26 * Math.PI / 180, PITCH = 31 * Math.PI / 180, FOV = 26;
const PITCH_MIN = 12 * Math.PI / 180, PITCH_MAX = 65 * Math.PI / 180, ZOOM_MAX = 2.5;
// A dark charcoal room under a soft overhead light. BG is the display value of the far floor and the air.
const BG = 0.1;
const LAMBDA = 1.3, FLOW = 9, SOLVED_GLOW = 0.85, WASH_PEAK = 2.2, GRAVITY = 36;
THREE.ColorManagement.enabled = false;

// ---------- Saves ----------
let prefs = { motion: 'system', looked: false, hintCount: 0, hintBoard: null }, boardId = BOARDS[0].id, history = [], completed = [], played = [], corrupt = false;
function replay(b, moves) {
  let s = E.normalize(b), q = startOrient(s.g);
  for (const m of moves) {
    if (!E.validMove(s, m) || s.out) throw Error('Invalid move');
    if (m[0] === 'tip') q = rolled(q, worldDir(m[1], q));
    s = E.apply(s, m).state;
  }
  return { state: s, orient: q };
}
function readSave() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (_) { return; }
  if (raw === null) return;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || typeof v.board !== 'string' || !Array.isArray(v.moves) || v.moves.length > 5000 || !Array.isArray(v.completed) || !v.settings || !['system', 'reduce'].includes(v.settings.motion)) throw Error('Unreadable');
    const hc = v.settings.hintCount;
    prefs = { motion: v.settings.motion, looked: v.settings.looked === true, hintCount: Number.isInteger(hc) ? Math.max(0, Math.min(2, hc)) : 0, hintBoard: typeof v.settings.hintBoard === 'string' ? v.settings.hintBoard : null };
    // Saves are read against all fifty boards: a board solved before it left the campaign keeps its mark.
    completed = [...new Set(v.completed.filter(id => ALL.some(b => b.id === id)))];
    played = Array.isArray(v.pool) ? [...new Set(v.pool.filter(id => POOL.some(b => b.id === id)))] : [];
    let b = ALL.find(b => b.id === v.board);
    // A player last on a board that left the campaign goes on from the campaign board nearest it in the old order
    // of fifty (the later of two), with a fresh cube; once the campaign is finished it is a New Game+ board and stays.
    if (b && POOL.includes(b) && !campaignDone()) {
      const at = ALL.indexOf(b), far = c => Math.abs(ALL.indexOf(c) - at);
      b = BOARDS.reduce((best, c) => far(c) < far(best) || (far(c) === far(best) && ALL.indexOf(c) > ALL.indexOf(best)) ? c : best);
      v.moves = [];
    }
    if (b) { boardId = b.id; try { replay(b, v.moves); history = v.moves.map(m => m.slice()); } catch (_) { history = []; } }
  } catch (_) { corrupt = true; }
}
function save() {
  if (corrupt) return;
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, board: boardId, moves: history, completed, settings: prefs, pool: played })); } catch (_) {}
}
const reduced = () => prefs.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Orientation: the cube's own axes in the world ----------
function snapQ(q) { const m = new THREE.Matrix4().makeRotationFromQuaternion(q), e = m.elements; for (let i = 0; i < 16; i++) e[i] = Math.round(e[i]); return new THREE.Quaternion().setFromRotationMatrix(m); }
function startOrient(g) { const q = new THREE.Quaternion(); if (g !== 3) q.setFromUnitVectors(VEC[g], DOWN); return snapQ(q); }
function worldDir(d, q) { return VEC[d].clone().applyQuaternion(q).round(); }
function cubeDir(w, q) { const v = w.clone().applyQuaternion(q.clone().invert()).round(); return E.VEC.findIndex(u => u[0] === v.x && u[1] === v.y && u[2] === v.z); }
// Rolling toward w lays the face that pointed along w on the floor.
function rolled(q, w) { return snapQ(new THREE.Quaternion().setFromAxisAngle(V3().crossVectors(UP, w).normalize(), Math.PI / 2).multiply(q)); }

// ---------- Renderer and scene ----------
const canvas = $('#scene');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' }); }
catch (_) { canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: 'This puzzle needs WebGL.', className: 'readout' })); throw Error('No WebGL'); }
renderer.setClearColor(new THREE.Color(BG, BG, BG), 1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
const cubeRoot = new THREE.Group(), pivot = new THREE.Group();
cubeRoot.add(pivot); scene.add(cubeRoot);

const U = { uMarble: { value: V3(0, 0.5, 0) }, uOn: { value: 1 }, uDirect: { value: 1 }, uDepth: { value: new THREE.Vector2(10, 3) }, uSolved: { value: 0 }, uCap: { value: 0.7 }, uCubeInv: { value: new THREE.Matrix4() }, uSel: { value: new THREE.Vector4() }, uSel2: { value: new THREE.Vector4() }, uWhole: { value: 0 }, uGlowK: { value: 1 }, uFaceSel: { value: 1 } };
// Nearer glass is brighter: depth is drawn by lightness, as in Tilt.
const depthGLSL = `uniform vec2 uDepth; float deep(vec3 w){ return clamp((distance(cameraPosition, w) - uDepth.x) / uDepth.y, 0.0, 1.0); }
float near(vec3 w){ return mix(1.18, 0.38, deep(w)); } float nearTube(vec3 w){ return mix(1.12, 0.6, deep(w)); }`;
// The gesture preview, in the cube's own coordinates. A selected slice glows faintly from inside (uSel: axis, layer
// centre, glow, and whether the rest dims); the cross on a touch glows its second candidate too (uSel2); a touch off the
// cube glows the whole cube (uWhole). A slice turns about its own axis, so the test holds while it swings.
const selGLSL = `uniform mat4 uCubeInv; uniform vec4 uSel; uniform vec4 uSel2; uniform float uWhole; uniform float uGlowK;
float inSlab(vec3 l, vec4 s){ float c = s.x < 0.5 ? l.x : s.x < 1.5 ? l.y : l.z; return abs(c - s.y) < 0.5 ? 1.0 : 0.0; }
float selGlow(vec3 w){ vec3 l = (uCubeInv * vec4(w, 1.0)).xyz; return max(uWhole, max(uSel.z * inSlab(l, uSel), uSel2.z * inSlab(l, uSel2))); }
float selk(vec3 w){ vec3 l = (uCubeInv * vec4(w, 1.0)).xyz; return mix(1.0, inSlab(l, uSel) > 0.5 ? 1.0 : 0.8, uSel.w); }`;
const selU = () => ({ uCubeInv: U.uCubeInv, uSel: U.uSel, uSel2: U.uSel2, uWhole: U.uWhole, uGlowK: U.uGlowK });
const glass = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
// Tubes, collars, feet and hairlines keep the brightest layer rather than summing, so overlapping glass never piles
// up to white: each pixel is as light as its lightest surface, and the marble stays the brightest thing on screen.
const ink = { ...glass, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
const worldVert = `varying vec3 vW; varying vec3 vN;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
// The glass defines the cubies by its hairlines and the cube's outer faces; the faces between cubies are much
// fainter, so on a three-cubie cube the stacked inner panes never make a pale grid that the tubes behind would sink
// into. Each cubie gets its own copy, which knows which of its six faces lie on the outside (uOuter).
const faceVert = `uniform float uOuter[6]; varying vec3 vW; varying vec3 vN; varying float vOuter;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
 int k = normal.x > 0.5 ? 0 : normal.x < -0.5 ? 1 : normal.y > 0.5 ? 2 : normal.y < -0.5 ? 3 : normal.z > 0.5 ? 4 : 5; vOuter = uOuter[k];
 gl_Position = projectionMatrix * viewMatrix * w; }`;
function faceMat(outer = [1, 1, 1, 1, 1, 1]) {
  return new THREE.ShaderMaterial({ ...glass, uniforms: { uMarble: U.uMarble, uOn: U.uOn, uDepth: U.uDepth, uSolved: U.uSolved, uFaceSel: U.uFaceSel, uOuter: { value: outer }, ...selU() }, vertexShader: faceVert,
  fragmentShader: `uniform vec3 uMarble; uniform float uOn; uniform float uSolved; uniform float uFaceSel; varying vec3 vW; varying vec3 vN; varying float vOuter; ${depthGLSL} ${selGLSL}
void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))); vec3 d = vW - uMarble;
 float b = ((0.018 + 0.02 * f * f) * (1.0 - pow(f, 8.0)) * near(vW) * (1.0 + 0.5 * uSolved) + uOn * 0.01 / (0.6 + dot(d, d))) * selk(vW) + 0.05 * uGlowK * uFaceSel * selGlow(vW);
 gl_FragColor = vec4(vec3(b * mix(0.25, 1.0, vOuter)), 1.0); }` });
}
const lineVert = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const lineFrag = `uniform vec3 uMarble; uniform float uOn; uniform float uBase; uniform float uLit; uniform float uSolved; varying vec3 vW; ${depthGLSL} ${selGLSL}
void main(){ vec3 d = vW - uMarble; float b = (uBase * mix(1.0, near(vW), uLit) * (1.0 + 0.45 * uSolved * uLit) + uLit * uOn * 0.12 / (0.36 + dot(d, d))) * mix(1.0, selk(vW), uLit) + uLit * 0.12 * selGlow(vW); gl_FragColor = vec4(vec3(b), 1.0); }`;
const lineMat = (base, lit) => new THREE.ShaderMaterial({ ...ink, side: THREE.FrontSide, uniforms: { uMarble: U.uMarble, uOn: U.uOn, uDepth: U.uDepth, uSolved: U.uSolved, ...selU(), uBase: { value: base }, uLit: { value: lit } }, vertexShader: lineVert, fragmentShader: lineFrag });
const edgeMat = lineMat(0.22, 1);
// Frosted tubes: silhouettes read as glass; light carried through the network fills them from inside.
function tubeMat() {
  return new THREE.ShaderMaterial({ ...ink, uniforms: { uB: { value: new Float32Array(7) }, uMarble: U.uMarble, uDirect: U.uDirect, uDepth: U.uDepth, uCap: U.uCap, uFaceSel: U.uFaceSel, ...selU() },
    vertexShader: `attribute float aArm; attribute float aT; uniform float uB[7]; varying float vB; varying vec3 vW; varying vec3 vN;
void main(){ int k = int(aArm + 0.5); vB = mix(uB[6], uB[k], aT); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
 vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uMarble; uniform float uDirect; uniform float uCap; uniform float uFaceSel; varying float vB; varying vec3 vW; varying vec3 vN; ${depthGLSL} ${selGLSL}
void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))); float rim = pow(f, 2.2);
 vec3 d = vW - uMarble; float direct = uDirect * 0.002 / (0.03 + dot(d, d));
 float b = (0.4 + 0.26 * rim) * nearTube(vW) + vB * (0.22 + 0.22 * rim) + direct * rim; float g = uFaceSel * selGlow(vW); gl_FragColor = vec4(vec3(min(b * selk(vW) + 0.1 * g, uCap + 0.08 * g)), 1.0); }` });
}
// A matched joint is a light collar; it brightens with the light passing through it.
function sleeveMat() {
  return new THREE.ShaderMaterial({ ...ink, uniforms: { uB: { value: 0 }, uMarble: U.uMarble, uDirect: U.uDirect, uDepth: U.uDepth, uCap: U.uCap, uFaceSel: U.uFaceSel, ...selU() }, vertexShader: worldVert,
    fragmentShader: `uniform float uB; uniform vec3 uMarble; uniform float uDirect; uniform float uCap; uniform float uFaceSel; varying vec3 vW; varying vec3 vN; ${depthGLSL} ${selGLSL}
void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))); float rim = pow(f, 1.4);
 float b = (0.42 + 0.28 * rim) * nearTube(vW) + uB * (0.18 + 0.2 * rim); float g = uFaceSel * selGlow(vW); gl_FragColor = vec4(vec3(min(b * selk(vW) + 0.1 * g, uCap + 0.02 + 0.08 * g)), 1.0); }` });
}
// The feet are the same frosted glass as the tubes, as in the first build: a soft body that lightens toward its
// silhouette, as light as an unlit tube and fading less with depth than the glass does, lit a little by the marble
// when it is near, and never as light as a lit tube, so the marble and the light it carries stay ahead of them.
const feetMat = new THREE.ShaderMaterial({ ...ink, uniforms: { uMarble: U.uMarble, uDirect: U.uDirect, uDepth: U.uDepth, uSolved: U.uSolved }, vertexShader: worldVert,
  fragmentShader: `uniform vec3 uMarble; uniform float uDirect; uniform float uSolved; varying vec3 vW; varying vec3 vN; ${depthGLSL}
void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))); float rim = pow(f, 2.0); vec3 d = vW - uMarble;
 float b = (0.4 + 0.26 * rim) * nearTube(vW) * (1.0 + 0.15 * uSolved) + uDirect * 0.004 / (0.04 + dot(d, d)) * rim; gl_FragColor = vec4(vec3(min(b, 0.6)), 1.0); }` });
// An unmatched end is a dark seal with a thin grey rim.
// Drawn after the glass, so a seal reads through the frosted wall in front of it.
const capMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, uniforms: {},
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float ring = smoothstep(0.72, 0.8, r) * (1.0 - smoothstep(0.93, 1.0, r));
 gl_FragColor = vec4(vec3(0.012 + 0.36 * ring), 1.0); }` });
const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const bloomMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uGlow: { value: 1 }, uS: { value: 1.9 } },
  vertexShader: `uniform float uS; varying vec2 vP; void main(){ vP = position.xy * uS; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += vP; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uGlow; varying vec2 vP; void main(){ float r = length(vP);
 float b = uGlow * (0.16 * exp(-pow(r / 0.12, 2.0)) + 0.06 * exp(-pow(r / 0.3, 2.0)) + 0.035 * exp(-pow(r / 0.75, 2.0)));
 gl_FragColor = vec4(vec3(b), 1.0); }` });
const floorMat = new THREE.ShaderMaterial({ uniforms: { uMarble: U.uMarble, uOn: U.uOn, uTrans: { value: 0.82 }, uCube: { value: new THREE.Vector2() }, uHalf: { value: 1 }, uContact: { value: 1 }, uGlow: { value: 0 }, uRoom: { value: 4 }, uFootR: { value: 0.05 }, uFeet: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec3 uMarble; uniform float uOn; uniform float uTrans; uniform vec2 uCube; uniform float uHalf; uniform float uContact; uniform float uGlow; uniform float uRoom; uniform float uFootR; uniform vec4 uFeet[6]; varying vec3 vW;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){ vec2 p = vW.xz; float amb = ${Math.pow(BG, 2.2).toFixed(5)} + 0.05 * exp(-dot(p, p) / (uRoom * uRoom));
 vec2 q = abs(p - uCube) - vec2(uHalf); float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); float foot = 1.0 - smoothstep(-0.35, 0.4, sd);
 vec3 d = vec3(p.x, 0.0, p.y) - uMarble; float h = max(uMarble.y, 0.03); float r2 = dot(d, d);
 float e = uOn * uTrans * 0.32 * h / (r2 * sqrt(r2)); float lit = 0.26 * (1.0 - exp(-e * 0.8));
 // Each foot (xy its centre, z its share of the full height) leaves a soft round contact shadow.
 float touch = 0.0; for (int i = 0; i < 6; i++) touch = max(touch, uFeet[i].z * exp(-pow(max(length(p - uFeet[i].xy) - uFootR, 0.0) / 0.04, 2.0)));
 float c = (amb * (1.0 - 0.4 * foot * uContact) + lit * (1.0 - 0.12 * foot * uContact)) * (1.0 - 0.22 * touch) + uGlow * 0.012 * exp(-max(sd, 0.0) * 1.4);
 c = pow(c, 1.0 / 2.2) + (hash(gl_FragCoord.xy) - 0.5) / 255.0; gl_FragColor = vec4(vec3(max(c, 0.0)), 1.0); }` });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
floor.rotation.x = -Math.PI / 2; floor.renderOrder = -1; scene.add(floor);

// ---------- Shared geometry ----------
const boxGeom = new THREE.BoxGeometry(2 * HB, 2 * HB, 2 * HB), edgeGeom = new THREE.EdgesGeometry(boxGeom);
const partCache = new Map();
function parts() { // collar, seal and spout rings for the current tube size
  if (!partCache.has(RT)) partCache.set(RT, { sleeve: new THREE.CylinderGeometry(RS, RS, 2 * SEAT, 24, 1, true), cap: new THREE.CircleGeometry(RT * 1.12, 28),
    rings: [new THREE.TorusGeometry(RT * 1.43, 0.016, 8, 64), new THREE.TorusGeometry(RT * 1.93, 0.016, 8, 72)] });
  return partCache.get(RT);
}
// Stencil twins for the marble's occlusion passes (see the marble, below).
const OCC = { uMz: { value: 1 }, uOccC: { value: new THREE.Vector2() }, uOccR: { value: 0 } };
function occluderMat(solid) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, colorWrite: false, side: THREE.DoubleSide, uniforms: OCC,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilRef: solid ? 0x80 : 1, stencilWriteMask: solid ? 0x80 : 1, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    vertexShader: `varying float vZ; void main(){ vec4 v = modelViewMatrix * vec4(position, 1.0); vZ = -v.z; gl_Position = projectionMatrix * v; }`,
    fragmentShader: `uniform float uMz; uniform vec2 uOccC; uniform float uOccR; varying float vZ; void main(){ if (vZ >= uMz || distance(gl_FragCoord.xy, uOccC) > uOccR) discard; gl_FragColor = vec4(0.0); }` });
}
const frostOcc = occluderMat(false), solidOcc = occluderMat(true);
// Twins ride inside a mesh, so they share its place and visibility: a stencil twin for the marble's occlusion passes,
// and a shade twin for frosted glass behind glass.
function twin(mesh, mat, order = 25) { const t = new THREE.Mesh(mesh.geometry, mat); t.renderOrder = order; t.frustumCulled = false; mesh.add(t); (mesh.userData.twins ||= []).push(t); return t; }
const setGeom = (mesh, g) => { mesh.geometry = g; for (const t of mesh.userData.twins || []) t.geometry = g; };
// Tubes, collars and feet keep their own lightness (max blending), so one darker than the glass stacked in front of
// it would vanish into that glass. Just before them, each one's outline dims what is already drawn there by a third,
// once per pixel (stencil bit 2): a tube lighter than the glass shows as before, and one darker shows as a darker
// shape, so every tube and foot stays visible through the glass from every side.
const shadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.33, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 2, stencilFuncMask: 2, stencilWriteMask: 2, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp });
const shade = mesh => twin(mesh, shadeMat, 0.5);
// Each foot is a short round glass post standing on the floor with a flat top, centred under a corner of the cube's
// bottom face. They belong to the room, not the cube: they stand upright while it turns and leans. In a roll the pair
// under the pivot edge holds it, the pair the cube lifts off sinks into the floor and a pair rises under the far
// corners as they come down, so there are six, and four at rest (feet.js has the layout).
// Built as a round side and a flat top (its underside stands on the floor and is never seen).
function footGeom(r, H, k = 18) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= k; i++) { const a = i / k * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); pos.push(r * c, 0, r * s, r * c, H, r * s); nor.push(c, 0, s, c, 0, s); }
  for (let i = 0; i < k; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const o = pos.length / 3; pos.push(0, H, 0); nor.push(0, 1, 0);
  for (let i = 0; i <= k; i++) { const a = i / k * Math.PI * 2; pos.push(r * Math.cos(a), H, r * Math.sin(a)); nor.push(0, 1, 0); if (i) idx.push(o, o + i + 1, o + i); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
}
const feetGeom = footGeom(FEET.width, FEET.height);
// Over the open floor a foot shows lighter than it; seen through the cube, its outline dims what lies behind it, like a
// tube's, so the far feet show through the glass as darker shapes. A foot is a closed post above the floor, so its
// front faces alone cover its outline and its shade takes one pass.
const footShade = shadeMat.clone(); footShade.side = THREE.FrontSide;
const feet = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(feetGeom, feetMat); m.renderOrder = 1; twin(m, solidOcc); twin(m, footShade, 0.5); m.visible = false; scene.add(m); return m; });
function dressFeet() { floorMat.uniforms.uFootR.value = FEET.width; placeFeet(null); }
// Stands each foot where feet.js puts it for this moment of a roll (or at rest), at its share of the full height.
function placeFeet(rollNow) {
  const spots = FT.feetAt(n, rollNow);
  feet.forEach((m, i) => {
    const d = spots[i], k = d ? d.k : 0; m.d = d || null; m.visible = k > 0.01 && !m.userData.hidden;
    if (d) { m.position.set(d.corner[0], 0, d.corner[1]); m.scale.set(1, Math.max(k, 0.01), 1); m.updateMatrixWorld(true); }
    floorMat.uniforms.uFeet.value[i].set(d ? d.corner[0] : 0, d ? d.corner[1] : 0, m.visible ? k : 0, 0);
  });
}
// The marble is drawn last, against what really lies in front of it, and in every state it is the brightest and most
// findable thing on screen; what hides it is told by shape. Where nothing does (in the open, or seen through an open
// tube end) it is a white ball at its true size with a hard edge, a dark rim and a thin bright outer ring. Behind a
// frosted tube wall it is a soft disc with a core at full white and no hard rim, as the frost would show it. When
// anything that looks solid (a seal, a collar, the spout's rings, a foot) stands in front of any of it, the complete
// silhouette circle is drawn over everything as a crisp white ring, and nothing fills it where the solid thing is.
// The glass faces and hairlines never count: everything is behind some glass.
// Just before the marble, every occluder near it on screen and nearer than it is drawn again into the stencil buffer
// only: a frosted wall sets the low bit, anything solid the top bit. The three looks then each draw only where the
// stencil says. The rim and ring keep a screen-space minimum (about 16 CSS px across when fitted) and
// fall back to the ball's own edge as it is zoomed in. Radii are in world units; uPx is one CSS pixel at the marble.
const seen = stencilFunc => ({ stencilWrite: true, stencilWriteMask: 0, stencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
const markerVert = `uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ vP = position.xy * (uRing + 4.0 * uPx); vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += vP; gl_Position = projectionMatrix * mv; }`;
const markerU = { uR: { value: RM }, uRim: { value: RM * 1.3 }, uRing: { value: RM * 1.5 }, uPx: { value: 0.01 } };
const ballMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerU, ...seen(THREE.EqualStencilFunc), stencilRef: 0, stencilFuncMask: 0x81,
  vertexShader: markerVert,
  fragmentShader: `uniform float uR; uniform float uRim; uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ float r = length(vP), aa = max(fwidth(r), 1e-5) * 0.75;
 float ball = 1.0 - smoothstep(uR - aa, uR + aa, r), rim = 1.0 - smoothstep(uRim - aa, uRim + aa, r), ring = 1.0 - smoothstep(0.55 * uPx - aa, 0.55 * uPx + aa, abs(r - uRing));
 vec3 c = mix(vec3(0.03), vec3(1.0 - 0.1 * smoothstep(0.6 * uR, uR, r)), ball); c = mix(c, vec3(0.92), ring * (1.0 - rim));
 gl_FragColor = vec4(c, max(max(ball, rim), ring)); }` });
// Behind frost: a soft disc with a core at full white, fading out softly past the ball's edge with no hard rim.
const milkMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerU, ...seen(THREE.EqualStencilFunc), stencilRef: 1, stencilFuncMask: 0x81,
  vertexShader: markerVert,
  fragmentShader: `uniform float uR; uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ float R = max(uR * 1.3, 0.9 * uRing), r = length(vP) / R;
 float k = 1.0 - smoothstep(0.48, 1.0, r); gl_FragColor = vec4(vec3(1.0), k * k * (3.0 - 2.0 * k)); }` });
// When something solid stands in front: the complete silhouette circle, a crisp white ring 4 px wide at full
// brightness with a thin dark edge either side, drawn over the occluder whatever the stencil says.
const outlineMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms: markerU,
  vertexShader: markerVert,
  fragmentShader: `uniform float uRing; uniform float uPx; varying vec2 vP; void main(){ float r = length(vP), aa = max(fwidth(r), 1e-5) * 0.75, d = abs(r - uRing);
 float ring = 1.0 - smoothstep(2.0 * uPx - aa, 2.0 * uPx + aa, d), edge = 1.0 - smoothstep(3.0 * uPx - aa, 3.0 * uPx + aa, d);
 gl_FragColor = vec4(vec3(ring), max(ring, 0.55 * edge)); }` });
// One ring of light leaves the marble when a board opens or restarts, so the eye finds it.
const cueMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uRad: { value: 0 }, uW: { value: 0.01 }, uA: { value: 0 }, uS: { value: 1 } },
  vertexShader: `uniform float uS; varying vec2 vP; void main(){ vP = position.xy * uS; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += vP; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uRad; uniform float uW; uniform float uA; varying vec2 vP; void main(){ float d = (length(vP) - uRad) / uW; gl_FragColor = vec4(vec3(uA * exp(-d * d)), 1.0); }` });
const marble = new THREE.Group(), quad = () => new THREE.PlaneGeometry(2, 2), bloom = new THREE.Mesh(quad(), bloomMat), ballMesh = new THREE.Mesh(quad(), ballMat), milkMesh = new THREE.Mesh(quad(), milkMat), lineMesh = new THREE.Mesh(quad(), outlineMat), cue = new THREE.Mesh(quad(), cueMat);
bloom.renderOrder = 20; ballMesh.renderOrder = milkMesh.renderOrder = 31; lineMesh.renderOrder = 32; lineMesh.visible = false; cue.renderOrder = 30; for (const m of [bloom, ballMesh, milkMesh, lineMesh, cue]) m.frustumCulled = false; cue.visible = false; marble.add(bloom, cue, ballMesh, milkMesh, lineMesh);
// The double ring is the strongest line in the cube, a step below the marble's white.
// Drawn after the glass, like the seals, so the glass never lightens it past that step.
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.8, 0.8), transparent: true, depthWrite: false });
const spoutRings = new THREE.Group(); for (const g of parts().rings) { const r = new THREE.Mesh(g, ringMat); r.renderOrder = 12; twin(r, solidOcc); spoutRings.add(r); }
const align = (obj, from, d) => obj.quaternion.setFromUnitVectors(from, VEC[d]);

// Tube pieces: swept rings along each arm, with a rounded bend for an elbow. Each vertex records the arm it belongs
// to and how far along it lies, so light can fall off continuously from joint to joint. Every ring has 24 sides and a
// frame square to the cube's axes (a bend keeps its plane's normal as the frame), so the ends of any two pieces that
// meet have exactly the same facets. An end that joins its neighbour runs on through the gap between the cubies to
// meet the neighbour's end halfway, so a joined pair reads as one tube under one collar.
const tubeCache = new Map(), SEGS = 24, JOIN = 0.5;
function sweep(o, pts, arms, ts, N0) {
  const base = o.pos.length / 3;
  let T = pts[1].clone().sub(pts[0]).normalize(), N = N0 ? N0.clone() : Math.abs(T.y) < 0.9 ? V3(0, 1, 0) : V3(1, 0, 0);
  N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) { T = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i - 1]) : pts[i].clone().sub(pts[i - 1])).normalize(); N.sub(T.clone().multiplyScalar(N.dot(T))).normalize(); }
    const B = V3().crossVectors(T, N);
    for (let j = 0; j <= SEGS; j++) {
      const a = j / SEGS * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
      o.pos.push(pts[i].x + nx * RT, pts[i].y + ny * RT, pts[i].z + nz * RT); o.nor.push(nx, ny, nz); o.arm.push(arms[i]); o.t.push(Math.min(1, ts[i]));
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < SEGS; j++) { const a = base + i * (SEGS + 1) + j, b = a + SEGS + 1; o.idx.push(a, b, a + 1, b, b + 1, a + 1); }
}
function ball(o, away) { // a sphere at the centre, or the half of it facing `away` for a closed end
  const base = o.pos.length / 3, rows = 12, cols = SEGS;
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
    const th = i / rows * Math.PI, ph = j / cols * Math.PI * 2; let v = V3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    if (away !== undefined) { v = V3(Math.sin(th / 2) * Math.cos(ph), Math.cos(th / 2), Math.sin(th / 2) * Math.sin(ph)).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, VEC[away])); }
    o.pos.push(v.x * RT, v.y * RT, v.z * RT); o.nor.push(v.x, v.y, v.z); o.arm.push(6); o.t.push(0);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = base + i * (cols + 1) + j, b = a + cols + 1; o.idx.push(a, b, a + 1, b, b + 1, a + 1); }
}
// How far the arm toward d reaches from the cubie's centre: to its glass wall, or on to the joint halfway across the gap.
const reachOf = (d, join) => join & (1 << d) ? JOIN : HB;
function arm(o, d, from, join) { const to = reachOf(d, join), pts = [], arms = [], ts = []; for (let i = 0; i <= 5; i++) { const r = from + (to - from) * i / 5; pts.push(VEC[d].clone().multiplyScalar(r)); arms.push(d); ts.push(r / HB); } sweep(o, pts, arms, ts); }
function straight(o, d, join) { // a straight run through the centre along d's axis
  const lo = reachOf(d + 1, join), hi = reachOf(d, join), pts = [], arms = [], ts = [];
  for (let i = 0; i <= 12; i++) { const r = -lo + (lo + hi) * i / 12; pts.push(VEC[d].clone().multiplyScalar(r)); arms.push(r < 0 ? d + 1 : d); ts.push(Math.abs(r) / HB); }
  sweep(o, pts, arms, ts);
}
function tubeGeom(mask, join = 0) {
  join &= mask; const key = RT + ':' + mask + ':' + join; if (tubeCache.has(key)) return tubeCache.get(key);
  const o = { pos: [], nor: [], arm: [], t: [], idx: [] }, open = [0, 1, 2, 3, 4, 5].filter(d => mask & (1 << d));
  const pairs = open.filter(d => d % 2 === 0 && open.includes(d + 1));
  if (open.length === 2 && pairs.length === 1) straight(o, pairs[0], join);
  else if (open.length === 2) { // elbow with a rounded bend, its frame the bend plane's normal
    const [a, b] = open, pts = [], arms = [], ts = [], C = VEC[a].clone().add(VEC[b]).multiplyScalar(RBEND), ra = reachOf(a, join), rb = reachOf(b, join);
    for (let i = 0; i < 6; i++) { const r = ra - (ra - RBEND) * i / 6; pts.push(VEC[a].clone().multiplyScalar(r)); arms.push(a); ts.push(r / HB); }
    for (let i = 0; i <= 16; i++) { const f = i / 16 * Math.PI / 2, p = C.clone().addScaledVector(VEC[b], -RBEND * Math.cos(f)).addScaledVector(VEC[a], -RBEND * Math.sin(f)), k = i < 8 ? a : b; pts.push(p); arms.push(k); ts.push(Math.max(0, p.dot(VEC[k])) / HB); }
    for (let i = 1; i <= 6; i++) { const r = RBEND + (rb - RBEND) * i / 6; pts.push(VEC[b].clone().multiplyScalar(r)); arms.push(b); ts.push(r / HB); }
    sweep(o, pts, arms, ts, V3().crossVectors(VEC[a], VEC[b]));
  } else if (open.length === 3 && pairs.length === 1) { // tee: a straight run and a branch
    straight(o, pairs[0], join); arm(o, open.find(k => k >> 1 !== pairs[0] >> 1), RT * 0.75, join);
  } else if (open.length === 1) { arm(o, open[0], 0, join); ball(o, open[0] ^ 1); }
  else { for (const d of open) arm(o, d, RT * 0.6, join); ball(o); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
  g.setAttribute('aArm', new THREE.Float32BufferAttribute(o.arm, 1)); g.setAttribute('aT', new THREE.Float32BufferAttribute(o.t, 1)); g.setIndex(o.idx);
  tubeCache.set(key, g); return g;
}

// ---------- Board and display state ----------
let board, n, info, state, orient = new THREE.Quaternion(), centers = [], cells = [];
let shown = null; // the masks and spout currently drawn (they lag the rules while a slice turns)
let marbleCell = 0, marbleOffset = V3(), marbleOut = false, marbleWorld = V3();
let roll = null, layer = null, turnAngle = 0, rise = 0;
// The lean: the cube tips a little toward a level direction (a swipe beside it, a tap, a hint) without rolling.
const leanVec = V3(), leanGoal = V3(), LEAN_MAX = 15 * Math.PI / 180;
let anim = null, queue = [], drag = null, gesture = null, showNext = false, lightMode = 'marble';
// The free look: a turn around the cube (any angle, the whole circle), an elevation and a zoom window.
// Looking never touches the rules. A release within about 12 degrees of a quarter settles onto it.
const look = { yaw: 0, pitch: PITCH, zoom: 1, vx: 0, vy: 0, anim: null };
const QUARTER = Math.PI / 2, nearestQuarter = () => Math.round(look.yaw / QUARTER);
let pxWorld = 0.01, cueState = null, cueCount = 0;
let light = { target: null, shown: null, gate: null, dist: null };
const tmpQ = new THREE.Quaternion();

function buildBoard() {
  for (const c of cells) { cubeRoot.remove(c.group); pivot.remove(c.group); c.tube.material.dispose(); c.faces.material.dispose(); for (const s of c.sleeves) s.material.dispose(); }
  board = ALL.find(b => b.id === boardId); n = board.n; info = E.setup(n); cells = []; centers = []; FEET = FT.size(n); FOOT = FEET.height;
  ({ rt: RT, bend: RBEND, rs: RS } = TUBES[n]); const P = parts(); spoutRings.children.forEach((r, i) => setGeom(r, P.rings[i]));
  for (let c = 0; c < info.count; c++) {
    const center = V3(...info.pos(c)).multiplyScalar(0.5), group = new THREE.Group(); group.position.copy(center); centers.push(center);
    // The faces' faint tint is drawn first; tubes, collars and hairlines then keep their own lightness over it.
    const faces = new THREE.Mesh(boxGeom, faceMat([0, 1, 2, 3, 4, 5].map(d => info.neighbour[c * 6 + d] < 0 ? 1 : 0))), edges = new THREE.LineSegments(edgeGeom, edgeMat), tube = new THREE.Mesh(tubeGeom(0), tubeMat()); edges.renderOrder = tube.renderOrder = 1; twin(tube, frostOcc); shade(tube);
    const sleeves = [], caps = [];
    for (let d = 0; d < 6; d++) {
      const s = new THREE.Mesh(P.sleeve, sleeveMat()); s.renderOrder = 1; twin(s, solidOcc); shade(s); align(s, UP, d); s.position.copy(VEC[d]).multiplyScalar(JOIN); sleeves.push(s);
      const k = new THREE.Mesh(P.cap, capMat); k.renderOrder = 10; twin(k, solidOcc); align(k, V3(0, 0, 1), d); k.position.copy(VEC[d]).multiplyScalar(HB - 0.007); caps.push(k);
    }
    group.add(faces, edges, tube, ...sleeves, ...caps); cubeRoot.add(group);
    cells.push({ group, faces, tube, sleeves, caps });
  }
  const V = info.count * 7;
  light = { target: new Float32Array(V), shown: new Float32Array(V), gate: new Float64Array(V), dist: new Float32Array(V) };
  edgeMat.uniforms.uBase.value = n === 3 ? 0.33 : 0.38; // more cubies, finer glass
  U.uGlowK.value = n === 3 ? 0.6 : 1; // more cubies stack more glass, so each glows less
  floorMat.uniforms.uHalf.value = n / 2 - SEAT; floorMat.uniforms.uRoom.value = 1.7 * n + 1.6; dressFeet();
  fit();
}

// Places every tube, collar, seal and the spout's double ring from a rules state.
function syncCells(s) {
  shown = { masks: s.masks.slice(), spout: s.spout.slice() };
  for (let c = 0; c < info.count; c++) {
    const m = s.masks[c], cell = cells[c]; let join = 0;
    for (let d = 0; d < 6; d++) {
      const open = !!(m & (1 << d)), q = info.neighbour[c * 6 + d], matched = open && q >= 0 && !!(s.masks[q] & (1 << (d ^ 1)));
      const exit = s.spout[0] === c && s.spout[1] === d && q < 0;
      if (matched) join |= 1 << d;
      // One even collar per joint, centred in the gap: the cubie on the joint's lower side along the axis holds it.
      cell.sleeves[d].visible = matched && d % 2 === 0; cell.caps[d].visible = open && !matched && !exit;
    }
    cell.tube.visible = !!m; if (m) setGeom(cell.tube, tubeGeom(m, join));
  }
  const [sc, sd] = s.spout; cells[sc].group.add(spoutRings); align(spoutRings, V3(0, 0, 1), sd); spoutRings.position.copy(VEC[sd]).multiplyScalar(HB - 0.013);
}
function restOffset(s) { const f = E.fall(s); return f.atEnd ? VEC[s.g].clone().multiplyScalar(END) : V3(); }
function restWorld(s, q) { // where the marble comes to rest on the floor after leaving by the spout
  // It lands under the spout and rolls straight toward the viewer, under the glass and out between two feet, coming to
  // rest just beyond them.
  const p = centers[s.spout[0]].clone().addScaledVector(VEC[s.g], FOOT + HB - RM).applyQuaternion(q).add(V3(0, FOOT + n / 2 - SEAT, 0)); p.y = RM;
  const dir = frontAxis();
  return { from: p, dir, dist: FEET.out - p.dot(dir) };
}
// Shows a rules state at once: after loading, undo, restart or a board change.
function syncAll() {
  const r = replay(board, history); state = r.state; orient.copy(r.orient);
  anim = null; roll = null; endLayer(); turnAngle = 0; leanVec.set(0, 0, 0); leanGoal.set(0, 0, 0);
  syncCells(state);
  if (state.out) { const w = restWorld(state, orient); marbleOut = true; marbleWorld.copy(w.from).addScaledVector(w.dir, w.dist); scene.add(marble); lightMode = 'solved'; }
  else { marbleOut = false; cubeRoot.add(marble); marbleCell = state.marble; marbleOffset.copy(restOffset(state)); lightMode = 'marble'; }
  floorMat.uniforms.uGlow.value = state.out ? 0.6 : 0; U.uSolved.value = state.out ? 1 : 0; U.uCap.value = state.out ? 0.82 : 0.7;
  showNext = state.out && hasNext();
  computeLight(false, true); updateUI(); kick();
}

// ---------- Light through the tube network ----------
// Nodes are each cubie's centre (6) and its six tube ends (0..5). Light starts at the marble, runs half a
// cubie from centre to end, crosses a joint only where both ends are open, and fades with distance.
function computeLight(flow, instant) {
  const C = info.count, Vn = C * 7, dist = light.dist.fill(Infinity), done = new Uint8Array(Vn), masks = shown.masks;
  if (lightMode === 'solved') { for (let c = 0; c < C; c++) for (let k = 0; k < 7; k++) light.target[c * 7 + k] = masks[c] && (k === 6 || masks[c] & (1 << k)) ? SOLVED_GLOW : 0; }
  else {
    if (!marbleOut && masks[marbleCell]) {
      const o = marbleOffset, len = o.length();
      if (len < 1e-3) dist[marbleCell * 7 + 6] = 0;
      else { const a = Math.abs(o.x) >= Math.abs(o.y) && Math.abs(o.x) >= Math.abs(o.z) ? (o.x > 0 ? 0 : 1) : Math.abs(o.y) >= Math.abs(o.z) ? (o.y > 0 ? 2 : 3) : (o.z > 0 ? 4 : 5);
        const u = Math.min(len, ARM); dist[marbleCell * 7 + 6] = u; if (masks[marbleCell] & (1 << a)) dist[marbleCell * 7 + a] = ARM - u; }
    }
    const cut = (a, b) => layer && layer.members.has(a) !== layer.members.has(b);
    for (;;) {
      let best = -1, bd = Infinity; for (let i = 0; i < Vn; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
      if (best < 0) break; done[best] = 1;
      const c = Math.floor(best / 7), k = best % 7, relax = (j, w) => { if (dist[best] + w < dist[j]) dist[j] = dist[best] + w; };
      if (k === 6) { for (let d = 0; d < 6; d++) if (masks[c] & (1 << d)) relax(c * 7 + d, ARM); }
      else { relax(c * 7 + 6, ARM); const q = info.neighbour[c * 6 + k]; if (q >= 0 && masks[q] & (1 << (k ^ 1)) && !cut(c, q)) relax(q * 7 + (k ^ 1), 0); }
    }
    for (let i = 0; i < Vn; i++) light.target[i] = isFinite(dist[i]) ? Math.exp(-dist[i] / LAMBDA) : 0;
  }
  const now = performance.now();
  for (let i = 0; i < Vn; i++) {
    if (instant || reduced()) { light.shown[i] = light.target[i]; light.gate[i] = 0; }
    else if (flow && light.target[i] > light.shown[i] + 0.02) light.gate[i] = now + (isFinite(dist[i]) ? dist[i] : 0) / FLOW * 1000;
  }
  writeLight();
}
function stepLight(now, dt) {
  if (lightMode === 'flood') return false;
  let moving = false; const t = light.target, s = light.shown;
  for (let i = 0; i < t.length; i++) {
    if (Math.abs(t[i] - s[i]) < 0.004) { s[i] = t[i]; continue; }
    moving = true;
    if (t[i] > s[i] && now < light.gate[i]) continue;
    s[i] += (t[i] - s[i]) * (1 - Math.exp(-dt / (t[i] > s[i] ? 45 : 70)));
  }
  writeLight(); return moving;
}
function writeLight() {
  const s = light.shown;
  for (let c = 0; c < cells.length; c++) { const u = cells[c].tube.material.uniforms.uB.value; for (let k = 0; k < 7; k++) u[k] = s[c * 7 + k]; for (let d = 0; d < 6; d++) cells[c].sleeves[d].material.uniforms.uB.value = s[c * 7 + d]; }
}

// ---------- Layers: a slice lifted into the pivot while it turns ----------
function beginLayer(a, l) {
  if (layer && layer.a === a && layer.l === l) return;
  endLayer();
  const members = new Set(); for (let c = 0; c < info.count; c++) if (info.cell(c)[a] === l) { members.add(c); pivot.add(cells[c].group); }
  layer = { a, l, members, carried: !marbleOut && members.has(marbleCell) };
  computeLight(false, false);
}
function endLayer() { if (!layer) return; for (const c of layer.members) cubeRoot.add(cells[c].group); layer = null; pivot.quaternion.identity(); turnAngle = 0; }

// ---------- Placement each frame ----------
function placeCube() {
  const hs = n / 2 - SEAT, p = V3(0, FOOT + hs, 0); let q = orient.clone(), th = 0, w = null, shift = 0, rollNow = null;
  // A tip rolls the cube over its leading bottom edge, which stays on the feet under it: a quarter turn gathering speed
  // like a falling weight, a heavy landing on the next face, and meanwhile cube and feet slide back so it settles where
  // it started (feet.js). It carries on from any lean over the same edge.
  if (roll) { const P = FT.rollPose(n, roll.t, roll.th0); th = P.theta; shift = P.shift; w = roll.w; q = roll.q0.clone(); rollNow = { w: roll.w.toArray(), theta: P.theta, recentre: P.recentre, th0: roll.th0 }; }
  // A lean tilts the cube on the feet on that side, or on one corner's foot, never lifting what it stands on.
  else if (leanVec.lengthSq() > 1e-8) { th = leanVec.length(); w = leanVec.clone().divideScalar(th); }
  if (w) {
    const e = V3(...FT.leanPivot(n, w.x, w.z)).add(V3(0, FOOT + hs, 0)), R = new THREE.Quaternion().setFromAxisAngle(V3().crossVectors(UP, w).normalize(), th);
    p.sub(e).applyQuaternion(R).add(e).addScaledVector(w, shift); q = R.multiply(q);
  }
  placeFeet(rollNow);
  // A slice turning about a level axis would dip into the feet it stood on and then below their tops, so the whole cube
  // rises with it, just ahead of its lowest edge and then just clear of the floor, and sets back down as it squares up.
  // A slice turning about the upright axis slides across the feet's tops and needs no lift.
  if (layer) { pivot.quaternion.setFromAxisAngle(VEC[layer.a * 2], turnAngle); if (Math.abs(VEC[layer.a * 2].clone().applyQuaternion(orient).y) < 0.5) p.y += FT.turnLift(n, turnAngle); }
  rise = p.y - (FOOT + hs);
  cubeRoot.position.copy(p); cubeRoot.quaternion.copy(q); cubeRoot.updateMatrixWorld(true);
  if (marbleOut) marble.position.copy(marbleWorld);
  else { const m = centers[marbleCell].clone().add(marbleOffset); if (layer && layer.carried) m.applyQuaternion(pivot.quaternion); marble.position.copy(m); }
  marble.updateMatrixWorld(true); marble.getWorldPosition(U.uMarble.value);
  const depth = Math.max(0.5, -U.uMarble.value.clone().applyMatrix4(camera.matrixWorldInverse).z);
  pxWorld = 2 * depth * Math.tan(FOV * Math.PI / 360) / (viewH * look.zoom);
  const bu = markerU; bu.uPx.value = pxWorld; bu.uR.value = RM; bu.uRim.value = Math.max(RM + 1.6 * pxWorld, 6.6 * pxWorld); bu.uRing.value = Math.max(bu.uRim.value + 0.9 * pxWorld, 7.5 * pxWorld);
  // What lies in front of the marble is judged against its centre's depth, within its marker's reach on screen.
  const ms = toScreen(U.uMarble.value), dpr = renderer.getPixelRatio(); OCC.uMz.value = depth; OCC.uOccC.value.set(ms.x * dpr, (viewH - ms.y) * dpr); OCC.uOccR.value = (bu.uRing.value / pxWorld + 4) * dpr;
  const fu = floorMat.uniforms; fu.uCube.value.set(cubeRoot.position.x, cubeRoot.position.z);
  // The cube's soft shadow on the floor fades while it is up on an edge and returns as it lands.
  fu.uContact.value = roll ? Math.max(0, 1 - Math.sin(2 * th)) : Math.max(0, 1 - 2.5 * rise - leanVec.length() * 3);
  U.uCubeInv.value.copy(cubeRoot.matrixWorld).invert();
  fu.uTrans.value = marbleOut ? 1 : 0.82; U.uDirect.value = marbleOut ? 0.5 : 1;
}

// The feet that are standing, in the world: round their sides, at the floor and at their tops.
function feetPoints() {
  const out = [], r = FEET.width; for (const m of feet) { if (!m.visible || !m.d) continue; const [x, z] = m.d.corner; for (const y of [0, m.scale.y * FOOT]) for (let a = 0; a < 8; a++) out.push(V3(x + r * Math.cos(a * Math.PI / 4), y, z + r * Math.sin(a * Math.PI / 4))); }
  return out;
}

// The arrival cue: a ring of light grows from the marble and fades (about 700 ms); with reduced motion a still
// ring stands around it for a second.
function arrival() { cueCount++; cueState = { t0: performance.now(), still: reduced() }; if (cueState.still) setTimeout(kick, 1050); kick(); }
function stepCue(now) {
  if (!cueState) { cue.visible = false; return false; }
  const t = (now - cueState.t0) / (cueState.still ? 1000 : 700), r = ballMat.uniforms.uRing.value;
  if (t >= 1) { cueState = null; cue.visible = false; return false; }
  const rad = cueState.still ? r * 2 : r * (1.3 + 5.5 * easeOut(t)), w = 1.3 * pxWorld, u = cueMat.uniforms;
  u.uRad.value = rad; u.uW.value = w; u.uA.value = cueState.still ? 0.85 : 0.95 * Math.pow(1 - t, 1.3); u.uS.value = rad + 5 * w; cue.visible = true;
  return !cueState.still;
}

// What lies between the eye and the marble, for the test hook: rays to its centre and eight points round it, each
// open, through frost (tube walls only) or behind something solid (seal, collar, spout ring, foot).
function sight() {
  placeCube(); const occ = [];
  for (const c of cells) { if (c.tube.visible) occ.push([c.tube, 'tube']); c.sleeves.forEach(m => m.visible && occ.push([m, 'collar'])); c.caps.forEach(m => m.visible && occ.push([m, 'seal'])); }
  for (const r of spoutRings.children) occ.push([r, 'ring']); for (const m of feet) if (m.visible) occ.push([m, 'foot']);
  const m = U.uMarble.value, cam = camera.position, right = V3(1, 0, 0).applyQuaternion(camera.quaternion), up = V3(0, 1, 0).applyQuaternion(camera.quaternion), rc = new THREE.Raycaster();
  const out = { open: 0, frost: 0, solid: 0, by: [] };
  for (let k = 0; k < 9; k++) {
    const a = k / 8 * Math.PI * 2, t = m.clone(); if (k) t.addScaledVector(right, 0.7 * RM * Math.cos(a)).addScaledVector(up, 0.7 * RM * Math.sin(a));
    const dir = t.clone().sub(cam), far = dir.length(); rc.set(cam.clone(), dir.normalize()); rc.far = far - RM * 0.5;
    const kinds = new Set(); for (const [mesh, kind] of occ) if (rc.intersectObject(mesh, false).length) kinds.add(kind);
    const cls = [...kinds].some(x => x !== 'tube') ? 'solid' : kinds.size ? 'frost' : 'open'; out[cls]++; for (const x of kinds) if (!out.by.includes(x)) out.by.push(x);
  }
  out.look = out.solid > 4 ? 'solid' : out.frost > 4 ? 'frost' : out.open > 4 ? 'open' : 'mixed'; return out;
}

// Whether anything solid stands in front of any of the marble: rays from the eye to its centre and eight points just
// inside its edge, against the seals, collars, spout rings and feet that are showing.
const solidRay = new THREE.Raycaster();
function solidInFront() {
  const occ = []; for (const c of cells) { c.sleeves.forEach(m => m.visible && occ.push(m)); c.caps.forEach(m => m.visible && occ.push(m)); }
  occ.push(...spoutRings.children); for (const m of feet) if (m.visible) occ.push(m);
  const m = U.uMarble.value, cam = camera.position, right = V3(1, 0, 0).applyQuaternion(camera.quaternion), up = V3(0, 1, 0).applyQuaternion(camera.quaternion);
  for (let k = 0; k < 9; k++) {
    const a = k / 8 * Math.PI * 2, t = m.clone(); if (k) t.addScaledVector(right, 0.9 * RM * Math.cos(a)).addScaledVector(up, 0.9 * RM * Math.sin(a));
    const dir = t.sub(cam), far = dir.length(); solidRay.set(cam, dir.normalize()); solidRay.far = far - RM * 0.5;
    for (const o of occ) if (solidRay.intersectObject(o, false).length) return true;
  }
  return false;
}

// ---------- Rendering on demand ----------
let raf = 0, lastNow = 0;
function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0; if (document.hidden) { lastNow = 0; return; }
  const dt = lastNow ? Math.min(64, now - lastNow) : 16; lastNow = now;
  let more = false;
  if (anim) more = stepAnim(now);
  if (leanVec.distanceToSquared(leanGoal) > 1e-8) { if (reduced()) leanVec.copy(leanGoal); else leanVec.lerp(leanGoal, 1 - Math.exp(-dt / 55)); more = true; } else leanVec.copy(leanGoal);
  if (look.anim) more = stepLook(now) || more;
  placeCube(); more = stepCue(now) || more;
  if (anim && anim.live) computeLight(false, false);
  more = stepLight(now, dt) || more;
  lineMesh.visible = solidInFront();
  renderer.render(scene, camera);
  if (more || anim) { if (!raf) raf = requestAnimationFrame(frame); } else if (!raf) lastNow = 0;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

// ---------- Animation phases ----------
const ease = t => t * t * (3 - 2 * t), easeOut = t => 1 - Math.pow(1 - t, 3), clamp01 = t => Math.max(0, Math.min(1, t));
function play(phases) {
  phases = phases.filter(Boolean);
  if (reduced()) { for (const p of phases) { p.begin?.(); p.update?.(1); p.end?.(); } anim = null; afterAnim(); return; }
  anim = { phases, i: 0, t0: performance.now(), live: false }; phases[0]?.begin?.(); if (!phases.length) { anim = null; afterAnim(); return; }
  kick();
}
function stepAnim(now) {
  while (anim) {
    const ph = anim.phases[anim.i], t = ph.duration ? clamp01((now - anim.t0) / ph.duration) : 1;
    anim.live = !!ph.live; ph.update?.(t, now);
    if (t < 1) return true;
    ph.end?.(); anim.i++; anim.t0 = now;
    if (anim.i >= anim.phases.length) { anim = null; afterAnim(); return false; }
    anim.phases[anim.i].begin?.();
  }
  return false;
}
function fastForward() { if (!anim) return; const a = anim; anim = null; const ph = a.phases[a.i]; ph.update?.(1); ph.end?.(); for (let i = a.i + 1; i < a.phases.length; i++) { a.phases[i].begin?.(); a.phases[i].update?.(1); a.phases[i].end?.(); } afterAnim(); }
function afterAnim() { updateUI(); drain(); if (lookHintDue && !busy()) maybeLookHint(); kick(); }

// A tip: the cube rolls over its bottom edge onto the next face and settles back to the middle (feet.js has the path).
function rollPhase(d, q0) {
  const w = worldDir(d, q0), q1 = rolled(q0, w), off0 = marbleOffset.clone(), glide = off0.lengthSq() > 1e-8;
  return { duration: FT.ROLL_MS, begin() { roll = { w, q0, th0: Math.max(0, leanVec.dot(w)), t: 0 }; leanVec.set(0, 0, 0); leanGoal.set(0, 0, 0); },
    update(t) { roll.t = t; if (glide) marbleOffset.copy(off0).multiplyScalar(1 - ease(t)); },
    end() { roll = null; orient.copy(q1); if (glide) marbleOffset.set(0, 0, 0); } };
}
function leanPhase(d, q0) { const w = worldDir(d, q0); return { duration: 130, update(t) { leanVec.copy(w).multiplyScalar(0.14 * ease(t)); } }; }
function turnPhase(move, from, after) {
  const a = AXES.indexOf(move[0]), l = move[1], target = move[2] * Math.PI / 2;
  let off0, rotated, glide;
  return { duration: Math.max(110, 270 * Math.abs(target - from) / (Math.PI / 2)), live: true,
    begin() { beginLayer(a, l); turnAngle = from; off0 = marbleOffset.clone(); rotated = off0.clone().applyAxisAngle(VEC[a * 2], target);
      glide = layer.carried && off0.lengthSq() > 1e-8 && rotated.clone().normalize().dot(VEC[after.state.g]) < 0.99; },
    update(t) { turnAngle = from + (target - from) * easeOut(t); if (glide) marbleOffset.copy(off0).multiplyScalar(1 - ease(t)); },
    end() { const carried = layer.carried; endLayer(); if (carried) { marbleCell = after.trace.path[0]; marbleOffset.copy(glide ? V3() : rotated); } syncCells(after.state); computeLight(true, false); } };
}
function settlePhase(a, l, from) { return { duration: Math.max(90, 170 * Math.abs(from) / (Math.PI / 2)), live: true, begin() { beginLayer(a, l); turnAngle = from; }, update(t) { turnAngle = from * (1 - easeOut(t)); }, end() { endLayer(); computeLight(true, false); } }; }
function rockPhase(a, l) { return { duration: 320, live: true, begin() { beginLayer(a, l); }, update(t) { turnAngle = Math.sin(t * Math.PI * 3) * 0.09 * (1 - t); }, end() { endLayer(); computeLight(true, false); } }; }
// The marble falls with gravity's acceleration and settles at the end without a bounce.
function fallPhase(tr, s) {
  const g = s.g, path = tr.path, last = path[path.length - 1];
  const end = centers[last].clone().addScaledVector(VEC[g], tr.out ? FOOT + HB - RM : tr.atEnd ? END : 0);
  let start, L = 0, t1 = 0, t2 = 0, v1 = 0, L1 = 0, T = 0;
  const ph = { duration: 1, live: true,
    begin() { start = centers[marbleCell].clone().add(marbleOffset); L = start.distanceTo(end); L1 = L * 0.93; v1 = Math.sqrt(2 * GRAVITY * L1); t1 = Math.sqrt(2 * L1 / GRAVITY); t2 = v1 ? 2 * (L - L1) / v1 : 0; T = t1 + t2; ph.duration = Math.max(1, T * 1000); },
    update(t) {
      const tau = t * T, d = tau < t1 ? 0.5 * GRAVITY * tau * tau : L1 + v1 * (tau - t1) - 0.5 * (v1 / (t2 || 1)) * (tau - t1) * (tau - t1);
      const p = L > 1e-6 ? start.clone().lerp(end, Math.min(1, d / L)) : end.clone();
      let best = path[0], bd = Infinity; for (const c of path) { const k = centers[c].distanceToSquared(p); if (k < bd) { bd = k; best = c; } }
      marbleCell = best; marbleOffset.copy(p).sub(centers[best]);
    },
    end() { marbleCell = last; marbleOffset.copy(end).sub(centers[last]); computeLight(false, false); } };
  return ph;
}
function finishPhases(s) {
  let w, wash = null, arrived = false;
  // The next arrow comes about two seconds after the last move, while the light is still washing back.
  const arrive = () => { if (arrived) return; arrived = true; showNext = hasNext(); updateUI(); announceSolved(); };
  // Each tube node lights when the wash reaches it: first along the network from the spout, then the pieces
  // the network never joined. The crest passes, and every tube settles to a steady glow brighter than play.
  function begin() {
    const C = info.count, Vn = C * 7, masks = shown.masks, dist = new Float32Array(Vn).fill(Infinity), done = new Uint8Array(Vn), has = i => masks[Math.floor(i / 7)] && (i % 7 === 6 || masks[Math.floor(i / 7)] & (1 << (i % 7)));
    dist[s.spout[0] * 7 + s.spout[1]] = 0;
    for (;;) {
      let best = -1, bd = Infinity; for (let i = 0; i < Vn; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
      if (best < 0) break; done[best] = 1;
      const c = Math.floor(best / 7), k = best % 7, relax = (j, x) => { if (dist[best] + x < dist[j]) dist[j] = dist[best] + x; };
      if (k === 6) { for (let d = 0; d < 6; d++) if (masks[c] & (1 << d)) relax(c * 7 + d, ARM); }
      else { relax(c * 7 + 6, ARM); const q = info.neighbour[c * 6 + k]; if (q >= 0 && masks[q] & (1 << (k ^ 1))) relax(q * 7 + (k ^ 1), 0); }
    }
    let far = 0; for (let i = 0; i < Vn; i++) if (isFinite(dist[i])) far = Math.max(far, dist[i]);
    const spout = centers[s.spout[0]].clone().addScaledVector(VEC[s.spout[1]], HB), at = i => centers[Math.floor(i / 7)].clone().addScaledVector(i % 7 < 6 ? VEC[i % 7] : V3(), i % 7 < 6 ? HB : 0);
    for (let i = 0; i < Vn; i++) if (has(i) && !isFinite(dist[i])) dist[i] = far + 0.5 + at(i).distanceTo(spout) * 0.5;
    let last = 0; for (let i = 0; i < Vn; i++) if (has(i)) last = Math.max(last, dist[i]);
    const speed = Math.max(2.2, last / 2); wash = { dist, has, speed, pass: Math.max(1.3, last / speed + 0.65) };
    lightMode = 'flood';
  }
  function at(tau) {
    for (let i = 0; i < wash.dist.length; i++) {
      if (!wash.has(i)) { light.shown[i] = light.target[i] = 0; continue; }
      const x = tau - wash.dist[i] / wash.speed;
      light.shown[i] = light.target[i] = x <= 0 ? 0 : ease(clamp01(x / 0.18)) * (SOLVED_GLOW + (WASH_PEAK - SOLVED_GLOW) * Math.exp(-Math.max(0, x - 0.18) / 0.5));
    }
    const k = clamp01(tau / wash.pass); U.uSolved.value = ease(k); U.uCap.value = 0.7 + 0.12 * ease(k); floorMat.uniforms.uGlow.value = 0.6 * ease(k) + 0.5 * Math.exp(-Math.pow((tau - wash.pass * 0.6) / 0.4, 2)); writeLight();
  }
  return [
    { duration: 900, begin() { const p = marble.getWorldPosition(V3()); w = restWorld(s, orient); w.from.copy(p); w.from.y = RM; marbleOut = true; marbleWorld.copy(w.from); scene.add(marble); computeLight(false, false); },
      update(t) { marbleWorld.copy(w.from).addScaledVector(w.dir, w.dist * (1 - (1 - t) * (1 - t))); } },
    { duration: 1, begin() { begin(); this.duration = wash.pass * 1000; }, update(t) { at(t * wash.pass); if (t * wash.pass >= 0.55) arrive(); } },
    { duration: 0, end() { arrive(); } },
    { duration: 900, update(t) { at(wash.pass + t * 0.9); }, end() { lightMode = 'solved'; U.uSolved.value = 1; floorMat.uniforms.uGlow.value = 0.6; computeLight(false, true); } }
  ];
}

// ---------- Moves ----------
function busy() { return !!anim || !!drag || queue.length > 0; }
function enqueue(item) { queue.push(item); drain(); }
function drain() {
  while (!anim && !drag && queue.length) run(queue.shift());
  updateUI();
}
function run(item) {
  if (item.kind === 'undo') { if (!history.length) return; history.pop(); clearHint(); syncAll(); save(); announce('Undo, ' + movesWord(history.length) + '.'); return; }
  if (state.out) return;
  let move = null;
  if (item.kind === 'tip') { const d = item.dir !== undefined ? item.dir : cubeDir(item.world, orient); move = ['tip', d]; }
  else if (item.kind === 'turn') move = item.move;
  else if (item.kind === 'face') move = faceMove(item.key, item.reverse);
  if (!move || !E.validMove(state, move)) return;
  startMove(move, item.from || 0, item.lean);
}
function startMove(move, from, lean) {
  const before = state, q0 = orient.clone(), r = E.apply(state, move);
  state = r.state; history.push(move.slice());
  // Only campaign boards count as solved; a New Game+ board is played for itself.
  if (state.out && !inPool() && !completed.includes(boardId)) completed.push(boardId);
  if (state.out) { lookHintDue = null; endLookHint(); }
  clearHint(); save(); updateUI(); announceMove(move, r.trace); if (history.length === 3) lookHintDue = boardId;
  const phases = [lean && move[0] === 'tip' ? leanPhase(move[1], q0) : null, move[0] === 'tip' ? rollPhase(move[1], q0) : turnPhase(move, from, r)];
  phases.push(fallPhase(r.trace, state));
  if (state.out) phases.push(...finishPhases(state));
  void before; play(phases);
}
// F B L R U D name the slices facing the viewer's front, back, left, right, top and bottom; M E S the middle
// ones (M turns as L, C as D, S as F). A letter turns its slice clockwise as seen from that side; the sides follow
// view, to the nearest quarter. (E and Q turn the view, so the horizontal middle slice is C, for centre.)
const FACES = { f: V3(0, 0, 1), b: V3(0, 0, -1), r: V3(1, 0, 0), l: V3(-1, 0, 0), u: V3(0, 1, 0), d: V3(0, -1, 0) };
function faceMove(key, reverse) {
  const middle = { m: 'l', c: 'd', s: 'f' }[key], d = cubeDir(FACES[middle || key].clone().applyAxisAngle(UP, nearestQuarter() * QUARTER).round(), orient), a = d >> 1, sign = d & 1 ? -1 : 1;
  if (middle && n !== 3) return null;
  const l = middle ? 1 : sign > 0 ? n - 1 : 0;
  return [AXES[a], l, (reverse ? 1 : -1) * sign];
}
function undo() { enqueue({ kind: 'undo' }); }
function restart() { queue = []; fastForward(); drag = null; history = []; lookHintDue = null; endLookHint(); clearHint(); clearSel(); syncAll(); save(); arrival(); announce('Restarted.'); }
function go(id) {
  if (!ALL.some(b => b.id === id)) throw Error('Unknown board');
  // A New Game+ board opens only once the campaign is finished.
  if (!BOARDS.some(b => b.id === id) && !campaignDone()) return false;
  drawn = null;
  // A round ends once every pool board has been dealt; opening the board in hand again deals nothing new.
  if (POOL.some(b => b.id === id)) { const dealt = played.filter(x => x !== id).concat(id); played = dealt.length >= POOL.length ? [] : dealt; }
  queue = []; anim = null; drag = null; gesture = null; lookHintDue = null; endLookHint(); clearHint(); clearSel(); endLayer(); boardId = id; history = []; resetLook(true); buildBoard(); syncAll(); save(); arrival();
  // The status line belongs to the board on screen: a new board replaces the last one's result.
  announce(boardName() + '. Par ' + board.par + '.');
  return true;
}
// After a solve there is always somewhere to go: the next board, one still unsolved, or, with the campaign finished,
// a New Game+ board: one of the pool not dealt since the pool was last used up, never the board just played.
function nextOf() {
  const i = BOARDS.findIndex(b => b.id === boardId);
  return (i >= 0 && BOARDS[i + 1]) || BOARDS.find(b => b.id !== boardId && !completed.includes(b.id)) || (campaignDone() ? drawPool() : BOARDS[0]);
}
let drawn = null;
function drawPool() {
  if (drawn && drawn.id !== boardId) return drawn;
  let left = POOL.filter(b => b.id !== boardId && !played.includes(b.id));
  if (!left.length) left = POOL.filter(b => b.id !== boardId);
  drawn = left[Math.floor(Math.random() * left.length)];
  return drawn;
}
function campaignDone() { return BOARDS.every(b => completed.includes(b.id)); }
function inPool() { return !BOARDS.some(b => b.id === boardId); }
function boardName() { return inPool() ? 'New Game+ board' : 'Board ' + (BOARDS.findIndex(b => b.id === boardId) + 1) + ' of ' + BOARDS.length; }
function hasNext() { return BOARDS.length > 1; }
function nextBoard() { go(nextOf().id); }

// ---------- Screen geometry ----------
let viewH = 1, viewW = 1;
let base = { offX: 0, offY: 0, cx: 0, cy: 0 }, frame0 = { top: 56, ah: 1, aw: 1, right: 0, land: false, portrait: true };
function fit() {
  const W = innerWidth, H = innerHeight, land = W > H && H <= 520, portrait = H > W;
  // Held sideways, the space under the cube is kept for the next arrow, so the arrow never touches the cube or a foot.
  const top = land ? 36 : 56, bottom = land ? 66 : 124, right = land ? 64 : 0;
  frame0 = { top, right, land, portrait, aw: W - right - 16, ah: H - top - bottom };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 3)); renderer.setSize(W, H, false); viewW = W; viewH = H;
  aim(); kick();
}
// Places the camera for the current look: the fitted distance for this elevation, centred in the play area,
// then the zoom window.
function aim() {
  const W = viewW, H = viewH, { top, right, land, portrait, aw, ah } = frame0;
  // The glass is sized alone, the same on both boards: a phone held upright gives it about two thirds of its width,
  // with room above and below for swipes; the cube and its feet together are centred in the play area.
  const wantW = portrait ? Math.min(W * 0.665, aw) : aw * 0.58, wantH = portrait ? ah * 0.51 : land ? ah * 0.7 : ah * 0.6;
  const hs = (n || 2) / 2 - SEAT, T = V3(0, FOOT + hs, 0), yaw = YAW + look.yaw, pitch = look.pitch;
  const dir = V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const glassPts = [], r = FEET.width; for (let i = 0; i < 8; i++) glassPts.push(V3(i & 1 ? hs : -hs, FOOT + (i & 2 ? 2 * hs : 0), i & 4 ? hs : -hs));
  const pts = [...glassPts]; for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, FOOT]) for (let a = 0; a < 8; a++) pts.push(V3(sx * hs + r * Math.cos(a * Math.PI / 4), y, sz * hs + r * Math.sin(a * Math.PI / 4)));
  camera.aspect = W / H; camera.clearViewOffset();
  const measure = (D, set) => { camera.position.copy(T).addScaledVector(dir, D); camera.lookAt(T); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of set) { const q = p.clone().project(camera), x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; };
  let D = 6 * hs, m;
  for (let i = 0; i < 6; i++) { m = measure(D, glassPts); D *= Math.max(m.w / wantW, m.h / wantH); }
  m = measure(D, pts);
  base = { offX: m.cx - (W - right) / 2, offY: m.cy - (top + ah / 2), cx: (W - right) / 2, cy: top + ah / 2 };
  U.uDepth.value.set(D - hs * 1.4, hs * 2.8);
  applyZoom();
}
// The zoom window keeps the cube on screen: its centre stays well inside, and the window inside the fitted frame.
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
const frontAxis = () => V3(0, 0, 1).applyAxisAngle(UP, nearestQuarter() * QUARTER).round();
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
function settleYaw() { const k = nearestQuarter(); if (Math.abs(look.yaw - k * QUARTER) < 12 * Math.PI / 180) lookTo({ yaw: k * QUARTER }); }
function turnView(dq) { stopLook(); markLooked(); const k = dq > 0 ? Math.floor(look.yaw / QUARTER + 0.01) + 1 : Math.ceil(look.yaw / QUARTER - 0.01) - 1; lookTo({ yaw: k * QUARTER }, 320); }
function resetLook(instant) {
  stopLook(); look.yaw = Math.atan2(Math.sin(look.yaw), Math.cos(look.yaw));
  if (instant) { Object.assign(look, { yaw: 0, pitch: PITCH, zoom: 1, vx: 0, vy: 0 }); if (n) aim(); return; }
  lookTo({ yaw: 0, pitch: PITCH, zoom: 1, vx: 0, vy: 0 }, 320);
}
// The look hint: after the third move on a board, if the player has never turned the view, a small wordless glyph
// near the bottom shows how (two fingertips on a touch screen, a right mouse button at a desk) while the view sways
// a little and back. At most twice, the second time on another board, and never once the view has been turned.
let lastPointer = matchMedia('(hover: hover) and (pointer: fine)').matches ? 'mouse' : 'touch', lookHint = null, lookHintDue = null;
const glyphs = {
  touch: '<svg viewBox="0 0 72 56" aria-hidden="true"><path class="arc" d="M8.6 28.8A80 80 0 0 1 63.4 28.8"/><g class="dots"><g class="up"><circle cx="29" cy="40" r="5.5"/><circle cx="43" cy="40" r="5.5"/></g></g></svg>',
  mouse: '<svg viewBox="0 0 72 56" aria-hidden="true"><path class="arc" d="M10.1 13.6A94 94 0 0 1 61.9 13.6"/><g class="mouse"><g class="up"><rect x="27" y="24" width="18" height="28" rx="9"/><path d="M36 24v11M27 35h18"/><path class="lit" d="M36 24a9 9 0 0 1 9 9v2h-9z"/></g></g></svg>'
};
function markLooked() { if (prefs.looked) return; prefs.looked = true; save(); endLookHint(); }
function endLookHint() { if (!lookHint) return; clearTimeout(lookHint.timer); lookHint.el.remove(); lookHint = null; }
function maybeLookHint() {
  // Never under a finger that is still down: it waits for the release.
  if (gesture || lookG) { setTimeout(() => { if (lookHintDue && !busy()) maybeLookHint(); }, 300); return; }
  const due = lookHintDue; lookHintDue = null;
  if (due !== boardId || corrupt || prefs.looked || prefs.hintCount >= 2 || prefs.hintBoard === boardId || history.length < 3 || state.out || lookHint || sheetOpen()) return;
  prefs.hintCount++; prefs.hintBoard = boardId; save();
  const kind = lastPointer, still = reduced(), el = document.createElement('div');
  el.id = 'look-hint'; el.className = 'look-hint ' + kind + (still ? ' still' : ''); el.setAttribute('aria-hidden', 'true'); el.innerHTML = glyphs[kind];
  // Bottom centre of the play area, above the toolbar and the Next disc's space; if the cube or that space reaches it
  // there (a short landscape screen, or zoomed in), it moves to whichever side of the cube has more room.
  const right = viewW - frame0.right; el.style.left = (right / 2 - 36) + 'px'; $('#play').append(el);
  const r = el.getBoundingClientRect(), b = bounds(), s = nextSlot(), near = (q, pad) => r.left < q.x + q.width + pad && r.right > q.x - pad && r.top < q.y + q.height + pad && r.bottom > q.y - pad;
  if (near(b, 8) || near(s, 4))
    el.style.left = (b.x > right - (b.x + b.width) ? Math.max(8, b.x / 2 - r.width / 2) : Math.min(right - r.width - 8, (b.x + b.width + right) / 2 - r.width / 2)) + 'px';
  lookHint = { el, kind, timer: setTimeout(endLookHint, 3200) };
  if (!still) { stopLook(); look.anim = { sway: true, from: { yaw: look.yaw }, to: { yaw: look.yaw + 15 * Math.PI / 180 }, t0: performance.now(), dur: 2600 }; kick(); }
}
// Where the shared frame puts the Next disc, shown or not: its laid-out box, before its grow-in scale.
function nextSlot() { const n = $('#next-btn'), was = n.hidden; n.hidden = false; const q = { x: n.offsetLeft, y: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight }; n.hidden = was; return q; }
function toScreen(world) { const p = world.clone().project(camera); return { x: (p.x + 1) / 2 * viewW, y: (1 - p.y) / 2 * viewH }; }
const localToScreen = v => toScreen(cubeRoot.localToWorld(v.clone()));
// The cube and its feet on screen; with `glassOnly`, the glass alone.
function bounds(glassOnly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const hs = n / 2 - SEAT, pts = [];
  for (let i = 0; i < 8; i++) pts.push(localToScreen(V3(i & 1 ? hs : -hs, i & 2 ? hs : -hs, i & 4 ? hs : -hs)));
  if (!glassOnly) for (const t of feetPoints()) pts.push(toScreen(t));
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
const cubeScreenCentre = () => localToScreen(V3());
// The world's level axes as seen on screen; a swipe or a tap picks the nearest.
const LEVEL = [V3(1, 0, 0), V3(-1, 0, 0), V3(0, 0, 1), V3(0, 0, -1)];
function screenAxis(w) { const o = V3(0, FOOT + n / 2 - SEAT, 0), c = toScreen(o), p = toScreen(w.clone().multiplyScalar(n / 2).add(o)), x = p.x - c.x, y = p.y - c.y, l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }
const nearestLevelWorld = v => LEVEL.reduce((b, w) => w.dot(v) > b.dot(v) ? w : b, LEVEL[0]);
function nearestLevel(dx, dy) { const l = Math.hypot(dx, dy) || 1; let best = LEVEL[0], score = -Infinity; for (const w of LEVEL) { const s = screenAxis(w), k = (s.x * dx + s.y * dy) / l; if (k > score) { score = k; best = w; } } return best.clone(); }
const raycaster = new THREE.Raycaster();
function hitCube(x, y) {
  raycaster.setFromCamera(new THREE.Vector2(x / viewW * 2 - 1, -(y / viewH * 2 - 1)), camera);
  const ray = raycaster.ray.clone().applyMatrix4(cubeRoot.matrixWorld.clone().invert()), h = n / 2;
  const p = ray.intersectBox(new THREE.Box3(V3(-h, -h, -h), V3(h, h, h)), V3()); if (!p) return null;
  const k = [p.x, p.y, p.z], axis = [0, 1, 2].reduce((m, i) => Math.abs(k[i]) > Math.abs(k[m]) ? i : m, 0);
  return { local: p, axis, idx: k.map(v => Math.max(0, Math.min(n - 1, Math.floor(v + h)))) };
}
// How the touched point moves on screen, per radian, when the slice about axis a turns positively: along the
// face, a × normal, at the face's distance from the centre. The drag is read against the face's two in-plane axes.
function tangent(hit, a) {
  const k = hit.local.getComponent(hit.axis), nrm = VEC[hit.axis * 2 + (k > 0 ? 0 : 1)], dir = V3().crossVectors(VEC[a * 2], nrm).multiplyScalar(Math.abs(k));
  const e = 0.02, p0 = localToScreen(hit.local), p1 = localToScreen(hit.local.clone().addScaledVector(dir, e)); return { x: (p1.x - p0.x) / e, y: (p1.y - p0.y) / e };
}
function choose(hit, dx, dy) {
  const l = Math.hypot(dx, dy) || 1; let best = null;
  for (let a = 0; a < 3; a++) {
    if (a === hit.axis) continue;
    const t = tangent(hit, a), tl = Math.hypot(t.x, t.y); if (tl < 1e-6) continue;
    const dot = (t.x * dx + t.y * dy) / (tl * l); if (!best || Math.abs(dot) > best.score) best = { score: Math.abs(dot), a, t, tl };
  }
  return best && { a: best.a, l: hit.idx[best.a], t: best.t, tl: best.tl };
}

// ---------- Preview: what a gesture will move, before it moves it ----------
// Touching (or hovering) a cubie face shows a faint cross on that face: the row and the column you could turn. The
// first movement picks the one nearer the drag; it lights, the rest of the cube dims a little, an arrow shows the way,
// and the slice follows the finger. Back near the start, the choice is undone. Arrow and outline reach full
// brightness when a release would complete the turn.
const SEL_LOCK = 10, TURN_COMMIT = Math.PI / 6, FLICK = 0.5, TIP_COMMIT = 36, LEAN_SPAN = 110;
const selFill = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.12, 0.12), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
// The two slices a cross offers glow as one flat layer each, the near side of the slice's box, rather than through
// every stacked glass face, so the glow stays the same faint step at any zoom and angle.
const slabFill = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.017, 0.017, 0.017), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide });
const selLine = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.6, 0.6), transparent: true, depthWrite: false });
const selArrow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.6, 0.6), transparent: true, depthWrite: false });
const markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.6, 0.6), transparent: true, depthWrite: false, side: THREE.DoubleSide });
const sel = { mode: null, from: null, key: '', hit: null, a: -1, l: -1, dir: 0, ramp: 0, group: null, arrow: null };
const dropTree = o => { if (!o) return; o.parent?.remove(o); o.traverse(m => m.geometry?.dispose()); };
// Twelve thin bars along the edges of a box, for an outline that reads at any zoom.
function outline(dims, t) {
  const g = new THREE.Group(), h = dims.map(v => v / 2);
  for (let a = 0; a < 3; a++) { const b = (a + 1) % 3, c = (a + 2) % 3; for (const sb of [1, -1]) for (const sc of [1, -1]) { const d = [t, t, t]; d[a] = dims[a] + t; const m = new THREE.Mesh(new THREE.BoxGeometry(...d), selLine), pos = [0, 0, 0]; pos[b] = sb * h[b]; pos[c] = sc * h[c]; m.position.set(...pos); m.renderOrder = 11; g.add(m); } }
  return g;
}
// A band on the touched face across the slice turning about axis a: one cubie wide, the whole face long. Its tint is a
// single flat layer, drawn before the seals so they stay dark; where the two bands cross, only one of them tints, so the
// cross adds the same faint lightness everywhere at any zoom and never piles up toward white.
function band(f, sgn, a, l, skip) {
  const hs = n / 2 - SEAT, dims = [0, 0, 0], pos = [0, 0, 0], b = 3 - f - a;
  dims[f] = 0.004; dims[a] = 2 * HB; dims[b] = 2 * hs; pos[f] = sgn * (hs + 0.006); pos[a] = l - (n - 1) / 2;
  const g = new THREE.Group(), spans = skip === undefined ? [[-hs, hs]] : [[-hs, skip - HB], [skip + HB, hs]];
  for (const [lo, hi] of spans) {
    if (hi - lo < 1e-3) continue;
    const d = dims.slice(); d[b] = hi - lo; const geo = new THREE.BoxGeometry(...d); geo.setDrawRange(f * 12, 6); // the one face facing out
    const fill = new THREE.Mesh(geo, selFill); fill.position.setComponent(b, (lo + hi) / 2); fill.renderOrder = 9; g.add(fill);
  }
  // The outline stays a thin line, about 1.3 CSS px, at any zoom.
  const edge = outline(dims.map((v, i) => i === f ? 0.001 : v), Math.min(0.012, Math.max(0.004, 1.3 * pxWorld))); g.add(edge); g.position.set(...pos); return g;
}
// A flat arrow along level direction w, from r0 to r1 out from the cube's centre at height y.
function flatArrow(w, r0, r1, y, mat) {
  const g = new THREE.Group(), len = r1 - r0, headL = Math.min(0.3, len * 0.35);
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.06, len - headL), mat), head = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0, headL)])), mat);
  for (const [m, r] of [[shaft, r0 + (len - headL) / 2], [head, r1 - headL]]) { const o = new THREE.Group(); o.add(m); m.rotation.x = -Math.PI / 2; o.position.copy(w).multiplyScalar(r).setY(y); o.quaternion.setFromUnitVectors(V3(0, 0, -1), w); g.add(o); }
  g.traverse(o => { o.renderOrder = 13; }); return g;
}
// Where an arrow showing a roll toward w can always be seen: on the floor beside the cube, reaching past the feet, or,
// when that floor lies behind the cube from here, on the cube's top face, riding with it as it leans.
function rollArrow(w, mat) {
  placeCube(); const c = cubeRoot.position, f = c.clone().sub(camera.position).setY(0).normalize(), hs = n / 2 - SEAT;
  if (w.dot(f) < 0.25) { const g = flatArrow(w, FEET.reach + 0.16, hs + 0.9 + 0.2 * n, 0.004, mat); g.position.set(c.x, 0, c.z); scene.add(g); return g; }
  const g = flatArrow(w, -0.75 * hs, 0.95 * hs, 0, mat); g.position.set(c.x, c.y + hs + 0.012, c.z); g.userData.top = true; scene.add(g); cubeRoot.attach(g); return g;
}
function arcArrow(a, l, dir) {
  // An end slice's arrow circles just beyond its outer face, so it never lies over the still slice beside it.
  const end = l === 0 ? -1 : l === n - 1 ? 1 : 0, axis = VEC[a * 2], c = axis.clone().multiplyScalar(l - (n - 1) / 2 + end * 0.56), u = VEC[((a + 1) % 3) * 2], v = V3().crossVectors(axis, u), cam = cubeRoot.worldToLocal(camera.position.clone()).sub(c);
  const phi0 = Math.atan2(cam.dot(v), cam.dot(u)), rho = n / 2 * Math.SQRT2 + 0.24, span = 1.1, pts = [], g = new THREE.Group();
  for (let i = 0; i <= 24; i++) { const f = phi0 + dir * (i / 24 - 0.5) * span; pts.push(c.clone().addScaledVector(u, rho * Math.cos(f)).addScaledVector(v, rho * Math.sin(f))); }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.022, 8), selArrow));
  const fEnd = phi0 + dir * span / 2, tip = c.clone().addScaledVector(u, rho * Math.cos(fEnd)).addScaledVector(v, rho * Math.sin(fEnd)), tan = u.clone().multiplyScalar(-Math.sin(fEnd)).addScaledVector(v, Math.cos(fEnd)).multiplyScalar(dir);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 16), selArrow); cone.quaternion.setFromUnitVectors(UP, tan); cone.position.copy(tip).addScaledVector(tan, 0.06); g.add(cone);
  g.traverse(o => { o.renderOrder = 11; }); return g;
}
function clearSel() { dropTree(sel.group); dropTree(sel.arrow); dropTree(sel.mark); sel.group = sel.arrow = sel.mark = null; U.uFaceSel.value = 1; sel.mode = sel.from = null; sel.key = ''; sel.dir = 0; U.uSel.value.set(0, 0, 0, 0); U.uSel2.value.set(0, 0, 0, 0); U.uWhole.value = 0; kick(); }
function showCross(hit, from) {
  // Rebuilt when the zoom changes, so its outline stays thin.
  const f = hit.axis, sgn = Math.sign(hit.local.getComponent(f)) || 1, key = hit.idx.join() + '/' + f + sgn + '/' + Math.round(look.zoom * 8);
  if (sel.mode === 'cross' && sel.key === key) return;
  clearSel(); sel.mode = 'cross'; sel.from = from; sel.key = key; sel.hit = hit;
  const [a1, a2] = [0, 1, 2].filter(a => a !== f), g = new THREE.Group(); g.add(band(f, sgn, a1, hit.idx[a1]), band(f, sgn, a2, hit.idx[a2], hit.idx[a1] - (n - 1) / 2));
  const hs = n / 2 - SEAT; for (const a of [a1, a2]) { const d = [2 * hs, 2 * hs, 2 * hs]; d[a] = 2 * HB; const m = new THREE.Mesh(new THREE.BoxGeometry(...d), slabFill); m.position.setComponent(a, hit.idx[a] - (n - 1) / 2); m.renderOrder = 9; g.add(m); }
  cubeRoot.add(g); sel.group = g; setRamp(0); U.uFaceSel.value = 0;
  // Both slices it could turn glow faintly.
  U.uSel.value.set(a1, hit.idx[a1] - (n - 1) / 2, 0.35, 0); U.uSel2.value.set(a2, hit.idx[a2] - (n - 1) / 2, 0.35, 0); kick();
}
function showSlice(a, l, hit, dir, from) {
  // The chosen slice glows from inside and the rest dims a little; its arrow shows the way.
  clearSel(); sel.mode = 'slice'; sel.from = from; sel.a = a; sel.l = l; sel.hit = hit;
  U.uSel.value.set(a, l - (n - 1) / 2, 0.7, 1); setSliceDir(dir); kick();
}
function setSliceDir(dir) { if (!dir || (dir === sel.dir && sel.arrow)) return; dropTree(sel.arrow); sel.arrow = arcArrow(sel.a, sel.l, dir); cubeRoot.add(sel.arrow); sel.dir = dir; kick(); }
// At the point where a release would complete, the glow brightens a step and the arrow turns white.
function setRamp(r) { sel.ramp = r; const k = r >= 1 ? 1 : 0.5 + 0.32 * r; selLine.color.setScalar(k); selArrow.color.setScalar(k); markMat.color.setScalar(r >= 1 ? 0.95 : 0.55); selFill.color.setScalar(0.035 + 0.03 * r);
  if (sel.mode === 'slice') U.uSel.value.z = r >= 1 ? 1 : 0.7; if (sel.mode === 'whole') U.uWhole.value = r >= 1 ? 0.65 : 0.42; }
function showWhole(from) { clearSel(); sel.mode = 'whole'; sel.from = from; U.uWhole.value = 0.42; kick(); }
const flickSpeed = (g, ux, uy) => { const now = g.samples[g.samples.length - 1], old = g.samples.find(s => now.t - s.t <= 90) || now, dt = now.t - old.t; return dt > 0 ? ((now.x - old.x) * ux + (now.y - old.y) * uy) / dt : 0; };

const control = t => !!(t && t.closest && t.closest('button,a,select,input,textarea,label,summary,dialog'));
const sheetOpen = () => !!document.querySelector('dialog[open]');
const html = document.documentElement;
// One finger on the cube turns a slice; one finger anywhere off it rolls the whole cube. Looking around takes two
// fingers on a touch screen (moving together turns the view, spreading zooms), or a right-drag or Shift-drag at a desk.
const touches = new Map(), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
let lookG = null;
function abandonGesture() {
  const g = gesture; if (!g) return; gesture = null; clearSel(); leanGoal.set(0, 0, 0);
  if (drag) { const from = turnAngle; drag = null; play([settlePhase(g.choice.a, g.choice.l, from)]); }
}
function moveLook() {
  const g = lookG;
  if (g.kind === 'mouse') { look.yaw = g.yaw - (g.x - g.x0) * 0.008; look.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, g.pitch + (g.y - g.y0) * 0.006)); aim(); kick(); return; }
  // Both fingers' latest positions give the pair's centre and spacing. The zoom follows the spacing as a ratio of where
  // the gesture began, past a small dead band, so a pair moved together (whose spacing wobbles as each finger's move
  // arrives in turn) never changes the zoom, and the limits at 1 and 2.5 cannot ratchet it.
  const [a, b] = g.ids.map(id => touches.get(id)), c = mid(a, b), d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  look.yaw = g.yaw - (c.x - g.c0.x) * 0.008; look.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, g.pitch + (c.y - g.c0.y) * 0.006)); aim();
  const e = Math.log(d / g.d), k = Math.sign(e) * Math.max(0, Math.abs(e) - 0.08), want = Math.max(1, Math.min(ZOOM_MAX, g.zoom * Math.exp(k)));
  if (Math.abs(want - look.zoom) > 1e-4) zoomAt(c.x, c.y, want / look.zoom); kick();
}
function endLook() {
  const g = lookG; if (!g) return; lookG = null; for (const id of g.ids) try { html.releasePointerCapture(id); } catch (_) {}
  if (Math.abs(look.yaw - g.yaw) > 3 * Math.PI / 180 || Math.abs(look.pitch - g.pitch) > 3 * Math.PI / 180) markLooked();
  settleYaw();
}
addEventListener('pointerdown', e => {
  if (control(e.target) || sheetOpen()) return;
  lastPointer = e.pointerType === 'mouse' ? 'mouse' : 'touch';
  if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerType === 'touch' && touches.size === 2) {
    // A second finger makes it a look: whatever the first was doing is let go.
    e.preventDefault(); abandonGesture(); endLook(); stopLook();
    const ids = [...touches.keys()], [a, b] = ids.map(id => touches.get(id));
    lookG = { kind: 'touch', ids, c0: mid(a, b), d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: look.zoom, yaw: look.yaw, pitch: look.pitch };
    try { html.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  if (lookG || touches.size > 2 || !e.isPrimary || gesture) return;
  if (e.pointerType !== 'touch' && (e.button === 2 || (e.button === 0 && e.shiftKey))) {
    e.preventDefault(); stopLook(); if (sel.from === 'hover') clearSel();
    lookG = { kind: 'mouse', ids: [e.pointerId], x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
    try { html.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  if (e.button !== 0) return;
  stopLook(); e.preventDefault(); placeCube();
  const hit = hitCube(e.clientX, e.clientY);
  gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, hit, choice: null, queued: busy(), max: 0, samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
  if (!gesture.queued && !state.out) {
    if (sel.from === 'hint') clearHint();
    if (hit) showCross(hit, 'gesture'); else showWhole('gesture');
  }
  try { html.setPointerCapture(e.pointerId); } catch (_) {}
}, true);
// At a desk, hovering a face shows the cross without a click; leaving the cube clears it.
function hover(e) {
  if (sel.from === 'hint' || hint) return;
  const h = !control(e.target) && !sheetOpen() && !busy() && !state.out ? hitCube(e.clientX, e.clientY) : null;
  if (h) showCross(h, 'hover'); else if (sel.from === 'hover') clearSel();
}
addEventListener('pointerout', e => { if (!e.relatedTarget && sel.from === 'hover') clearSel(); });
addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (lookG && lookG.ids.includes(e.pointerId)) { if (lookG.kind === 'mouse') { if (e.buttons === 0) { endLook(); return; } lookG.x = e.clientX; lookG.y = e.clientY; } moveLook(); return; }
  const g = gesture;
  if (!g) { if (e.pointerType === 'mouse' && e.buttons === 0 && !lookG) hover(e); return; }
  if (g.id !== e.pointerId) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) { release(false); return; }
  g.x = e.clientX; g.y = e.clientY; g.samples.push({ t: e.timeStamp, x: g.x, y: g.y }); if (g.samples.length > 12) g.samples.shift();
  if (state.out) return;
  const dx = g.x - g.x0, dy = g.y - g.y0, d = Math.hypot(dx, dy); g.max = Math.max(g.max, d);
  if (!g.hit) {
    // Off the cube: it leans toward the side the swipe would roll it, more as the finger goes further.
    if (g.queued || g.max <= 8) return;
    const w = nearestLevel(dx, dy), s = screenAxis(w), along = dx * s.x + dy * s.y;
    g.leanW = w; if (!reduced()) leanGoal.copy(w).multiplyScalar(LEAN_MAX * clamp01(along / LEAN_SPAN));
    // A still arrow shows which way the whole cube will roll, the straight arrow the hint uses, so a roll never looks
    // like a slice's curved arrow before it is let go. Under reduced motion it is the only sign, with no lean. Back
    // near the start, where a release rolls nothing, the arrow goes.
    if (d <= 8) { dropTree(sel.mark); sel.mark = null; sel.markW = null; }
    else if (!sel.mark || !sel.markW.equals(w)) { dropTree(sel.mark); sel.mark = rollArrow(w, markMat); sel.markW = w.clone(); }
    setRamp(along >= TIP_COMMIT ? 1 : 0); kick(); return;
  }
  if (g.choice && d < SEL_LOCK) {
    // Back at the start: the choice is undone and the cross returns, so the other slice can be taken.
    g.choice = null; if (drag) { drag = null; endLayer(); computeLight(false, false); } if (!g.queued) showCross(g.hit, 'gesture'); kick(); return;
  }
  if (!g.choice && d >= SEL_LOCK) {
    g.choice = choose(g.hit, dx, dy);
    if (g.choice && !g.queued) { if (hint) clearHint(); drag = { a: g.choice.a, l: g.choice.l }; beginLayer(g.choice.a, g.choice.l); showSlice(g.choice.a, g.choice.l, g.hit, 1, 'gesture'); }
  }
  if (g.choice && drag) {
    const amount = (dx * g.choice.t.x + dy * g.choice.t.y) / g.choice.tl, angle = amount / g.choice.tl;
    turnAngle = reduced() ? 0 : Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle));
    setSliceDir(amount >= 0 ? 1 : -1); setRamp(clamp01(Math.abs(angle) / TURN_COMMIT)); computeLight(false, false); kick();
  }
}, true);
function release(cancel) {
  const g = gesture; if (!g) return; gesture = null;
  try { html.releasePointerCapture(g.id); } catch (_) {}
  const dx = g.x - g.x0, dy = g.y - g.y0, dist = Math.hypot(dx, dy);
  g.samples.push({ t: performance.now(), x: g.x, y: g.y });
  if (sel.from === 'gesture') clearSel();
  if (g.hit) {
    if (g.choice) {
      // A turn completes past a third of a quarter, or on a quick flick the way it was going; short of that it settles back.
      const amount = (dx * g.choice.t.x + dy * g.choice.t.y) / g.choice.tl, speed = flickSpeed(g, g.choice.t.x / g.choice.tl, g.choice.t.y / g.choice.tl);
      const commit = !cancel && !state.out && (Math.abs(amount / g.choice.tl) >= TURN_COMMIT || (Math.abs(amount) >= 24 && Math.abs(speed) >= FLICK && Math.sign(speed) === Math.sign(amount))), move = [AXES[g.choice.a], g.choice.l, amount >= 0 ? 1 : -1];
      if (drag) { const from = turnAngle; drag = null; if (commit) { queue.unshift({ kind: 'turn', move, from }); drain(); } else play([settlePhase(g.choice.a, g.choice.l, from)]); }
      else if (commit) enqueue({ kind: 'turn', move });
    } else if (!cancel && dist <= 6 && !busy() && !state.out) { const c = choose(g.hit, 1, 0); if (c) play([rockPhase(c.a, c.l)]); }
    return;
  }
  if (cancel || state.out) { leanGoal.set(0, 0, 0); return; }
  // A tap beside the cube tips it toward that side after a brief lean. A swipe rolls the way the cube leaned once
  // it has gone far enough, or on a quick flick; brought back toward its start it cancels.
  if (g.max <= 8) { const c = cubeScreenCentre(); enqueue({ kind: 'tip', world: nearestLevel(g.x0 - c.x, g.y0 - c.y), lean: true }); return; }
  const far = Math.hypot(dx, dy), w = nearestLevel(dx, dy), s = screenAxis(w), along = dx * s.x + dy * s.y, speed = flickSpeed(g, s.x, s.y);
  if (along >= TIP_COMMIT || (far >= 14 && speed >= FLICK)) enqueue({ kind: 'tip', world: w });
  else leanGoal.set(0, 0, 0);
}
addEventListener('pointerup', e => { touches.delete(e.pointerId); if (lookG && lookG.ids.includes(e.pointerId)) { endLook(); return; } const g = gesture; if (!g || g.id !== e.pointerId) return; g.x = e.clientX; g.y = e.clientY; release(false); }, true);
addEventListener('pointercancel', e => { touches.delete(e.pointerId); if (lookG && lookG.ids.includes(e.pointerId)) { endLook(); return; } if (gesture && gesture.id === e.pointerId) release(true); }, true);
// Capture can be lost a moment before pointerup; with no button held that is the release, wherever it is.
addEventListener('lostpointercapture', e => { if (lookG && lookG.kind === 'mouse' && lookG.ids.includes(e.pointerId) && !e.buttons) { endLook(); return; } if (gesture && gesture.id === e.pointerId) release(!!e.buttons); }, true);
for (const name of ['selectstart', 'dragstart']) canvas.addEventListener(name, e => e.preventDefault());
addEventListener('contextmenu', e => { if (!control(e.target)) e.preventDefault(); });

// The wheel and a trackpad's vertical scroll zoom toward the pointer, as does a trackpad pinch (Ctrl and the wheel);
// a trackpad's sideways scroll turns the view, settling onto a quarter only near one.
let wheelTimer = 0;
addEventListener('wheel', e => {
  if (sheetOpen()) return;
  e.preventDefault(); stopLook();
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1, dx = e.deltaX * k, dy = e.deltaY * k;
  if (e.ctrlKey) { zoomAt(e.clientX, e.clientY, Math.max(0.8, Math.min(1.25, Math.exp(-dy * 0.01)))); return; }
  if (Math.abs(dx) > Math.abs(dy)) { look.yaw -= dx * 0.004; aim(); kick(); markLooked(); clearTimeout(wheelTimer); wheelTimer = setTimeout(settleYaw, 220); return; }
  zoomAt(e.clientX, e.clientY, Math.max(0.8, Math.min(1.25, Math.exp(-dy * 0.0025))));
}, { passive: false, capture: true });

addEventListener('keydown', e => {
  if (sheetOpen() || (e.target.matches && e.target.matches('select,input,textarea'))) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[k]) { e.preventDefault(); stopLook(); if (!e.repeat) enqueue({ kind: 'tip', world: nearestLevel(...arrows[k]) }); return; }
  if ('fblrudmcs'.includes(k) && k.length === 1) { e.preventDefault(); if (!e.repeat) enqueue({ kind: 'face', key: k, reverse: e.shiftKey }); return; }
  if (k === 'q' || k === 'e') { e.preventDefault(); turnView(k === 'q' ? -1 : 1); return; }
  if (k === '+' || k === '=' || k === '-' || k === '_') { e.preventDefault(); stopLook(); const c = cubeScreenCentre(); zoomAt(c.x, c.y, k === '-' || k === '_' ? 1 / 1.25 : 1.25); return; }
  if (k === '0') { e.preventDefault(); resetLook(false); return; }
  if (k === 'z' || k === 'Backspace') { e.preventDefault(); undo(); return; }
  if (k === 'h') { e.preventDefault(); pressHint(); }
});

// ---------- Hint: a background search, shown first and applied on the second press ----------
let hint = null, hintWorker = null, hintToken = 0, hintObj = null;
function clearHint() {
  hintToken++; if (hintWorker) { hintWorker.terminate(); hintWorker = null; }
  hint = null; leanGoal.set(0, 0, 0); if (sel.from === 'hint') clearSel(); if (hintObj) { hintObj.parent?.remove(hintObj); hintObj.traverse(o => { o.geometry?.dispose(); if (o.material && o.material !== whiteMat) o.material.dispose(); }); hintObj = null; }
  updateHintButton(); kick();
}
function pressHint() {
  if (state.out || busy()) return;
  if (hint) { const h = hint; clearHint(); if (h === 'undo') undo(); else if (h[0] === 'tip') enqueue({ kind: 'tip', dir: h[1] }); else enqueue({ kind: 'turn', move: h }); return; }
  if (hintWorker) return;
  const token = ++hintToken, w = new Worker('./engine.js'); hintWorker = w; updateHintButton();
  // The search is bounded so a phone stays responsive; past that, the stored solution or Undo is the way on.
  const onPath = history.length < board.solution.length && history.every((m, i) => m.join() === board.solution[i].join());
  const done = path => { w.terminate(); if (hintWorker === w) hintWorker = null; if (token !== hintToken) return; showHint(path && path.length ? path[0] : onPath ? board.solution[history.length] : 'undo'); };
  w.onmessage = e => done(e.data.path); w.onerror = () => done(null);
  w.postMessage({ id: token, state: { n, masks: state.masks, spout: state.spout, marble: state.marble, g: state.g }, maxDepth: n === 2 ? 7 : 5 });
}
function showHint(move) {
  hint = move; updateHintButton();
  if (move === 'undo') { announce('Undo is the way back.'); return; }
  if (move[0] === 'tip') {
    // An arrow beside the cube, or on top of it when the floor beyond lies behind it, and the cube leans that way.
    const w = worldDir(move[1], orient); hintObj = rollArrow(w, whiteMat); leanGoal.copy(w).multiplyScalar(0.12);
  } else {
    // The same preview a drag shows: the slice lit, the rest dimmed, and its arrow.
    showSlice(AXES.indexOf(move[0]), move[1], null, move[2], 'hint'); setRamp(1);
    hintObj = new THREE.Group(); cubeRoot.add(hintObj);
  }
  announce('Hint shown; press Hint again to play it.'); kick();
}
function updateHintButton() { $('#hint-btn').setAttribute('aria-pressed', String(!!hint || !!hintWorker)); $('#hint-btn').disabled = !!state && state.out; $('#undo-btn').classList.toggle('hinted', hint === 'undo'); }

// ---------- Chrome ----------
const icons = { restart: 'M5 8V3m0 5h5M5 8a8 8 0 1 1-1 9', undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12', hint: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9z', settings: 'M4 6h16M4 12h16M4 18h16M9 3v6m7 0v6m-8 0v6', help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 4v.1', next: 'M5 12h14m-6-6 6 6-6 6' };
for (const [id, path] of Object.entries(icons)) { const b = $('#' + id + '-btn'); if (b) b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; }
const sizeWords = { 2: '2 by 2 by 2', 3: '3 by 3 by 3' };
function updateUI() {
  if (!state) return;
  const i = BOARDS.findIndex(b => b.id === boardId);
  // A New Game+ board shows the infinity sign where a campaign board shows its number, as Tilt and Cast do.
  $('#readout').textContent = (i < 0 ? '∞' : (i + 1) + ' / ' + BOARDS.length) + ' · ' + history.length + ' / ' + board.par;
  $('#undo-btn').disabled = !history.length && !busy();
  $('#next-btn').hidden = !showNext;
  // With the campaign finished, the arrow from a campaign board starts New Game+.
  if (showNext) $('#next-btn').setAttribute('aria-label', i >= 0 && POOL.includes(nextOf()) ? 'Start New Game+' : 'Next board');
  canvas.setAttribute('aria-label', 'Glass cube ' + sizeWords[n] + ', ' + boardName().toLowerCase() + ', ' + movesWord(history.length) + ', par ' + board.par + (state.out ? ', solved' : ''));
  const sel = $('#board-select'); sel.value = i < 0 ? '' : boardId;
  for (const o of sel.options) o.textContent = (BOARDS.findIndex(b => b.id === o.value) + 1) + ' / ' + BOARDS.length + (completed.includes(o.value) ? ' · solved' : '');
  $('#new-game').disabled = !campaignDone();
  $('#new-game-note').textContent = campaignDone() ? '' : 'Complete all ' + BOARDS.length + ' to unlock New Game+.';
  $('#new-game-note').hidden = campaignDone();
  updateHintButton();
}
function announce(text) { $('#announcement').textContent = text; }
const movesWord = k => k + (k === 1 ? ' move' : ' moves');
// Sides as seen from the current view (to its nearest quarter): front, back, left, right, top and bottom.
function viewSide(w) {
  if (w.y > 0.5) return 'top'; if (w.y < -0.5) return 'bottom';
  const v = w.clone().applyAxisAngle(UP, -nearestQuarter() * QUARTER).round();
  return v.z > 0 ? 'front' : v.z < 0 ? 'back' : v.x > 0 ? 'right' : 'left';
}
const sideWord = w => ({ front: 'toward you', back: 'away', left: 'left', right: 'right', top: 'up', bottom: 'down' })[viewSide(w)];
// The world's own level sides, as the test hook names them (they match view().axes).
const worldWord = w => w.x > 0 ? 'right' : w.x < 0 ? 'left' : w.z > 0 ? 'toward' : 'away';
function turnWords(move) {
  // The layer is named by the side it faces, or as the middle one; the way it turns is clockwise or not, seen from that side.
  const a = AXES.indexOf(move[0]), v = worldDir(a * 2, orient), mid = move[1] !== 0 && move[1] !== n - 1;
  let face = move[1] === 0 ? v.clone().negate() : v.clone();
  if (mid) { const sides = [v, v.clone().negate()], pick = sides.find(w => viewSide(w) === 'top') || sides.find(w => viewSide(w) === 'front') || sides.find(w => viewSide(w) === 'right'); face = pick; }
  const clockwise = v.clone().multiplyScalar(move[2]).dot(face) < 0;
  return (mid ? 'the middle layer' : 'the ' + viewSide(face) + ' layer') + ' ' + (clockwise ? 'clockwise' : 'counterclockwise') + (mid ? ', seen from the ' + viewSide(face) : '');
}
function announceMove(move, tr) {
  const what = move[0] === 'tip' ? 'roll ' + sideWord(worldDir(move[1], orient)) : 'turn ' + turnWords(move);
  announce('Move ' + history.length + ': ' + what + '. ' + (tr.out ? 'The marble leaves.' : tr.path.length > 1 ? 'The marble falls ' + (tr.path.length - 1) + '.' : 'The marble stays.'));
}
function announceSolved() { announce('Solved in ' + movesWord(history.length) + '; par ' + board.par + '.' + (!inPool() && campaignDone() ? ' Every board is solved.' : '')); }

for (const b of BOARDS) { const o = document.createElement('option'); o.value = b.id; $('#board-select').append(o); }
$('#board-select').onchange = e => { go(e.target.value); $('#settings').close(); };
$('#new-game').onclick = () => { if (campaignDone()) { go(drawPool().id); $('#settings').close(); } };
$('#motion').onchange = e => { prefs.motion = e.target.value; applyPrefs(); save(); };
$('#restart-btn').onclick = restart; $('#restart-row').onclick = () => { restart(); $('#settings').close(); };
$('#undo-btn').onclick = undo; $('#hint-btn').onclick = pressHint; $('#next-btn').onclick = nextBoard;
for (const id of ['settings', 'help']) { $('#' + id + '-btn').onclick = () => $('#' + id).showModal(); $('#' + id).addEventListener('close', () => $('#' + id + '-btn').focus({ preventScroll: true })); }
function applyPrefs() { html.dataset.motion = prefs.motion; $('#motion').value = prefs.motion; if (reduced()) { fastForward(); computeLight(false, true); } kick(); }
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyPrefs);
addEventListener('resize', () => { fit(); });

// ---------- Start ----------
readSave();
buildBoard();
try { syncAll(); } catch (_) { history = []; syncAll(); }
applyPrefs(); save(); arrival();
// Compile every shader now so no later tip, turn, hint or finish waits on one.
{
  const P = parts(), warm = new THREE.Group(), fm = faceMat(), f = new THREE.Mesh(boxGeom, fm), c = new THREE.Mesh(P.cap, capMat), s = new THREE.Mesh(P.sleeve, sleeveMat()), o = new THREE.LineSegments(edgeGeom, lineMat(0.85, 0));
  warm.add(f, c, s, o, new THREE.Mesh(P.rings[0], ringMat), new THREE.Mesh(P.rings[0], whiteMat)); warm.position.set(0, -50, 0); scene.add(warm); placeCube(); lineMesh.visible = true; renderer.compile(scene, camera); renderer.render(scene, camera); lineMesh.visible = false; scene.remove(warm); fm.dispose(); s.material.dispose(); o.material.dispose();
}
kick();

window.__cubeMaze = {
  boards: BOARDS, pool: POOL,
  get played() { return played.slice(); },
  get board() { return boardId; },
  get state() { return { n, masks: state.masks.slice(), spout: state.spout.slice(), marble: state.marble, g: state.g, out: state.out, moves: history.length, history: history.map(m => m.slice()), par: board.par, solved: state.out, busy: busy() || !!gesture, queued: queue.length, hint: hint && (hint === 'undo' ? 'undo' : hint.slice()), searching: !!hintWorker, next: showNext, completed: completed.slice() }; },
  go, tip(d) { enqueue({ kind: 'tip', dir: d }); }, turn(axis, l, dir) { enqueue({ kind: 'turn', move: [axis, l, dir] }); }, undo, restart, pressHint,
  // The look hint: whether its glyph is on screen now, and how many times it has been shown, ever.
  hint() { return { shown: !!lookHint, count: prefs.hintCount }; },
  screenPoint(cell, face) { placeCube(); return localToScreen(centers[cell].clone().addScaledVector(VEC[face], 0.5)); },
  // A point off the cube toward side `side` (an engine direction, or left, right, toward or away), just past the
  // cube and its feet on screen, where a one-finger swipe or tap rolls the cube; `side` in the result names it.
  offCubePoint(side) {
    placeCube(); const w = typeof side === 'number' ? worldDir(side, orient) : { left: V3(-1, 0, 0), right: V3(1, 0, 0), toward: V3(0, 0, 1), away: V3(0, 0, -1) }[side];
    const s = screenAxis(w), c = cubeScreenCentre(), b = bounds(), ex = s.x ? (s.x > 0 ? b.x + b.width - c.x : c.x - b.x) / Math.abs(s.x) : Infinity, ey = s.y ? (s.y > 0 ? b.y + b.height - c.y : c.y - b.y) / Math.abs(s.y) : Infinity;
    for (let r = Math.min(ex, ey) + 36; r < 4 * Math.max(viewW, viewH); r += 12) {
      const x = Math.max(12, Math.min(viewW - 12, c.x + s.x * r)), y = Math.max(64, Math.min(viewH - 76, c.y + s.y * r));
      if (!hitCube(x, y)) return { x, y, side: worldWord(nearestLevelWorld(w)) };
    }
    return null;
  },
  zoneAt(x, y) { placeCube(); return hitCube(x, y) ? 'cube' : 'off'; },
  project(x, y, z) { placeCube(); return localToScreen(V3(x, y, z)); },
  worldPoint(x, y, z) { placeCube(); return toScreen(V3(x, y, z)); },
  lightAt(cell) { return light.shown[cell * 7 + 6]; },
  pick(x, y) { placeCube(); const h = hitCube(x, y); return h && { cell: info.slot(...h.idx), face: h.axis * 2 + (h.local.getComponent(h.axis) > 0 ? 0 : 1) }; },
  side(d) { return worldWord(worldDir(d, orient)); },
  // Where the marble can be seen from, and a way to set the view for checks.
  sight,
  // The tip hint's arrow on screen: on the floor or on the cube's top, and its screen box.
  hintArrow() {
    if (!hintObj || !hint || hint === 'undo' || hint[0] !== 'tip') return null; placeCube();
    const box = new THREE.Box3().setFromObject(hintObj), pts = []; for (let i = 0; i < 8; i++) pts.push(toScreen(V3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y), w = worldDir(hint[1], orient), f = cubeRoot.position.clone().sub(camera.position).setY(0).normalize();
    return { where: hintObj.userData.top ? 'top' : 'floor', side: worldWord(w), behind: w.dot(f), x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  },
  // For each cubie with a tube: its centre on screen (inside the tube) and points of clear glass beside it in the
  // cubie, toward each closed side.
  tubeSpots() {
    placeCube(); const out = [];
    for (let c = 0; c < info.count; c++) { const m = shown.masks[c]; if (!m) continue; const glass = []; for (let d = 0; d < 6; d++) if (!(m & (1 << d))) glass.push(localToScreen(centers[c].clone().addScaledVector(VEC[d], 0.36)));
      out.push({ cell: c, centre: localToScreen(centers[c]), glass }); }
    return out;
  },
  // For checks of what can be seen: hides one cubie's tube or one foot for a frame, or brings it back.
  hide(kind, i, hidden) { if (kind === 'foot') { feet[i].userData.hidden = !!hidden; placeCube(); } else cells[i].tube.visible = !hidden && !!shown.masks[i]; kick(); },
  // Every matched joint: how far each side's tube reaches toward the joint, and how many collars it wears.
  joints() {
    const out = [], reach = (c, d) => { const p = cells[c].tube.geometry.attributes.position, v = VEC[d]; let r = 0; for (let i = 0; i < p.count; i++) r = Math.max(r, p.getX(i) * v.x + p.getY(i) * v.y + p.getZ(i) * v.z); return r; };
    for (let c = 0; c < info.count; c++) for (let d = 0; d < 6; d += 2) { const q = info.neighbour[c * 6 + d]; if (q < 0 || !(shown.masks[c] & (1 << d)) || !(shown.masks[q] & (1 << (d + 1)))) continue;
      out.push({ cells: [c, q], reach: [reach(c, d), reach(q, d + 1)], collars: (cells[c].sleeves[d].visible ? 1 : 0) + (cells[q].sleeves[d + 1].visible ? 1 : 0), segments: cells[c].tube.geometry.attributes.position.count }); }
    return out;
  },
  setLook(yaw, pitch, zoom = 1) { stopLook(); Object.assign(look, { yaw: yaw * Math.PI / 180, pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch * Math.PI / 180)), zoom, vx: 0, vy: 0 }); aim(); kick(); },
  view() { placeCube(); return { bounds: bounds(), glass: bounds(true), centre: cubeScreenCentre(), axes: Object.fromEntries(['right', 'left', 'toward', 'away'].map((k, i) => [k, screenAxis(LEVEL[i])])), turning: layer ? { a: layer.a, l: layer.l, angle: turnAngle } : null, rolling: !!roll, theta: roll ? FT.rollPose(n, roll.t, roll.th0).theta : 0, recentre: roll ? FT.rollPose(n, roll.t, roll.th0).recentre : 0, rise, drawing: !!raf, marble: toScreen(U.uMarble.value), marbleAt: U.uMarble.value.toArray(), feet: feet.filter(m => m.d && m.d.k > 0.01).map(m => ({ corner: m.d.corner.slice(), r: m.d.r, k: m.d.k, top: m.d.k === 1 ? FOOT : m.d.k * FOOT, bottom: 0, shown: m.visible })), corners: [0, 1, 2, 3, 4, 5, 6, 7].map(i => { const h = n / 2 - SEAT; return cubeRoot.localToWorld(V3(i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h)).toArray(); }), drawn: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }, sizes: { FOOT, RM, half: n / 2 - SEAT, reach: FEET.reach, out: FEET.out, width: FEET.width }, marbleOut, lightMode, ball: ballMat.uniforms.uR.value / pxWorld, marker: 2 * (ballMat.uniforms.uRing.value + 0.55 * pxWorld) / pxWorld,
    look: { yaw: look.yaw * 180 / Math.PI, quarter: ((nearestQuarter() % 4) + 4) % 4, pitch: look.pitch * 180 / Math.PI, zoom: look.zoom, moving: !!look.anim || !!lookG, swaying: !!(look.anim && look.anim.sway) },
    sel: { mode: sel.mode, from: sel.from, cell: sel.hit ? info.slot(...sel.hit.idx) : -1, face: sel.hit ? sel.hit.axis * 2 + (sel.hit.local.getComponent(sel.hit.axis) > 0 ? 0 : 1) : -1, candidates: sel.mode === 'cross' ? [0, 1, 2].filter(a => a !== sel.hit.axis).map(a => [AXES[a], sel.hit.idx[a]]) : [], move: sel.mode === 'slice' ? [AXES[sel.a], sel.l, sel.dir] : null, mark: sel.mark ? worldWord(sel.markW) : null, ramp: sel.ramp, arrow: !!sel.arrow, glow: U.uSel.value.z, glow2: U.uSel2.value.z, whole: U.uWhole.value },
    lean: { deg: leanVec.length() * 180 / Math.PI, x: leanVec.x, z: leanVec.z, side: leanVec.length() > 1e-3 ? worldWord(nearestLevelWorld(leanVec)) : null },
    ring: { count: cueCount, active: !!cueState, still: !!(cueState && cueState.still), radius: cueMat.uniforms.uRad.value / pxWorld, alpha: cueState ? cueMat.uniforms.uA.value : 0 } }; }
};
window.__minimalize = { bounds() { placeCube(); return bounds(); } };
