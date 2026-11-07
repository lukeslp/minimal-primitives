/**
 * File Purpose: Minimal hexasphere geometry (Goldberg dual of subdivided icosahedron).
 * Primary Functions/Classes: generateHexasphere, floodClosure, vec3 helpers.
 * Inputs: radius, subdivisions (0–12+). Outputs: { tiles, radius, subdivisions }.
 * Notes: Plain-object Vec3 — no Three.js. Ported from Rind hexasphere.ts (Rob Scanlon lineage).
 * Author: Luke Steuber <luke@lukesteuber.com>
 */
(function (global) {
  "use strict";

  const PHI = (1 + Math.sqrt(5)) / 2;

  const ICOSAHEDRON_VERTICES = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ];

  const ICOSAHEDRON_FACES = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  function vec3(x, y, z) {
    return { x, y, z };
  }

  function clone(v) {
    return vec3(v.x, v.y, v.z);
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return vec3(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }

  function normalize(v, radius) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    const s = radius / len;
    return vec3(v.x * s, v.y * s, v.z * s);
  }

  function vecKey(v, precision) {
    const p = precision != null ? precision : 6;
    const scale = Math.pow(10, p);
    function q(n) {
      const r = Math.round(n * scale) / scale;
      return Object.is(r, -0) ? 0 : r;
    }
    return `${q(v.x)},${q(v.y)},${q(v.z)}`;
  }

  function cartesianToSpherical(v) {
    const r = Math.hypot(v.x, v.y, v.z) || 1;
    return {
      lat: Math.asin(v.y / r) * (180 / Math.PI),
      lon: Math.atan2(v.z, v.x) * (180 / Math.PI),
    };
  }

  function subdivideIcosahedron(subdivisions, radius) {
    const baseVerts = ICOSAHEDRON_VERTICES.map(([x, y, z]) =>
      normalize(vec3(x, y, z), radius)
    );

    if (subdivisions === 0) {
      return { vertices: baseVerts, faces: ICOSAHEDRON_FACES.map((f) => f.slice()) };
    }

    const vertexMap = new Map();
    const allVertices = [];
    const allFaces = [];

    function getVertexIndex(v) {
      const projected = normalize(v, radius);
      const key = vecKey(projected);
      if (vertexMap.has(key)) return vertexMap.get(key);
      const idx = allVertices.length;
      allVertices.push(projected);
      vertexMap.set(key, idx);
      return idx;
    }

    for (const [ai, bi, ci] of ICOSAHEDRON_FACES) {
      const a = baseVerts[ai];
      const b = baseVerts[bi];
      const c = baseVerts[ci];
      const rows = [];
      for (let i = 0; i <= subdivisions; i++) {
        const row = [];
        for (let j = 0; j <= subdivisions - i; j++) {
          const u = i / subdivisions;
          const vCoord = j / subdivisions;
          const w = 1 - u - vCoord;
          row.push(
            getVertexIndex(
              vec3(
                a.x * w + b.x * u + c.x * vCoord,
                a.y * w + b.y * u + c.y * vCoord,
                a.z * w + b.z * u + c.z * vCoord
              )
            )
          );
        }
        rows.push(row);
      }
      for (let i = 0; i < subdivisions; i++) {
        for (let j = 0; j < subdivisions - i; j++) {
          allFaces.push([rows[i][j], rows[i + 1][j], rows[i][j + 1]]);
          if (j < subdivisions - i - 1) {
            allFaces.push([rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]]);
          }
        }
      }
    }

    return { vertices: allVertices, faces: allFaces };
  }

  function buildDual(vertices, faces, radius) {
    const faceCentroids = faces.map(([a, b, c]) => {
      const cx = (vertices[a].x + vertices[b].x + vertices[c].x) / 3;
      const cy = (vertices[a].y + vertices[b].y + vertices[c].y) / 3;
      const cz = (vertices[a].z + vertices[b].z + vertices[c].z) / 3;
      return normalize(vec3(cx, cy, cz), radius);
    });

    const vertexFaces = new Map();
    faces.forEach(([a, b, c], faceIdx) => {
      for (const vi of [a, b, c]) {
        if (!vertexFaces.has(vi)) vertexFaces.set(vi, []);
        vertexFaces.get(vi).push(faceIdx);
      }
    });

    const tiles = [];

    vertexFaces.forEach((faceIndices, vertexIdx) => {
      const vertex = vertices[vertexIdx];
      const normal = normalize(clone(vertex), 1);
      let right = vec3(1, 0, 0);
      if (Math.abs(dot(normal, right)) > 0.9) right = vec3(0, 1, 0);
      const forward = normalize(cross(normal, right), 1);
      right = normalize(cross(forward, normal), 1);

      const withAngles = faceIndices.map((fi) => {
        const c = faceCentroids[fi];
        const diff = vec3(c.x - vertex.x, c.y - vertex.y, c.z - vertex.z);
        const x = dot(diff, right);
        const y = dot(diff, forward);
        return { centroid: c, angle: Math.atan2(y, x), faceIdx: fi };
      });
      withAngles.sort((a, b) => a.angle - b.angle);

      const boundary = withAngles.map((wa) => wa.centroid);
      const centerPoint = normalize(clone(vertex), radius);

      tiles.push({
        index: tiles.length,
        centerPoint,
        boundary,
        neighborIndices: [],
        isPentagon: boundary.length === 5,
        spherical: cartesianToSpherical(centerPoint),
      });
    });

    const edgeToTile = new Map();
    tiles.forEach((tile, tileIdx) => {
      const b = tile.boundary;
      for (let i = 0; i < b.length; i++) {
        const j = (i + 1) % b.length;
        const key1 = vecKey(b[i]);
        const key2 = vecKey(b[j]);
        const edgeKey = [key1, key2].sort().join("|");
        if (!edgeToTile.has(edgeKey)) edgeToTile.set(edgeKey, []);
        edgeToTile.get(edgeKey).push(tileIdx);
      }
    });

    edgeToTile.forEach((tileIndices) => {
      if (tileIndices.length === 2) {
        const [a, b] = tileIndices;
        if (!tiles[a].neighborIndices.includes(b)) tiles[a].neighborIndices.push(b);
        if (!tiles[b].neighborIndices.includes(a)) tiles[b].neighborIndices.push(a);
      }
    });

    return tiles;
  }

  /**
   * BFS flood closure over neighborIndices for zero-count tiles (game logic helper).
   */
  function floodClosure(tiles, startIdx, isBlocked) {
    const opened = new Set();
    const queue = [startIdx];
    const visited = new Set([startIdx]);
    while (queue.length) {
      const idx = queue.shift();
      for (const n of tiles[idx].neighborIndices) {
        if (visited.has(n)) continue;
        visited.add(n);
        if (isBlocked(n)) continue;
        opened.add(n);
        if (isBlocked(n, true)) continue; // neighborMines check done externally
        queue.push(n);
      }
    }
    return opened;
  }

  function generateHexasphere(radius, subdivisions) {
    const r = radius != null ? radius : 5;
    const sub = subdivisions != null ? subdivisions : 2;
    const { vertices, faces } = subdivideIcosahedron(sub, r);
    const tiles = buildDual(vertices, faces, r);
    return { tiles, radius: r, subdivisions: sub };
  }

  const api = {
    generateHexasphere,
    floodClosure,
    cartesianToSpherical,
    vec3,
    clone,
    dot,
    cross,
    normalize,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Hexasphere = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
