    // In Hexsweeper.boot's private scope; the outer page installs after boot.
    {
      const H = window.MinimalHex;
      const excluded = ['canvas', 'ctx', 'map', 'theme', 'config', 'hooks', 'timerInterval'];
      const entries = () => [...state.map];
      const refs = () => new Map(entries().map(([key, cell]) => [cell, key]));
      const safe = () => entries().filter(([, c]) => c.revealed && !c.isMine).map(([k]) => k).sort();
      __hex = H.create({
        kind: '__KIND__', rules: '__RULES__',
        started: () => !state.isFirstClick, difficulty: () => state.currentDifficulty, endless: () => state.endless, safe,
        layout: first => ({ v: 1, kind: '__KIND__', difficulty: state.currentDifficulty, endless: state.endless, radius: state.mapRadius, density: state.mineDensity, finish: state.finishKey, first, mines: entries().filter(([, c]) => c.isMine).map(([k]) => k).sort() }),
        final: (won, reason) => ({ radius: state.mapRadius, mines: entries().filter(([, c]) => c.isMine).map(([k]) => k).sort(), safe: safe(), counts: safe().map(k => [k, state.map.get(k).neighborMines]), won, reason: reason || (won ? 'win' : 'mine'), over: state.isGameOver, finish: state.finishKey, detonator: state.detonator ? `${state.detonator.q},${state.detonator.r}` : null, torn: entries().filter(([, c]) => c._riftTorn).map(([k]) => k).sort() }),
        snapshot() {
          const now = performance.now();
          return { viewport: [canvas.width, canvas.height], timerRemaining: state.timerInterval ? Math.max(0, 1000 - (now - __hexTickAt)) : null, run: exportRunState(), state: H.pack(H.omit(state, excluded), now, refs()), cells: entries().map(([k, c]) => [k, H.pack(c, now)]), input: H.pack({ lastClickTime, lastClickKey, suppressTapReveal, digSession, pinchStartDist, pinchStartZoom, touchStartPos, touchStartKey, touchMoved, touchFlagged, touchPanOrigin }, now) };
        },
        restore(d) {
          if (!d?.run || !Number.isInteger(d.run.radius) || d.run.radius < 1 || d.run.radius > 160 || !(d.timerRemaining === null || Number.isFinite(d.timerRemaining) && d.timerRemaining >= 0 && d.timerRemaining <= 1000) || !state.config[d.run.difficulty] || !Array.isArray(d.cells) || d.cells.length !== 1 + 3 * d.run.radius * (d.run.radius + 1) || !d.state || d.state.currentDifficulty !== d.run.difficulty || new Set(d.cells.map(row => row[0])).size !== d.cells.length || d.cells.some(([key, c]) => key !== `${c.q},${c.r}` || Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) > d.run.radius)) throw Error('Invalid Hexsweeper board snapshot');
          __hexRestoring = true;
          try { if (!applyRunState(d.run)) throw Error('Invalid Hexsweeper board snapshot'); } finally { __hexRestoring = false; }
          // applyRunState may expand for the viewport. Rebuild the exact saved map
          // (including pending floods) so switching itself consumes no randomness.
          const now = performance.now();
          state.map.clear();
          for (const [key, packed] of d.cells) {
            const data = H.unpack(packed, now);
            const c = new Cell(data.q, data.r);
            c.calcGeometry(state.centerX, state.centerY, state.cellSize);
            Object.assign(c, data); state.map.set(key, c);
          }
          const cellRefs = new Map(state.map);
          Object.assign(state, H.unpack(d.state, now, cellRefs));
          const input = H.unpack(d.input, now);
          ({ lastClickTime, lastClickKey, suppressTapReveal, digSession, pinchStartDist, pinchStartZoom, touchStartPos, touchStartKey, touchMoved, touchFlagged, touchPanOrigin } = input);
          clearTimeout(longPressTimer);
          stopTimer();
          if (d.timerRemaining !== null) {
            const left = Math.max(0, Math.min(1000, d.timerRemaining));
            __hexTickAt = now - (1000 - left);
            state.timerInterval = setTimeout(() => {
              state.timerInterval = null; state.timeElapsed++; updateUI();
              state.hooks.onPersistTick?.(api); startTimer(state.timeElapsed);
            }, left);
          }
          if (d.viewport[0] !== canvas.width || d.viewport[1] !== canvas.height) relayout();
          api.setFlagMode(state.flagMode); updateUI(); syncCursor(); resumeGameLoop();
        }
      });
      api.__minimalHex = __hex;
      // These wrappers observe committed actions without replacing game rules.
      const observe = fn => function() { const result = fn.apply(this, arguments); __hex.changed(); return result; };
      reveal = observe(reveal); chord = observe(chord); toggleFlag = observe(toggleFlag);
      stepRevealWave = observe(stepRevealWave);
      // No per-frame snapshots: observe only frames which had pending reveals.
      const wave = stepRevealWave;
      stepRevealWave = function() { if (state.floodPending) return wave(); };
      applyViewZoom = observe(applyViewZoom);
      const apply = applyRunState;
      applyRunState = function(d) { const ok = apply(d); if (ok && !__hexRestoring) __hex.resumed(); return ok; };
    }
