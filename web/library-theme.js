/* The library's theme, set before it paints so nothing flashes. As on the Minimal index, the library follows the
   phone or computer until a theme is chosen: Light when it is set to light, Dark when it is set to dark, and the
   Checkerboard where neither can be read. Dark puts every tile on black with no gaps, Light on white; Checkerboard
   is the index's alternating ground (no data-look at all). A choice of Dark, Light or Checkerboard stays put; System
   goes back to following. The choice, with the library's Motion setting, is kept with the collection's own
   preferences (collection.js writes it from the Scores and settings sheet). */
(() => {
  'use strict';
  const PREFIX = 'lukesteuber.minimal.collection.v1:', KEY = PREFIX + 'library', THEMES = ['dark', 'light', 'checkerboard'];
  const GROUND = {dark: '#000000', light: '#ffffff', checkerboard: '#e6e6e6'};
  const asks = query => !!(window.matchMedia && matchMedia(query).matches);
  const system = () => asks('(prefers-color-scheme: dark)') ? 'dark' : asks('(prefers-color-scheme: light)') ? 'light' : 'checkerboard';
  // What the setting says: one of the three themes, or 'system'.
  const setting = prefs => THEMES.includes(prefs?.theme) ? prefs.theme : 'system';
  // Applies the setting and returns the theme now showing.
  const apply = prefs => {
    const chosen = setting(prefs), theme = chosen === 'system' ? system() : chosen, root = document.documentElement;
    if (theme === 'checkerboard') root.removeAttribute('data-look'); else root.setAttribute('data-look', theme);
    if (prefs?.motion === 'reduce') root.setAttribute('data-motion', 'reduce'); else root.removeAttribute('data-motion');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = GROUND[theme];
    return theme;
  };
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
  const prefs = kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  apply(prefs);
  // The opening is the app's loader: decide before the first paint whether this launch opens with it, so its ground
  // is the first thing drawn (the iOS launch screen's color). It plays the first time the app is opened, at the
  // library, with motion; not when the app opens straight into a game. collection.js has the last word and clears this.
  let seen = false, selected = null;
  try { seen = localStorage.getItem(PREFIX + 'opening') === '1'; selected = sessionStorage.getItem(PREFIX + 'selected'); } catch (_) {}
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!seen && !selected && !hash.get('game') && !hash.get('view')
      && !asks('(prefers-reduced-motion: reduce)') && prefs.motion !== 'reduce') document.documentElement.classList.add('opening');
  window.MinimalLibraryTheme = {apply, setting, system, themes: THEMES};
})();
