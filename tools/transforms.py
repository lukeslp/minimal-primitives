"""Integration changes apply to generated files, with guarded source anchors."""
import json
import posixpath
import re
from recipes import inject
from hex_recipe import transform as transform_hex
from score_recipe import transform as transform_scores
from access_recipe import transform as transform_access
from camera_recipe import transform as transform_camera, press_first, no_eye_tracker


def replace_once(text, old, new, path):
    count = text.count(old)
    if count != 1:
        raise ValueError(f'Anchor drift in {path}: expected one {old[:70]!r}, found {count}')
    return text.replace(old, new, 1)


def replace_or_absorbed(text, old, new, path):
    """Like replace_once, but a change the source has since taken upstream is left as it is."""
    if old not in text and text.count(new) == 1:
        return text
    return replace_once(text, old, new, path)


# Puzzle sharing has no place in the package (as in Akari): Copy link copies the packaged page's own address, which
# opens nowhere else (minimal://collection/... in the iOS app), and Download is a blob: link that an app's web view
# drops while the game reports the picture saved. The Share heading and its rows are hidden in these games' Settings.
SHARE_ROW = ('<h3 class="group">Share</h3><div class="row"><span>This puzzle</span><button id="share">Copy link</button>'
             '<button id="share-picture" hidden>Share</button></div>')
DOWNLOAD_ROW = '<div class="row"><span>Colored puzzle</span><button id="download">Download</button></div>'
NO_SHARE = {'slant/index.html', 'bridges/index.html', 'galaxies/index.html', 'fold/index.html'}
# Buttons the game shows and hides itself take a rule instead of an attribute: Slant's Download drawing (Free draw)
# and Notan's Share blank (quick play), which shares the same kind of address.
NO_SHARE_RULES = {'slant/index.html': '#download-btn', 'notan/index.html': '#share-btn'}
# Hexsweeper Endless: Export run is a blob: download too (it reports "Run exported"), and Import run reads the file
# it would have made.
NO_EXPORT = ['<button type="button" class="help-pack" id="export-run-btn" data-ctl="export">Export run</button>',
             '<button type="button" class="help-pack" id="import-run-btn" data-ctl="import">Import run</button>']


# A picture leaves a game only through the system's share sheet: the other way out is a blob: download, which the
# apps' web views drop while the game reports it saved (Android's has no share sheet at all). adapters/bootstrap.js
# marks the page (data-minimal-share) where the sheet can take a picture, and these buttons show only there:
# Tangles' Save the picture on a finished board, in its board list and its Experiments (the game shares from a
# touch screen and downloads otherwise), and Hexsweeper Sphere's Share image. Each entry names the button, whether
# the game shares only from a touch screen, the script that decides, and that decision as the source has it.
SHARE_SHEET_ONLY = {
    'tangles/index.html': ('.save', True, 'tangles/loop.js'),
    'tangles/experiments.html': ('.save', True, 'tangles/experiments.js'),
    'hexsweeper/sphere/index.html': ('#share-win-btn', False, 'hexsweeper/sphere/sphere.js'),
}
SHARE_DECISIONS = {
    'tangles/loop.js': ["matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })",
                        "saver.className = 'save';"],
    'tangles/experiments.js': ["matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })",
                               "s.className = 'save';"],
    'hexsweeper/sphere/sphere.js': ['typeof navigator.share === "function" &&\n            (!navigator.canShare || navigator.canShare({ files: [file] }));',
                                    'document.getElementById("share-win-btn")'],
}
# An offered share can still fail (the sheet refused, or the press timed out while the picture was drawn). The games
# then fall through to the same blob: download; Tangles reports "Image saved." In the package a failed share says so
# instead, through the library's notice (MinimalBridge.shareFailed in adapters/bootstrap.js), and nothing is
# downloaded. A player who dismisses the sheet is told nothing, as before. Tangles draws its picture after the press,
# which can outlast the press on a slow phone; the drawn picture is kept, so the next press shares it at once.
# Tangles also downloaded (or opened a window) when the sheet would not take the picture that was actually drawn:
# the page is marked from a probe with an empty picture, which does not settle that. That branch says the same
# failure, and no download or window is left in either script. Its test for the sheet is the bootstrap's and the
# sphere's: a browser with no canShare is taken at its word that share exists.
TANGLES_SHEET = "navigator.canShare && navigator.share && navigator.canShare({ files: [file] })"
TANGLES_SHEET_AGREED = "navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))"
TANGLES_DOWNLOAD = ("    const url = URL.createObjectURL(image.blob), link = document.createElement('a');\n"
                    "    if ('download' in link) { link.href = url; link.download = image.name; document.body.append(link); link.click(); link.remove(); announce('Image saved.'); }\n"
                    "    else window.open(url, '_blank');\n"
                    "    setTimeout(() => URL.revokeObjectURL(url), 60000);\n")
TANGLES_NO_DOWNLOAD = "    window.MinimalBridge.shareFailed();\n"
SHARE_FAILED = {
    'tangles/loop.js': [
        (TANGLES_SHEET, TANGLES_SHEET_AGREED),
        (TANGLES_DOWNLOAD, TANGLES_NO_DOWNLOAD),
        ("    const image = await pictureOf(b); if (!image) return;\n",
         "    const image = window.__minimalPicture?.key === 'loop/' + id ? window.__minimalPicture.image : await pictureOf(b); if (!image) return;\n"
         "    window.__minimalPicture = { key: 'loop/' + id, image };\n"),
        ("announce('Image shared.'); return; } } catch (error) { if (error.name === 'AbortError') return; }\n",
         "announce('Image shared.'); return; } } catch (error) { if (error.name !== 'AbortError') window.MinimalBridge.shareFailed(); return; }\n"),
    ],
    'tangles/experiments.js': [
        (TANGLES_SHEET, TANGLES_SHEET_AGREED),
        (TANGLES_DOWNLOAD, TANGLES_NO_DOWNLOAD),
        ("    const image = await renderImage(e); if (!image) return;\n",
         "    const pictureKey = e.data.id + '/' + getComputedStyle(document.body).backgroundColor;\n"
         "    const image = window.__minimalPicture?.key === pictureKey ? window.__minimalPicture.image : await renderImage(e); if (!image) return;\n"
         "    window.__minimalPicture = { key: pictureKey, image };\n"),
        ("announce('Image shared.'); return; } } catch (error) { if (error.name === 'AbortError') return; }\n",
         "announce('Image shared.'); return; } } catch (error) { if (error.name !== 'AbortError') window.MinimalBridge.shareFailed(); return; }\n"),
    ],
    # The sphere's own catch marks its button "Couldn't share"; its picture was made when the board was cleared.
    'hexsweeper/sphere/sphere.js': [
        ('            if (err && err.name === "AbortError") return;\n            downloadBlob(blob, file.name);\n          }\n'
         '        } else {\n          downloadBlob(blob, file.name);\n        }\n      } catch (_) {\n',
         '            if (err && err.name === "AbortError") return;\n            throw err;\n          }\n'
         '        } else {\n          throw new Error("No share sheet");\n        }\n      } catch (_) {\n        window.MinimalBridge.shareFailed();\n'),
    ],
}
# Hexsweeper's Help named its other modes as links ("Also Infinite · Classic", "Also Sphere · Classic"). They loaded
# another packaged page inside the frame of the mode that was opened, whose saves and scores the library still held;
# the one to Sphere named a page the package does not have. The library's card offers the modes, so the rows go.
ALSO_ROWS = {
    'hexsweeper/sphere/index.html': '    <p class="help-more">Also <a href="../infinite.html">Infinite</a> · <a href="../bounded.html">Classic</a></p>\n',
    'hexsweeper/infinite.html': '    <p class="help-more">Also <a href="index.html">Sphere</a> · <a href="bounded.html">Classic</a></p>\n',
}
# Hexsweeper Sphere's Water Wheel is not in the package, and its three doors paused the timer and opened nothing:
# the wave button in Help, a hold on the mine count (whose readout filled with water as a hint), and a button for
# screen readers that named it. All three go, with the hint; the mine count is a plain readout again.
WHEEL_HELP = ('    <p class="help-egg-row" id="help-egg-row">\n'
              '      <button type="button" class="help-egg-door" id="help-wheel-btn" aria-label="Open the Water Wheel">\n'
              '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              '<path d="M12 3l4 2.3v4.6L12 12 8 9.9V5.3z"/><path d="M2.5 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2.5 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>\n'
              '      </button></p>\n')
WHEEL_CLICK = ('document.getElementById("help-wheel-btn")?.addEventListener("click", () => {\n'
               '  if (typeof sphereGame.pauseTimer === "function") sphereGame.pauseTimer();\n'
               '  window.location.href = window.HEXSWEEPER_WHEEL_HREF || "../wheel/";\n'
               '});\n')
WHEEL_HOLD = """    // Hidden second sphere. Hold the mine count and the readout fills with
    // water; keep holding and you drop into the Water Wheel (the sphere where
    // armed mines must be spun below the waterline). The sphere autosaves on
    // pagehide, so nothing is lost by leaving. Screen-reader users get the
    // same door as a named (visually hidden) button rather than a gesture.
    const wheelHref = global.HEXSWEEPER_WHEEL_HREF || "../wheel/";
    const HOLD_MS = 1200;
    let holdTimer = null;
    let hintTimer = null;
    function openWheel() {
      announce("Opening the Water Wheel");
      if (typeof game.pauseTimer === "function") game.pauseTimer();
      window.location.href = wheelHref;
    }
    function cancelHold() {
      clearTimeout(holdTimer);
      clearTimeout(hintTimer);
      holdTimer = null;
      hintTimer = null;
      mines.classList.remove("is-holding", "is-hinting");
    }
    function startHold(e) {
      if (e.type === "pointerdown" && e.button !== 0) return;
      cancelHold();
      mines.classList.add("is-holding");
      hintTimer = setTimeout(() => mines.classList.add("is-hinting"), 300);
      holdTimer = setTimeout(() => {
        cancelHold();
        openWheel();
      }, HOLD_MS);
    }
    mines.classList.add("qc-egg-door");
    mines.addEventListener("pointerdown", startHold);
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => mines.addEventListener(type, cancelHold));
    mines.addEventListener("contextmenu", (e) => e.preventDefault());
    const eggBtn = el("button", "sr-only qc-egg-btn", "Open the Water Wheel, a hidden sphere where mines are quenched underwater");
    eggBtn.type = "button";
    eggBtn.id = "qc-wheel";
    eggBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openWheel();
    });
    root.appendChild(eggBtn);

"""
# The one link out of Hexsweeper Sphere's Help that led to another publisher's site (an article on a games portal).
# The caption keeps its words; the link goes.
HISTORY_LINK = ('Riding on the original — <a href="https://www.coolmathgames.com/blog/the-history-of-minesweeper" target="_blank" '
                'rel="noopener noreferrer">history of Minesweeper</a>')
HISTORY_WORDS = 'Riding on the original — history of Minesweeper'
# Cube Maze's Hint searches in a worker and, when the worker fails, shows the stored solution's next move or points
# to Undo. A worker that cannot even be made (a web view that refuses one for the app's own address) threw instead,
# and Hint did nothing. A stand-in that reports failure sends that case down the game's own fallback.
HINT_WORKER = "  const token = ++hintToken, w = new Worker('./engine.js'); hintWorker = w; updateHintButton();\n"
HINT_WORKER_GUARDED = ("  const token = ++hintToken; let w;\n"
                       "  try { w = new Worker('./engine.js'); } catch (_) { w = { terminate() {}, postMessage() { setTimeout(() => this.onerror(), 0); } }; }\n"
                       "  hintWorker = w; updateHintButton();\n")
# The web pages count visits (GoatCounter at this host) and their content policies allow it. The package loads no
# counter: the script tag is removed, the policies stop naming the host, and no packaged file may name it.
COUNTER_HOST = 'stats.dr.eamer.dev'
POLICY = re.compile(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', re.I)


def share_sheet_only(path, text):
    if path in SHARE_DECISIONS:
        for anchor in SHARE_DECISIONS[path]:
            if text.count(anchor) != 1:
                raise ValueError(f'Share anchor drift in {path}: expected one {anchor[:70]!r}, found {text.count(anchor)}')
    for old, new in SHARE_FAILED.get(path, []):
        text = replace_once(text, old, new, path)
    if path in SHARE_SHEET_ONLY:
        selector, touch_only, _ = SHARE_SHEET_ONLY[path]
        rule = f'html:not([data-minimal-share]) {selector}{{display:none!important}}'
        if touch_only:
            rule += f'@media not (pointer:coarse){{{selector}{{display:none!important}}}}'
        text = replace_once(text, '</head>', '<style>' + rule + '</style></head>', path)
    return text


def hide(markup):
    """The same markup with every heading and row in it hidden. Bridges and Galaxies draw `.row` as a flex box after
    their `[hidden]` rule, which would show a hidden row, so the rows carry the rule themselves."""
    return markup.replace('<h3 class="group">', '<h3 class="group" hidden>').replace('<div class="row">', '<div class="row" hidden style="display:none">')


OUTSIDE_ANCHOR = re.compile(r'<a\b[^>]*?\bhref\s*=\s*(["\']?)https?://[^>]*>', re.I)
ROOT_ABSOLUTE = re.compile(r'''\b(?:href|src|action|data-other)\s*=\s*["']?/(?!/)|url\(\s*["']?/(?!/)''', re.I)


def outside_link_ok(tag):
    target = re.search(r'\btarget\s*=\s*["\']?([^"\'\s>]+)', tag, re.I)
    rel = re.search(r'\brel\s*=\s*(["\'])(.*?)\1', tag, re.I)
    return bool(target and target.group(1) == '_blank' and rel and 'noopener' in rel.group(2).lower().split())


def open_outside(text, path):
    """Links to other sites open in a new tab with noopener, never inside the itch frame."""
    def fix(match):
        tag, quote = match.group(0), match.group(1)
        if not quote:
            raise ValueError(f'Unquoted outside link in {path}: {tag[:90]!r}')
        if re.search(r'\btarget\s*=', tag, re.I):
            tag = re.sub(r'\btarget\s*=\s*(["\'])[^"\']*\1', f'target={quote}_blank{quote}', tag, count=1, flags=re.I)
        else:
            tag = tag[:-1] + f' target={quote}_blank{quote}>'
        rel = re.search(r'\brel\s*=\s*(["\'])(.*?)\1', tag, re.I)
        if not rel:
            tag = tag[:-1] + f' rel={quote}noopener{quote}>'
        elif 'noopener' not in rel.group(2).lower().split():
            tag = tag[:rel.start(2)] + (rel.group(2) + ' noopener').strip() + tag[rel.end(2):]
        return tag
    text = OUTSIDE_ANCHOR.sub(fix, text)
    for match in OUTSIDE_ANCHOR.finditer(text):
        if not outside_link_ok(match.group(0)):
            raise ValueError(f'Outside link left inside the frame in {path}: {match.group(0)[:90]!r}')
    return text


def transform(game, path, text):
    if path.endswith('.html'):
        text = re.sub(r'<script\b[^>]*(?:data-goatcounter|src=["\'][^"\']*(?:goatcounter|stats\.dr\.eamer))[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
        text = POLICY.sub(lambda policy: policy.group(0).replace(' https://' + COUNTER_HOST, ''), text)
        text = re.sub(r'\s*<!-- GoatCounter Analytics -->', '', text)
        text = re.sub(r'<meta\b[^>]*(?:property=["\'](?:og:|twitter:)|name=["\'](?:twitter:|robots))[^>]*>', '', text, flags=re.I)
        text = re.sub(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', '', text, flags=re.I)
        # Home-screen installs belong to the web pages: no manifest, service worker or install tags in the package.
        text = re.sub(r'<link\b[^>]*rel=["\']manifest["\'][^>]*>\n?', '', text, flags=re.I)
        text = re.sub(r'<meta\b[^>]*name=["\']apple-mobile-web-app-[^"\']*["\'][^>]*>\n?', '', text, flags=re.I)
        text = re.sub(r'<link\b(?=[^>]*rel=["\']apple-touch-icon["\'])(?=[^>]*href=["\']\./icons/)[^>]*>\n?', '', text, flags=re.I)
        text = re.sub(r'<script\b[^>]*src=["\']\./pwa\.js[^"\']*["\'][^>]*>\s*</script>', '', text, flags=re.I)
        # Site-wide icons point outside the export (Bending's /games/light/favicon/); the itch frame shows none.
        text = re.sub(r'<link\b(?=[^>]*\brel=["\'](?:icon|shortcut icon|apple-touch-icon)["\'])(?=[^>]*\bhref=["\']/(?!/))[^>]*>', '', text, flags=re.I)
        root = posixpath.relpath('.', posixpath.dirname('games/' + path))
        settings = {'game': game['id'], 'source': game['commit'], 'root': root}
        if game.get('camera') is False:
            settings['camera'] = False  # camera-free variant only; the full build's pages stay byte-identical
        cfg = json.dumps(settings, separators=(',', ':'))
        # Camera-free pages see no camera API, so the camera games start (and stay) on pointer.
        guard = ("Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});"
                 if game.get('camera') is False else '')
        injection = f'<script>{guard}window.MINIMAL_CONFIG={cfg};</script><script src="{root}/bootstrap.js"></script>'
        text = replace_once(text, '<head>', '<head>' + injection, path)
        text = replace_once(text, '</body>', f'<script src="{root}/hooks.js"></script></body>', path)
        # Keep links inside the export when they refer to other included games.
        folders = {'rimlight': 'bending', 'tilt-levels': 'tilt', 'akari-preview': 'akari-light'}
        def game_link(match):
            folder, tail = match.group(1), match.group(2)
            # Name the page explicitly: hosts need not serve a folder's index.html.
            if not tail or tail[0] in '?#':
                tail = 'index.html' + tail
            return f'href="{root}/games/{folders.get(folder, folder)}/{tail}"'
        text = re.sub(r'href=["\'](?:https://(?:lukesteuber\.com|dr\.eamer\.dev))?/games/(notan|akari-preview|akari|galaxies|bridges|slant|fold|rimlight|tilt-levels|horologist)/([^"\']*)["\']', game_link, text)
        # Original back links become collection navigation without extra in-game chrome.
        text = re.sub(r'href=["\'](?:https://lukesteuber\.com)?/(?:games|minimal)/?["\']', f'href="{root}/index.html" data-minimal-library', text)
        if game['id'] == 'hexsweeper':
            text = text.replace('href="../launcher.html"', f'href="{root}/index.html" data-minimal-library').replace('href="launcher.html"', f'href="{root}/index.html" data-minimal-library')
        if game['id'] == 'akari':
            other = '../akari-light/index.html' if path.startswith('akari/') else '../akari/index.html'
            text = re.sub(r'data-other="[^"]*"', 'data-other="' + other + '"', text)
            # The Share row (a web link, and on the dark board a picture share too) has no place in the package.
            # Since the Settings standard (game-riffs 622445b) the row sits under its own Share heading.
            text = replace_once(text, '<h3 class="group">Share</h3><div class="row"><span>This puzzle</span><button id="share">', '<h3 class="group" hidden>Share</h3><div class="row" hidden><span>This puzzle</span><button id="share">', path)
            if path == 'akari/index.html':
                text = replace_or_absorbed(text, 'Smooth squares are lit; hatched squares still need light.', 'Lighter panels are lit; darker panels still need light.', path)
        if path in NO_SHARE:
            text = replace_once(text, SHARE_ROW, hide(SHARE_ROW), path)
        if path == 'slant/index.html':
            text = replace_once(text, DOWNLOAD_ROW, hide(DOWNLOAD_ROW), path)
        if path in NO_SHARE_RULES:
            text = replace_once(text, '</head>', '<style>' + NO_SHARE_RULES[path] + '{display:none!important}</style></head>', path)
        if path == 'hexsweeper/infinite.html':
            for button in NO_EXPORT:
                text = replace_once(text, button, button.replace('<button ', '<button hidden ', 1), path)
        if path == 'cast/index.html':
            # The old flat Cast is not in the package: its links led back into this same page without the
            # collection's handshake, where Home, All games and Scores no longer answered. The Settings footer
            # loses the link, and the page shown without WebGL offers the way back to the library instead.
            text = replace_once(text, ' · <a href="../cast/">Cast · Old</a>', '', path)
            text = replace_once(text, '<a href="../cast/">Play Cast · Old</a>', f'<a href="{root}/index.html" data-minimal-library>Back to all games</a>', path)
        if path in ALSO_ROWS:
            text = replace_once(text, ALSO_ROWS[path], '', path)
        if path == 'hexsweeper/sphere/index.html':
            text = replace_once(text, WHEEL_HELP, '', path)
            text = replace_once(text, WHEEL_CLICK, '', path)
            text = replace_once(text, HISTORY_LINK, HISTORY_WORDS, path)
    # Pure-white lamp cores with a tight halo over a moderately lit floor.
    if path == 'akari/akari.js':
        text = replace_or_absorbed(text, "const firstVisit=!location.search&&", "const firstVisit=!['puzzle','seed','level'].some(key=>new URLSearchParams(location.search).has(key))&&", path)
    if path == 'akari/akari.css':
        # Since game-riffs PR 218 (in 57d75298) a bulb is the game's own ringed white disc, legible on the brightest
        # floor; the tight halo above was for the older small bulb and is left out for the new one.
        if '.lamp{width:32%;min-width:10px;aspect-ratio:1;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #000,' not in text:
            text = replace_or_absorbed(text, 'box-shadow:0 0 4px 2px #fff,0 0 14px 5px #ffffff66,0 0 32px 9px #ffffff20', 'box-shadow:0 0 2px 1px #fff,0 0 8px 2px #ffffff66,0 0 16px 4px #ffffff14', path)
        text = replace_or_absorbed(text, 'background:repeating-linear-gradient(135deg,transparent 0 7px,#ffffff28 7px 8px),#0003', 'background:#484848cc', path)
        # The Next fade (next-reveal) left with the continue disc (game-riffs PR 204): the frame shows the disc at the solve.
        if 'next-reveal' in text:
            text = replace_or_absorbed(text, 'animation:next-reveal .45s .4s both', 'animation:next-reveal .18s .7s both', path)
            text = replace_or_absorbed(text, '@keyframes next-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}', '@keyframes next-reveal{from{opacity:0}to{opacity:1}}', path)
    if path == 'akari/light-field.js':
        # Visual midpoint of the .31 and .96 versions after gamma encoding.
        text = replace_or_absorbed(text, 'const mapped=.31*(1-Math.exp(-e*.7))', 'const mapped=.585*(1-Math.exp(-e*.7))', path)
    # Upstream now keeps Akari's Next beside its board (controls config completionRoot), so these two apply only to older pins.
    # Its light edition's config did not name the board stage, so it got the same placement here; since game-riffs PR 261
    # (8fe53efb) Akari Classic finishes as the lit look does (Next, completion ["next-btn"], placed by the control frame
    # from __minimalize.bounds), and its Next stands where the web's does.
    if path == 'akari-light/controls.js' and 'config.completionRoot' in text and '"completionRoot"' not in text and '"completion":["completion"]' in text:
        text = replace_once(text, '{"id":"akari-light",', '{"id":"akari-light","completionRoot":"board-stage",', path)
    if game['id'] == 'akari' and path.endswith('/controls.js') and 'config.completionRoot' not in text:
        text = replace_once(text, "node.classList.add('control-completion');root.append(node);", "node.classList.add('control-completion');(byId('board-stage')||root).append(node);", path)
    if game['id'] == 'akari' and path.endswith('/controls.css') and 'data-completion-root="board-stage"' not in text:
        text = replace_once(text, 'position:fixed!important;left:50%!important;right:auto!important;top:auto!important;bottom:max(64px,calc(env(safe-area-inset-bottom) + 64px))!important;\n  transform:translateX(-50%)!important;z-index:50;', 'position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;\n  transform:none!important;z-index:50;', path)
    if game['id'] == 'akari' and path.endswith('/controls.css'):
        text = replace_once(text, 'body[data-control-frame] .control-completion:not(button)', 'body[data-control-frame] #share-btn,body[data-control-frame] .row:has(> #share) {display:none!important;}\nbody[data-control-frame] #completion:has(.milestone:not(:empty)) {grid-template-columns:48px!important;}\nbody[data-control-frame] .control-completion:not(button)', path)
    if game['id'] == 'akari' and path.endswith('/look.js'):
        text = replace_once(text, "!!other&&['lukesteuber.com','dr.eamer.dev','staging.datapoems.io'].includes(location.hostname)&&location.pathname.startsWith('/games/')", '!!other&&!!window.MINIMAL_CONFIG', path)
        text = replace_once(text, 'location.replace(other+location.search+location.hash)', "(()=>{const url=new URL(other+location.search+location.hash,location.href);if(MinimalBridge.nonce)url.searchParams.set('minimal',MinimalBridge.nonce);location.replace(url.href);})()", path)
    if path == 'hexsweeper/sphere/sphere.js':
        text = replace_once(text, 'https://dr.eamer.dev/games/hexsweeper/sphere/assets/textures/', 'assets/textures/', path)
        # A shared board picture names /minimal/, never a /games/ address (Lucas, 2026-10-20).
        text = replace_or_absorbed(text, 'octx.fillText("dr.eamer.dev/games/hexsweeper/sphere/"', 'octx.fillText("lukesteuber.com/minimal/"', path)
    if path == 'hexsweeper/sphere/quiet-chrome.js':
        text = replace_once(text, WHEEL_HOLD, '', path)
    if path == 'cube-maze/cube-maze.js':
        text = replace_once(text, HINT_WORKER, HINT_WORKER_GUARDED, path)
    if path == 'tangles/loop.js' and "location.href = './experiments.html?plus'" in text:
        # Since game-riffs PR 205 the last board's continue disc goes to New Game+ by script, not by a link the
        # collection's click handler sees, so the handshake is handed on here and Home keeps answering there. Since
        # PR 250 (57d75298) Settings' New Game+ row opens it by script too: both places, and only those two.
        plus_go = "location.href = './experiments.html?plus';"
        if text.count(plus_go) != 2:
            raise ValueError(f'Anchor drift in {path}: expected two {plus_go!r}, found {text.count(plus_go)}')
        text = text.replace(plus_go, "location.href = './experiments.html?plus' + (window.MinimalBridge && MinimalBridge.nonce ? '&minimal=' + MinimalBridge.nonce : '');")
    if path == 'tangles/experiments.js':
        # Experiments and New Game+ lead back to Tangles by its folder ('./'). The package names the page, since a
        # host need not serve a folder's index.html, and hands on the collection's handshake so Home works there.
        text = replace_once(text, "ROOT = STANDALONE ? '../' : './';",
                            "ROOT = (STANDALONE ? '../' : './') + 'index.html' + (window.MinimalBridge && MinimalBridge.nonce ? '?minimal=' + MinimalBridge.nonce : '');", path)
    text = transform_camera(game,path,press_first(game,path,transform_access(game,path,transform_scores(game,path,transform_hex(game,path,inject(game,path,text))))))
    text = no_eye_tracker(game, path, text)
    text = share_sheet_only(path, text)
    if COUNTER_HOST in text:
        raise ValueError(f'The web counter is still named in {path}')
    if path.endswith(('.html', '.js', '.mjs')):
        text = open_outside(text, path)
    if path.endswith('.html') and ROOT_ABSOLUTE.search(text):
        raise ValueError(f'Root-absolute reference in {path}: {ROOT_ABSOLUTE.search(text).group(0)!r}')
    return text
