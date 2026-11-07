"""Build a disposable subset using real pinned snapshots and both generators."""
import hashlib
import json
import re
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from score_recipe import transform as scores
from transforms import transform as main

out = Path(sys.argv[1])
for game in json.loads((ROOT / 'sources.json').read_text())['games']:
    if game['id'] not in {'bridges', 'slant'}:
        continue
    for item in game['files']:
        source = ROOT / 'imports' / item['path']
        raw = source.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item['sha256']
        target = out / 'games' / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix in {'.js', '.html', '.mjs', '.css'}:
            original = raw.decode()
            generated = main(game, item['path'], original)
            if source.name == 'scores.js':
                assert 'scores-api' not in generated and 'fetch(' not in generated and 'localStorage' not in generated
                assert re.findall(r'id=\"[^\"]+\"', generated) == re.findall(r'id=\"[^\"]+\"', original)
            if source.suffix == '.html':
                assert generated.index('bootstrap.js') < generated.index('scores-compat.js') < generated.index('./scores.js') < generated.index('hooks.js')
            raw = generated.encode()
        target.write_bytes(raw)
    # Native module and HTML anchor drift fail closed; unrelated paths are inert.
    text = (ROOT / 'imports' / game['id'] / 'scores.js').read_text()
    assert scores(game, 'unrelated.js', text) == text
    for path, text in [(game['id'] + '/scores.js', text + '\n'),
                       (game['id'] + '/index.html', '<body></body>'),
                       (game['id'] + '/index.html', '<script src="./scores.js"></script>' * 2)]:
        try:
            scores(game, path, text)
        except ValueError:
            pass
        else:
            raise AssertionError('Missing drift guard: ' + path)
for name in ['bootstrap.js', 'hooks.js', 'scores-compat.js']:
    shutil.copyfile(ROOT / 'adapters' / name, out / name)
shutil.copyfile(ROOT / 'web/scores-transport.js', out / 'scores-transport.js')
print('Verified pins and guarded transforms for both native modules and HTML entries.')
