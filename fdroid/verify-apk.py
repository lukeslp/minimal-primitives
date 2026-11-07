#!/usr/bin/env python3
"""Check a Minimal Primitives fdroid APK against the source tree and recipe.

Run `python3 tools/build.py --variant fdroid` first. Use the unsigned F-Droid
build, or pass --signed-cert for the upstream signed release. Reads files only
and prints a JSON summary.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'com.oneimpossiblethingatatime.minimalprimitives'
FORBIDDEN_DEX = (b'Lcom/google/android/gms/', b'Lcom/google/android/play/',
                 b'Lcom/google/firebase/', b'Lcom/google/mlkit/', b'Lcom/google/mediapipe/')
SIGNING_BLOCKS = {0x7109871A: 'v2', 0xF05368C0: 'v3', 0x1B93AD61: 'v3.1',
                  0x42726577: 'verity-padding', 0x504B4453: 'dependency-metadata',
                  0x6DFF800D: 'source-stamp', 0x2146444E: 'play-frosting'}
ALLOWED_BLOCKS = {'v2', 'v3', 'v3.1', 'verity-padding'}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('apk', type=Path)
parser.add_argument('--build-tools', type=Path, required=True)
parser.add_argument('--metadata', type=Path, default=ROOT / f'fdroid/metadata/{PACKAGE}.yml')
parser.add_argument('--signed-cert', help='expected signer SHA-256 (hex); omit for the unsigned build')
args = parser.parse_args()


def signing_blocks(data):
    eocd = data.rfind(b'PK\x05\x06')
    cd_offset = struct.unpack('<I', data[eocd + 16:eocd + 20])[0]
    if data[cd_offset - 16:cd_offset] != b'APK Sig Block 42':
        return []
    size = struct.unpack('<Q', data[cd_offset - 24:cd_offset - 16])[0]
    position, end, found = cd_offset - size, cd_offset - 24, []
    while position < end:
        length = struct.unpack('<Q', data[position:position + 8])[0]
        found.append(SIGNING_BLOCKS.get(struct.unpack('<I', data[position + 8:position + 12])[0], 'unknown'))
        position += 8 + length
    return found


apk = args.apk.read_bytes()
badging = subprocess.run([str(args.build_tools / 'aapt2'), 'dump', 'badging', str(args.apk)],
                         capture_output=True, text=True, check=True).stdout
package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
assert package and package[1] == PACKAGE, 'Unexpected package'
assert 'application-debuggable' not in badging, 'Release is debuggable'
props = dict(line.split('=', 1) for line in (ROOT / 'android/app.properties').read_text().splitlines()
             if '=' in line and not line.lstrip().startswith('#'))
assert (package[2], package[3]) == (props['FDROID_VERSION_CODE'], props['FDROID_VERSION_NAME']), \
    'APK version differs from the fdroid version in android/app.properties'
builds = re.findall(r'  - versionName: ([^\n]+)\n    versionCode: (\d+)', args.metadata.read_text())
assert builds and (builds[-1][1], builds[-1][0].strip()) == (package[2], package[3]), \
    "APK version differs from the recipe's latest build"
permissions = re.findall(r"uses-permission(?:-sdk-\d+)?: name='([^']+)'", badging)
assert permissions == ['android.permission.VIBRATE'], f'Unexpected permissions: {permissions}'
assert 'android.hardware.camera' not in badging, 'Camera feature in the fdroid flavor'

html = ROOT / 'build/html-fdroid'
expected = {p.relative_to(html).as_posix(): p.read_bytes() for p in html.rglob('*') if p.is_file()}
with zipfile.ZipFile(args.apk) as archive:
    names = set(archive.namelist())
    assert not [n for n in names if n.endswith(('.so', '.wasm', '.task')) or '/vendor/' in n], 'Unexpected binary payload'
    assert 'META-INF/version-control-info.textproto' not in names, 'vcsInfo must stay off'
    assets = {n[len('assets/www/'):] for n in names if n.startswith('assets/www/') and not n.endswith('/')}
    assert assets == set(expected), f'Assets differ from build/html-fdroid: {sorted(assets ^ set(expected))[:8]}'
    for name, data in expected.items():
        if name != 'settings.json':  # Gradle may clear apiBase here; checked below
            assert archive.read('assets/www/' + name) == data, 'Asset differs: ' + name
    assert json.loads(archive.read('assets/www/settings.json')).get('apiBase', '') == '', 'Score service left configured'
    catalog = json.loads(archive.read('assets/www/catalog.json'))
    notices = archive.read('assets/www/NOTICES.txt').decode()
    assert 'MediaPipe Face Landmarker' not in notices and 'fdroid build' in notices, 'NOTICES is not the fdroid build'
    dex = b''.join(archive.read(n) for n in names if re.fullmatch(r'classes\d*\.dex', n))
    for prefix in FORBIDDEN_DEX:
        assert prefix not in dex, 'Prohibited SDK class: ' + prefix.decode()

blocks = signing_blocks(apk)
verify = subprocess.run([str(args.build_tools / 'apksigner'), 'verify', '--print-certs', str(args.apk)],
                        capture_output=True, text=True)
if args.signed_cert:
    assert verify.returncode == 0, 'Signature does not verify'
    certs = re.findall(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})', verify.stdout)
    assert certs == [args.signed_cert.lower()], f'Unexpected signer: {certs}'
    assert set(blocks) <= ALLOWED_BLOCKS and {'v2', 'v3'} <= set(blocks), f'Signing blocks: {blocks}'
else:
    assert verify.returncode != 0 and blocks == [], 'Expected an unsigned F-Droid build'

print(json.dumps({'package': package[1], 'versionCode': int(package[2]), 'versionName': package[3],
                  'permissions': permissions, 'games': [g['id'] for g in catalog], 'assets': len(assets),
                  'signingBlocks': blocks, 'signed': bool(args.signed_cert),
                  'sha256': hashlib.sha256(apk).hexdigest()}, indent=2))
