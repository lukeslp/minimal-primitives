/* Tilt · 3D. Puts the saved theme on the page before anything is drawn, so it never shows the other one first. Luke Steuber. */
(function () {
  var theme = 'dark';
  try {
    var v = JSON.parse(localStorage.getItem('tilt-3d.v1'));
    var t = v && v.version === 1 && v.settings && v.settings.theme;
    if (t === 'light' || t === 'dark' || t === 'system') theme = t;
  } catch (e) {}
  document.documentElement.dataset.theme = theme;
  var light = theme === 'light' || (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = light ? '#f3f0e9' : '#1a1a1a';
})();
