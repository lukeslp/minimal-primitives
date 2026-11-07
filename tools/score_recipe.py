"""Guarded Bridges/Slant Scores changes for generated exports only.

Call transform after (or before) tools.transforms.transform. Copy
adapters/scores-compat.js to the export root and load web/scores-transport.js
before collection.js in the parent. No imported file is written by this module.
"""
import hashlib
import posixpath
import re

NATIVE_SHA256 = '0fe431cdbe95e17deff20a73a1c066929e454c0bed1622358bd7589a19e3a3ed'


def _once(text, old, new, path):
    count = text.count(old)
    if count != 1:
        raise ValueError(f'Scores anchor drift in {path}: expected one {old[:70]!r}, found {count}')
    return text.replace(old, new, 1)


def transform(game, path, text):
    """Return generated text, failing closed on native module/script drift."""
    ident = game['id'] if isinstance(game, dict) else game
    if ident not in {'bridges', 'slant'}:
        return text
    if path == f'{ident}/scores.js':
        if hashlib.sha256(text.encode()).hexdigest() != NATIVE_SHA256:
            raise ValueError(f'Scores source drift in {path}')
        lines = text.splitlines(keepends=True)
        # Retain the native factory, dialog markup, buttons and category options.
        # Remove its private profile, clock and every original HTTP operation.
        text = ''.join(line for line in lines if not line.startswith((
            'const api=', ' let data=', ' try{const raw=',
            ' function persist()', ' function token()',
        )))
        text = _once(text, 'if(!window.isSecureContext||',
                     'if(!window.MinimalScoresCompat||!window.isSecureContext||', path)
        start = text.index(' async function post(')
        end_anchor = ' return{load,finish,hint:()=>clock.flag(\'assisted\'),restart:()=>clock.flag(\'repeat\'),get result(){return completed;}};\n'
        end = text.index(end_anchor, start) + len(end_anchor)
        text = text[:start] + (' return MinimalScoresCompat.attach({game,shape,isCampaign,describe,labels,'
                               'sheet,category,status,submit,remove,open,after});\n') + text[end:]
        text = _once(text, 'Your nickname, time and run type will be public.',
                     'Your nickname, time and run type will be public for future new attempts. This attempt keeps its original sharing choice.', path)
        text = _once(text, 'Equal seconds share a rank.', 'Exact times share a rank.', path)
        text = _once(text, 'Share this score', 'Share future scores', path)
        text = _once(text, 'Opening a puzzle sends which puzzle it is with a random ID kept in this browser, and nothing else.',
                     'Sharing uses the nickname and choice saved for the collection. Only new attempts begun after opting in can be shared.', path)
        return text
    if path.startswith(f'{ident}/') and path.endswith('.html'):
        pattern = r'<script src="\./scores\.js(?:\?[^"<>]*)?"></script>'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1 or 'scores-compat.js' in text:
            raise ValueError(f'Scores script anchor drift in {path}')
        root = posixpath.relpath('.', posixpath.dirname('games/' + path))
        return _once(text, matches[0].group(),
                     f'<script src="{root}/scores-compat.js"></script>' + matches[0].group(), path)
    return text
