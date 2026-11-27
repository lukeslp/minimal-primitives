"""Camera changes for the package.

Every build: the camera starts only after the player selects a camera control in
the game that is open (`press_first`, below).

Camera-free variant: build-only changes that take head and eye input out.

Applies only when a variant sets "camera": false (variants.json). The full build
is untouched. Every game stays, and every switch, touch and pointer
accommodation stays: Look and hold keeps its pointer form (dwell with a finger,
mouse or head mouse), and the one-switch games are unchanged. What goes is the
head, eye and eye-tracker input and the camera games' camera controls and
camera wording. Every anchor must match exactly once, so an upstream change
fails the build instead of shipping a half-hidden camera.
"""
import re

# The shared control frame offers these look sources in every game that has one.
LOOK_ROW = ("row('look','Look with',[['head','Head',!camOK],['eyes','Eyes',!camOK],"
            "['pointer','Pointer'],['tracker','Eye tracker',!trackOK]])")
POINTER_ROW = "row('look','Look with',[['pointer','Pointer']])"
# With both false the frame's own rule makes Pointer the default look and turns
# any saved head, eye or eye-tracker choice back into Pointer.
SOURCES = 'const camOK=cameraAllowed(),trackOK=trackerAllowed(),'
NO_SOURCES = 'const camOK=false,trackOK=false,'
# A page with a camera video counts as a camera game, which keeps the head and
# eye "Up and down" row on screen; without a camera that row means nothing.
CAMERA_GAME = "cameraGame=!!document.querySelector('video#camera');"
NO_CAMERA_GAME = 'cameraGame=false;'
INLINE_FRAMES = {'hexsweeper/bounded.html', 'hexsweeper/infinite.html'}

# Camera games: each plays by pointer as well, so it keeps everything else.
INPUT_ROW = ('<label class="row">Look with <select id="input"><option value="head">Head</option>'
             '<option value="eyes">Eyes</option><option value="pointer">Pointer</option></select></label>')
POINTER_INPUT = ('<label class="row" hidden>Look with <select id="input">'
                 '<option value="pointer">Pointer</option></select></label>')
CALIBRATION = '<div class="row">{label} <button id="calibrate" class="text-btn" type="button">Calibrate</button></div>'
# Since game-riffs #270/#273/#277 (0.5.18) each camera game words its Help in its own way, and Glyph and Shoo keep the
# camera's privacy sentences at the end of their keys paragraph: the camera-free build takes out those sentences, or
# the whole paragraph where it holds nothing else, game by game below.
CAMERA_PRIVACY = ' Camera frames never leave this device and are never saved. The camera stops when you leave the page or choose Pointer.'
# A Settings group left with only hidden rows (Pursuit's Play: Look with and Calibration) loses its heading too.
HIDE = ('<style>#camera-btn,#camera-start,#camera{display:none!important}'
        'h3.group:has(+ [hidden] + [hidden] + h3.group){display:none}</style></head>')
CAMERA_GAMES = {
    'glance': ('Calibration', [
        ('content="A small board of tiles, turned over by looking."',
         'content="A small board of tiles to turn dark."'),
        ('<p>Look at a tile until its ring fills, or tap it. That tile turns over,',
         '<p>Tap a tile, or rest the pointer on it until its ring fills. That tile turns over,'),
        ('<p>Camera frames never leave this device and are never saved. The camera stops when you leave the page or choose Pointer.</p>', ''),
    ]),
    'glyph': ('Calibration', [
        ('content="A faint figure on a square of points, traced from corner to corner by looking."',
         'content="A faint figure on a square of points, traced from corner to corner."'),
        ('<p>Hold your look on a point until its ring fills, or tap it, to set the pen down. Then look or drag from point to point to ink the lines. '
         'Rest your look off the points, or tap between them, to lift the pen.</p>',
         '<p>Tap a point, or rest the pointer on it until its ring fills, to set the pen down. Then drag from point to point to ink the lines. '
         'Rest the pointer off the points, or tap between them, to lift the pen.</p>'),
        ('H hints, and Z, U or Backspace undoes.' + CAMERA_PRIVACY + '</p>', 'H hints, and Z, U or Backspace undoes.</p>'),
    ]),
    'shoo': ('Calibration', [
        ('content="Bees flee from wherever you look. Herd them home."',
         'content="Bees hop away from wherever you tap. Herd them home."'),
        ('<p>Get every bee into a hive in as few looks as you can. To look at a cell, hold your look on it until its ring fills, or tap it.',
         '<p>Get every bee into a hive in as few moves as you can. To choose a cell, tap it, or rest the pointer on it until its ring fills.'),
        ('A look that moves no bee doesn’t count.', 'A choice that moves no bee doesn’t count.'),
        ('Enter or Space looks at a cell, H hints, and Z, U or Backspace undoes.' + CAMERA_PRIVACY + '</p>',
         'Enter or Space chooses a cell, H hints, and Z, U or Backspace undoes.</p>'),
    ]),
    'nod': ('Calibration', [
        ('content="Stacked trays, tipped by tilting your head, so the marble drops through the right holes."',
         'content="Stacked trays, tipped with a drag, a swipe or the arrow keys, so the marble drops through the right holes."'),
        ('<p>To tip the trays, tilt your head to one side and hold, then bring it back to level before the next tip; '
         'you can also drag, swipe, tap beside the marble or press an arrow key.</p>',
         '<p>To tip the trays, drag, swipe, tap beside the marble or press an arrow key.</p>'),
        ('<p>Camera frames never leave this device and are never saved, and the camera stops when you leave the page or choose Pointer.</p>', ''),
    ]),
    'pursuit': ('Calibration', [
        ('content="Choose by following: the ring your eyes, head or pointer follows comes to rest in the picture."',
         'content="Choose by following: the ring your pointer follows comes to rest in the picture."'),
        ('<p>Follow a hollow ring with your eyes, your head or a pointer.', '<p>Follow a hollow ring with a pointer.'),
        (' With the camera on, the Undo icon circles, so you can follow it instead.', ''),
        ('<p>Camera frames never leave this device, and no image is saved. The camera stops when you leave the page, '
         'choose Pointer, or press the camera button.</p>', ''),
    ]),
}
POLICY = re.compile(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")', re.I)


def once(text, old, new, path):
    if text.count(old) != 1:
        raise ValueError(f'Camera anchor drift in {path}: {old[:80]!r}, count={text.count(old)}')
    return text.replace(old, new, 1)


# The camera starts only after a press. On the web a camera the browser already allows starts by itself when a game
# opens: the five camera games do it on load, and the shared control frame does it in any game whose Access is Look
# and hold by Head or Eyes. In the package, permission granted once (to another game, or on an earlier day) is not
# the player asking for the camera now. Both places still wait in their "prompt" state, which shows one camera key,
# and still fall back to the pointer when the camera is refused. What starts the camera is the player selecting that
# key or the game's camera button (a tap, a click, or the pointer held on it), or choosing Head, Eyes, Look and hold
# or Calibrate in that game's Settings. A camera the player started comes back on after the app was in the background.
FRAME_AUTOSTART = "if(s==='granted')startCamera(false);else if(s==='denied')fallback();"
FRAME_PRESS_FIRST = "if(s==='denied')fallback();"
GAME_AUTOSTART = "if (state === 'granted') startCamera(prefs.input); else if (state === 'denied') fallback();"
GAME_PRESS_FIRST = "if (state === 'denied') fallback();"


def press_first(game, path, text):
    """No camera without a press in the open game. Applies to every build."""
    if path.endswith('/access.js') and path.count('/') == 1:
        return once(text, FRAME_AUTOSTART, FRAME_PRESS_FIRST, path)
    if game['id'] in CAMERA_GAMES and path == f"{game['id']}/{game['id']}.js":
        return once(text, GAME_AUTOSTART, GAME_PRESS_FIRST, path)
    return text


# The Eye tracker choice in Look with reaches an eye tracker through a helper program on the same computer (the gaze
# bridge, at ws://127.0.0.1:47913). No phone or tablet has that helper, and the Android app has no network permission,
# so in the package the choice only ever answered "No eye tracker found yet: start the gaze bridge" and tried again
# every five seconds. Every build: the frame is told the bridge cannot be reached, which is its own rule for showing
# the choice unavailable with its own sentence beside it and for turning a saved Eye tracker choice back into
# Pointer; and no page's policy allows the connection, since nothing else used it.
GAZE_BRIDGE = 'ws://127.0.0.1:47913'
NO_TRACKER = 'const camOK=cameraAllowed(),trackOK=false,'


def no_gaze_policy(match):
    directives = []
    for part in match.group(2).split(';'):
        words = [w for w in part.split() if w != GAZE_BRIDGE]
        if words:
            directives.append(' '.join(words))
    return match.group(1) + '; '.join(directives) + match.group(3)


def no_eye_tracker(game, path, text):
    """No Eye tracker choice, and no way to the gaze bridge, in any build. Runs after `transform`."""
    frame = (path.endswith('/controls.js') and path.count('/') == 1) or path in INLINE_FRAMES
    # The camera-free variant has already taken every look but Pointer out of the frame.
    if frame and game.get('camera', True):
        text = once(text, SOURCES, NO_TRACKER, path)
    if path.endswith('.html'):
        text = POLICY.sub(no_gaze_policy, text)
        if any(GAZE_BRIDGE in policy.group(2) for policy in POLICY.finditer(text)):
            raise ValueError(f'The gaze bridge is still allowed in {path}')
    return text


def no_camera_policy(match):
    """Drop the camera's WebAssembly and the gaze bridge from a page's own policy."""
    directives = []
    for part in match.group(2).split(';'):
        words = [w for w in part.split() if w not in ("'wasm-unsafe-eval'", 'ws://127.0.0.1:47913')]
        if words:
            directives.append(' '.join(words))
    return match.group(1) + '; '.join(directives) + match.group(3)


def transform(game, path, text):
    if game.get('camera', True):
        return text
    # The shared control frame sits at each game folder's top (akari/, akari-light/ ...),
    # and Hexsweeper's two board pages carry it inline. Hexsweeper Sphere's own
    # sphere/controls.js has no camera.
    if (path.endswith('/controls.js') and path.count('/') == 1) or path in INLINE_FRAMES:
        text = once(text, SOURCES, NO_SOURCES, path)
        text = once(text, LOOK_ROW, POINTER_ROW, path)
        text = once(text, CAMERA_GAME, NO_CAMERA_GAME, path)
    if path.endswith('.html'):
        text = POLICY.sub(no_camera_policy, text)
    if game['id'] in CAMERA_GAMES and path == game['id'] + '/index.html':
        label, wording = CAMERA_GAMES[game['id']]
        calibration = CALIBRATION.format(label=label)
        for old, new in [(INPUT_ROW, POINTER_INPUT),
                         (calibration, calibration.replace('<div class="row">', '<div class="row" hidden>', 1)),
                         ('</head>', HIDE), *wording]:
            text = once(text, old, new, path)
    return text
