    // In SphereSweeper.boot, retaining the private undo and focus state.
    {
      const H = window.MinimalHex;
      const excluded = ['canvas', 'ctx', 'theme', 'tiles', 'cells', 'sphere', 'timerInterval', 'projectedCache', 'rafScheduled', 'rotCacheKey'];
      const safe = () => state.cells.flatMap((c, i) => c.revealed && !c.isMine ? [i] : []);
      __hex = H.create({
        kind: 'sphere', rules: '__RULES__', started: () => !state.isFirstClick,
        difficulty: () => state.difficulty, endless: () => false, safe,
        layout: first => ({ v: 1, kind: 'sphere', difficulty: state.difficulty, subdivisions: CONFIG[state.difficulty].subdivisions, first, mines: state.cells.flatMap((c, i) => c.isMine ? [i] : []) }),
        final: won => ({ safe: safe(), counts: safe().map(i => [i, state.cells[i].neighborMines]), mines: state.cells.flatMap((c, i) => c.isMine ? [i] : []), over: state.isGameOver, won }),
        snapshot() {
          const now = performance.now();
          return { help: { held: helpLifecycleHeld, markWelcomeSeen, focus: helpFocusReturn?.id, trap: !!releaseFocusTrap, opening: !!helpOpenFrame }, viewport: [canvas.width, canvas.height], timerRemaining: state.timerInterval ? Math.max(0, 1000 - (now - __hexTickAt)) : null, run: exportRunState() || { v: 2, kind: runKind, difficulty: state.difficulty, first: true, over: false, won: false, flags: 0, mineCount: state.mineCount, time: state.timeElapsed, mines: [], revealed: [], flagged: [], rotX: state.rotX, rotY: state.rotY, zoom: state.zoomFactor }, state: H.pack(H.omit(state, excluded), now), cells: H.pack(state.cells, now), undo: H.pack(undoSnapshot, now), fx: H.pack(END_FX, now), focus: H.pack(focusRestore, now), themeIndex, runId, completionEmitted, lastVariantState };
        },
        restore(d) {
          if (!d?.run || !Array.isArray(d.cells) || !THEMES[d.themeIndex] || !(d.timerRemaining === null || Number.isFinite(d.timerRemaining) && d.timerRemaining >= 0 && d.timerRemaining <= 1000) || !CONFIG[d.run.difficulty] || d.cells.length !== 10 * CONFIG[d.run.difficulty].subdivisions ** 2 + 2 || !d.state || d.state.difficulty !== d.run.difficulty || (d.undo && (!d.undo.revealed || !d.undo.flagged || d.undo.revealed.value?.length !== d.cells.length || d.undo.flagged.value?.length !== d.cells.length))) throw Error('Invalid Sphere snapshot');
          cancelAnimationFrame(focusTween); focusTween = 0;
          cancelHelpOpenFrame();
          releaseFocusTrap?.(); releaseFocusTrap = null;
          applyTheme(d.themeIndex, { persist: false });
          if (!applyRunState(d.run)) throw Error('Invalid Sphere board snapshot');
          const now = performance.now();
          Object.assign(state, H.unpack(d.state, now));
          state.cells = H.unpack(d.cells, now);
          undoSnapshot = H.unpack(d.undo, now);
          Object.assign(END_FX, H.unpack(d.fx, now));
          focusRestore = H.unpack(d.focus, now);
          runId = d.runId; completionEmitted = d.completionEmitted; lastVariantState = d.lastVariantState;
          stopTimer();
          if (d.timerRemaining !== null) {
            const left = Math.max(0, Math.min(1000, d.timerRemaining));
            __hexTickAt = now - (1000 - left);
            state.timerInterval = setTimeout(() => {
              state.timerInterval = null; state.timeElapsed++; updateUI();
              schedulePersist(); startTimer(state.timeElapsed);
            }, left);
          }
          if (d.viewport[0] !== canvas.width || d.viewport[1] !== canvas.height) resize();
          invalidateProjection(); updateUI(); syncSizeChrome(); syncHelpControls?.();
          helpLifecycleHeld = !!d.help?.held; markWelcomeSeen = !!d.help?.markWelcomeSeen;
          helpFocusReturn = document.getElementById(d.help?.focus) || null;
          if (d.help?.trap && helpOverlay) releaseFocusTrap = trapFocus(helpOverlay);
          if (d.help?.opening) helpOpenFrame = requestAnimationFrame(() => { helpOpenFrame = 0; helpOverlay?.classList.add('open'); });
          if (state.isGameOver) showTerminalBanner(state.won);
          persistNow(); scheduleFrame();
        }
      });
      __hex.install();
    }
