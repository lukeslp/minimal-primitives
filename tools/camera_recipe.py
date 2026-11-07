"""Camera-free variant: build-only changes that take head and eye input out.

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
INPUT_ROW = ('<label class="row">Input <select id="input"><option value="head">Head</option>'
             '<option value="eyes">Eyes</option><option value="pointer">Pointer</option></select></label>')
POINTER_INPUT = ('<label class="row" hidden>Input <select id="input">'
                 '<option value="pointer">Pointer</option></select></label>')
CALIBRATION = '<div class="row">{label} <button id="calibrate" class="text-btn" type="button">Calibrate</button></div>'
PRIVACY = ('<p>Camera frames never leave this device and nothing is stored; '
           'the camera stops when you leave or choose Pointer.</p>')
HIDE = '<style>#camera-btn,#camera-start,#camera{display:none!important}</style></head>'
CAMERA_GAMES = {
    'glance': ('Calibration', [
        ('content="A small board of tiles, turned over by looking."',
         'content="A small board of tiles to turn dark."'),
        ('<p>Look at a tile until its ring fills, or tap it, to turn it and its neighbours over.</p>',
         '<p>Tap a tile, or rest the pointer on it until its ring fills, to turn it and its neighbours over.</p>'),
    ]),
    'glyph': ('Calibration', [
        ('content="A faint figure on a square of points, traced from corner to corner by looking."',
         'content="A faint figure on a square of points, traced from corner to corner."'),
        ('<p>Hold your look on a point until its ring fills, or tap it, to set the pen down; then look or drag from point to point.</p>',
         '<p>Tap a point, or rest the pointer on it until its ring fills, to set the pen down; then drag from point to point.</p>'),
        ('rest your look off the points, or tap between them, to lift the pen.',
         'rest the pointer off the points, or tap between them, to lift the pen.'),
    ]),
    'shoo': ('Calibration', [
        ('content="Bees flee from wherever you look. Herd them home."',
         'content="Bees hop away from wherever you tap. Herd them home."'),
        ('<p>Look at a cell until its ring fills, or tap it, and every bee beside it hops one cell away.</p>',
         '<p>Tap a cell, or rest the pointer on it until its ring fills, and every bee beside it hops one cell away.</p>'),
        ('in as few looks as you can;', 'in as few moves as you can;'),
    ]),
    'nod': ('Calibration', [
        ('content="Stacked trays, tipped by tilting your head, so the marble drops through the right holes."',
         'content="Stacked trays, tipped with a drag, a swipe or the arrow keys, so the marble drops through the right holes."'),
        ('<p>Tilt your head toward a side and hold, or drag, swipe or press an arrow, to tip the trays; come back to level before the next tip.</p>',
         '<p>Drag, swipe or press an arrow to tip the trays.</p>'),
    ]),
    'pursuit': ('Gaze dot', [
        ('content="Choose by following: the ring your eyes, head or pointer follows comes to rest in the picture."',
         'content="Choose by following: the ring your pointer follows comes to rest in the picture."'),
        ('<p>Follow a ring with your eyes, your head or a pointer until its trail fills, and it comes to rest in the picture.</p>',
         '<p>Follow a ring with a pointer until its trail fills, and it comes to rest in the picture.</p>'),
    ]),
}
POLICY = re.compile(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")', re.I)


def once(text, old, new, path):
    if text.count(old) != 1:
        raise ValueError(f'Camera anchor drift in {path}: {old[:80]!r}, count={text.count(old)}')
    return text.replace(old, new, 1)


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
                         (PRIVACY, ''), ('</head>', HIDE), *wording]:
            text = once(text, old, new, path)
    return text
