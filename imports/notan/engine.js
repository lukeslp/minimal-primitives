/* Notan engine: clues, line solver, difficulty measure, uniqueness check and
 * the endless-board generator. Works in the browser (window.InkEngine) and in
 * node (module.exports), so every level can be checked headlessly.
 *
 * A board is w columns by h rows. A solution is a Uint8Array of w*h cells,
 * row-major, 1 = ink. A working grid uses -1 unknown, 0 empty, 1 ink.
 * The line solver is the forward/backward DP from Warp & Weft's engine. */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function runs(cells) {
    const out = [];
    let r = 0;
    for (const v of cells) {
      if (v === 1) r++;
      else if (r) { out.push(r); r = 0; }
    }
    if (r) out.push(r);
    return out;
  }

  function row(g, w, r) { return Array.from({ length: w }, (_, c) => g[r * w + c]); }
  function col(g, w, h, c) { return Array.from({ length: h }, (_, r) => g[r * w + c]); }

  function cluesOf(sol, w, h) {
    const rows = [], cols = [];
    for (let r = 0; r < h; r++) rows.push(runs(row(sol, w, r)));
    for (let c = 0; c < w; c++) cols.push(runs(col(sol, w, h, c)));
    return { rows, cols };
  }

  /* Picture from string art: '#' is ink, anything else is empty. */
  function fromArt(lines) {
    const h = lines.length, w = lines[0].length;
    const sol = new Uint8Array(w * h);
    lines.forEach((ln, r) => {
      if (ln.length !== w) throw new Error('ragged art at row ' + r + ': ' + ln);
      for (let c = 0; c < w; c++) sol[r * w + c] = ln[c] === '#' ? 1 : 0;
    });
    return { w, h, sol };
  }
  function toArt(sol, w, h) {
    const out = [];
    for (let r = 0; r < h; r++) out.push(row(sol, w, r).map((v) => (v === 1 ? '#' : '.')).join(''));
    return out;
  }

  /* One line: cells are -1 unknown, 0 empty, 1 ink. Returns a new array
   * with every forced cell decided, or null when the clue cannot fit. */
  function solveLine(cells, blocks) {
    const n = cells.length, k = blocks.length;
    const fits = (s, b) => {
      if (s + b > n) return false;
      for (let i = s; i < s + b; i++) if (cells[i] === 0) return false;
      return s + b === n || cells[s + b] !== 1;
    };
    const F = Array.from({ length: n + 2 }, () => new Uint8Array(k + 1));
    F[0][0] = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= k; j++) {
        if (!F[i][j]) continue;
        if (cells[i] !== 1) F[i + 1][j] = 1;
        if (j < k && fits(i, blocks[j])) F[Math.min(n, i + blocks[j] + 1)][j + 1] = 1;
      }
    }
    const B = Array.from({ length: n + 2 }, () => new Uint8Array(k + 1));
    B[n][k] = 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = k; j >= 0; j--) {
        let ok = cells[i] !== 1 && B[i + 1][j];
        if (!ok && j < k && fits(i, blocks[j])) ok = B[Math.min(n, i + blocks[j] + 1)][j + 1];
        B[i][j] = ok ? 1 : 0;
      }
    }
    if (!B[0][0]) return null;
    const canEmpty = new Uint8Array(n), canFill = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= k; j++) {
        if (F[i][j] && cells[i] !== 1 && B[i + 1][j]) canEmpty[i] = 1;
        if (j < k && F[i][j] && fits(i, blocks[j]) && B[Math.min(n, i + blocks[j] + 1)][j + 1]) {
          canFill[i]++; canFill[i + blocks[j]]--;
          if (i + blocks[j] < n) canEmpty[i + blocks[j]] = 1;
        }
      }
    }
    const out = cells.slice();
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += canFill[i];
      const f = acc > 0, e = canEmpty[i] === 1;
      if (!f && !e) return null;
      if (f && !e) out[i] = 1;
      else if (e && !f) out[i] = 0;
    }
    return out;
  }

  /* Fast propagation (dirty lines only). Returns { grid, solved, contradiction }. */
  function propagate(rows, cols, w, h, start) {
    const g = start ? Int8Array.from(start) : new Int8Array(w * h).fill(-1);
    let dirtyR = new Set(rows.keys()), dirtyC = new Set(cols.keys());
    while (dirtyR.size || dirtyC.size) {
      const nextR = new Set(), nextC = new Set();
      for (const r of dirtyR) {
        const line = row(g, w, r);
        const res = solveLine(line, rows[r]);
        if (!res) return { grid: g, solved: false, contradiction: true };
        for (let c = 0; c < w; c++) if (res[c] !== line[c]) { g[r * w + c] = res[c]; nextC.add(c); }
      }
      for (const c of dirtyC) {
        const line = col(g, w, h, c);
        const res = solveLine(line, cols[c]);
        if (!res) return { grid: g, solved: false, contradiction: true };
        for (let r = 0; r < h; r++) if (res[r] !== line[r]) { g[r * w + c] = res[r]; nextR.add(r); }
      }
      dirtyR = nextR; dirtyC = nextC;
    }
    return { grid: g, solved: !g.includes(-1), contradiction: false };
  }

  /* Count solutions by propagation plus branching, stopping at `limit`.
   * Independent of the difficulty measure: it also proves uniqueness for
   * boards the line solver cannot finish. */
  function countSolutions(rows, cols, w, h, limit) {
    limit = limit || 2;
    let found = 0;
    const stack = [null];
    let guard = 0;
    while (stack.length && found < limit) {
      if (++guard > 200000) throw new Error('countSolutions: search too large');
      const start = stack.pop();
      const res = propagate(rows, cols, w, h, start);
      if (res.contradiction) continue;
      if (res.solved) { found++; continue; }
      const i = res.grid.indexOf(-1);
      const a = Int8Array.from(res.grid); a[i] = 0;
      const b = Int8Array.from(res.grid); b[i] = 1;
      stack.push(a, b);
    }
    return found;
  }

  /* Difficulty, measured by the line solver in synchronous rounds: each
   * round solves every row and column against what the previous round
   * knew. `depth` is how many rounds it takes, which is the length of the
   * longest chain of "this line tells me something about that line" a
   * player has to follow. `opening` is the share of cells a player can
   * decide from the clues alone, before crossing any lines. */
  function measure(rows, cols, w, h) {
    let g = new Int8Array(w * h).fill(-1);
    let depth = 0, opening = 0, work = 0;
    for (;;) {
      const next = Int8Array.from(g);
      let changed = 0;
      for (let r = 0; r < h; r++) {
        const line = row(g, w, r);
        if (!line.includes(-1)) continue;
        const res = solveLine(line, rows[r]);
        if (!res) return { solvable: false, depth, opening, work, band: 9 };
        let moved = false;
        for (let c = 0; c < w; c++) if (res[c] !== line[c] && next[r * w + c] === -1) { next[r * w + c] = res[c]; changed++; moved = true; }
        if (moved) work++;
      }
      for (let c = 0; c < w; c++) {
        const line = col(g, w, h, c);
        if (!line.includes(-1)) continue;
        const res = solveLine(line, cols[c]);
        if (!res) return { solvable: false, depth, opening, work, band: 9 };
        let moved = false;
        for (let r = 0; r < h; r++) if (res[r] !== line[r] && next[r * w + c] === -1) { next[r * w + c] = res[r]; changed++; moved = true; }
        if (moved) work++;
      }
      if (!changed) break;
      depth++;
      g = next;
      if (depth === 1) opening = g.filter((v) => v !== -1).length / (w * h);
    }
    const solvable = !g.includes(-1);
    const m = { solvable, depth, opening: Math.round(opening * 100) / 100, work };
    m.score = Math.round(scoreOf(m, w, h) * 10) / 10;
    m.band = bandOf(m, w, h);
    return m;
  }

  /* Score: board size (log2 of the cell count), plus solver rounds, plus
   * how little the clues give away before lines start crossing. Bands are
   * score steps of 2: band 1 is a 2x2 every line of which is full, band 8 is
   * a 15x15 that needs a dozen rounds of row-to-column reasoning. Band 9
   * means the line solver stalls (a guess or deeper lookahead is needed);
   * the ramp never uses those and the generator never makes them. */
  function scoreOf(m, w, h) {
    return Math.log2(w * h) + 0.8 * m.depth + 2 * (1 - m.opening);
  }
  function bandOf(m, w, h) {
    if (!m.solvable) return 9;
    return Math.max(1, Math.min(8, 1 + Math.floor((scoreOf(m, w, h) - 2.5) / 2)));
  }

  /* ---------- Generator for endless boards ---------- */

  /* The cells that mirror cell i under a symmetry: 'lr' mirrors left to
   * right (faces, creatures), 'quad' mirrors both ways (tiles, emblems). */
  function twins(i, w, h, sym) {
    const r = Math.floor(i / w), c = i % w;
    const out = new Set([i, r * w + (w - 1 - c)]);
    if (sym === 'quad') { out.add((h - 1 - r) * w + c); out.add((h - 1 - r) * w + (w - 1 - c)); }
    return [...out];
  }

  /* A blob picture: noise, a symmetry, then majority smoothing, so boards
   * read as shapes (masks, creatures, emblems) rather than static. */
  function blob(w, h, rng, sym) {
    const g = new Uint8Array(w * h);
    const dens = 0.48 + rng() * 0.16;
    for (let i = 0; i < w * h; i++) g[i] = rng() < dens ? 1 : 0;
    if (sym !== 'none') for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const rr = sym === 'quad' ? Math.min(r, h - 1 - r) : r;
      g[r * w + c] = g[rr * w + Math.min(c, w - 1 - c)];
    }
    const passes = 1 + (rng() < 0.5 ? 1 : 0);
    for (let p = 0; p < passes; p++) {
      const prev = Uint8Array.from(g);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        let n = 0, t = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
          t++; n += prev[rr * w + cc];
        }
        if (n * 2 > t) g[r * w + c] = 1;
        else if (n * 2 < t) g[r * w + c] = 0;
      }
    }
    return g;
  }

  function density(sol) { let s = 0; for (const v of sol) s += v; return s / sol.length; }

  /* Quick-play numbers below 100000 keep the original mirrored boards, so old
   * share links and a board in progress open unchanged. */
  const FREE_SEED = 100000;
  function generate(seed, w, h) {
    h = h || w;
    return seed >= FREE_SEED ? generateFree(seed, w, h) : generateMirrored(seed, w, h);
  }

  function mirrored(sol, w, h) {
    let lr = true, ud = true, rot = true, d1 = w === h, d2 = w === h;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const v = sol[r * w + c];
      if (v !== sol[r * w + (w - 1 - c)]) lr = false;
      if (v !== sol[(h - 1 - r) * w + c]) ud = false;
      if (v !== sol[(h - 1 - r) * w + (w - 1 - c)]) rot = false;
      if (d1 && v !== sol[c * w + r]) d1 = false;
      if (d2 && v !== sol[(w - 1 - c) * w + (h - 1 - r)]) d2 = false;
    }
    return lr || ud || rot || d1 || d2;
  }

  /* An unmirrored board the line solver finishes from blank. Of a few
   * candidates it keeps the one that takes the most solver rounds. */
  function generateFree(seed, w, h) {
    const rng = mulberry32((seed >>> 0) * 2654435761 + w * 977 + h * 131 + 11);
    let best = null, found = 0;
    for (let attempt = 0; attempt < 120 && found < 3; attempt++) {
      const sol = blob(w, h, rng, 'none');
      for (let fix = 0; fix < 2 * w * h; fix++) {
        const d = density(sol);
        if (d < 0.32 || d > 0.74) break;
        const { rows, cols } = cluesOf(sol, w, h);
        const res = propagate(rows, cols, w, h);
        if (res.solved) {
          let emptyLines = 0;
          rows.forEach((x) => { if (!x.length) emptyLines++; });
          cols.forEach((x) => { if (!x.length) emptyLines++; });
          if (emptyLines > 1 || mirrored(sol, w, h)) break;
          found++;
          const m = measure(rows, cols, w, h);
          if (!best || m.score > best.score) best = { score: m.score, sol: Uint8Array.from(sol), rows, cols };
          break;
        }
        const open = [];
        for (let i = 0; i < w * h; i++) if (res.grid[i] === -1) open.push(i);
        sol[open[Math.floor(rng() * open.length)]] ^= 1;
      }
    }
    return best && { w, h, seed, sol: best.sol, rows: best.rows, cols: best.cols, name: 'No. ' + seed };
  }

  /* Generate a board that the line solver finishes from blank, which
   * proves it has exactly one solution. Deterministic in (seed, w, h). */
  function generateMirrored(seed, w, h) {
    const rng = mulberry32((seed >>> 0) * 2654435761 + w * 977 + h * 131 + 7);
    for (let attempt = 0; attempt < 80; attempt++) {
      const sym = rng() < 0.7 ? 'lr' : 'quad';
      const sol = blob(w, h, rng, sym);
      for (let fix = 0; fix < 2 * w * h; fix++) {
        const d = density(sol);
        if (d < 0.32 || d > 0.74) break;
        const { rows, cols } = cluesOf(sol, w, h);
        const res = propagate(rows, cols, w, h);
        if (res.solved) {
          let emptyLines = 0;
          rows.forEach((x) => { if (!x.length) emptyLines++; });
          cols.forEach((x) => { if (!x.length) emptyLines++; });
          if (emptyLines > 1) break;
          return { w, h, seed, sol, rows, cols, name: 'No. ' + seed };
        }
        // Flip one undecided cell and its twins, keeping the symmetry.
        const open = [];
        for (let i = 0; i < w * h; i++) if (res.grid[i] === -1) open.push(i);
        const i = open[Math.floor(rng() * open.length)];
        const v = sol[i] ^ 1;
        for (const t of twins(i, w, h, sym)) sol[t] = v;
      }
    }
    return null;
  }

  function same(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }

  /* Which clue numbers the player has visibly finished, read from the board
   * only, never the solution (cells: 1 filled, 0 marked empty, -1 undecided).
   * Walking in from each end, while every square on the way is decided, each
   * run that is closed off by a mark or the edge is matched to the next
   * number, and that number counts as done if the lengths agree. This is the
   * usual nonogram bookkeeping, not a hint: a wrong but consistent board can
   * fade numbers too, and only finishing the picture says it is right. */
  function doneClues(cells, clue) {
    const done = clue.map(() => false);
    const n = cells.length;
    let k = 0, i = 0;
    while (i < n && k < clue.length) {
      if (cells[i] === 0) { i++; continue; }
      if (cells[i] !== 1) break;
      let e = i;
      while (e < n && cells[e] === 1) e++;
      if ((e < n && cells[e] !== 0) || e - i !== clue[k]) break;
      done[k++] = true;
      i = e;
    }
    let j = clue.length - 1;
    i = n - 1;
    while (i >= 0 && j >= k) {
      if (cells[i] === 0) { i--; continue; }
      if (cells[i] !== 1) break;
      let s = i;
      while (s >= 0 && cells[s] === 1) s--;
      if ((s >= 0 && cells[s] !== 0) || i - s !== clue[j]) break;
      done[j--] = true;
      i = s;
    }
    return done;
  }

  const api = {
    mulberry32, runs, cluesOf, fromArt, toArt, solveLine, propagate, countSolutions,
    measure, scoreOf, bandOf, generate, mirrored, FREE_SEED, density, same, doneClues,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InkEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
