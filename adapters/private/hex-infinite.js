  // Infinite's theme/escape session lives outside Hexsweeper.boot.
  game.__minimalHex.install({
    mode: () => `infinite-${THEMES[themeIndex].id === 'dark' ? 'light' : THEMES[themeIndex].id}`,
    proof: () => ({ mode: THEMES[themeIndex].id, rift: { phase: RIFT.phase, catchKey: RIFT.catchKey, lastDigKey: RIFT.lastDigKey } }),
    snapshot() {
      const now = performance.now();
      return { helpFocus: helpFocusReturn?.id, intro: MinimalHex.pack(__hexIntro, now), themeIndex, rift: MinimalHex.pack(RIFT, now), blast: MinimalHex.pack(BLAST, now), seep: MinimalHex.pack(SEEP, now), particles: MinimalHex.pack(particles, now), streaks: MinimalHex.pack(streaks, now), ox, oy, tx, ty, lastAmbientThemeId, fireSpiteBurpAt: fireSpiteBurpAt - now, introZoomExpect };
    },
    restore(d, prepare) {
      if (!d || !THEMES[d.themeIndex]) throw Error('Invalid Infinite session snapshot');
      cancelIntroZoom(); clearTimeout(persistTimer);
      if (prepare) {
        persistSuspended = true;
        // Recreate chrome/config without running applyTheme's lane rebuilds,
        // random opening dig, native autosave restore or mode navigation.
        themeIndex = d.themeIndex;
        const t = THEMES[themeIndex];
        applyChrome(t);
        Object.assign(game.state.theme, t.theme);
        if (t.theme.text) game.state.theme.text = { ...game.state.theme.text, ...t.theme.text };
        game.state.config = t.boardConfig || (t.endless ? Hexsweeper.DEFAULT_CONFIG : FINITE_DEFAULT_CONFIG);
        game.state.endless = !!t.endless;
        game.state.hooks.cameraLock = t.profile?.camera === 'tilt';
        return;
      }
      const now = performance.now();
      Object.assign(RIFT, MinimalHex.unpack(d.rift, now));
      Object.assign(BLAST, MinimalHex.unpack(d.blast, now));
      Object.assign(SEEP, MinimalHex.unpack(d.seep, now));
      particles.splice(0, particles.length, ...MinimalHex.unpack(d.particles, now));
      streaks.splice(0, streaks.length, ...MinimalHex.unpack(d.streaks, now));
      ({ ox, oy, tx, ty, lastAmbientThemeId, introZoomExpect } = d);
      fireSpiteBurpAt = now + d.fireSpiteBurpAt;
      const intro = MinimalHex.unpack(d.intro, now);
      if (intro) runIntroZoom(game, intro.from, intro.to, intro.ms, intro);
      helpFocusReturn = document.getElementById(d.helpFocus) || null;
      gameApi = game;
      syncSettingsRows(); syncHelpContent();
      persistSuspended = false;
      flushPersist();
    }
  });
