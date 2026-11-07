// The sky behind the well: faint stars, the same every time a stage is opened.
// Pure rules: no DOM, usable from Node.
export const CELL = 36;
const TAU = Math.PI * 2;

// A number from 0 to 1 that depends only on a cell, the stage's sky and `n`.
function chance(i, j, seed, n) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed + 1, 1274126177) ^ Math.imul(n + 1, 2246822519);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h = Math.imul(h ^ h >>> 15, 2246822519);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

// The star of one cell, or null where the sky is empty. A star keeps well inside
// its cell, so whatever looks one up never has to search the cells around it.
// Most are small and faint; `rate` and `phase` are how it twinkles.
export function star(i, j, seed) {
  if (chance(i, j, seed, 0) > 0.78) return null;
  const size = chance(i, j, seed, 3);
  const light = chance(i, j, seed, 4);
  return {
    x: (i + 0.16 + 0.68 * chance(i, j, seed, 1)) * CELL,
    y: (j + 0.16 + 0.68 * chance(i, j, seed, 2)) * CELL,
    r: 0.55 + 0.75 * size * size,
    a: 0.1 + 0.3 * light * light,
    rate: 0.4 + 1.4 * chance(i, j, seed, 5),
    phase: TAU * chance(i, j, seed, 6)
  };
}

export const twinkle = (one, seconds) => one.a * (0.7 + 0.3 * Math.sin(seconds * one.rate + one.phase));
