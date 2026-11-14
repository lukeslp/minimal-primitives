/* Tilt · Levels rules. Luke Steuber. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TiltStack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
  const ORDER = ['U', 'R', 'D', 'L'];

  function fail(errors, message) {
    errors.push(message);
    return null;
  }

  function prepare(board) {
    const errors = [];
    if (!board || typeof board !== 'object' || !Array.isArray(board.levels)) return { errors: ['missing levels'] };
    const levels = board.levels;
    if (levels.length < 2 || levels.length > 3) errors.push('need two or three levels');
    const size = Array.isArray(levels[0]) ? levels[0].length : 0;
    if (size < 2 || size > 8) errors.push('bad size');
    let start = null;
    const grid = [];
    for (let level = 0; level < levels.length; level++) {
      const rows = levels[level];
      if (!Array.isArray(rows) || rows.length !== size) {
        errors.push('level ' + level + ' is not square');
        continue;
      }
      const parsed = [];
      for (let row = 0; row < size; row++) {
        const line = rows[row];
        if (typeof line !== 'string' || line.length !== size) {
          errors.push('bad row');
          parsed.push(Array(size).fill('.'));
          continue;
        }
        const cells = [];
        for (let col = 0; col < size; col++) {
          const ch = line[col];
          if (ch === '@') {
            if (level !== 0 || start) errors.push('start must be one cell on the top level');
            start = { level: 0, row: row, col: col };
            cells.push('.');
          } else if (ch === '.' || ch === '#' || ch === 'o') cells.push(ch);
          else errors.push('bad cell');
        }
        parsed.push(cells);
      }
      grid.push(parsed);
    }
    if (!start) errors.push('missing start');
    if (!errors.length) {
      let bottomHoles = 0;
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (grid[grid.length - 1][row][col] === 'o') bottomHoles++;
          for (let level = 0; level < grid.length - 1; level++) {
            if (grid[level][row][col] === 'o' && grid[level + 1][row][col] === '#') errors.push('hole above a block');
          }
        }
      }
      if (bottomHoles !== 1) errors.push('bottom level needs exactly one hole');
    }
    if (errors.length) return { errors: errors };
    return { id: board.id, levels: grid.length, size: size, grid: grid, start: start, errors: [] };
  }

  function keyOf(state) {
    return state.level + ',' + state.row + ',' + state.col;
  }

  function solved(puzzle, state) {
    return state.level === puzzle.levels - 1 && puzzle.grid[state.level][state.row][state.col] === 'o';
  }

  function slidePrepared(puzzle, state, dir) {
    if (!Object.prototype.hasOwnProperty.call(DIRS, dir)) throw new Error('Bad direction');
    const step = DIRS[dir];
    let level = state.level;
    let row = state.row;
    let col = state.col;
    if (solved(puzzle, state)) return { level: level, row: row, col: col, moved: false, solved: true, path: [] };
    const path = [];
    while (true) {
      const nr = row + step[0];
      const nc = col + step[1];
      if (nr < 0 || nc < 0 || nr >= puzzle.size || nc >= puzzle.size) break;
      const cell = puzzle.grid[level][nr][nc];
      if (cell === '#') break;
      row = nr;
      col = nc;
      path.push({ level: level, row: row, col: col, drop: false });
      if (cell === 'o') {
        while (level < puzzle.levels - 1 && puzzle.grid[level][row][col] === 'o') {
          level++;
          path.push({ level: level, row: row, col: col, drop: true });
        }
        break;
      }
    }
    return {
      level: level,
      row: row,
      col: col,
      moved: path.length > 0,
      solved: solved(puzzle, { level: level, row: row, col: col }),
      path: path
    };
  }

  function puzzleOf(board) {
    const puzzle = prepare(board);
    if (puzzle.errors.length) throw new Error(puzzle.errors[0]);
    return puzzle;
  }

  function start(board) {
    const puzzle = puzzleOf(board);
    return { level: puzzle.start.level, row: puzzle.start.row, col: puzzle.start.col };
  }

  function slide(board, state, dir) {
    return slidePrepared(puzzleOf(board), state, dir);
  }

  function solvePrepared(puzzle, state) {
    const startState = state || puzzle.start;
    if (solved(puzzle, startState)) return [];
    const queue = [{ level: startState.level, row: startState.row, col: startState.col, moves: [] }];
    const seen = new Set([keyOf(startState)]);
    while (queue.length) {
      const cur = queue.shift();
      for (let i = 0; i < ORDER.length; i++) {
        const dir = ORDER[i];
        const next = slidePrepared(puzzle, cur, dir);
        if (!next.moved) continue;
        const key = keyOf(next);
        if (seen.has(key)) continue;
        const moves = cur.moves.concat(dir);
        if (next.solved) return moves;
        seen.add(key);
        queue.push({ level: next.level, row: next.row, col: next.col, moves: moves });
      }
    }
    return null;
  }

  function solve(board, state) {
    const puzzle = puzzleOf(board);
    return solvePrepared(puzzle, state || puzzle.start);
  }

  function par(board) {
    const moves = solve(board);
    if (!moves) throw new Error('No solution');
    return moves.length;
  }

  function mapCells(levels, fn) {
    const size = levels[0].length;
    return levels.map(function (rows) {
      const next = Array.from({ length: size }, function () { return Array(size).fill('.'); });
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const at = fn(row, col, size);
          next[at[0]][at[1]] = rows[row][col];
        }
      }
      return next.map(function (row) { return row.join(''); });
    });
  }

  function canonical(board) {
    const puzzle = prepare(board);
    if (puzzle.errors.length) throw new Error(puzzle.errors[0]);
    const levels = board.levels;
    const forms = [
      function (r, c, n) { return [r, c]; },
      function (r, c, n) { return [c, n - 1 - r]; },
      function (r, c, n) { return [n - 1 - r, n - 1 - c]; },
      function (r, c, n) { return [n - 1 - c, r]; },
      function (r, c, n) { return [r, n - 1 - c]; },
      function (r, c, n) { return [n - 1 - r, c]; },
      function (r, c, n) { return [c, r]; },
      function (r, c, n) { return [n - 1 - c, n - 1 - r]; }
    ].map(function (fn) { return JSON.stringify(mapCells(levels, fn)); });
    forms.sort();
    return forms[0];
  }

  return {
    DIRS: DIRS,
    ORDER: ORDER,
    prepare: prepare,
    start: start,
    slide: slide,
    solve: solve,
    par: par,
    canonical: canonical
  };
});
