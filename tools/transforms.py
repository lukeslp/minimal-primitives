"""Integration changes apply to generated files, with guarded source anchors."""
import json
import posixpath
import re
from recipes import inject
from hex_recipe import transform as transform_hex
from score_recipe import transform as transform_scores
from access_recipe import transform as transform_access
from camera_recipe import transform as transform_camera


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
        text = re.sub(r'<meta\b[^>]*(?:property=["\'](?:og:|twitter:)|name=["\'](?:twitter:|robots))[^>]*>', '', text, flags=re.I)
        text = re.sub(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', '', text, flags=re.I)
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
            text = replace_once(text, '<div class="row"><span>Share</span><button id="share">Copy link</button></div>', '<div class="row" hidden><span>Share</span><button id="share">Copy link</button></div>', path)
            if path == 'akari/index.html':
                text = replace_or_absorbed(text, 'Smooth squares are lit; hatched squares still need light.', 'Lighter panels are lit; darker panels still need light.', path)
    # Pure-white lamp cores with a tight halo over a moderately lit floor.
    if path == 'akari/akari.js':
        text = replace_or_absorbed(text, "const firstVisit=!location.search&&", "const firstVisit=!['puzzle','seed','level'].some(key=>new URLSearchParams(location.search).has(key))&&", path)
    if path == 'akari/akari.css':
        text = replace_or_absorbed(text, 'box-shadow:0 0 4px 2px #fff,0 0 14px 5px #ffffff66,0 0 32px 9px #ffffff20', 'box-shadow:0 0 2px 1px #fff,0 0 8px 2px #ffffff66,0 0 16px 4px #ffffff14', path)
        text = replace_or_absorbed(text, 'background:repeating-linear-gradient(135deg,transparent 0 7px,#ffffff28 7px 8px),#0003', 'background:#484848cc', path)
        text = replace_or_absorbed(text, 'animation:next-reveal .45s .4s both', 'animation:next-reveal .18s .7s both', path)
        text = replace_or_absorbed(text, '@keyframes next-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}', '@keyframes next-reveal{from{opacity:0}to{opacity:1}}', path)
    if path == 'akari/light-field.js':
        # Visual midpoint of the .31 and .96 versions after gamma encoding.
        text = replace_or_absorbed(text, 'const mapped=.31*(1-Math.exp(-e*.7))', 'const mapped=.585*(1-Math.exp(-e*.7))', path)
    # Upstream now keeps Akari's Next beside its board (controls config completionRoot), so these two apply only to older pins.
    # Its light edition's config does not name the board stage yet, so it gets the same placement here.
    if path == 'akari-light/controls.js' and 'config.completionRoot' in text and '"completionRoot"' not in text:
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
        text = replace_once(text,'window.location.href = wheelHref;', 'window.open(new URL(wheelHref,"https://dr.eamer.dev/games/hexsweeper/sphere/index.html").href,"_blank","noopener,noreferrer");',path)
    if path == 'hexsweeper/sphere/index.html':
        text = replace_once(text,'window.location.href = window.HEXSWEEPER_WHEEL_HREF || "../wheel/";', 'window.open(new URL(window.HEXSWEEPER_WHEEL_HREF || "../wheel/","https://dr.eamer.dev/games/hexsweeper/sphere/index.html").href,"_blank","noopener,noreferrer");',path)
    text = transform_camera(game,path,transform_access(game,path,transform_scores(game,path,transform_hex(game,path,inject(game,path,text)))))
    if path.endswith(('.html', '.js', '.mjs')):
        text = open_outside(text, path)
    if path.endswith('.html') and ROOT_ABSOLUTE.search(text):
        raise ValueError(f'Root-absolute reference in {path}: {ROOT_ABSOLUTE.search(text).group(0)!r}')
    return text
