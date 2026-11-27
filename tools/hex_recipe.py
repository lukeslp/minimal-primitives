"""Guarded Hexsweeper hooks for generated copies of the pinned source (PIN) only.

Wire: import transform as transform_hex from hex_recipe; return
transform_hex(game, path, inject(game, path, text)) at the end of transforms.py.
The optional session-storage bootstrap and shared helper are embedded in HTML;
no additional build copy step is needed. Raw imports must remain byte-identical.

Validator wiring: import { validateHexProof } from './hex-validator.mjs' into
adapters/validators.mjs and dispatch identity.game === 'hexsweeper' to it.
Pass {identity, proof, elapsedMs} with service-measured elapsedMs. It returns
{value} or throws. time-v1 uses elapsedMs; cleared-v1 uses safe cells at run end.
Keep the raw pinned imports available to the Node validator (not generated JS).
Modes: sphere:<size>, classic:<size>, infinite-<lane>:<size>; Dark shares the
Light scoring lane. The initial mine layout is bound to layoutHash before the
first reveal; later Infinite expansion does not change the run identity.
Restored native saves without a known first dig fail ranked validation closed.

The imported Infinite root deliberately scopes Light/Dark via ONEPAGER. Legacy
Escape/Fire/Plague/Water paths are verified through a test-only override, not
unlocked by this transform. No registered root runtime assets were missing.
Importer gaps outside those entries: skins/*.html need core.js from the same
source commit; Sphere's hidden Water Wheel control targets the excluded wheel/
directory, so tools/transforms.py cuts its three doors from the generated copy
(WHEEL_HELP, WHEEL_CLICK, WHEEL_HOLD). Do not alter raw source snapshots.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PIN = '435c8557ee218245d23d42ffa44b32308ff9cfcb'


def exact(text, anchor, replacement, path):
    count = text.count(anchor)
    if count != 1:
        raise ValueError(f'Hex adapter anchor drift in {path}: {anchor[:85]!r}: {count}')
    return text.replace(anchor, replacement, 1)


def script(name, rules=''):
    return (ROOT / 'adapters/private' / name).read_text().replace('__RULES__', rules)


def adopt(text, anchor, replacement, path):
    if anchor not in text and text.count(replacement) == 1:
        return text
    return exact(text, anchor, replacement, path)


MENU_INSTRUCTIONS = '<div class="instructions-text">Tap to reveal · flag: right-click, Ctrl-click, or long-hold<br>Menu holds scores · Reset on the board</div>'
MENU_INSTRUCTIONS_NEXT = '<div class="instructions-text"><span class="menu-touch-instructions">Tap to reveal · hold to flag</span><span class="menu-pointer-instructions">Click to reveal · right-click or Ctrl-click to flag</span><br>Menu holds scores · Reset on the board</div>'
MENU_INPUT_CSS = '''.menu-touch-instructions { display: none; }
.menu-pointer-instructions { display: inline; }
@media (hover: none) and (pointer: coarse) {
  .menu-touch-instructions { display: inline; }
  .menu-pointer-instructions { display: none; }
}
.instructions-text {'''
MENU_LIFECYCLE = '''    function openModal() {
      if (modal) modal.classList.add("open");
    }
    function closeModal() {
      if (modal) modal.classList.remove("open");
    }'''
MENU_LIFECYCLE_NEXT = '''    let menuFocusReturn = null;
    let menuIsOpen = false;
    function syncMenuFocus() {
      const open = !!modal?.classList.contains("open");
      if (open === menuIsOpen) return;
      menuIsOpen = open;
      if (open) {
        menuFocusReturn ||= document.activeElement;
        modal.inert = false;
        closeBtn?.focus();
      } else {
        if (menuFocusReturn?.isConnected) menuFocusReturn.focus();
        menuFocusReturn = null;
        modal.inert = true;
      }
    }
    if (modal) {
      modal.inert = !modal.classList.contains("open");
      new MutationObserver(syncMenuFocus).observe(modal, { attributes: true, attributeFilter: ["class"] });
      syncMenuFocus();
    }
    function openModal(event) {
      if (!modal || modal.classList.contains("open")) return;
      menuFocusReturn = event?.currentTarget || document.activeElement;
      modal.classList.add("open");
      syncMenuFocus();
    }
    function closeModal() {
      if (!modal || !modal.classList.contains("open")) return;
      modal.classList.remove("open");
      syncMenuFocus();
    }
    document.addEventListener("keydown", (event) => {
      if (!modal?.classList.contains("open")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
      } else if (event.key === "Tab") {
        const card = modal.querySelector(".modal-content");
        const stops = Array.from(card.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'))
          .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") &&
            node.getClientRects().length && getComputedStyle(node).visibility === "visible");
        const first = stops[0] || closeBtn;
        const last = stops[stops.length - 1] || closeBtn;
        if (!stops.includes(document.activeElement) ||
            (event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    }, true);'''


def menu_footer(text, path):
    for domain, label in [('lukesteuber.com', 'Luke Steuber'), ('datapoems.io', 'Data Poems')]:
        anchor = f'<a href="https://{domain}" target="_blank" rel="noopener noreferrer">{label}</a>'
        text = adopt(text, anchor, anchor.replace(f'>{label}<', f'>{domain}<'), path)
    return text


def menu_instructions(text, path):
    text = adopt(text, MENU_INSTRUCTIONS, MENU_INSTRUCTIONS_NEXT, path)
    if text.count(MENU_INPUT_CSS) == 1:
        return text
    return exact(text, '.instructions-text {', MENU_INPUT_CSS, path)


def menu_dialog(text, path):
    return adopt(text, MENU_LIFECYCLE, MENU_LIFECYCLE_NEXT, path)


def transform(game, path, text):
    if game['id'] != 'hexsweeper':
        return text
    if game['commit'] != PIN:
        raise ValueError('Hex adapter requires the accepted source pin (PIN)')
    if path == 'hexsweeper/bounded.html':
        text = menu_dialog(menu_instructions(menu_footer(text, path), path), path)
    sphere = path == 'hexsweeper/sphere/sphere.js'
    flat = path in ('hexsweeper/bounded.html', 'hexsweeper/infinite.html')
    entry = flat or path == 'hexsweeper/sphere/index.html'
    if not sphere and not entry:
        return text
    if entry:
        # Run after the collection bootstrap and before any upstream script.
        anchors = re.findall(r'<script src="[^"]*bootstrap\.js"></script>', text)
        if len(anchors) != 1:
            raise ValueError(f'Hex adapter requires one collection bootstrap in {path}')
        text = exact(text, anchors[0], anchors[0] + '<script>\n' + script('hex-bootstrap.js') + '\n</script>', path)
    if sphere or flat:
        text = exact(text, '      state.timerInterval = setInterval(() => {', '      __hexTickAt = performance.now();\n      state.timerInterval = setInterval(() => {\n        __hexTickAt = performance.now();', path)
    if sphere:
        rules = next(f['sha256'][:16] for f in game['files'] if f['path'] == path)
        text = exact(text, '  function boot(opts) {', '  function boot(opts) {\n    let __hex = null, __hexTickAt = 0;', path)
        text = exact(text, '        state.isFirstClick = false;\n        startTimer();', '        state.isFirstClick = false;\n        __hex?.begin(idx);\n        startTimer();', path)
        text = exact(text, '        startWinFx();', '        __hex?.terminal(true);\n        startWinFx();', path)
        text = exact(text, '    function persistNow() {\n', '    function persistNow() {\n      __hex?.changed();\n', path)
        text = exact(text, '      hideBanner();\n      if (!state.isFirstClick) startTimer();', '      hideBanner();\n      __hex?.invalidate();\n      if (!state.isFirstClick) startTimer();', path)
        text = exact(text, '    function resetGame(optsReset) {', '    function resetGame(optsReset) {\n      __hex?.reset();', path)
        text = exact(text, '    return {\n      reset: () => requestReset({ force: true }),', script('hex-sphere.js', rules) + '\n    return {\n      reset: () => requestReset({ force: true }),', path)
    if flat:
        rules = next(f['sha256'][:16] for f in game['files'] if f['path'] == path)
        text = exact(text, '  function boot(userOpts = {}) {', '  function boot(userOpts = {}) {\n    let __hex = null, __hexRestoring = false, __hexTickAt = 0;', path)
        text = exact(text, '        state.isFirstClick = false;\n      }\n      cell.revealed = true;', '        state.isFirstClick = false;\n        __hex?.begin(`${cell.q},${cell.r}`);\n      }\n      cell.revealed = true;', path)
        text = exact(text, '      const reason = state.endReason || (win ? "win" : "mine");', '      const reason = state.endReason || (win ? "win" : "mine");\n      __hex?.terminal(win, reason);', path)
        text = exact(text, '      if (state.endless && !state.isGameOver) ensureWorldCoverage(true);', '      if (state.endless && !state.isGameOver && !__hexRestoring) ensureWorldCoverage(true);', path)
        text = exact(text, '    function resetGame(options = {}) {', '    function resetGame(options = {}) {\n      __hex?.reset();', path)
        text = exact(text, '    return api;\n  }\n\n  global.Hexsweeper = {', script('hex-flat.js', rules).replace('__KIND__', 'infinite' if path.endswith('/infinite.html') else 'classic') + '\n    return api;\n  }\n\n  global.Hexsweeper = {', path)
        if path.endswith('/infinite.html'):
            text = exact(text, '  let introZoomFrame = 0;', '  let introZoomFrame = 0;\n  let __hexIntro = null;', path)
            text = exact(text, '    introZoomFrame = 0;\n    introZoomExpect = 0;', '    introZoomFrame = 0;\n    introZoomExpect = 0;\n    __hexIntro = null;', path)
            text = exact(text, '  function runIntroZoom(api, from, to, ms) {', '  function runIntroZoom(api, from, to, ms, resume) {', path)
            text = exact(text, '    api.setZoom(from, null, { persist: false });', '    api.setZoom(resume ? api.state.viewZoom : from, null, { persist: false });', path)
            text = exact(text, '    const t0 = performance.now();\n    const step = (now) => {\n      if (api.state', '    const t0 = resume ? resume.t0 : performance.now();\n    __hexIntro = { from, to, ms, t0 };\n    const step = (now) => {\n      if (api.state', path)
            text = exact(text, '  // Test/debug: window.__hexBlast.force() after first click places mines', script('hex-infinite.js') + '\n  // Test/debug: window.__hexBlast.force() after first click places mines', path)
        else:
            text = exact(text, 'document.addEventListener("click", (event) => {\n  if (event.target.closest(".app-back")) flushClassicRun();', 'classicGame.__minimalHex.install();\n\ndocument.addEventListener("click", (event) => {\n  if (event.target.closest(".app-back")) flushClassicRun();', path)
    return text
