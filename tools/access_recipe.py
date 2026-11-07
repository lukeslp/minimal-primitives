"""Collection keys in Access: Home and Scores on the pad, in the scan and the look.

The games' own Home button and the Collection scores row in Settings are touch
controls, outside the scan. These two pad keys do the same thing for a switch or
look player: Home returns to the library, Scores opens the collection's scores.
"""

HOME = '<path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/>'
SCORES = '<path d="M8 4h8v5a4 4 0 0 1-8 0ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4v3h-4Z"/>'


# The motor-accessible puzzles keep no collection scores, so their pad has Home only.
KEYS = {False: "[['home','library'],['scores','scores']]", True: "[['home','library']]"}


def hook(text, anchor, replacement, path):
    if text.count(anchor) != 1:
        raise ValueError(f'Access anchor drift in {path}: {anchor[:90]!r}, count={text.count(anchor)}')
    return text.replace(anchor, replacement, 1)


def transform(game, path, text):
    if not path.endswith('/access.js') or game['repository'] != 'lukeslp/game-riffs':
        return text
    # The frame's own in-app Home key talks to the accessible app; the collection adds its own Home below.
    text = hook(text, '    const inApp=(()=>{', '    const inApp=!(window.MinimalBridge&&window.MinimalBridge.nonce)&&(()=>{', path)
    text = hook(text, '    const DEF={', "    ICON.home='" + HOME + "';ICON.scores='" + SCORES + "';\n    const DEF={", path)
    text = hook(text, '    const disc=nexts[0]||null,',
                "    // The collection's own keys, last on the pad and last in the scan.\n"
                "    if(window.MinimalBridge&&window.MinimalBridge.nonce)for(const [id,event] of " + KEYS[game.get('group') == 'accessible'] + ")"
                "keys.push({id,icon:id,collection:true,act:()=>window.MinimalBridge.emit(event)});\n"
                '    const disc=nexts[0]||null,', path)
    text = hook(text, '      if(k.el){if(usable(k.el))k.el.click();return;}',
                '      if(k.act){k.act();return;}\n      if(k.el){if(usable(k.el))k.el.click();return;}', path)
    text = hook(text, 'rest=pads.filter(k=>!dpad.includes(k)),items=[];',
                'rest=pads.filter(k=>!dpad.includes(k)&&!k.collection),items=[],own=pads.filter(k=>k.collection);', path)
    text = hook(text, "add(bar,'actions');}", "add(bar,'actions');add(own,'collection');}", path)
    return text
