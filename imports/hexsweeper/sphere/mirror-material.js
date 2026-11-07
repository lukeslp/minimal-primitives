/**
 * File Purpose: Procedural and image-backed reflection fields beneath the Canvas 2D Hexsweeper sphere.
 * Primary Functions/Classes: MirrorMaterial.boot, WebGL reflection renderer, appearance facade.
 * Inputs: reflection canvas + SphereSweeper public API. Outputs: pointer-inert visual material.
 *
 * Visual premise inspired by Matthias Hurrle's “It Is All Just a Reflection”
 * (CodePen @atzedent). This implementation is purpose-built for Hexsweeper:
 * analytic sphere normals replace the reference raymarch, and all gameplay,
 * projection, hit testing, and controls remain Luke Steuber's Canvas 2D engine.
 */
(function (global) {
  "use strict";

  const REFLECTION_THEME = {
    id: "obsidian-mirror",
    name: "Obsidian Mirror",
    chrome: "dark",
    reflectionSurface: true,
    accent: "#eaf8ff",
    pureCovered: false,
    pureRevealed: false,
    bg: "rgba(0,0,0,0)",
    bgGlow: "rgba(0,0,0,0)",
    covered: "rgba(3,9,13,0.08)",
    coveredHi: "rgba(255,255,255,0.08)",
    // Covered topology should read as a fine etch in the material, not a cage
    // laid over it. Wells and interactive states retain their stronger edges.
    coveredEdge: "rgba(222,242,250,0.20)",
    surfaceEdgeWidth: 0.78,
    surfacePentagonEdgeWidth: 1.05,
    surfaceBackfaceEdgeWidth: 0.45,
    coveredShadow: "rgba(0,0,0,0.4)",
    tierCovered: "rgba(3,9,13,0.08)",
    tierFlagged: "#e5222a",
    tierNumbered: "rgba(3,7,10,0.94)",
    tierEmpty: "rgba(0,3,6,0.97)",
    revealed: "rgba(3,7,10,0.94)",
    revealedEmpty: "rgba(0,3,6,0.97)",
    revealedEdge: "rgba(208,232,242,0.34)",
    revealedEmptyEdge: "rgba(150,181,194,0.18)",
    valleyGroove: "rgba(222,242,250,0.28)",
    valleyGrooveDeep: "rgba(0,0,0,0.86)",
    flagFill: "#e5222a",
    flagIcon: "#ffffff",
    flagEdge: "#ff5a5f",
    mine: "#05070a",
    mineCore: "#05070a",
    mineEdge: "#ff3b3f",
    mineBurst: "#ffffff",
    pentagon: "rgba(3,9,13,0.08)",
    pentagonEdge: "rgba(238,248,252,0.28)",
    hoverRing: "#ffffff",
    activeRing: "#9ee8ff",
    backface: "rgba(0,4,8,0.035)",
    backfaceEdge: "rgba(214,237,246,0.075)",
    core: "rgba(0,0,0,0)",
    floatShadow: null,
    text: {
      1: "#f4fbff",
      2: "#bcecff",
      3: "#8ed9f5",
      4: "#ffd7a0",
      5: "#ff9f8f",
      6: "#ff7180",
    },
    label: "#f4fbff",
    labelStroke: "rgba(0,3,7,0.96)",
    revealFlash: "#ffffff",
    revealGlow: "#9ee8ff",
  };

  const MATERIAL_STORAGE_KEY = "hexsweeper-reflection-material-v1";
  const MATERIAL_PRESETS = [
    {
      id: "stormglass",
      label: "Stormglass",
      shortLabel: "Storm",
      fallback: ["#070d12", "#53646c", "#d99358", "#00101e"],
      swatch: "radial-gradient(circle at 58% 24%, #d99358 0 10%, #53646c 32%, #070d12 72%)",
    },
    {
      // Retired curation slot. Preserve its shader index for saved material
      // selections and generated pages from earlier studies.
      retired: true,
      label: "Retired studio slot",
      shortLabel: "Retired",
      fallback: ["#05080a", "#65747a", "#dca465", "#10181c"],
      swatch: "linear-gradient(#111, #050505)",
    },
    {
      id: "mercury",
      label: "Smoked Mercury",
      shortLabel: "Mercury",
      fallback: ["#050708", "#738084", "#b8c7ca", "#101719"],
      swatch: "linear-gradient(165deg, #050708 10%, #b8c7ca 44%, #3d484b 62%, #101719 88%)",
    },
    {
      id: "aurora",
      label: "Aurora Vault",
      shortLabel: "Aurora",
      fallback: ["#02070d", "#2e7f83", "#88d2d0", "#141329"],
      swatch: "linear-gradient(145deg, #02070d 22%, #2e7f83 43%, #88d2d0 51%, #141329 68%)",
    },
    {
      id: "atrium",
      label: "Checker Atrium",
      shortLabel: "Atrium",
      fallback: ["#111416", "#777a77", "#d8d4c9", "#202326"],
      swatch: "conic-gradient(#111416 0 25%, #d8d4c9 0 50%, #202326 0 75%, #777a77 0)",
    },
    {
      id: "canopy",
      label: "Verdant Canopy",
      shortLabel: "Canopy",
      fallback: ["#07100b", "#34563a", "#9ab18d", "#101a13"],
      swatch: "radial-gradient(circle at 62% 24%, #b9c99e 0 8%, #34563a 35%, #07100b 76%)",
      texture: { desktop: "assets/reflections/canopy-2048.webp", mobile: "assets/reflections/canopy-1024.webp", speed: 0.00025, exposure: 0.74, saturation: 0.88, backdrop: 0.46, mapping: "environment", frame: "ambient", reflectionStrength: 0.24, roughness: 0.12, motion: 6, motionAmount: 0.018, motionRate: 0.055 },
    },
    {
      retired: true,
      label: "Retired bokeh slot",
      shortLabel: "Retired",
      fallback: ["#100b08", "#7c5835", "#d7a45f", "#211610"],
      swatch: "linear-gradient(#111, #050505)",
    },
    {
      // Retired slot. Keep its position so the shader indices for later
      // materials remain stable across saved selections and one-page exports.
      retired: true,
      label: "Retired material slot",
      shortLabel: "Retired",
      fallback: ["#030303", "#242424", "#767676", "#0c0c0c"],
      swatch: "linear-gradient(#111, #050505)",
    },
    {
      id: "portoro",
      label: "Portoro Marble",
      shortLabel: "Portoro",
      fallback: ["#050403", "#604c2c", "#d4b26f", "#15110a"],
      swatch: "linear-gradient(118deg, #030303 0 34%, #ba9656 35% 38%, #f0dfb2 39%, #090807 41% 68%, #745b35 69% 72%, #020202 73%)",
      texture: { desktop: "assets/reflections/portoro-2048.webp", mobile: "assets/reflections/portoro-1024.webp", speed: 0.0005, exposure: 0.82, saturation: 0.76, backdrop: 0.44, mapping: "surface", frame: "shell", surfaceMix: 0.90, reflectionStrength: 0.30, roughness: 0.08, gamma: 0.82 },
    },
    {
      id: "deco",
      label: "Deco Lacquer",
      shortLabel: "Deco",
      fallback: ["#030303", "#5b492d", "#c4a26b", "#100e0b"],
      swatch: "repeating-conic-gradient(from 315deg at 50% 100%, #080808 0 7deg, #b28d55 8deg 9deg, #080808 10deg 16deg)",
      texture: { desktop: "assets/reflections/deco-2048.webp", mobile: "assets/reflections/deco-1024.webp", speed: 0.0009, exposure: 0.84, saturation: 0.74, backdrop: 0.44, mapping: "surface", frame: "shell", surfaceMix: 0.88, reflectionStrength: 0.28, roughness: 0.10, gamma: 0.84 },
    },
    {
      id: "oculus",
      label: "Stained Oculus",
      shortLabel: "Oculus",
      fallback: ["#030608", "#315f76", "#f0a53c", "#16060a"],
      swatch: "conic-gradient(from 18deg, #ffb32c, #e32d28, #18aee1, #15b86c, #ffdc4b, #ffb32c)",
      texture: { desktop: "assets/reflections/oculus-1280.webp", mobile: "assets/reflections/oculus-768.webp", speed: 0, exposure: 0.90, saturation: 1.08, backdrop: 0.34, mapping: "hybrid", frame: "shell", surfaceMix: 0.72, reflectionStrength: 0.28, roughness: 0.06, motion: 4, motionAmount: 0.009, motionRate: 0.040, pulse: 0.0 },
    },
    {
      id: "galaxy",
      label: "Galactic Dust",
      shortLabel: "Galaxy",
      fallback: ["#050714", "#49405c", "#d09a9e", "#08172b"],
      swatch: "radial-gradient(ellipse at 38% 62%, #d7a5a2 0 9%, #65506e 26%, #16345e 52%, #050714 78%)",
      texture: { desktop: "assets/reflections/galaxy-1280.webp", mobile: "assets/reflections/galaxy-768.webp", speed: 0.00018, exposure: 1.10, saturation: 0.92, backdrop: 0.50, mapping: "environment", frame: "ambient", reflectionStrength: 0.22, roughness: 0.06, motion: 5, motionAmount: 0.004, motionRate: 0.016 },
    },
    {
      retired: true,
      label: "Retired cabin slot",
      shortLabel: "Retired",
      fallback: ["#01050a", "#112844", "#ffb56b", "#020305"],
      swatch: "linear-gradient(#111, #050505)",
    },
    {
      id: "gilded-ribbon",
      label: "Gilded Ribbon",
      shortLabel: "Ribbon",
      fallback: ["#020103", "#4d3449", "#dfa35f", "#080510"],
      swatch: "repeating-radial-gradient(ellipse at 72% 58%, #060407 0 8px, #c27d38 9px 11px, #16101c 12px 19px, #8c7bb5 20px 21px)",
      texture: { desktop: "assets/reflections/gilded-ribbon-1280.webp", mobile: "assets/reflections/gilded-ribbon-768.webp", speed: 0.00020, exposure: 0.90, saturation: 0.94, backdrop: 0.44, mapping: "surface", frame: "lag", surfaceMix: 0.90, reflectionStrength: 0.34, roughness: 0.07, gamma: 0.78, motion: 7, motionAmount: 0.028, motionRate: 0.060 },
    },
    {
      id: "ion-storm",
      label: "Ion Storm",
      shortLabel: "Ion",
      fallback: ["#06142d", "#175fa2", "#c893dc", "#060a19"],
      swatch: "linear-gradient(135deg, #0a75be 12%, #123866 46%, #d39adb 72%, #100c27 92%)",
      texture: { desktop: "assets/reflections/ion-storm-1280.webp", mobile: "assets/reflections/ion-storm-768.webp", speed: 0.00035, exposure: 0.98, saturation: 1.06, backdrop: 0.48, mapping: "hybrid", frame: "lag", surfaceMix: 0.66, reflectionStrength: 0.38, roughness: 0.08, motion: 8, motionAmount: 0.035, motionRate: 0.085, pulse: 0.10 },
    },
    {
      id: "amber-tempest",
      label: "Amber Tempest",
      shortLabel: "Tempest",
      fallback: ["#071018", "#70472d", "#f1a14e", "#0c1721"],
      swatch: "radial-gradient(circle at 60% 35%, #ffd082 0 7%, #b6602d 28%, #17232c 62%, #05090d 88%)",
      texture: { desktop: "assets/reflections/amber-tempest-1280.webp", mobile: "assets/reflections/amber-tempest-768.webp", speed: -0.00018, exposure: 0.94, saturation: 0.94, backdrop: 0.48, mapping: "hybrid", frame: "lag", surfaceMix: 0.58, reflectionStrength: 0.38, roughness: 0.10, motion: 9, motionAmount: 0.024, motionRate: 0.070, pulse: 0.12 },
    },
    {
      id: "heat-lightning",
      label: "Heat Lightning",
      shortLabel: "Heat",
      fallback: ["#0d1017", "#7a3f53", "#ffb05b", "#190f16"],
      swatch: "radial-gradient(circle at 53% 44%, #fff1cf 0 5%, #ff9f45 14%, #7e3b5d 34%, #11131d 72%)",
      texture: { desktop: "assets/reflections/heat-lightning-1280.webp", mobile: "assets/reflections/heat-lightning-768.webp", speed: 0.00025, exposure: 0.96, saturation: 0.98, backdrop: 0.46, mapping: "hybrid", frame: "lag", surfaceMix: 0.66, reflectionStrength: 0.36, roughness: 0.08, motion: 1, motionAmount: 0.026, motionRate: 0.090, pulse: 0.07, offsetY: 0.02 },
    },
    {
      id: "stratosphere",
      label: "Stratosphere",
      shortLabel: "Sky",
      fallback: ["#e7f2fa", "#74b5df", "#ffffff", "#1d6fa9"],
      swatch: "linear-gradient(180deg, #137ec2 0%, #77c1ec 42%, #ffffff 63%, #dbeef8 100%)",
      texture: { desktop: "assets/reflections/stratosphere-2048.webp", mobile: "assets/reflections/stratosphere-1024.webp", speed: 0.00012, exposure: 0.86, saturation: 0.82, backdrop: 0.50, mapping: "environment", frame: "ambient", reflectionStrength: 0.20, roughness: 0.16, seamSafe: false, seamBlend: 0.055, motion: 10, motionAmount: 0.014, motionRate: 0.035, pulse: 0.0 },
    },
    {
      id: "chromatic-ink",
      label: "Chromatic Ink",
      shortLabel: "Ink",
      fallback: ["#132ccb", "#00d9d2", "#f3ef16", "#ff16a8"],
      swatch: "conic-gradient(from 35deg, #1529c9, #04d7c8, #f0ef13, #fe7416, #f014a8, #1529c9)",
      texture: { desktop: "assets/reflections/chromatic-ink-1280.webp", mobile: "assets/reflections/chromatic-ink-768.webp", speed: 0.00015, exposure: 0.82, saturation: 1.08, backdrop: 0.38, mapping: "surface", frame: "shell", surfaceMix: 0.94, reflectionStrength: 0.24, roughness: 0.12, motion: 2, motionAmount: 0.22, motionRate: 0.075, pulse: 0.0, scaleX: 0.86, scaleY: 0.92 },
    },
    {
      id: "amber-cells",
      label: "Amber Cells",
      shortLabel: "Cells",
      fallback: ["#1c0b02", "#95500e", "#f5bd4e", "#40200a"],
      swatch: "radial-gradient(circle at 28% 32%, #f4bd56 0 16%, #9b5417 17% 21%, transparent 22%), radial-gradient(circle at 68% 61%, #d98724 0 25%, #2b1205 27% 100%)",
      texture: { desktop: "assets/reflections/amber-cells-2048.webp", mobile: "assets/reflections/amber-cells-1024.webp", speed: -0.00008, exposure: 0.84, saturation: 0.90, backdrop: 0.44, mapping: "surface", frame: "shell", surfaceMix: 0.92, reflectionStrength: 0.28, roughness: 0.12, seamSafe: false, seamBlend: 0.070, motion: 3, motionAmount: 0.038, motionRate: 0.22, pulse: 0.0 },
    },
  ];
  const MATERIAL_INDEX = new Map(
    MATERIAL_PRESETS
      .map((preset, index) => [preset.id, index])
      .filter(([id]) => !!id)
  );

  function materialIndex(value) {
    if (Number.isFinite(value)) {
      const index = Math.max(0, Math.min(MATERIAL_PRESETS.length - 1, value | 0));
      return MATERIAL_PRESETS[index].retired ? 0 : index;
    }
    return MATERIAL_INDEX.has(value) ? MATERIAL_INDEX.get(value) : 0;
  }

  function initialMaterial(options) {
    if (options && MATERIAL_INDEX.has(options.material)) return options.material;
    try {
      const query = new URLSearchParams(location.search).get("material");
      if (MATERIAL_INDEX.has(query)) return query;
    } catch (_) {}
    if (MATERIAL_INDEX.has(global.HEXSWEEPER_REFLECTION_MATERIAL)) {
      return global.HEXSWEEPER_REFLECTION_MATERIAL;
    }
    try {
      const stored = localStorage.getItem(MATERIAL_STORAGE_KEY);
      if (MATERIAL_INDEX.has(stored)) return stored;
    } catch (_) {}
    return MATERIAL_PRESETS[0].id;
  }

  const VERTEX_SOURCE = `#version 300 es
precision highp float;
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

  // Original analytic material for this experiment. The known sphere silhouette
  // makes a raymarch unnecessary: one screen-space normal and reflect() produce
  // the continuous mirrored orb at a fraction of the reference shader's cost.
  const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
out vec4 outColor;

uniform float uTime;
uniform float uAppearance;
uniform float uMaterial;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uPointer;
uniform vec2 uRotation;
uniform vec2 uShellRotation;
uniform float uRadius;
uniform sampler2D uEnvironmentMap;
uniform float uTextureReady;
uniform vec4 uTextureParams;
uniform vec4 uTextureTransform;
uniform vec4 uTextureMotion;
uniform vec4 uTextureMapping;
uniform vec4 uTextureDisplay;
uniform vec4 uTextureGrade;
uniform vec4 uActionOrigin;
uniform vec4 uActionState;
uniform vec4 uDynamics;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.52;
  mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);
  for (int i = 0; i < 4; i++) {
    sum += valueNoise(p) * amp;
    p = turn * p * 2.03 + vec2(2.7, -1.9);
    amp *= 0.5;
  }
  return sum;
}

mat2 rotate2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 cameraEnvironmentRay(vec3 ray) {
  ray.yz = rotate2(uPointer.y * 0.025) * ray.yz;
  ray.xz = rotate2(-uPointer.x * 0.025) * ray.xz;
  return normalize(ray);
}

vec3 inverseSphereRotation(vec3 direction, vec2 rotation) {
  // sphere.js rotates object points around Y first, then X. Undo that exact
  // transform in reverse so material landmarks remain attached to the tiles.
  direction.yz = rotate2(rotation.y) * direction.yz;
  direction.xz = rotate2(-rotation.x) * direction.xz;
  return normalize(direction);
}

float softRect(vec2 point, vec2 center, vec2 halfSize, float feather) {
  vec2 outside = abs(point - center) - halfSize;
  return 1.0 - smoothstep(0.0, feather, max(outside.x, outside.y));
}

vec3 stormglassEnvironment(vec3 ray) {
  float longitude = atan(ray.z, ray.x);
  float latitude = asin(clamp(ray.y, -1.0, 1.0));
  vec2 weatherUv = vec2(longitude * 0.85, latitude * 3.2 - uTime * 0.018);
  float broad = fbm(weatherUv * vec2(0.9, 1.65));
  float detail = fbm(weatherUv * vec2(1.75, 3.1) + vec2(4.0, -2.0));
  float cloud = smoothstep(0.43, 0.78, broad * 0.72 + detail * 0.5);

  vec3 nightLow = vec3(0.008, 0.018, 0.027);
  vec3 nightHigh = vec3(0.26, 0.36, 0.42);
  vec3 dayLow = vec3(0.23, 0.29, 0.32);
  vec3 dayHigh = vec3(0.78, 0.84, 0.85);
  vec3 low = mix(nightLow, dayLow, uAppearance);
  vec3 high = mix(nightHigh, dayHigh, uAppearance);
  vec3 color = mix(low, high, cloud * 0.68);

  vec3 keyLight = normalize(vec3(-0.16, 0.86, 0.48));
  float crown = pow(max(dot(ray, keyLight), 0.0), 15.0);
  float horizon = exp(-pow((ray.y - 0.2) * 3.4, 2.0));
  vec3 warm = mix(vec3(1.0, 0.52, 0.22), vec3(1.0, 0.79, 0.47), uAppearance);
  color += warm * crown * (0.9 + cloud * 0.7);
  color += warm * horizon * cloud * 0.14;

  // Stormglass owns a sparse internal flash, not a generic global pulse.
  // The noise gate keeps strikes irregular while material time freezing keeps
  // reduced-motion frames completely stable.
  float flashCycle = floor(uTime * 0.22);
  float flashSeed = hash21(vec2(flashCycle, 11.7));
  float flashPhase = fract(uTime * 0.22);
  float internalFlash = step(0.70, flashSeed) *
    exp(-pow((flashPhase - 0.80) * 28.0, 2.0));
  color += mix(vec3(0.55, 0.72, 0.88), vec3(1.0, 0.92, 0.76), uAppearance) *
    internalFlash * (0.16 + cloud * 0.42);

  float abyss = smoothstep(0.22, 0.95, -ray.y);
  color = mix(color, vec3(0.0, 0.025, 0.055), abyss * (0.72 - uAppearance * 0.22));
  return color;
}

vec3 studioEnvironment(vec3 ray) {
  ray.xz = rotate2(uTime * 0.055) * ray.xz;
  vec2 uv = vec2(atan(ray.z, ray.x) / 3.14159265, asin(clamp(ray.y, -1.0, 1.0)));
  vec3 low = mix(vec3(0.006, 0.010, 0.012), vec3(0.22, 0.245, 0.25), uAppearance);
  vec3 pearl = mix(vec3(0.58, 0.64, 0.66), vec3(0.96, 0.98, 0.97), uAppearance);
  vec3 warm = mix(vec3(0.82, 0.48, 0.22), vec3(1.0, 0.75, 0.42), uAppearance);
  float key = softRect(uv, vec2(-0.30, 0.40), vec2(0.24, 0.20), 0.13);
  float fill = softRect(uv, vec2(0.52, 0.03), vec2(0.18, 0.34), 0.16);
  float rim = softRect(uv, vec2(-0.76, -0.30), vec2(0.10, 0.27), 0.12);
  float sweep = exp(-pow((uv.y + 0.50) * 5.0, 2.0));
  vec3 color = low;
  color += pearl * (key * 0.82 + fill * 0.45 + rim * 0.22);
  color += warm * key * 0.34;
  color += mix(vec3(0.05, 0.08, 0.09), vec3(0.35), uAppearance) * sweep * 0.4;
  return color;
}

vec3 mercuryEnvironment(vec3 ray) {
  // Seamless triplanar flow. The earlier longitude field used atan(), so its
  // non-periodic FBM exposed a hard rear meridian on an otherwise excellent
  // material. Three Cartesian projections stay continuous over the sphere.
  vec3 p = normalize(ray);
  p.xz = rotate2(uTime * 0.012 + uRotation.x * 0.055) * p.xz;
  p.yz = rotate2(-uTime * 0.008 + uRotation.y * 0.045) * p.yz;
  vec3 weights = pow(abs(p), vec3(2.4));
  weights /= max(0.001, weights.x + weights.y + weights.z);
  vec2 driftA = vec2(uTime * 0.035, -uTime * 0.022);
  vec2 driftB = vec2(-uTime * 0.026, uTime * 0.018);
  float flow =
    fbm(p.yz * 2.85 + driftA) * weights.x +
    fbm(p.zx * 2.85 + driftA.yx) * weights.y +
    fbm(p.xy * 2.85 - driftA) * weights.z;
  float counterFlow =
    fbm(p.zy * 4.25 + driftB) * weights.x +
    fbm(p.xz * 4.25 + driftB.yx) * weights.y +
    fbm(p.yx * 4.25 - driftB) * weights.z;
  float broad = 0.5 + 0.5 * sin(
    dot(p, vec3(3.8, 5.3, -2.9)) +
    sin(dot(p, vec3(-2.2, 1.1, 3.4)) + uTime * 0.11) * 0.82 +
    (flow - 0.5) * 1.28
  );
  float liquidBand = smoothstep(0.46, 0.78, 0.62 * flow + 0.46 * counterFlow);
  vec3 shoulderDirection = normalize(vec3(
    -0.64 + uDynamics.x * 0.34,
    0.42 + uDynamics.y * 0.22,
    0.64
  ));
  float shoulder = pow(max(dot(ray, shoulderDirection), 0.0), 4.5);
  float edge = pow(max(dot(ray, normalize(vec3(0.72, -0.12, 0.68))), 0.0), 7.0);
  vec3 charcoal = mix(vec3(0.008, 0.012, 0.014), vec3(0.28, 0.30, 0.30), uAppearance);
  vec3 nickel = mix(vec3(0.30, 0.36, 0.37), vec3(0.75, 0.79, 0.78), uAppearance);
  vec3 silver = mix(vec3(0.66, 0.75, 0.76), vec3(0.97), uAppearance);
  vec3 color = mix(charcoal, nickel, smoothstep(0.18, 0.82, broad) * 0.72);
  color += nickel * liquidBand * 0.16;
  color += silver * shoulder * (0.48 + uDynamics.z * 0.18);
  color += vec3(0.72, 0.84, 0.86) * edge * 0.2;
  return color;
}

vec3 auroraEnvironment(vec3 ray) {
  float longitude = atan(ray.z, ray.x) + uRotation.x * 0.055;
  float latitude = asin(clamp(ray.y, -1.0, 1.0)) + uRotation.y * 0.035;
  float fold = fbm(vec2(longitude * 0.72 - uTime * 0.030, latitude * 1.8 + uTime * 0.018));
  float ribbonCenter = 0.18 * sin(longitude * 1.35 - uTime * 0.11) + (fold - 0.5) * 0.34;
  float ribbon = exp(-pow((latitude - ribbonCenter) * 3.15, 2.0));
  float secondCenter = -0.46 + 0.11 * sin(longitude * 1.72 + uTime * 0.065);
  float secondRibbon = exp(-pow((latitude - secondCenter) * 5.2, 2.0));
  float curtain = 0.68 + 0.32 * sin(
    longitude * 22.0 + fold * 7.0 - uTime * 0.72
  );
  curtain = smoothstep(0.10, 0.92, curtain);
  float phase = 0.5 + 0.5 * sin(longitude * 1.7 + uTime * 0.055);
  vec3 midnight = mix(vec3(0.003, 0.012, 0.022), vec3(0.18, 0.23, 0.28), uAppearance);
  vec3 cyan = mix(vec3(0.08, 0.62, 0.62), vec3(0.32, 0.82, 0.79), uAppearance);
  vec3 violet = mix(vec3(0.24, 0.10, 0.38), vec3(0.43, 0.28, 0.58), uAppearance);
  vec3 color = midnight;
  color += mix(cyan, violet, phase) * ribbon * curtain * (0.72 + fold * 0.48);
  color += mix(violet, cyan, phase) * secondRibbon * (0.18 + curtain * 0.18);
  color += cyan * pow(ribbon, 2.0) * (0.08 + uDynamics.z * 0.18);
  return color;
}

vec3 atriumEnvironment(vec3 ray) {
  float longitude = atan(ray.z, ray.x) / 3.14159265;
  float latitude = asin(clamp(ray.y, -1.0, 1.0)) / 1.57079633;
  vec2 gridUv = vec2(longitude * 4.0, latitude * 3.0);
  vec2 cell = floor(gridUv);
  vec2 within = abs(fract(gridUv) - 0.5);
  float mortar = 1.0 - smoothstep(0.38, 0.47, max(within.x, within.y));
  float checker = mod(cell.x + cell.y, 2.0);
  vec3 darkStone = mix(vec3(0.025, 0.03, 0.032), vec3(0.34, 0.35, 0.34), uAppearance);
  vec3 paleStone = mix(vec3(0.34, 0.35, 0.33), vec3(0.79, 0.77, 0.71), uAppearance);
  vec3 color = mix(darkStone, paleStone, checker * 0.72 + 0.12);
  color = mix(vec3(0.005, 0.008, 0.009), color, mortar);
  float skylight = pow(max(dot(ray, normalize(vec3(-0.1, 0.92, 0.36))), 0.0), 8.0);
  color += mix(vec3(0.42, 0.48, 0.48), vec3(0.95, 0.91, 0.82), uAppearance) * skylight * 0.42;
  return color;
}

vec3 imageEnvironment(vec3 ray, float lod) {
  float longitude = atan(ray.z, ray.x) / 6.28318531 + 0.5;
  float latitude = asin(clamp(ray.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  // Most plates are artwork or ordinary photographs, not authored
  // equirectangular panoramas. Fold longitude at the rear meridian so both
  // sides meet on the same texel column instead of exposing unrelated edges.
  if (uTextureDisplay.x > 0.5) {
    longitude = 1.0 - abs(longitude * 2.0 - 1.0);
  }
  vec2 centered = vec2(longitude, latitude) - 0.5;
  vec2 uv = centered * uTextureTransform.xy + 0.5 + uTextureTransform.zw;

  // Image plates opt into restrained, material-specific motion families.
  // Motion is applied before sampling so the sphere remains geometrically
  // authoritative: weather drifts, ink folds, oil cells merge, glass refracts,
  // branches sway, ribbons flex, and cloud decks advect. Quiet plates stay still.
  float motionMode = uTextureMotion.x;
  float motionAmount = uTextureMotion.y;
  float motionTime = uTime * uTextureMotion.z;
  uv.x = fract(uv.x + uTime * uTextureParams.x * step(0.5, motionMode));
  vec2 motionCenter = uv - 0.5;
  if (motionMode > 0.5 && motionMode < 1.5) {
    float cloudX = fbm(motionCenter * 3.2 + vec2(motionTime, -motionTime * 0.57));
    float cloudY = fbm(motionCenter.yx * 3.7 + vec2(-motionTime * 0.43, motionTime * 0.71));
    uv += (vec2(cloudX, cloudY) - 0.5) * motionAmount;
  } else if (motionMode > 1.5 && motionMode < 2.5) {
    float radius = length(motionCenter);
    float eddy = fbm(motionCenter * 4.4 + vec2(motionTime * 0.7, -motionTime * 0.5)) - 0.5;
    float angle = motionTime + (0.58 - radius) * motionAmount * 3.4 + eddy * motionAmount * 1.8;
    motionCenter = rotate2(angle) * motionCenter;
    vec2 current = vec2(
      fbm(motionCenter * 5.0 + vec2(motionTime, 1.7)),
      fbm(motionCenter.yx * 5.3 + vec2(-motionTime * 0.8, 3.1))
    ) - 0.5;
    uv = motionCenter + 0.5 + current * motionAmount * 0.12;
  } else if (motionMode > 2.5 && motionMode < 3.5) {
    // Two slow lenses approach, overlap, and part. Sampling bends around
    // their boundaries, giving the oil-cell plate a merging cadence.
    vec2 lensA = vec2(sin(motionTime * 0.83), cos(motionTime * 0.61)) * 0.18;
    vec2 lensB = vec2(
      cos(motionTime * 0.57 + 1.4),
      sin(motionTime * 0.74 + 0.9)
    ) * 0.20;
    vec2 deltaA = motionCenter - lensA;
    vec2 deltaB = motionCenter - lensB;
    float fieldA = exp(-dot(deltaA, deltaA) * 24.0);
    float fieldB = exp(-dot(deltaB, deltaB) * 21.0);
    vec2 lensFlow =
      deltaA / max(length(deltaA), 0.035) * fieldA +
      deltaB / max(length(deltaB), 0.035) * fieldB;
    float membrane = fbm(
      motionCenter * 4.2 + vec2(motionTime * 0.42, -motionTime * 0.36)
    ) - 0.5;
    uv += (lensFlow * 0.72 + membrane * 0.42) * motionAmount;
  } else if (motionMode > 4.5 && motionMode < 5.5) {
    // Generic ambient plates breathe independently of shell input.
    vec2 ambientDrift = vec2(
      sin(motionTime * 0.83 + uv.y * 5.0),
      cos(motionTime * 0.67 + uv.x * 4.2)
    );
    uv += ambientDrift * motionAmount;
  } else if (motionMode > 5.5 && motionMode < 6.5) {
    // Canopy: different depth bands answer the same soft wind at different
    // rates, suggesting branch parallax rather than a sliding photograph.
    float depth = fbm(vec2(uv.y * 3.2, uv.x * 1.4 + motionTime * 0.22));
    float gust = sin(uv.y * 9.0 + motionTime * 1.15) * 0.55 +
      sin(uv.y * 17.0 - motionTime * 0.72) * 0.20;
    uv.x += (gust * (0.35 + uv.y * 0.65) + (depth - 0.5) * 0.55) * motionAmount;
    uv.y += sin(uv.x * 7.0 + motionTime * 0.48) * motionAmount * 0.12;
  } else if (motionMode > 6.5 && motionMode < 7.5) {
    // Ribbon: flex across its long axis while the whole material retains the
    // delayed frame inherited from the sphere's optical spring.
    float torsion = sin(motionCenter.y * 11.0 - motionTime * 1.25) * 0.62 +
      sin(motionCenter.y * 23.0 + motionTime * 0.54) * 0.18;
    uv.x += torsion * motionAmount;
    uv.y += sin(motionCenter.x * 8.0 + motionTime * 0.82) * motionAmount * 0.34;
  } else if (motionMode > 7.5 && motionMode < 8.5) {
    // Ion storm: two counter-rotating cloud currents charge the violet core.
    float ionX = fbm(motionCenter * 3.8 + vec2(motionTime, -motionTime * 0.44));
    float ionY = fbm(motionCenter.yx * 4.4 + vec2(-motionTime * 0.63, motionTime));
    uv += (vec2(ionX, ionY) - 0.5) * motionAmount;
    uv += normalize(vec2(-motionCenter.y, motionCenter.x) + 0.001) *
      (ionX - ionY) * motionAmount * 0.45;
  } else if (motionMode > 8.5 && motionMode < 9.5) {
    // Amber tempest: clouds shear above the horizon; the water reflection
    // below it ripples horizontally instead of sharing the same deformation.
    float water = smoothstep(0.52, 0.68, uv.y);
    float cloudFlow = fbm(motionCenter * 3.1 + vec2(motionTime * 0.82, -motionTime * 0.28));
    uv.x += (cloudFlow - 0.5) * motionAmount * (1.0 - water) * 0.72;
    uv.x += sin(uv.y * 38.0 + motionTime * 2.2) * motionAmount * water;
    uv.y += sin(uv.x * 18.0 - motionTime * 1.4) * motionAmount * water * 0.18;
  } else if (motionMode > 9.5 && motionMode < 10.5) {
    // Stratosphere: the distant deck advances slowly while high cirrus moves
    // at another speed, preserving the horizon instead of boiling the image.
    float deck = smoothstep(0.46, 0.68, uv.y);
    uv.x += motionAmount * (
      deck * sin(uv.y * 15.0 + motionTime * 0.72) * 0.42 +
      (1.0 - deck) * sin(uv.y * 7.0 - motionTime * 0.38) * 0.18
    );
    uv.y += deck * sin(uv.x * 10.0 + motionTime * 0.31) * motionAmount * 0.08;
  }

  uv.x = fract(uv.x);
  uv.y = clamp(uv.y, 0.002, 0.998);
  vec3 sampleColor = textureLod(uEnvironmentMap, uv, lod).rgb;
  if (uTextureDisplay.z > 0.0) {
    // Purpose-built panoramas use their full width. Crossfade corresponding
    // texels from both boundaries over a narrow band so motion cannot expose
    // a vertical join even when the source edge match is not mathematically exact.
    float seamDistance = min(uv.x, 1.0 - uv.x);
    float seamMix = (1.0 - smoothstep(0.0, uTextureDisplay.z, seamDistance)) * 0.5;
    vec2 pairedUv = vec2(clamp(1.0 - uv.x, 0.0005, 0.9995), uv.y);
    vec3 pairedColor = textureLod(uEnvironmentMap, pairedUv, lod).rgb;
    sampleColor = mix(sampleColor, pairedColor, seamMix);
  }
  if (motionMode > 3.5 && motionMode < 4.5) {
    // The oculus is fixed into the rotating shell, but its channels refract at
    // slightly different angles. Rotational energy briefly widens the split,
    // then the image resolves back into one piece as the sphere settles.
    float prismAngle = uShellRotation.x + uShellRotation.y * 0.73 + motionTime;
    vec2 prismDirection = vec2(cos(prismAngle), sin(prismAngle));
    float prismWidth = motionAmount * (0.45 + uDynamics.z * 1.9);
    vec3 warmSample = textureLod(
      uEnvironmentMap,
      vec2(fract(uv.x + prismDirection.x * prismWidth), clamp(uv.y + prismDirection.y * prismWidth, 0.002, 0.998)),
      lod
    ).rgb;
    vec3 coolSample = textureLod(
      uEnvironmentMap,
      vec2(fract(uv.x - prismDirection.x * prismWidth), clamp(uv.y - prismDirection.y * prismWidth, 0.002, 0.998)),
      lod
    ).rgb;
    sampleColor = vec3(warmSample.r, sampleColor.g, coolSample.b);
  }
  sampleColor = pow(max(sampleColor, vec3(0.0)), vec3(max(0.2, uTextureGrade.x))) *
    uTextureParams.y + uTextureGrade.y;
  float luma = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
  sampleColor = mix(vec3(luma), sampleColor, uTextureParams.z);
  bool stormFlash = (motionMode > 0.5 && motionMode < 1.5) ||
    (motionMode > 7.5 && motionMode < 9.5);
  if (stormFlash) {
    float flashRate = motionMode > 8.5 ? 0.20 : motionMode > 7.5 ? 0.31 : 0.24;
    float flashGate = motionMode > 8.5 ? 0.70 : motionMode > 7.5 ? 0.58 : 0.66;
    float flashCycle = floor(uTime * flashRate);
    float flashSeed = hash21(vec2(flashCycle, uMaterial + 3.1));
    float flashPhase = fract(uTime * flashRate);
    float internalFlash = step(flashGate, flashSeed) *
      exp(-pow((flashPhase - 0.82) * 32.0, 2.0));
    float cloudBody = smoothstep(0.20, 0.78, luma);
    vec3 lightning = motionMode > 8.5
      ? vec3(1.0, 0.62, 0.26)
      : motionMode > 7.5 ? vec3(0.52, 0.78, 1.0) : vec3(1.0, 0.42, 0.24);
    sampleColor += lightning * internalFlash * (0.18 + cloudBody * 0.48);
  }
  if (motionMode > 5.5 && motionMode < 6.5) {
    float dapple = 0.5 + 0.5 * sin(motionTime * 0.92 + longitude * 5.0);
    sampleColor += vec3(0.18, 0.28, 0.08) * dapple * 0.035;
  } else if (motionMode > 6.5 && motionMode < 7.5) {
    float gilt = smoothstep(0.42, 0.86, luma) * (0.45 + uDynamics.z * 0.55);
    sampleColor += vec3(0.72, 0.38, 0.10) * gilt * 0.075;
  }
  float breathe = 0.5 + 0.5 * sin(uTime * 0.58 + longitude * 6.28318531);
  sampleColor *= 1.0 + uTextureMotion.w * (breathe - 0.35);
  sampleColor = mix(sampleColor, vec3(luma * 0.72 + 0.26), uAppearance * 0.24);
  return sampleColor;
}

float atmosphereOrb(vec2 p, vec2 center, float radius, float feather) {
  return 1.0 - smoothstep(radius - feather, radius + feather, length(p - center));
}

float atmosphereStars(vec2 p) {
  vec2 grid = p * 92.0;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  vec2 star = vec2(hash21(cell + 2.7), hash21(cell + 7.1)) - 0.5;
  float seed = hash21(cell + 13.9);
  return step(0.925, seed) *
    (1.0 - smoothstep(0.012, 0.072, length(local - star * 0.72)));
}

vec3 imageAtmosphere(vec2 screen) {
  float t = uTime;
  float broad = fbm(screen * 1.35 + vec2(t * 0.012, -t * 0.008));
  float detail = fbm(rotate2(0.72) * screen * 3.1 + vec2(-t * 0.018, t * 0.014));
  float radial = length(screen);

  if (uMaterial < 5.5) {
    // Canopy: deep understory, wind-shifted shafts, and a low mist layer.
    vec3 color = mix(vec3(0.008, 0.028, 0.018), vec3(0.11, 0.24, 0.13), broad);
    float wind = sin(t * 0.085) * 0.12 + sin(t * 0.037 + 1.8) * 0.05;
    float shaft = pow(max(0.0, 1.0 - abs(screen.x + screen.y * 0.24 + 0.18 + wind)), 7.0);
    float mist = smoothstep(0.34, 0.72, fbm(screen * vec2(1.8, 3.4) + vec2(t * 0.018, 2.7))) *
      (1.0 - smoothstep(-0.48, 0.18, screen.y));
    color += vec3(0.44, 0.55, 0.29) * shaft * (0.20 + detail * 0.24);
    color = mix(color, vec3(0.18, 0.29, 0.20), mist * 0.18);
    color += vec3(0.28, 0.48, 0.23) * atmosphereOrb(screen, vec2(0.52, 0.30), 0.22, 0.28) * 0.22;
    return color;
  }
  if (uMaterial < 8.5) {
    // Portoro: a black room crossed by one broad champagne light vein.
    float vein = 1.0 - smoothstep(0.035, 0.13, abs(screen.y + screen.x * 0.31 + sin(screen.x * 5.2) * 0.055));
    return vec3(0.009, 0.007, 0.005) + vec3(0.58, 0.39, 0.16) * vein * (0.42 + detail * 0.38);
  }
  if (uMaterial < 9.5) {
    // Deco: architectural fan light, restrained enough to frame the board.
    float angle = atan(screen.y + 0.46, screen.x);
    float fan = pow(max(cos(angle * 7.0 + radial * 2.8), 0.0), 18.0);
    return mix(vec3(0.006, 0.006, 0.007), vec3(0.24, 0.16, 0.075), broad * 0.35) +
      vec3(0.68, 0.46, 0.19) * fan * 0.28;
  }
  if (uMaterial < 10.5) {
    // Oculus: cathedral darkness with colored light, never enlarged glass art.
    float angle = atan(screen.y, screen.x);
    vec3 spectral = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + angle * 2.0 + radial * 8.0);
    float halo = exp(-pow((radial - 0.62) * 4.2, 2.0));
    return vec3(0.008, 0.012, 0.022) + spectral * halo * 0.16 +
      vec3(0.18, 0.10, 0.22) * broad * 0.22;
  }
  if (uMaterial < 11.5) {
    // Galaxy: a quiet star field and low-frequency dust cloud.
    vec3 nebula = mix(vec3(0.006, 0.012, 0.035), vec3(0.21, 0.08, 0.18), smoothstep(0.30, 0.78, broad));
    nebula += vec3(0.08, 0.16, 0.32) * detail * 0.30;
    return nebula + vec3(0.72, 0.82, 1.0) * atmosphereStars(screen) * 0.72;
  }
  if (uMaterial < 13.5) {
    // Ribbon: a weighted torsion field echoes the surface without copying it.
    float lag = uDynamics.x * 0.42 + uDynamics.y * 0.28;
    float ribbonA = exp(-pow((screen.y - sin(screen.x * 2.8 + t * 0.075 + lag) * 0.22) * 18.0, 2.0));
    float ribbonB = exp(-pow((screen.y + 0.34 - cos(screen.x * 2.2 - t * 0.052 - lag) * 0.13) * 24.0, 2.0));
    return vec3(0.007, 0.004, 0.012) + vec3(0.42, 0.23, 0.12) * broad * 0.16 +
      vec3(0.86, 0.51, 0.20) * ribbonA * (0.22 + uDynamics.z * 0.08) +
      vec3(0.32, 0.26, 0.54) * ribbonB * 0.18;
  }
  if (uMaterial < 14.5) {
    // Ion: opposing electric currents and brief cold charge blooms.
    float cloud = smoothstep(0.28, 0.76, broad * 0.70 + detail * 0.44);
    float chargeLine = exp(-pow((screen.y - sin(screen.x * 3.6 + t * 0.14) * 0.18) * 16.0, 2.0));
    float flashSeed = hash21(vec2(floor(t * 0.31), 14.0));
    float flash = step(0.60, flashSeed) * exp(-pow((fract(t * 0.31) - 0.82) * 30.0, 2.0));
    return mix(vec3(0.012, 0.04, 0.12), vec3(0.22, 0.30, 0.68), cloud) +
      vec3(0.34, 0.72, 1.0) * chargeLine * (0.05 + flash * 0.46) +
      vec3(0.48, 0.20, 0.72) * detail * 0.10;
  }
  if (uMaterial < 15.5) {
    // Tempest: amber cloud mass above a dark, horizontally rippling horizon.
    float cloud = smoothstep(0.27, 0.74, broad * 0.76 + detail * 0.38);
    float water = 1.0 - smoothstep(-0.28, 0.02, screen.y);
    float ripple = 0.5 + 0.5 * sin(screen.y * 54.0 + screen.x * 8.0 - t * 0.42);
    float flashSeed = hash21(vec2(floor(t * 0.20), 15.0));
    float flash = step(0.70, flashSeed) * exp(-pow((fract(t * 0.20) - 0.82) * 28.0, 2.0));
    vec3 sky = mix(vec3(0.065, 0.034, 0.018), vec3(0.62, 0.25, 0.055), cloud);
    sky += vec3(1.0, 0.54, 0.18) * flash * (0.12 + cloud * 0.42);
    return mix(sky, sky * (0.28 + ripple * 0.18), water * 0.72);
  }
  if (uMaterial < 16.5) {
    // Heat lightning: slow magenta-orange cloud illumination.
    float cloud = smoothstep(0.28, 0.76, broad * 0.70 + detail * 0.44);
    float flashSeed = hash21(vec2(floor(t * 0.24), 16.0));
    float flash = step(0.72, flashSeed) * exp(-pow((fract(t * 0.24) - 0.82) * 28.0, 2.0));
    return mix(vec3(0.08, 0.025, 0.055), vec3(0.58, 0.18, 0.32), cloud) +
      vec3(1.0, 0.56, 0.30) * flash * cloud * 0.42;
  }
  if (uMaterial < 17.5) {
    // Stratosphere: airy blue field and a cloud deck below the sphere.
    float sky = clamp(screen.y + 0.55, 0.0, 1.0);
    vec3 color = mix(vec3(0.58, 0.78, 0.92), vec3(0.035, 0.30, 0.62), sky);
    float cloud = smoothstep(0.48, 0.72, broad + (0.12 - screen.y) * 0.48);
    return mix(color, vec3(0.88, 0.94, 0.98), cloud * (1.0 - smoothstep(-0.24, 0.42, screen.y)));
  }
  if (uMaterial < 18.5) {
    // Ink: surrounding dye bath, related in palette but not duplicated art.
    vec2 flow = rotate2(broad * 1.4 + t * 0.018) * screen;
    float cyanFlow = fbm(flow * 2.3 + vec2(t * 0.018, 1.4));
    float magentaFlow = fbm(flow.yx * 2.8 + vec2(-t * 0.014, 4.1));
    return vec3(0.015, 0.025, 0.09) + vec3(0.0, 0.42, 0.52) * cyanFlow * 0.42 +
      vec3(0.48, 0.02, 0.38) * magentaFlow * 0.34;
  }
  // Amber cells: warm oil bath with broad translucent halos.
  vec3 amber = mix(vec3(0.055, 0.018, 0.004), vec3(0.42, 0.16, 0.025), broad * 0.62);
  float cellA = atmosphereOrb(screen, vec2(-0.46, 0.18), 0.18, 0.05) -
    atmosphereOrb(screen, vec2(-0.46, 0.18), 0.13, 0.04);
  float cellB = atmosphereOrb(screen, vec2(0.48, -0.24), 0.25, 0.06) -
    atmosphereOrb(screen, vec2(0.48, -0.24), 0.19, 0.05);
  return amber + vec3(0.92, 0.47, 0.08) * max(cellA + cellB, 0.0) * 0.26;
}

vec3 environment(vec3 ray, float lod) {
  if (uMaterial < 0.5) return stormglassEnvironment(ray);
  if (uMaterial < 1.5) return studioEnvironment(ray);
  if (uMaterial < 2.5) return mercuryEnvironment(ray);
  if (uMaterial < 3.5) return auroraEnvironment(ray);
  if (uMaterial < 4.5) return atriumEnvironment(ray);
  if (uTextureReady > 0.5) return imageEnvironment(ray, lod);
  return mix(vec3(0.015, 0.018, 0.017), vec3(0.58, 0.60, 0.57), uAppearance);
}

vec3 materialField() {
  if (uMaterial < 0.5) return mix(vec3(0.012, 0.019, 0.024), vec3(0.72, 0.76, 0.77), uAppearance);
  if (uMaterial < 1.5) return mix(vec3(0.008, 0.012, 0.014), vec3(0.67, 0.69, 0.68), uAppearance);
  if (uMaterial < 2.5) return mix(vec3(0.014, 0.017, 0.018), vec3(0.60, 0.62, 0.61), uAppearance);
  if (uMaterial < 3.5) return mix(vec3(0.004, 0.011, 0.019), vec3(0.48, 0.55, 0.59), uAppearance);
  if (uMaterial < 4.5) return mix(vec3(0.018, 0.021, 0.022), vec3(0.70, 0.69, 0.65), uAppearance);
  return mix(vec3(0.008, 0.010, 0.009), vec3(0.64, 0.65, 0.62), uAppearance);
}

vec3 materialAccent() {
  if (uMaterial < 0.5) return vec3(1.0, 0.72, 0.42);
  if (uMaterial < 1.5) return vec3(1.0, 0.77, 0.48);
  if (uMaterial < 2.5) return vec3(0.72, 0.84, 0.86);
  if (uMaterial < 3.5) return vec3(0.22, 0.82, 0.79);
  if (uMaterial < 4.5) return vec3(0.92, 0.88, 0.76);
  if (uMaterial < 5.5) return vec3(0.67, 0.79, 0.59);
  if (uMaterial < 6.5) return vec3(0.96, 0.72, 0.39);
  if (uMaterial < 7.5) return vec3(0.72, 0.72, 0.70);
  if (uMaterial < 9.5) return vec3(0.86, 0.70, 0.42);
  if (uMaterial < 10.5) return vec3(0.22, 0.78, 0.95);
  if (uMaterial < 11.5) return vec3(0.70, 0.52, 0.92);
  if (uMaterial < 12.5) return vec3(1.0, 0.58, 0.24);
  if (uMaterial < 13.5) return vec3(0.92, 0.62, 0.34);
  if (uMaterial < 14.5) return vec3(0.42, 0.69, 1.0);
  if (uMaterial < 15.5) return vec3(1.0, 0.61, 0.28);
  if (uMaterial < 16.5) return vec3(1.0, 0.55, 0.35);
  if (uMaterial < 17.5) return vec3(0.58, 0.82, 1.0);
  if (uMaterial < 18.5) return vec3(0.18, 0.94, 0.86);
  return vec3(1.0, 0.64, 0.20);
}

void main() {
  vec2 screen = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 backgroundRay = normalize(vec3(screen.x * 0.82, screen.y * 0.82, 1.0));
  vec3 weather = uMaterial > 4.5
    ? imageAtmosphere(screen)
    : environment(cameraEnvironmentRay(backgroundRay), 5.0);
  vec3 field = materialField();
  float backdropCloud = uMaterial > 4.5
    ? 0.82 + uTextureParams.w * 0.16
    : 0.12 + uAppearance * 0.12;
  vec3 color = mix(field, weather, backdropCloud);

  float vignette = smoothstep(0.82, 0.08, length(screen));
  color *= mix(0.56, 1.0, vignette);

  vec2 orb = (gl_FragCoord.xy - uCenter) / max(1.0, uRadius);
  float radius2 = dot(orb, orb);
  float distanceFromCenter = sqrt(radius2);

  // A soft contact shadow belongs to the orb, not the gameplay overlay.
  vec2 shadowUv = (gl_FragCoord.xy - (uCenter + vec2(0.0, -uRadius * 0.86))) /
    vec2(uRadius * 1.08, uRadius * 0.24);
  float shadow = (1.0 - smoothstep(0.12, 1.0, dot(shadowUv, shadowUv))) *
    (1.0 - smoothstep(0.96, 1.04, distanceFromCenter));
  color *= 1.0 - shadow * (0.28 - uAppearance * 0.12);

  if (radius2 < 1.035) {
    float z = sqrt(max(0.0, 1.0 - min(radius2, 1.0)));
    vec3 normal = normalize(vec3(orb, z));
    if (uMaterial > 1.5 && uMaterial < 2.5) {
      vec2 liquid = vec2(
        sin(orb.y * 11.0 + uTime * 0.72),
        cos(orb.x * 9.0 - uTime * 0.58)
      ) * 0.012 * normal.z;
      normal = normalize(vec3(normal.xy + liquid, normal.z));
    }
    // The reflected highlight trails the authoritative Canvas sphere by only
    // a few degrees. It is enough to communicate mass, while the tile geometry
    // and hit testing remain exact and immediate.
    normal = normalize(vec3(
      normal.xy + vec2(-uDynamics.x, uDynamics.y) * 0.045 * normal.z,
      normal.z
    ));

    vec2 actionDelta = orb - uActionOrigin.xy;
    float actionDistance = length(actionDelta);
    vec2 actionDirection = actionDelta / max(actionDistance, 0.001);
    float actionAge = uActionState.x;
    float actionKind = uActionOrigin.z;
    float actionStrength = uActionOrigin.w;
    float reactionGlow = 0.0;
    float reactionHeat = 0.0;
    float reactionDistortion = 0.0;
    if (actionKind > 0.5 && actionKind < 1.5) {
      float crest = exp(-pow((actionDistance - actionAge * 0.50) * 18.0, 2.0)) *
        exp(-actionAge * 1.45);
      float echo = sin(actionDistance * 34.0 - actionAge * 11.0) *
        exp(-actionDistance * 4.4) * exp(-actionAge * 2.8);
      reactionDistortion = (crest * 0.016 + echo * 0.0035) * actionStrength;
      reactionGlow = crest * 0.13 * actionStrength;
    } else if (actionKind > 1.5 && actionKind < 2.5) {
      float pinEnvelope = exp(-actionAge * 3.1);
      float pin = exp(-actionDistance * actionDistance * 115.0) * pinEnvelope;
      float tension = exp(-pow((actionDistance - 0.13 - actionAge * 0.035) * 27.0, 2.0)) *
        pinEnvelope;
      reactionDistortion = (-pin * 0.010 + tension * 0.006) * actionStrength;
      reactionGlow = tension * 0.09 * abs(actionStrength);
    } else if (actionKind > 2.5) {
      float shock = exp(-pow((actionDistance - actionAge * 0.62) * 11.5, 2.0)) *
        exp(-actionAge * 0.38);
      reactionDistortion = shock * 0.064 * actionStrength;
      reactionGlow = shock * 0.48 + exp(-actionAge * 5.2) * 0.62;
      reactionHeat = shock * 0.52 + exp(-actionAge * 3.4) * 0.34;
    }
    normal = normalize(vec3(
      normal.xy + actionDirection * reactionDistortion * normal.z,
      normal.z
    ));
    vec3 reflected = cameraEnvironmentRay(reflect(vec3(0.0, 0.0, -1.0), normal));
    float motionEnergy = clamp(uDynamics.z, 0.0, 1.0);
    float fresnel = pow(
      1.0 - max(normal.z, 0.0),
      mix(2.35, 1.92, motionEnergy)
    );
    vec3 mirror;
    if (uMaterial > 4.5 && uTextureReady > 0.5 && uTextureMapping.x > 0.5) {
      vec3 surfaceRay = uTextureDisplay.y < 0.5
        ? normal
        : uTextureDisplay.y < 1.5
          ? inverseSphereRotation(normal, uShellRotation)
          : inverseSphereRotation(normal, uRotation);
      vec3 surfaceColor = imageEnvironment(
        surfaceRay,
        0.65 + uTextureMapping.w * 2.0
      );
      vec3 reflectionColor = uTextureMapping.x < 1.5
        ? studioEnvironment(reflected)
        : imageEnvironment(reflected, 0.65 + uTextureMapping.w * 4.0);
      float surfaceWeight = clamp(
        uTextureMapping.y * (1.0 - fresnel * 0.65),
        0.0,
        1.0
      );
      mirror = mix(reflectionColor, surfaceColor, surfaceWeight);
    } else {
      mirror = environment(reflected, 0.65);
    }
    float crown = pow(max(dot(normal, normalize(vec3(-0.2, 0.8, 0.56))), 0.0), 12.0);
    mirror *= 0.64 + normal.z * 0.24;
    float reflectionStrength = uMaterial > 4.5
      ? uTextureMapping.z
      : 0.24;
    mirror += materialAccent() * crown * (0.18 + reflectionStrength * 0.52);
    mirror = mix(
      mirror,
      vec3(0.44, 0.58, 0.64),
      fresnel * (0.30 + reflectionStrength * 0.50)
    );
    mirror += vec3(0.72, 0.88, 0.95) * pow(fresnel, 2.0) * 0.2;
    mirror += materialAccent() * reactionGlow;
    mirror += mix(vec3(0.78, 0.90, 1.0), vec3(1.0, 0.24, 0.08), reactionHeat) *
      reactionHeat * 0.72;

    float tableauKind = uActionState.y;
    float tableauAge = uActionState.z;
    if (tableauKind > 0.5) {
      float settle = smoothstep(0.0, 1.45, tableauAge);
      float flourish = exp(-max(0.0, tableauAge - 0.65) * 0.78);
      float sweepPhase = atan(orb.y, orb.x) + distanceFromCenter * 3.7 - tableauAge * 0.62;
      float victorySweep = pow(max(cos(sweepPhase), 0.0), 16.0) * flourish;
      mirror += materialAccent() * victorySweep * 0.34;
      mirror *= 1.0 + settle * 0.055;
      mirror += vec3(0.72, 0.90, 0.96) * pow(fresnel, 1.4) * settle * 0.10;
    } else if (tableauKind < -0.5) {
      float aftermath = smoothstep(1.0, 2.45, tableauAge);
      float mirrorLuma = dot(mirror, vec3(0.2126, 0.7152, 0.0722));
      mirror = mix(mirror, vec3(mirrorLuma * 0.54), aftermath * 0.34);
      mirror += vec3(0.42, 0.025, 0.012) * pow(fresnel, 1.25) * aftermath * 0.34;
      mirror *= 1.0 - aftermath * 0.12;
    }

    float mask = 1.0 - smoothstep(0.986, 1.018, distanceFromCenter);
    color = mix(color, mirror, mask);
  }

  // Keep the brightest environment feature below UI-white so seams/counts win.
  color = color / (1.0 + color * 0.5);
  color = pow(max(color, 0.0), vec3(0.92));
  outColor = vec4(color, 1.0);
}
`;

  // Fire OS WebView runs the full atmospheric shader poorly even on current
  // tablets. This path keeps the selected plate, sphere rotation, lighting,
  // and material palette while dropping the multi-octave weather simulation.
  // The crisp Canvas 2D topology remains layered above it.
  const ANDROID_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
out vec4 outColor;

uniform float uTime;
uniform float uAppearance;
uniform float uMaterial;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uShellRotation;
uniform float uRadius;
uniform sampler2D uEnvironmentMap;
uniform float uTextureReady;
uniform vec4 uTextureParams;
uniform vec4 uTextureTransform;
uniform vec4 uTextureMotion;
uniform vec4 uTextureDisplay;

mat2 rotate2(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

vec3 materialAccent() {
  if (uMaterial < 0.5) return vec3(1.0, 0.72, 0.42);
  if (uMaterial < 2.5) return vec3(0.72, 0.84, 0.86);
  if (uMaterial < 3.5) return vec3(0.22, 0.82, 0.79);
  if (uMaterial < 4.5) return vec3(0.92, 0.88, 0.76);
  if (uMaterial < 5.5) return vec3(0.67, 0.79, 0.59);
  if (uMaterial < 9.5) return vec3(0.86, 0.70, 0.42);
  if (uMaterial < 10.5) return vec3(0.22, 0.78, 0.95);
  if (uMaterial < 11.5) return vec3(0.70, 0.52, 0.92);
  if (uMaterial < 13.5) return vec3(1.0, 0.58, 0.24);
  if (uMaterial < 14.5) return vec3(0.42, 0.69, 1.0);
  if (uMaterial < 15.5) return vec3(1.0, 0.61, 0.28);
  if (uMaterial < 16.5) return vec3(1.0, 0.55, 0.35);
  if (uMaterial < 17.5) return vec3(0.58, 0.82, 1.0);
  if (uMaterial < 18.5) return vec3(0.18, 0.94, 0.86);
  return vec3(1.0, 0.64, 0.20);
}

vec3 plate(vec2 uv) {
  if (uTextureReady < 0.5) {
    return mix(vec3(0.025, 0.03, 0.035), materialAccent() * 0.68, uv.y * 0.72);
  }
  float drift = uTime * uTextureParams.x;
  uv.x = fract(uv.x + drift);
  uv.y += sin(uv.x * 6.2831853 + uTime * uTextureMotion.z) *
    uTextureMotion.y * 0.16;
  vec3 color = texture(uEnvironmentMap, clamp(uv, 0.001, 0.999)).rgb;
  color *= uTextureParams.y;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uTextureParams.z);
  return color;
}

vec2 sphereUv(vec3 direction) {
  direction.yz = rotate2(uShellRotation.y) * direction.yz;
  direction.xz = rotate2(-uShellRotation.x) * direction.xz;
  float longitude = atan(direction.z, direction.x) / 6.28318531 + 0.5;
  float latitude = asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  if (uTextureDisplay.x > 0.5) {
    longitude = 1.0 - abs(longitude * 2.0 - 1.0);
  }
  vec2 centered = vec2(longitude, latitude) - 0.5;
  return centered * uTextureTransform.xy + 0.5 + uTextureTransform.zw;
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 centered = screenUv - 0.5;
  vec3 accent = materialAccent();
  vec3 field = mix(vec3(0.006, 0.008, 0.012), accent * 0.15, uAppearance * 0.42);
  vec3 backdrop = plate(vec2(screenUv.x, 1.0 - screenUv.y));
  float backdropWeight = 0.18 + uTextureParams.w * 0.24;
  vec3 color = mix(field, backdrop, backdropWeight);
  color *= mix(0.62, 1.0, 1.0 - smoothstep(0.08, 0.72, length(centered)));

  vec2 orb = (gl_FragCoord.xy - uCenter) / max(1.0, uRadius);
  float radius2 = dot(orb, orb);
  if (radius2 < 1.04) {
    float z = sqrt(max(0.0, 1.0 - min(radius2, 1.0)));
    vec3 normal = normalize(vec3(orb, z));
    vec3 surface = plate(sphereUv(normal));
    float limb = 0.54 + z * 0.46;
    float crown = pow(max(dot(normal, normalize(vec3(-0.28, 0.70, 0.66))), 0.0), 10.0);
    float fresnel = pow(1.0 - z, 2.0);
    surface = surface * limb + accent * crown * 0.24;
    surface += mix(vec3(0.36, 0.52, 0.60), accent, 0.34) * fresnel * 0.34;
    float mask = 1.0 - smoothstep(0.986, 1.018, sqrt(radius2));
    color = mix(color, surface, mask);
  }

  color = color / (1.0 + color * 0.42);
  outColor = vec4(pow(max(color, 0.0), vec3(0.94)), 1.0);
}
`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function programFor(gl, fragmentSource) {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragment = compile(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentSource || FRAGMENT_SOURCE
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown shader link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  class MaterialRenderer {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.game = null;
      this.gl = null;
      this.program = null;
      this.buffer = null;
      this.texture = null;
      this.textureReady = 0;
      this.textureLoadToken = 0;
      this.uniforms = {};
      this.materialIndex = materialIndex(initialMaterial(options));
      this.appearance = 0;
      this.axes = { field: "dark", shell: "dark", well: "light" };
      this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
      this.reflectionRotation = {
        rotY: 0,
        rotX: 0,
        velocityY: 0,
        velocityX: 0,
        initialized: false,
        energy: 0,
      };
      this.action = { kind: 0, index: -1, strength: 0, startedAt: 0 };
      this.tableau = { kind: 0, startedAt: 0 };
      this.startedAt = performance.now();
      this.materialTime = 0;
      this.lastTimeAt = this.startedAt;
      this.lastPaintAt = 0;
      this.frame = 0;
      this.failed = false;
      this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.mobile = matchMedia("(max-width: 700px), (pointer: coarse)").matches;
      this.android = /Android/i.test(navigator.userAgent || "");
      document.body.dataset.reflectionMaterial = this.getMaterial().id;
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.tabIndex = -1;
      this.bindEvents();
      this.initialize();
    }

    initialize() {
      try {
        const gl = this.canvas.getContext("webgl2", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          // Web and Apple builds retain the composed frame for share cards.
          // Android repaints synchronously in prepareCapture() instead.
          preserveDrawingBuffer: !this.android,
          powerPreference: "high-performance",
        });
        if (!gl) throw new Error("WebGL2 is unavailable");
        this.gl = gl;
        this.program = programFor(
          gl,
          this.android ? ANDROID_FRAGMENT_SOURCE : FRAGMENT_SOURCE
        );
        // Bind before the sampler uniform below; render() rebinds each frame.
        gl.useProgram(this.program);
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW
        );
        const position = gl.getAttribLocation(this.program, "position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        [
          "uTime",
          "uAppearance",
          "uMaterial",
          "uResolution",
          "uCenter",
          "uPointer",
          "uRotation",
          "uShellRotation",
          "uRadius",
          "uEnvironmentMap",
          "uTextureReady",
          "uTextureParams",
          "uTextureTransform",
          "uTextureMotion",
          "uTextureMapping",
          "uTextureDisplay",
          "uTextureGrade",
          "uActionOrigin",
          "uActionState",
          "uDynamics",
        ].forEach((name) => {
          this.uniforms[name] = gl.getUniformLocation(this.program, name);
        });
        this.texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([8, 10, 9, 255])
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.uniform1i(this.uniforms.uEnvironmentMap, 0);
        this.failed = false;
        document.body.classList.remove("reflection-fallback");
        this.resize();
        this.start();
        this.loadSelectedTexture();
      } catch (error) {
        console.warn("Reflection material fallback:", error);
        this.useFallback();
      }
    }

    bindEvents() {
      this.onResize = () => this.resize();
      this.onPointerMove = (event) => {
        if (this.isMotionReduced()) return;
        this.pointer.tx = (event.clientX / Math.max(1, innerWidth)) * 2 - 1;
        this.pointer.ty = (event.clientY / Math.max(1, innerHeight)) * 2 - 1;
      };
      this.onVisibility = () => {
        if (document.hidden) this.stop();
        else this.start();
      };
      this.onSphereAction = (event) => this.handleSphereAction(event.detail || {});
      addEventListener("resize", this.onResize, { passive: true });
      // iOS can drop or mis-time the rotation resize; re-measure over the next
      // frames and let the render loop notice a stale backing store.
      addEventListener("orientationchange", this.onResize, { passive: true });
      if (window.visualViewport) {
        visualViewport.addEventListener("resize", this.onResize, { passive: true });
      }
      addEventListener("pointermove", this.onPointerMove, { passive: true });
      document.addEventListener("visibilitychange", this.onVisibility);
      document.addEventListener("hexsweeper:sphere-action", this.onSphereAction);
      this.canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.stop();
        this.useFallback();
      });
      this.canvas.addEventListener("webglcontextrestored", () => {
        this.gl = null;
        this.program = null;
        this.initialize();
      });
    }

    isMotionReduced() {
      return this.reduceMotion || document.documentElement.dataset.effects === "reduced";
    }

    getMaterial() {
      return MATERIAL_PRESETS[this.materialIndex] || MATERIAL_PRESETS[0];
    }

    getMaterials() {
      return MATERIAL_PRESETS
        .filter((preset) => !preset.retired)
        .map((preset) => Object.assign({}, preset));
    }

    textureURL(preset) {
      if (!preset.texture) return null;
      const embedded = global.HEXSWEEPER_REFLECTION_TEXTURES &&
        global.HEXSWEEPER_REFLECTION_TEXTURES[preset.id];
      if (embedded) return this.mobile ? embedded.mobile : embedded.desktop;
      // Preset paths are relative to sphere/ (the renderer's home). Pages
      // elsewhere set HEXSWEEPER_REFLECTION_TEXTURE_BASE to reach them.
      const base = typeof global.HEXSWEEPER_REFLECTION_TEXTURE_BASE === "string"
        ? global.HEXSWEEPER_REFLECTION_TEXTURE_BASE
        : "";
      return base + (this.mobile ? preset.texture.mobile : preset.texture.desktop);
    }

    loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Unable to load reflection texture: ${url}`));
        image.src = url;
      });
    }

    async loadSelectedTexture() {
      const token = ++this.textureLoadToken;
      const preset = this.getMaterial();
      const url = this.textureURL(preset);
      this.textureReady = 0;
      if (!url || !this.gl || !this.texture) {
        this.render(performance.now(), true);
        return;
      }
      try {
        const image = await this.loadImage(url);
        if (token !== this.textureLoadToken || !this.gl || !this.texture) return;
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        this.textureReady = 1;
        this.render(performance.now(), true);
      } catch (error) {
        if (token !== this.textureLoadToken) return;
        console.warn(`Reflection texture fallback (${preset.id}):`, error);
        this.textureReady = 0;
        this.render(performance.now(), true);
      }
    }

    announce(message) {
      const toast = document.getElementById("count-style-toast");
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => toast.classList.remove("show"), 1200);
    }

    setMaterial(value, options) {
      options = options || {};
      this.materialIndex = materialIndex(value);
      const preset = this.getMaterial();
      document.body.dataset.reflectionMaterial = preset.id;
      if (options.persist !== false) {
        try { localStorage.setItem(MATERIAL_STORAGE_KEY, preset.id); } catch (_) {}
      }
      if (options.updateURL) {
        try {
          const next = new URL(location.href);
          next.searchParams.set("material", preset.id);
          history.replaceState(history.state, "", next);
        } catch (_) {}
      }
      this.loadSelectedTexture();
      if (this.failed) this.paintFallback();
      else this.render(performance.now(), true);
      document.dispatchEvent(new CustomEvent("hexsweeper:reflection-material", {
        detail: { id: preset.id, label: preset.label },
      }));
      if (options.announce) this.announce(`Surface · ${preset.label}`);
      return preset;
    }

    cycleMaterial(options) {
      let next = this.materialIndex;
      do {
        next = (next + 1) % MATERIAL_PRESETS.length;
      } while (MATERIAL_PRESETS[next].retired);
      return this.setMaterial(next, Object.assign({
        persist: true,
        updateURL: true,
        announce: true,
      }, options));
    }

    attach(game) {
      this.game = game;
      const state = typeof game.getState === "function" ? game.getState() : null;
      if (state) {
        this.reflectionRotation.rotY = state.rotY || 0;
        this.reflectionRotation.rotX = state.rotX || 0;
        this.reflectionRotation.initialized = true;
        if (state.isGameOver) {
          this.tableau.kind = state.won ? 1 : -1;
          this.tableau.startedAt = performance.now() - 2600;
        }
      }
      this.resize();
      const material = this;
      const facade = Object.assign({}, game, {
        getAppearance() {
          const base = typeof game.getAppearance === "function" ? game.getAppearance() : {};
          return Object.assign({}, base, { axes: Object.assign({}, material.axes) });
        },
        setAppearanceAxes(axes) {
          material.setAppearance(axes && axes.field === "light" ? "light" : "dark");
        },
        getThemeIndex() {
          return material.appearance > 0.5 ? 0 : 2;
        },
        setThemeIndex(index) {
          const themes = global.SphereSweeper && global.SphereSweeper.THEMES;
          const theme = themes && themes[index];
          material.setAppearance(theme && theme.chrome === "light" ? "light" : "dark");
        },
      });
      this.facade = facade;
      return facade;
    }

    handleSphereAction(detail) {
      const now = performance.now();
      if (detail.type === "reset") {
        this.action = { kind: 0, index: -1, strength: 0, startedAt: 0 };
        this.tableau = { kind: 0, startedAt: 0 };
        return;
      }
      if (detail.type === "finish") {
        this.tableau = { kind: detail.won ? 1 : -1, startedAt: now };
        return;
      }
      const kind = detail.type === "dig"
        ? 1
        : detail.type === "flag" || detail.type === "unflag"
          ? 2
          : detail.type === "detonate" ? 3 : 0;
      if (!kind) return;
      this.action = {
        kind,
        index: Number.isInteger(detail.index) ? detail.index : -1,
        strength: detail.type === "unflag"
          ? -Math.abs(detail.strength || 1)
          : Math.abs(detail.strength || 1),
        startedAt: now,
      };
    }

    shortestAngle(from, to) {
      const tau = Math.PI * 2;
      return ((to - from + Math.PI) % tau + tau) % tau - Math.PI;
    }

    updateReflectionDynamics(state, elapsedSeconds, motionReduced) {
      const motion = this.reflectionRotation;
      const targetY = state.rotY || 0;
      const targetX = state.rotX || 0;
      if (!motion.initialized || motionReduced) {
        motion.rotY = targetY;
        motion.rotX = targetX;
        motion.velocityY = 0;
        motion.velocityX = 0;
        motion.energy = 0;
        motion.initialized = true;
        return motion;
      }

      const dt = Math.min(0.05, Math.max(0.001, elapsedSeconds));
      const stiffness = 92;
      const drag = Math.exp(-15.5 * dt);
      motion.velocityY = (motion.velocityY + this.shortestAngle(motion.rotY, targetY) * stiffness * dt) * drag;
      motion.velocityX = (motion.velocityX + this.shortestAngle(motion.rotX, targetX) * stiffness * dt) * drag;
      motion.rotY += motion.velocityY * dt;
      motion.rotX += motion.velocityX * dt;
      const lagY = this.shortestAngle(motion.rotY, targetY);
      const lagX = this.shortestAngle(motion.rotX, targetX);
      const kinetic = Math.hypot(motion.velocityY, motion.velocityX) * 0.26;
      const displacement = Math.hypot(lagY, lagX) * 1.9;
      const targetEnergy = Math.min(1, kinetic + displacement);
      motion.energy += (targetEnergy - motion.energy) * (targetEnergy > motion.energy ? 0.32 : 0.10);
      motion.lagY = lagY;
      motion.lagX = lagX;
      return motion;
    }

    actionUniform(state, disk, time, motionReduced) {
      const action = this.action;
      if (!action.kind || action.index < 0 || motionReduced) return [0, 0, 0, 0, 0];
      const duration = action.kind === 1 ? 1.55 : action.kind === 2 ? 1.25 : 2.75;
      const age = Math.max(0, (time - action.startedAt) * 0.001);
      if (age > duration || !state.tiles || !state.tiles[action.index]) {
        this.action.kind = 0;
        return [0, 0, 0, 0, 0];
      }
      const projected = this.game.projectTile(
        state.tiles[action.index],
        state.rotY || 0,
        state.rotX || 0
      );
      const front = Math.max(0, Math.min(1, (projected.normalZ + 0.08) / 0.32));
      const x = (projected.center.x - disk.cx) / Math.max(1, disk.r * 0.945);
      const y = (disk.cy - projected.center.y) / Math.max(1, disk.r * 0.945);
      return [x, y, action.kind, action.strength * front, age];
    }

    setAppearance(mode) {
      const light = mode === "light";
      this.appearance = light ? 1 : 0;
      this.axes = light
        ? { field: "light", shell: "light", well: "dark" }
        : { field: "dark", shell: "dark", well: "light" };
      document.body.dataset.reflectionAppearance = light ? "light" : "dark";
      document.body.dataset.sphereChrome = light ? "light" : "dark";
      this.render(performance.now(), true);
    }

    cycleAppearance() {
      this.setAppearance(this.appearance > 0.5 ? "dark" : "light");
      this.announce(this.appearance > 0.5 ? "Reflection · Light" : "Reflection · Dark");
    }

    resize() {
      const cssWidth = this.canvas.clientWidth || innerWidth;
      const cssHeight = this.canvas.clientHeight || innerHeight;
      if (!cssWidth || !cssHeight) return;
      this.cssW = cssWidth;
      this.cssH = cssHeight;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const quality = this.android ? 0.38 : this.mobile ? 0.58 : 0.74;
      const edgeCap = this.android ? 600 : this.mobile ? 820 : 1280;
      let scale = dpr * quality;
      scale = Math.min(scale, edgeCap / Math.max(cssWidth, cssHeight));
      scale = Math.max(this.android ? 0.38 : 0.5, scale);
      const width = Math.max(2, Math.round(cssWidth * scale));
      const height = Math.max(2, Math.round(cssHeight * scale));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      if (this.gl) this.gl.viewport(0, 0, width, height);
      if (this.failed) this.paintFallback();
    }

    useFallback() {
      this.failed = true;
      document.body.classList.add("reflection-fallback");
      this.paintFallback();
    }

    paintFallback() {
      if (!this.game) return;
      const disk = this.game.getSphereScreen();
      const light = this.appearance > 0.5;
      const fallback = this.getMaterial().fallback;
      const field = light ? "#bcc4c7" : fallback[0];
      const rim = light ? "#d9e0e1" : fallback[1];
      const crown = light ? "#ffd9a4" : fallback[2];
      const abyss = light ? "#263746" : fallback[3];
      this.canvas.style.background =
        `radial-gradient(circle ${disk.r}px at ${disk.cx}px ${disk.cy}px, ` +
        `${crown} 0%, ${rim} 25%, ${abyss} 72%, #020609 98%, transparent 100%), ` +
        `linear-gradient(180deg, ${field}, ${light ? "#8f999e" : "#020507"})`;
    }

    start() {
      if (this.frame || document.hidden) return;
      this.lastTimeAt = performance.now();
      this.frame = requestAnimationFrame((time) => this.loop(time));
    }

    stop() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
    }

    loop(time) {
      this.frame = 0;
      // Self-heal a backing store the rotation left behind (see resize()).
      if (
        (this.canvas.clientWidth || 0) !== this.cssW ||
        (this.canvas.clientHeight || 0) !== this.cssH
      ) {
        this.resize();
      }
      const menuOpen = document.body.classList.contains("hex-bloom-open");
      const frameMs = menuOpen ? 120 : this.android ? 40 : this.mobile ? 33 : 22;
      if (time - this.lastPaintAt >= frameMs) {
        this.render(time, false);
        this.lastPaintAt = time;
      }
      this.start();
    }

    render(time, force) {
      if (this.failed) {
        this.paintFallback();
        return;
      }
      const gl = this.gl;
      if (!gl || !this.program || !this.game) return;
      const menuOpen = document.body.classList.contains("hex-bloom-open");
      const motionReduced = this.isMotionReduced();
      const dt = Math.min(50, Math.max(0, time - this.lastTimeAt));
      this.lastTimeAt = time;
      if (!motionReduced && !menuOpen) this.materialTime += dt * 0.001;
      if (motionReduced) {
        this.pointer.tx = 0;
        this.pointer.ty = 0;
      }
      this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.08;
      this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.08;

      const disk = this.game.getSphereScreen();
      const state = this.game.getState();
      const dynamics = this.updateReflectionDynamics(state, dt * 0.001, motionReduced);
      const action = this.actionUniform(state, disk, time, motionReduced);
      const tableauAge = this.tableau.kind
        ? Math.max(0, (time - this.tableau.startedAt) * 0.001)
        : 0;
      const sx = this.canvas.width / Math.max(1, this.canvas.clientWidth);
      const sy = this.canvas.height / Math.max(1, this.canvas.clientHeight);
      const radiusScale = (sx + sy) * 0.5;
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.uniform1f(this.uniforms.uTime, this.materialTime);
      gl.uniform1f(this.uniforms.uAppearance, this.appearance);
      gl.uniform1f(this.uniforms.uMaterial, this.materialIndex);
      const texture = this.getMaterial().texture || {};
      gl.uniform1f(this.uniforms.uTextureReady, this.textureReady);
      gl.uniform4f(
        this.uniforms.uTextureParams,
        texture.speed || 0,
        texture.exposure || 1,
        texture.saturation == null ? 1 : texture.saturation,
        texture.backdrop || 0.2
      );
      gl.uniform4f(
        this.uniforms.uTextureTransform,
        texture.scaleX || 1,
        texture.scaleY || 1,
        texture.offsetX || 0,
        texture.offsetY || 0
      );
      gl.uniform4f(
        this.uniforms.uTextureMotion,
        texture.motion || 0,
        texture.motionAmount || 0,
        texture.motionRate || 0,
        texture.pulse || 0
      );
      const mappingMode = texture.mapping === "surface"
        ? 1
        : texture.mapping === "hybrid" ? 2 : 0;
      const textureFrame = texture.frame === "shell"
        ? 1
        : texture.frame === "lag" ? 2 : 0;
      gl.uniform4f(
        this.uniforms.uTextureMapping,
        mappingMode,
        texture.surfaceMix || 0,
        texture.reflectionStrength == null ? 0.24 : texture.reflectionStrength,
        texture.roughness || 0
      );
      gl.uniform4f(
        this.uniforms.uTextureDisplay,
        texture.seamSafe === false ? 0 : 1,
        textureFrame,
        texture.seamBlend || 0,
        0
      );
      gl.uniform4f(
        this.uniforms.uTextureGrade,
        texture.gamma || 1,
        texture.lift || 0,
        0,
        0
      );
      gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform2f(
        this.uniforms.uCenter,
        disk.cx * sx,
        this.canvas.height - disk.cy * sy
      );
      gl.uniform2f(this.uniforms.uPointer, this.pointer.x, -this.pointer.y);
      gl.uniform2f(this.uniforms.uRotation, dynamics.rotY, dynamics.rotX);
      gl.uniform2f(
        this.uniforms.uShellRotation,
        state.rotY || 0,
        state.rotX || 0
      );
      gl.uniform4f(
        this.uniforms.uActionOrigin,
        action[0],
        action[1],
        action[2],
        action[3]
      );
      gl.uniform4f(
        this.uniforms.uActionState,
        action[4],
        this.tableau.kind,
        motionReduced && this.tableau.kind ? Math.max(2.6, tableauAge) : tableauAge,
        0
      );
      gl.uniform4f(
        this.uniforms.uDynamics,
        dynamics.lagY || 0,
        dynamics.lagX || 0,
        dynamics.energy || 0,
        0
      );
      gl.uniform1f(this.uniforms.uRadius, disk.r * radiusScale * 0.945);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.canvas.style.opacity = menuOpen ? "0.64" : "1";
      this.canvas.style.filter = menuOpen ? "blur(3px) saturate(.72)" : "none";
      if (force) gl.flush();
    }

    prepareCapture() {
      this.render(performance.now(), true);
      if (this.gl) this.gl.finish();
    }
  }

  function boot(options) {
    options = options || {};
    const canvas = document.getElementById(options.canvasId || "reflectionCanvas");
    if (!canvas) throw new Error("MirrorMaterial: canvas not found");
    const material = new MaterialRenderer(canvas, options);
    material.setAppearance(options.appearance || "dark");
    return material;
  }

  global.MirrorMaterial = {
    boot,
    MATERIALS: MATERIAL_PRESETS
      .filter((preset) => !preset.retired)
      .map((preset) => Object.assign({}, preset)),
    THEME: REFLECTION_THEME,
  };
})(typeof window !== "undefined" ? window : globalThis);
