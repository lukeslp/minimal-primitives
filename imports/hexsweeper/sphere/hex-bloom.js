/*
 * Hex bloom menu for sphere-ux.
 *
 * Closed: compact dock hex at bottom-center.
 * Open: seed rises to viewport center, honeycomb blooms, board blurs;
 *        dock seat becomes Close and folds the menu home.
 *
 * Axial geometry + origami fold from /uxperiments/clex.
 * Author: Luke Steuber <luke@lukesteuber.com>
 */
(function (global) {
  "use strict";

  const SIZES = [
    ["xsmall", "XS"],
    ["easy", "S"],
    ["medium", "M"],
    ["hard", "L"],
    ["xlarge", "XL"],
  ];

  // Indicators rotate rather than fan out. `rings` is back in the cycle now
  // that it costs no extra tile — and the Kimi and Muse takes land on it, so
  // it had to stay reachable regardless.
  const INDICATORS = [
    ["numerals", "123"],
    ["yellow", "Mark"],
    ["rings", "Rings"],
  ];

  // Full 6-neighbour ring (pointy-top axial) — used for leaf fans around a parent.
  const DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  // Ring used to fan leaves around a parent. Only cells with r < 0 (screen-up):
  // E/W would sit under Restart/Help, SE/SW would clip off the bottom.
  const LEAF_RING = [
    { q: 1, r: -1 }, // NE
    { q: 0, r: -1 }, // NW
    { q: 2, r: -2 }, // ring-2 up-right
    { q: 1, r: -2 }, // ring-2 NNE
    { q: 0, r: -2 }, // ring-2 N
    { q: -1, r: -1 }, // ring-2 up-left
  ];

  // Fixed seats for the primaries, in categories() order. One row of four
  // (discuss verdict 2026-08-10): every remaining tile is a 2-5 state cycle,
  // Invert and Effects moved to the ? modal as set-once plumbing, and
  // relief+seams merged into the curated Surface cycle.
  //
  //   [L/D][Size][Surface][123]      r = -1  (x = -1.5 … 1.5)
  //      [reset] [x] [flag]          r =  0  (fixed dock)
  const PRIMARY_SLOTS = [
    { q: -1, r: -1 }, // Light / Dark
    { q: 0, r: -1 }, // Size
    { q: 1, r: -1 }, // Surface
    { q: 2, r: -1 }, // Indicators
  ];

  /**
   * ?dock=center — the original clex axial ring, back for a trial now that the
   * menu is small enough to sit over the board: the bloom opens at viewport
   * center on the blurred sphere, Reset and Dig/Flag join the flower, the
   * center tile resets, and tapping the background (anywhere off the sphere)
   * opens it. The bottom dock hides entirely; outside click / Escape closes;
   * the corner ? stays.
   *
   *    [L/D]   [Size]           NW · NE
   *  [Home] [Reset]  [Flag]     W · center · E
   *  [Surface]  [123]           SW · SE
   *
   * Seven hexes, one perfect ring — the flower the clex study promised.
   */
  // Seven rigid regular hexes cannot close over positive curvature without an
  // angular deficit. Keep this cap deliberately shallow: 4.2× yields ~23.6°
  // at ring-1, enough for the oblique camera to read as domed without turning
  // that deficit into triangular gaps or overlapping flaps.
  const DOME_RADIUS_HEX = 4.2;
  const DOME_CENTER_RISE_HEX = 0.12;

  /**
   * Real spherical seating (Luke, 2026-08-10: "how are we fitting them so
   * well in the sphere, if we can't fit them here?"). Exactly — the game
   * tessellates because its hexes are faces of a true sphere: planar tiles
   * sharing 3D chord edges. Faking curvature by hinging flat tiles around
   * their own edges can never tessellate. So the flower is now a patch of
   * convex geodesic cap: each tile is pulled in to its chord position
   * (R·sinφ), receded from the frontmost center by R·(1−cosφ), and tilted
   * outward around its own tangent axis. This matches the sphere behind it:
   * Reset is nearest the viewer; the six rim faces fall away.
   */
  function domeSeat(dx, dy, hex, radiusHex, maxPhi) {
    const R = hex * (radiusHex || DOME_RADIUS_HEX);
    const s = Math.hypot(dx, dy);
    if (s < 1 || !R) {
      return {
        x: dx,
        y: dy,
        ax: 0,
        ay: 1,
        dome: 0,
        dz: hex * DOME_CENTER_RISE_HEX,
        scale: 1,
      };
    }
    const phi = Math.min(maxPhi == null ? 1.1 : maxPhi, s / R);
    const k = (R * Math.sin(phi)) / s;
    return {
      x: dx * k,
      y: dy * k,
      // Rotate around the tile's own tangent axis (perpendicular to its
      // radius from center) by its arc angle — the exact transform for
      // "point this face's normal along the sphere radius at this spot,"
      // and a single rotation has no order to get wrong.
      ax: -(dy / s),
      ay: dx / s,
      dome: (phi * 180) / Math.PI,
      dz: -R * (1 - Math.cos(phi)),
      // Preserve a controlled seam. Enlarging each independent face hid
      // sub-pixel cracks but produced obvious triangular flaps at this cap's
      // unavoidable angular deficit.
      scale: 1,
    };
  }

  function applyCenterDome(el, seat) {
    if (!DOME || !seat) return;
    el.style.setProperty("--domeax", seat.ax.toFixed(4));
    el.style.setProperty("--domeay", seat.ay.toFixed(4));
    el.style.setProperty("--dome", seat.dome.toFixed(2) + "deg");
    el.style.setProperty("--dz", seat.dz.toFixed(1) + "px");
    el.style.setProperty("--dscale", (seat.scale || 1).toFixed(4));
  }

  // Production Sphere ships the exact fixed-center flower. Experimental dock
  // query variants remain in sphere-ux and are intentionally not selectable here.
  const DOCK_MODE = "center";
  const DOCK_CONTEXT = DOCK_MODE === "context";
  const FIXED_CENTER = DOCK_MODE === "center";
  const DEFAULT_BLOOM = DOCK_MODE === "default";
  const DOCK_CENTER = DOCK_MODE === "center" || DOCK_CONTEXT;
  const SHARED_MENU = FIXED_CENTER || DEFAULT_BLOOM;
  // Production: the flower lives ON the sphere — seven real front faces,
  // projected, labelled, sized up so tiles never fall under a fingertip, with
  // rotation kept live while open. Falls back to the off-sphere flower when
  // no clean seven-hex patch faces the camera.
  const FACE_MENU = FIXED_CENTER;
  const FACE_MIN_TILE = 70; // CSS px across a tile before the patch is scaled up (room for a label)
  const FACE_MAX_SCALE = 6; // XL boards have ~11px faces; the cluster still reads as on-sphere
  const FACE_RESEAT_Z = 0.6; // patch turned this far from the camera → re-seat on the front
  const FACE_FOCUS_PX = 84; // the sphere zooms until the centre face is this wide (menu)
  const FAN_FOCUS_MIN = 52; // theme fan needs ring 2 on screen: smaller faces, more of them
  const FACE_SHORT_THEME = {
    light: "Light",
    dark: "Dark",
    stratosphere: "Sky",
    mercury: "Mercury",
    "ion-storm": "Storm",
    aurora: "Aurora",
    galaxy: "Galaxy",
    "gilded-ribbon": "Ribbon",
    "heat-lightning": "Heat",
  };
  /**
   * ?dome=1 — the flower seated on a convex sphere segment: center tile at
   * the front of the cap, ring tiles pulled to chord positions and tilted to
   * spherical normals (see domeSeat). Sized live against the rendered sphere
   * so it fits at any board size or zoom (sizeCenterFlower).
   *
   * ?seed=bare — idle dock shows JUST the gear glyph (same quiet treatment
   * Reset and ? already get); the seed's hex face appears on activation.
   */
  const DOME = (() => {
    try {
      return new URLSearchParams(location.search).get("dome") === "1";
    } catch (_) {
      return false;
    }
  })();
  const SEED_BARE = (() => {
    try {
      return new URLSearchParams(location.search).get("seed") === "bare";
    } catch (_) {
      return false;
    }
  })();

  // In categories() order: four setting tiles, then the west/east actions.
  // Fixed-center uses Reset + Dig/Flag; contextual uses Home + Flag, with
  // Reset promoted to the center tile.
  const CENTER_SLOTS = [
    { q: 0, r: -1 }, // Light / Dark — NW
    { q: 1, r: -1 }, // Size — NE
    { q: -1, r: 1 }, // Surface — SW
    { q: 0, r: 1 }, // Indicators — SE
    { q: -1, r: 0 }, // Reset — W
    { q: 1, r: 0 }, // Dig / Flag — E
  ];
  const FIXED_CENTER_SLOTS = [
    { q: 0, r: -1 }, // Light / Dark — NW
    { q: 1, r: -1 }, // Warning style — NE
    { q: -1, r: 0 }, // Undo — W
    { q: 1, r: 0 }, // Flag — E
    { q: -1, r: 1 }, // Invert — SW
    { q: 0, r: 1 }, // Size — SE
  ];
  // Default / ?seed=bare keep the dock as their origin, but share the
  // center flower's content hierarchy. Five primaries form a compact 2-over-3
  // crown above Restart · Menu · Flag instead of imitating the center ring.
  const DEFAULT_BLOOM_SLOTS = [
    { q: -1, r: -1 }, // Light / Dark — lower left
    { q: 0, r: -2 }, // Warning style — upper left
    { q: 0, r: -1 }, // Reset — lower center
    { q: 1, r: -1 }, // Invert — lower right
    { q: 1, r: -2 }, // Size — upper right
  ];

  /**
   * iOS Safari double-tap smart-zoom, layer two. touch-action: manipulation
   * on the tiles covers taps that land ON them — but the dock grows and lifts
   * as it opens, so the second tap of a fast open/close often lands where the
   * seed WAS: scrim or bare stage, where iOS ignores touch-action entirely.
   * Suppress the zoom at the document and re-dispatch the tap's click so a
   * fast second tap still activates what it hit.
   */
  let lastTapEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      const fast = now - lastTapEnd < 350;
      lastTapEnd = now;
      if (!fast || !e.cancelable) return;
      // A finger still down means pinch, not tap — leave it alone.
      if (e.touches && e.touches.length) return;
      e.preventDefault();
      const t =
        e.target && e.target.closest
          ? e.target.closest("button, a, input, .hb-hex")
          : null;
      if (t && typeof t.click === "function") t.click();
    },
    { passive: false, capture: true }
  );

  // Stroke icons (24×24) — board language, not tool metaphors
  const SIZE_OUTSIDE_XS =
    '<path d="M7.2 7.2 3.3 3.3M3.3 3.3h2.6M3.3 3.3v2.6M16.8 16.8l3.9 3.9M20.7 20.7h-2.6M20.7 20.7v-2.6" stroke-width="1.35"/>';
  const SIZE_OUTSIDE_S =
    '<path d="M5.5 5.5 2.2 2.2M2.2 2.2h2.5M2.2 2.2v2.5M18.5 18.5l3.3 3.3M21.8 21.8h-2.5M21.8 21.8v-2.5" stroke-width="1.35"/>';
  const SIZE_OUTSIDE_M =
    '<path d="M4.1 4.1 1.1 1.1M1.1 1.1h2.4M1.1 1.1v2.4M19.9 19.9l3 3M22.9 22.9h-2.4M22.9 22.9v-2.4" stroke-width="1.3"/>';
  const SIZE_INSIDE_OUT =
    '<path d="M10.4 10.4 6.2 6.2M6.2 6.2H9M6.2 6.2V9M13.6 13.6l4.2 4.2M17.8 17.8H15M17.8 17.8V15" stroke-width="1.4"/>';
  const SIZE_INSIDE_IN =
    '<path d="M5.8 5.8 10.1 10.1M10.1 10.1H7.3M10.1 10.1V7.3M18.2 18.2l-4.3-4.3M13.9 13.9h2.8M13.9 13.9v2.8" stroke-width="1.4"/>';
  // Two mirrored panels use the established horizontal-flip silhouette. Their
  // left/right and top/bottom fills preserve the four-state quadrant idea,
  // without a circle, axis, reticle, or extra badge competing for meaning.
  const INVERT_FLIP =
    '<path d="M3 3.4 10.2 6v12L3 20.6V3.4ZM21 3.4 13.8 6v12l7.2 2.6V3.4Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>';
  const ICONS = {
    // Dig = open / cleared hex face (hollow honeycomb cell)
    dig:
      '<path d="M12 2.8 20.2 7.6v8.8L12 21.2 3.8 16.4V7.6L12 2.8Z"/>',
    // Flag = solid red hex face (matches in-game flag fill)
    flag:
      '<path d="M6 21.2V3.6"/><path d="M6 4.4h11.6l-2.9 4 2.9 4H6"/>',
    sun:
      '<circle cx="12" cy="12" r="4.2"/>' +
      '<path d="M12 2.6v2.4M12 19v2.4M2.6 12h2.4M19 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"/>',
    moon:
      '<path d="M20.4 13.2A8.4 8.4 0 1 1 10.8 3.6a6.8 6.8 0 0 0 9.6 9.6z"/>',
    // Interlocking positive/negative rings from Luke's day/night reference.
    // The dark state reverses the halves, so the toggle changes silhouette
    // without falling back to the unrelated sun/moon metaphor.
    dayNightLight:
      '<circle cx="12" cy="12" r="9" fill="#000" stroke="#000"/>' +
      '<path d="M12 3a9 9 0 0 1 0 18Z" fill="#fff" stroke="none"/>' +
      '<circle cx="12" cy="12" r="4.7" fill="#000" stroke="none"/>' +
      '<path d="M12 7.3a4.7 4.7 0 0 0 0 9.4Z" fill="#fff" stroke="none"/>' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="#000"/>',
    dayNightDark:
      '<circle cx="12" cy="12" r="9" fill="#fff" stroke="#000"/>' +
      '<path d="M12 3a9 9 0 0 0 0 18Z" fill="#000" stroke="none"/>' +
      '<circle cx="12" cy="12" r="4.7" fill="#fff" stroke="none"/>' +
      '<path d="M12 7.3a4.7 4.7 0 0 1 0 9.4Z" fill="#000" stroke="none"/>' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="#000"/>',
    size:
      '<path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3Z"/>' +
      '<path d="M12 8 8.5 10v4L12 16l3.5-2v-4L12 8Z"/>',
    // One outline changes physical size across the five board sizes. The
    // silhouette communicates scale before the tooltip has to explain it.
    sizeXS: '<path d="m12 7.4 4 2.3v4.6l-4 2.3-4-2.3V9.7l4-2.3Z"/>' + SIZE_OUTSIDE_XS,
    sizeS: '<path d="m12 5.7 5.5 3.1v6.4l-5.5 3.1-5.5-3.1V8.8l5.5-3.1Z"/>' + SIZE_OUTSIDE_S,
    sizeM: '<path d="m12 4 7 4v8l-7 4-7-4V8l7-4Z"/>' + SIZE_OUTSIDE_M,
    sizeL: '<path d="m12 2.3 8.5 4.9v9.6L12 21.7l-8.5-4.9V7.2L12 2.3Z"/>' + SIZE_INSIDE_OUT,
    sizeXL: '<path d="m12 .6 10 5.7v11.4l-10 5.7-10-5.7V6.3L12 .6Z"/>' + SIZE_INSIDE_IN,
    // Theme circle remains available to archived/default variants.
    theme: '<circle cx="12" cy="12" r="8"/>',
    // Conventional board-theme affordance: handle, ferrule, and bristles.
    brush:
      '<path d="M10 9V4a2 2 0 0 1 4 0v5"/><path d="M7 9h10v5H7Z"/>' +
      '<path d="M8 14h8v3.3c0 2.2-1.8 4-4 4s-4-1.8-4-4V14Z"/>' +
      '<path d="M10.5 14v5.7M13.5 14v5.7"/>',
    // Settings = a hex nut (hexagon + round bore) — a circle-with-spokes
    // gear read as the Light tile's sun at dock size.
    gear:
      '<path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6L12 3.2Z"/>' +
      '<circle cx="12" cy="12" r="3.4"/>',
    style:
      '<path d="M7 7h.01M12 7h.01M17 7h.01"/><path d="M7 12h.01M12 12h.01M17 12h.01"/>' +
      '<path d="M7 17h.01M12 17h.01M17 17h.01"/>',
    indicators:
      '<path d="M12 3.4 19.3 7.7v8.6L12 20.6 4.7 16.3V7.7L12 3.4Z"/>' +
      '<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
    numerals:
      '<path d="M8 17V7l-2 2"/><path d="M11.5 17h4.2c1.2 0 2-.8 2-2s-.8-2-2-2h-2.2c-1.2 0-2-.8-2-2s.8-2 2-2H18"/>',
    rings:
      '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10"/>',
    drag:
      '<path d="M12 4v16"/><path d="m8 8 4-4 4 4"/><path d="m8 16 4 4 4-4"/>' +
      '<path d="M4 12h16"/><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>',
    // The mirrored panels are also the state diagram: empty, right half,
    // upper half, full. One silhouette communicates both flip and state.
    invertOff:
      INVERT_FLIP,
    invertX:
      '<path d="M21 3.4 13.8 6v12l7.2 2.6Z" fill="currentColor" stroke="none"/>' +
      INVERT_FLIP,
    invertY:
      '<path d="M3 3.4 10.2 6v6H3ZM21 3.4 13.8 6v6H21Z" fill="currentColor" stroke="none"/>' +
      INVERT_FLIP,
    invertBoth:
      '<path d="M3 3.4 10.2 6v12L3 20.6ZM21 3.4 13.8 6v12l7.2 2.6Z" fill="currentColor" stroke="none"/>' + INVERT_FLIP,
    more: '<circle cx="6.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="17.5" cy="12" r="1.6"/>',
    // Menu affordance — hollow hex (board language)
    menu:
      '<path d="M12 2.8 20.2 7.6v8.8L12 21.2 3.8 16.4V7.6L12 2.8Z"/>',
    reset:
      '<path d="M3.5 12a8.5 8.5 0 0 1 14.3-6.2L20 8"/><path d="M20 3.5V8h-4.5"/>' +
      '<path d="M20.5 12a8.5 8.5 0 0 1-14.3 6.2L4 16"/><path d="M4 20.5V16h4.5"/>',
    close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    undo:
      '<path d="M4 4v5h5"/><path d="M4.8 8.2A8.3 8.3 0 1 1 4 16"/>',
    home:
      '<path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9.2v10.3h13V9.2"/>' +
      '<path d="M9.2 19.5v-6.2h5.6v6.2"/>',
    help:
      '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.8 2.8 0 1 1 3.9 2.6c-.9.5-1.6 1.1-1.6 2.2"/>' +
      '<path d="M12 17.2h.01"/>',
    // Effects use one visual-intensity family instead of the old sparkles:
    // broken ripples = adaptive, three rings = full, one ring = reduced.
    effectsAuto:
      '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
      '<path d="M8.8 8.8a4.5 4.5 0 0 0 0 6.4M15.2 8.8a4.5 4.5 0 0 1 0 6.4"/>' +
      '<path d="M6.2 6.2a8.2 8.2 0 0 0 0 11.6M17.8 6.2a8.2 8.2 0 0 1 0 11.6"/>',
    effectsFull:
      '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="4.3"/><circle cx="12" cy="12" r="8"/>',
    effectsReduced:
      '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="4.8"/>',
    sliders:
      '<path d="M4 6h5M13 6h7M4 12h10M18 12h2M4 18h2M10 18h10"/>' +
      '<path d="M9 3v6M14 9v6M10 15v6"/>',
    bang: '<path d="M12 3.5v12"/><path d="M12 20.5h.01"/>',
    warningNumbersDepth:
      '<path d="m12 4.4 7 4v8l-7 4-7-4v-8l7-4Z" fill="currentColor" stroke="none" opacity=".24" transform="translate(1 1)"/>' +
      '<path d="m12 3 7 4v8l-7 4-7-4V7l7-4Z" fill="#fff"/>' +
      '<text x="12" y="14.8" text-anchor="middle" fill="currentColor" stroke="none" font-family="IBM Plex Sans, sans-serif" font-size="9.8" font-weight="700">3</text>',
    warningNumbersFlat:
      '<text x="12" y="15.8" text-anchor="middle" fill="currentColor" stroke="none" font-family="IBM Plex Sans, sans-serif" font-size="11" font-weight="700">123</text>',
    warningMonoDepth:
      '<path d="m7.4 5.7 4.2 2.4v4.8l-4.2 2.4-4.2-2.4V8.1l4.2-2.4Z" fill="currentColor"/>' +
      '<path d="m16.6 5.7 4.2 2.4v4.8l-4.2 2.4-4.2-2.4V8.1l4.2-2.4Z"/>' +
      '<path d="m7.4 15.3 4.6 2.6 4.6-2.6"/>',
    warningYellowInk:
      '<path d="m7 7 4 2.3v4.6L7 16.2 3 13.9V9.3L7 7Zm10 0 4 2.3v4.6l-4 2.3-4-2.3V9.3L17 7Z" fill="#ffd400" stroke="#ffd400"/>',
    countNumbers:
      '<text x="12" y="15.8" text-anchor="middle" fill="currentColor" stroke="none" font-family="IBM Plex Sans, sans-serif" font-size="10.5" font-weight="650">123</text>',
    countHex:
      '<path d="M12 3.8 19.2 8v8L12 20.2 4.8 16V8L12 3.8Z"/>' +
      '<path d="M12 8.3 15.2 10.1v3.8L12 15.7l-3.2-1.8v-3.8L12 8.3Z" fill="currentColor" stroke="none"/>',
    seamsOn:
      '<path d="m7.2 5.5 4.8 2.75v5.5L7.2 16.5l-4.8-2.75v-5.5L7.2 5.5Z"/>' +
      '<path d="m16.8 5.5 4.8 2.75v5.5l-4.8 2.75-4.8-2.75v-5.5l4.8-2.75Z"/>',
    seamsOff:
      '<path d="M7.2 5.5h9.6l4.8 2.75v5.5l-4.8 2.75H7.2l-4.8-2.75v-5.5L7.2 5.5Z"/>',
    depth3d:
      '<path d="M4 5.2h4.2v13.6h7.6V5.2H20"/>' +
      '<path d="M12 4.2v10.4M8.8 11.5 12 14.8l3.2-3.3"/>',
    depthFlat:
      '<path d="m12 9.5 8.5 2.5-8.5 2.5L3.5 12 12 9.5Z" fill="currentColor" stroke="none"/>',
    flipX:
      '<path d="M12 4v16"/><path d="M4 12h6"/><path d="M14 12h6"/><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/>',
    flipY:
      '<path d="M4 12h16"/><path d="M12 4v6"/><path d="M12 14v6"/><path d="m9 8 3-3 3 3"/><path d="m9 16 3 3 3-3"/>',
  };

  function iconMarkup(name) {
    const paths = ICONS[name] || ICONS.more;
    return (
      '<svg class="hb-icon hb-icon-' +
      name +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths +
      "</svg>"
    );
  }

  /** Pull a compact preview palette from a SphereSweeper theme def. */
  function themeSwatchVars(t) {
    if (!t) {
      return {
        fill: "#ffffff",
        edge: "#000000",
        field: "#ffffff",
        ink: "#000000",
        accent: "#ff0000",
      };
    }
    // covered ≈ shell tiles; bg ≈ page/field; flagFill for accent tick
    let fill = t.covered || t.tierCovered || "#888888";
    let field = t.bg || "#000000";
    let edge = t.coveredEdge || t.accent || "#888888";
    // coveredEdge can be rgba — fine for border color
    if (typeof edge === "string" && edge.indexOf("rgba") === 0) {
      edge = t.accent || (t.chrome === "dark" ? "#ffffff" : "#000000");
    }
    const ink =
      t.label ||
      t.accent ||
      (t.chrome === "dark" ? "#ffffff" : "#000000");
    const accent = t.flagFill || t.tierFlagged || "#ff0000";
    // Globe themes: covered is a muted map fallback — keep it
    return { fill, edge, field, ink, accent };
  }

  function prefersReducedMotion() {
    return (
      global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function riseMs() {
    if (prefersReducedMotion()) return 0;
    return 220; // keep in sync with --rise-ms in hex-bloom.css
  }

  function foldMs() {
    if (prefersReducedMotion()) return 0;
    return DOCK_CONTEXT ? 140 : 180;
  }

  function initHexBloom(game, bloomOptions) {
    if (!game) return null;
    // Pages on the minimal brief pass { tooltips: false }: the names stay in
    // aria-label and nothing grows a hover title. Everyone else keeps them.
    const tooltips = !bloomOptions || bloomOptions.tooltips !== false;
    function tip(el, text) {
      if (tooltips && el) el.title = text;
    }
    document.body.classList.add("hex-bloom-ui");

    const THEMES = (global.SphereSweeper && global.SphereSweeper.THEMES) || [];

    let root = document.getElementById("hex-bloom");
    if (!root) {
      root = document.createElement("nav");
      root.id = "hex-bloom";
      root.className = "hex-bloom";
      root.setAttribute("aria-label", "Game menu");
      document.body.appendChild(root);
    } else {
      root.textContent = "";
    }

    const scrim = document.createElement("div");
    scrim.className = "hex-bloom-scrim";
    scrim.setAttribute("aria-hidden", "true");
    root.appendChild(scrim);

    const stage = document.createElement("div");
    stage.className = "hex-bloom-stage";
    stage.id = "hex-bloom-stage";
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-modal", "true");
    stage.setAttribute("aria-label", "Game menu");
    root.appendChild(stage);

    const dock = document.createElement("div");
    dock.className = "hex-bloom-dock";
    root.appendChild(dock);

    // Help lives in its own corner seat, outside the dock's grammar —
    // the dock trio is all play controls (Restart · Menu · Flag).
    const helpCorner = document.createElement("div");
    helpCorner.className = "hex-bloom-corner";
    root.appendChild(helpCorner);

    // Center-flower variants have no dock, so the flower's only route was the
    // undocumented tap-outside-the-sphere. A visible seat in the opposite
    // corner gives the menu a home without bringing the dock trio back.
    let menuCorner = null;
    if (DOCK_CENTER) {
      menuCorner = document.createElement("div");
      menuCorner.className = "hex-bloom-corner is-menu-corner";
      root.appendChild(menuCorner);
    }

    const live = document.createElement("p");
    live.className = "hex-bloom-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    root.appendChild(live);

    const tooltip = document.createElement("div");
    tooltip.id = "hex-bloom-tooltip";
    tooltip.className = "hex-bloom-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    root.appendChild(tooltip);

    let hub = document.getElementById("hex-bloom-hub");
    if (!hub) {
      hub = document.createElement("div");
      hub.id = "hex-bloom-hub";
      hub.className = "hex-bloom-hub";
      hub.hidden = true;
      hub.setAttribute("aria-live", "polite");
      hub.innerHTML =
        '<svg class="hub-ico" viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="11" cy="14" r="6.5" fill="currentColor"/>' +
        '<path d="M15.3 9.7l2.7-2.7M16.6 4.9l1.7 1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>' +
        '<span id="hex-bloom-hub-mines">00</span>' +
        '<svg class="hub-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.4 1.6M9.5 3h5"/></svg>' +
        '<span id="hex-bloom-hub-time">0</span>';
      document.body.appendChild(hub);
    }
    const hubMines = document.getElementById("hex-bloom-hub-mines");
    const hubTime = document.getElementById("hex-bloom-hub-time");
    let contextAnchor = null;
    const hoverBloomEnabled =
      SHARED_MENU &&
      matchMedia("(hover: hover) and (pointer: fine)").matches;
    const hoverTooltipsEnabled = matchMedia(
      "(hover: hover) and (pointer: fine)"
    ).matches;
    let tooltipTimer = null;
    let tooltipTarget = null;

    function hideTooltip() {
      clearTimeout(tooltipTimer);
      tooltipTimer = null;
      tooltipTarget = null;
      tooltip.hidden = true;
    }

    function showTooltip(el) {
      if (!el || !el.isConnected || !isOpenish()) return;
      const text = el.dataset.tooltip || "";
      if (!text) return;
      tooltipTarget = el;
      tooltip.textContent = text;
      tooltip.hidden = false;
      requestAnimationFrame(() => {
        if (tooltipTarget !== el || tooltip.hidden) return;
        const tile = el.getBoundingClientRect();
        const tip = tooltip.getBoundingClientRect();
        const gutter = 8;
        let left = tile.left + tile.width / 2 - tip.width / 2;
        left = Math.max(
          gutter,
          Math.min(left, global.innerWidth - tip.width - gutter)
        );
        let anchorTop = tile.top;
        if (el.classList.contains("is-active")) {
          const shown = Array.from(stage.querySelectorAll(".hb-hex.shown"));
          if (shown.length) {
            anchorTop = Math.min(
              ...shown.map((node) => node.getBoundingClientRect().top)
            );
          }
        }
        let top = anchorTop - tip.height - 8;
        if (top < gutter) top = tile.bottom + 8;
        tooltip.style.left = Math.round(left) + "px";
        tooltip.style.top = Math.round(top) + "px";
      });
    }

    function queueTooltip(el, immediate) {
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(() => showTooltip(el), immediate ? 0 : 280);
    }

    // ---- Hex math (clex) ----
    /**
     * Where the center flower sits. It used to sit on the sphere's own
     * center under a blur plate; with nine themes previewing live that hid
     * the one thing the menu changes. Now the board stays sharp and the
     * flower moves off it: below the sphere on portrait phones, beside it on
     * wide screens, and only when neither fits does it overlap the lower rim.
     * A flower is three rows: 2.5 × tile height, 3 tiles wide.
     */
    function flowerAnchor(w, h) {
      const disk =
        typeof game.getSphereScreen === "function" ? game.getSphereScreen() : null;
      if (!disk || !disk.r) return { cx: w / 2, cy: h / 2 };
      const { tileH, tileW } = tileMetrics();
      const flowerH = tileH * 2.5;
      const flowerW = tileW * 3;
      const gap = Math.max(10, tileH * 0.16);
      const bottomChrome = 76; // corner glyphs + home indicator
      const topChrome = 64; // mines / timer hub
      const bottomLimit = h - bottomChrome;
      const belowCy = disk.cy + disk.r + gap + flowerH / 2;
      if (belowCy + flowerH / 2 <= bottomLimit) return { cx: w / 2, cy: belowCy };
      const besideCx = disk.cx + disk.r + gap + flowerW / 2;
      if (besideCx + flowerW / 2 <= w - 12) return { cx: besideCx, cy: disk.cy };
      // Lower rim: keep the upper two thirds of the sphere clear.
      const rimCy = Math.min(bottomLimit - flowerH / 2, disk.cy + disk.r * 0.55);
      return { cx: w / 2, cy: Math.max(topChrome + flowerH / 2, rimCy) };
    }

    function tileMetrics() {
      const cs = getComputedStyle(root);
      const th = parseFloat(cs.getPropertyValue("--tile-h")) || 88;
      const tw = parseFloat(cs.getPropertyValue("--tile-w")) || th * 0.873;
      return { HEX: th / 2, tileH: th, tileW: tw };
    }

    function hexToPixel(q, r, HEX) {
      return {
        x: HEX * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
        y: HEX * ((3 / 2) * r),
      };
    }

    function dockOpen() {
      return (
        state.phase === "open" ||
        state.phase === "rising" ||
        state.phase === "falling"
      );
    }

    /**
     * Bloom origin = menu dock tile (activation node).
     *
     * While the dock is open/opening, never trust a live getBoundingClientRect
     * of the menu — width/height/translateY animate over --rise-ms, and a mid-
     * transition rect stacks Dig/Size under Restart/Menu/Help. Compute the
     * *final* open seat from CSS tokens instead.
     */
    function centerXY() {
      const h = stage.clientHeight || global.innerHeight;
      const w = stage.clientWidth || global.innerWidth;
      if (DOCK_CONTEXT) {
        const anchor = contextAnchor || { x: w / 2, y: h / 2 };
        const { HEX, tileH, tileW } = tileMetrics();
        const seats = CENTER_SLOTS.map((d) => hexToPixel(d.q, d.r, HEX));
        seats.push({ x: 0, y: 0 });
        const minDx = Math.min(...seats.map((p) => p.x));
        const maxDx = Math.max(...seats.map((p) => p.x));
        const minDy = Math.min(...seats.map((p) => p.y));
        const maxDy = Math.max(...seats.map((p) => p.y));
        const margin = 14;
        const topMargin = 56; // keep the open-menu mines/timer hub readable
        const lowX = margin + tileW / 2 - minDx;
        const highX = w - margin - tileW / 2 - maxDx;
        const lowY = topMargin + tileH / 2 - minDy;
        const highY = h - margin - tileH / 2 - maxDy;
        return {
          cx: lowX <= highX ? Math.max(lowX, Math.min(highX, anchor.x)) : w / 2,
          cy: lowY <= highY ? Math.max(lowY, Math.min(highY, anchor.y)) : h / 2,
        };
      }
      if (DOCK_CENTER) return flowerAnchor(w, h);
      const csRoot = getComputedStyle(root);
      const csDock = dock ? getComputedStyle(dock) : csRoot;
      // CSS: .hex-bloom-dock { bottom: max(2px, env(safe-area-inset-bottom)) }
      // Computed style resolves the max()/env() to px — hardcoding 2 put the
      // petals ~30px low on phones with a home indicator (viewport-fit=cover).
      let bottomPad = 2;
      if (dock) {
        const b = parseFloat(getComputedStyle(dock).bottom);
        if (Number.isFinite(b) && b >= 0 && b < 120) bottomPad = b;
      }
      if (dockOpen()) {
        // Final open size = full bloom tiles (--tile-h on root; dock mirrors it)
        const th =
          parseFloat(csRoot.getPropertyValue("--tile-h")) ||
          parseFloat(csDock.getPropertyValue("--tile-h-dock")) ||
          88;
        // --dock-rise is set on .hex-bloom-dock when open, not on root
        let rise = parseFloat(
          String(csDock.getPropertyValue("--dock-rise")).replace("px", "")
        );
        if (!Number.isFinite(rise) || rise === 0) {
          // Fallback if computed style still idle mid-frame
          rise = w <= 400 ? -28 : -36;
        }
        // bottom edge at bottomPad; translateY(rise) lifts the center
        const cy = h - bottomPad - th / 2 + rise;
        return { cx: w / 2, cy };
      }
      // Closed / idle: live measure is fine (no transition collision)
      const stageRect = stage.getBoundingClientRect();
      const menu = dockBtn || document.getElementById("hex-bloom-seed");
      if (menu) {
        const r = menu.getBoundingClientRect();
        return {
          cx: r.left + r.width / 2 - stageRect.left,
          cy: r.top + r.height / 2 - stageRect.top,
        };
      }
      const th = parseFloat(csRoot.getPropertyValue("--tile-h-dock-idle")) || 46;
      return { cx: w / 2, cy: h - bottomPad - th / 2 };
    }

    function setRiseVar() {
      root.style.setProperty("--rise-y", "0px");
    }

    /**
     * Vertical distance from the dock's idle seed to its open seed, from the
     * same CSS tokens centerXY trusts. The stage starts translated down by
     * this and rides to 0 in lockstep with the dock's grow+lift.
     */
    function dockRiseDelta() {
      const csRoot = getComputedStyle(root);
      const th = parseFloat(csRoot.getPropertyValue("--tile-h")) || 88;
      const thIdle =
        parseFloat(csRoot.getPropertyValue("--tile-h-dock-idle")) || 46;
      let rise = NaN;
      if (dock) {
        rise = parseFloat(
          String(getComputedStyle(dock).getPropertyValue("--dock-rise")).replace("px", "")
        );
      }
      if (!Number.isFinite(rise) || rise === 0) {
        rise = (stage.clientWidth || global.innerWidth) <= 400 ? -28 : -36;
      }
      if (root.dataset.bottomSeed === "true") {
        const sink =
          parseFloat(csRoot.getPropertyValue("--seed-sink")) ||
          ((stage.clientWidth || global.innerWidth) <= 400 ? 53 : 44);
        return sink - rise;
      }
      return (th - thIdle) / 2 - rise;
    }

    function leafOffsets(dirIndex, count) {
      if (count <= 0) return [];
      // Prefer bloom-up directions so nested fans also stay on-screen.
      const ring = LEAF_RING;
      if (count <= 3) {
        const trio = [
          ring[(dirIndex + ring.length - 1) % ring.length],
          ring[dirIndex % ring.length],
          ring[(dirIndex + 1) % ring.length],
        ];
        if (count === 1) return [trio[1]];
        if (count === 2) return [trio[0], trio[2]];
        return trio;
      }
      const out = ring[dirIndex % ring.length];
      const left = ring[(dirIndex + ring.length - 1) % ring.length];
      const right = ring[(dirIndex + 1) % ring.length];
      const farLeft = ring[(dirIndex + ring.length - 2) % ring.length];
      const farRight = ring[(dirIndex + 2) % ring.length];
      const candidates = [
        left,
        out,
        right,
        { q: out.q + left.q, r: out.r + left.r },
        { q: out.q * 2, r: out.r * 2 },
        { q: out.q + right.q, r: out.r + right.r },
        { q: left.q + farLeft.q, r: left.r + farLeft.r },
        { q: right.q + farRight.q, r: right.r + farRight.r },
        { q: out.q + farLeft.q, r: out.r + farLeft.r },
        { q: out.q + farRight.q, r: out.r + farRight.r },
      ];
      const ox = out.q * 2 + out.r;
      const oy = out.r * Math.sqrt(3);
      const scored = candidates.map((c, i) => {
        const px = c.q * 2 + c.r;
        const py = c.r * Math.sqrt(3);
        return { c, i, proj: px * ox + py * oy };
      });
      scored.sort((a, b) => b.proj - a.proj || a.i - b.i);
      const seen = new Set();
      const outList = [];
      for (const s of scored) {
        const key = s.c.q + "," + s.c.r;
        if (seen.has(key)) continue;
        if (s.c.q === 0 && s.c.r === 0) continue;
        seen.add(key);
        outList.push(s.c);
        if (outList.length >= count) break;
      }
      outList.sort((a, b) => {
        const pa = hexToPixel(a.q, a.r, 1);
        const pb = hexToPixel(b.q, b.r, 1);
        return Math.atan2(pa.y, pa.x) - Math.atan2(pb.y, pb.x);
      });
      return outList;
    }

    function place(el, x, y, originX, originY) {
      // Bottom-anchored, same as the dock's CSS seat: a height-only viewport
      // change (mobile URL bar show/hide) then moves dock and petals together
      // with zero re-layout, instead of detaching them for a frame and
      // rebuilding. y stays in top-down stage coordinates for the fold math.
      const stageH = stage.clientHeight || global.innerHeight;
      el.style.left = x + "px";
      el.style.bottom = stageH - y + "px";
      el.style.top = "auto";
      el.style.setProperty("--tx", "0px");
      el.style.setProperty("--ty", "0px");
      const dx = x - originX;
      const dy = y - originY;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      el.style.setProperty("--ax", (-uy).toFixed(3));
      el.style.setProperty("--ay", ux.toFixed(3));
      el.style.transformOrigin =
        (50 - ux * 50).toFixed(1) + "% " + (50 - uy * 50).toFixed(1) + "%";
    }

    function makeHex({
      cls,
      label,
      ariaLabel,
      labelSize,
      icon,
      iconOnly,
      tooltip,
    }) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hb-hex " + (cls || "");
      el.setAttribute("aria-label", ariaLabel || label || "Option");
      el.dataset.tooltip = tooltip || label || "";

      if (icon) {
        const glyph = document.createElement("span");
        glyph.className = "hb-glyph";
        glyph.innerHTML = iconMarkup(
          typeof icon === "function" ? icon() : icon
        );
        el.appendChild(glyph);
        el._glyphEl = glyph;
        el._iconName =
          typeof icon === "function" ? icon() : icon;
      }

      const span = document.createElement("span");
      span.className = "hb-label" + (iconOnly ? " hb-label-sr" : "");
      span.textContent = label || "";
      if (labelSize) span.dataset.size = labelSize;
      if (iconOnly) span.classList.add("sr-visual-hide");
      el.appendChild(span);
      el._labelEl = span;
      el._iconOnly = !!iconOnly;
      return el;
    }

    function setHexIcon(el, name) {
      if (!el) return;
      if (!el._glyphEl) {
        const glyph = document.createElement("span");
        glyph.className = "hb-glyph";
        el.insertBefore(glyph, el.firstChild);
        el._glyphEl = glyph;
      }
      if (el._iconName === name) return;
      el._iconName = name;
      el._glyphEl.innerHTML = iconMarkup(name);
    }

    function unfold(nodes) {
      const list = Array.from(nodes);
      if (!list.length) return;
      if (prefersReducedMotion()) {
        list.forEach((el) => {
          el.classList.remove("folded");
          el.classList.add("shown");
          el.style.transitionDelay = "0ms";
        });
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          let maxDelay = 0;
          list.forEach((el) => {
            const d = parseInt(el.dataset.delay, 10) || 0;
            if (d > maxDelay) maxDelay = d;
            el.style.transitionDelay = d + "ms";
            el.classList.remove("folded");
            el.classList.add("shown");
          });
          // The stagger delay must die with the fold — left inline, every
          // later transform transition (hover lift, dome) inherits it and
          // the menu feels like it reacts on a lag.
          setTimeout(() => {
            list.forEach((el) => {
              el.style.transitionDelay = "0ms";
            });
          }, maxDelay + 420);
        });
      });
    }

    // ---- Game helpers ----
    function invertGet(axis) {
      const inv =
        typeof game.getInvertDrag === "function"
          ? game.getInvertDrag()
          : { x: false, y: false };
      return axis === "y" ? !!inv.y : !!inv.x;
    }

    function invertIcon() {
      const x = invertGet("x");
      const y = invertGet("y");
      if (x && y) return "invertBoth";
      if (x) return "invertX";
      if (y) return "invertY";
      return "invertOff";
    }

    function invertLabel() {
      const x = invertGet("x");
      const y = invertGet("y");
      if (x && y) return "Invert: X + Y";
      if (x) return "Invert: X";
      if (y) return "Invert: Y";
      return "Invert: off";
    }

    function effectsLabel() {
      const button = document.querySelector(
        '#help-controls [data-ctl="effects"]'
      );
      const text = button ? button.textContent.trim() : "Effects";
      return text.replace(/^Effects\s*/i, "Effects: ");
    }

    function effectsIcon() {
      const label = effectsLabel().toLowerCase();
      if (label.includes("reduced")) return "effectsReduced";
      if (label.includes("full")) return "effectsFull";
      return "effectsAuto";
    }

    function currentMode() {
      return game.getState().flagMode ? "Flag" : "Dig";
    }
    function currentSize() {
      const d = game.getState().difficulty;
      const hit = SIZES.find((s) => s[0] === d);
      return hit ? hit[1] : "S";
    }
    function sizeIcon() {
      return "size" + currentSize();
    }
    function currentTheme() {
      const i =
        typeof game.getThemeIndex === "function" ? game.getThemeIndex() : 0;
      const t = THEMES[i];
      return t ? t.name : "Theme";
    }
    function currentStyle() {
      const st = game.getState() || {};
      const c = st.countStyle;
      const hit = COUNTS.find((x) => x[0] === c);
      const paint = hit ? hit[1] : "123";
      const relief = st.relief === "flush" ? "Flat" : "3D";
      return paint;
    }
    function shortLabel(s, n) {
      s = String(s || "");
      return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }

    function getAxes() {
      if (typeof game.getAppearance === "function") {
        const a = game.getAppearance();
        return (a && a.axes) || { field: "light", shell: "light", well: "dark" };
      }
      return { field: "light", shell: "light", well: "dark" };
    }


    function axisSwatch(axis, value) {
      // Mini palette for Bg / Shell / Well flip tiles
      const light = value !== "dark";
      if (axis === "field") {
        return {
          id: "classic-field",
          name: light ? "Bg light" : "Bg dark",
          covered: light ? "#ffffff" : "#000000",
          bg: light ? "#ffffff" : "#000000",
          coveredEdge: light ? "#000000" : "#ffffff",
          chrome: light ? "light" : "dark",
          flagFill: "#ff0000",
          label: light ? "#000000" : "#ffffff",
        };
      }
      if (axis === "shell") {
        return {
          id: "classic-shell",
          name: light ? "Shell light" : "Shell dark",
          covered: light ? "#ffffff" : "#000000",
          bg: "#888888",
          coveredEdge: light ? "#000000" : "#ffffff",
          chrome: "dark",
          flagFill: "#ff0000",
          label: light ? "#000000" : "#ffffff",
        };
      }
      // well
      return {
        id: "classic-well",
        name: light ? "Dug light" : "Dug dark",
        covered: light ? "#ffffff" : "#000000",
        bg: "#666666",
        coveredEdge: light ? "#000000" : "#ffffff",
        chrome: "dark",
        flagFill: "#ff0000",
        label: light ? "#000000" : "#ffffff",
      };
    }

    function indicatorId() {
      const cs = game.getState().countStyle;
      return INDICATORS.some(([id]) => id === cs) ? cs : "numerals";
    }

    function indicatorLabel() {
      const hit = INDICATORS.find(([id]) => id === indicatorId());
      return hit ? hit[1] : "123";
    }

    function cycleIndicators() {
      const i = INDICATORS.findIndex(([id]) => id === indicatorId());
      const [id, lab] = INDICATORS[(i + 1) % INDICATORS.length];
      game.setCountStyle(id, { syncSurface: false });
      announce("Indicators · " + lab);
    }

    function indicatorsAreHexes() {
      return game.getState().countStyle === "rings";
    }

    function toggleIndicatorForm() {
      const hexes = !indicatorsAreHexes();
      game.setCountStyle(hexes ? "rings" : "numerals", {
        syncSurface: false,
      });
      announce("Indicators · " + (hexes ? "Inner hex" : "Numerals"));
    }

    function indicatorFormIcon() {
      return indicatorsAreHexes() ? "countHex" : "countNumbers";
    }

    function seamsIcon() {
      return seamsOn() ? "seamsOn" : "seamsOff";
    }

    function depthIs3d() {
      return game.getState().relief !== "flush";
    }

    function toggleDepth() {
      const to3d = !depthIs3d();
      game.setRelief(to3d ? "extruded" : "flush");
      announce("Depth · " + (to3d ? "3D" : "Flush"));
    }

    function depthIcon() {
      return depthIs3d() ? "depth3d" : "depthFlat";
    }

    // One outcome-level Warning control owns the combinations that matter in
    // play. Seams and depth stop being independent menu concepts; they remain
    // implementation details of four deliberately legible warning styles.
    const WARNING_MODES = [
      {
        id: "numbers-depth",
        label: "Numbers · depth",
        icon: "warningNumbersDepth",
        count: "numerals",
        relief: "extruded",
        seams: true,
      },
      {
        id: "numbers-flat",
        label: "Numbers · flush",
        icon: "warningNumbersFlat",
        count: "numerals",
        relief: "flush",
        seams: false,
      },
      {
        id: "mono-depth",
        label: "Black + white · depth",
        icon: "warningMonoDepth",
        count: "rings",
        relief: "extruded",
        seams: true,
      },
      {
        id: "yellow-flat",
        label: "Yellow · no seams",
        icon: "warningYellowInk",
        count: "yellow",
        relief: "flush",
        seams: false,
      },
    ];

    function warningModeIndex() {
      const st = game.getState();
      if (st.countStyle === "yellow") return 3;
      if (st.countStyle === "rings") return 2;
      if (st.relief === "flush" && st.seams === false) return 1;
      return 0;
    }

    function warningMode() {
      return WARNING_MODES[warningModeIndex()];
    }

    function warningModeIcon() {
      return warningMode().icon;
    }

    function warningModeLabel() {
      return warningMode().label;
    }

    function cycleWarningMode() {
      const next = WARNING_MODES[(warningModeIndex() + 1) % WARNING_MODES.length];
      game.setCountStyle(next.count, { syncSurface: false });
      game.setRelief(next.relief);
      game.setSeams(next.seams);
      announce("Warnings · " + next.label);
    }

    /**
     * One light/dark cycle over the three appearance axes: light background +
     * light shell + dark interior, or the full inversion. The per-axis flips
     * below stay in the codebase deliberately — the three-tile Bg/Shell/Dug
     * concept is stashed in CHROME_HISTORY and the uxperiments harness for a
     * future variant, not deleted.
     */
    /**
     * Surface — relief + seams as one curated 3-state cycle (discuss verdict
     * 2026-08-10): 3D (extruded, seams) → Flat (flush, seams — the diagram
     * look) → Ink (flush, borderless). The fourth combination (extruded
     * borderless) was judged least legible; if a stored session is in it,
     * it displays as 3D and normalizes on the next tap.
     */
    function surfaceState() {
      const st = game.getState();
      if (st.relief !== "flush") return "3d";
      return st.seams === false ? "ink" : "flat";
    }

    function surfaceLabel() {
      return { "3d": "3D", flat: "Flat", ink: "Ink" }[surfaceState()];
    }

    function cycleSurface() {
      const next = { "3d": "flat", flat: "ink", ink: "3d" }[surfaceState()];
      game.setRelief(next === "3d" ? "extruded" : "flush");
      game.setSeams(next !== "ink");
      announce("Surface · " + { "3d": "3D", flat: "Flat", ink: "Ink" }[next]);
    }

    function seamsOn() {
      return game.getState().seams !== false;
    }

    function toggleSeams() {
      const next = !seamsOn();
      game.setSeams(next);
      announce("Seams · " + (next ? "On" : "Off"));
    }

    // Theme cycle for the flower: the two mono looks, then the reflection
    // materials — Stratosphere (light: sky environment map), Mercury
    // (analytic metal), Ion Storm (hybrid storm on a lagging frame), Aurora
    // (procedural curtains), Galaxy (environment dust), Gilded Ribbon
    // (surface ribbon on a lag), Heat Lightning (hybrid, pulsing). Glow /
    // Shell / Ink / Float / Card stay on the HUD cycle; Earth / Moon web-only.
    const FLOWER_THEMES = [
      "light",
      "dark",
      "stratosphere",
      "mercury",
      "ion-storm",
      "aurora",
      "galaxy",
      "gilded-ribbon",
      "heat-lightning",
    ];
    function themeIndexById(id) {
      return THEMES.findIndex((t) => t && t.id === id);
    }
    function currentThemeDef() {
      const i =
        typeof game.getThemeIndex === "function" ? game.getThemeIndex() : 0;
      return THEMES[i] || null;
    }
    function currentThemeLabel() {
      const t = currentThemeDef();
      return t ? t.name : "Theme";
    }
    function themeSwatchSpec(themeDef) {
      const t = themeDef || currentThemeDef();
      if (!t) return null;
      // Reflection themes are transparent on the canvas; swatch their
      // fallback field so the tile still reads as "dark liquid metal".
      if (t.reflectionSurface) {
        return {
          id: t.id,
          name: t.name,
          covered: t.fallbackBgGlow || "#3d484b",
          bg: t.fallbackBg || "#050708",
          coveredEdge: t.accent || "#eaf8ff",
          chrome: t.chrome || "dark",
          flagFill: t.flagFill || "#ff0000",
          label: t.label || "#ffffff",
        };
      }
      return t;
    }
    function cycleFlowerTheme() {
      const available = FLOWER_THEMES.map(themeIndexById).filter((i) => i >= 0);
      if (!available.length || typeof game.setThemeIndex !== "function") return;
      const cur =
        typeof game.getThemeIndex === "function" ? game.getThemeIndex() : 0;
      const at = available.indexOf(cur);
      const next = available[(at + 1) % available.length];
      game.setThemeIndex(next);
      announce("Theme · " + currentThemeLabel());
    }

    function cycleLightDark() {
      const toDark = getAxes().field !== "dark";
      if (typeof game.setAppearanceAxes === "function") {
        game.setAppearanceAxes(
          toDark
            ? { field: "dark", shell: "dark", well: "light" }
            : { field: "light", shell: "light", well: "dark" }
        );
      }
      announce("Appearance · " + (toDark ? "Dark" : "Light"));
    }

    function lightDarkIcon() {
      return getAxes().field === "dark" ? "dayNightDark" : "dayNightLight";
    }

    function flipAxis(axis) {
      const axes = getAxes();
      const next = Object.assign({}, axes);
      next[axis] = axes[axis] === "dark" ? "light" : "dark";
      if (typeof game.setAppearanceAxes === "function") {
        game.setAppearanceAxes(next);
      }
      announce(
        (axis === "field" ? "Background" : axis === "shell" ? "Covered" : "Dug") +
          " · " +
          next[axis]
      );
    }




    function cycleMode() {
      const on = !!game.getState().flagMode;
      game.setFlagMode(!on);
      paintDock();
      announce("Mode · " + (!on ? "Flag" : "Dig"));
    }

    function cycleSize() {
      const d = game.getState().difficulty;
      let i = SIZES.findIndex((s) => s[0] === d);
      if (i < 0) i = 1;
      const next = (i + 1) % SIZES.length;
      game.setSize(SIZES[next][0]);
      announce("Size · " + SIZES[next][1]);
    }



    function cycleCount() {
      const c = game.getState().countStyle;
      let i = COUNTS.findIndex((x) => x[0] === c);
      if (i < 0) i = 0;
      const next = (i + 1) % COUNTS.length;
      game.setCountStyle(COUNTS[next][0], { syncSurface: false });
      announce("Counts · " + COUNTS[next][1]);
    }

    function doReset() {
      if (typeof game.reset === "function") game.reset();
      else {
        const b = document.getElementById("reset-btn");
        if (b) b.click();
      }
      announce("Board reset");
      if (state.phase === "open" || state.phase === "rising") collapse();
    }

    function doUndo() {
      if (typeof game.undo === "function" && game.undo()) {
        announce("Move undone");
        return;
      }
      const b = document.getElementById("banner-undo-btn");
      if (b && !b.hidden) {
        b.click();
        announce("Move undone");
        return;
      }
      announce("Nothing to undo");
    }

    function cycleInvert() {
      const b = document.querySelector('#help-controls [data-ctl="invert"]');
      if (!b) return;
      b.click();
      announce(b.textContent || "Invert changed");
    }

    function cycleEffects() {
      const b = document.querySelector('#help-controls [data-ctl="effects"]');
      if (!b) return;
      b.click();
      announce(b.textContent || "Effects changed");
    }

    function doHelp() {
      const b = document.getElementById("help-btn");
      if (b) b.click();
      if (state.phase === "open" || state.phase === "rising") collapse();
    }

    function doHome() {
      // The native bundle has no parent to climb to — leaving the payload
      // root strands the WebView with no way back. The app build points this
      // at its own sphere; on the web "../" is the games index as before.
      global.location.href = global.HEXSWEEPER_HOME_HREF || "../";
    }

    function categories() {
      // Legacy cycle primaries remain for contextual/archive variants. The
      // current center and bottom blooms share the grouped menu assembled
      // below; only their geometry and permanent dock actions differ.
      const all = [
        {
          id: "lightdark",
          label: () => (getAxes().field === "dark" ? "Dark" : "Light"),
          icon: lightDarkIcon,
          iconOnly: false,
          aria: () =>
            "Appearance: " +
            (getAxes().field === "dark" ? "dark" : "light") +
            ". Activate to toggle.",
          cycle: cycleLightDark,
        },
        {
          id: "size",
          label: () => currentSize(),
          icon: "size",
          iconOnly: false,
          badge: true,
          aria: () =>
            "Size: " + currentSize() + ". Activate to cycle board size.",
          cycle: cycleSize,
        },
        {
          id: "surface",
          label: () => surfaceLabel(),
          icon: "style",
          iconOnly: false,
          labelSize: "sm",
          aria: () =>
            "Surface: " + surfaceLabel() + ". Activate to cycle 3D, Flat, Ink.",
          cycle: cycleSurface,
        },
        {
          id: "indicators",
          label: () => indicatorLabel(),
          // Stable glyph; the label carries which style is live.
          icon: "indicators",
          iconOnly: false,
          labelSize: "sm",
          aria: () =>
            "Indicators: " +
            indicatorLabel() +
            ". Activate to cycle numerals, mark, rings.",
          cycle: cycleIndicators,
        },
      ];
      if (SHARED_MENU) {
        const menu = [
          {
            id: "theme",
            label: () => currentThemeLabel(),
            swatch: () => themeSwatchSpec(),
            iconOnly: true,
            aria: () =>
              "Theme: " +
              currentThemeLabel() +
              ". Activate to cycle Light, Dark, and the reflection materials: Stratosphere, Mercury, Ion Storm, Aurora, Galaxy, Gilded Ribbon, Heat Lightning.",
            cycle: cycleFlowerTheme,
          },
          {
            id: "warnings",
            label: warningModeLabel,
            icon: warningModeIcon,
            iconOnly: true,
            aria: () =>
              "Warning style: " + warningModeLabel() + ". Activate to cycle.",
            cycle: cycleWarningMode,
          },
          {
            id: "undo",
            label: "Undo",
            icon: "undo",
            iconOnly: true,
            aria: () => "Undo last move",
            cycle: doUndo,
          },
          {
            id: "flagmode",
            label: "Flag",
            icon: "flag",
            iconOnly: true,
            aria: () =>
              game.getState().flagMode
                ? "Flag mode on. Activate for dig mode."
                : "Flag mode off. Activate for flag mode.",
            cycle: cycleMode,
          },
          {
            id: "invert",
            label: invertLabel,
            icon: invertIcon,
            iconOnly: true,
            aria: () => invertLabel() + ". Activate to cycle.",
            cycle: cycleInvert,
          },
          {
            id: "size",
            label: () => "Size " + currentSize(),
            icon: sizeIcon,
            iconOnly: true,
            aria: () =>
              "Board size " + currentSize() + ". Activate to cycle.",
            cycle: cycleSize,
          },
        ];
        // Undo and Flag live beside the raised seed in bottom variants. Reset
        // takes Undo's former crown seat, preserving seven distinct actions.
        if (FIXED_CENTER) return menu;
        const reset = {
          id: "reset",
          label: "Reset",
          icon: "reset",
          iconOnly: true,
          aria: () => "Restart game",
          cycle: doReset,
        };
        return menu
          .filter((category) => category.id !== "flagmode")
          .map((category) => (category.id === "undo" ? reset : category));
      }
      if (DOCK_CONTEXT) {
        // The dock is hidden in both center variants. Home and Flag occupy
        // the west/east seats; Reset is promoted to the middle tile.
        all.push(
          {
            id: "home",
            label: "Home",
            icon: "home",
            iconOnly: true,
            aria: () => "Return to Hexsweeper home",
            cycle: () => doHome(),
          },
          {
            id: "flagmode",
            label: "Flag",
            icon: "flag",
            iconOnly: true,
            aria: () =>
              game.getState().flagMode
                ? "Flag mode on. Activate for dig mode."
                : "Flag mode off. Activate for flag mode.",
            cycle: cycleMode,
          }
        );
      }
      return all;
    }

    // ---- State ----
    // phase: closed | rising | open | falling
    const state = {
      phase: "closed",
      active: null,
    };
    let statsTimer = null;
    let ignoreOutsideUntil = 0;
    let phaseTimer = null;
    let hoverCloseTimer = null;
    let dockBtn = null; // center menu / close
    let dockResetBtn = null;
    let dockFlagBtn = null;
    let facePatchIndices = null; // seven tile indices the face menu inhabits
    let faceActions = []; // { el, faceIndex } for live relayout on rotation
    let faceMenuLive = false; // true while the current open menu is on the sphere
    let fanOpen = false; // theme swatches fanned across ring 2 of the patch
    let dockHelpBtn = null; // corner seat, lower right
    let cornerMenuBtn = null; // corner seat, lower left (center-flower variants)
    let centerActionBtn = null;
    let lastFocus = null;

    function announce(msg) {
      live.textContent = msg || "";
    }

    function isOpenish() {
      return state.phase === "open" || state.phase === "rising";
    }

    function setPhase(phase) {
      state.phase = phase;
      root.dataset.phase = phase;
      root.dataset.open = phase === "open" || phase === "rising" ? "true" : "false";
      if (phase === "open" && state.active) root.dataset.branch = state.active;
      else if (phase !== "open") delete root.dataset.branch;
      if (phase !== "open") delete root.dataset.dock;
      document.body.classList.toggle(
        "hex-bloom-open",
        phase === "open" || phase === "rising" || phase === "falling"
      );
      paintDock();
    }

    function paintDock() {
      if (!dockBtn) return;
      const open =
        state.phase === "open" ||
        state.phase === "rising" ||
        state.phase === "falling";
      if (open) {
        // SVG, not a font ×: the mark shares the dock's true optical center
        // and stroke family with Reset and Flag at every tile size.
        setHexIcon(dockBtn, "close");
        if (dockBtn._glyphEl) dockBtn._glyphEl.hidden = false;
        dockBtn._labelEl.textContent = "Close";
        dockBtn._labelEl.classList.add("sr-visual-hide", "hb-label-sr");
        dockBtn.setAttribute("aria-label", "Close menu");
        dockBtn.setAttribute("aria-expanded", "true");
      } else {
        setHexIcon(dockBtn, "gear");
        if (dockBtn._glyphEl) dockBtn._glyphEl.hidden = false;
        dockBtn._labelEl.textContent = "Menu";
        dockBtn._labelEl.classList.add("sr-visual-hide", "hb-label-sr");
        dockBtn.setAttribute("aria-label", "Open game menu");
        dockBtn.setAttribute("aria-expanded", "false");
      }
      if (cornerMenuBtn) {
        setHexIcon(cornerMenuBtn, open ? "close" : "gear");
        cornerMenuBtn.setAttribute("aria-label", open ? "Close menu" : "Open game menu");
        cornerMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
        tip(cornerMenuBtn, open ? "Close" : "Menu");
      }
      const sideActionsShown = root.dataset.bottomSeed !== "true" || open;
      if (dockResetBtn) {
        dockResetBtn.hidden = false;
        dockResetBtn.setAttribute("aria-hidden", sideActionsShown ? "false" : "true");
        dockResetBtn.tabIndex = sideActionsShown ? 0 : -1;
      }
      if (dockHelpBtn) {
        dockHelpBtn.hidden = false;
        dockHelpBtn.setAttribute("aria-hidden", "false");
      }
      if (dockFlagBtn) {
        // Mirrors game state — keyboard F and the bloom's Dig/Flag tile land
        // here too via their paintDock calls.
        const on = !!(game.getState() || {}).flagMode;
        dockFlagBtn.setAttribute("aria-pressed", on ? "true" : "false");
        // is-flag-icon turns the glyph red; face stays quiet either way.
        dockFlagBtn.classList.toggle("is-flag-icon", on);
        dockFlagBtn.setAttribute(
          "aria-label",
          on ? "Flag mode on. Activate for dig mode." : "Flag mode. Activate to flag digs."
        );
        dockFlagBtn.setAttribute("aria-hidden", sideActionsShown ? "false" : "true");
        dockFlagBtn.tabIndex = sideActionsShown ? 0 : -1;
      }
    }

    function readStats() {
      const st = game.getState() || {};
      const faceN =
        (st.cells && st.cells.length) ||
        ({ xsmall: 162, easy: 362, medium: 642, hard: 1002, xlarge: 1442 }[
          st.difficulty
        ] || 362);
      let planned = st.mineCount | 0;
      if (planned <= 0 && typeof game.mineTargetForDifficulty === "function") {
        planned = game.mineTargetForDifficulty(faceN) | 0;
      }
      if (planned <= 0) planned = Math.max(1, Math.round(faceN * 0.17));
      const flags = st.flagsPlaced | 0;
      const left = Math.max(
        0,
        (st.mineCount > 0 ? st.mineCount : planned) - flags
      );
      const time = Math.max(0, st.timeElapsed | 0);
      return { left, time };
    }

    function paintStats() {
      const { left, time } = readStats();
      if (hubMines) hubMines.textContent = String(left);
      if (hubTime) hubTime.textContent = String(time);
      const legacyLeft = document.getElementById("stats-mines");
      const legacyTime = document.getElementById("stats-time");
      if (legacyLeft) legacyLeft.textContent = String(left).padStart(2, "0");
      if (legacyTime) legacyTime.textContent = String(time).padStart(3, "0") + "s";
    }

    function clearStage() {
      hideTooltip();
      stage.querySelectorAll(".hb-hex").forEach((n) => n.remove());
      centerActionBtn = null;
      facePatchIndices = null;
      faceActions = [];
      fanOpen = false;
    }

    function removeSubmenu() {
      stage.querySelectorAll(".hb-hex.is-sub").forEach((el) => {
        el.style.transitionDelay = "0ms";
        el.classList.remove("shown");
        el.classList.add("folded");
        const drop = () => el.remove();
        el.addEventListener("transitionend", drop, { once: true });
        setTimeout(drop, foldMs());
      });
    }

    function addSubmenu(dirIndex, cat) {
      const { HEX } = tileMetrics();
      const { cx, cy } = centerXY();
      const dir =
        (FIXED_CENTER ? FIXED_CENTER_SLOTS[dirIndex] : null) ||
        (DOCK_CONTEXT ? CENTER_SLOTS[dirIndex] : null) ||
        (DEFAULT_BLOOM ? DEFAULT_BLOOM_SLOTS[dirIndex] : null) ||
        PRIMARY_SLOTS[dirIndex] ||
        DIRECTIONS[dirIndex];
      const p = hexToPixel(dir.q, dir.r, HEX);
      const px = cx + p.x;
      const py = cy + p.y;
      const items = cat.sub();
      const offsets = FIXED_CENTER
        ? cat.id === "display"
          ? [
              { q: 0, r: -1 },
              { q: 1, r: -1 },
              { q: 1, r: 0 },
            ]
          : cat.id === "settings"
            ? [
                { q: 1, r: 0 },
                { q: 0, r: 1 },
                { q: -1, r: 1 },
              ]
          : leafOffsets(dirIndex, items.length)
        : DEFAULT_BLOOM && cat.id === "display"
          ? [
              { q: -1, r: 0 },
              { q: 0, r: -1 },
              { q: 1, r: -1 },
            ]
          : DEFAULT_BLOOM && cat.id === "settings"
            ? [
                { q: 1, r: 0 },
                { q: 1, r: -1 },
                { q: 0, r: -1 },
              ]
          : leafOffsets(dirIndex, items.length);

      items.forEach((item, j) => {
        const off = offsets[j] || DIRECTIONS[dirIndex];
        const o = hexToPixel(off.q, off.r, HEX);
        const isSwatch = !!item.themeSwatch;
        const itemIcon =
          typeof item.icon === "function" ? item.icon() : item.icon;
        const itemLabel =
          typeof item.label === "function" ? item.label() : item.label;
        const itemAria =
          typeof item.aria === "function"
            ? item.aria()
            : cat.id + ": " + itemLabel;
        const itemTooltip = item.tooltip
          ? typeof item.tooltip === "function"
            ? item.tooltip()
            : item.tooltip
          : itemLabel;
        const el = makeHex({
          cls:
            "is-sub" +
            (item.chosen && item.chosen() ? " is-chosen" : "") +
            (itemIcon ? " has-icon" : "") +
            (isSwatch ? " is-theme-swatch" : ""),
          label: itemLabel,
          labelSize: item.labelSize,
          ariaLabel: itemAria,
          tooltip: itemTooltip,
          icon: isSwatch ? null : itemIcon,
          iconOnly: isSwatch
            ? true
            : !!itemIcon && item.iconOnly !== false && !item.labelKeep,
        });
        if (isSwatch) {
          const sw = themeSwatchVars(item.themeSwatch);
          el.style.setProperty("--theme-fill", sw.fill);
          el.style.setProperty("--theme-edge", sw.edge);
          el.style.setProperty("--theme-field", sw.field);
          el.style.setProperty("--theme-ink", sw.ink);
          el.style.setProperty("--theme-accent", sw.accent);
          // Tiny field-circle in the middle — same grammar as the Theme control
          const dot = document.createElement("span");
          dot.className = "hb-theme-dot";
          dot.setAttribute("aria-hidden", "true");
          el.appendChild(dot);
        }
        // Flag leaf paints red like in-game flags
        if (itemIcon === "flag") el.classList.add("is-flag-icon");
        if (itemIcon === "dig") el.classList.add("is-dig-icon");
        // Subs with icons still keep short labels when useful
        if (itemIcon && itemLabel && !item.iconOnly && !isSwatch) {
          el.classList.add("is-sub-icon-label");
          if (el._labelEl)
            el._labelEl.classList.remove("sr-visual-hide", "hb-label-sr");
        }
        el.dataset.cat = cat.id;
        el.dataset.sub = item.id;
        place(el, px + o.x, py + o.y, px, py);
        el.classList.add("folded");
        el.dataset.delay = String(j * 28);
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof item.run === "function") item.run();
          const fresh = cat.sub().find((candidate) => candidate.id === item.id);
          if (fresh) {
            const freshLabel =
              typeof fresh.label === "function" ? fresh.label() : fresh.label;
            const freshAria =
              typeof fresh.aria === "function"
                ? fresh.aria()
                : cat.id + ": " + freshLabel;
            const freshTooltip = fresh.tooltip
              ? typeof fresh.tooltip === "function"
                ? fresh.tooltip()
                : fresh.tooltip
              : freshLabel;
            el.setAttribute("aria-label", freshAria);
            el.dataset.tooltip = freshTooltip;
            if (el._labelEl) el._labelEl.textContent = freshLabel;
            const freshIcon =
              typeof fresh.icon === "function" ? fresh.icon() : fresh.icon;
            if (freshIcon) setHexIcon(el, freshIcon);
            if (tooltipTarget === el && !tooltip.hidden) showTooltip(el);
          }
          refreshChosen(cat.id);
          refreshPrimaryLabels();
        });
        stage.appendChild(el);
      });
      unfold(stage.querySelectorAll(".hb-hex.is-sub.folded"));
    }

    function refreshChosen(catId) {
      const cat = categories().find((c) => c.id === catId);
      if (!cat) return;
      const items = cat.sub();
      stage
        .querySelectorAll('.hb-hex.is-sub[data-cat="' + catId + '"]')
        .forEach((el) => {
          const item = items.find((it) => it.id === el.dataset.sub);
          el.classList.toggle(
            "is-chosen",
            !!(item && item.chosen && item.chosen())
          );
        });
    }

    function applyPrimarySwatch(el, spec) {
      const sw = themeSwatchVars(spec);
      el.style.setProperty("--theme-fill", sw.fill);
      el.style.setProperty("--theme-edge", sw.edge);
      el.style.setProperty("--theme-field", sw.field);
      el.style.setProperty("--theme-ink", sw.ink);
      el.style.setProperty("--theme-accent", sw.accent);
      if (!el.querySelector(".hb-theme-dot")) {
        const dot = document.createElement("span");
        dot.className = "hb-theme-dot";
        dot.setAttribute("aria-hidden", "true");
        el.appendChild(dot);
      }
    }

    function refreshPrimaryLabels() {
      const cats = categories();
      stage.querySelectorAll(".hb-hex.is-primary").forEach((el) => {
        const cat = cats.find((c) => c.id === el.dataset.cat);
        if (!cat) return;
        const lab = typeof cat.label === "function" ? cat.label() : cat.label;
        const aria = typeof cat.aria === "function" ? cat.aria() : lab;
        el.setAttribute("aria-label", aria);
        el.dataset.tooltip = lab;
        if (cat.icon) {
          const name =
            typeof cat.icon === "function" ? cat.icon() : cat.icon;
          setHexIcon(el, name);
          el.classList.toggle(
            "is-flag-icon",
            name === "flag" && !(DOCK_CENTER && cat.id === "flagmode")
          );
          el.classList.toggle("is-dig-icon", name === "dig");
          el.classList.toggle("is-theme-icon", name === "theme");
        }
        if (DOCK_CENTER && cat.id === "flagmode") {
          const on = !!game.getState().flagMode;
          el.classList.toggle("is-mode-active", on);
          el.setAttribute("aria-pressed", on ? "true" : "false");
        }
        // Axis tiles repaint their swatch as the look changes under them.
        if (cat.swatch) {
          applyPrimarySwatch(
            el,
            typeof cat.swatch === "function" ? cat.swatch() : cat.swatch
          );
        }
        // Size keeps a visible letter badge; other primaries are icon-only
        if (el._labelEl) {
          if (el.classList.contains("hb-face-action")) {
            // Face tiles carry a visible short label.
            showFaceLabel(el, faceLabel(cat));
          } else if (SHARED_MENU) {
            el._labelEl.textContent = lab;
            el._labelEl.classList.add("sr-visual-hide", "hb-label-sr");
            el.classList.remove("has-badge");
          } else if (cat.badge) {
            el._labelEl.textContent = lab;
            el._labelEl.classList.remove("sr-visual-hide", "hb-label-sr");
            el.classList.add("has-badge");
          } else if (cat.iconOnly) {
            el._labelEl.textContent = lab;
            el._labelEl.classList.add("sr-visual-hide", "hb-label-sr");
          } else {
            el._labelEl.textContent = lab;
          }
        }
        if (tooltipTarget === el && !tooltip.hidden) showTooltip(el);
      });
      // Dock menu is the close control while open
      if (dockBtn && state.phase === "open") {
        dockBtn._labelEl.textContent = "Close";
        dockBtn.setAttribute("aria-label", "Close menu");
      }
    }

    function clearActive() {
      stage
        .querySelectorAll(".hb-hex.is-active")
        .forEach((e) => e.classList.remove("is-active"));
      stage
        .querySelectorAll('.hb-hex.is-primary[aria-haspopup="true"]')
        .forEach((e) => e.setAttribute("aria-expanded", "false"));
      removeSubmenu();
      state.active = null;
      delete root.dataset.branch;
    }

    function toggleCategory(id, dirIndex) {
      const cat = categories().find((c) => c.id === id);
      const el = stage.querySelector(
        '.hb-hex.is-primary[data-cat="' + id + '"]'
      );
      if (!cat || !el) return;
      if (faceMenuLive && id === "theme") {
        toggleThemeFan();
        el.setAttribute("aria-expanded", fanOpen ? "true" : "false");
        return;
      }

      // Cycle primaries: one click flips state, no nested bloom.
      if (typeof cat.cycle === "function") {
        clearActive();
        cat.cycle();
        refreshPrimaryLabels();
        if (faceMenuLive && cat.id === "size") {
          // A new board has new faces; re-seat the menu on the fresh front patch.
          requestAnimationFrame(() => {
            if (state.phase !== "open") return;
            renderBloom({ petals: true });
            bloomPetals();
          });
        }
        return;
      }

      if (state.active === id) {
        clearActive();
        announce("Menu open");
        return;
      }
      clearActive();
      state.active = id;
      root.dataset.branch = id;
      el.classList.add("is-active");
      el.setAttribute("aria-expanded", "true");
      addSubmenu(dirIndex, cat);
      announce(typeof cat.aria === "function" ? cat.aria() : cat.id);
    }

    function renderDockOnly() {
      dock.textContent = "";
      dock.className = "hex-bloom-dock";
      dock.setAttribute("role", "toolbar");
      dock.setAttribute("aria-label", "Game chrome");

      // Undo and Flag form the action keel beside the raised black seed.
      // Reset remains available in the settings crown above.
      dockResetBtn = makeHex({
        cls: "is-dock is-dock-side is-dock-reset",
        label: "",
        icon: "undo",
        iconOnly: true,
        ariaLabel: "Undo move",
      });
      tip(dockResetBtn, "Undo");
      dockResetBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ignoreOutsideUntil = Date.now() + 250;
        doUndo();
      });

      // Menu — center, primary (opens bloom / closes when open)
      dockBtn = makeHex({
        cls: "is-dock is-dock-menu",
        label: "Menu",
        icon: "gear",
        iconOnly: true,
        ariaLabel: "Open game menu",
      });
      dockBtn.id = "hex-bloom-seed";
      dockBtn.setAttribute("aria-haspopup", "dialog");
      dockBtn.setAttribute("aria-controls", "hex-bloom-stage");
      dockBtn.setAttribute("aria-expanded", "false");
      tip(dockBtn, "Menu");
      dockBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ignoreOutsideUntil = Date.now() + 250;
        if (state.phase === "open" || state.phase === "rising") collapse();
        else if (state.phase === "closed") expand();
      });
      if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
        dockBtn.addEventListener("pointerenter", () => {
          if (state.phase === "closed") expand();
        });
      }

      // Flag — right of Menu: dig/flag mode without opening the bloom.
      // On mobile there is no right-click; this is the most-flipped switch
      // in the game and it was two taps deep.
      dockFlagBtn = makeHex({
        cls: "is-dock is-dock-side is-dock-flag",
        label: "",
        icon: "flag",
        iconOnly: true,
        ariaLabel: "Flag mode",
      });
      tip(dockFlagBtn, "Flag mode");
      dockFlagBtn.setAttribute("aria-pressed", "false");
      dockFlagBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ignoreOutsideUntil = Date.now() + 250;
        const on = !game.getState().flagMode;
        game.setFlagMode(on);
        paintDock();
        if (state.phase === "open") refreshPrimaryLabels();
        announce(on ? "Flag mode" : "Dig mode");
      });

      // Help — corner seat, lower right
      helpCorner.textContent = "";
      dockHelpBtn = makeHex({
        cls: "is-dock is-dock-help",
        label: "",
        icon: "help",
        iconOnly: true,
        ariaLabel: "Help",
      });
      tip(dockHelpBtn, "Help");
      dockHelpBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ignoreOutsideUntil = Date.now() + 250;
        doHelp();
      });
      helpCorner.appendChild(dockHelpBtn);

      if (menuCorner) {
        cornerMenuBtn = makeHex({
          cls: "is-dock is-dock-menu-corner",
          label: "",
          icon: "gear",
          iconOnly: true,
          ariaLabel: "Open game menu",
        });
        tip(cornerMenuBtn, "Menu");
        cornerMenuBtn.setAttribute("aria-haspopup", "dialog");
        cornerMenuBtn.setAttribute("aria-controls", "hex-bloom-stage");
        cornerMenuBtn.setAttribute("aria-expanded", "false");
        cornerMenuBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ignoreOutsideUntil = Date.now() + 250;
          if (state.phase === "open" || state.phase === "rising") collapse();
          else if (state.phase === "closed") expand();
        });
        menuCorner.appendChild(cornerMenuBtn);
      }

      dock.appendChild(dockResetBtn);
      dock.appendChild(dockBtn);
      dock.appendChild(dockFlagBtn);
      paintDock();
    }

    /** One flower primary — shared by the ring layout and the face menu. */
    function makePrimaryTile(cat, i, extraCls) {
        const lab = typeof cat.label === "function" ? cat.label() : cat.label;
        const iconName =
          typeof cat.icon === "function" ? cat.icon() : cat.icon;
        const swatch =
          typeof cat.swatch === "function" ? cat.swatch() : cat.swatch;
        const showBadge = !!cat.badge && !SHARED_MENU;
        const flagModeActive =
          DOCK_CENTER && cat.id === "flagmode" && !!game.getState().flagMode;
        const el = makeHex({
          cls:
            "is-primary " +
            (extraCls || "") +
            " cat-" +
            cat.id +
            (state.active === cat.id ? " is-active" : "") +
            (showBadge ? " has-badge" : "") +
            (iconName === "flag" && !(DOCK_CENTER && cat.id === "flagmode") ? " is-flag-icon" : "") +
            (DOCK_CENTER && cat.id === "flagmode" ? " is-flag-toggle" : "") +
            (flagModeActive ? " is-mode-active" : "") +
            (iconName === "dig" ? " is-dig-icon" : "") +
            (iconName === "theme" ? " is-theme-icon" : "") +
            (swatch ? " is-theme-swatch" : ""),
          label: lab,
          labelSize: cat.labelSize,
          ariaLabel: typeof cat.aria === "function" ? cat.aria() : lab,
          icon: swatch ? null : iconName,
          iconOnly: SHARED_MENU || swatch ? true : !!cat.iconOnly && !showBadge,
        });
        if (swatch) applyPrimarySwatch(el, swatch);
        if (showBadge && el._labelEl) {
          el._labelEl.classList.remove("sr-visual-hide", "hb-label-sr");
        }
        if (DOCK_CENTER && cat.id === "flagmode") {
          el.setAttribute("aria-pressed", flagModeActive ? "true" : "false");
        }
        el.dataset.cat = cat.id;
        el.dataset.index = String(i);
        if (cat.sub) {
          el.setAttribute("aria-haspopup", "true");
          el.setAttribute("aria-expanded", String(state.active === cat.id));
        } else {
          el.removeAttribute("aria-haspopup");
          el.setAttribute("aria-expanded", "false");
        }
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ignoreOutsideUntil = Date.now() + 200;
          toggleCategory(cat.id, i);
        });
        if (hoverBloomEnabled && cat.hoverSub) {
          el.addEventListener("pointerenter", () => {
            clearTimeout(hoverCloseTimer);
            if (state.active !== cat.id) toggleCategory(cat.id, i);
          });
        }
      return el;
    }

    // ---- Face menu: the flower on the sphere's own faces ----

    function faceLabel(cat) {
      if (cat.id === "theme") {
        const t = currentThemeDef();
        return (t && (FACE_SHORT_THEME[t.id] || t.name)) || "Theme";
      }
      if (cat.id === "size") return "Size " + currentSize();
      if (cat.id === "warnings") return "Warn";
      if (cat.id === "flagmode") return "Flag";
      if (cat.id === "invert") return "Invert";
      if (cat.id === "undo") return "Undo";
      const lab = typeof cat.label === "function" ? cat.label() : cat.label;
      return String(lab || cat.id);
    }

    function showFaceLabel(el, text) {
      if (!el._labelEl) return;
      el._labelEl.textContent = text;
      el._labelEl.classList.remove("sr-visual-hide", "hb-label-sr");
      el._labelEl.classList.add("hb-face-label");
    }

    function currentFacePatch() {
      if (typeof game.getMenuPatch !== "function") return null;
      return facePatchIndices
        ? game.getMenuPatch({ indices: facePatchIndices })
        : game.getMenuPatch();
    }

    /** Ring faces matched to the fixed seats by angle, so Theme is always NW. */
    function orderProjectedRing(patch) {
      const available = patch.ring.slice();
      return FIXED_CENTER_SLOTS.map((slot) => {
        const target = hexToPixel(slot.q, slot.r, 1);
        const targetAngle = Math.atan2(target.y, target.x);
        let bestIndex = 0;
        let bestDelta = Infinity;
        available.forEach((face, index) => {
          const angle = Math.atan2(
            face.center.y - patch.center.center.y,
            face.center.x - patch.center.center.x
          );
          const delta = Math.abs(
            Math.atan2(Math.sin(angle - targetAngle), Math.cos(angle - targetAngle))
          );
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIndex = index;
          }
        });
        return available.splice(bestIndex, 1)[0];
      });
    }

    /**
     * Scale factor that keeps a face tile at least FACE_MIN_TILE across. The
     * whole patch scales about the centre face's centroid — a similarity
     * transform — so seven projected polygons stay a seamless cluster while
     * growing past their faces on large boards.
     */
    function facePatchScale(patch) {
      const b = patch.center.boundary;
      const xs = b.map((pt) => pt.x);
      const width = Math.max(...xs) - Math.min(...xs);
      if (!width) return 1;
      // With the fan open the sphere is deliberately zoomed less so ring 2
      // fits; do not scale that back up.
      const floor = fanOpen ? Math.min(FACE_MIN_TILE, FAN_FOCUS_MIN - 4) : FACE_MIN_TILE;
      return Math.max(1, Math.min(FACE_MAX_SCALE, floor / width));
    }

    function placeProjectedFace(el, face, patch, canvasRect, scale) {
      const ox = patch.center.center.x;
      const oy = patch.center.center.y;
      const points = face.boundary.map((point) => ({
        x: canvasRect.left + ox + (point.x - ox) * scale,
        y: canvasRect.top + oy + (point.y - oy) * scale,
      }));
      const minX = Math.min(...points.map((point) => point.x));
      const maxX = Math.max(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxY = Math.max(...points.map((point) => point.y));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const polygon = points
        .map(
          (point) =>
            (((point.x - minX) / width) * 100).toFixed(2) +
            "% " +
            (((point.y - minY) / height) * 100).toFixed(2) +
            "%"
        )
        .join(",");
      el.style.left = minX.toFixed(1) + "px";
      el.style.top = minY.toFixed(1) + "px";
      el.style.bottom = "auto";
      el.style.width = width.toFixed(1) + "px";
      el.style.height = height.toFixed(1) + "px";
      el.style.setProperty("--face-poly", "polygon(" + polygon + ")");
      el.style.setProperty("--face-icon", Math.max(18, Math.min(32, height * 0.30)).toFixed(1) + "px");
      el.style.setProperty("--face-label", Math.max(11, Math.min(13, height * 0.16)).toFixed(1) + "px");
    }

    /** Zoom goal for the on-sphere menu; the fan needs ring 2 to fit on screen. */
    function focusFaceMin() {
      if (!fanOpen) return FACE_FOCUS_PX;
      const w = stage.clientWidth || global.innerWidth;
      const h = stage.clientHeight || global.innerHeight;
      // Ring 2 spans ~5 faces across; keep it inside the short viewport edge.
      return Math.max(FAN_FOCUS_MIN, Math.min(FACE_FOCUS_PX, (Math.min(w, h) - 48) / 5.2));
    }
    function focusMenu() {
      if (!faceMenuLive || !facePatchIndices) return;
      if (typeof game.focusPatch === "function") {
        game.focusPatch({ indices: facePatchIndices, faceMin: focusFaceMin() });
      }
    }

    /**
     * Theme fan: the second ring of faces around the patch (neighbours of the
     * ring, minus the patch) become swatch tiles — one per flower theme,
     * clockwise from the top. Tapping one applies it; the rest of the sphere
     * previews it live around the fan. Fan tiles are re-projected with the
     * menu on every camera move.
     */
    function ringTwoFaces(patch) {
      const st = game.getState();
      const tiles = st.tiles || [];
      const inPatch = new Set(patch.indices);
      const seen = new Set();
      const out = [];
      patch.ring.forEach((face) => {
        const t = tiles[face.index];
        (t && t.neighborIndices || []).forEach((k) => {
          if (inPatch.has(k) || seen.has(k)) return;
          seen.add(k);
          out.push(k);
        });
      });
      const cx = patch.center.center.x;
      const cy = patch.center.center.y;
      const projected = out
        .filter((k) => tiles[k] && tiles[k].boundary && tiles[k].boundary.length === 6)
        .map((k) => Object.assign(game.projectTile(tiles[k], st.rotY, st.rotX), { index: k }))
        .filter((f) => f.z > 0.12)
        .sort((a, b) => {
          const aa = Math.atan2(a.center.y - cy, a.center.x - cx) + Math.PI / 2;
          const bb = Math.atan2(b.center.y - cy, b.center.x - cx) + Math.PI / 2;
          const na = (aa + Math.PI * 2) % (Math.PI * 2);
          const nb = (bb + Math.PI * 2) % (Math.PI * 2);
          return na - nb;
        });
      return projected;
    }
    function luminanceOf(color) {
      const m = String(color || "").match(/#([0-9a-f]{6})/i);
      if (!m) {
        const rgba = String(color || "").match(/rgba?\(([^)]+)\)/i);
        if (!rgba) return 0;
        const [r, g, b] = rgba[1].split(",").map((v) => parseFloat(v));
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      }
      const n = parseInt(m[1], 16);
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    }
    function fanTheme(face) {
      // Same shape as getMenuPatch faces so placeProjectedFace can use them.
      return { index: face.index, z: face.z, center: face.center, boundary: face.boundary };
    }
    function renderThemeFan() {
      const patch = currentFacePatch();
      const canvas = document.getElementById("gameCanvas");
      if (!patch || !canvas) return false;
      const faces = ringTwoFaces(patch);
      const ids = FLOWER_THEMES.map((id) => [id, themeIndexById(id)]).filter(([, i]) => i >= 0);
      if (faces.length < 6) return false;
      const canvasRect = canvas.getBoundingClientRect();
      const scale = facePatchScale(patch);
      const current = currentThemeDef();
      ids.slice(0, faces.length).forEach(([id, index], j) => {
        const t = THEMES[index];
        const face = fanTheme(faces[j]);
        const el = makeHex({
          cls: "is-sub is-theme-swatch hb-face-action hb-face-swatch" + (current && current.id === id ? " is-chosen" : ""),
          label: FACE_SHORT_THEME[id] || t.name,
          ariaLabel: "Theme: " + t.name,
          icon: null,
          iconOnly: true,
          tooltip: t.name,
        });
        applyPrimarySwatch(el, themeSwatchSpec(t));
        // Label ink by the swatch fill's luminance, not the theme's own text
        // colour (Light's is white on a white shell).
        el.style.setProperty("--theme-ink", luminanceOf(themeSwatchVars(themeSwatchSpec(t)).fill) > 0.55 ? "#111111" : "#ffffff");
        showFaceLabel(el, FACE_SHORT_THEME[id] || t.name);
        el.dataset.theme = id;
        el.dataset.faceIndex = String(face.index);
        el.dataset.fan = "true";
        placeProjectedFace(el, face, patch, canvasRect, scale);
        el.classList.add("folded");
        el.dataset.delay = String(40 + j * 30);
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ignoreOutsideUntil = Date.now() + 200;
          game.setThemeIndex(index);
          stage.querySelectorAll(".hb-face-swatch").forEach((n) => n.classList.toggle("is-chosen", n.dataset.theme === id));
          refreshPrimaryLabels();
          announce("Theme · " + t.name);
        });
        faceActions.push({ el, faceIndex: face.index, fan: true });
        stage.appendChild(el);
      });
      return true;
    }
    function toggleThemeFan() {
      if (fanOpen) {
        fanOpen = false;
        stage.querySelectorAll(".hb-face-swatch").forEach((n) => n.remove());
        faceActions = faceActions.filter((a) => !a.fan);
        focusMenu();
        announce("Theme fan closed");
        return;
      }
      fanOpen = true;
      focusMenu();
      if (renderThemeFan()) {
        unfold(stage.querySelectorAll(".hb-face-swatch.folded"));
        announce("Choose a theme");
      } else {
        fanOpen = false;
        cycleFlowerTheme();
      }
    }

    function layoutFaceMenu() {
      if (!faceMenuLive || !facePatchIndices || !faceActions.length) return;
      const patch = currentFacePatch();
      const canvas = document.getElementById("gameCanvas");
      if (!canvas) return;
      if (!patch) {
        // The patch rotated away: rebuild on a fresh front patch.
        renderBloom({ petals: true });
        bloomPetals();
        return;
      }
      if (patch.center.z < FACE_RESEAT_Z) {
        // Dragged toward the rim: the tiles would foreshorten into slivers.
        facePatchIndices = null;
        renderBloom({ petals: true });
        bloomPetals();
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const scale = facePatchScale(patch);
      const faces = new Map(
        [patch.center].concat(patch.ring).map((face) => [face.index, face])
      );
      const st = game.getState();
      faceActions.forEach((action) => {
        let face = faces.get(action.faceIndex);
        if (!face && action.fan) {
          const t = st.tiles[action.faceIndex];
          if (t) {
            const pr = game.projectTile(t, st.rotY, st.rotX);
            face = pr.z > 0.12 ? fanTheme(Object.assign(pr, { index: action.faceIndex })) : null;
          }
          action.el.style.visibility = face ? "" : "hidden";
        }
        if (face) placeProjectedFace(action.el, face, patch, canvasRect, scale);
      });
    }

    function renderFaceMenu(cats) {
      const patch = currentFacePatch();
      const canvas = document.getElementById("gameCanvas");
      if (!patch || !canvas) return false;
      facePatchIndices = patch.indices.slice();
      const canvasRect = canvas.getBoundingClientRect();
      const scale = facePatchScale(patch);
      const ring = orderProjectedRing(patch);
      ring.forEach((face, index) => {
        const cat = cats[index];
        if (!cat) return;
        const el = makePrimaryTile(cat, index, "hb-face-action");
        showFaceLabel(el, faceLabel(cat));
        el.dataset.faceIndex = String(face.index);
        placeProjectedFace(el, face, patch, canvasRect, scale);
        el.classList.add("folded");
        el.dataset.delay = String(45 + index * 38);
        faceActions.push({ el, faceIndex: face.index });
        stage.appendChild(el);
      });
      const reset = makeHex({
        cls: "is-primary is-center-reset hb-face-action hb-face-center",
        label: "Reset",
        icon: "reset",
        iconOnly: true,
        ariaLabel: "Restart game",
      });
      showFaceLabel(reset, "Reset");
      reset.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        doReset();
      });
      reset.dataset.faceIndex = String(patch.center.index);
      placeProjectedFace(reset, patch.center, patch, canvasRect, scale);
      reset.classList.add("folded");
      reset.dataset.delay = "0";
      centerActionBtn = reset;
      faceActions.push({ el: reset, faceIndex: patch.center.index });
      stage.insertBefore(reset, stage.firstChild);
      return true;
    }

    function renderBloom(options) {
      const withPetals = !options || options.petals !== false;
      clearStage();
      setRiseVar();
      const { HEX } = tileMetrics();
      const { cx, cy } = centerXY();
      const cats = categories();

      // Center is the activation node (dock menu). When open, dock menu is the
      // close control — no separate traveler hex (avoids double × and rise).
      if (!withPetals) return;

      if (FACE_MENU) {
        const onSphere = renderFaceMenu(cats);
        setFaceMenuLive(onSphere);
        if (onSphere) return;
      }

      cats.forEach((cat, i) => {
        const d =
          (FIXED_CENTER
            ? FIXED_CENTER_SLOTS[i]
            : DOCK_CONTEXT
              ? CENTER_SLOTS[i]
              : DEFAULT_BLOOM
                ? DEFAULT_BLOOM_SLOTS[i]
              : PRIMARY_SLOTS[i]) || DIRECTIONS[i];
        const p = hexToPixel(d.q, d.r, HEX);
        const el = makePrimaryTile(cat, i);
        const seat = DOME
          ? DOCK_CENTER
            ? domeSeat(p.x, p.y, HEX)
            : domeSeat(p.x, p.y, HEX, 7.2, 0.48)
          : null;
        place(el, cx + (seat ? seat.x : p.x), cy + (seat ? seat.y : p.y), cx, cy);
        if (DOME) applyCenterDome(el, seat);
        el.classList.add("folded");
        // Center mode blooms petal-by-petal: the delay sweeps around the ring
        // by seat angle, so the flower visibly opens clockwise from the top
        // instead of in DOM order.
        el.dataset.delay = DOCK_CENTER
          ? String(
              (DOCK_CONTEXT ? 18 : 110) +
                Math.round(
                  (DOCK_CONTEXT ? 72 : 260) *
                    ((Math.atan2(p.y, p.x) + Math.PI) / (2 * Math.PI))
                )
            )
          : String(i * 26);
        stage.appendChild(el);
      });

      // Center modes have no dock seed. Reset occupies the strongest middle
      // seat; outside click and Escape close the flower.
      if (DOCK_CENTER) {
        const centerEl = makeHex({
          cls: "is-primary is-center-reset",
          label: "Reset",
          icon: "reset",
          iconOnly: true,
          ariaLabel: "Restart game",
        });
        centerEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          doReset();
        });
        place(centerEl, cx, cy, cx, cy);
        applyCenterDome(centerEl, DOME ? domeSeat(0, 0, HEX) : null);
        centerEl.classList.add("folded");
        centerEl.dataset.delay = "0";
        centerActionBtn = centerEl;
        // First in DOM = painted under the forward-riding rim (siblings have
        // no shared 3D context, so translateZ does not sort them).
        stage.insertBefore(centerEl, stage.firstChild);
      }
    }

    function bloomPetals() {
      unfold(stage.querySelectorAll(".hb-hex.is-primary.folded"));
      if (state.active) {
        const cats = categories();
        const i = cats.findIndex((c) => c.id === state.active);
        const cat = cats[i];
        if (cat && i >= 0) {
          requestAnimationFrame(() => addSubmenu(i, cat));
          root.dataset.branch = state.active;
        }
      }
      // Focus the menu's primary action when the flower finishes opening.
      if (DOCK_CENTER && centerActionBtn) {
        centerActionBtn.focus({ preventScroll: true });
      } else if (dockBtn) {
        dockBtn.focus({ preventScroll: true });
      }
    }

    function setCanvasInert(on) {
      const canvas = document.querySelector(".canvas-container");
      if (canvas) {
        if (on) canvas.setAttribute("inert", "");
        else canvas.removeAttribute("inert");
      }
    }

    /**
     * On-sphere menu: the board stays live for rotation (drag / arrow keys),
     * with dig, flag, long-press, pinch and wheel suppressed by the engine's
     * rotate-only mode. A stationary background tap still closes the menu.
     */
    function setFaceMenuLive(on) {
      faceMenuLive = !!on;
      root.dataset.faceMenu = faceMenuLive ? "true" : "false";
      document.body.classList.toggle("hex-bloom-rotatable", faceMenuLive);
      stage.setAttribute("aria-modal", faceMenuLive ? "false" : "true");
      setCanvasInert(!faceMenuLive);
      if (typeof game.setMenuInteraction === "function") {
        game.setMenuInteraction(faceMenuLive);
      }
    }

    /**
     * Size the flower against the sphere it sits on, not a guessed constant.
     * Ring-1 tile centers land at sqrt(3)*HEX from the seed (see the
     * hexToPixel geometry CENTER_SLOTS uses) and each tile's own circum-
     * radius is ~HEX, so the flower's worst-case outer edge is roughly
     * HEX*(sqrt(3)+1) from center. Solve that against FIT * sphereRadius so
     * the whole flower sits inside the sphere's disk, not past its rim.
     */
    const FLOWER_OUTER_HEX = Math.sqrt(3) + 1;
    const FLOWER_FIT = 0.72; // fraction of the sphere radius the flower may fill
    function sizeCenterFlower() {
      if (!DOCK_CENTER) return;
      const disk =
        typeof game.getSphereScreen === "function" ? game.getSphereScreen() : null;
      if (!disk || !disk.r) return;
      const stageWidth = stage.clientWidth || global.innerWidth;
      const narrowContext = DOCK_CONTEXT && stageWidth <= 520;
      const viewportCap = DOCK_CONTEXT
        ? Math.min(
            (stageWidth - 28) / 5.21,
            ((stage.clientHeight || global.innerHeight) - 28) / 5
          )
        : 90;
      let hex = Math.max(
        DOCK_CONTEXT ? (narrowContext ? 36 : 25) : 30,
        Math.min(
          DOCK_CONTEXT ? (narrowContext ? 52 : 66) : 90,
          viewportCap,
          ((disk.r * FLOWER_FIT) / FLOWER_OUTER_HEX) *
            (DOCK_CONTEXT ? (narrowContext ? 0.94 : 0.72) : 1)
        )
      );
      if (FIXED_CENTER) {
        // The flower prefers the band below the sphere (see flowerAnchor).
        // Size to that band when it can still hold a finger-sized tile
        // (hex 31 → 62×54 tiles); otherwise keep the sphere-derived size and
        // let the anchor fall back to beside / lower rim.
        const stageHeight = stage.clientHeight || global.innerHeight;
        const band = stageHeight - 76 - (disk.cy + disk.r) - Math.max(10, hex * 0.32);
        const hexBelow = band / 5;
        if (hexBelow >= 31) hex = Math.min(hex, hexBelow);
        hex = Math.max(hex, 31);
      }
      root.style.setProperty("--tile-h", (hex * 2).toFixed(1) + "px");
      root.style.setProperty("--tile-w", (hex * 1.746).toFixed(1) + "px");
    }

    function expand() {
      sizeCenterFlower();
      if (state.phase !== "closed") return;
      clearTimeout(phaseTimer);
      lastFocus = document.activeElement;
      root.dataset.sphereBusy = "false";

      hub.hidden = false;
      hub.dataset.open = "true";
      clearInterval(statsTimer);
      statsTimer = setInterval(paintStats, 250);
      paintStats();
      setCanvasInert(true);
      // Menu open = time out. The hub keeps painting the frozen value.
      if (typeof game.pauseTimer === "function") game.pauseTimer();

      // Dock grows + lifts (CSS). Petals use *final* open geometry from CSS
      // tokens (centerXY), never a mid-transition getBoundingClientRect — that
      // is what stacked Dig/Size under Restart/Menu/Help after grow/lift.
      setPhase("open");
      root.dataset.dock = "ready";
      paintDock();
      // Place on the next frame so data-phase=open has applied open CSS vars
      // (--dock-rise, full tile size) before we read them.
      requestAnimationFrame(() => {
        if (state.phase !== "open") return;
        // Root the petal layer at the dock's *idle* seed with no transition,
        // place petals at final geometry, then ride the whole layer up in
        // lockstep with the dock — petals stay glued to the seed instead of
        // hovering at their final seats while the dock catches up.
        // (Center mode has no dock to grow out of: the flower just unfolds.)
        stage.style.transition = "none";
        root.style.setProperty("--rise-y", DOCK_CENTER ? "0px" : dockRiseDelta() + "px");
        renderBloom({ petals: true });
        refreshPrimaryLabels();
        focusMenu();
        void stage.offsetHeight; // commit the pre-rise transform
        stage.style.transition = "";
        requestAnimationFrame(() => {
          if (state.phase !== "open") return;
          setRiseVar();
          bloomPetals();
          announce("Menu open");
        });
      });
    }

    function collapse() {
      if (faceMenuLive && typeof game.releaseFocus === "function") game.releaseFocus();
      if (state.phase !== "open" && state.phase !== "rising") return;
      clearTimeout(phaseTimer);
      clearTimeout(hoverCloseTimer);
      hideTooltip();
      state.active = null;
      delete root.dataset.branch;

      // Fold petals immediately (no stagger on the way in)
      stage.querySelectorAll(".hb-hex.is-primary, .hb-hex.is-sub").forEach((el) => {
        el.style.transitionDelay = "0ms";
        el.classList.remove("shown");
        el.classList.add("folded");
        el.style.pointerEvents = "none";
      });

      setPhase("falling");
      // Ride the petal layer back down with the dock while the petals fold —
      // one coherent settle instead of fold-then-drop. (No dock in center mode.)
      if (!DOCK_CENTER) root.style.setProperty("--rise-y", dockRiseDelta() + "px");

      const finish = () => {
        if (state.phase !== "falling") return;
        clearStage();
        setPhase("closed");
        setRiseVar();
        clearInterval(statsTimer);
        statsTimer = null;
        hub.dataset.open = "false";
        hub.hidden = true;
        setFaceMenuLive(false);
        setCanvasInert(false);
        if (typeof game.resumeTimer === "function") game.resumeTimer();
        announce("Menu closed");
        if (!DOCK_CENTER && dockBtn) dockBtn.focus({ preventScroll: true });
        else if (lastFocus && lastFocus.focus) {
          try {
            lastFocus.focus({ preventScroll: true });
          } catch (_) {}
        }
      };

      phaseTimer = setTimeout(finish, foldMs());
    }

    if (SEED_BARE) root.dataset.seed = "bare";
    if (DEFAULT_BLOOM) root.dataset.iconMenu = "true";
    if (DEFAULT_BLOOM && !SEED_BARE) root.dataset.bottomSeed = "true";
    if (DOME) root.dataset.dome = "true";

    // Pointer parallax while a center flower is open (fine pointers only).
    // Dome gets the full oblique camera; the base flower moves as one nearly
    // flat plate, just enough to separate it from the sphere without opening
    // seams between tiles. rAF-lerped so repeated interaction cannot drift.
    if (DOCK_CENTER) {
      const BASE_RX = DOME ? 9 : 0.8;
      const BASE_RY = DOME ? -6 : -0.6;
      const PARALLAX_DEG = DOME ? 5 : 2.1;
      const CAMERA_SCALE = DOME ? 1 : 1.006;
      let px = 0;
      let py = 0;
      let txp = 0;
      let typ = 0;
      let parRaf = 0;
      const paintCenterCamera = () => {
        stage.style.transform =
          "rotateX(" + (BASE_RX + py * -PARALLAX_DEG).toFixed(2) +
          "deg) rotateY(" + (BASE_RY + px * PARALLAX_DEG).toFixed(2) +
          "deg) scale(" + CAMERA_SCALE.toFixed(3) + ")";
      };
      const easeParallax = () => {
        parRaf = 0;
        px += (txp - px) * 0.22;
        py += (typ - py) * 0.22;
        paintCenterCamera();
        if (Math.abs(txp - px) > 0.003 || Math.abs(typ - py) > 0.003) {
          queueParallax();
        }
      };
      const queueParallax = () => {
        if (!parRaf) parRaf = requestAnimationFrame(easeParallax);
      };
      paintCenterCamera();
      if (matchMedia("(pointer: fine)").matches && !prefersReducedMotion()) {
        document.addEventListener(
          "pointermove",
          (e) => {
            if (state.phase !== "open") return;
            const w = stage.clientWidth || 1;
            const h = stage.clientHeight || 1;
            txp = (e.clientX / w) * 2 - 1;
            typ = (e.clientY / h) * 2 - 1;
            queueParallax();
          },
          { passive: true }
        );
        document.addEventListener(
          "pointerout",
          (e) => {
            if (e.relatedTarget) return;
            txp = 0;
            typ = 0;
            queueParallax();
          },
          { passive: true }
        );
      }
    }
    if (DOCK_CENTER) {
      root.dataset.dockMode = "center";
      root.dataset.iconMenu = "true";
      if (DOCK_CONTEXT) root.dataset.contextMenu = "true";
      // The background is the menu activator: a quick tap that lands off the
      // sphere's disk (game.getSphereScreen) opens the flower. In contextual
      // mode the flower follows that canvas point, then centerXY clamps its
      // complete seven-tile footprint into the viewport.
      const cc = document.querySelector(".canvas-container");
      if (cc) {
        let downAt = 0;
        let sx = 0;
        let sy = 0;
        cc.addEventListener(
          "pointerdown",
          (e) => {
            downAt = Date.now();
            sx = e.clientX;
            sy = e.clientY;
          },
          true
        );
        cc.addEventListener(
          "pointerup",
          (e) => {
            if (state.phase !== "closed") return;
            if (Date.now() - downAt > 350) return;
            if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) return;
            const d =
              typeof game.getSphereScreen === "function"
                ? game.getSphereScreen()
                : null;
            if (d && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) <= d.r)
              return;
            if (DOCK_CONTEXT) {
              contextAnchor = { x: e.clientX, y: e.clientY };
            }
            expand();
          },
          true
        );
      }
    }

    stage.addEventListener("pointerover", (e) => {
      if (!hoverTooltipsEnabled) return;
      const el = e.target.closest && e.target.closest(".hb-hex");
      const from =
        e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest(".hb-hex")
          : null;
      if (!el || el === from) return;
      queueTooltip(el, false);
    });
    stage.addEventListener("pointerout", (e) => {
      if (!hoverTooltipsEnabled) return;
      const el = e.target.closest && e.target.closest(".hb-hex");
      const to =
        e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest(".hb-hex")
          : null;
      if (!el || el === to) return;
      hideTooltip();
    });
    stage.addEventListener("focusin", (e) => {
      const el = e.target.closest && e.target.closest(".hb-hex");
      if (el && el.matches(":focus-visible")) queueTooltip(el, true);
    });
    stage.addEventListener("focusout", (e) => {
      const el = e.target.closest && e.target.closest(".hb-hex");
      const to =
        e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest(".hb-hex")
          : null;
      if (el && el !== to) hideTooltip();
    });

    if (hoverBloomEnabled) {
      const hoverBranch = (node) => {
        const el = node && node.closest && node.closest(".hb-hex[data-cat]");
        if (!el) return null;
        const cat = categories().find(
          (candidate) => candidate.id === el.dataset.cat
        );
        return cat && cat.hoverSub ? cat.id : null;
      };
      stage.addEventListener("pointerover", (e) => {
        const id = hoverBranch(e.target);
        if (!id) return;
        clearTimeout(hoverCloseTimer);
        if (state.active !== id) {
          const i = categories().findIndex((cat) => cat.id === id);
          if (i >= 0) toggleCategory(id, i);
        }
      });
      stage.addEventListener("pointerout", (e) => {
        const id = hoverBranch(e.target);
        if (!id || hoverBranch(e.relatedTarget) === id) return;
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = setTimeout(() => {
          if (state.active === id) clearActive();
        }, 140);
      });
    }

    // Scrim click closes
    scrim.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.phase === "open") collapse();
    });

    // Focus trap while open
    document.addEventListener(
      "keydown",
      (e) => {
        if (state.phase !== "open" && state.phase !== "rising") return;

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (state.active && state.phase === "open") {
            clearActive();
            announce("Menu open");
            if (dockBtn) dockBtn.focus({ preventScroll: true });
          } else {
            collapse();
          }
          return;
        }

        if (e.key === "Tab") {
          const focusables = (
            DOCK_CENTER
              ? [
                  ...stage.querySelectorAll(
                    ".hb-hex.is-primary.shown, .hb-hex.is-sub.shown"
                  ),
                  dockHelpBtn,
                ]
              : [
                  dockResetBtn,
                  dockBtn,
                  dockFlagBtn,
                  dockHelpBtn,
                  ...stage.querySelectorAll(
                    ".hb-hex.is-primary.shown, .hb-hex.is-sub.shown"
                  ),
                ]
          ).filter(Boolean);
          if (!focusables.length) return;
          const i = focusables.indexOf(document.activeElement);
          e.preventDefault();
          if (e.shiftKey) {
            const prev = i <= 0 ? focusables.length - 1 : i - 1;
            focusables[prev].focus({ preventScroll: true });
          } else {
            const next = i < 0 || i >= focusables.length - 1 ? 0 : i + 1;
            focusables[next].focus({ preventScroll: true });
          }
        }
      },
      true
    );

    document.addEventListener("keydown", (e) => {
      if (
        (e.key === "c" || e.key === "C") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")
      ) {
        if (state.phase === "open" || state.phase === "rising") collapse();
        else if (state.phase === "closed") expand();
      }
    });

    document.addEventListener("keyup", (e) => {
      // F flips flag mode from anywhere; the dock tile must follow.
      if (/^[fF]$/.test(e.key)) paintDock();
      if (state.phase !== "open") return;
      if (/^[stnfrSTNFR]$/.test(e.key)) refreshPrimaryLabels();
    });

    let raf;
    // Seeded now, not 0 — otherwise the first URL-bar height change would
    // read as a width change and trigger the rebuild this gate exists to stop.
    let lastStageW = stage.clientWidth || global.innerWidth;
    let lastStageH = stage.clientHeight || global.innerHeight;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Mid-descent the stage is deliberately translated; zeroing it here
        // would snap the folding petals upward.
        if (state.phase !== "falling") setRiseVar();
        // Height-only changes are the mobile URL bar showing/hiding — petals
        // are bottom-anchored, so they already rode along with the dock.
        // Rebuilding on those is what made the open bloom jitter and resettle.
        const w = stage.clientWidth || global.innerWidth;
        const h = stage.clientHeight || global.innerHeight;
        const widthChanged = Math.abs(w - lastStageW) > 1;
        const heightChanged = Math.abs(h - lastStageH) > 1;
        lastStageW = w;
        lastStageH = h;
        if (!widthChanged && !(DOCK_CONTEXT && heightChanged)) return;
        if (state.phase === "open") {
          // rebuild petal positions without losing open state
          sizeCenterFlower();
          const active = state.active;
          renderBloom({ petals: true });
          state.active = active;
          bloomPetals();
        }
      });
    });

    // ---- Dock attention fade ----
    // Hide while the player is on the board (spinning or aiming over tiles).
    // Show only when attention leaves the playfield into the bottom chrome band
    // (or off the canvas). Dig taps alone do not hide; orbit / sustained board
    // attention does. Menu open always forces visible.
    function wireSphereBusyFade() {
      const canvas = document.getElementById("gameCanvas");
      if (!canvas) return;

      let down = false;
      let dragging = false;
      let boardAttention = false;
      let engaged = false; // once true, board hover keeps dock hidden
      let startX = 0;
      let startY = 0;
      const MOVE_PX = 10;
      // Bottom strip reserved for chrome — pointer here reveals the seed
      // Tall enough for full-size dock trio + upward bloom clearance
      const CHROME_BAND = 140;

      function pointFrom(e) {
        if (e.touches && e.touches.length) return e.touches[0];
        if (e.changedTouches && e.changedTouches.length)
          return e.changedTouches[0];
        return e;
      }

      function inChromeBand(x, y) {
        const h = window.innerHeight || document.documentElement.clientHeight;
        const band = CHROME_BAND + (parseInt(getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)"), 10) || 0);
        // safe-area via CSS env isn't readable as number easily — pad generously
        return y >= h - (CHROME_BAND + 24);
      }

      function applyBusyAttr() {
        if (state.phase !== "closed") {
          root.dataset.sphereBusy = "false";
          return;
        }
        const hide = dragging || (engaged && boardAttention);
        root.dataset.sphereBusy = hide ? "true" : "false";
      }

      function setDragging(v) {
        dragging = !!v;
        if (dragging) engaged = true;
        applyBusyAttr();
      }

      function setBoardAttention(v) {
        boardAttention = !!v;
        applyBusyAttr();
      }

      function updateFromPoint(x, y, target) {
        if (state.phase !== "closed") {
          root.dataset.sphereBusy = "false";
          return;
        }
        if (inChromeBand(x, y)) {
          setBoardAttention(false);
          return;
        }
        // Pointer over playfield (canvas / board)
        const onCanvas =
          target === canvas ||
          (target && canvas.contains && canvas.contains(target)) ||
          target === document.body ||
          target === document.documentElement;
        if (onCanvas || (x >= 0 && y >= 0 && y < window.innerHeight - CHROME_BAND)) {
          if (engaged || dragging) setBoardAttention(true);
          else setBoardAttention(false); // first visit: keep seed visible until engage
        } else {
          setBoardAttention(false);
        }
      }

      function onDown(e) {
        if (state.phase !== "closed") return;
        down = true;
        dragging = false;
        if (e.touches && e.touches.length >= 2) {
          setDragging(true);
          return;
        }
        const t = pointFrom(e);
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        if (inChromeBand(t.clientX, t.clientY)) {
          setBoardAttention(false);
          return;
        }
      }

      function onMove(e) {
        const t = pointFrom(e);
        if (!t) return;

        if (state.phase !== "closed") {
          root.dataset.sphereBusy = "false";
          return;
        }

        // Not dragging: mouse move can reveal chrome only in the bottom band
        if (!down) {
          updateFromPoint(t.clientX, t.clientY, e.target);
          return;
        }

        if (e.touches && e.touches.length >= 2) {
          setDragging(true);
          return;
        }
        if (!dragging) {
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          if (dx * dx + dy * dy >= MOVE_PX * MOVE_PX) setDragging(true);
        }
        if (dragging) {
          if (inChromeBand(t.clientX, t.clientY)) setBoardAttention(false);
          else setBoardAttention(true);
        }
      }

      function onUp(e) {
        const t = pointFrom(e);
        down = false;
        const wasDragging = dragging;
        setDragging(false);
        if (t) updateFromPoint(t.clientX, t.clientY, e && e.target);
        else if (wasDragging) {
          // stay hidden if we don't know where the pointer is — engaged board
          if (engaged) setBoardAttention(true);
        }
      }

      function onLeave() {
        // Pointer left the window → allow chrome back
        if (!down) setBoardAttention(false);
      }

      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onUp, { passive: true });
      window.addEventListener("blur", onLeave);
      document.addEventListener("mouseleave", onLeave);
      // Touch
      window.addEventListener("touchstart", onDown, { passive: true });
      window.addEventListener("touchmove", onMove, { passive: true });
      window.addEventListener("touchend", onUp, { passive: true });
    }

    // On-sphere menu: follow the board when it rotates or resizes; a still
    // tap on the board (not on a tile) closes, matching the scrim.
    const menuCanvas = document.getElementById("gameCanvas");
    if (menuCanvas) {
      menuCanvas.addEventListener("hexsweeper:rotation", () => {
        if (faceMenuLive && state.phase === "open") layoutFaceMenu();
      });
      menuCanvas.addEventListener("hexsweeper:menu-background-tap", () => {
        if (faceMenuLive && state.phase === "open" && Date.now() >= ignoreOutsideUntil) collapse();
      });
    }
    window.addEventListener("resize", () => {
      if (faceMenuLive && state.phase === "open") layoutFaceMenu();
    });

    // Boot
    setPhase("closed");
    root.dataset.sphereBusy = "false";
    renderDockOnly();
    paintStats();
    wireSphereBusyFade();

    return {
      open: expand,
      close: collapse,
      toggle: () => (state.phase === "closed" ? expand() : collapse()),
      isOpen: () => isOpenish(),
    };
  }

  global.initHexBloom = initHexBloom;
})(window);
